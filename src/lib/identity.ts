import type { Address } from 'viem'
import type { AbiKey } from './abis'

/**
 * The identities a connected account may act AS.
 *
 * Voting power belongs to whoever holds the stake position, so it can sit on
 * three kinds of address the browser wallet controls only indirectly:
 * - the EOA itself;
 * - a validator wallet the EOA OWNS (governance rights are onlyOwner: the
 *   operator runs consensus and has no say);
 * - a Vesting contract the EOA is the beneficiary of (three onlyBeneficiary
 *   passthroughs; revoked vestings refuse them).
 *
 * Each routes the same intent to a different target and function; the pure
 * helpers below compute the route so the pages only choose an identity.
 */
export type VoterIdentity =
  | { kind: 'eoa'; address: Address }
  | { kind: 'validatorWallet'; address: Address; owner: Address }
  | { kind: 'vesting'; address: Address; beneficiary: Address; revoked: boolean }

export interface IdentityRoute { address: Address; abi: AbiKey; functionName: string; args: readonly unknown[] }

export const IDENTITY_KIND_LABELS: Record<VoterIdentity['kind'], string> = { eoa: 'Connected account', validatorWallet: 'Validator', vesting: 'Vesting' }

/** castVote / castVoteWithReason on the voting contract, or the identity's passthrough (always the 3-arg form; '' = no reason). */
export function voteRoute(identity: VoterIdentity, voting: Address, proposalId: bigint, support: number, reason: string): IdentityRoute {
  switch (identity.kind) {
    case 'eoa': return reason
      ? { address: voting, abi: 'voting', functionName: 'castVoteWithReason', args: [proposalId, support, reason] }
      : { address: voting, abi: 'voting', functionName: 'castVote', args: [proposalId, support] }
    case 'validatorWallet': return { address: identity.address, abi: 'validatorWallet', functionName: 'govCastVote', args: [proposalId, support, reason] }
    case 'vesting': return { address: identity.address, abi: 'vesting', functionName: 'vestingGovCastVote', args: [proposalId, support, reason] }
  }
}

export function delegateRoute(identity: VoterIdentity, votingPower: Address, to: Address): IdentityRoute {
  switch (identity.kind) {
    case 'eoa': return { address: votingPower, abi: 'votingPower', functionName: 'delegate', args: [to] }
    case 'validatorWallet': return { address: identity.address, abi: 'validatorWallet', functionName: 'govDelegate', args: [to] }
    case 'vesting': return { address: identity.address, abi: 'vesting', functionName: 'vestingGovDelegate', args: [to] }
  }
}

export function ballotRoute(identity: VoterIdentity, elections: Address, electionId: bigint, candidates: Address[]): IdentityRoute {
  switch (identity.kind) {
    case 'eoa': return { address: elections, abi: 'elections', functionName: 'castBallot', args: [electionId, candidates] }
    case 'validatorWallet': return { address: identity.address, abi: 'validatorWallet', functionName: 'govCastBallot', args: [electionId, candidates] }
    case 'vesting': return { address: identity.address, abi: 'vesting', functionName: 'vestingGovCastBallot', args: [electionId, candidates] }
  }
}

/**
 * Why an identity cannot act right now, or '' when it can. Listed rather than
 * hidden: an owner must see WHY a validator or vesting cannot vote. Precedence
 * follows what the contract would revert on first.
 */
export function identityBlockReason(state: { hasVoted: boolean; delegatedTo?: Address; weight: bigint; revoked?: boolean }, short: (address: Address) => string): string {
  if (state.hasVoted) return 'Already voted'
  if (state.revoked) return 'Vesting revoked'
  if (state.delegatedTo) return `Delegated to ${short(state.delegatedTo)}`
  if (state.weight === 0n) return 'No weight at snapshot'
  return ''
}
