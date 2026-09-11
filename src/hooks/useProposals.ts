import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceGESRegistryABI from '@/abi/GovernanceGESRegistry.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import GovernanceClassRegistryABI from '@/abi/GovernanceClassRegistry.json'
import { deploymentConfig } from '@/config/chain'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { normalizePostVote, normalizeRules, normalizeVotes, titleFromDescription } from '@/lib/governance'
import { readProposalCore } from '@/lib/proposalCore'
import { readCache, writeCache } from '@/lib/logCache'
import { isPresent, tryRead } from '@/lib/optionalRead'
import { findLatestLogBackwards, scanLogs } from '@/lib/rpc'
import type { GovernanceIdentities, ProposalSummary } from '@/lib/types'

const PROBE_BATCH = 8
/** A guard, not a limit: stops a runaway loop if state() ever stops reverting. */
const MAX_PROPOSALS = 512

/**
 * Read one proposal. `book` is the sealed AddressManager's nine identities
 * (CON-865): a proposal pins nothing, because the environment it was created
 * under cannot move, so its GES, voting power and permissions are read from
 * the same contracts every other proposal uses.
 */
export async function fetchProposal(book: GovernanceIdentities, id: bigint, account?: Address, creationLog?: any): Promise<ProposalSummary> {
  const voting = book.voting
  if (!creationLog) {
    // A proposal's creation log is immutable and one-per-id, so it is worth
    // remembering permanently: the voters scan also resumes from this block,
    // and without it that scan restarts at genesis.
    const cachedCreation = readCache<any>('creation', voting, id.toString(), (raw) => ({ ...raw, blockNumber: BigInt(raw.blockNumber) }))
    creationLog = cachedCreation?.records[0]
    if (!creationLog) {
      // Newest-first and best-effort: this only decorates the view with the
      // creation tx/block, so it must not gate the render. A forward scan from
      // deploymentStartBlock (genesis when VITE_DEPLOYMENT_START_BLOCK is unset)
      // costs ~2,000 capped requests on a 20M-block chain before anything shows.
      creationLog = await findLatestLogBackwards({ address: voting, abi: GovernanceVotingABI as any, eventName: 'ProposalCreated' as any, args: { id }, floor: deploymentConfig.deploymentStartBlock })
      if (creationLog) {
        writeCache('creation', voting, id.toString(), { toBlock: creationLog.blockNumber as bigint, records: [{ blockNumber: creationLog.blockNumber, transactionHash: creationLog.transactionHash }] },
          (record: any) => ({ blockNumber: record.blockNumber.toString(), transactionHash: record.transactionHash }))
      }
    }
  }
  const calls = [
    ['state', [id]], ['proposalDescription', [id]],
    ['proposalSnapshot', [id]], ['proposalDeadline', [id]], ['proposalVotes', [id]],
    ['proposalRules', [id]], ['proposalOperations', [id]], ['postVoteOf', [id]],
    ['executionEta', [id]], ['executionDeadline', [id]],
  ] as const
  // getProposal is read raw and decoded by shape: a pre-CON-865 deployment
  // returns one word more (the retired contractsHash pin), and decoding that
  // with the sealed ABI slides every later field by a word.
  const [decoded, state, description, voteStart, voteEnd, votes, rules, operations, postVote, executionEta, executionDeadline] = await Promise.all([
    readProposalCore(voting, id),
    ...calls.map(([functionName, args]) =>
      publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName, args } as any)),
  ] as const) as [Awaited<ReturnType<typeof readProposalCore>>, ...any[]]
  const core = decoded.core
  // clock() is on GovernanceVotingPower, not GovernanceClock — see the note
  // in useAccountSummary. Reading it from book.clock reverts.
  // BigInt(): uint48 decodes to a number in viem — see useAccountSummary.
  const clock = BigInt(await publicClient.readContract({ address: book.votingPower, abi: GovernanceVotingPowerABI, functionName: 'clock' } as any) as bigint | number)
  const effectiveSnapshot = (voteStart as bigint) >= clock ? clock - 1n : voteStart as bigint
  const ges = await publicClient.readContract({ address: book.gesRegistry, abi: GovernanceGESRegistryABI, functionName: 'getPastGES', args: [effectiveSnapshot] } as any) as bigint
  const operationPermissions = await Promise.all((operations as any[]).map((operation) => publicClient.readContract({ address: book.classRegistry, abi: GovernanceClassRegistryABI, functionName: 'isPermittedFor', args: [core.classId, operation, id] } as any) as Promise<boolean>))
  let connectedVote
  if (account) {
    const [hasVoted, weight] = await Promise.all([
      publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'hasVoted', args: [id, account] } as any) as Promise<boolean>,
      publicClient.readContract({ address: book.votingPower, abi: GovernanceVotingPowerABI, functionName: 'getPastVotesForGovernance', args: [account, effectiveSnapshot] } as any) as Promise<bigint>,
    ])
    let support: number | undefined
    if (hasVoted) {
      // Paged: this span is unbounded (proposal creation → head) and a raw
      // getLogs over it is refused once it exceeds the RPC's block-range cap.
      const voteLogs = await scanLogs({ address: voting, abi: GovernanceVotingABI as any, eventName: 'VoteCast' as any, args: { voter: account, proposalId: id }, fromBlock: creationLog?.blockNumber ?? deploymentConfig.deploymentStartBlock })
      support = voteLogs.length ? Number((voteLogs.at(-1) as any).args.support) : undefined
    }
    connectedVote = { hasVoted, weight, support }
  }
  return {
    core, state: Number(state), description: description as string,
    title: titleFromDescription(description as string, id), voteStart: voteStart as bigint,
    voteEnd: voteEnd as bigint, votes: normalizeVotes(votes), rules: normalizeRules(rules),
    operations: operations as any, operationPermissions, ges, connectedVote,
    // executionEta / executionDeadline are uint48 -> number in viem
    postVote: normalizePostVote(postVote), executionEta: BigInt(executionEta as bigint | number), executionDeadline: BigInt(executionDeadline as bigint | number),
    transactionHash: creationLog?.transactionHash, blockNumber: creationLog?.blockNumber,
  }
}

/**
 * Merge proposals into the on-disk creation index.
 *
 * Only the identity of a proposal is stored — id, creation block, creation
 * tx. Everything mutable (state, votes, post-vote fields) is deliberately
 * excluded: it is re-read on every render from cheap contract calls, and
 * caching it would show a stale tally.
 */
function rememberIndex(voting: Address, added: ProposalSummary[], toBlock?: bigint) {
  const existing = readCache<any>('proposal-index', voting, 'all', (raw) => ({ ...raw, id: BigInt(raw.id), blockNumber: BigInt(raw.blockNumber) }))
  const byId = new Map<string, any>()
  for (const entry of existing?.records ?? []) byId.set(String(entry.id), entry)
  for (const proposal of added) {
    if (proposal.blockNumber === undefined) continue
    byId.set(String(proposal.core.id), { id: proposal.core.id, blockNumber: proposal.blockNumber, transactionHash: proposal.transactionHash, args: { id: proposal.core.id } })
  }
  if (byId.size === 0) return
  const highest = toBlock ?? existing?.toBlock ?? 0n
  writeCache('proposal-index', voting, 'all', { toBlock: highest, records: [...byId.values()] },
    (entry: any) => ({ id: entry.id.toString(), blockNumber: entry.blockNumber.toString(), transactionHash: entry.transactionHash }))
}

export function useProposals() {
  const { book } = useContracts()
  const voting = book?.voting
  const { address } = useWallet()
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('')

  /**
   * Enumerate ids instead of scanning for ProposalCreated.
   *
   * Ids are sequential from 1, so `proposalCount()` (CON-864) IS the list: one
   * read. A deployment that predates the getter reverts on it, and then the
   * older method still holds: `state(id)` reverts UnknownProposal past the
   * end, so walking upward until a gap yields the COMPLETE list for N+1 cheap
   * eth_calls — no log range, no cap, no cursor, and nothing that can be
   * missed. The old paged scan stopped at the first window that returned any
   * logs, so a fresh visitor could see three proposals and not the fourth, and
   * "Load more" then scanned older blocks that held nothing new.
   *
   * The creation log is still wanted per proposal — it carries the block the
   * voters scan resumes from — but fetchProposal fetches that lazily, cached
   * permanently per id, so it never gates the list.
   */
  const load = useCallback(async () => {
    if (!voting) { setProposals([]); return }
    setLoading(true); setError(undefined)
    try {
      const ids: bigint[] = []
      setProgress('Counting proposals')
      const count = await tryRead<bigint>({ address: voting, abi: GovernanceVotingABI as never, functionName: 'proposalCount' })
      if (isPresent(count)) {
        for (let id = 1n; id <= count.value; id += 1n) ids.push(id)
      } else for (let base = 1n; ; base += BigInt(PROBE_BATCH)) {
        // No getter here (or no answer): probed in batches so a long list
        // costs a handful of round trips rather than one per proposal; the
        // batch stops at the first gap.
        setProgress(`Reading proposals ${base}–${base + BigInt(PROBE_BATCH) - 1n}`)
        const probes = await Promise.all(Array.from({ length: PROBE_BATCH }, (_unused, offset) =>
          publicClient.readContract({ address: voting, abi: GovernanceVotingABI as any, functionName: 'state', args: [base + BigInt(offset)] } as never)
            .then(() => true).catch(() => false)))
        const upTo = probes.indexOf(false)
        for (let offset = 0; offset < (upTo === -1 ? PROBE_BATCH : upTo); offset += 1) ids.push(base + BigInt(offset))
        if (upTo !== -1) break
        if (ids.length > MAX_PROPOSALS) break
      }
      setProgress(ids.length ? `Loading ${ids.length} proposal${ids.length === 1 ? '' : 's'}…` : '')
      const hydrated = await Promise.all(ids.map((id) => fetchProposal(book!, id, address)))
      setProposals(hydrated.sort((a, b) => (a.core.id === b.core.id ? 0 : a.core.id > b.core.id ? -1 : 1)))
      rememberIndex(voting, hydrated)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false); setProgress('') }
  }, [book, voting, address])

  // Render whatever a previous visit indexed, so the list is not blank while
  // the ids are probed. Identity only — every number on the row is re-read.
  const loadIndexed = useCallback(async () => {
    if (!voting) return
    const index = readCache<any>('proposal-index', voting, 'all', (raw) => ({ ...raw, id: BigInt(raw.id), blockNumber: BigInt(raw.blockNumber) }))
    if (!index || index.records.length === 0) return
    try {
      const hydrated = await Promise.all(index.records.map((entry: any) => fetchProposal(book!, entry.id, address, entry)))
      setProposals((current) => (current.length ? current : hydrated.sort((a, b) => (a.core.id === b.core.id ? 0 : a.core.id > b.core.id ? -1 : 1))))
    } catch { /* the authoritative load below replaces this anyway */ }
  }, [book, voting, address])

  useEffect(() => { void loadIndexed().then(() => load()) }, [loadIndexed, load])

  return { proposals, loading, error, progress, refresh: load }
}
