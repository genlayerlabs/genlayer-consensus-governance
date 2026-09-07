import { parseEther } from 'viem'
import { describe, expect, it } from 'vitest'
import { ACTION_TYPE_NAMES, actionThreshold, ELECTION_KIND_NAMES, ELECTION_STATE_NAMES, electionCranks, electionNextAction, describeActionData, encodeActionData, descriptionHash, encodeOperation, formatDate, formatGen, preserveAlignedBlocks, voteVerdict, payloadHash, titleFromDescription, voteChecks, ZERO_HASH,
  ACTION_PROPOSAL_STATES, actionProposalId, actionProposalRequirement, errorMessage, throttleBackoffMs, truncate,
  MANIFESTO_MAX_BYTES, manifestoWithinLimit, nominationCost, wrongPaymentRequired,
  elapsedUnfrozen, electionBounds, electionCountdown, electionInstant, electionQuorumMet, electionQuorumRequired, electionStateOf, electionSubPhase, electionVerdict, formatRelative, normalizeElection, resolveEffectiveInstant } from './governance'

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

  it('reads a node throttle as a retry, not as a governance refusal', () => {
    // viem labels a failed eth_sendRawTransaction "the contract function
    // reverted", so a capacity limit arrives looking exactly like a permission
    // error — and this one names approveAction, whose real refusals (NotSitting,
    // StaleRoster) would otherwise be the obvious reading.
    const raw = 'The contract function "approveAction" reverted with the following reason:\n'
      + 'RPC 0x107d Custom eth_sendRawTransaction: server returned an error response: '
      + 'error code -32005: transaction gas rate limit exceeded: node is at capacity, '
      + 'retry in ~1111ms, data: {"retryAfterMs":1111}'
    const message = errorMessage(new Error(raw))
    expect(message).toContain('node is at capacity')
    expect(message).toContain('1.1 seconds')
    expect(message).toContain('nothing was submitted')
    // and a real revert is still translated, not swallowed by the throttle branch
    expect(errorMessage(new Error('reverted: NotSitting()'))).toContain('requires a seat with status Active')
  })

  it('reports the node\'s own backoff so a retry can honour it', () => {
    expect(throttleBackoffMs(new Error('error code -32005: ... {"retryAfterMs":642}'))).toBe(642)
    // throttled without a stated delay is still throttled — 0, not undefined,
    // or the caller would treat it as a real revert and stop retrying
    expect(throttleBackoffMs(new Error('node is at capacity'))).toBe(0)
    // and a genuine refusal must never be retried
    expect(throttleBackoffMs(new Error('reverted: NotSitting()'))).toBeUndefined()
  })

  it('offers one crank per phase, and none where a phase needs no transaction', () => {
    // startEndorsement is IDEMPOTENT: calling it twice succeeds silently, so
    // neither a revert nor a simulation would catch a duplicate — the phase is
    // the only thing that can withhold the button.
    expect(electionCranks(1).map((crank) => crank.fn)).toEqual(['startEndorsement'])
    expect(electionCranks(2).map((crank) => crank.fn)).toEqual(['sealSlate'])
    expect(electionCranks(3).map((crank) => crank.fn)).toEqual(['castBallot'])
    // Succeeded is transient, so it settles
    expect(electionCranks(4).map((crank) => crank.fn)).toEqual(['settleElection'])
    // Failed is NOT: computeState returns it only once election.failed is set,
    // which settle is what sets. Offering Settle there put a button on screen
    // that reverts WrongPhase.
    expect(electionCranks(5)).toEqual([])
    // Scheduled and Settled have nothing to advance either
    expect(electionCranks(0)).toEqual([])
    expect(electionCranks(6)).toEqual([])
  })
})

describe('operation builder signature hygiene', () => {
  it('tolerates trailing whitespace and zero-width characters in a pasted signature', () => {
    const base = { target: '0x0000000000000000000000000000000000000001', mode: 'abi' as const, argsJson: '[["A"],["0x0000000000000000000000000000000000000002"]]', rawSelector: '0x', rawArgs: '0x', value: '0' }
    const clean = encodeOperation({ ...base, signature: 'setAddresses(string[],address[])' })
    expect(encodeOperation({ ...base, signature: 'setAddresses(string[],address[]) ' }).selector).toBe(clean.selector)
    expect(encodeOperation({ ...base, signature: 'setAddresses(string[],address[])\u200B' }).selector).toBe(clean.selector)
    expect(clean.selector).toBe('0x7d69a892')
  })
})

describe('election time model (CON-864)', () => {
  // an election created at t=1000 with 7-day-ish offsets scaled down to seconds
  const raw = {
    kind: 1, cohortId: 2, seatsAtStake: 3, creationTime: 1000, fStart: 50,
    registrationEnd: 100, nominationEnd: 200, voteStartOffset: 300, voteEndOffset: 400,
    endorsementSnapshot: 0, quorumBps: 800, sealed_: false, settled: false, failed: false,
    termEnd: 0, parentElection: 0n, turnout: 0n, rankingCommitment: `0x${'0'.repeat(64)}`,
    minSupportBps: 100, refundFloorBps: 10, gesRegistry: '0x0000000000000000000000000000000000000001', slateCap: 64, alternateSlots: 3,
  }
  const election = normalizeElection(raw)

  it('normalizes the mixed number/bigint struct viem decodes', () => {
    expect(election.creationTime).toBe(1000n)
    expect(election.fStart).toBe(50n)
    expect(election.quorumBps).toBe(800)
    expect(election.sealed).toBe(false)
  })

  it('counts unfrozen seconds as the contract does, floored at zero', () => {
    // nothing frozen since the start: elapsed is wall time
    expect(elapsedUnfrozen(1250n, election, 50n)).toBe(250n)
    // 40 s frozen since the start: subtracted
    expect(elapsedUnfrozen(1250n, election, 90n)).toBe(210n)
    // more frozen than elapsed cannot go negative
    expect(elapsedUnfrozen(1010n, election, 90n)).toBe(0n)
  })

  it('places a boundary at creation + offset + everything frozen since the start', () => {
    expect(electionInstant(election, 300n, 50n)).toBe(1300n)
    expect(electionInstant(election, 300n, 110n)).toBe(1360n)
    expect(electionBounds(election, 50n)).toEqual({ registrationEnd: 1100n, nominationEnd: 1200n, voteStart: 1300n, voteEnd: 1400n })
  })

  it('mirrors computeState and inRegistration exactly at the offsets', () => {
    // <= is the contract's comparison on every boundary
    expect(electionStateOf(election, 200n)).toBe(1)
    expect(electionStateOf(election, 201n)).toBe(2)
    expect(electionStateOf(election, 300n)).toBe(2)
    expect(electionStateOf(election, 301n)).toBe(3)
    expect(electionStateOf(election, 400n)).toBe(3)
    expect(electionStateOf(election, 401n)).toBe(4)
    expect(electionStateOf({ ...election, failed: true }, 0n)).toBe(5)
    expect(electionStateOf({ ...election, settled: true, failed: true }, 0n)).toBe(6)
    expect(electionSubPhase(election, 100n)).toBe('registration')
    expect(electionSubPhase(election, 101n)).toBe('endorsement')
    // the crank closes registration, not the clock: a late crank keeps it open…
    expect(electionSubPhase(election, 150n)).toBe('endorsement')
    // …and an early snapshot ends it before the offset
    expect(electionSubPhase({ ...election, endorsementSnapshot: 1050n }, 20n)).toBe('endorsement')
    expect(electionSubPhase(election, 250n)).toBeUndefined()
  })

  it('resolves a past instant through the frozen history and skips the search when nothing froze', async () => {
    const calls: bigint[] = []
    // a 30-second freeze between t=1150 and t=1180, after fStart's 50
    const frozenTotalAt = async (at: bigint) => { calls.push(at); return at < 1150n ? 50n : at < 1180n ? 50n + (at - 1150n) : 80n }
    // vote start is 300 unfrozen seconds after creation; the freeze pushes it to 1330
    expect(await resolveEffectiveInstant(election, 300n, 2000n, frozenTotalAt)).toBe(1330n)
    expect(calls.length).toBeLessThanOrEqual(1 + 12) // one probe plus a bounded binary search
    // a boundary still ahead is the projection: before the freeze it is
    // creation + offset, after it the same plus the 30 s already frozen
    expect(await resolveEffectiveInstant(election, 300n, 1100n, frozenTotalAt)).toBe(1300n)
    expect(await resolveEffectiveInstant(election, 300n, 1200n, frozenTotalAt)).toBe(1330n)
    calls.length = 0
    expect(await resolveEffectiveInstant(election, 300n, 2000n, async (at) => { calls.push(at); return 50n })).toBe(1300n)
    expect(calls.length).toBe(1)
  })

  it('floors the quorum and compares turnout exactly, as settle does', () => {
    expect(electionQuorumRequired(800, 1_001n)).toBe(80n)
    expect(electionQuorumMet(80n, 800, 1_001n)).toBe(false) // 800_000 < 800_800
    expect(electionQuorumMet(81n, 800, 1_001n)).toBe(true)
    expect(electionVerdict({ ...election, turnout: 81n }, 1_001n)).toBe('succeeded')
    expect(electionVerdict({ ...election, turnout: 80n }, 1_001n)).toBe('failing')
    expect(electionVerdict(election)).toBe('unknown')
  })

  it('counts down to the boundary that ends the current phase', () => {
    const bounds = electionBounds(election, 50n)
    expect(electionCountdown(1, 'registration', bounds)).toEqual({ label: 'Registration closes', at: 1100n })
    expect(electionCountdown(1, 'endorsement', bounds)).toEqual({ label: 'Endorsement closes', at: 1200n })
    expect(electionCountdown(2, undefined, bounds)).toEqual({ label: 'Voting opens', at: 1300n })
    expect(electionCountdown(3, undefined, bounds)).toEqual({ label: 'Voting closes', at: 1400n })
    expect(electionCountdown(4, undefined, bounds)).toBeUndefined()
    expect(formatRelative(1400n, 1280n)).toBe('in 2 minutes')
    expect(formatRelative(1280n, 1400n)).toBe('2 minutes ago')
  })

  it('names the sub-phase in the next action', () => {
    expect(electionNextAction(1, 'registration')).toMatch(/nominate/i)
    expect(electionNextAction(1, 'endorsement')).toMatch(/endorse/i)
    expect(electionNextAction(1)).toBe('Nominate or endorse')
  })
})

describe('nomination cost (CON-864 #1)', () => {
  const economics = { candidateBond: parseEther('10000'), registrationFee: parseEther('100'), storageFeePerByte: parseEther('0.01') }

  it('charges storage only beyond the free first KB, to the wei', () => {
    expect(nominationCost(0, economics)).toMatchObject({ fees: parseEther('100'), billableBytes: 0, total: parseEther('10100') })
    expect(nominationCost(1024, economics)).toMatchObject({ fees: parseEther('100'), billableBytes: 0 })
    expect(nominationCost(1025, economics)).toMatchObject({ fees: parseEther('100.01'), billableBytes: 1 })
    // the fixture case: 2,048 bytes → 1,024 billable at 0.01
    expect(nominationCost(2048, economics).total).toBe(parseEther('10000') + parseEther('100') + parseEther('0.01') * 1024n)
  })

  it('caps the manifesto at 16 KB inclusive', () => {
    expect(manifestoWithinLimit(MANIFESTO_MAX_BYTES)).toBe(true)
    expect(manifestoWithinLimit(MANIFESTO_MAX_BYTES + 1)).toBe(false)
  })

  it('recovers the required figure from a WrongPayment revert and nothing else', () => {
    const revert = { name: 'ContractFunctionExecutionError', cause: { name: 'ContractFunctionRevertedError', data: { errorName: 'WrongPayment', args: [1n, 10100n] } } }
    expect(wrongPaymentRequired(revert)).toBe(10100n)
    expect(wrongPaymentRequired({ cause: { data: { errorName: 'RegistrationClosed', args: [] } } })).toBeUndefined()
    expect(wrongPaymentRequired(new Error('fetch failed'))).toBeUndefined()
  })

  it('translates the election reverts', () => {
    expect(errorMessage(new Error('reverted with custom error WrongPayment(1, 2)'))).toMatch(/exact nomination cost/)
    expect(errorMessage(new Error('RegistrationClosed()'))).toMatch(/Registration is closed/)
    expect(errorMessage(new Error('TooManyEndorsements()'))).toMatch(/three candidates/)
  })
})
