// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "solady/utils/ECDSA.sol";
import {EIP712} from "solady/utils/EIP712.sol";

/**
 * @title AccountImplementation
 * @notice EIP-7702 delegation target. EOA delegates to this contract,
 *         then calls run in the EOA's own context (delegatecall-like).
 *
 * Key points:
 * - address(this) == EOA address at all times
 * - Storage reads/writes go to EOA's storage
 * - Uses namespaced storage slots to avoid collisions with EOA's own vars
 * - Only EOA itself OR the registered on-chain Orchestrator can execute
 */
contract AccountImplementation is EIP712 {
    using ECDSA for bytes32;

    // ── Namespaced storage slots ───────────────────────────────────────────
    // keccak256-based slots prevent collision with the EOA's own storage vars

    /// @dev Slot for the authorized Orchestrator address
    bytes32 private constant ORCHESTRATOR_SLOT =
        keccak256("eip7702.account.orchestrator");

    /// @dev Slot for replay-protection nonce
    bytes32 private constant NONCE_SLOT =
        keccak256("eip7702.account.nonce");

    /// @dev Slot for the initialized flag
    bytes32 private constant INITIALIZED_SLOT =
        keccak256("eip7702.account.initialized");

    /// @dev Slot for auto-forward address (ETH received → forwarded here if set)
    bytes32 private constant FORWARD_SLOT =
        keccak256("eip7702.account.forwardTo");

    // ── EIP-712 typehashes ─────────────────────────────────────────────────

    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(address target,uint256 value,bytes data,uint256 nonce)");

    bytes32 public constant BATCH_TYPEHASH =
        keccak256("ExecuteBatch(address[] targets,uint256[] values,bytes[] datas,uint256 nonce)");

    // ── Events ─────────────────────────────────────────────────────────────

    event Executed(address indexed target, uint256 value, bytes data);
    event BatchExecuted(uint256 callCount, uint256 nonce);
    event OrchestratorSet(address indexed orchestrator);
    event Initialized(address indexed eoa, address indexed orchestrator);
    event ForwardAddressSet(address indexed forwardTo);
    event ETHForwarded(address indexed from, address indexed to, uint256 amount);
    event TokenForwarded(address indexed token, address indexed to, uint256 amount);

    // ── Auth modifier ──────────────────────────────────────────────────────

    modifier onlySelfOrOrchestrator() {
        address orchestrator = getOrchestrator();
        require(
            msg.sender == address(this) || msg.sender == orchestrator,
            "AccountImpl: unauthorized"
        );
        _;
    }

    // ── Initialization ─────────────────────────────────────────────────────

    /**
     * @notice Initialize: set the on-chain Orchestrator that can act as this EOA.
     * @dev Called in the same tx as delegation (or right after).
     *      Can only be called once per EOA.
     * @param _orchestrator Address of the Orchestrator contract.
     * @param _forwardTo    Address to auto-forward received ETH (0x0 = disabled).
     */
    function initialize(address _orchestrator, address _forwardTo) external {
        require(!isInitialized(), "AccountImpl: already initialized");
        _setInitialized(true);
        _setOrchestrator(_orchestrator);
        if (_forwardTo != address(0)) _setForwardAddress(_forwardTo);
        emit Initialized(address(this), _orchestrator);
    }

    /**
     * @notice Update the auto-forward address (EOA self-call only).
     * @param _forwardTo New forward address. Set to 0x0 to disable forwarding.
     */
    function setForwardAddress(address _forwardTo) external {
        require(msg.sender == address(this), "AccountImpl: not self");
        _setForwardAddress(_forwardTo);
    }

    /**
     * @notice Update orchestrator (EOA only — self-call required).
     */
    function setOrchestrator(address _orchestrator) external {
        require(msg.sender == address(this), "AccountImpl: not self");
        _setOrchestrator(_orchestrator);
    }

    // ── Execution ──────────────────────────────────────────────────────────

    /**
     * @notice Execute a single call from EOA context.
     * @dev Only EOA itself or the registered Orchestrator can call this.
     */
    function execute(address target, uint256 value, bytes calldata data)
        external
        payable
        onlySelfOrOrchestrator
        returns (bytes memory)
    {
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "AccountImpl: call failed");
        emit Executed(target, value, data);
        return result;
    }

    /**
     * @notice Execute a batch of calls atomically from EOA context.
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable onlySelfOrOrchestrator returns (bytes[] memory) {
        require(
            targets.length == values.length && values.length == datas.length,
            "AccountImpl: length mismatch"
        );
        bytes[] memory results = new bytes[](targets.length);
        uint256 n = _getNonce();
        _setNonce(n + 1);

        for (uint256 i = 0; i < targets.length; i++) {
            (bool ok, bytes memory res) = targets[i].call{value: values[i]}(datas[i]);
            require(ok, "AccountImpl: batch step failed");
            results[i] = res;
            emit Executed(targets[i], values[i], datas[i]);
        }
        emit BatchExecuted(targets.length, n);
        return results;
    }

    /**
     * @notice Sweep full ERC-20 balance of one token to the forward address.
     * @dev Callable by anyone — forward address is the only destination.
     *      Because we run in EOA context, balanceOf(address(this)) = EOA's token balance.
     * @param token ERC-20 token contract address.
     */
    function sweepToken(address token) external returns (uint256 amount) {
        address fwd = getForwardAddress();
        require(fwd != address(0), "AccountImpl: no forward address set");

        // balanceOf(address(this)) reads EOA's token balance (delegatecall context)
        (bool ok1, bytes memory bal) = token.call(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        require(ok1, "AccountImpl: balanceOf failed");
        amount = abi.decode(bal, (uint256));
        if (amount == 0) return 0;

        // transfer(fwd, amount) — moves EOA's tokens to the forward address
        (bool ok2, bytes memory res) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", fwd, amount)
        );
        require(ok2 && (res.length == 0 || abi.decode(res, (bool))), "AccountImpl: transfer failed");
        emit TokenForwarded(token, fwd, amount);
    }

    /**
     * @notice Sweep multiple ERC-20 tokens to the forward address in one tx.
     * @param tokens Array of ERC-20 token addresses to sweep.
     */
    function sweepTokens(address[] calldata tokens) external {
        address fwd = getForwardAddress();
        require(fwd != address(0), "AccountImpl: no forward address set");

        for (uint256 i = 0; i < tokens.length; i++) {
            (bool ok1, bytes memory bal) = tokens[i].call(
                abi.encodeWithSignature("balanceOf(address)", address(this))
            );
            if (!ok1) continue;
            uint256 amount = abi.decode(bal, (uint256));
            if (amount == 0) continue;

            (bool ok2, bytes memory res) = tokens[i].call(
                abi.encodeWithSignature("transfer(address,uint256)", fwd, amount)
            );
            if (ok2 && (res.length == 0 || abi.decode(res, (bool)))) {
                emit TokenForwarded(tokens[i], fwd, amount);
            }
        }
    }

    /**
     * @notice Sponsored execute — any relayer can submit with a valid EOA signature.
     * @dev Signature is over EIP-712 digest of (target, value, data, nonce).
     */
    function executeSigned(
        address target,
        uint256 value,
        bytes calldata data,
        bytes calldata signature
    ) external payable returns (bytes memory) {
        uint256 n = _getNonce();
        bytes32 digest = _hashTypedData(
            keccak256(abi.encode(EXECUTE_TYPEHASH, target, value, keccak256(data), n))
        );
        address signer = ECDSA.recoverCalldata(digest, signature);
        require(signer == address(this), "AccountImpl: invalid signature");
        _setNonce(n + 1);

        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "AccountImpl: call failed");
        emit Executed(target, value, data);
        return result;
    }

    // ── View helpers ───────────────────────────────────────────────────────

    function getNonce() external view returns (uint256) { return _getNonce(); }
    function getOrchestrator() public view returns (address o) {
        bytes32 slot = ORCHESTRATOR_SLOT;
        assembly { o := sload(slot) }
    }
    function getForwardAddress() public view returns (address f) {
        bytes32 slot = FORWARD_SLOT;
        assembly { f := sload(slot) }
    }
    function isInitialized() public view returns (bool v) {
        bytes32 slot = INITIALIZED_SLOT;
        assembly { v := sload(slot) }
    }

    // ── EIP-712 domain ─────────────────────────────────────────────────────

    function _domainNameAndVersion()
        internal pure override
        returns (string memory name, string memory version)
    {
        name = "AccountImplementation";
        version = "1";
    }

    // ── Internal storage helpers ───────────────────────────────────────────

    function _getNonce() internal view returns (uint256 v) {
        bytes32 slot = NONCE_SLOT;
        assembly { v := sload(slot) }
    }
    function _setNonce(uint256 v) internal {
        bytes32 slot = NONCE_SLOT;
        assembly { sstore(slot, v) }
    }
    function _setOrchestrator(address v) internal {
        bytes32 slot = ORCHESTRATOR_SLOT;
        assembly { sstore(slot, v) }
        emit OrchestratorSet(v);
    }
    function _setForwardAddress(address v) internal {
        bytes32 slot = FORWARD_SLOT;
        assembly { sstore(slot, v) }
        emit ForwardAddressSet(v);
    }
    function _setInitialized(bool v) internal {
        bytes32 slot = INITIALIZED_SLOT;
        assembly { sstore(slot, v) }
    }

    /// @dev Test helper: expose EIP-712 digest for executeSigned
    function hashTypedData_forTest(
        address target, uint256 value, bytes calldata data, uint256 n
    ) external view returns (bytes32) {
        return _hashTypedData(
            keccak256(abi.encode(EXECUTE_TYPEHASH, target, value, keccak256(data), n))
        );
    }

    /**
     * @notice Auto-forward received ETH to configured address.
     * @dev Runs in EOA context (delegatecall): address(this) = EOA.
     *      ETH lands on EOA → immediately pushed to forwardTo.
     *      If forwardTo not set → ETH stays on EOA (normal).
     */
    receive() external payable {
        address fwd = getForwardAddress();
        if (fwd != address(0) && msg.value > 0) {
            (bool ok,) = fwd.call{value: msg.value}("");
            require(ok, "AccountImpl: forward failed");
            emit ETHForwarded(msg.sender, fwd, msg.value);
        }
    }

    fallback() external payable {}
}
