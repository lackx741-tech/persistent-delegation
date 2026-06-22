// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Orchestrator
 * @notice On-chain contract that triggers execution on behalf of delegated EOAs.
 *
 * The flow:
 * 1. EOA delegates to AccountImplementation via EIP-7702
 * 2. EOA calls initialize(orchestratorAddress) — registers THIS contract
 * 3. Orchestrator owner calls orchestrateTask(eoa, ...) to act AS the EOA
 * 4. AccountImplementation's onlySelfOrOrchestrator allows the call
 * 5. Call runs inside EOA context: address(this) == EOA, ETH from EOA balance
 */

interface IDelegatedAccount {
    function execute(address target, uint256 value, bytes calldata data)
        external payable returns (bytes memory);

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable returns (bytes[] memory);

    function sweepToken(address token) external returns (uint256);
    function sweepTokens(address[] calldata tokens) external;

    function getOrchestrator() external view returns (address);
    function isInitialized() external view returns (bool);
    function getNonce() external view returns (uint256);
}

contract Orchestrator {
    address public owner;

    event TaskExecuted(address indexed eoa, address indexed target, uint256 value);
    event BatchTaskExecuted(address indexed eoa, uint256 callCount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Orchestrator: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── Single task ────────────────────────────────────────────────────────

    /**
     * @notice Instruct a delegated EOA to execute a single call.
     * @param eoa     The EIP-7702 delegated EOA address.
     * @param target  Contract to call.
     * @param value   ETH to send (comes from EOA balance).
     * @param data    Calldata.
     */
    function orchestrateTask(
        address payable eoa,
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyOwner returns (bytes memory) {
        require(IDelegatedAccount(eoa).isInitialized(), "Orchestrator: EOA not initialized");

        bytes memory result = IDelegatedAccount(eoa).execute(target, value, data);
        emit TaskExecuted(eoa, target, value);
        return result;
    }

    // ── Batch task ─────────────────────────────────────────────────────────

    /**
     * @notice Instruct a delegated EOA to execute a batch of calls atomically.
     */
    function orchestrateBatch(
        address payable eoa,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external onlyOwner returns (bytes[] memory) {
        require(IDelegatedAccount(eoa).isInitialized(), "Orchestrator: EOA not initialized");

        bytes[] memory results = IDelegatedAccount(eoa).executeBatch(targets, values, datas);
        emit BatchTaskExecuted(eoa, targets.length);
        return results;
    }

    // ── Multi-EOA batch ────────────────────────────────────────────────────

    /**
     * @notice Execute the same task across multiple delegated EOAs.
     * @dev Useful for orchestrating a fleet of EOAs in one tx.
     */
    function orchestrateAll(
        address payable[] calldata eoas,
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyOwner {
        for (uint256 i = 0; i < eoas.length; i++) {
            if (IDelegatedAccount(eoas[i]).isInitialized()) {
                IDelegatedAccount(eoas[i]).execute(target, value, data);
                emit TaskExecuted(eoas[i], target, value);
            }
        }
    }

    // ── Sweep tokens ───────────────────────────────────────────────────────

    /**
     * @notice Sweep one ERC-20 token from a delegated EOA to its forward address.
     */
    function sweepToken(address payable eoa, address token)
        external onlyOwner returns (uint256)
    {
        return IDelegatedAccount(eoa).sweepToken(token);
    }

    /**
     * @notice Sweep multiple tokens from a delegated EOA.
     */
    function sweepTokens(address payable eoa, address[] calldata tokens)
        external onlyOwner
    {
        IDelegatedAccount(eoa).sweepTokens(tokens);
    }

    /**
     * @notice Sweep the same token across a fleet of EOAs.
     */
    function sweepTokenFromAll(address payable[] calldata eoas, address token)
        external onlyOwner
    {
        for (uint256 i = 0; i < eoas.length; i++) {
            if (IDelegatedAccount(eoas[i]).isInitialized()) {
                IDelegatedAccount(eoas[i]).sweepToken(token);
            }
        }
    }

    // ── View ───────────────────────────────────────────────────────────────

    /**
     * @notice Check if an EOA is ready to be orchestrated.
     */
    function canOrchestrate(address eoa) external view returns (bool) {
        return IDelegatedAccount(eoa).isInitialized()
            && IDelegatedAccount(eoa).getOrchestrator() == address(this);
    }
}
