import { useCallback, useEffect, useState } from 'react'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
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
      const clock = await publicClient.readContract({ address: currentSet.clock, abi: GovernanceClockABI, functionName: 'clock' } as any) as bigint
      const point = clock - 1n
      const [ges, votingPower, liveProposals, directCooldownUntil, delegateCooldownUntil] = await Promise.all([
        publicClient.readContract({ address: currentSet.gesRegistry, abi: GovernanceGESRegistryABI, functionName: 'getPastGES', args: [point] } as any) as Promise<bigint>,
        publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'getPastVotesForGovernance', args: [address, point] } as any) as Promise<bigint>,
        publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'liveProposalCount', args: [address] } as any) as Promise<bigint>,
        publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'spamCooldownUntil', args: [address] } as any) as Promise<bigint>,
        publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'delegationSpamCooldownUntil', args: [address] } as any) as Promise<bigint>,
      ])
      setSummary({ clock, ges, votingPower, requiredPower: (ges * 100n + 9_999n) / 10_000n, bond: (ges * 10n) / 10_000n, liveProposals, directCooldownUntil, delegateCooldownUntil })
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [address, voting, currentSet])
  useEffect(() => { void refresh() }, [refresh])
  return { address, summary, error, loading, refresh }
}
