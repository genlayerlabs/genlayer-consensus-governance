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
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '')
  return trimmed ? `${formattedWhole}.${trimmed}` : formattedWhole
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
