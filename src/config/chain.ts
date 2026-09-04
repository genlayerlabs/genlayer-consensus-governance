import { defineChain } from 'viem'

export const deploymentConfig = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID ?? 4221),
  chainName: import.meta.env.VITE_CHAIN_NAME ?? 'GenLayer Testnet',
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://zksync-os-testnet-genlayer.zksync.dev',
  explorerUrl: import.meta.env.VITE_EXPLORER_URL ?? 'https://explorer.testnet-chain.genlayer.com',
  // Fallback only. ContractsContext reads localStorage FIRST, so this is used
  // exactly when a visitor has never chosen an AddressManager — landing on a
  // working deployment beats landing on an empty "select a deployment" state.
  // Anything the user picks in the UI wins and persists.
  addressManager: import.meta.env.VITE_ADDRESS_MANAGER ?? '0x7236fce812f4f7bC0d2e48E3dd18d1106BC42414',
  deploymentStartBlock: BigInt(import.meta.env.VITE_DEPLOYMENT_START_BLOCK ?? '0'),
  // Largest eth_getLogs window the RPC accepts. The GenLayer testnet node
  // rejects anything wider with
  //   {"code":-32602,"message":"query exceeds max block range 10000"}
  // so EVERY getLogs call must be paged at or below this. Override per
  // endpoint with VITE_MAX_BLOCK_RANGE.
  maxBlockRange: BigInt(import.meta.env.VITE_MAX_BLOCK_RANGE ?? '10000'),
} as const

export const genlayerTestnet = defineChain({
  id: deploymentConfig.chainId,
  name: deploymentConfig.chainName,
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: { default: { http: [deploymentConfig.rpcUrl] } },
  blockExplorers: {
    default: { name: 'GenLayer Explorer', url: deploymentConfig.explorerUrl },
  },
})
