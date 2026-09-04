import { parseEther } from 'viem'
import { describe, expect, it } from 'vitest'
import { ACTION_TYPE_NAMES, actionThreshold, ELECTION_KIND_NAMES, ELECTION_STATE_NAMES, electionNextAction, describeActionData, encodeActionData, descriptionHash, encodeOperation, formatDate, formatGen, preserveAlignedBlocks, voteVerdict, payloadHash, titleFromDescription, voteChecks, ZERO_HASH,
  ACTION_PROPOSAL_STATES, actionProposalId, actionProposalRequirement, truncate } from './governance'

describe('governance helpers', () => {
  it('extracts a safe title with a proposal fallback', () => {
    expect(titleFromDescription('\n# **Upgrade the executor**\nBody', 7n)).toBe('Upgrade the executor')
    expect(titleFromDescription('   ', 7n)).toBe('Proposal #7')
  })

  it('uses exact GES cross multiplication for passage checks', () => {
    const rules = { quorumBps: 800, forFloorBps: 500, thresholdNum: 1, thresholdDen: 2, requiresRiskReview: false, vetoWindow: 0, extendedVetoWindow: 0, reviewWindow: 0, executionWindow: 0, preparation: 0, votingPeriod: 0, lateQuorumWindow: 0 }
    expect(voteChecks({ for: 51n, against: 49n, abstain: 0n }, rules, 1_001n)).toMatchObject({ quorumRequired: 81n, floorRequired: 51n, quorumMet: true, floorMet: true, thresholdMet: true })
    expect(voteChecks({ for: 50n, against: 50n, abstain: 0n }, rules, 1_001n).thresholdMet).toBe(false)
  })

  it('encodes operations and commitments deterministically', () => {
    const operation = encodeOperation({ target: '0x0000000000000000000000000000000000000001', mode: 'abi', signature: 'setValue(uint256)', argsJson: '[42]', rawSelector: '0x', rawArgs: '0x', value: '0' })
    expect(operation.selector).toHaveLength(10)
    expect(operation.args).toHaveLength(66)
    expect(payloadHash([operation])).toMatch(/^0x[0-9a-f]{64}$/)
    expect(payloadHash([])).toBe(ZERO_HASH)
    expect(descriptionHash('# Test')).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('formats large GEN values without unsafe Number conversion', () => {
    expect(formatGen(parseEther('462000000.125'), 3)).toBe('462,000,000.125')
  })

  it('encodes council actionData to the exact width each type is validated against', () => {
    // _validateActionData checks an EXACT byte length per type, so a wrong
    // shape reverts rather than creating a malformed action.
    const bytes = (hex: string) => (hex.length - 2) / 2
    expect(bytes(encodeActionData(3, { proposalId: '2' }))).toBe(32)   // RiskReview
    expect(bytes(encodeActionData(0, { proposalId: '2' }))).toBe(32)   // DesignateSpam
    expect(bytes(encodeActionData(2, { proposalId: '2', newClass: '1' }))).toBe(64) // RaiseClass
    expect(bytes(encodeActionData(4, { payloadHash: `0x${'11'.repeat(32)}`, approvalExpiry: '99' }))).toBe(64)
    expect(bytes(encodeActionData(5, { freezeKind: 1 }))).toBe(32)     // Freeze
    expect(encodeActionData(6, {})).toBe('0x')                          // Unfreeze — exactly empty
  })

  it('keeps the ActionType order the enum uses, not the order the prose lists', () => {
    // RaiseClass is 2 and RiskReview is 3. Swapping them silently creates the
    // wrong action, which is why this is pinned.
    expect(ACTION_TYPE_NAMES[2]).toBe('Raise class')
    expect(ACTION_TYPE_NAMES[3]).toBe('Risk Review')
    expect(ACTION_TYPE_NAMES[6]).toBe('Unfreeze')
  })

  it('round-trips an action payload back into something readable', () => {
    expect(describeActionData(3, encodeActionData(3, { proposalId: '7' }))).toContain('#7')
    expect(describeActionData(5, encodeActionData(5, { freezeKind: 1 }))).toMatch(/hard/i)
    expect(describeActionData(6, '0x')).toMatch(/freeze/i)
    // malformed data must degrade to the raw hex, never throw into the render
    expect(describeActionData(2, '0x1234')).toBe('0x1234')
  })

  it('picks the freeze threshold from the action payload, not just its type', () => {
    const t = { standard: 5, emergency: 7, freezeSoft: 5, freezeHard: 7 }
    expect(actionThreshold(3, t)).toBe(5)             // Risk Review → standard
    expect(actionThreshold(4, t)).toBe(7)             // EmergencyApprove → emergency
    expect(actionThreshold(5, t, 0)).toBe(5)          // soft freeze
    expect(actionThreshold(5, t, 1)).toBe(7)          // hard freeze — same type, different threshold
  })

  it('pins the election enums, which state() and ElectionStarted index into', () => {
    // Scheduled is declared but state() never returns it, so index 1 is the
    // first state actually observable — an off-by-one here mislabels everything.
    expect(ELECTION_STATE_NAMES[0]).toBe('Scheduled')
    expect(ELECTION_STATE_NAMES[1]).toBe('Nomination')
    expect(ELECTION_STATE_NAMES[4]).toBe('Succeeded')
    expect(ELECTION_STATE_NAMES[6]).toBe('Settled')
    expect(ELECTION_KIND_NAMES[0]).toBe('Bootstrap')
    expect(ELECTION_KIND_NAMES[4]).toBe('Runoff')
    // Succeeded is transient and can still fail at settle, so its next action
    // must not read as "won"
    expect(electionNextAction(4)).toMatch(/settle/i)
    expect(electionNextAction(5)).toMatch(/quorum/i)
  })

  it('names the timezone so a shared deadline is unambiguous', () => {
    // The zone marker is locale-dependent (GMT-3, UTC, PST…), so assert that
    // one is present rather than pinning a value the CI box would not share.
    const formatted = formatDate(1_788_531_754)
    expect(formatted).toMatch(/\d/)
    expect(formatted).toMatch(/GMT|UTC|[A-Z]{2,5}$/)
    expect(formatDate(0)).toBe('—')
  })

  it('states an explicit verdict, including the cases a rule list hides', () => {
    const rules = { quorumBps: 800, forFloorBps: 500, thresholdNum: 1, thresholdDen: 2, requiresRiskReview: false, vetoWindow: 0, extendedVetoWindow: 0, reviewWindow: 0, executionWindow: 0, preparation: 0, votingPeriod: 0, lateQuorumWindow: 0 }
    const at = (state: number, v: { for: bigint; against: bigint; abstain: bigint }) =>
      voteVerdict(state, v, voteChecks(v, rules, 1_000n))

    // a tie fails: approval needs STRICTLY more than the threshold
    const tie = at(2, { for: 300n, against: 300n, abstain: 0n })
    expect(tie.outcome).toBe('defeated')
    expect(tie.reason).toMatch(/tied/i)

    // no quorum is distinct from losing the head-to-head
    const thin = at(2, { for: 10n, against: 0n, abstain: 0n })
    expect(thin.reason).toMatch(/quorum/i)

    // abstain-only reaches quorum but decides nothing
    const abstained = at(2, { for: 0n, against: 0n, abstain: 900n })
    expect(abstained.reason).toMatch(/Abstain/i)

    // queued is final and won; active is provisional
    expect(at(8, { for: 900n, against: 1n, abstain: 0n })).toMatchObject({ outcome: 'passed', final: true })
    expect(at(1, { for: 900n, against: 1n, abstain: 0n })).toMatchObject({ outcome: 'undecided', final: false })
    // a veto beats a winning tally, and says so
    expect(at(5, { for: 900n, against: 1n, abstain: 0n }).headline).toMatch(/veto/i)
  })

  it('fences hand-aligned box-drawing tables so markdown cannot reflow them', () => {
    const table = ['┌──────┬───────┐', '│ Key  │ Value │', '└──────┴───────┘'].join('\n')
    const out = preserveAlignedBlocks(`# Title\n\ntext\n\n${table}\n\ntail`)
    expect(out).toContain('```text\n┌──────┬───────┐')
    expect(out).toContain('└──────┴───────┘\n```')
    // prose is untouched
    expect(out).toContain('# Title')
    expect(out).toContain('tail')
  })

  it('leaves an existing code fence alone', () => {
    const input = '```\n┌──┐\n└──┘\n```'
    expect(preserveAlignedBlocks(input)).toBe(input)
  })

  it('keeps sub-unit amounts legible instead of rendering a bare 0', () => {
    // The proposal bond is 0.1% of GES, so a small GES puts it below the
    // default two decimals; truncating it to "0" read as "no bond required".
    expect(formatGen(parseEther('0.005'))).toBe('0.005')
    expect(formatGen(parseEther('0.05'))).toBe('0.05')
    expect(formatGen(1n)).toBe('0.000000000000000001')
    // a genuine zero stays bare, and whole amounts keep the 2-digit default
    expect(formatGen(0n)).toBe('0')
    expect(formatGen(parseEther('1501'))).toBe('1,501')
    expect(formatGen(parseEther('1234.5678'))).toBe('1,234.56')
  })

  it('offers a council action only the proposal states it can target', () => {
    // Enforced in three different places: designateSpam and raiseClass demand
    // Pending, voidProposal demands Active — all at EXECUTION, so a wrong pick
    // survives creation and the whole approval round before reverting
    // WrongState. RiskReview is checked in createAction itself.
    expect(ACTION_PROPOSAL_STATES[0]).toEqual([0]) // DesignateSpam -> Pending
    expect(ACTION_PROPOSAL_STATES[1]).toEqual([1]) // VoidProposal  -> Active
    expect(ACTION_PROPOSAL_STATES[2]).toEqual([0]) // RaiseClass    -> Pending
    expect(ACTION_PROPOSAL_STATES[3]).toEqual([6, 7]) // RiskReview -> Risk Review or Timelock
    // the types that reference no proposal must stay absent, or the picker
    // would demand one for a Freeze and never enable the button
    for (const type of [4, 5, 6]) expect(ACTION_PROPOSAL_STATES[type]).toBeUndefined()
    expect(actionProposalRequirement(1)).toBe('Active')
    expect(actionProposalRequirement(3)).toBe('Risk Review or Timelock')
    expect(actionProposalRequirement(6)).toBe('')
  })

  it('keeps a truncated label inside its budget, ellipsis included', () => {
    // The ellipsis is part of the allowance, not added on top of it — a
    // <select> is sized by its widest option, so an over-budget result would
    // still push the panel past its column.
    const title = 'Grant the quarantine manager role to the governance operations account'
    expect(truncate(title, 48)).toHaveLength(48)
    expect(truncate(title, 48).endsWith('…')).toBe(true)
    // exactly at the limit is left alone, and no space is stranded before the ellipsis
    expect(truncate('12345', 5)).toBe('12345')
    expect(truncate('12345', 4)).toBe('123…')
    expect(truncate('ab cdef', 4)).toBe('ab…')
  })

  it('recovers the targeted proposal id only for the types that carry one', () => {
    const encoded = encodeActionData(3, { proposalId: '3' })
    expect(actionProposalId(3, encoded)).toBe(3n)
    // RaiseClass appends a class byte; the id is still the first word
    expect(actionProposalId(2, encodeActionData(2, { proposalId: '7', newClass: '1' }))).toBe(7n)
    // Freeze/Unfreeze carry no proposal — decoding their data as a uint256
    // would yield the freeze kind and label an action with the wrong proposal
    expect(actionProposalId(5, encodeActionData(5, { freezeKind: 1 }))).toBeUndefined()
    expect(actionProposalId(6, '0x')).toBeUndefined()
    // malformed data renders a row, it does not throw the page away
    expect(actionProposalId(3, '0x1234')).toBeUndefined()
  })
})
