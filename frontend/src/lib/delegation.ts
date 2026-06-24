import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type WalletClient,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil, IMPLEMENTATION_ADDRESS, SPONSOR_PRIVATE_KEY } from './config'

// EIP-7702 delegation prefix — set by the protocol when code is delegated
const DELEGATION_PREFIX = '0xef0100'

export type DelegationStatus =
  | { active: false }
  | { active: true; implementation: Address }

/**
 * Checks whether an EOA has an active persistent EIP-7702 delegation.
 * The delegation is stored on-chain as the account's "code" with prefix 0xef0100.
 */
export async function checkDelegation(
  address: Address,
  publicClient: PublicClient
): Promise<DelegationStatus> {
  const code = await publicClient.getCode({ address })

  if (!code || code === '0x') return { active: false }

  if (code.startsWith(DELEGATION_PREFIX)) {
    // Last 20 bytes of the code are the delegated contract address
    const implementation = `0x${code.slice(-40)}` as Address
    return { active: true, implementation }
  }

  return { active: false }
}

/**
 * Signs an EIP-7702 authorization for persistent delegation.
 *
 * Per the canonical viem pattern:
 *   walletClient.signAuthorization({ account: eoa, contractAddress: impl })
 *
 * The authorization is protocol-level — it allows the implementation contract's
 * code to run in the EOA's context (delegatecall). It persists on-chain until
 * explicitly revoked with a zero-address authorization.
 *
 * NOTE: signAuthorization requires a LOCAL viem account (privateKeyToAccount).
 * JSON-RPC accounts (MetaMask, WalletConnect) cannot sign EIP-7702 authorizations
 * via viem — the inner batch signing (signBatch) does work with any wallet.
 */
export async function signDelegationAuthorization(localWalletClient: WalletClient) {
  const account = localWalletClient.account!
  const authorization = await localWalletClient.signAuthorization({
    account,
    contractAddress: IMPLEMENTATION_ADDRESS,
  })
  return authorization
}

/**
 * Submits the EIP-7702 authorization on-chain.
 * After this tx confirms, the EOA permanently acts as a smart account
 * (until revoked) — delegation survives browser closes, disconnects, etc.
 */
export async function submitDelegation(
  sponsorClient: WalletClient,
  userAddress: Address,
  authorization: Awaited<ReturnType<typeof signDelegationAuthorization>>
) {
  const hash = await sponsorClient.sendTransaction({
    account: sponsorClient.account!,
    to: userAddress,
    value: 0n,
    authorizationList: [authorization],
    chain: anvil,
  })
  return hash
}

/**
 * Revokes persistent delegation by setting implementation to zero address.
 * After this tx the EOA returns to plain EOA behavior.
 */
export async function revokeDelegation(localWalletClient: WalletClient) {
  const account = localWalletClient.account!
  const revokeAuth = await localWalletClient.signAuthorization({
    account,
    contractAddress: '0x0000000000000000000000000000000000000000',
  })
  const hash = await localWalletClient.sendTransaction({
    account,
    to: account.address,
    value: 0n,
    authorizationList: [revokeAuth],
    chain: anvil,
  })
  return hash
}

export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: anvil,
    transport: http('http://127.0.0.1:8545'),
  }) as PublicClient
}

/** Sponsor wallet client using Anvil Account #0 (pre-funded with 10000 ETH) */
export function getSponsorClient(): WalletClient {
  const sponsor = privateKeyToAccount(SPONSOR_PRIVATE_KEY)
  return createWalletClient({
    account: sponsor,
    chain: anvil,
    transport: http('http://127.0.0.1:8545'),
  })
}

/** Create a local wallet client from a raw private key (for Anvil test accounts) */
export function getLocalWalletClient(privateKey: `0x${string}`): WalletClient {
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({
    account,
    chain: anvil,
    transport: http('http://127.0.0.1:8545'),
  })
}
