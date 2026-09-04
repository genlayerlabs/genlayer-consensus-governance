import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, ShieldAlert, Snowflake, Users } from 'lucide-react'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { Button } from '@/components/Button'
import { InfoHint } from '@/components/InfoHint'
import { TransactionButton } from '@/components/TransactionButton'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { useCouncil } from '@/hooks/useCouncil'
import { useCouncilActions } from '@/hooks/useCouncilActions'
import { useProposals } from '@/hooks/useProposals'
import {
  ACTION_PROPOSAL_STATES, ACTION_STATUS_NAMES, ACTION_TYPE_NAMES, COHORT_NAMES, FREEZE_KIND_NAMES,
  SEAT_STATUS_NAMES, actionProposalRequirement, actionThreshold, describeActionData,
  encodeActionData, formatDate, formatDuration, freezeKindOf, shortAddress, truncate,
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

function ActionComposer({ council, isMember, onDone }: { council?: `0x${string}`; isMember: boolean; onDone: () => void }) {
  const [actionType, setActionType] = useState(3)
  const [proposalId, setProposalId] = useState('')
  const [newClass, setNewClass] = useState('1')
  const [payloadHash, setPayloadHash] = useState('')
  const [approvalExpiry, setApprovalExpiry] = useState('')
  const [freezeKind, setFreezeKind] = useState(0)
  const [minutes, setMinutes] = useState('60')
  const { proposals, loading: proposalsLoading } = useProposals()

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
  // Reset a pick that the new action type cannot target.
  useEffect(() => {
    if (proposalId && !eligible.some((proposal) => proposal.core.id.toString() === proposalId)) setProposalId('')
  }, [eligible, proposalId])
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
          <input value={newClass} onChange={(event) => setNewClass(event.target.value)} inputMode="numeric" />
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
        disabled={!isMember || Boolean(encoded.error) || expiryTooFar || (needsProposal && !proposalId)}
        onConfirmed={onDone}
      >Create action</TransactionButton>
    </section>
  )
}

export function CouncilPage() {
  const { currentSet } = useContracts()
  const { address } = useWallet()
  const { overview, freeze, loading, error, refresh } = useCouncil()
  const actions = useCouncilActions()
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

      <ActionComposer council={currentSet.council} isMember={isMember} onDone={() => void actions.refresh()} />
      </div>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">On-chain action log</p><h2>Actions</h2></div>
          <span>{actions.actions.length} found</span></div>
        {actions.progress && <p className="scan-progress">{actions.progress}</p>}
        {actions.error && <div className="error-box">{actions.error}</div>}
        <div className="voter-list">{actions.actions.map((action) => {
          const required = actionThreshold(action.actionType, overview.thresholds, freezeKindOf(action.actionType, action.actionData))
          const expired = action.expiresAt <= now && !action.executed
          const ready = action.status === 2 && !action.executed && !expired
          return <article key={action.actionId}>
            <span className={`vote-dot support-${action.executed ? 1 : expired ? 0 : 2}`} />
            <b>{ACTION_TYPE_NAMES[action.actionType] ?? `Type ${action.actionType}`}</b>
            <span>{describeActionData(action.actionType, action.actionData)}</span>
            <span>{action.approvals} / {required} approvals</span>
            <span>{action.executed ? 'Executed' : expired ? 'Expired' : ACTION_STATUS_NAMES[action.status] ?? `Status ${action.status}`}</span>
            <p>
              By {shortAddress(action.creator)} · {expired ? 'Lapsed' : 'Expires'} {formatDate(action.expiresAt)}
              {action.approvers.length > 0 && <> · Approved by {action.approvers.map((approver) => shortAddress(approver)).join(', ')}</>}
            </p>
            {!action.executed && !expired && <div className="action-buttons">
              <TransactionButton
                address={currentSet.council} abi={SecurityCouncilABI as never}
                functionName="approveAction" args={[action.actionId]} variant="secondary"
                disabled={!isMember} onConfirmed={() => void actions.refresh()}
              >Approve</TransactionButton>
              {ready && <TransactionButton
                address={currentSet.council} abi={SecurityCouncilABI as never}
                functionName="executeAction" args={[action.actionId]}
                onConfirmed={() => { void actions.refresh(); void refresh() }}
              >Execute</TransactionButton>}
            </div>}
            {action.transactionHash && <a href={explorerTx(action.transactionHash)} target="_blank" rel="noreferrer"><Users size={14} /></a>}
          </article>
        })}
        {!actions.loading && actions.actions.length === 0 && <div className="empty inline">
          <p>No council actions found. The contract exposes no action enumeration, so this list is built from
          <code>CouncilActionCreated</code> logs within the scanned range.</p></div>}
        </div>
      </section>
    </>}
  </div>
}
