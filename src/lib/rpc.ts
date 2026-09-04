import type { Abi, Address, BlockNumber, ContractEventName, GetLogsParameters, Hex } from 'viem'
import { publicClient } from '@/config/clients'
import { deploymentConfig } from '@/config/chain'

export interface ScanProgress { from: bigint; to: bigint; head: bigint; requests: number }

export async function scanLogs(params: {
  address: Address
  abi: Abi
  eventName: ContractEventName<Abi>
  args?: Record<string, unknown>
  fromBlock?: bigint
  toBlock?: bigint
  initialChunk?: bigint
  onProgress?: (progress: ScanProgress) => void
  onPage?: (logs: any[]) => void
}) {
  const head = params.toBlock ?? await publicClient.getBlockNumber()
  const floor = params.fromBlock ?? 0n
  const maxChunk = deploymentConfig.maxBlockRange
  let from = floor
  // Start AT the cap, never above it: the previous 50k default spent three
  // failed requests backing off to a legal width on every scan.
  let chunk = params.initialChunk && params.initialChunk < maxChunk ? params.initialChunk : maxChunk
  let requests = 0
  const logs: any[] = []
  while (from <= head) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n
    try {
      const page = await publicClient.getLogs({
        address: params.address,
        event: (params.abi as any).find((entry: any) => entry.type === 'event' && entry.name === params.eventName),
        args: params.args,
        fromBlock: from as BlockNumber,
        toBlock: to as BlockNumber,
      } as GetLogsParameters)
      logs.push(...page)
      params.onPage?.(page)
      from = to + 1n
      requests += 1
      // Grow back after a backoff, but never past the RPC's ceiling —
      // unclamped doubling re-failed every other page.
      if (chunk < maxChunk) chunk = chunk * 2n > maxChunk ? maxChunk : chunk * 2n
      params.onProgress?.({ from, to, head, requests })
    } catch (error) {
      if (chunk <= 500n) throw error
      chunk /= 2n
    }
  }
  return logs
}

/**
 * Newest-first hunt for a single event, for metadata that must not block a
 * render (a proposal's creation transaction, say).
 *
 * scanLogs walks FORWARD from `fromBlock`, which is genesis whenever
 * VITE_DEPLOYMENT_START_BLOCK is unset — on a chain 20M blocks deep that is
 * ~2,000 sequential capped requests before the caller sees anything. A recent
 * proposal is found here in one request instead.
 *
 * Best-effort by contract: returns undefined rather than throwing when the
 * event is outside the searched window, so the page renders without the
 * decoration.
 */
export async function findLatestLogBackwards(params: {
  address: Address
  abi: Abi
  eventName: ContractEventName<Abi>
  args?: Record<string, unknown>
  floor?: bigint
  maxPages?: number
}): Promise<any | undefined> {
  const chunk = deploymentConfig.maxBlockRange
  const maxPages = params.maxPages ?? 24
  const floor = params.floor ?? 0n
  let to = await publicClient.getBlockNumber()
  for (let page = 0; page < maxPages && to >= floor; page++) {
    const from = to >= chunk - 1n && to - chunk + 1n > floor ? to - chunk + 1n : floor
    try {
      const logs = await publicClient.getLogs({
        address: params.address,
        event: (params.abi as any).find((entry: any) => entry.type === 'event' && entry.name === params.eventName),
        args: params.args,
        fromBlock: from as BlockNumber,
        toBlock: to as BlockNumber,
      } as GetLogsParameters)
      if (logs.length > 0) return logs.at(-1)
    } catch { return undefined }
    if (from === floor) break
    to = from - 1n
  }
  return undefined
}

export function explorerTx(hash: Hex) {
  return `${deploymentConfig.explorerUrl}/tx/${hash}`
}

export function explorerAddress(address: Address) {
  return `${deploymentConfig.explorerUrl}/address/${address}`
}
