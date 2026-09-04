import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { publicClient } from '@/config/clients'
import { cacheableHead, readCache, writeCache } from '@/lib/logCache'
import { scanLogs } from '@/lib/rpc'
import type { VoteRecord } from '@/lib/types'

const PAGE_SIZE = 25

export function useVoteRecords(voting?: Address, proposalId?: bigint, creationBlock?: bigint) {
  const [records, setRecords] = useState<VoteRecord[]>([])
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('')
  const [partial, setPartial] = useState(false)

  const scan = useCallback(async () => {
    // Waiting for creationBlock is load-bearing, not tidiness: without it the
    // first render scans from deploymentStartBlock — genesis when
    // VITE_DEPLOYMENT_START_BLOCK is unset — which is hundreds of requests
    // through history that provably cannot hold this proposal's votes.
    if (!voting || !proposalId || creationBlock === undefined) return
    setLoading(true); setError(undefined); setPartial(false)

    // VoteCast is append-only: a vote cannot be recalled, so a scanned range
    // never needs re-scanning. Show what is already known immediately, then
    // scan only the gap to the head.
    const cached = readCache<VoteRecord>('votes', voting, proposalId.toString(), (raw) => ({
      ...raw, proposalId: BigInt(raw.proposalId), weight: BigInt(raw.weight), blockNumber: BigInt(raw.blockNumber),
    }))
    const seen = new Map<string, VoteRecord>()
    const publish = () => setRecords([...seen.values()].sort((a, b) => a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1))
    for (const record of cached?.records ?? []) seen.set(record.voter.toLowerCase(), record)
    publish()

    const resumeFrom = cached && cached.toBlock >= creationBlock ? cached.toBlock + 1n : creationBlock
    try {
      const head = await publicClient.getBlockNumber()
      await scanLogs({
        address: voting, abi: GovernanceVotingABI as any, eventName: 'VoteCast' as any,
        args: { proposalId }, fromBlock: resumeFrom,
        onProgress: ({ from, head, requests }) => setProgress(`Scanned through block ${from.toLocaleString()} of ${head.toLocaleString()} · ${requests} RPC request${requests === 1 ? '' : 's'}`),
        onPage: (logs) => {
          for (const log of logs) {
            const item = log as any
            const record: VoteRecord = { voter: item.args.voter, proposalId: item.args.proposalId, support: Number(item.args.support), weight: item.args.weight, reason: item.args.reason, transactionHash: item.transactionHash, blockNumber: item.blockNumber }
            seen.set(record.voter.toLowerCase(), record)
          }
          publish()
        },
      })
      // Remember only up to the reorg margin: nothing here re-validates a
      // cached range, so a reorg near the head must not be persisted.
      const safeTo = cacheableHead(head)
      if (safeTo >= resumeFrom) {
        writeCache<VoteRecord>('votes', voting, proposalId.toString(), { toBlock: safeTo, records: [...seen.values()] }, (record) => ({
          ...record, proposalId: record.proposalId.toString(), weight: record.weight.toString(), blockNumber: record.blockNumber.toString(),
        }))
      }
    } catch (error) {
      setPartial(seen.size > 0)
      setError(error instanceof Error ? error.message : String(error))
    } finally { setLoading(false) }
  }, [voting, proposalId, creationBlock])

  useEffect(() => { setVisibleCount(PAGE_SIZE); void scan() }, [scan])
  const visible = useMemo(() => records.slice(0, visibleCount), [records, visibleCount])
  return { records, visible, visibleCount, loading, error, progress, partial, retry: scan, loadMore: () => setVisibleCount((value) => value + PAGE_SIZE), hasMore: visibleCount < records.length }
}
