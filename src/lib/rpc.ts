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
  let from = floor
  let chunk = params.initialChunk ?? 50_000n
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
      if (chunk < 100_000n) chunk *= 2n
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
