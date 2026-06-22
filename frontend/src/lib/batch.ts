import {
  encodeFunctionData,
  encodePacked,
  keccak256,
  toBytes,
  type Address,
  type WalletClient,
  type PublicClient,
} from 'viem'

export interface Call {
  to: Address
  value: bigint
  data: `0x${string}`
}

// ─────────────────────────────────────────────────────────────────────────────
// BatchCallAndSponsor ABI  (original — eth_sign path)
// ─────────────────────────────────────────────────────────────────────────────
export const BATCH_ABI = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getNonce',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'BatchExecuted',
    inputs: [
      { name: 'nonce', type: 'uint256', indexed: true },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
        indexed: false,
      },
    ],
  },
] as const

/**
 * Fetches the current nonce from the EOA's storage.
 * Since delegation is persistent, the nonce accumulates across all sessions.
 */
export async function fetchNonce(
  eoaAddress: Address,
  publicClient: PublicClient
): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: eoaAddress,
    abi: BATCH_ABI,
    functionName: 'getNonce',
  })
  return nonce
}

/**
 * Builds the inner digest for batch signing.
 * The EOA signs this to authorize the specific batch at the current nonce.
 */
export function buildBatchDigest(nonce: bigint, calls: Call[]): `0x${string}` {
  let encodedCalls = '0x' as `0x${string}`
  for (const call of calls) {
    encodedCalls = encodePacked(
      ['bytes', 'address', 'uint256', 'bytes'],
      [encodedCalls, call.to, call.value, call.data]
    )
  }
  return keccak256(encodePacked(['uint256', 'bytes'], [nonce, encodedCalls]))
}

/**
 * Signs the batch digest with the EOA's key.
 * This is the inner-signature that authorizes THIS specific batch.
 * (Separate from the EIP-7702 authorization which is persistent.)
 */
export async function signBatch(
  walletClient: WalletClient,
  account: Address,
  nonce: bigint,
  calls: Call[]
): Promise<`0x${string}`> {
  const digest = buildBatchDigest(nonce, calls)
  const signature = await walletClient.signMessage({
    account,
    message: { raw: toBytes(digest) },
  })
  return signature
}

/**
 * Executes a sponsored batch transaction.
 * The sponsorClient pays for gas. The EOA only signs the inner payload.
 *
 * Because delegation is persistent, NO authorizationList is needed here —
 * the delegation code is already on-chain from the setup step.
 */
export async function executeSponsoredBatch(
  sponsorClient: WalletClient,
  eoaAddress: Address,
  calls: Call[],
  innerSignature: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await sponsorClient.writeContract({
    abi: BATCH_ABI,
    address: eoaAddress,       // call INTO the EOA — it now has smart account code
    functionName: 'execute',
    args: [calls, innerSignature],
    // No authorizationList needed — delegation already persists on-chain
    account: sponsorClient.account!,
    chain: null,               // let wagmi/viem infer
  })
  return hash
}

/**
 * Helper: build an ERC-20 transfer call
 */
export function buildERC20Transfer(
  tokenAddress: Address,
  recipient: Address,
  amount: bigint
): Call {
  return {
    to: tokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          name: 'transfer',
          type: 'function',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'bool' }],
          stateMutability: 'nonpayable',
        },
      ] as const,
      functionName: 'transfer',
      args: [recipient, amount],
    }),
  }
}

/**
 * Helper: build a plain ETH transfer call
 */
export function buildETHTransfer(recipient: Address, amount: bigint): Call {
  return {
    to: recipient,
    value: amount,
    data: '0x',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartEOA ABI  (Solady-based — executeSigned uses EIP-712)
// ─────────────────────────────────────────────────────────────────────────────
export const SMART_EOA_ABI = [
  {
    type: 'function',
    name: 'executeSigned',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'hashBatch',
    inputs: [
      { name: '_nonce', type: 'uint256' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNonce',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'delegatedTo',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isValidSignature',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'SmartBatchExecuted',
    inputs: [
      { name: 'nonce', type: 'uint256', indexed: true },
      { name: 'executor', type: 'address', indexed: true },
      { name: 'callCount', type: 'uint256', indexed: false },
    ],
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// EIP-712 domain + types for SmartEOA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the EIP-712 typed-data payload for a SmartEOA batch.
 *
 * WalletConnect / MetaMask will display the structured data to the user:
 *   "Sign BatchExecute: nonce=0, send 0.1 ETH to 0xABC..."
 * instead of a raw hex hash — much better UX and phishing-resistant.
 *
 * @param eoaAddress  The delegated EOA address (acts as verifying contract)
 * @param chainId     Chain ID (31337 for Anvil)
 * @param nonce       Current replay-protection nonce from EOA storage
 * @param calls       The batch of calls to sign
 */
export function buildEIP712Payload(
  eoaAddress: Address,
  chainId: number,
  nonce: bigint,
  calls: Call[]
) {
  return {
    domain: {
      name: 'SmartEOA',
      version: '1',
      chainId,
      verifyingContract: eoaAddress,  // EOA is the verifying contract (delegatecall)
    },
    types: {
      BatchExecute: [
        { name: 'nonce',  type: 'uint256' },
        { name: 'calls',  type: 'Call[]'  },
      ],
      Call: [
        { name: 'to',    type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data',  type: 'bytes'   },
      ],
    },
    primaryType: 'BatchExecute' as const,
    message: {
      nonce,
      calls: calls.map(c => ({ to: c.to, value: c.value, data: c.data })),
    },
  }
}

/**
 * Sign a SmartEOA batch using EIP-712 typed data.
 *
 * HOW IT WORKS WITH WALLETCONNECT:
 * 1. User connects wallet (MetaMask, WalletConnect, etc.)
 * 2. App calls `walletClient.signTypedData(...)` — this is a standard eth_signTypedData_v4
 * 3. MetaMask/WalletConnect shows structured data popup:
 *      ┌──────────────────────────────┐
 *      │  SmartEOA (Anvil Local)      │
 *      │  BatchExecute                │
 *      │  nonce: 0                    │
 *      │  calls[0]:                   │
 *      │    to: 0xRecipient...        │
 *      │    value: 100000000000000000 │
 *      │    data: 0x                  │
 *      └──────────────────────────────┘
 * 4. User approves → signature returned
 * 5. Relayer submits `executeSigned(calls, signature)` — pays gas
 *
 * NOTE: signAuthorization (delegation setup) still requires a local key
 * because EIP-7702 is a new tx type not yet in MetaMask stable.
 * The batch signing (this function) works with ANY wallet.
 */
export async function signSmartBatch(
  walletClient: WalletClient,
  account: Address,
  eoaAddress: Address,
  chainId: number,
  nonce: bigint,
  calls: Call[]
): Promise<`0x${string}`> {
  const payload = buildEIP712Payload(eoaAddress, chainId, nonce, calls)
  const signature = await walletClient.signTypedData({
    account,
    ...payload,
  })
  return signature
}

/**
 * Execute a SmartEOA batch via the relayer (sponsor pays gas).
 * Uses `executeSigned` — the Solady EIP-712 sponsored path.
 */
export async function executeSmartBatch(
  sponsorClient: WalletClient,
  eoaAddress: Address,
  calls: Call[],
  signature: `0x${string}`
): Promise<`0x${string}`> {
  const hash = await sponsorClient.writeContract({
    abi: SMART_EOA_ABI,
    address: eoaAddress,          // Call INTO the EOA — delegatecall dispatches to SmartEOA
    functionName: 'executeSigned',
    args: [calls, signature],
    account: sponsorClient.account!,
    chain: null,
  })
  return hash
}
