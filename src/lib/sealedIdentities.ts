import type { Address, Hex } from 'viem'
import { ZERO_ADDRESS } from './governance'

/**
 * The sealed governance identities (CON-865, spec §1.3, ADR-038).
 *
 * The governance stack has nine identities and each is one key of the
 * protocol AddressManager. A deployment registers them during bootstrap and
 * then `seal()`s the book; after the seal no key can be added, replaced or
 * cleared, by anyone. There is no ContractSet, no set hash, no per-proposal
 * pinning and no activation step — every contract resolves its peers from
 * the book at call time, and so does this UI.
 *
 * The key strings are the contracts' own: `GovernanceClassRegistry
 * ._governanceKeys()` on genlayer-consensus#1572 lists exactly these nine.
 *
 * Six are required: when `GovernanceVoting` is registered the seal enforces
 * the other five core keys non-zero (§1.3 invariant 9). Three are optional
 * members — `SecurityCouncil`, `GovernanceCouncilElections`,
 * `GovernanceL1Bridge` — where a zero entry after the seal means "never
 * selected", not "not yet".
 */
export const GOVERNANCE_KEYS = [
  { key: 'Governance', member: 'executor', required: true, label: 'Governance executor' },
  { key: 'GovernanceVoting', member: 'voting', required: true, label: 'Voting' },
  { key: 'GovernanceVotingPower', member: 'votingPower', required: true, label: 'Voting-power ledger' },
  { key: 'GovernanceGESRegistry', member: 'gesRegistry', required: true, label: 'GES registry' },
  { key: 'GovernanceClassRegistry', member: 'classRegistry', required: true, label: 'Class registry' },
  { key: 'GovernanceClock', member: 'clock', required: true, label: 'Clock' },
  { key: 'SecurityCouncil', member: 'council', required: false, label: 'Security Council' },
  { key: 'GovernanceCouncilElections', member: 'elections', required: false, label: 'Council elections' },
  { key: 'GovernanceL1Bridge', member: 'l1Bridge', required: false, label: 'L1 bridge' },
] as const

export type GovernanceKey = (typeof GOVERNANCE_KEYS)[number]['key']
export type GovernanceMember = (typeof GOVERNANCE_KEYS)[number]['member']

/** The nine identities by role. Optional members are absent when the book names nobody. */
export interface GovernanceIdentities {
  executor: Address
  voting: Address
  votingPower: Address
  gesRegistry: Address
  classRegistry: Address
  clock: Address
  council?: Address
  elections?: Address
  l1Bridge?: Address
}

/** One row of the book as the UI shows it: the key, and what it resolved to. */
export interface BookEntry {
  key: GovernanceKey
  member: GovernanceMember
  label: string
  required: boolean
  /** undefined when the book answers the zero address */
  address?: Address
}

/** What `AddressManager.isSealed()` / `manifestCommitment()` answered, when the book exposes them. */
export interface SealStatus {
  sealed: boolean
  manifestCommitment?: Hex
}

export interface SealedBook {
  entries: BookEntry[]
  identities: GovernanceIdentities
}

/**
 * Resolve the nine identities through `readKey`, one `getAddress(key)` each.
 *
 * Pure apart from the reads, so the mapping and the required/optional rule
 * can be tested with a stub. Throws when a required key is zero: that book
 * does not carry a governance deployment (or carries a partial one), and a
 * UI that went on would fail on the first read anyway, with a worse message.
 */
export async function resolveGovernanceIdentities(readKey: (key: GovernanceKey) => Promise<Address>): Promise<SealedBook> {
  const answers = await Promise.all(GOVERNANCE_KEYS.map((entry) => readKey(entry.key)))
  const entries: BookEntry[] = GOVERNANCE_KEYS.map((entry, index) => {
    const answer = answers[index]
    const address = answer && answer.toLowerCase() !== ZERO_ADDRESS ? answer : undefined
    return { key: entry.key, member: entry.member, label: entry.label, required: entry.required, address }
  })
  const missing = entries.filter((entry) => entry.required && !entry.address)
  if (missing.length === GOVERNANCE_KEYS.filter((entry) => entry.required).length) {
    throw new Error('This AddressManager does not name the governance contracts.')
  }
  if (missing.length > 0) {
    throw new Error(`This AddressManager is missing required governance identities: ${missing.map((entry) => entry.key).join(', ')}.`)
  }
  const identities = Object.fromEntries(entries.filter((entry) => entry.address).map((entry) => [entry.member, entry.address])) as unknown as GovernanceIdentities
  return { entries, identities }
}

/** The human-facing verdict for the seal, shown next to the nine rows. */
export function describeSeal(seal: SealStatus | undefined): string {
  if (!seal) return 'Seal status is not readable on this AddressManager.'
  if (seal.sealed) return 'Sealed: no key can be added, replaced or cleared, by anyone.'
  return 'Not sealed: bootstrap is still open and these identities can still change.'
}
