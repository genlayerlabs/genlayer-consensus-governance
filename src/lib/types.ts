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
