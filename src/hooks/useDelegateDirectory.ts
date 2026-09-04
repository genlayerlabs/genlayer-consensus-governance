import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import AddressManagerABI from '@/abi/AddressManager.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import StakingABI from '@/abi/Staking.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { ZERO_ADDRESS } from '@/lib/governance'
import type { DelegateEntry } from '@/lib/types'

const PAGE = 200n
/** guard against an unbounded walk on a large validator set */
const MAX_VALIDATOR_PAGES = 25
const MAX_DELEGATOR_PAGES = 10

/**
 * The delegate directory, built WITHOUT scanning logs.
 *
 * There is no delegate registry, no enumerable set and no delegator-count
 * getter on the governance ledger — it is deliberately O(validators), never
 * O(delegators). The obvious route is scanning DelegateChanged, which is
 * complete but pays the RPC's block-range cap on every visit.
 *
 * The staking system exposes what governance does not. Voting power only
 * exists for staked GEN, so the union of validators and their delegators is a
 * SUPERSET of every address that can hold voting power. Both are paged views,
 * so the whole universe comes from direct calls and the log cap never applies.
 *
 * `delegates()` is then the authoritative record for each — logs would only
 * re-derive what this reads directly.
 */
export function useDelegateDirectory() {
  const { currentSet, addressManager } = useContracts()
  const [entries, setEntries] = useState<DelegateEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState('')
  const [truncated, setTruncated] = useState(false)

  const refresh = useCallback(async () => {
    if (!currentSet || !addressManager) { setEntries([]); return }
    setLoading(true); setError(undefined); setTruncated(false)
    try {
      const staking = await publicClient.readContract({
        address: addressManager, abi: AddressManagerABI, functionName: 'getAddress', args: ['Staking'],
      } as never) as Address
      if (!staking || staking === ZERO_ADDRESS) throw new Error('This deployment has no Staking contract registered.')

      // 1. every validator
      const validators: Address[] = []
      let cut = false
      for (let page = 0; page < MAX_VALIDATOR_PAGES; page++) {
        setProgress(`Reading validators (${validators.length} so far)…`)
        const batch = await publicClient.readContract({
          address: staking, abi: StakingABI, functionName: 'getValidatorsJoined', args: [BigInt(page) * PAGE, PAGE],
        } as never) as Address[]
        validators.push(...batch)
        if (BigInt(batch.length) < PAGE) break
        if (page === MAX_VALIDATOR_PAGES - 1) cut = true
      }

      // 2. their delegators — the other half of the universe
      const universe = new Set<string>(validators.map((v) => v.toLowerCase()))
      for (const validator of validators) {
        setProgress(`Reading delegators (${universe.size} addresses so far)…`)
        for (let page = 0; page < MAX_DELEGATOR_PAGES; page++) {
          const batch = await publicClient.readContract({
            address: staking, abi: StakingABI, functionName: 'getValidatorDelegatorsPaginated',
            args: [validator, BigInt(page) * PAGE, PAGE],
          } as never) as Address[]
          for (const delegator of batch) universe.add(delegator.toLowerCase())
          if (BigInt(batch.length) < PAGE) break
          if (page === MAX_DELEGATOR_PAGES - 1) cut = true
        }
      }
      setTruncated(cut)

      // 3. the authoritative per-address reads, multicall-batched
      setProgress(`Reading voting power for ${universe.size} addresses…`)
      const addresses = [...universe] as Address[]
      const rows = await Promise.all(addresses.map(async (address) => {
        const [votingPower, delegate, excluded, controller, isCouncilMember] = await Promise.all([
          publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'getVotes', args: [address] } as never) as Promise<bigint>,
          publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'delegates', args: [address] } as never) as Promise<Address>,
          publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'isExcluded', args: [address] } as never) as Promise<boolean>,
          publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'governanceControllerOf', args: [address] } as never).catch(() => ZERO_ADDRESS) as Promise<Address>,
          currentSet.council
            ? publicClient.readContract({ address: currentSet.council, abi: SecurityCouncilABI, functionName: 'isMember', args: [address] } as never).catch(() => false) as Promise<boolean>
            : Promise.resolve(false),
        ])
        return { address, votingPower, delegate, excluded, controller, isCouncilMember }
      }))

      // 4. invert delegate → delegators over the same universe
      const delegatorsOf = new Map<string, Address[]>()
      for (const row of rows) {
        if (row.delegate === ZERO_ADDRESS) continue
        if (row.delegate.toLowerCase() === row.address.toLowerCase()) continue
        const key = row.delegate.toLowerCase()
        delegatorsOf.set(key, [...(delegatorsOf.get(key) ?? []), row.address])
      }

      const directory: DelegateEntry[] = rows.map((row) => ({
        address: row.address,
        votingPower: row.votingPower,
        delegate: row.delegate,
        delegatedAway: row.delegate !== ZERO_ADDRESS && row.delegate.toLowerCase() !== row.address.toLowerCase(),
        delegators: delegatorsOf.get(row.address.toLowerCase()) ?? [],
        excluded: row.excluded,
        controller: row.controller && row.controller !== ZERO_ADDRESS ? row.controller : undefined,
        isCouncilMember: Boolean(row.isCouncilMember),
      }))
      directory.sort((a, b) => (a.votingPower === b.votingPower ? 0 : a.votingPower > b.votingPower ? -1 : 1))
      setEntries(directory)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false); setProgress('') }
  }, [currentSet, addressManager])

  useEffect(() => { void refresh() }, [refresh])
  return { entries, loading, error, progress, truncated, refresh }
}
