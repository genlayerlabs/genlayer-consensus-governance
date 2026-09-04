import type { Address, Hex } from 'viem'

export interface ContractSet {
  voting: Address
  votingPower: Address
  gesRegistry: Address
  classRegistry: Address
  clock: Address
  executor: Address
  l1Bridge: Address
  council: Address
  elections: Address
}

export interface ProposalCore {
  id: bigint
  proposer: Address
  classId: number
  creationTime: number
  fStart: number
  voteEnd: number
  payloadHash: Hex
  contractsHash: Hex
  classTimelock: bigint
  retryAllowed: boolean
  descriptionHash: Hex
}

export interface ProposalRules {
  quorumBps: number
  forFloorBps: number
  thresholdNum: number
  thresholdDen: number
  requiresRiskReview: boolean
  vetoWindow: number
  extendedVetoWindow: number
  reviewWindow: number
  executionWindow: number
  preparation: number
  votingPeriod: number
  lateQuorumWindow: number
}

export interface ClassParams {
  quorumBps: number
  forFloorBps: number
  thresholdNum: number
  thresholdDen: number
  timelockMin: bigint
  timelockMax: bigint
  requiresRiskReview: boolean
}

export interface Operation {
  target: Address
  selector: Hex
  args: Hex
  value: bigint
}

export interface VoteTotals { against: bigint; for: bigint; abstain: bigint }

export interface ConnectedVote {
  hasVoted: boolean
  support?: number
  weight: bigint
}

export interface ProposalPostVote {
  vetoExtended: boolean
  extendFirstCaller: Address
  vetoGroundsUsed: number
  vetoActive: boolean
  overrideCount: number
  vetoedAtOffset: number
  overriddenAtOffset: number
  scApprovedAtOffset: number
  glfApprovedAtOffset: number
  etaOffset: number
  prepRestartOffset: number
  voided: boolean
  mechanicallyVoided: boolean
  maskCheckedAtSucceeded: boolean
  executed: boolean
  executionFailed: boolean
}

export interface ProposalSummary {
  core: ProposalCore
  state: number
  title: string
  description: string
  voteStart: bigint
  voteEnd: bigint
  votes: VoteTotals
  rules: ProposalRules
  operations: Operation[]
  operationPermissions: boolean[]
  ges: bigint
  contractSet: ContractSet
  connectedVote?: ConnectedVote
  postVote: ProposalPostVote
  executionEta: bigint
  executionDeadline: bigint
  transactionHash?: Hex
  blockNumber?: bigint
}

export interface VoteRecord {
  voter: Address
  proposalId: bigint
  support: number
  weight: bigint
  reason: string
  transactionHash: Hex
  blockNumber: bigint
}

// ── Security Council (CON-862) ──────────────────────────────────────────────

/** SecurityCouncil.members() — the array INDEX is the seat id. */
export interface CouncilMember {
  seat: number
  address: Address
  cohortId: number
  /** 0 = the genesis sentinel, which reads as HoldOver from day one */
  termEnd: number
  electionId: bigint
  /** SeatStatus: 0 Elected, 1 Active, 2 HoldOver, 3 Vacant */
  status: number
}

export interface CouncilThresholds {
  standard: number
  emergency: number
  freezeSoft: number
  freezeHard: number
}

export interface CouncilOverview {
  members: CouncilMember[]
  seated: number
  target: number
  /** seats that count toward a threshold right now */
  actionable: number
  membershipVersion: bigint
  thresholds: CouncilThresholds
  activationWindow: bigint
  acceptWindow: bigint
}

export interface FreezeState {
  freezeActive: boolean
  /** FreezeKind: 0 Soft, 1 Hard — stale unless freezeActive */
  freezeKind: number
  freezeEnd: bigint
  maintenanceActive: boolean
  frozenTotal: bigint
  /** freeze generation; 0 when no freeze is live. The Unfreeze action's anchor. */
  generation: bigint
  /** seconds of freeze already spent in the rolling window */
  windowUsed: bigint
  windowBudget: bigint
  softCap: bigint
  hardCap: bigint
  hardCooldown: bigint
}

export interface CouncilApproval {
  address: Address
  at?: bigint
  transactionHash?: Hex
}

export interface CouncilAction {
  actionId: Hex
  /** ActionType: 0 DesignateSpam, 1 VoidProposal, 2 RaiseClass, 3 RiskReview,
   *  4 EmergencyApprove, 5 Freeze, 6 Unfreeze */
  actionType: number
  creator: Address
  actionData: Hex
  expiresAt: bigint
  /** ActionStatus: 0 None, 1 Open, 2 Approved, 3 Consumed */
  status: number
  /** VALID approvals as recounted on-chain, not the raw tally */
  approvals: number
  /** approvers in order, reconstructed from CouncilActionApproved logs.
   *  `at` is the block timestamp, so it is when the approval LANDED, which is
   *  what a member checking a threshold wants — the contract stores no
   *  per-approval time at all. */
  approvers: CouncilApproval[]
  executed: boolean
  transactionHash?: Hex
  blockNumber?: bigint
}

// ── Delegation (CON-862) ────────────────────────────────────────────────────

export interface DelegateEntry {
  address: Address
  /** live weight this address votes with, including anything delegated in */
  votingPower: bigint
  /** who this address currently delegates to; itself when self-delegated */
  delegate: Address
  /** true when the weight has been handed to a third party */
  delegatedAway: boolean
  /** addresses observed delegating to this one, from the scanned universe */
  delegators: Address[]
  excluded: boolean
  /** non-zero when the address is a contract whose owner controls governance */
  controller?: Address
  isCouncilMember: boolean
}

export interface DelegationSummary {
  /** the connected account's current delegate */
  delegate: Address
  self: boolean
  parked: boolean
  votingPower: bigint
  excluded: boolean
  cooldownUntil: bigint
  /** per-validator positions, each measured against MIN_ENTRY_VALUE */
  positions: { validator: Address; shares: bigint; pending: bigint; value: bigint; meetsFloor: boolean }[]
}

// ── Council elections (CON-862) ─────────────────────────────────────────────

export interface ElectionCandidate {
  address: Address
  /** ballot weight accumulated; 0 until Voting */
  weight: bigint
  /** true when the candidate made the sealed slate */
  slated: boolean
  withdrawn: boolean
  bond: bigint
}

export interface ElectionSummary {
  id: bigint
  state: number
  /** from ElectionStarted; state() alone cannot tell you the kind */
  kind?: number
  seatsAtStake?: number
  /** wall-clock PROJECTIONS made at start — a clock freeze shifts the real instants */
  voteStart?: bigint
  voteEnd?: bigint
  slate: Address[]
  winners: Address[]
  alternates: Address[]
  ranking: Address[]
  /** only known after the fact, from ElectionSettled / ElectionFailed */
  turnout?: bigint
  quorum?: bigint
  transactionHash?: Hex
  blockNumber?: bigint
}
