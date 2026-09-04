import { useCallback, useEffect, useState } from 'react'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceGESRegistryABI from '@/abi/GovernanceGESRegistry.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'

export interface AccountSummary {
  clock: bigint
  ges: bigint
  votingPower: bigint
  requiredPower: bigint
  bond: bigint
  liveProposals: bigint
  directCooldownUntil: bigint
  delegateCooldownUntil: bigint
}

export function useAccountSummary() {
  const { address } = useWallet()
  const { voting, currentSet } = useContracts()
  const [summary, setSummary] = useState<AccountSummary>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    if (!address || !voting || !currentSet) { setSummary(undefined); return }
    setLoading(true); setError(undefined)
    try {
      // The ERC-6372 clock lives on GovernanceVotingPower, NOT on
      // GovernanceClock: the latter only tracks freeze/maintenance windows
      // (frozenTotal, stopState, ...) and has no clock() selector at all, so
      // calling it here reverted and — being the first await — failed the
      // whole summary before any other read ran.
      // BigInt(): viem decodes any uint <= 48 bits as a NUMBER, so a uint48
      // return is not a bigint however it is cast. `as bigint` is erased at
      // runtime, and the next line's `clock - 1n` then threw
      // "Cannot mix BigInt and other types" -- caught and mislabelled as an
      // RPC error. Every uint48 read below is coerced for the same reason.
      const clock = BigInt(await publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'clock' } as any) as bigint | number)
      const point = clock - 1n
      const [ges, votingPower, liveProposals, directCooldownUntil, delegateCooldownUntil] = await Promise.all([
        publicClient.readContract({ address: currentSet.gesRegistry, abi: GovernanceGESRegistryABI, functionName: 'getPastGES', args: [point] } as any) as Promise<bigint>,
        publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'getPastVotesForGovernance', args: [address, point] } as any) as Promise<bigint>,
        publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'liveProposalCount', args: [address] } as any) as Promise<bigint>,
        publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'spamCooldownUntil', args: [address] } as any).then((value) => BigInt(value as bigint | number)),
        publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'delegationSpamCooldownUntil', args: [address] } as any).then((value) => BigInt(value as bigint | number)),
      ])
      setSummary({ clock, ges, votingPower, requiredPower: (ges * 100n + 9_999n) / 10_000n, bond: (ges * 10n) / 10_000n, liveProposals, directCooldownUntil, delegateCooldownUntil })
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [address, voting, currentSet])
  useEffect(() => { void refresh() }, [refresh])
  return { address, summary, error, loading, refresh }
}
