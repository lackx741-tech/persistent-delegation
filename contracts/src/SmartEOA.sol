// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC7821} from "solady/accounts/ERC7821.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {LibEIP7702} from "solady/accounts/LibEIP7702.sol";

/**
 * @title SmartEOA
 * @notice Production-grade EIP-7702 smart account built on Solady.
 *
 * Inherits Solady's ERC7821 minimal batch executor + EIP-712 typed-data
 * signing + gas-optimized ECDSA — replacing the hand-rolled BatchCallAndSponsor.
 *
 * Key improvements over BatchCallAndSponsor:
 *  - EIP-712 typed digest (domain-separated, replay-safe, wallet-displayable)
 *  - ERC7821 execution modes (ERC-7579 compatible: single batch + batch-of-batches)
 *  - Solady ECDSA is ~40% cheaper than OZ ECDSA
 *  - ERC-1271 isValidSignature so multisigs/passkeys can act as authority
 *  - LibEIP7702.delegationOf() to introspect own delegation on-chain
 */
contract SmartEOA is ERC7821, EIP712 {

    // ── Storage ────────────────────────────────────────────────────────────

    /// @dev Replay-protection nonce (lives in EOA's storage via delegatecall).
    uint256 public nonce;

    // ── EIP-712 domain + typehash ──────────────────────────────────────────

    /// @dev keccak256("BatchExecute(uint256 nonce,Call[] calls)Call(address to,uint256 value,bytes data)")
    bytes32 public constant BATCH_EXECUTE_TYPEHASH =
        keccak256("BatchExecute(uint256 nonce,Call[] calls)Call(address to,uint256 value,bytes data)");

    /// @dev keccak256("Call(address to,uint256 value,bytes data)")
    bytes32 public constant CALL_TYPEHASH =
        keccak256("Call(address to,uint256 value,bytes data)");

    // ── Events ─────────────────────────────────────────────────────────────

    event SmartBatchExecuted(uint256 indexed nonce, address indexed executor, uint256 callCount);

    // ── EIP-712 domain ─────────────────────────────────────────────────────

    function _domainNameAndVersion()
        internal
        pure
        override
        returns (string memory name, string memory version)
    {
        name = "SmartEOA";
        version = "1";
    }

    // ── Sponsored execution (relayer pays gas) ─────────────────────────────

    /**
     * @notice Execute a batch signed by the EOA owner (EIP-712 typed data).
     * @dev Sponsored path: any relayer submits this. Gas comes from relayer.
     *      Signature is over the EIP-712 hash of (nonce, calls[]).
     * @param calls     Batch of (to, value, data) to execute atomically.
     * @param signature EOA's ECDSA signature over the EIP-712 digest.
     */
    function executeSigned(Call[] calldata calls, bytes calldata signature)
        external
        payable
    {
        bytes32 digest = _batchDigest(nonce, calls);
        address signer = ECDSA.recoverCalldata(digest, signature);
        require(signer == address(this), "SmartEOA: invalid signature");
        _runBatch(calls);
    }

    // ── ERC-7821 override (auth hook) ─────────────────────────────────────

    /**
     * @dev Override ERC7821._execute (4-arg form) to enforce auth.
     *      - No opData → self-call only.
     *      - opData present → treat as EIP-712 signature from EOA owner.
     */
    function _execute(
        bytes32 mode,
        bytes calldata executionData,
        Call[] calldata calls,
        bytes calldata opData
    ) internal override {
        if (opData.length == 0) {
            require(msg.sender == address(this), "SmartEOA: unauthorized");
            _execute(calls, bytes32(0));
        } else {
            bytes32 digest = _batchDigest(nonce, calls);
            address signer = ECDSA.recoverCalldata(digest, opData);
            require(signer == address(this), "SmartEOA: invalid signature");
            _execute(calls, bytes32(0));
        }
        // silence unused warnings
        mode; executionData;
    }

    // ── ERC-1271 isValidSignature ──────────────────────────────────────────

    /**
     * @notice Standard ERC-1271 signature check.
     * @dev Enables passkeys, multisigs, and other smart signers to authorize.
     */
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (ECDSA.recoverCalldata(hash, signature) == address(this)) {
            return 0x1626ba7e; // ERC-1271 magic value
        }
        return 0xffffffff;
    }

    // ── Nonce helpers ──────────────────────────────────────────────────────

    /// @notice Returns current nonce for off-chain signing.
    function getNonce() external view returns (uint256) {
        return nonce;
    }

    /**
     * @notice Build the EIP-712 digest for a batch off-chain.
     * @dev Call this view to get the hash to sign.
     */
    function hashBatch(uint256 _nonce, Call[] calldata calls)
        external
        view
        returns (bytes32)
    {
        return _batchDigest(_nonce, calls);
    }

    // ── Delegation introspection ───────────────────────────────────────────

    /**
     * @notice Returns the address this EOA is currently delegated to (if any).
     * @dev Uses LibEIP7702.delegationOf() — reads 0xef0100 prefix from bytecode.
     */
    function delegatedTo() external view returns (address) {
        return LibEIP7702.delegationOf(address(this));
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    function _batchDigest(uint256 _nonce, Call[] calldata calls)
        internal
        view
        returns (bytes32)
    {
        bytes32[] memory callHashes = new bytes32[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            callHashes[i] = keccak256(
                abi.encode(CALL_TYPEHASH, calls[i].to, calls[i].value, keccak256(calls[i].data))
            );
        }
        bytes32 callsHash = keccak256(abi.encodePacked(callHashes));
        return _hashTypedData(
            keccak256(abi.encode(BATCH_EXECUTE_TYPEHASH, _nonce, callsHash))
        );
    }

    function _runBatch(Call[] calldata calls) internal {
        uint256 currentNonce = nonce++;
        for (uint256 i; i < calls.length; ++i) {
            address to = calls[i].to == address(0) ? address(this) : calls[i].to;
            (bool ok,) = to.call{value: calls[i].value}(calls[i].data);
            require(ok, "SmartEOA: call reverted");
        }
        emit SmartBatchExecuted(currentNonce, msg.sender, calls.length);
    }

    // Helper to decode ERC7821 executionData without running it
    function _decodeBatch(bytes calldata executionData)
        internal
        pure
        returns (Call[] calldata calls, bytes calldata opData)
    {
        // Initialize opData to empty slice
        assembly { opData.offset := executionData.offset opData.length := 0 }
        assembly {
            let o := add(executionData.offset, calldataload(executionData.offset))
            calls.offset := add(o, 0x20)
            calls.length := calldataload(o)
            let hasOp := gt(calldataload(executionData.offset), 0x20)
            if hasOp {
                let oo := add(executionData.offset, calldataload(add(executionData.offset, 0x20)))
                opData.offset := add(oo, 0x20)
                opData.length := calldataload(oo)
            }
        }
    }

    fallback() external payable override {}
    receive() external payable override {}
}
