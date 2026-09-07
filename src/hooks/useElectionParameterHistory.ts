import { useCallback, useState } from 'react'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { contractCreationBlock } from '@/lib/deploymentBlock'
import { cacheableHead, readCache, writeCache } from '@/lib/logCache'
import { blockTimestamp, scanLogs } from '@/lib/rpc'
import type { ElectionParameterChange } from '@/lib/types'

/** The §8 setters that emit since CON-864; a name missing from the vendored ABI is skipped, never thrown. */
export const ELECTION_SETTER_EVENTS = ['ElectionEconomicsSet', 'ElectionPeriodsSet', 'ElectionQuorumsSet', 'TermLengthSet', 'SlateParametersSet', 'RecallParametersSet', 'RatifyGraceSet']

const stringify = (value: unknown) => typeof value === 'bigint' ? value.toString() : String(value)

/**
 * Every parameter change the contract has emitted, oldest first.
 *
 * Before CON-864 the setters emitted nothing, so a past value was gone the
 * moment it changed; this is the history that now exists. Lazy: the scan
 * runs when the panel is opened, from the contract's creation block, with
 * the same progress / partial / retry surface as the voters list. Events are
 * append-only, so the scanned range is remembered.
 */
export function useElectionParameterHistory() {
  const { currentSet } = useContracts()
  const [changes, setChanges] = useState<ElectionParameterChange[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string>()
  const [partial, setPartial] = useState(false)
  const [scanned, setScanned] = useState(false)

  const scan = useCallback(async () => {
    const address = currentSet?.elections
    if (!address) return
    setLoading(true); setError(undefined); setPartial(false)
    const abi = GovernanceCouncilElectionsABI as any[]
    const events = ELECTION_SETTER_EVENTS.filter((name) => abi.some((entry) => entry.type === 'event' && entry.name === name))
    const cached = readCache<ElectionParameterChange>('election-params', address, 'all', (raw) => ({ ...raw, blockNumber: BigInt(raw.blockNumber), timestamp: raw.timestamp ? BigInt(raw.timestamp) : undefined }))
    const seen = new Map<string, ElectionParameterChange>()
    const publish = () => setChanges([...seen.values()].sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? 1 : -1)))
    for (const record of cached?.records ?? []) seen.set(`${record.transactionHash}:${record.event}:${record.blockNumber}`, record)
    publish()
    try {
      const head = await publicClient.getBlockNumber()
      const from = cached && cached.toBlock > 0n ? cached.toBlock + 1n : await contractCreationBlock(address)
      // one pass for all seven: the same contract, so a single topic-OR filter
      if (from <= head && events.length > 0) {
        await scanLogs({
          address, abi: abi as never, eventNames: events, fromBlock: from, toBlock: head,
          onProgress: ({ from: at, head: top, requests }) => setProgress(`Scanned through block ${at.toLocaleString()} of ${top.toLocaleString()} · ${requests} request${requests === 1 ? '' : 's'}`),
          onPage: (logs) => {
            for (const log of logs as any[]) {
              const values: Record<string, string> = {}
              for (const [key, value] of Object.entries(log.args ?? {})) if (Number.isNaN(Number(key))) values[key] = stringify(value)
              const record: ElectionParameterChange = { event: log.eventName, values, blockNumber: log.blockNumber, transactionHash: log.transactionHash }
              seen.set(`${record.transactionHash}:${record.event}:${record.blockNumber}`, record)
            }
            publish()
          },
        })
      }
      // Block times are decoration: an unanswerable block leaves the row undated.
      for (const record of seen.values()) if (record.timestamp === undefined) record.timestamp = await blockTimestamp(record.blockNumber)
      publish()
      const safeTo = cacheableHead(head)
      if (safeTo >= from) writeCache<ElectionParameterChange>('election-params', address, 'all', { toBlock: safeTo, records: [...seen.values()] }, (record) => ({ ...record, blockNumber: record.blockNumber.toString(), timestamp: record.timestamp?.toString() }))
      setScanned(true)
    } catch (error) {
      setPartial(seen.size > 0)
      setError(error instanceof Error ? error.message : String(error))
    } finally { setLoading(false); setProgress('') }
  }, [currentSet])

  return { changes, loading, progress, error, partial, scanned, scan, eventsKnown: ELECTION_SETTER_EVENTS.length }
}
