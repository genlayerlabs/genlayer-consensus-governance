import { createPublicClient, http } from 'viem'
import { genlayerTestnet } from './chain'

export const publicClient = createPublicClient({
  chain: genlayerTestnet,
  transport: http(genlayerTestnet.rpcUrls.default.http[0], { retryCount: 2, retryDelay: 2_000 }),
  batch: { multicall: true },
})
