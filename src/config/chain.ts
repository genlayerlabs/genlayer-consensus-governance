import { defineChain } from 'viem'

export const deploymentConfig = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID ?? 4221),
  chainName: import.meta.env.VITE_CHAIN_NAME ?? 'GenLayer Testnet',
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://zksync-os-testnet-genlayer.zksync.dev',
  explorerUrl: import.meta.env.VITE_EXPLORER_URL ?? 'https://explorer.testnet-chain.genlayer.com',
  addressManager: import.meta.env.VITE_ADDRESS_MANAGER ?? '',
  deploymentStartBlock: BigInt(import.meta.env.VITE_DEPLOYMENT_START_BLOCK ?? '0'),
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
