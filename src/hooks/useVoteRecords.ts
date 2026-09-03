import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { deploymentConfig } from '@/config/chain'
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
    if (!voting || !proposalId) return
    setLoading(true); setError(undefined); setPartial(false); setRecords([])
    const seen = new Map<string, VoteRecord>()
    try {
      await scanLogs({
        address: voting, abi: GovernanceVotingABI as any, eventName: 'VoteCast' as any,
        args: { proposalId }, fromBlock: creationBlock ?? deploymentConfig.deploymentStartBlock,
        onProgress: ({ from, head, requests }) => setProgress(`Scanned through block ${from.toLocaleString()} of ${head.toLocaleString()} · ${requests} RPC request${requests === 1 ? '' : 's'}`),
        onPage: (logs) => {
          for (const log of logs) {
            const item = log as any
            const record: VoteRecord = { voter: item.args.voter, proposalId: item.args.proposalId, support: Number(item.args.support), weight: item.args.weight, reason: item.args.reason, transactionHash: item.transactionHash, blockNumber: item.blockNumber }
            seen.set(record.voter.toLowerCase(), record)
          }
          setRecords([...seen.values()].sort((a, b) => a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1))
        },
      })
    } catch (error) {
      setPartial(seen.size > 0)
      setError(error instanceof Error ? error.message : String(error))
    } finally { setLoading(false) }
  }, [voting, proposalId, creationBlock])

  useEffect(() => { setVisibleCount(PAGE_SIZE); void scan() }, [scan])
  const visible = useMemo(() => records.slice(0, visibleCount), [records, visibleCount])
  return { records, visible, visibleCount, loading, error, progress, partial, retry: scan, loadMore: () => setVisibleCount((value) => value + PAGE_SIZE), hasMore: visibleCount < records.length }
}
