// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {SmartEOA} from "../src/SmartEOA.sol";
import {ERC7821} from "solady/accounts/ERC7821.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

/**
 * @title SmartEOATest
 * @notice Foundry test suite for SmartEOA (Solady-based EIP-7702 smart account).
 */
contract SmartEOATest is Test {
    SmartEOA implementation;

    // Anvil account #1
    uint256 constant EOA_PK   = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address constant EOA_ADDR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    // Anvil account #0 (sponsor / relayer)
    uint256 constant SPONSOR_PK   = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SPONSOR_ADDR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    // Recipient
    address constant RECIPIENT = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function setUp() public {
        implementation = new SmartEOA();

        // Fund EOA
        vm.deal(EOA_ADDR, 10 ether);
        vm.deal(SPONSOR_ADDR, 10 ether);
    }

    // ── Test 1: EIP-7702 delegation ────────────────────────────────────────

    function test_Delegation() public {
        // Sign EIP-7702 authorization (EOA → SmartEOA implementation)
        vm.signAndAttachDelegation(address(implementation), EOA_PK);

        // EOA now has code
        assertGt(EOA_ADDR.code.length, 0, "EOA should have delegated code");

        // Delegation prefix 0xef0100
        bytes memory code = EOA_ADDR.code;
        assertEq(uint8(code[0]), 0xef);
        assertEq(uint8(code[1]), 0x01);
        assertEq(uint8(code[2]), 0x00);
    }

    // ── Test 2: ERC-7821 supportsExecutionMode ──────────────────────────────

    function test_SupportsExecutionMode() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        // Single batch mode: 0x01000000000078210001...
        bytes32 singleBatch = bytes32(hex"0100000000007821000100000000000000000000000000000000000000000000");
        assertTrue(account.supportsExecutionMode(singleBatch), "should support single batch mode");
    }

    // ── Test 3: Sponsored execution via executeSigned ──────────────────────

    function test_ExecuteSigned_Transfer() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        uint256 nonce = account.getNonce();
        assertEq(nonce, 0);

        // Build call
        SmartEOA.Call[] memory calls = new SmartEOA.Call[](1);
        calls[0] = ERC7821.Call({
            to:    RECIPIENT,
            value: 0.1 ether,
            data:  ""
        });

        // Get EIP-712 digest and sign as EOA
        bytes32 digest = account.hashBatch(nonce, calls);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 recipientBefore = RECIPIENT.balance;

        // Sponsor submits tx
        vm.prank(SPONSOR_ADDR);
        account.executeSigned(calls, sig);

        assertEq(RECIPIENT.balance - recipientBefore, 0.1 ether, "transfer should succeed");
        assertEq(account.getNonce(), 1, "nonce should increment");
    }

    // ── Test 4: Invalid signature reverts ──────────────────────────────────

    function test_ExecuteSigned_InvalidSig_Reverts() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        SmartEOA.Call[] memory calls = new SmartEOA.Call[](1);
        calls[0] = ERC7821.Call({to: RECIPIENT, value: 0.1 ether, data: ""});

        // Sign with WRONG key (sponsor key)
        bytes32 digest = account.hashBatch(0, calls);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SPONSOR_PK, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.prank(SPONSOR_ADDR);
        vm.expectRevert(bytes("SmartEOA: invalid signature"));
        account.executeSigned(calls, badSig);
    }

    // ── Test 5: Nonce replay protection ────────────────────────────────────

    function test_NonceReplayProtection() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        SmartEOA.Call[] memory calls = new SmartEOA.Call[](1);
        calls[0] = ERC7821.Call({to: RECIPIENT, value: 0.01 ether, data: ""});

        bytes32 digest = account.hashBatch(0, calls);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // First execution succeeds
        vm.prank(SPONSOR_ADDR);
        account.executeSigned(calls, sig);
        assertEq(account.getNonce(), 1);

        // Replay with same sig fails (nonce is now 1)
        vm.prank(SPONSOR_ADDR);
        vm.expectRevert(bytes("SmartEOA: invalid signature"));
        account.executeSigned(calls, sig);
    }

    // ── Test 6: Batch of multiple calls ────────────────────────────────────

    function test_MultipleCalls() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        address recipient2 = makeAddr("recipient2");

        SmartEOA.Call[] memory calls = new SmartEOA.Call[](2);
        calls[0] = ERC7821.Call({to: RECIPIENT,  value: 0.1 ether, data: ""});
        calls[1] = ERC7821.Call({to: recipient2, value: 0.2 ether, data: ""});

        bytes32 digest = account.hashBatch(0, calls);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(SPONSOR_ADDR);
        account.executeSigned(calls, sig);

        assertEq(RECIPIENT.balance, 0.1 ether);
        assertEq(recipient2.balance, 0.2 ether);
        assertEq(account.getNonce(), 1);
    }

    // ── Test 7: ERC-1271 isValidSignature ──────────────────────────────────

    function test_IsValidSignature() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        bytes32 hash = keccak256("test message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes4 result = account.isValidSignature(hash, sig);
        assertEq(result, bytes4(0x1626ba7e), "should return ERC-1271 magic value");
    }

    // ── Test 8: delegatedTo() introspection ────────────────────────────────

    function test_DelegatedTo() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        address delegated = account.delegatedTo();
        assertEq(delegated, address(implementation), "delegatedTo should return implementation");
    }

    // ── Test 9: Direct self-call reverts from external caller ──────────────

    function test_DirectExecute_NotSelf_Reverts() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        SmartEOA account = SmartEOA(payable(EOA_ADDR));

        SmartEOA.Call[] memory calls = new SmartEOA.Call[](1);
        calls[0] = ERC7821.Call({to: RECIPIENT, value: 0, data: ""});

        // Use single-batch mode with no opData
        bytes32 mode = bytes32(hex"0100000000007821000100000000000000000000000000000000000000000000");
        bytes memory executionData = abi.encode(calls);

        // Sponsor tries to call execute() directly (no sig) — should revert
        vm.prank(SPONSOR_ADDR);
        vm.expectRevert();
        account.execute(mode, executionData);
    }

    // ── Test 10: Receive ETH ────────────────────────────────────────────────

    function test_ReceiveEth() public {
        vm.signAndAttachDelegation(address(implementation), EOA_PK);
        uint256 before = EOA_ADDR.balance;
        vm.deal(SPONSOR_ADDR, 1 ether);
        vm.prank(SPONSOR_ADDR);
        (bool ok,) = EOA_ADDR.call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(EOA_ADDR.balance, before + 0.5 ether);
    }
}
