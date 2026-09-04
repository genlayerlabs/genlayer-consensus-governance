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

export function explorerTx(hash: Hex) {
  return `${deploymentConfig.explorerUrl}/tx/${hash}`
}

export function explorerAddress(address: Address) {
  return `${deploymentConfig.explorerUrl}/address/${address}`
}
