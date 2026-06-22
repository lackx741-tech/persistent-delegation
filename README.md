# Persistent Delegation App

EIP-7702 persistent smart account with WalletConnect + batch execution.

## Architecture

```
User connects via WalletConnect (Reown AppKit)
        ↓
checkDelegation() — reads on-chain code at EOA address
        ↓
If no delegation:
  signAuthorization() → submitDelegation() → persists on-chain forever
        ↓
Delegation active (survives disconnects/browser restarts)
        ↓
User builds batch calls in UI
        ↓
fetchNonce() → signBatch() → executeSponsoredBatch()
        ↓
EOA's code (delegatecall → BatchCallAndSponsor) executes atomically
```

## Key Concepts

| Feature | How |
|---------|-----|
| Persistent delegation | EIP-7702 sets code on EOA — stays until revoked |
| Batch execution | `delegatecall` to `BatchCallAndSponsor` |
| Replay protection | Nonce stored in EOA's own storage |
| Same address | EOA never changes address |
| Reversible | Set implementation to `0x0` to revoke |

## Setup

### 1. Deploy the contract (Sepolia)

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
forge build
forge create src/BatchCallAndSponsor.sol:BatchCallAndSponsor \
  --rpc-url $SEPOLIA_RPC \
  --private-key $DEPLOYER_KEY
```

Copy the deployed address.

### 2. Configure frontend

Edit `frontend/src/lib/config.ts`:
```ts
export const WALLETCONNECT_PROJECT_ID = 'your-id-from-cloud.reown.com'
export const IMPLEMENTATION_ADDRESS = '0xYourDeployedContract'
```

### 3. Run frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Production — Add 1Shot gasless relayer

In `BatchExecutor.tsx`, replace the `sponsorClient` with a 1Shot API call:
```ts
// POST to https://relay.1shotapi.com/relay
// with { to: eoaAddress, data: encodedExecute, authorizationList: [] }
// (delegation already persists — no authorizationList needed after setup)
```

## File Structure

```
contracts/
  src/BatchCallAndSponsor.sol   # EIP-7702 delegation contract
  foundry.toml                  # Prague hardfork required

frontend/src/
  lib/
    config.ts       # WalletConnect + chain config
    delegation.ts   # check / sign / submit / revoke delegation
    batch.ts        # build / sign / execute batch calls
  components/
    DelegationStatus.tsx  # Shows delegation state, activate/revoke
    BatchExecutor.tsx     # Build and execute batch transactions
  App.tsx           # Root — wires everything together
```
