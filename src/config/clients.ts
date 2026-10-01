import { createPublicClient, http } from 'viem'
import { genlayerTestnet } from './chain'
import { MULTICALL_BATCH, RPC_TIMEOUT_MS, rpcFetch } from './rpcFetch'

export const publicClient = createPublicClient({
  chain: genlayerTestnet,
  transport: http(genlayerTestnet.rpcUrls.default.http[0], {
    fetchFn: rpcFetch,
    timeout: RPC_TIMEOUT_MS,
    retryCount: 2,
    retryDelay: 2_000,
  }),
  batch: { multicall: MULTICALL_BATCH },
})
