import { describe, expect, it } from 'vitest'
import { ballotRoute, delegateRoute, identityBlockReason, voteRoute, type VoterIdentity } from './identity'

const VOTING = '0x0000000000000000000000000000000000000001'
const POWER = '0x0000000000000000000000000000000000000002'
const ELECTIONS = '0x0000000000000000000000000000000000000003'
const EOA = '0x00000000000000000000000000000000000000aa'
const WALLET = '0x00000000000000000000000000000000000000bb'
const VESTING = '0x00000000000000000000000000000000000000cc'
const DELEGATE = '0x00000000000000000000000000000000000000dd'
const identities: VoterIdentity[] = [
  { kind: 'eoa', address: EOA },
  { kind: 'validatorWallet', address: WALLET, owner: EOA },
  { kind: 'vesting', address: VESTING, beneficiary: EOA, revoked: false },
]

describe('identity routes (CON-864 #8)', () => {
  it('votes through the identity that holds the weight, in the form each contract expects', () => {
    expect(voteRoute(identities[0], VOTING, 7n, 1, '')).toEqual({ address: VOTING, abi: 'voting', functionName: 'castVote', args: [7n, 1] })
    expect(voteRoute(identities[0], VOTING, 7n, 1, 'why')).toEqual({ address: VOTING, abi: 'voting', functionName: 'castVoteWithReason', args: [7n, 1, 'why'] })
    // the passthroughs are always the 3-arg form; '' is "no reason"
    expect(voteRoute(identities[1], VOTING, 7n, 0, '')).toEqual({ address: WALLET, abi: 'validatorWallet', functionName: 'govCastVote', args: [7n, 0, ''] })
    expect(voteRoute(identities[2], VOTING, 7n, 2, 'r')).toEqual({ address: VESTING, abi: 'vesting', functionName: 'vestingGovCastVote', args: [7n, 2, 'r'] })
  })

  it('delegates and ballots through the same three targets', () => {
    expect(delegateRoute(identities[0], POWER, DELEGATE)).toMatchObject({ address: POWER, functionName: 'delegate' })
    expect(delegateRoute(identities[1], POWER, DELEGATE)).toMatchObject({ address: WALLET, functionName: 'govDelegate', args: [DELEGATE] })
    expect(delegateRoute(identities[2], POWER, DELEGATE)).toMatchObject({ address: VESTING, functionName: 'vestingGovDelegate' })
    expect(ballotRoute(identities[0], ELECTIONS, 1n, [DELEGATE])).toMatchObject({ address: ELECTIONS, functionName: 'castBallot', args: [1n, [DELEGATE]] })
    expect(ballotRoute(identities[1], ELECTIONS, 1n, [DELEGATE])).toMatchObject({ functionName: 'govCastBallot' })
    expect(ballotRoute(identities[2], ELECTIONS, 1n, [DELEGATE])).toMatchObject({ functionName: 'vestingGovCastBallot' })
  })

  it('names the first thing the contract would refuse, and nothing when usable', () => {
    const short = (address: string) => address.slice(0, 6)
    expect(identityBlockReason({ hasVoted: true, weight: 0n, revoked: true }, short)).toBe('Already voted')
    expect(identityBlockReason({ hasVoted: false, weight: 5n, revoked: true }, short)).toBe('Vesting revoked')
    expect(identityBlockReason({ hasVoted: false, weight: 5n, delegatedTo: DELEGATE }, short)).toBe('Delegated to 0x0000')
    expect(identityBlockReason({ hasVoted: false, weight: 0n }, short)).toBe('No weight at snapshot')
    expect(identityBlockReason({ hasVoted: false, weight: 5n }, short)).toBe('')
  })
})
