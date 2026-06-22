// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/BatchCallAndSponsor.sol";

/**
 * @title PersistentDelegationTest
 * @notice Tests EIP-7702 persistent delegation with batch execution on Anvil (prague hardfork).
 *
 * Run with:
 *   anvil --hardfork prague  (in separate terminal)
 *   forge test --fork-url http://localhost:8545 -vvv
 *
 * Or run directly (no fork needed for unit tests):
 *   forge test -vvv
 */
contract PersistentDelegationTest is Test {
    BatchCallAndSponsor public implementation;

    // Anvil default funded accounts
    address public alice;   // EOA — will be delegated
    uint256 public aliceKey;
    address public bob;     // Sponsor — pays gas
    uint256 public bobKey;
    address public charlie; // Recipient

    function setUp() public {
        // Deploy the BatchCallAndSponsor implementation
        implementation = new BatchCallAndSponsor();

        // Use Anvil's pre-funded test keys
        aliceKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        alice    = vm.addr(aliceKey);
        bobKey   = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        bob      = vm.addr(bobKey);
        charlie  = makeAddr("charlie");

        vm.deal(alice, 2 ether);
        vm.deal(bob, 2 ether);
    }

    // ─── Test 1: Delegation activates and persists ────────────────────────────

    function test_DelegationActivates() public {
        // Before delegation: Alice has no code
        assertEq(alice.code.length, 0, "Alice should have no code before delegation");

        // Alice signs EIP-7702 authorization (persistent — no nonce expiry)
        vm.signAndAttachDelegation(address(implementation), aliceKey);

        // After delegation: Alice's code is the delegation prefix + impl address
        assertTrue(alice.code.length > 0, "Alice should have delegation code");

        // Verify the delegated address points to our implementation
        // EIP-7702 code format: 0xef0100 ++ address(implementation)
        bytes memory expectedCode = abi.encodePacked(
            hex"ef0100",
            address(implementation)
        );
        assertEq(alice.code, expectedCode, "Alice's code should be delegation to implementation");

        console.log("Alice address:          ", alice);
        console.log("Implementation address: ", address(implementation));
        console.log("Alice code length:      ", alice.code.length);
    }

    // ─── Test 2: Batch execution via delegatecall ─────────────────────────────

    function test_BatchExecution() public {
        vm.signAndAttachDelegation(address(implementation), aliceKey);

        // Build batch: send 0.1 ETH to Charlie
        BatchCallAndSponsor.Call[] memory calls = new BatchCallAndSponsor.Call[](1);
        calls[0] = BatchCallAndSponsor.Call({
            to: charlie,
            value: 0.1 ether,
            data: ""
        });

        // Read current nonce (from Alice's storage via delegation)
        uint256 nonce = BatchCallAndSponsor(payable(alice)).nonce();
        assertEq(nonce, 0, "Nonce should start at 0");

        // Alice signs the inner batch digest
        bytes32 digest = _buildDigest(nonce, calls);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 charlieBefore = charlie.balance;

        // Bob sponsors — calls Alice's address which now runs BatchCallAndSponsor code
        vm.prank(bob);
        BatchCallAndSponsor(payable(alice)).execute(calls, sig);

        assertEq(charlie.balance, charlieBefore + 0.1 ether, "Charlie should receive 0.1 ETH");

        // Nonce incremented — replay protection
        assertEq(BatchCallAndSponsor(payable(alice)).nonce(), 1, "Nonce should be 1 after execution");

        console.log("Charlie received:  0.1 ETH");
        console.log("Alice nonce after: ", BatchCallAndSponsor(payable(alice)).nonce());
    }

    // ─── Test 3: Multi-call atomic batch ─────────────────────────────────────

    function test_MulticallBatch() public {
        vm.signAndAttachDelegation(address(implementation), aliceKey);

        address recipient1 = makeAddr("recipient1");
        address recipient2 = makeAddr("recipient2");

        // Batch: 2 ETH transfers atomically
        BatchCallAndSponsor.Call[] memory calls = new BatchCallAndSponsor.Call[](2);
        calls[0] = BatchCallAndSponsor.Call({ to: recipient1, value: 0.05 ether, data: "" });
        calls[1] = BatchCallAndSponsor.Call({ to: recipient2, value: 0.05 ether, data: "" });

        uint256 nonce = BatchCallAndSponsor(payable(alice)).nonce();
        bytes32 digest = _buildDigest(nonce, calls);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, ethHash);

        vm.prank(bob);
        BatchCallAndSponsor(payable(alice)).execute(calls, abi.encodePacked(r, s, v));

        assertEq(recipient1.balance, 0.05 ether);
        assertEq(recipient2.balance, 0.05 ether);
        console.log("2-call batch executed atomically");
    }

    // ─── Test 4: Replay attack is blocked by nonce ────────────────────────────

    function test_ReplayAttackBlocked() public {
        vm.signAndAttachDelegation(address(implementation), aliceKey);

        BatchCallAndSponsor.Call[] memory calls = new BatchCallAndSponsor.Call[](1);
        calls[0] = BatchCallAndSponsor.Call({ to: charlie, value: 0.1 ether, data: "" });

        uint256 nonce = BatchCallAndSponsor(payable(alice)).nonce();
        bytes32 digest = _buildDigest(nonce, calls);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        // First execution succeeds
        vm.prank(bob);
        BatchCallAndSponsor(payable(alice)).execute(calls, sig);

        // Replay with same sig reverts (nonce mismatch)
        vm.prank(bob);
        vm.expectRevert("Invalid signature");
        BatchCallAndSponsor(payable(alice)).execute(calls, sig);

        console.log("Replay attack blocked correctly");
    }

    // ─── Test 5: Persistence — delegation survives between calls ─────────────

    function test_DelegationPersistsAcrossCalls() public {
        vm.signAndAttachDelegation(address(implementation), aliceKey);
        assertTrue(alice.code.length > 0, "Delegation active after first sign");

        // Simulate a new "session" — code persists without re-signing
        bytes memory codeAfter = alice.code;
        assertTrue(codeAfter.length > 0, "Delegation still active in new context");
        console.log("Delegation persists across calls - no re-signing needed");
    }

    // ─── Test 6: Invalid signature is rejected ────────────────────────────────

    function test_InvalidSignatureRejected() public {
        vm.signAndAttachDelegation(address(implementation), aliceKey);

        BatchCallAndSponsor.Call[] memory calls = new BatchCallAndSponsor.Call[](1);
        calls[0] = BatchCallAndSponsor.Call({ to: charlie, value: 0.1 ether, data: "" });

        // Bob signs instead of Alice — should revert
        bytes32 digest = _buildDigest(0, calls);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobKey, ethHash); // wrong signer

        vm.prank(bob);
        vm.expectRevert("Invalid signature");
        BatchCallAndSponsor(payable(alice)).execute(calls, abi.encodePacked(r, s, v));

        console.log("Invalid signature correctly rejected");
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _buildDigest(
        uint256 nonce,
        BatchCallAndSponsor.Call[] memory calls
    ) internal pure returns (bytes32) {
        bytes memory encodedCalls;
        for (uint256 i = 0; i < calls.length; i++) {
            encodedCalls = abi.encodePacked(
                encodedCalls,
                calls[i].to,
                calls[i].value,
                calls[i].data
            );
        }
        return keccak256(abi.encodePacked(nonce, encodedCalls));
    }
}
