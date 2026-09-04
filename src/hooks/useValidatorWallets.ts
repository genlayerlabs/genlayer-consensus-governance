import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import AddressManagerABI from '@/abi/AddressManager.json'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import StakingABI from '@/abi/Staking.json'
import ValidatorWalletABI from '@/abi/ValidatorWallet.json'
import ValidatorWalletFactoryABI from '@/abi/ValidatorWalletFactory.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { ZERO_ADDRESS } from '@/lib/governance'

export interface ValidatorWalletVoter {
  address: Address
  /** weight AT THE PROPOSAL SNAPSHOT — never the live figure */
  weight: bigint
  hasVoted: boolean
  /** non-null when the wallet handed its weight to someone else */
  delegatedTo?: Address
}

const PAGE = 200n
const MAX_PAGES = 5

/**
 * The validator wallets the connected account may vote WITH.
 *
 * Governance rights on a wallet are `onlyOwner` (govCastVote / govDelegate /
 * govCastBallot), and GovernanceVotingPower resolves exclusion through
 * `governanceController() == owner()`. The operator runs consensus duties and
 * has no say here, so ownership is the only thing that qualifies a wallet.
 *
 * Discovery is two-pass because ValidatorWalletFactory indexes wallets by
 * OPERATOR (`operatorToWallets`) and exposes no owner index:
 *
 *   1. getWalletsForOperator(account) — one call, covers the common case
 *      where an account both owns and operates its wallets;
 *   2. otherwise enumerate Staking.getValidatorsJoined and keep the wallets
 *      whose owner() is the account. This is what makes the owner-only case
 *      work at all — a custodian who owns stake but hired an operator is
 *      invisible to pass 1 despite being the ONLY party able to vote.
 *
 * Pass 2 uses a paged view rather than logs, so it is unaffected by the RPC's
 * eth_getLogs block-range cap.
 */
export function useValidatorWallets(proposalId?: bigint, snapshot?: bigint) {
  const { address } = useWallet()
  const { addressManager, voting, currentSet } = useContracts()
  const [wallets, setWallets] = useState<ValidatorWalletVoter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!address || !addressManager || !voting || !currentSet || snapshot === undefined) {
      setWallets([])
      return
    }
    setLoading(true); setError(undefined)
    try {
      const [factory, staking] = await Promise.all(['ValidatorWalletFactory', 'Staking'].map((key) =>
        publicClient.readContract({ address: addressManager, abi: AddressManagerABI, functionName: 'getAddress', args: [key] }) as Promise<Address>,
      ))

      const owned = new Set<string>()
      if (factory && factory !== ZERO_ADDRESS) {
        const candidates = await publicClient.readContract({ address: factory, abi: ValidatorWalletFactoryABI, functionName: 'getWalletsForOperator', args: [address] }) as Address[]
        for (const candidate of candidates) owned.add(candidate.toLowerCase())
      }

      if (owned.size === 0 && staking && staking !== ZERO_ADDRESS) {
        for (let page = 0; page < MAX_PAGES; page++) {
          const batch = await publicClient.readContract({ address: staking, abi: StakingABI, functionName: 'getValidatorsJoined', args: [BigInt(page) * PAGE, PAGE] }) as Address[]
          if (batch.length === 0) break
          for (const candidate of batch) owned.add(candidate.toLowerCase())
          if (BigInt(batch.length) < PAGE) break
        }
      }

      // Ownership is the qualifier, and pass 1 selected on OPERATOR, so every
      // candidate is confirmed against owner() before it is offered.
      const confirmed: Address[] = []
      await Promise.all([...owned].map(async (candidate) => {
        try {
          const owner = await publicClient.readContract({ address: candidate as Address, abi: ValidatorWalletABI, functionName: 'owner' }) as Address
          if (owner.toLowerCase() === address.toLowerCase()) confirmed.push(candidate as Address)
        } catch { /* not a validator wallet, or no owner() — skip */ }
      }))

      const detailed = await Promise.all(confirmed.sort().map(async (wallet): Promise<ValidatorWalletVoter> => {
        const [weight, hasVoted, delegatee] = await Promise.all([
          publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'getPastVotesForGovernance', args: [wallet, snapshot] }) as Promise<bigint>,
          proposalId === undefined
            ? Promise.resolve(false)
            : publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'hasVoted', args: [proposalId, wallet] }) as Promise<boolean>,
          publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName: 'delegates', args: [wallet] }) as Promise<Address>,
        ])
        // A wallet delegating to a THIRD party has handed its weight away and
        // would revert ZeroWeight; self-delegation is the ordinary case.
        const delegatedAway = delegatee !== ZERO_ADDRESS && delegatee.toLowerCase() !== wallet.toLowerCase()
        return { address: wallet, weight, hasVoted, delegatedTo: delegatedAway ? delegatee : undefined }
      }))
      setWallets(detailed)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [address, addressManager, voting, currentSet, proposalId, snapshot])

  useEffect(() => { void refresh() }, [refresh])
  return { wallets, loading, error, refresh }
}
