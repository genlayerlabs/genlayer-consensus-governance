import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { MIN_ENTRY_VALUE, ZERO_ADDRESS } from '@/lib/governance'
import type { DelegationSummary } from '@/lib/types'

/**
 * The connected account's delegation state, and whether a third-party
 * delegation would actually succeed.
 *
 * The MIN_ENTRY_VALUE floor is the part worth pre-flighting: it applies PER
 * VALIDATOR POSITION, not to the total. Someone holding 5 x 500 GEN across
 * five validators cannot delegate to a third party at all, despite 2,500 GEN
 * of voting power — every position that would open an entry on the delegate
 * must independently clear 1,000 GEN. Without this the user only learns at
 * the revert.
 *
 * Self-delegation and parking skip the check entirely: the contract only
 * applies it when `to` is neither the account nor the zero address.
 */
export function useMyDelegation() {
  const { currentSet } = useContracts()
  const { address } = useWallet()
  const [summary, setSummary] = useState<DelegationSummary>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!address || !currentSet) { setSummary(undefined); return }
    const votingPower = currentSet.votingPower
    setLoading(true); setError(undefined)
    try {
      const read = (functionName: string, args: unknown[]) =>
        publicClient.readContract({ address: votingPower, abi: GovernanceVotingPowerABI, functionName, args } as never)

      const [delegate, power, excluded, cooldown, validators] = await Promise.all([
        read('delegates', [address]) as Promise<Address>,
        read('getVotes', [address]) as Promise<bigint>,
        read('isExcluded', [address]) as Promise<boolean>,
        read('delegationSpamCooldownUntil', [address]).then((value) => BigInt(value as never)) as Promise<bigint>,
        read('liveValidatorsOf', [address]) as Promise<Address[]>,
      ])

      // Price each position the way moveDelegation does: pending plus shares
      // valued at the validator's latest pool price. The d-pool applies unless
      // the account IS the validator, in which case it is the v-pool.
      const clock = BigInt(await read('clock', []) as never)
      const positions = await Promise.all(validators.map(async (validator) => {
        const [shares, pending] = await read('sharesOf', [address, validator]) as [bigint, bigint]
        let value = shares + pending
        try {
          const [vStake, vShares, dStake, dShares] = await read('poolPriceAt', [validator, clock - 1n]) as [bigint, bigint, bigint, bigint]
          const selfPool = validator.toLowerCase() === address.toLowerCase()
          const stake = selfPool ? vStake : dStake
          const poolShares = selfPool ? vShares : dShares
          // An unpriced pool prices 1:1; a wiped pool prices to nothing.
          const priced = poolShares === 0n ? (stake === 0n ? shares : 0n) : (shares * stake) / poolShares
          value = pending + priced
        } catch { /* keep the 1:1 estimate rather than dropping the row */ }
        return { validator, shares, pending, value, meetsFloor: value >= MIN_ENTRY_VALUE }
      }))

      setSummary({
        delegate,
        self: delegate !== ZERO_ADDRESS && delegate.toLowerCase() === address.toLowerCase(),
        parked: delegate === ZERO_ADDRESS,
        votingPower: power,
        excluded,
        cooldownUntil: cooldown,
        positions,
      })
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [address, currentSet])

  useEffect(() => { void refresh() }, [refresh])
  return { summary, loading, error, refresh }
}
