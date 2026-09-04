import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import { deploymentConfig } from '@/config/chain'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { cacheableHead, readCache, writeCache } from '@/lib/logCache'
import { scanLogs } from '@/lib/rpc'
import type { ElectionCandidate, ElectionSummary } from '@/lib/types'

interface CachedStart {
  id: string
  kind: number
  seatsAtStake: number
  voteStart: string
  voteEnd: string
  transactionHash?: string
  blockNumber?: string
}

/**
 * The election list.
 *
 * Ids are sequential 1..electionCount(), and `state(0)` reverts UnknownElection,
 * so enumeration is a plain loop rather than a log scan. But there is no
 * `elections(id)` struct getter, so the KIND, seats at stake and the phase
 * boundaries exist nowhere in the view surface — they are only in the
 * ElectionStarted event. That is why this hook scans at all.
 *
 * Even then, ElectionStarted's voteStart/voteEnd are wall-clock projections
 * computed at start; a clock freeze shifts the real instants and the offsets
 * needed to recompute them are unreadable. They are labelled as projections
 * rather than presented as deadlines.
 */
export function useElections() {
  const { currentSet } = useContracts()
  const [elections, setElections] = useState<ElectionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    const address = currentSet?.elections
    if (!address) { setElections([]); return }
    setLoading(true); setError(undefined)
    try {
      const read = (functionName: string, args: unknown[] = []) =>
        publicClient.readContract({ address, abi: GovernanceCouncilElectionsABI, functionName, args } as never)

      const count = BigInt(await read('electionCount') as never)
      if (count === 0n) { setElections([]); return }

      // ElectionStarted is append-only, so the metadata it carries is cached.
      const cached = readCache<CachedStart>('election-starts', address, 'all', (raw) => raw)
      const starts = new Map<string, CachedStart>()
      for (const entry of cached?.records ?? []) starts.set(entry.id, entry)

      const head = await publicClient.getBlockNumber()
      const from = cached && cached.toBlock > 0n ? cached.toBlock + 1n : deploymentConfig.deploymentStartBlock
      if (from <= head) {
        const logs = await scanLogs({
          address, abi: GovernanceCouncilElectionsABI as never, eventName: 'ElectionStarted' as never,
          fromBlock: from, toBlock: head,
        })
        for (const log of logs as any[]) {
          starts.set(String(log.args.electionId), {
            id: String(log.args.electionId),
            kind: Number(log.args.kind),
            seatsAtStake: Number(log.args.seatsAtStake),
            voteStart: String(log.args.voteStart),
            voteEnd: String(log.args.voteEnd),
            transactionHash: log.transactionHash,
            blockNumber: String(log.blockNumber),
          })
        }
        const safeTo = cacheableHead(head)
        if (safeTo >= from) writeCache<CachedStart>('election-starts', address, 'all', { toBlock: safeTo, records: [...starts.values()] }, (entry) => entry)
      }

      const ids = Array.from({ length: Number(count) }, (_, index) => BigInt(index + 1))
      const rows = await Promise.all(ids.map(async (id): Promise<ElectionSummary> => {
        const [state, slate, winners, ranking] = await Promise.all([
          read('state', [id]).then((value) => Number(value)).catch(() => 0),
          read('electionSlate', [id]).catch(() => []) as Promise<Address[]>,
          read('electionWinners', [id]).catch(() => [[], []]) as Promise<[Address[], Address[]]>,
          read('electionRanking', [id]).catch(() => []) as Promise<Address[]>,
        ])
        const start = starts.get(String(id))
        return {
          id, state, slate, ranking,
          winners: winners[0] ?? [], alternates: winners[1] ?? [],
          kind: start ? start.kind : undefined,
          seatsAtStake: start ? start.seatsAtStake : undefined,
          voteStart: start ? BigInt(start.voteStart) : undefined,
          voteEnd: start ? BigInt(start.voteEnd) : undefined,
          transactionHash: start?.transactionHash as never,
          blockNumber: start?.blockNumber ? BigInt(start.blockNumber) : undefined,
        }
      }))
      rows.sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1))
      setElections(rows)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [currentSet])

  useEffect(() => { void refresh() }, [refresh])
  return { elections, loading, error, refresh }
}

/**
 * Candidates for one election.
 *
 * There is no candidate enumeration: `candidates`, `manifestos` and the
 * endorsement mappings are all private with no list, and `electionSlate` only
 * returns the sealed top set — a nominee who never made the slate is invisible
 * to views entirely. So the roll is CandidateNominated minus CandidateWithdrawn.
 */
export function useElectionCandidates(electionId?: bigint, fromBlock?: bigint) {
  const { currentSet } = useContracts()
  const [candidates, setCandidates] = useState<ElectionCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    const address = currentSet?.elections
    if (!address || electionId === undefined) { setCandidates([]); return }
    setLoading(true); setError(undefined)
    try {
      const floor = fromBlock ?? deploymentConfig.deploymentStartBlock
      const [nominated, withdrawn, slate] = await Promise.all([
        scanLogs({ address, abi: GovernanceCouncilElectionsABI as never, eventName: 'CandidateNominated' as never, args: { electionId }, fromBlock: floor }),
        scanLogs({ address, abi: GovernanceCouncilElectionsABI as never, eventName: 'CandidateWithdrawn' as never, args: { electionId }, fromBlock: floor }),
        publicClient.readContract({ address, abi: GovernanceCouncilElectionsABI, functionName: 'electionSlate', args: [electionId] } as never).catch(() => []) as Promise<Address[]>,
      ])
      const gone = new Set((withdrawn as any[]).map((log) => String(log.args.candidate).toLowerCase()))
      const slated = new Set((slate as Address[]).map((entry) => entry.toLowerCase()))
      const byAddress = new Map<string, ElectionCandidate>()
      for (const log of nominated as any[]) {
        const candidate = log.args.candidate as Address
        const key = candidate.toLowerCase()
        const weight = await publicClient.readContract({
          address, abi: GovernanceCouncilElectionsABI, functionName: 'candidateWeight', args: [electionId, candidate],
        } as never).catch(() => 0n) as bigint
        byAddress.set(key, {
          address: candidate,
          weight,
          slated: slated.has(key),
          withdrawn: gone.has(key),
          bond: BigInt(log.args.bond ?? 0n),
        })
      }
      const rows = [...byAddress.values()]
      rows.sort((a, b) => (a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1))
      setCandidates(rows)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [currentSet, electionId, fromBlock])

  useEffect(() => { void refresh() }, [refresh])
  return { candidates, loading, error, refresh }
}
