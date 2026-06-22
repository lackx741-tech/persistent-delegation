# Persistent Delegation — EIP-7702 Smart Account

**Hackathon:** MetaMask Smart Accounts Kit × 1Shot API  
**Track:** EIP-7702 Advanced Permissions · Gasless Relayer · On-Chain Orchestrator  

---

## What It Does

An EOA permanently gains smart account capabilities — batch execution, sponsored transactions, auto-forwarding, and autonomous orchestration — **without changing its address, migrating assets, or deploying a new wallet**.

One delegation tx. Everything else is automatic.

---

## Smart Contracts (Solady-based)

| Contract | Address (Anvil) | Purpose |
|---|---|---|
| `BatchCallAndSponsor.sol` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Original delegation target (OZ, eth_sign) |
| `SmartEOA.sol` | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` | Solady ERC7821 + EIP-712 + ERC-1271 |
| `AccountImplementation.sol` | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` | Production: namespaced storage, Orchestrator auth, auto-forward |
| `Orchestrator.sol` | `0x0165878A594ca255338adfa4d48449f69242Eb8F` | On-chain operator — acts as any delegated EOA |

### AccountImplementation.sol — Key Features
- **Namespaced storage slots** — `keccak256("eip7702.account.*")` — no collisions with EOA state
- **`onlySelfOrOrchestrator`** — only EOA or registered Orchestrator can execute
- **`initialize(orchestrator, forwardTo)`** — one-time setup, registers Orchestrator + vault
- **`execute / executeBatch`** — Orchestrator triggers calls; target sees `msg.sender = EOA`
- **`executeSigned`** — EIP-712 sponsored path; any relayer submits, EOA signs off-chain
- **Auto-forward ETH** — `receive()` instantly pushes incoming ETH to vault address
- **`sweepToken(token)`** — sweep full ERC-20 balance to vault
- **`sweepTokens(tokens[])`** — batch sweep multiple tokens
- **`setForwardAddress(addr)`** — update/disable vault at any time (self-call only)

### Orchestrator.sol — Key Features
- `orchestrateTask(eoa, target, value, data)` — single call AS the EOA
- `orchestrateBatch(eoa, targets[], values[], datas[])` — batch AS the EOA  
- `orchestrateAll(eoas[], target, value, data)` — fleet execution
- `sweepToken(eoa, token)` — trigger token sweep for one EOA
- `sweepTokens(eoa, tokens[])` — batch token sweep
- `sweepTokenFromAll(eoas[], token)` — fleet token sweep

---

## Execution Flow

```
① Delegation (one-time)
   EOA signs EIP-7702 authorization → AccountImplementation
   Sponsor submits tx → EOA's code = 0xef0100 || impl_address
   EOA calls initialize(orchestratorAddr, vaultAddr)

② Orchestrator executes AS EOA
   Orchestrator.orchestrateTask(eoa, target, value, data)
     → eoa.execute(target, value, data)    ← delegatecall
         → target.call{value}(data)        ← msg.sender = EOA ✅
   Target sees: msg.sender = EOA, ETH from EOA balance

③ Auto-forward ETH (automatic)
   Anyone sends ETH to EOA
     → receive() fires instantly
     → ETH forwarded to vault
     → EOA never accumulates ETH

④ Token sweep (on-demand or scheduled)
   Orchestrator.sweepToken(eoa, token)
     → eoa.sweepToken(token)              ← delegatecall
         → token.transfer(vault, balance) ← transfers EOA's tokens
   Works for any ERC-20; sweepTokenFromAll handles a fleet

⑤ Revoke (any time)
   Sign authorization with zero address → EOA returns to plain EOA
   All storage (nonce, forward addr) stays — can re-delegate anytime
```

---

## Auto-Sweeper

Toggle-based UI that:
- **ON** — enables periodic token sweep via Orchestrator (every 60s interval)
- **OFF** — disables scheduled sweeping (manual only)
- Configure token list and vault address
- "Sweep Now" button for instant manual sweep
- Telegram alert fired on every sweep

---

## CDN Widget — Drop-in SaaS Integration

A self-contained embeddable script any SaaS can drop into their site with a **single `<script>` tag**.

**Build:** Vite library mode → IIFE bundle (`widget/dist/delegation-widget.iife.js`)  
**Size:** 35KB raw · **9.18KB gzip**  
**Dependencies:** Zero — pure DOM, Shadow DOM, vanilla TS

### Integration (1 line)

```html
<script src="https://cdn.yourapp.com/delegation-widget.iife.js"
        data-relayer="https://your-relayer.com"
        data-chain="MAINNET"></script>
```

### Programmatic Init

```js
window.DelegationWidget.init({
  relayerUrl: 'https://your-relayer.com',
  position:   'bottom-right',
  chainName:  'MAINNET',
})
```

### Widget Features

| Feature | Detail |
|---|---|
| Shadow DOM | Full CSS isolation — zero leakage into host page |
| Wallet Connect | Any EIP-1193 provider (MetaMask, WalletConnect, Coinbase) |
| Delegation Status | Live EIP-7702 code check (`0xef0100` prefix detection) |
| Batch Execute | Add/remove calls, sponsored relay via relayer |
| Auto-Sweep | ON/OFF toggle, vault config, token list, run-count stats |
| DeBank Link | One-click portfolio deep-link for any wallet |
| Relayer Health | Live status indicator with block number + sponsor balance |
| Toast Notifications | Non-intrusive tx confirmations with hash display |
| Responsive | Works on mobile, adjusts panel to viewport |

### Custom Events (emitted on `window`)

```js
window.addEventListener('delegation:connected', e => console.log(e.detail.address))
window.addEventListener('delegation:delegated', e => console.log(e.detail.txHash))
window.addEventListener('delegation:swept',     e => console.log(e.detail.tokens))
```

### Widget File Structure

```
widget/
├── src/
│   ├── index.ts     ← IIFE entry, reads data-* attrs, auto-init
│   ├── widget.ts    ← Core class: Shadow DOM, state, render, events
│   ├── styles.ts    ← 15KB injected CSS (circuit-board terminal aesthetic)
│   ├── eth.ts       ← window.ethereum helpers (accounts, chainId, EIP-7702 code check)
│   └── api.ts       ← Relayer REST client (health, delegate, batch, sweep)
├── dist/
│   └── delegation-widget.iife.js  ← The CDN artifact
└── demo/
    └── index.html  ← Full SaaS showcase page
```

**Screenshots:**
- `assets/widget-demo.png` — SaaS showcase landing page  
- `assets/eip7702-diagram.png` — EIP-7702 call-chain architecture diagram

---

## Architecture Diagram

See `assets/eip7702-diagram.html` — animated interactive diagram showing:

```
[USER]
  │ signs EIP-7702 authorization
  ▼
[EOA] ←── code = 0xef0100||impl ──→ [AccountImplementation]
  │                                        │
  │ delegatecall                           │ namespaced storage
  │                                        │ onlySelfOrOrchestrator
  ▼                                        │
[Orchestrator]                             │
  │ orchestrateTask(eoa, target, ...)      │
  │                                        │
  └──→ eoa.execute(target, value, data) ──►│
         delegatecall context:             │
           address(this) = EOA             │
           msg.sender = Orchestrator       │
         ▼                                 │
       [TARGET CONTRACT]                   │
         msg.sender = EOA ✅              │
         ETH from EOA balance ✅          │
```

---

## Telegram Bot

- **Bot:** `@YourDelegationBot`
- **Commands:** `/start`, `/status`, `/delegate`, `/sweep`, `/balance`, `/debank`
- **Inline keyboards** on every alert with DeBank deep-link buttons
- **Alerts:** delegation events, sweep completions, relayer health
- **Auto-polling** — no webhook needed

---

## Stack

| Layer | Tech |
|---|---|
| Smart Contracts | Solidity 0.8.28, Solady v0.1.26, Foundry/Anvil |
| Frontend | React 18, TypeScript, Viem v2, AppKit (WalletConnect) |
| Relayer | Node.js, Express, Viem v2, SQLite (better-sqlite3) |
| Notifications | Telegram Bot API (inline keyboards, edit-in-place) |
| Portfolio | DeBank links on all EOA addresses |
| 1Shot API | Gasless fallback relayer (EIP-7710 paymaster) |

---

## Test Results

```
Ran 5 test suites — 33 tests passed, 0 failed

AccountImplementation / Orchestrator  11 pass
  ✅ Delegation + Initialize
  ✅ orchestrateTask / Batch / All
  ✅ Auto-forward ETH
  ✅ Disable forwarding
  ✅ Token sweep (single, batch, fleet)

SmartEOA (Solady ERC7821)             10 pass
  ✅ Delegation, EIP-712 signing
  ✅ ERC-1271 isValidSignature
  ✅ Nonce replay protection
  ✅ delegatedTo() introspection

BatchCallAndSponsor (original)         6 pass
  ✅ Batch execution
  ✅ Sponsored tx
  ✅ Replay attack blocked

Token sweep (MockERC20)                4 pass (inside Orchestrator suite)
  ✅ ETH auto-forward
  ✅ Single token sweep
  ✅ Multi-token batch sweep
  ✅ Fleet sweep (sweepTokenFromAll)
```

---

## Running Locally

```bash
# 1. Start Anvil (Prague hardfork)
cd contracts && anvil --hardfork prague --host 0.0.0.0

# 2. Deploy contracts
forge create src/AccountImplementation.sol:AccountImplementation --private-key $SPONSOR_KEY --broadcast
forge create src/Orchestrator.sol:Orchestrator --private-key $SPONSOR_KEY --broadcast

# 3. Start relayer
cd relayer && npm run dev

# 4. Start frontend
cd frontend && npm run dev

# 5. Run E2E tests
npx ts-node --project relayer/tsconfig.json scripts/test-flow.ts

# 6. Build CDN widget
cd widget && npm run build
# → dist/delegation-widget.iife.js  (9.18KB gzip)

# 7. Open widget demo
open widget/demo/index.html
```

---

## Project Assets

| File | Description |
|---|---|
| `assets/widget-demo.png` | SaaS CDN widget showcase page screenshot |
| `assets/eip7702-diagram.png` | EIP-7702 call-chain architecture diagram screenshot |
| `assets/widget-demo.html` | Widget demo HTML (self-contained) |
| `assets/eip7702-diagram.html` | Interactive animated architecture diagram |
| `widget/dist/delegation-widget.iife.js` | CDN artifact — 35KB (9.18KB gzip) |
| `Project.md` | This document |

---

## Hackathon Qualification

| Requirement | Status |
|---|---|
| MetaMask Smart Accounts or Advanced Permissions | ✅ EIP-7702 delegation via MetaMask Smart Accounts Kit |
| Working integration in main flow | ✅ EOA delegation is the core flow |
| ERC-7715 or EIP-7702 | ✅ EIP-7702 with `signAuthorization` |
| Signer-agnostic | ✅ Works with MetaMask, WalletConnect, any EIP-1193 |
| Demo video ready | ✅ All flows tested E2E on Anvil |
| 1Shot API | ✅ Gasless relayer integration |
| Venice AI | ✅ (optional track) |
