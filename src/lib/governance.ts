import {
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  isAddress,
  keccak256,
  parseAbiItem,
  parseAbiParameters,
  stringToHex,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem'
import type { ClassParams, Operation, ProposalCore, ProposalPostVote, ProposalRules, VoteTotals } from './types'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
export const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

export const CLASS_NAMES = ['Routine', 'Major Upgrade', 'Tokenomics', 'Meta Change', 'Charter', 'Veto Override', 'Emergency']
export const STATE_NAMES = ['Pending', 'Active', 'Defeated', 'Succeeded', 'Veto Window', 'Vetoed', 'Risk Review', 'Timelock', 'Queued', 'Executed', 'Execution Failed', 'Expired', 'Voided', 'Spam']
export const SUPPORT_NAMES = ['Against', 'For', 'Abstain']
export const VETO_GROUNDS = ['Legal / regulatory / fiduciary', 'Charter violation', 'Outside GLF mandate', 'Non-mitigable Foundation risk']

export function titleFromDescription(description: string, id: bigint): string {
  const line = description.split(/\r?\n/).map((value) => value.trim()).find(Boolean)
  if (!line) return `Proposal #${id}`
  const title = line.replace(/^#{1,6}\s*/, '').replace(/[*_`~]/g, '').trim()
  return title ? title.slice(0, 140) : `Proposal #${id}`
}

export function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

export function formatGen(value: bigint, maximumFractionDigits = 2): string {
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  const formattedWhole = BigInt(whole).toLocaleString()
  let digits = maximumFractionDigits
  // A sub-unit amount would truncate to a bare "0" at two decimals, which
  // reads as "free" for figures that are neither zero nor optional — the
  // proposal bond is 0.1% of GES and rendered "0 GEN". When there is no whole
  // part, extend precision far enough to reach the first significant digit
  // (plus one) so the magnitude is always visible.
  if (BigInt(whole) === 0n && value !== 0n) {
    const firstSignificant = fraction.search(/[1-9]/)
    if (firstSignificant >= 0) digits = Math.max(digits, firstSignificant + 2)
  }
  const trimmed = fraction.slice(0, digits).replace(/0+$/, '')
  return trimmed ? `${formattedWhole}.${trimmed}` : formattedWhole
}

/** Box-drawing glyphs (U+2500 block) plus the ASCII pipe used for hand-aligned tables. */
const BOX_DRAWING = /[\u2500-\u257F]/

/**
 * Fence runs of hand-aligned box-drawing lines so they survive markdown.
 *
 * A proposal description is plain text typed into a monospace textarea, and
 * people draw tables in it with box-drawing characters. Markdown has no idea
 * those lines are a table: it renders them as ordinary paragraphs in a
 * proportional font, the column alignment collapses, and the vertical rules
 * scatter across the text. remark-gfm does not help — this is not GFM pipe
 * syntax.
 *
 * Wrapping each run in a code fence restores exactly what the author saw when
 * they typed it: monospace, whitespace preserved, and horizontally scrollable
 * rather than overflowing the panel.
 *
 * Lines already inside a fence are left alone, so a deliberate code block is
 * never re-wrapped.
 */
export function preserveAlignedBlocks(text: string): string {
  const lines = text.split('\n')
  const output: string[] = []
  let fenced = false
  let run: string[] = []
  const flush = () => {
    if (run.length === 0) return
    output.push('```text', ...run, '```')
    run = []
  }
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush()
      fenced = !fenced
      output.push(line)
      continue
    }
    if (!fenced && BOX_DRAWING.test(line)) {
      run.push(line)
      continue
    }
    flush()
    output.push(line)
  }
  flush()
  return output.join('\n')
}

export function formatPercent(numerator: bigint, denominator: bigint, digits = 1): string {
  if (denominator === 0n) return '—'
  const scale = 10n ** BigInt(digits)
  const rounded = (numerator * 100n * scale + denominator / 2n) / denominator
  return `${Number(rounded) / Number(scale)}%`
}

export function formatDuration(seconds: bigint | number): string {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return 'None'
  const units: [number, string][] = [[86_400, 'day'], [3_600, 'hour'], [60, 'minute']]
  for (const [size, label] of units) if (value >= size) {
    const count = Math.round(value / size * 10) / 10
    return `${count} ${label}${count === 1 ? '' : 's'}`
  }
  return `${value} seconds`
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function formatDate(timestamp: bigint | number): string {
  const value = typeof timestamp === 'bigint' ? Number(timestamp) : timestamp
  return value ? new Date(value * 1_000).toLocaleString() : '—'
}

export function descriptionHash(description: string): Hex {
  return keccak256(stringToHex(description))
}

export function payloadHash(operations: Operation[]): Hex {
  if (!operations.length) return ZERO_HASH
  return keccak256(encodeAbiParameters(
    parseAbiParameters('(address target, bytes4 selector, bytes args, uint256 value)[]'),
    [operations],
  ))
}

export function encodeOperation(input: {
  target: string
  mode: 'abi' | 'raw'
  signature: string
  argsJson: string
  rawSelector: string
  rawArgs: string
  value: string
}): Operation {
  if (!isAddress(input.target)) throw new Error('Target must be a valid address')
  let selector: Hex
  let args: Hex
  if (input.mode === 'abi') {
    const item = parseAbiItem(`function ${input.signature}`)
    if (item.type !== 'function') throw new Error('Enter a Solidity function signature')
    const values = JSON.parse(input.argsJson || '[]')
    if (!Array.isArray(values)) throw new Error('Arguments must be a JSON array')
    const data = encodeFunctionData({ abi: [item], functionName: item.name, args: values as any })
    selector = data.slice(0, 10) as Hex
    args = `0x${data.slice(10)}` as Hex
  } else {
    selector = input.rawSelector as Hex
    args = input.rawArgs as Hex
    if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) throw new Error('Selector must be exactly 4 bytes')
    if (!/^0x([0-9a-fA-F]{2})*$/.test(args)) throw new Error('Arguments must be even-length hex')
  }
  return { target: input.target, selector, args, value: BigInt(input.value || '0') }
}

export function operationSignature(signature: string): Hex {
  return toFunctionSelector(signature)
}

export function normalizeCore(value: any): ProposalCore {
  return {
    id: value.id, proposer: value.proposer, classId: Number(value.classId),
    creationTime: Number(value.creationTime), fStart: Number(value.fStart), voteEnd: Number(value.voteEnd),
    payloadHash: value.payloadHash, contractsHash: value.contractsHash,
    classTimelock: value.classTimelock, retryAllowed: value.retryAllowed, descriptionHash: value.descriptionHash,
  }
}

export function normalizeRules(value: any): ProposalRules {
  return {
    quorumBps: Number(value.quorumBps), forFloorBps: Number(value.forFloorBps),
    thresholdNum: Number(value.thresholdNum), thresholdDen: Number(value.thresholdDen),
    requiresRiskReview: value.requiresRiskReview, vetoWindow: Number(value.vetoWindow),
    extendedVetoWindow: Number(value.extendedVetoWindow), reviewWindow: Number(value.reviewWindow),
    executionWindow: Number(value.executionWindow), preparation: Number(value.preparation),
    votingPeriod: Number(value.votingPeriod), lateQuorumWindow: Number(value.lateQuorumWindow),
  }
}

export function normalizeClassParams(value: any): ClassParams {
  return {
    quorumBps: Number(value.quorumBps), forFloorBps: Number(value.forFloorBps),
    thresholdNum: Number(value.thresholdNum), thresholdDen: Number(value.thresholdDen),
    timelockMin: value.timelockMin, timelockMax: value.timelockMax,
    requiresRiskReview: value.requiresRiskReview,
  }
}

export function normalizePostVote(value: any): ProposalPostVote {
  return {
    vetoExtended: value.vetoExtended, extendFirstCaller: value.extendFirstCaller,
    vetoGroundsUsed: Number(value.vetoGroundsUsed), vetoActive: value.vetoActive,
    overrideCount: Number(value.overrideCount), vetoedAtOffset: Number(value.vetoedAtOffset),
    overriddenAtOffset: Number(value.overriddenAtOffset), scApprovedAtOffset: Number(value.scApprovedAtOffset),
    glfApprovedAtOffset: Number(value.glfApprovedAtOffset), etaOffset: Number(value.etaOffset),
    prepRestartOffset: Number(value.prepRestartOffset), voided: value.voided,
    mechanicallyVoided: value.mechanicallyVoided, maskCheckedAtSucceeded: value.maskCheckedAtSucceeded,
    executed: value.executed, executionFailed: value.executionFailed,
  }
}

export function normalizeVotes(value: any): VoteTotals {
  return { against: value[0], for: value[1], abstain: value[2] }
}

export function voteChecks(votes: VoteTotals, rules: ProposalRules, ges: bigint) {
  const turnout = votes.against + votes.for + votes.abstain
  const quorumRequired = (ges * BigInt(rules.quorumBps) + 9_999n) / 10_000n
  const floorRequired = (ges * BigInt(rules.forFloorBps) + 9_999n) / 10_000n
  const approvalLeft = votes.for * BigInt(rules.thresholdDen)
  const approvalRight = BigInt(rules.thresholdNum) * (votes.for + votes.against)
  return {
    turnout, quorumRequired, floorRequired,
    quorumMet: turnout >= quorumRequired,
    floorMet: votes.for >= floorRequired,
    thresholdMet: votes.for + votes.against > 0n && approvalLeft > approvalRight,
  }
}

export interface VoteVerdict {
  /** 'passed' | 'defeated' | 'undecided' — undecided only while voting is open */
  outcome: 'passed' | 'defeated' | 'undecided'
  headline: string
  reason: string
  /** true once the chain has settled the result; false = provisional */
  final: boolean
}

/**
 * The one-line answer the three rule cards never give.
 *
 * The rules panel deliberately shows quorum, For floor and approval
 * separately (a bare "passed/failed" hides which condition decided it), but
 * showing ONLY the components leaves the reader to do the boolean algebra —
 * and a viewer looking at an executable proposal should not have to derive
 * whether it actually won.
 *
 * Once the chain has moved past Active its state IS the verdict, so it is
 * read rather than recomputed. While voting is open the same arithmetic gives
 * a provisional standing, explicitly labelled as such.
 */
export function voteVerdict(state: number, votes: VoteTotals, checks: ReturnType<typeof voteChecks>): VoteVerdict {
  const decided = votes.for + votes.against
  // Failure order mirrors the rules: quorum first (nothing else matters
  // without it), then the For floor, then the head-to-head threshold.
  const why = () => {
    if (checks.turnout === 0n) return 'No votes were cast, so quorum could not be met.'
    if (!checks.quorumMet) return 'Turnout did not reach quorum. The other rules are not reached.'
    // Checked before the For floor: with no For or Against votes the floor
    // trivially fails too, and naming that symptom hides the actual cause.
    if (decided === 0n) return 'Only Abstain votes were cast. Abstain counts toward quorum but never toward the For floor or the approval threshold, so nothing carried.'
    if (!checks.floorMet) return 'Quorum was met, but For votes stayed under the class For floor.'
    if (votes.for === votes.against) return 'For and Against tied. Approval needs strictly more than the threshold, so a tie fails.'
    if (!checks.thresholdMet) return 'Against outweighed For against the class approval threshold.'
    return 'Quorum, For floor and approval threshold were all met.'
  }
  const wouldPass = checks.quorumMet && checks.floorMet && checks.thresholdMet

  // Terminal and post-vote states: the chain has spoken.
  if (state === 2) return { outcome: 'defeated', headline: 'Defeated', reason: why(), final: true }
  if (state === 5) return { outcome: 'defeated', headline: 'Vetoed by the GLF', reason: 'The vote passed, but the GLF exercised its veto during the objection window.', final: true }
  if (state === 12) return { outcome: 'defeated', headline: 'Voided', reason: 'The proposal was voided and can no longer execute.', final: true }
  if (state === 13) return { outcome: 'defeated', headline: 'Designated spam', reason: 'The Security Council designated this proposal spam; the bond is forfeited.', final: true }
  if (state === 11) return { outcome: 'defeated', headline: 'Expired', reason: 'The vote passed but the execution window closed before it executed.', final: true }
  if (state > 2 && state !== 13) return { outcome: 'passed', headline: 'For wins', reason: why(), final: true }

  // Pending or Active: provisional.
  if (state === 0) return { outcome: 'undecided', headline: 'Voting has not opened', reason: 'The snapshot fixes when voting opens; no votes count before then.', final: false }
  return {
    outcome: 'undecided',
    headline: wouldPass ? 'Passing so far' : 'Failing so far',
    reason: `${why()} Voting is still open, so this can still change.`,
    final: false,
  }
}

export function proposalNextAction(state: number, retryAllowed = false): string {
  return [
    'Wait for voting to open', 'Vote before the deadline', 'Settle the defeated proposal',
    'Settle and enter post-vote review', 'GLF may veto or extend the window', 'No further action',
    'Security Council / GLF risk review', 'Wait for the class timelock', 'Execute permissionlessly',
    'No further action', retryAllowed ? 'Retry execution' : 'No further action', 'Expire permissionlessly',
    'No further action', 'No further action',
  ][state] ?? 'Inspect contract state'
}

export function operationBytes(operation: Operation): number {
  return (operation.args.length - 2) / 2
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const known: Record<string, string> = {
    BelowProposalThreshold: 'The account does not meet the proposal voting-power threshold.',
    WrongBond: 'The proposal bond does not match the exact on-chain requirement.',
    TooManyLiveProposals: 'This account already has the maximum number of live proposals.',
    SpamCooldownActive: 'This account or its delegate is under a proposal-spam cooldown.',
    AlreadyVoted: 'This account has already voted on this proposal.',
    ZeroWeight: 'This account had no voting power at the proposal snapshot.',
    ExcludedAtSnapshot: 'This account was excluded at the proposal snapshot.',
    Frozen: 'Governance is currently frozen.',
    MigrationInProgress: 'Governance is currently migrating.',
    WrongState: 'The proposal is not in the required state for this action.',
  }
  const match = Object.keys(known).find((name) => raw.includes(name))
  if (match) return `${known[match]}\n\n${raw.slice(0, 600)}`
  if (/rejected/i.test(raw)) return 'The wallet request was rejected.'
  return raw.slice(0, 900)
}
