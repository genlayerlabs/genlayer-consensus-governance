import type { Address } from 'viem'
import { deploymentConfig } from '@/config/chain'
import { publicClient } from '@/config/clients'

const KEY = 'genlayer-governance-deploy-block'
const memory = new Map<string, bigint>()

function stored(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

/**
 * The block a contract was created in, found by binary search on eth_getCode.
 *
 * Every log scanner needs a floor. Without one it starts at
 * VITE_DEPLOYMENT_START_BLOCK, which is 0 by design — a floor above another
 * deployment's history would silently hide it — and on a 20.6M-block chain
 * that is ~2,060 capped requests before anything renders, which is what the
 * council action log was doing.
 *
 * A contract's code is absent before its creation and present after, so ~25
 * eth_getCode calls pin the exact block. Exact matters: a guessed floor can
 * hide logs, and this cannot, because nothing existed to emit them below it.
 * The answer is immutable, so it is cached permanently per address and never
 * re-derived.
 *
 * Falls back to the configured floor if the search fails — a slow scan beats
 * a wrong one.
 */
export async function contractCreationBlock(address: Address): Promise<bigint> {
  const key = address.toLowerCase()
  const hit = memory.get(key)
  if (hit !== undefined) return hit
  const cached = stored()[key]
  if (cached !== undefined) { memory.set(key, BigInt(cached)); return BigInt(cached) }

  try {
    const head = await publicClient.getBlockNumber()
    const hasCode = async (blockNumber: bigint) => {
      const code = await publicClient.getCode({ address, blockNumber })
      return Boolean(code && code !== '0x')
    }
    if (!(await hasCode(head))) return deploymentConfig.deploymentStartBlock

    let low = deploymentConfig.deploymentStartBlock
    let high = head
    // Invariant: no code at `low`, code at `high`. If the floor already has
    // code the contract predates it and the floor is the best answer we have.
    if (await hasCode(low)) return low
    while (high - low > 1n) {
      const mid = (low + high) / 2n
      if (await hasCode(mid)) high = mid
      else low = mid
    }
    memory.set(key, high)
    try { localStorage.setItem(KEY, JSON.stringify({ ...stored(), [key]: high.toString() })) } catch { /* private mode */ }
    return high
  } catch {
    return deploymentConfig.deploymentStartBlock
  }
}
