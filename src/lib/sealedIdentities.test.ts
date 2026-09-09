import { describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { describeSeal, GOVERNANCE_KEYS, resolveGovernanceIdentities, type GovernanceKey } from './sealedIdentities'
import { ZERO_ADDRESS } from './governance'

const at = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

/** A book that answers each key with a distinct address, minus `absent`. */
function book(absent: GovernanceKey[] = []) {
  const answers: Record<string, Address> = {}
  GOVERNANCE_KEYS.forEach((entry, index) => { answers[entry.key] = absent.includes(entry.key) ? ZERO_ADDRESS : at(index + 1) })
  return vi.fn(async (key: GovernanceKey) => answers[key])
}

describe('the nine sealed governance keys (CON-865, spec §1.3)', () => {
  it('are exactly the keys GovernanceClassRegistry._governanceKeys() names, six required and three optional', () => {
    expect(GOVERNANCE_KEYS.map((entry) => entry.key)).toEqual([
      'Governance', 'GovernanceVoting', 'GovernanceVotingPower', 'GovernanceGESRegistry', 'GovernanceClassRegistry', 'GovernanceClock',
      'SecurityCouncil', 'GovernanceCouncilElections', 'GovernanceL1Bridge',
    ])
    expect(GOVERNANCE_KEYS.filter((entry) => !entry.required).map((entry) => entry.key)).toEqual(['SecurityCouncil', 'GovernanceCouncilElections', 'GovernanceL1Bridge'])
  })

  it('resolves every identity with one getAddress per key and maps keys to roles', async () => {
    const read = book()
    const { identities, entries } = await resolveGovernanceIdentities(read)
    expect(read).toHaveBeenCalledTimes(9)
    expect(read.mock.calls.map(([key]) => key)).toEqual(GOVERNANCE_KEYS.map((entry) => entry.key))
    expect(identities).toEqual({
      executor: at(1), voting: at(2), votingPower: at(3), gesRegistry: at(4), classRegistry: at(5), clock: at(6),
      council: at(7), elections: at(8), l1Bridge: at(9),
    })
    expect(entries).toHaveLength(9)
    expect(entries.find((entry) => entry.key === 'SecurityCouncil')).toMatchObject({ member: 'council', required: false, address: at(7) })
  })

  it('reads a zero optional member as "never selected" rather than an address', async () => {
    const { identities, entries } = await resolveGovernanceIdentities(book(['SecurityCouncil', 'GovernanceL1Bridge']))
    expect(identities.council).toBeUndefined()
    expect(identities.l1Bridge).toBeUndefined()
    expect(identities.elections).toBe(at(8))
    expect('council' in identities).toBe(false)
    expect(entries.find((entry) => entry.key === 'GovernanceL1Bridge')?.address).toBeUndefined()
  })

  it('refuses a book that omits a required identity, and names it', async () => {
    await expect(resolveGovernanceIdentities(book(['GovernanceClock']))).rejects.toThrow(/missing required governance identities: GovernanceClock\./)
    await expect(resolveGovernanceIdentities(book(['GovernanceVoting', 'GovernanceClassRegistry']))).rejects.toThrow(/GovernanceVoting, GovernanceClassRegistry/)
  })

  it('says plainly when the book carries no governance deployment at all', async () => {
    const empty = vi.fn(async () => ZERO_ADDRESS)
    await expect(resolveGovernanceIdentities(empty)).rejects.toThrow(/does not name the governance contracts/)
  })

  it('tolerates a checksummed or lower-cased zero answer alike', async () => {
    const read = book()
    read.mockImplementationOnce(async () => '0x0000000000000000000000000000000000000000' as Address)
    // Governance is required, so a zero for it is a refusal, not a silent gap
    await expect(resolveGovernanceIdentities(read)).rejects.toThrow(/Governance\./)
  })
})

describe('describeSeal', () => {
  it('distinguishes sealed, unsealed and unreadable, never conflating the last with either', () => {
    expect(describeSeal({ sealed: true })).toMatch(/^Sealed/)
    expect(describeSeal({ sealed: false })).toMatch(/^Not sealed/)
    expect(describeSeal(undefined)).toMatch(/not readable/)
  })
})
