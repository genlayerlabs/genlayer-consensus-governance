import type { Abi } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import ValidatorWalletABI from '@/abi/ValidatorWallet.json'
import VestingABI from '@/abi/Vesting.json'

/** Named ABIs, so a route computed in pure code can name its ABI without importing JSON. */
export type AbiKey = 'voting' | 'votingPower' | 'elections' | 'validatorWallet' | 'vesting'

export const ABI_BY_KEY: Record<AbiKey, Abi> = {
  voting: GovernanceVotingABI as Abi,
  votingPower: GovernanceVotingPowerABI as Abi,
  elections: GovernanceCouncilElectionsABI as Abi,
  validatorWallet: ValidatorWalletABI as Abi,
  vesting: VestingABI as Abi,
}
