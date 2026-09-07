import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import GovernanceGESRegistryABI from '@/abi/GovernanceGESRegistry.json'
import { contractCreationBlock } from '@/lib/deploymentBlock'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { elapsedUnfrozen, electionBounds, electionQuorumRequired, electionSubPhase, normalizeElection, resolveEffectiveInstant, ZERO_ADDRESS } from '@/lib/governance'
import { cacheableHead, readCache, writeCache } from '@/lib/logCache'
import { isPresent, tryRead } from '@/lib/optionalRead'
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

const abi = GovernanceCouncilElectionsABI as never

/**
 * The election list.
 *
 * Ids are sequential 1..electionCount(), and `state(0)` reverts UnknownElection,
 * so enumeration is a plain loop rather than a log scan.
 *
 * Where the deployment exposes `elections(id)` (CON-864), the stored struct
 * gives the kind, seats, unfrozen offsets, quorum and turnout, and with the
 * clock's frozen total the phase boundaries are computed EXACTLY — the same
 * arithmetic state() runs — so they are shown as deadlines with a countdown.
 * Where it does not, the kind, seats and phase bounds exist nowhere in the
 * view surface but the ElectionStarted event, whose voteStart/voteEnd are
 * wall-clock projections made at start (a freeze shifts the real instants),
 * so they are labelled as projections. The event is scanned in both cases
 * for the start transaction it carries.
 */
export function useElections() {
  const { currentSet } = useContracts()
  const [elections, setElections] = useState<ElectionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  /** 'struct' once elections(id) answered; 'logs' when only the event is available */
  const [source, setSource] = useState<'struct' | 'logs' | 'unknown'>('logs')

  const refresh = useCallback(async () => {
    const address = currentSet?.elections
    if (!address) { setElections([]); return }
    setLoading(true); setError(undefined)
    try {
      const read = (functionName: string, args: unknown[] = []) =>
        publicClient.readContract({ address, abi, functionName, args } as never)

      const count = BigInt(await read('electionCount') as never)
      if (count === 0n) { setElections([]); return }
      const ids = Array.from({ length: Number(count) }, (_unused, index) => BigInt(index + 1))

      // The frozen total is what turns an unfrozen offset into a wall instant.
      // Read once per refresh: a freeze that begins later moves every bound,
      // and the next refresh (or countdown tick past a stale bound) shows it.
      const frozen = currentSet?.clock
        ? await tryRead<bigint | number>({ address: currentSet.clock, abi: GovernanceClockABI as never, functionName: 'frozenTotal' })
        : ({ unknown: new Error('no clock') } as const)
      const frozenTotalNow = isPresent(frozen) ? BigInt(frozen.value) : undefined
      // Local time stands in for block.timestamp: the chain and the viewer
      // disagree by seconds, and a boundary is re-derived on every tick.
      const now = BigInt(Math.floor(Date.now() / 1000))

      /** Everything readable without a single log: state, slate, winners, ranking, and the struct where it exists. */
      const readRows = async (starts: Map<string, CachedStart>) => {
        let structSeen: 'struct' | 'logs' | 'unknown' = 'logs'
        const rows = await Promise.all(ids.map(async (id): Promise<ElectionSummary> => {
          const [state, slate, winners, ranking, info] = await Promise.all([
            read('state', [id]).then((value) => Number(value)).catch(() => 0),
            read('electionSlate', [id]).catch(() => []) as Promise<Address[]>,
            read('electionWinners', [id]).catch(() => [[], []]) as Promise<[Address[], Address[]]>,
            read('electionRanking', [id]).catch(() => []) as Promise<Address[]>,
            tryRead<any>({ address, abi, functionName: 'elections', args: [id] }),
          ])
          const start = starts.get(String(id))
          const base: ElectionSummary = {
            id, state, slate, ranking,
            winners: winners[0] ?? [], alternates: winners[1] ?? [],
            kind: start ? start.kind : undefined,
            seatsAtStake: start ? start.seatsAtStake : undefined,
            voteStart: start ? BigInt(start.voteStart) : undefined,
            voteEnd: start ? BigInt(start.voteEnd) : undefined,
            transactionHash: start?.transactionHash as never,
            blockNumber: start?.blockNumber ? BigInt(start.blockNumber) : undefined,
          }
          if (!isPresent(info)) {
            if ('unknown' in info) structSeen = 'unknown'
            return base
          }
          structSeen = 'struct'
          const details = normalizeElection(info.value)
          const bounds = frozenTotalNow === undefined ? undefined : electionBounds(details, frozenTotalNow)
          const subPhase = frozenTotalNow === undefined ? undefined : electionSubPhase(details, elapsedUnfrozen(now, details, frozenTotalNow))
          return {
            ...base, details, bounds, subPhase,
            kind: details.kind, seatsAtStake: details.seatsAtStake,
            turnout: details.turnout, quorumBps: details.quorumBps,
          }
        }))
        rows.sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1))
        setSource(structSeen)
        return rows
      }

      // ElectionStarted is append-only, so the metadata it carries is cached.
      const cached = readCache<CachedStart>('election-starts', address, 'all', (raw) => raw)
      const starts = new Map<string, CachedStart>()
      for (const entry of cached?.records ?? []) starts.set(entry.id, entry)

      // Paint what the contract can answer straight away; the log scan only
      // decorates with the start transaction (and, without the struct, the
      // kind, seats and projected bounds).
      let rows = await readRows(starts)
      setElections(rows)
      setLoading(false)

      // Second pass: the GES denominator at the vote-start snapshot, which
      // turns quorumBps into a figure and turnout into a verdict. Only once
      // voting has opened (before that the snapshot is still ahead), and
      // only where the struct exists to say where the snapshot is.
      const withQuorum = await Promise.all(rows.map(async (row) => {
        if (!row.details || frozenTotalNow === undefined || row.state < 3 || !currentSet?.clock) return row
        try {
          const clock = currentSet.clock
          const snapshotInstant = await resolveEffectiveInstant(row.details, row.details.voteStartOffset, now, async (at) =>
            BigInt(await publicClient.readContract({ address: clock, abi: GovernanceClockABI as never, functionName: 'frozenTotalAt', args: [at] } as never) as bigint | number))
          const registry = row.details.gesRegistry === ZERO_ADDRESS ? currentSet.gesRegistry : row.details.gesRegistry
          const ges = await publicClient.readContract({ address: registry, abi: GovernanceGESRegistryABI as never, functionName: 'getPastGES', args: [snapshotInstant] } as never) as bigint
          return { ...row, snapshotInstant, ges, quorumRequired: electionQuorumRequired(row.details.quorumBps, ges) }
        } catch { return row }
      }))
      rows = withQuorum
      setElections(rows)

      const head = await publicClient.getBlockNumber()
      const from = cached && cached.toBlock > 0n ? cached.toBlock + 1n : await contractCreationBlock(address)
      if (from <= head) {
        const logs = await scanLogs({ address, abi, eventName: 'ElectionStarted' as never, fromBlock: from, toBlock: head })
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
        // merge the start metadata into the rows already decorated with quorum
        setElections(rows.map((row) => {
          const start = starts.get(String(row.id))
          if (!start) return row
          return {
            ...row,
            kind: row.kind ?? start.kind, seatsAtStake: row.seatsAtStake ?? start.seatsAtStake,
            voteStart: BigInt(start.voteStart), voteEnd: BigInt(start.voteEnd),
            transactionHash: start.transactionHash as never, blockNumber: start.blockNumber ? BigInt(start.blockNumber) : undefined,
          }
        }))
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [currentSet])

  useEffect(() => { void refresh() }, [refresh])
  return { elections, loading, error, source, refresh }
}

/**
 * Candidates for one election.
 *
 * Where the deployment exposes `candidatesOf(id)` (CON-864) the roll is the
 * contract's own list in nomination order, complete by construction, with
 * `candidateOf` supplying the live flags. An EMPTY roll is ambiguous — no
 * nominee yet, or an election started before the index existed — so it
 * falls through to the reconstruction the UI has always had: nominations
 * minus withdrawals from logs, with `electionSlate` for the sealed top set.
 * That path is complete only within the scanned range, and says so.
 */
export function useElectionCandidates(electionId?: bigint, fromBlock?: bigint) {
  const { currentSet } = useContracts()
  const [candidates, setCandidates] = useState<ElectionCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [complete, setComplete] = useState(false)

  const refresh = useCallback(async () => {
    const address = currentSet?.elections
    if (!address || electionId === undefined) { setCandidates([]); return }
    setLoading(true); setError(undefined)
    try {
      const weightOf = (candidate: Address) => publicClient.readContract({
        address, abi, functionName: 'candidateWeight', args: [electionId, candidate],
      } as never).catch(() => 0n) as Promise<bigint>

      const roll = await tryRead<Address[]>({ address, abi, functionName: 'candidatesOf', args: [electionId] })
      if (isPresent(roll) && roll.value.length > 0) {
        const rows = await Promise.all(roll.value.map(async (candidate): Promise<ElectionCandidate> => {
          const [weight, record] = await Promise.all([
            weightOf(candidate),
            publicClient.readContract({ address, abi, functionName: 'candidateOf', args: [electionId, candidate] } as never) as Promise<any[]>,
          ])
          const [nominated, withdrawn, slated, bondClaimed, autoNominated, bond, nominationSeq] = record
          void nominated
          return { address: candidate, weight, slated, withdrawn, bond: BigInt(bond), bondClaimed, autoNominated, nominationSeq: Number(nominationSeq) }
        }))
        setCandidates(rows)
        setComplete(true)
        return
      }

      // The candidate scan has the same problem as the election list: without
      // the election's start block it would walk from genesis.
      const floor = fromBlock ?? await contractCreationBlock(address)
      const [nominated, withdrawn, slate] = await Promise.all([
        scanLogs({ address, abi, eventName: 'CandidateNominated' as never, args: { electionId }, fromBlock: floor }),
        scanLogs({ address, abi, eventName: 'CandidateWithdrawn' as never, args: { electionId }, fromBlock: floor }),
        publicClient.readContract({ address, abi, functionName: 'electionSlate', args: [electionId] } as never).catch(() => []) as Promise<Address[]>,
      ])
      const gone = new Set((withdrawn as any[]).map((log) => String(log.args.candidate).toLowerCase()))
      const slated = new Set((slate as Address[]).map((entry) => entry.toLowerCase()))
      const byAddress = new Map<string, ElectionCandidate>()
      let sequence = 0
      for (const log of nominated as any[]) {
        const candidate = log.args.candidate as Address
        const key = candidate.toLowerCase()
        sequence += 1
        byAddress.set(key, {
          address: candidate, weight: await weightOf(candidate),
          slated: slated.has(key), withdrawn: gone.has(key),
          bond: BigInt(log.args.bond ?? 0n), nominationSeq: sequence,
        })
      }
      setCandidates([...byAddress.values()])
      setComplete(false)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [currentSet, electionId, fromBlock])

  useEffect(() => { void refresh() }, [refresh])
  return { candidates, loading, error, complete, refresh }
}
