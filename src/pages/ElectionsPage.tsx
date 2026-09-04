import { useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react'
import type { Address } from 'viem'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import { Button } from '@/components/Button'
import { InfoHint } from '@/components/InfoHint'
import { TransactionButton } from '@/components/TransactionButton'
import { useContracts } from '@/config/ContractsContext'
import { useElectionCandidates, useElections } from '@/hooks/useElections'
import {
  ELECTION_KIND_NAMES, ELECTION_STATE_NAMES, electionNextAction,
  formatDate, formatGen, shortAddress,
} from '@/lib/governance'
import { explorerAddress, explorerTx } from '@/lib/rpc'
import type { ElectionSummary } from '@/lib/types'

const HINTS = {
  projection:
    'Recorded by ElectionStarted as a wall-clock projection made when the election opened. A clock freeze shifts the real instant, and the offsets needed to recompute it are not readable, so treat this as indicative rather than a deadline.',
  succeeded:
    'Transient and derived: an election past its vote end reads Succeeded even when it will fail quorum at settle. Turnout, the effective quorum and the GES denominator are all unreadable, so the outcome genuinely cannot be predicted — settling is what decides it.',
  slate:
    'Only the sealed top set. A nominee who never reached it is invisible to the view surface entirely, which is why the candidate roll below is rebuilt from logs.',
  ballot:
    'Limited voting: one to three distinct slated candidates, each receiving your full snapshot weight. One ballot per account, no recasting.',
}

function ElectionCard({ election, elections }: { election: ElectionSummary; elections?: Address }) {
  const [open, setOpen] = useState(false)
  const [picks, setPicks] = useState('')
  const candidates = useElectionCandidates(open ? election.id : undefined, election.blockNumber)

  const picked = picks.split(',').map((value) => value.trim()).filter(Boolean)

  return <article className="panel">
    <div className="section-heading"><div>
      <div className="badges">
        <span className="pill">{ELECTION_STATE_NAMES[election.state] ?? election.state}</span>
        {election.kind !== undefined && <span className="pill">{ELECTION_KIND_NAMES[election.kind] ?? `Kind ${election.kind}`}</span>}
        {election.seatsAtStake !== undefined && <span className="pill">{election.seatsAtStake} seat{election.seatsAtStake === 1 ? '' : 's'}</span>}
      </div>
      <h2>Election #{election.id.toString()}</h2>
      <p className="muted">{electionNextAction(election.state)}
        {election.state === 4 && <InfoHint text={HINTS.succeeded} />}</p>
    </div>
    <Button variant="ghost" onClick={() => setOpen((value) => !value)}>{open ? 'Hide' : 'Details'}</Button></div>

    <div className="header-facts">
      {election.voteStart !== undefined && <span><small>Voting opens<InfoHint text={HINTS.projection} /></small>{formatDate(election.voteStart)}</span>}
      {election.voteEnd !== undefined && <span><small>Voting closes<InfoHint text={HINTS.projection} /></small>{formatDate(election.voteEnd)}</span>}
      <span><small>Slate<InfoHint text={HINTS.slate} /></small>{election.slate.length}</span>
      <span><small>Winners</small>{election.winners.length}</span>
      <span><small>Alternates</small>{election.alternates.length}</span>
      {election.transactionHash && <span><small>Started</small>
        <a className="tx-link" href={explorerTx(election.transactionHash)} target="_blank" rel="noreferrer">View on explorer</a></span>}
    </div>

    {open && <>
      <div className="voter-list">{candidates.candidates.map((candidate) => <article key={candidate.address}>
        <span className={`vote-dot support-${candidate.withdrawn ? 0 : candidate.slated ? 1 : 2}`} />
        <a href={explorerAddress(candidate.address)} target="_blank" rel="noreferrer">{shortAddress(candidate.address)}</a>
        <b>{formatGen(candidate.weight)} GEN</b>
        <span>{candidate.withdrawn ? 'Withdrawn' : candidate.slated ? 'Slated' : 'Nominated'}</span>
        <span>Bond {formatGen(candidate.bond)} GEN</span>
        <p>{election.winners.some((winner) => winner.toLowerCase() === candidate.address.toLowerCase())
          ? 'Elected'
          : election.alternates.some((alternate) => alternate.toLowerCase() === candidate.address.toLowerCase())
            ? 'Alternate'
            : 'Not seated'}</p>
      </article>)}
      {!candidates.loading && candidates.candidates.length === 0 && <div className="empty inline">
        <p>No candidates found in the scanned range.</p></div>}
      </div>

      <div className="form-grid">
        <label className="full"><span className="label-text">Ballot — one to three slated candidates<InfoHint text={HINTS.ballot} /></span>
          <input value={picks} onChange={(event) => setPicks(event.target.value)} placeholder="0xabc…, 0xdef…" />
        </label>
      </div>
      <div className="action-buttons">
        <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never}
          functionName="castBallot" args={[election.id, picked]}
          disabled={picked.length < 1 || picked.length > 3} onConfirmed={() => void candidates.refresh()}>
          Cast ballot
        </TransactionButton>
        <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never} variant="secondary"
          functionName="startEndorsement" args={[election.id]}>Open endorsement</TransactionButton>
        <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never} variant="secondary"
          functionName="sealSlate" args={[election.id]}>Seal slate</TransactionButton>
        <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never} variant="secondary"
          functionName="settleElection" args={[election.id]}>Settle</TransactionButton>
        <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never} variant="ghost"
          functionName="claimBond" args={[election.id]}>Claim bond</TransactionButton>
      </div>
    </>}
  </article>
}

export function ElectionsPage() {
  const { currentSet } = useContracts()
  const { elections, loading, error, refresh } = useElections()

  if (!currentSet?.elections) {
    return <div className="page"><section className="empty"><h1>Select a deployment</h1>
      <p>Set an AddressManager in the header to load its council elections.</p></section></div>
  }

  return <div className="page wide">
    <div className="hero"><div>
      <p className="eyebrow">Protocol governance</p>
      <h1>Council elections</h1>
      <p>Bootstrap, cohort, special, recall and runoff elections, read directly from chain.</p>
    </div><Button variant="ghost" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</Button></div>

    <section className="panel">
      <div className="section-heading"><div><p className="eyebrow">Contract limits</p><h2>What this page cannot show</h2></div></div>
      <div className="role-note"><ShieldAlert size={18} /><p><b>Nomination is not offered here</b>
        <code>nominate</code> requires an exact <code>msg.value</code> of bond plus registration fee plus manifesto
        storage. None of <code>candidateBond</code>, <code>registrationFee</code> or <code>storageFeePerByte</code>
        has a getter, and their setters emit no events, so the required amount is neither readable on-chain nor
        recoverable from logs. Guessing would revert <code>WrongPayment</code>, so the form is omitted — a missing
        contract getter, not a missing feature.</p></div>
      <div className="role-note"><AlertTriangle size={18} /><p><b>No live phase countdown, turnout or quorum</b>
        There is no <code>elections(id)</code> struct getter, so creation time, phase offsets, the endorsement
        snapshot and the effective quorum are unreadable. Turnout appears only after settlement, through
        <code>ElectionSettled</code> and <code>ElectionFailed</code>. The Registration-versus-Endorsement
        sub-phase, the runoff queue, pending recalls and cohort due dates are likewise not exposed.</p></div>
    </section>

    {error && <div className="error-box">{error}</div>}
    {loading && elections.length === 0 && <div className="loading-state">Reading elections directly from chain…</div>}

    {!loading && elections.length === 0 && <section className="empty">
      <h2>No elections yet</h2>
      <p><code>electionCount()</code> is zero on this deployment. The first opens when someone calls
        <code>startElection()</code> past the bootstrap gate — which has no getter either, so the gate cannot be
        read in advance: the call either starts an election or reverts <code>NoElectionDue</code>.</p>
      <TransactionButton address={currentSet.elections} abi={GovernanceCouncilElectionsABI as never}
        functionName="startElection" args={[]} onConfirmed={() => void refresh()}>Start an election</TransactionButton>
    </section>}

    {elections.map((election) => <ElectionCard key={election.id.toString()} election={election} elections={currentSet.elections} />)}
  </div>
}
