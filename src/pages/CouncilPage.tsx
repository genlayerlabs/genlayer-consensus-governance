import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, RefreshCw, ShieldAlert, Snowflake } from 'lucide-react'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { Button } from '@/components/Button'
import { InfoHint } from '@/components/InfoHint'
import { TransactionButton } from '@/components/TransactionButton'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { useCouncil } from '@/hooks/useCouncil'
import { useCouncilActions } from '@/hooks/useCouncilActions'
import { useProposals } from '@/hooks/useProposals'
import { useCanCall } from '@/hooks/useCanCall'
import { useRaiseClassOptions } from '@/hooks/useRaiseClassOptions'
import type { CouncilAction, CouncilThresholds, ProposalSummary } from '@/lib/types'
import {
  ACTION_PROPOSAL_STATES, ACTION_STATUS_NAMES, ACTION_TYPE_NAMES, COHORT_NAMES, FREEZE_KIND_NAMES,
  SEAT_STATUS_NAMES, actionProposalId, actionProposalRequirement, actionThreshold, describeActionData,
  CLASS_NAMES, encodeActionData, formatDate, formatDuration, freezeKindOf, shortAddress, truncate,
} from '@/lib/governance'
import { explorerAddress, explorerTx } from '@/lib/rpc'

const HINTS = {
  membershipVersion:
    'Bumped by any seat or threshold change. A non-emergency action is bound to the version it was created under, so a bump silently invalidates every open one — they must be re-created, not re-approved.',
  actionable:
    'Seats that count toward a threshold right now. Thresholds are ABSOLUTE counts, never scaled down by vacancies, so a 5-of-9 action still needs 5 approvals even with seats empty.',
  holdOver:
    'A member past their term end who keeps full authority until a successor is seated. Computed, not stored: the genesis roster reads as hold-over from day one because its term end is the zero sentinel.',
  freezeBudget:
    'Freezing spends from a rolling allowance. Once it is exhausted a freeze is capped short regardless of the per-freeze cap, which is what stops the clock being held stopped indefinitely.',
  expiry:
    'An action that is never executed simply lapses — no event is emitted, and actionStatus still reports Approved past this instant. Execution is refused after it.',
}

/** "GLIP #3 — Grant the quarantine manager role" beats "Proposal #3": the log
 *  is read by members deciding whether to approve, and an id alone makes them
 *  leave the page to find out what they are approving. Falls back to the plain
 *  description when the proposal is outside the scanned range. */
function targetTitle(actionType: number, actionData: `0x${string}`, proposals: ProposalSummary[]): string {
  const id = actionProposalId(actionType, actionData)
  const match = id === undefined ? undefined : proposals.find((proposal) => proposal.core.id === id)
  if (!match) return describeActionData(actionType, actionData)
  return `GLIP #${id} — ${truncate(match.title, 44)}`
}

function ActionComposer({ council, classRegistry, isMember, onDone, proposals, proposalsLoading }: {
  council?: `0x${string}`; classRegistry?: `0x${string}`; isMember: boolean; onDone: () => void
  proposals: ProposalSummary[]; proposalsLoading: boolean
}) {
  const [actionType, setActionType] = useState(3)
  const [proposalId, setProposalId] = useState('')
  const [newClass, setNewClass] = useState('1')
  const [payloadHash, setPayloadHash] = useState('')
  const [approvalExpiry, setApprovalExpiry] = useState('')
  const [freezeKind, setFreezeKind] = useState(0)
  const [minutes, setMinutes] = useState('60')

  const expiresAt = useMemo(() => BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Number(minutes) || 0) * 60), [minutes])
  const encoded = useMemo(() => {
    try {
      return { data: encodeActionData(actionType, { proposalId, newClass, payloadHash, approvalExpiry, freezeKind }), error: '' }
    } catch (error) {
      return { data: '0x' as const, error: error instanceof Error ? error.message : String(error) }
    }
  }, [actionType, proposalId, newClass, payloadHash, approvalExpiry, freezeKind])

  const needsProposal = ACTION_PROPOSAL_STATES[actionType] !== undefined
  // Only proposals this action type can legally target. Three of the four are
  // checked where the action EXECUTES, so an ineligible one is accepted here
  // and reverts WrongState after the council has already approved it.
  const eligible = useMemo(
    () => proposals.filter((proposal) => ACTION_PROPOSAL_STATES[actionType]?.includes(proposal.state)),
    [proposals, actionType],
  )
  const picked = eligible.find((proposal) => proposal.core.id.toString() === proposalId)
  const { options: raiseOptions } = useRaiseClassOptions(actionType === 2 ? classRegistry : undefined, picked)
  const raiseChoice = raiseOptions.find((option) => String(option.classId) === newClass)

  // Reset a pick that the new action type cannot target.
  useEffect(() => {
    if (proposalId && !eligible.some((proposal) => proposal.core.id.toString() === proposalId)) setProposalId('')
  }, [eligible, proposalId])
  // Default to the first class the proposal can legally be raised to, rather
  // than to "1" — which is the current class for half the proposals here.
  useEffect(() => {
    const first = raiseOptions.find((option) => option.eligible)
    if (raiseOptions.length && (!raiseChoice || !raiseChoice.eligible)) setNewClass(first ? String(first.classId) : '')
  }, [raiseOptions, raiseChoice])
  // ACTION_EXPIRY_CAP is 30 days; anything beyond reverts ExpiryTooFar.
  const expiryTooFar = Number(minutes) > 30 * 24 * 60

  return (
    <section className="panel">
      <div className="section-heading"><div><p className="eyebrow">Council action</p><h2>Create an action</h2></div>
        {!isMember && <span className="role-note compact"><ShieldAlert size={16} />Not a sitting member</span>}</div>
      <p className="hint">
        A council action is how the council speaks: members create one, approve it to the threshold, then anyone
        executes it. The council contract — not an individual member — is what the target sees as the caller.
      </p>
      <div className="form-grid">
        <label className="full">Action type
          <select value={actionType} onChange={(event) => setActionType(Number(event.target.value))}>
            {ACTION_TYPE_NAMES.map((name, index) => <option key={name} value={index}>{index} · {name}</option>)}
          </select>
        </label>
        {needsProposal && <label className={actionType === 2 ? '' : 'full'}>Proposal
          <select value={proposalId} onChange={(event) => setProposalId(event.target.value)}
            disabled={eligible.length === 0}>
            {eligible.length === 0
              ? <option value="">{proposalsLoading ? 'Reading proposals…' : 'None'}</option>
              : <>
                <option value="">Select a proposal…</option>
                {eligible.map((proposal) => <option key={proposal.core.id.toString()} value={proposal.core.id.toString()}>
                  GLIP #{proposal.core.id.toString()} — {truncate(proposal.title, 48)}
                </option>)}
              </>}
          </select>
          <small className="muted">
            {eligible.length === 0
              ? `No proposal is in ${actionProposalRequirement(actionType)} right now — nothing this action can target.`
              : `Only proposals in ${actionProposalRequirement(actionType)} are listed; this action reverts against any other state.`}
          </small>
        </label>}
        {actionType === 2 && <label>Raise to class
          <select value={newClass} onChange={(event) => setNewClass(event.target.value)}
            disabled={!picked || !raiseOptions.some((option) => option.eligible)}>
            {!picked
              ? <option value="">Pick a proposal first</option>
              : raiseOptions.map((option) => <option key={option.classId} value={option.classId} disabled={!option.eligible}>
                {option.classId} · {option.name}{option.eligible ? '' : ` — ${option.blockedBy}`}
              </option>)}
          </select>
          {picked && raiseChoice?.params && <small className="muted">
            Quorum {(raiseChoice.params.quorumBps / 100).toFixed(1)}% · For floor {(raiseChoice.params.forFloorBps / 100).toFixed(1)}%
            · {raiseChoice.params.thresholdNum}/{raiseChoice.params.thresholdDen} threshold
            · timelock {formatDuration(raiseChoice.params.timelockMin)}–{formatDuration(raiseChoice.params.timelockMax)}
            {raiseChoice.params.requiresRiskReview ? ' · Risk Review required' : ''}
          </small>}
        </label>}
        {actionType === 4 && <><label className="full">Payload hash
          <input value={payloadHash} onChange={(event) => setPayloadHash(event.target.value)} placeholder="0x…" />
        </label><label className="full">Approval expiry (unix seconds)
          <input value={approvalExpiry} onChange={(event) => setApprovalExpiry(event.target.value)} inputMode="numeric" />
        </label></>}
        {actionType === 5 && <label className="full">Freeze kind
          <select value={freezeKind} onChange={(event) => setFreezeKind(Number(event.target.value))}>
            {FREEZE_KIND_NAMES.map((name, index) => <option key={name} value={index}>{index} · {name}</option>)}
          </select>
        </label>}
        {actionType === 2 && picked && <div className="role-note full"><AlertTriangle size={16} /><p>
          <b>Raising re-baselines the proposal</b>
          It restarts the preparation period, re-copies the rules snapshot from the new class's live parameters, and
          clamps the timelock into that class's range. The payload is unchanged — only what it must clear to pass.
          Currently {CLASS_NAMES[picked.core.classId] ?? `class ${picked.core.classId}`}.</p></div>}
        <label className="full"><span className="label-text">Expires in (minutes)<InfoHint text={HINTS.expiry} /></span>
          <input value={minutes} onChange={(event) => setMinutes(event.target.value)} inputMode="numeric" />
          <small className={expiryTooFar ? 'danger-text' : 'muted'}>
            {expiryTooFar ? 'Beyond the 30-day cap — this will revert ExpiryTooFar.' : `Expires ${formatDate(expiresAt)}`}
          </small>
        </label>
      </div>
      {encoded.error && <div className="error-box compact">{encoded.error}</div>}
      <TransactionButton
        address={council}
        abi={SecurityCouncilABI as never}
        functionName="createAction"
        args={[actionType, encoded.data, expiresAt]}
        disabled={!isMember || Boolean(encoded.error) || expiryTooFar || (needsProposal && !proposalId) || (actionType === 2 && !raiseChoice?.eligible)}
        onConfirmed={onDone}
      >Create action</TransactionButton>
    </section>
  )
}

/* A council action executes by calling GovernanceVoting, so the error it
   reverts with is defined THERE — probing with the council ABI alone left
   viem unable to decode it, and the card printed a raw "reverted with the
   following signature" preamble. Errors only: nothing else is called. */
const COUNCIL_PROBE_ABI = [
  ...(SecurityCouncilABI as unknown[]),
  ...(GovernanceVotingABI as { type: string }[]).filter((entry) => entry.type === 'error'),
]

function ActionRow({ action, council, isMember, thresholds, proposals, now, onDone }: {
  action: CouncilAction; council?: `0x${string}`; isMember: boolean
  thresholds: CouncilThresholds; proposals: ProposalSummary[]; now: bigint; onDone: () => void
}) {
  const { address } = useWallet()
  const required = actionThreshold(action.actionType, thresholds, freezeKindOf(action.actionType, action.actionData))
  const expired = action.expiresAt <= now && !action.executed
  const ready = action.status === 2 && !action.executed && !expired
  // executeAction is permissionless, so a simulation answers the only question
  // that matters: would it work NOW. An approved action can still be dead —
  // DesignateSpam needs the proposal Pending, and voting opening while the
  // council was collecting signatures kills it with no event to say so.
  const { allowed: canExecute, reason } = useCanCall({
    address: council, abi: COUNCIL_PROBE_ABI as never, functionName: 'executeAction',
    args: [action.actionId], account: address, enabled: ready,
  })
  const tone = action.executed ? 1 : expired || canExecute === false ? 0 : 2

  return <article className="action-card">
    <header>
      <span className={`vote-dot support-${tone}`} />
      <b>{ACTION_TYPE_NAMES[action.actionType] ?? `Type ${action.actionType}`}</b>
      <span className="action-target">{targetTitle(action.actionType, action.actionData, proposals)}</span>
      <span className={`seat-status support-${tone}`}>
        {action.executed ? 'Executed' : expired ? 'Expired' : ACTION_STATUS_NAMES[action.status] ?? `Status ${action.status}`}</span>
      <span className="action-tally">{action.approvals} / {required} approvals</span>
    </header>
    <p className="action-meta">By {shortAddress(action.creator)} · {expired ? 'Lapsed' : 'Expires'} {formatDate(action.expiresAt)}
      {action.transactionHash && <> · <a href={explorerTx(action.transactionHash)} target="_blank" rel="noreferrer">
        View on explorer <ExternalLink size={11} /></a></>}</p>

    {action.approvers.length > 0 && <div className="approver-list">
      {action.approvers.map((approval, index) => <span key={`${approval.address}-${approval.transactionHash}`}>
        <b>{index + 1}.</b>
        <a href={explorerAddress(approval.address)} target="_blank" rel="noreferrer"><code>{approval.address}</code></a>
        <em>{approval.at === undefined ? 'time unavailable' : formatDate(approval.at)}</em>
      </span>)}
    </div>}

    {ready && canExecute === false && <div className="role-note"><AlertTriangle size={16} /><p>
      <b>Approved, but it can no longer execute</b>
      {reason || 'Executing it now reverts.'} Nothing on-chain marks this, so the action keeps reporting Approved
      until it expires.</p></div>}

    {!action.executed && !expired && <div className="action-buttons">
      {/* An action at threshold needs no more signatures, and one that can
          never execute needs nothing at all — a disabled Approve under a
          "cannot execute" notice is an offer to do useless work. */}
      {action.approvals < required && canExecute !== false && <TransactionButton
        address={council} abi={SecurityCouncilABI as never}
        functionName="approveAction" args={[action.actionId]} variant="secondary"
        disabled={!isMember} onConfirmed={onDone}
      >Approve</TransactionButton>}
      {ready && canExecute !== false && <TransactionButton
        address={council} abi={SecurityCouncilABI as never}
        functionName="executeAction" args={[action.actionId]} onConfirmed={onDone}
      >Execute</TransactionButton>}
    </div>}
  </article>
}

export function CouncilPage() {
  const { currentSet } = useContracts()
  const { address } = useWallet()
  const { overview, freeze, loading, error, refresh } = useCouncil()
  const actions = useCouncilActions()
  // Loaded once here: the composer picks from them and the log names them.
  const { proposals, loading: proposalsLoading } = useProposals()
  const now = BigInt(Math.floor(Date.now() / 1000))

  const isMember = useMemo(
    () => Boolean(address && overview?.members.some((member) => member.address.toLowerCase() === address.toLowerCase() && member.status !== 3)),
    [address, overview],
  )

  if (!currentSet?.council) {
    return <div className="page"><section className="empty"><h1>Select a deployment</h1>
      <p>Set an AddressManager in the header to load its Security Council.</p></section></div>
  }

  return <div className="page wide">
    <div className="hero"><div>
      <p className="eyebrow">Protocol governance</p>
      <h1>Security Council</h1>
      <p>Roster, thresholds, freeze state, and the on-chain action log.</p>
    </div><Button variant="ghost" onClick={() => { void refresh(); void actions.refresh() }}><RefreshCw size={15} /> Refresh</Button></div>

    {error && <div className="error-box">{error}</div>}
    {loading && !overview && <div className="loading-state">Loading the council directly from chain…</div>}

    {overview && <>
      <div className="split-row">
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Composition</p><h2>Seats and thresholds</h2></div></div>
        <div className="header-facts">
          <span><small>Seated</small>{overview.seated} / {overview.target}</span>
          <span><small>Actionable<InfoHint text={HINTS.actionable} /></small>{overview.actionable}</span>
          <span><small>Standard</small>{overview.thresholds.standard}-of-{overview.target}</span>
          <span><small>Emergency</small>{overview.thresholds.emergency}-of-{overview.target}</span>
          <span><small>Freeze soft / hard</small>{overview.thresholds.freezeSoft} / {overview.thresholds.freezeHard}</span>
          <span><small>Membership version<InfoHint text={HINTS.membershipVersion} /></small>{overview.membershipVersion.toString()}</span>
        </div>
      </section>

      {freeze && <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Governance clock</p>
          <h2>{freeze.freezeActive ? `${FREEZE_KIND_NAMES[freeze.freezeKind] ?? ''} freeze active` : freeze.maintenanceActive ? 'Maintenance' : 'Running normally'}</h2></div>
          {freeze.freezeActive ? <Snowflake size={20} /> : <Check size={18} />}</div>
        <div className="header-facts">
          {freeze.freezeActive && <span><small>Freeze ends</small>{formatDate(freeze.freezeEnd)}</span>}
          <span><small>Maintenance</small>{freeze.maintenanceActive ? 'Active' : 'No'}</span>
          <span><small>Budget used<InfoHint text={HINTS.freezeBudget} /></small>{formatDuration(freeze.windowUsed)} of {formatDuration(freeze.windowBudget)}</span>
          <span><small>Caps soft / hard</small>{formatDuration(freeze.softCap)} / {formatDuration(freeze.hardCap)}</span>
          <span><small>Hard cooldown</small>{formatDuration(freeze.hardCooldown)}</span>
          <span><small>Frozen total</small>{formatDuration(freeze.frozenTotal)}</span>
        </div>
        {freeze.maintenanceActive && <div className="role-note"><AlertTriangle size={18} /><p><b>Ledger maintenance</b>
          Maintenance is a voting-power ledger state, not a council freeze. Governance timing is stopped, and the
          ledger is intentionally out of sync with staking while it lasts.</p></div>}
      </section>}
      </div>

      <div className="split-row">
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Roster</p><h2>Members</h2></div>
          <span>{overview.members.filter((m) => m.status !== 3).length} seated</span></div>
        <div className="voter-list">{overview.members.map((member) => {
          const vacant = member.status === 3
          return <article key={member.seat}>
            <span className={`vote-dot support-${member.status === 1 ? 1 : member.status === 2 ? 2 : 0}`} />
            {vacant ? <b>Vacant</b> : <a href={explorerAddress(member.address)} target="_blank" rel="noreferrer">{shortAddress(member.address)}</a>}
            <b>Seat {member.seat} · Cohort {COHORT_NAMES[member.cohortId] ?? member.cohortId}</b>
            <span className={`seat-status support-${member.status === 1 ? 1 : member.status === 2 ? 2 : 0}`}>
              {SEAT_STATUS_NAMES[member.status] ?? `Status ${member.status}`}
              {member.status === 2 && <InfoHint text={HINTS.holdOver} />}</span>
            <span>{member.termEnd === 0 ? 'Genesis seat' : `Term ends ${formatDate(member.termEnd)}`}</span>
            <p>{member.electionId === 0n ? 'Appointed at genesis' : `Elected in election #${member.electionId}`}</p>
          </article>
        })}</div>
      </section>

      <ActionComposer council={currentSet.council} classRegistry={currentSet.classRegistry} isMember={isMember} onDone={() => void actions.refresh()}
        proposals={proposals} proposalsLoading={proposalsLoading} />
      </div>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">On-chain action log</p><h2>Actions</h2></div>
          <span>{actions.actions.length} found</span></div>
        {actions.progress && <p className="scan-progress">{actions.progress}</p>}
        {actions.error && <div className="error-box">{actions.error}</div>}
        <div className="action-log">{actions.actions.map((action) => <ActionRow
          key={action.actionId} action={action} council={currentSet.council} isMember={isMember}
          thresholds={overview.thresholds} proposals={proposals} now={now}
          onDone={() => { void actions.refresh(); void refresh() }} />)}
        {!actions.loading && actions.actions.length === 0 && <div className="empty inline">
          <p>No council actions found. The contract exposes no action enumeration, so this list is built from
          <code>CouncilActionCreated</code> logs within the scanned range.</p></div>}
        </div>
      </section>
    </>}
  </div>
}
