// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title BatchCallAndSponsor
 * @notice Persistent EIP-7702 delegation contract.
 *
 * Once an EOA delegates to this contract via EIP-7702, the delegation
 * persists on-chain until explicitly revoked. The EOA retains its address
 * and history while gaining smart account capabilities.
 *
 * Two execution modes:
 *  1. Sponsored: Any relayer submits with a valid EOA inner-signature (gasless).
 *  2. Direct:    The smart account itself calls (no inner-signature needed).
 */
contract BatchCallAndSponsor {
    using ECDSA for bytes32;

    /// @notice Replay-protection nonce (stored in EOA's storage via delegatecall).
    uint256 public nonce;

    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    event CallExecuted(address indexed sender, address indexed to, uint256 value, bytes data);
    event BatchExecuted(uint256 indexed nonce, Call[] calls);
    event DelegationActivated(address indexed account, address indexed implementation);

    /**
     * @notice Sponsored execution — relayer pays gas.
     * @param calls  Batch of calls to execute atomically.
     * @param signature EOA's ECDSA signature over (nonce, calls).
     */
    function execute(Call[] calldata calls, bytes calldata signature) external payable {
        bytes memory encodedCalls;
        for (uint256 i = 0; i < calls.length; i++) {
            encodedCalls = abi.encodePacked(
                encodedCalls,
                calls[i].to,
                calls[i].value,
                calls[i].data
            );
        }
        bytes32 digest = keccak256(abi.encodePacked(nonce, encodedCalls));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(digest);

        address recovered = ECDSA.recover(ethSignedHash, signature);
        require(recovered == address(this), "Invalid signature");

        _executeBatch(calls);
    }

    /**
     * @notice Direct execution — only callable by the smart account itself.
     * @param calls Batch of calls to execute atomically.
     */
    function execute(Call[] calldata calls) external payable {
        require(msg.sender == address(this), "Invalid authority");
        _executeBatch(calls);
    }

    /**
     * @notice Returns current nonce for off-chain signing.
     * @dev Nonce lives in EOA storage — persists across sessions.
     */
    function getNonce() external view returns (uint256) {
        return nonce;
    }

    function _executeBatch(Call[] calldata calls) internal {
        uint256 currentNonce = nonce;
        nonce++;

        for (uint256 i = 0; i < calls.length; i++) {
            _executeCall(calls[i]);
        }

        emit BatchExecuted(currentNonce, calls);
    }

    function _executeCall(Call calldata callItem) internal {
        (bool success,) = callItem.to.call{value: callItem.value}(callItem.data);
        require(success, "Call reverted");
        emit CallExecuted(msg.sender, callItem.to, callItem.value, callItem.data);
    }

    fallback() external payable {}
    receive() external payable {}
}
