import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceGESRegistryABI from '@/abi/GovernanceGESRegistry.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import GovernanceClassRegistryABI from '@/abi/GovernanceClassRegistry.json'
import { deploymentConfig } from '@/config/chain'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { normalizeCore, normalizePostVote, normalizeRules, normalizeVotes, titleFromDescription } from '@/lib/governance'
import { scanLogs } from '@/lib/rpc'
import type { ContractSet, ProposalSummary } from '@/lib/types'

const RANGE = 100_000n

function normalizeSet(value: any): ContractSet {
  return {
    voting: value.voting, votingPower: value.votingPower, gesRegistry: value.gesRegistry,
    classRegistry: value.classRegistry, clock: value.clock, executor: value.executor,
    l1Bridge: value.l1Bridge, council: value.council, elections: value.elections,
  }
}

export async function fetchProposal(voting: Address, id: bigint, account?: Address, creationLog?: any): Promise<ProposalSummary> {
  if (!creationLog) {
    const creationLogs = await scanLogs({ address: voting, abi: GovernanceVotingABI as any, eventName: 'ProposalCreated' as any, args: { id }, fromBlock: deploymentConfig.deploymentStartBlock })
    creationLog = creationLogs.at(-1)
  }
  const calls = [
    ['getProposal', [id]], ['state', [id]], ['proposalDescription', [id]],
    ['proposalSnapshot', [id]], ['proposalDeadline', [id]], ['proposalVotes', [id]],
    ['proposalRules', [id]], ['proposalOperations', [id]], ['postVoteOf', [id]],
    ['executionEta', [id]], ['executionDeadline', [id]],
  ] as const
  const [coreValue, state, description, voteStart, voteEnd, votes, rules, operations, postVote, executionEta, executionDeadline] = await Promise.all(calls.map(([functionName, args]) =>
    publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName, args } as any),
  ))
  const core = normalizeCore(coreValue)
  const setValue = await publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'contractSet', args: [core.contractsHash] } as any)
  const set = normalizeSet(setValue)
  const clock = await publicClient.readContract({ address: set.clock, abi: GovernanceClockABI, functionName: 'clock' } as any) as bigint
  const effectiveSnapshot = (voteStart as bigint) >= clock ? clock - 1n : voteStart as bigint
  const ges = await publicClient.readContract({ address: set.gesRegistry, abi: GovernanceGESRegistryABI, functionName: 'getPastGES', args: [effectiveSnapshot] } as any) as bigint
  const operationPermissions = await Promise.all((operations as any[]).map((operation) => publicClient.readContract({ address: set.classRegistry, abi: GovernanceClassRegistryABI, functionName: 'isPermittedFor', args: [core.classId, operation, id] } as any) as Promise<boolean>))
  let connectedVote
  if (account) {
    const [hasVoted, weight] = await Promise.all([
      publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'hasVoted', args: [id, account] } as any) as Promise<boolean>,
      publicClient.readContract({ address: set.votingPower, abi: GovernanceVotingPowerABI, functionName: 'getPastVotesForGovernance', args: [account, effectiveSnapshot] } as any) as Promise<bigint>,
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
    operations: operations as any, operationPermissions, ges, contractSet: set, connectedVote,
    postVote: normalizePostVote(postVote), executionEta: executionEta as bigint, executionDeadline: executionDeadline as bigint,
    transactionHash: creationLog?.transactionHash, blockNumber: creationLog?.blockNumber,
  }
}

export function useProposals() {
  const { voting } = useContracts()
  const { address } = useWallet()
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [cursor, setCursor] = useState<bigint>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('')
  const loaded = useRef(new Set<string>())

  useEffect(() => {
    setProposals([]); setCursor(undefined); setError(undefined); loaded.current.clear()
  }, [voting, address])

  const loadMore = useCallback(async () => {
    if (!voting || loading) return
    setLoading(true); setError(undefined)
    try {
      let to = cursor ?? await publicClient.getBlockNumber()
      let pages = 0
      let found: any[] = []
      while (to >= deploymentConfig.deploymentStartBlock && pages < 8 && found.length === 0) {
        const candidate = to >= RANGE ? to - RANGE + 1n : 0n
        const from = candidate < deploymentConfig.deploymentStartBlock ? deploymentConfig.deploymentStartBlock : candidate
        setProgress(`Scanning blocks ${from.toLocaleString()}–${to.toLocaleString()}`)
        // RANGE is the per-click LOOK-BACK window, not one RPC request:
        // scanLogs pages it into cap-sized requests internally.
        found = await scanLogs({ address: voting, abi: GovernanceVotingABI as any, eventName: 'ProposalCreated' as any, fromBlock: from, toBlock: to })
        setCursor(from > deploymentConfig.deploymentStartBlock ? from - 1n : -1n)
        if (from === deploymentConfig.deploymentStartBlock) break
        to = from - 1n
        pages += 1
      }
      const fresh = found.filter((log) => !loaded.current.has(String(log.args.id)))
      fresh.forEach((log) => loaded.current.add(String(log.args.id)))
      const hydrated = await Promise.all([...fresh].reverse().map((log) => fetchProposal(voting, log.args.id, address, log)))
      setProposals((current) => [...current, ...hydrated])
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false); setProgress('')
    }
  }, [voting, address, cursor, loading])

  useEffect(() => { if (voting && proposals.length === 0 && cursor === undefined) void loadMore() }, [voting, proposals.length, cursor, loadMore])
  return { proposals, loading, error, progress, loadMore, hasMore: cursor === undefined || cursor >= deploymentConfig.deploymentStartBlock }
}
