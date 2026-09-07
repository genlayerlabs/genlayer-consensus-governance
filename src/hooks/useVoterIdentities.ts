import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import AddressManagerABI from '@/abi/AddressManager.json'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import StakingABI from '@/abi/Staking.json'
import ValidatorWalletABI from '@/abi/ValidatorWallet.json'
import ValidatorWalletFactoryABI from '@/abi/ValidatorWalletFactory.json'
import VestingABI from '@/abi/Vesting.json'
import VestingFactoryABI from '@/abi/VestingFactory.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { ZERO_ADDRESS } from '@/lib/governance'
import type { VoterIdentity } from '@/lib/identity'

export type IdentityState = VoterIdentity & {
  /** weight AT THE SNAPSHOT — never the live figure; live only when no snapshot is given */
  weight: bigint
  hasVoted: boolean
  /** non-null when the identity handed its weight to someone else */
  delegatedTo?: Address
  /** for a validator wallet owned by the connected account's VESTING: votable by nobody from a browser */
  unreachable?: string
}

const PAGE = 200n
// 25 x 200 = 5,000 validators. The old ceiling of 5 pages silently stopped
// at 1,000, which would hide a wallet rather than report a partial list.
const MAX_PAGES = 25

/**
 * Every identity the connected account may vote, delegate or ballot AS.
 *
 * Pass 0 (CON-864 #8): the account's Vesting contract, where the
 * AddressManager names a VestingFactory. Voting power belongs to whoever
 * holds the stake, so vested tokens vote through the Vesting's own
 * onlyBeneficiary passthroughs. A deployment without the key simply has no
 * vesting identities to offer. Validator wallets the vesting owns are listed
 * too, DISABLED: Vesting has no passthrough to its wallets' govCastVote, so
 * that weight is votable by nobody from a browser — shown rather than hidden.
 *
 * Passes 1–2: the validator wallets the account OWNS. Governance rights on a
 * wallet are onlyOwner (the operator runs consensus and has no say), and
 * ValidatorWalletFactory indexes by OPERATOR with no owner index, so:
 *   1. getWalletsForOperator(account) — the common owner==operator case;
 *   2. otherwise enumerate Staking.getValidatorsJoined and keep the wallets
 *      whose owner() is the account — the only way a custodian who hired an
 *      operator is found at all. Paged views, so the getLogs cap never applies.
 *
 * `snapshot` selects the proposal's vote-start weight (or an election's);
 * `proposalId` / `electionId` select which "already voted" is asked.
 */
export function useVoterIdentities(options: { proposalId?: bigint; electionId?: bigint; snapshot?: bigint } = {}) {
  const { proposalId, electionId, snapshot } = options
  const { address } = useWallet()
  const { addressManager, voting, vestingFactory, currentSet } = useContracts()
  const [identities, setIdentities] = useState<IdentityState[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!address || !addressManager || !voting || !currentSet) { setIdentities([]); return }
    setLoading(true); setError(undefined)
    try {
      const votingPower = currentSet.votingPower
      const weightOf = (account: Address) => (snapshot === undefined
        ? publicClient.readContract({ address: votingPower, abi: GovernanceVotingPowerABI, functionName: 'getVotes', args: [account] } as never)
        : publicClient.readContract({ address: votingPower, abi: GovernanceVotingPowerABI, functionName: 'getPastVotesForGovernance', args: [account, snapshot] } as never)) as Promise<bigint>
      const votedOf = (account: Address) => proposalId !== undefined
        ? publicClient.readContract({ address: voting, abi: GovernanceVotingABI, functionName: 'hasVoted', args: [proposalId, account] } as never) as Promise<boolean>
        : electionId !== undefined && currentSet.elections
          ? publicClient.readContract({ address: currentSet.elections, abi: GovernanceCouncilElectionsABI, functionName: 'hasBalloted', args: [electionId, account] } as never) as Promise<boolean>
          : Promise.resolve(false)
      const delegateOf = (account: Address) => publicClient.readContract({ address: votingPower, abi: GovernanceVotingPowerABI, functionName: 'delegates', args: [account] } as never) as Promise<Address>
      const detail = async (identity: VoterIdentity, unreachable?: string): Promise<IdentityState> => {
        const [weight, hasVoted, delegatee] = await Promise.all([weightOf(identity.address), votedOf(identity.address), delegateOf(identity.address)])
        // Delegating to a THIRD party hands the weight away (voting would
        // revert ZeroWeight); self-delegation is the ordinary case.
        const delegatedAway = delegatee !== ZERO_ADDRESS && delegatee.toLowerCase() !== identity.address.toLowerCase()
        return { ...identity, weight, hasVoted, delegatedTo: delegatedAway ? delegatee : undefined, unreachable }
      }

      const rows: Promise<IdentityState>[] = [detail({ kind: 'eoa', address })]

      // pass 0: the vesting, where a factory is registered
      if (vestingFactory) {
        const vesting = await publicClient.readContract({ address: vestingFactory, abi: VestingFactoryABI, functionName: 'getVesting', args: [address] } as never).catch(() => ZERO_ADDRESS) as Address
        if (vesting !== ZERO_ADDRESS) {
          const [beneficiary, revoked, vestedWallets] = await Promise.all([
            publicClient.readContract({ address: vesting, abi: VestingABI, functionName: 'beneficiary' } as never) as Promise<Address>,
            publicClient.readContract({ address: vesting, abi: VestingABI, functionName: 'revoked' } as never).catch(() => false) as Promise<boolean>,
            publicClient.readContract({ address: vesting, abi: VestingABI, functionName: 'getValidatorWallets' } as never).catch(() => []) as Promise<Address[]>,
          ])
          if (beneficiary.toLowerCase() === address.toLowerCase()) {
            rows.push(detail({ kind: 'vesting', address: vesting, beneficiary, revoked }))
            for (const wallet of vestedWallets) rows.push(detail({ kind: 'validatorWallet', address: wallet, owner: vesting }, 'Owned by your vesting contract, which has no passthrough for wallet votes'))
          }
        }
      }

      // passes 1–2: owned validator wallets
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
      for (const wallet of confirmed.sort()) rows.push(detail({ kind: 'validatorWallet', address: wallet, owner: address }))

      setIdentities(await Promise.all(rows))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [address, addressManager, voting, vestingFactory, currentSet, proposalId, electionId, snapshot])

  useEffect(() => { void refresh() }, [refresh])
  return { identities, loading, error, refresh, vestingSupported: Boolean(vestingFactory) }
}
