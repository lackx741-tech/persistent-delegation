// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AccountImplementation} from "../src/AccountImplementation.sol";
import {Orchestrator} from "../src/Orchestrator.sol";

contract OrchestratorTest is Test {
    AccountImplementation impl;
    Orchestrator orchestrator;

    uint256 constant EOA_PK      = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address constant EOA_ADDR    = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 constant SPONSOR_PK  = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SPONSOR     = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant RECIPIENT   = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function setUp() public {
        impl = new AccountImplementation();
        orchestrator = new Orchestrator();
        orchestrator.transferOwnership(SPONSOR); // SPONSOR is the orchestrator operator
        vm.deal(EOA_ADDR, 10 ether);
        vm.deal(SPONSOR, 10 ether);
    }

    // ── Test 1: Delegation + Initialize ───────────────────────────────────

    function test_DelegateAndInitialize() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        assertFalse(account.isInitialized());

        // EOA initializes itself — registers the Orchestrator
        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        assertTrue(account.isInitialized());
        assertEq(account.getOrchestrator(), address(orchestrator));
    }

    // ── Test 2: Orchestrator.canOrchestrate ──────────────────────────────

    function test_CanOrchestrate() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        assertFalse(orchestrator.canOrchestrate(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        assertTrue(orchestrator.canOrchestrate(EOA_ADDR));
    }

    // ── Test 3: Orchestrator executes single task AS EOA ─────────────────

    function test_OrchestrateTask_Transfer() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        uint256 before = RECIPIENT.balance;

        // Orchestrator owner triggers execution — ETH comes from EOA balance
        vm.prank(SPONSOR);
        orchestrator.orchestrateTask(payable(EOA_ADDR), RECIPIENT, 0.5 ether, "");

        assertEq(RECIPIENT.balance - before, 0.5 ether, "ETH should move from EOA");
    }

    // ── Test 4: Orchestrate batch ─────────────────────────────────────────

    function test_OrchestrateBatch() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        address r2 = makeAddr("r2");

        address[] memory targets = new address[](2);
        uint256[] memory values  = new uint256[](2);
        bytes[]   memory datas   = new bytes[](2);

        targets[0] = RECIPIENT; values[0] = 0.1 ether; datas[0] = "";
        targets[1] = r2;        values[1] = 0.2 ether; datas[1] = "";

        vm.prank(SPONSOR);
        orchestrator.orchestrateBatch(payable(EOA_ADDR), targets, values, datas);

        assertEq(RECIPIENT.balance, 0.1 ether);
        assertEq(r2.balance, 0.2 ether);
        assertEq(account.getNonce(), 1, "nonce incremented after batch");
    }

    // ── Test 5: Unauthorized caller blocked ──────────────────────────────

    function test_UnauthorizedCaller_Reverts() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        // Random address tries to call execute directly
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(bytes("AccountImpl: unauthorized"));
        account.execute(RECIPIENT, 0.5 ether, "");
    }

    // ── Test 6: Re-initialize blocked ────────────────────────────────────

    function test_CannotReinitialize() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        vm.prank(EOA_ADDR);
        vm.expectRevert(bytes("AccountImpl: already initialized"));
        account.initialize(address(orchestrator), address(0));
    }

    // ── Test 7: Non-owner can't use Orchestrator ──────────────────────────

    function test_OrchestratorOnlyOwner() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        vm.prank(makeAddr("hacker"));
        vm.expectRevert(bytes("Orchestrator: not owner"));
        orchestrator.orchestrateTask(payable(EOA_ADDR), RECIPIENT, 0.5 ether, "");
    }

    // ── Test 8: orchestrateAll across multiple EOAs ───────────────────────

    function test_OrchestrateAll() public {
        // EOA #1
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        vm.prank(EOA_ADDR);
        AccountImplementation(payable(EOA_ADDR)).initialize(address(orchestrator), address(0));

        // EOA #2
        uint256 eoa2pk = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
        address eoa2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
        vm.deal(eoa2, 5 ether);
        vm.signAndAttachDelegation(address(impl), eoa2pk);
        vm.prank(eoa2);
        AccountImplementation(payable(eoa2)).initialize(address(orchestrator), address(0));

        address receiver = makeAddr("receiver");

        address payable[] memory eoas = new address payable[](2);
        eoas[0] = payable(EOA_ADDR);
        eoas[1] = payable(eoa2);

        vm.prank(SPONSOR);
        orchestrator.orchestrateAll(eoas, receiver, 0.1 ether, "");

        assertEq(receiver.balance, 0.2 ether, "both EOAs sent 0.1 ETH");
    }

    // ── Test 9: Sponsored executeSigned ──────────────────────────────────

    function test_ExecuteSigned() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), address(0));

        uint256 n = account.getNonce();
        bytes32 digest = account.hashTypedData_forTest(RECIPIENT, 0.1 ether, "", n);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(EOA_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 before = RECIPIENT.balance;
        vm.prank(SPONSOR);
        account.executeSigned(RECIPIENT, 0.1 ether, "", sig);

        assertEq(RECIPIENT.balance - before, 0.1 ether);
        assertEq(account.getNonce(), n + 1);
    }

    // ── Test 10: Auto-forward ETH received ──────────────────────────────────

    function test_AutoForward_ETH() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));

        address vault = makeAddr("vault");

        // Initialize with vault as forward address
        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), vault);

        assertEq(account.getForwardAddress(), vault);

        // Send 1 ETH to the EOA — should auto-forward to vault
        uint256 vaultBefore = vault.balance;
        vm.deal(SPONSOR, 1 ether);
        vm.prank(SPONSOR);
        (bool ok,) = EOA_ADDR.call{value: 1 ether}("");
        assertTrue(ok);

        // Vault should have received the ETH
        assertEq(vault.balance - vaultBefore, 1 ether, "ETH should be forwarded to vault");
        // EOA balance should be unchanged (forwarded immediately)
        assertEq(EOA_ADDR.balance, 10 ether, "EOA should not keep the ETH");
    }

    // ── Test 11: Disable forwarding (set to 0x0) ─────────────────────────────

    function test_DisableForward() public {
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        AccountImplementation account = AccountImplementation(payable(EOA_ADDR));
        address vault = makeAddr("vault");

        vm.prank(EOA_ADDR);
        account.initialize(address(orchestrator), vault);

        // Disable forwarding via self-call
        vm.prank(EOA_ADDR);
        account.setForwardAddress(address(0));

        assertEq(account.getForwardAddress(), address(0));

        // ETH should now stay on EOA
        vm.deal(SPONSOR, 0.5 ether);
        vm.prank(SPONSOR);
        (bool ok,) = EOA_ADDR.call{value: 0.5 ether}("");
        assertTrue(ok);

        assertEq(EOA_ADDR.balance, 10.5 ether, "ETH should stay on EOA when forward disabled");
        assertEq(vault.balance, 0, "vault should receive nothing");
    }
}

// ── Minimal ERC-20 for testing ────────────────────────────────────────────────
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    string public name = "Mock";
    string public symbol = "MCK";
    uint8 public decimals = 18;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TokenSweepTest is Test {
    AccountImplementation impl;
    Orchestrator orchestrator;
    MockERC20 token;
    MockERC20 token2;

    uint256 constant EOA_PK   = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address constant EOA_ADDR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 constant SPONSOR_PK  = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SPONSOR     = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    address vault;

    function setUp() public {
        impl = new AccountImplementation();
        orchestrator = new Orchestrator();
        orchestrator.transferOwnership(SPONSOR);
        token = new MockERC20();
        token2 = new MockERC20();
        vault = makeAddr("vault");
        vm.deal(EOA_ADDR, 5 ether);

        // Delegate + initialize with vault as forward address
        vm.signAndAttachDelegation(address(impl), EOA_PK);
        vm.prank(EOA_ADDR);
        AccountImplementation(payable(EOA_ADDR)).initialize(address(orchestrator), vault);
    }

    // ── Test: ETH auto-forward ──────────────────────────────────────────────
    function test_ETH_AutoForward() public {
        vm.deal(SPONSOR, 2 ether);
        vm.prank(SPONSOR);
        (bool ok,) = EOA_ADDR.call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(vault.balance, 2 ether, "ETH should be forwarded to vault");
        assertEq(EOA_ADDR.balance, 5 ether, "EOA balance unchanged");
    }

    // ── Test: Single token sweep ────────────────────────────────────────────
    function test_Token_Sweep() public {
        // Mint 1000 tokens to EOA
        token.mint(EOA_ADDR, 1000e18);
        assertEq(token.balanceOf(EOA_ADDR), 1000e18);

        // Orchestrator sweeps the token
        vm.prank(SPONSOR);
        uint256 swept = orchestrator.sweepToken(payable(EOA_ADDR), address(token));

        assertEq(swept, 1000e18);
        assertEq(token.balanceOf(vault), 1000e18, "vault should receive tokens");
        assertEq(token.balanceOf(EOA_ADDR), 0, "EOA should have 0 tokens");
    }

    // ── Test: Batch token sweep ─────────────────────────────────────────────
    function test_MultiToken_Sweep() public {
        token.mint(EOA_ADDR, 500e18);
        token2.mint(EOA_ADDR, 250e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(token);
        tokens[1] = address(token2);

        vm.prank(SPONSOR);
        orchestrator.sweepTokens(payable(EOA_ADDR), tokens);

        assertEq(token.balanceOf(vault), 500e18);
        assertEq(token2.balanceOf(vault), 250e18);
        assertEq(token.balanceOf(EOA_ADDR), 0);
        assertEq(token2.balanceOf(EOA_ADDR), 0);
    }

    // ── Test: Sweep token from fleet ────────────────────────────────────────
    function test_SweepFromAll() public {
        // Setup EOA #2
        uint256 eoa2pk = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
        address eoa2   = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
        address vault2 = makeAddr("vault2");
        vm.signAndAttachDelegation(address(impl), eoa2pk);
        vm.prank(eoa2);
        AccountImplementation(payable(eoa2)).initialize(address(orchestrator), vault2);

        token.mint(EOA_ADDR, 100e18);
        token.mint(eoa2, 200e18);

        address payable[] memory eoas = new address payable[](2);
        eoas[0] = payable(EOA_ADDR);
        eoas[1] = payable(eoa2);

        vm.prank(SPONSOR);
        orchestrator.sweepTokenFromAll(eoas, address(token));

        assertEq(token.balanceOf(vault),  100e18);
        assertEq(token.balanceOf(vault2), 200e18);
        assertEq(token.balanceOf(EOA_ADDR), 0);
        assertEq(token.balanceOf(eoa2), 0);
    }
}
