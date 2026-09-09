import { useEffect, useRef, useState } from 'react'
import { Check, CheckSquare, Circle, Minus, RefreshCw, Square } from 'lucide-react'
import type { Address } from 'viem'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import { Button } from '@/components/Button'
import { NominateForm } from '@/components/NominateForm'
import { InfoHint } from '@/components/InfoHint'
import { TransactionButton } from '@/components/TransactionButton'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { useCanCall } from '@/hooks/useCanCall'
import { useElectionCandidates, useElections } from '@/hooks/useElections'
import { useElectionParameterHistory } from '@/hooks/useElectionParameterHistory'
import { useElectionParameters, type ElectionParameters } from '@/hooks/useElectionParameters'
import { useNow } from '@/hooks/useNow'
import { useVoterIdentities } from '@/hooks/useVoterIdentities'
import { IdentityPicker } from '@/components/IdentityPicker'
import { ABI_BY_KEY } from '@/lib/abis'
import { ballotRoute } from '@/lib/identity'
import {
  COHORT_NAMES, ELECTION_KIND_NAMES, ELECTION_KIND_RUNOFF, ELECTION_STATE_NAMES, electionCountdown, electionCranks, electionGuide, electionNextAction, electionVerdict,
  formatDate, formatDuration, formatGen, formatPercent, formatRelative, shortAddress, type NominationEconomics,
} from '@/lib/governance'
import { describeMissing, isPresent } from '@/lib/optionalRead'
import { explorerAddress, explorerTx, scanLogs } from '@/lib/rpc'
import type { ElectionCandidate, ElectionSummary } from '@/lib/types'

const HINTS = {
  cohort:
    'Which seats are at stake decides which sitting members may run. Bootstrap puts every seat at stake, so any sitting member may stand. A Cohort election covers exactly that cohort\'s seats, so only members of the expiring cohort may run again. Special and Recall elections target seats no sitting member holds, so no sitting member may register. Anyone else who is funded, not excluded and not in a recall cooldown may nominate in any of them.',
  projection:
    'Recorded by ElectionStarted as a wall-clock projection made when the election opened. A clock freeze shifts the real instant, and this deployment does not expose the offsets needed to recompute it, so treat this as indicative rather than a deadline.',
  exact:
    'Computed from the election\'s stored unfrozen offsets and the clock\'s frozen total — the same arithmetic the contract runs — so this is the boundary it will enforce. Only a freeze that begins after this reading can move it.',
  succeeded:
    'Transient and derived: an election past its vote end reads Succeeded even when it will fail quorum at settle. This deployment exposes neither turnout nor the effective quorum, so the outcome genuinely cannot be predicted — settling is what decides it.',
  verdict:
    'Succeeded is transient until settle runs. The turnout is the stored figure and the quorum is quorumBps × GES at the vote-start snapshot, resolved the way settle resolves it, so this is what settle will record.',
  slateOnly:
    'Only the sealed top set. A nominee who never reached it is invisible to this deployment\'s view surface, which is why the candidate roll below is rebuilt from logs.',
  slate:
    'The sealed top set. The roll below is the contract\'s own nomination list, complete by construction.',
  quorum:
    'Turnout is the ballot weight recorded so far. The requirement is quorumBps of the GES at the vote-start snapshot, floored as settle floors it.',
  ballot:
    'Limited voting: one to three distinct slated candidates, each receiving your full snapshot weight. One ballot per account, no recasting.',
}

function ElectionCard({ election, elections, economics, onChanged }: { election: ElectionSummary; elections?: Address; economics?: NominationEconomics; onChanged: () => void }) {
  // A live election opens by default: its slate, candidates and ballot are
  // the page, and hiding them behind a click made it look like a one-line
  // stub. A recorded one (Failed, Settled) is history and starts collapsed,
  // so the round that needs attention is not buried under the rounds that
  // preceded it. Details still opens any of them.
  const { address } = useWallet()
  const now = useNow(10_000)
  const [open, setOpen] = useState(election.state < 5)
  const [picks, setPicks] = useState('')
  const [order, setOrder] = useState<'nomination' | 'weight'>('nomination')
  const [ballotAs, setBallotAs] = useState<Address | ''>('')
  const candidates = useElectionCandidates(open ? election.id : undefined, election.blockNumber)
  // Ballot weight is the identity's weight at the vote-start snapshot, which
  // the struct locates exactly; without it the projection from the log is
  // the best available instant.
  const ballotOpen = open && election.state === 3
  const identities = useVoterIdentities(ballotOpen ? { electionId: election.id, snapshot: election.snapshotInstant ?? election.bounds?.voteStart ?? election.voteStart } : {})
  const ballotIdentity = identities.identities.find((entry) => entry.kind !== 'eoa' && entry.address === ballotAs) ?? (address ? { kind: 'eoa' as const, address } : undefined)
  // hasBalloted for whichever identity the ballot would go out as. The hook
  // answers it for the EOA row too; without this the form came straight back
  // after a cast, inviting a second ballot the contract rejects.
  const ballotState = ballotIdentity ? identities.identities.find((entry) => entry.address.toLowerCase() === ballotIdentity.address.toLowerCase()) : undefined
  const alreadyBalloted = ballotState?.hasVoted === true
  const [castPicks, setCastPicks] = useState<Address[]>()
  useEffect(() => {
    if (!alreadyBalloted || !elections || !ballotIdentity) { setCastPicks(undefined); return }
    let cancelled = false
    scanLogs({ address: elections, abi: GovernanceCouncilElectionsABI as never, eventName: 'BallotCast' as never, args: { electionId: election.id, voter: ballotIdentity.address }, fromBlock: election.blockNumber })
      .then((logs) => { if (!cancelled) setCastPicks(((logs as any[])[0]?.args.candidates as Address[] | undefined) ?? []) })
      .catch(() => { if (!cancelled) setCastPicks([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyBalloted, elections, ballotIdentity?.address, election.id, election.blockNumber])

  const picked = picks.split(',').map((value) => value.trim()).filter(Boolean)
  const isPicked = (candidate: Address) => picked.some((pick) => pick.toLowerCase() === candidate.toLowerCase())
  // The row control and the text field are two views of one list: clicking a
  // row adds or removes that address, and whatever was typed by hand stays.
  const togglePick = (candidate: Address) => setPicks(isPicked(candidate)
    ? picked.filter((pick) => pick.toLowerCase() !== candidate.toLowerCase()).join(', ')
    : [...picked, candidate].join(', '))
  const endorsementOpened = election.details !== undefined && election.details.endorsementSnapshot !== 0n
  const sealed = election.details?.sealed ?? false
  const cranks = electionCranks(election.state, endorsementOpened, sealed)
  // claimBond reverts NothingToClaim for anyone who did not nominate, which is
  // almost everyone looking at the page. Simulating it is the only way to know:
  // the claimable set is not readable, and it opens as soon as a slate is
  // sealed without you on it, not only after settlement.
  const { allowed: canClaim } = useCanCall({
    address: elections, abi: GovernanceCouncilElectionsABI as never, functionName: 'claimBond',
    args: [election.id], account: address, enabled: open && election.state >= 2,
  })

  // Registration is knowable only with the struct; endorsement is offered
  // whenever Nomination is not provably still in registration, and the
  // contract's EndorsementNotStarted says the rest. With the struct, a zero
  // snapshot past the registration offset means the crank has not run yet:
  // endorse would revert, so the row buttons wait for Open endorsement.
  const inRegistration = election.state === 1 && election.subPhase === 'registration'
  const awaitingCrank = election.state === 1 && election.subPhase === 'endorsement' && election.details !== undefined && !endorsementOpened
  const mayEndorse = election.state === 1 && election.subPhase !== 'registration' && election.kind !== ELECTION_KIND_RUNOFF && !awaitingCrank
  const own = (candidate: Address) => !!address && candidate.toLowerCase() === address.toLowerCase()
  const bounds = election.bounds
  const countdown = bounds ? electionCountdown(election.state, election.subPhase, bounds) : undefined
  // A phase boundary is a moment, and the page used to sit on the old phase
  // until someone clicked Refresh: Preparation kept showing while voting had
  // opened. Once the clock passes the boundary the card is counting down to,
  // re-read the election — once per boundary, so a stale RPC cannot loop it.
  const refreshedFor = useRef<bigint | undefined>(undefined)
  useEffect(() => {
    if (!countdown || now < countdown.at || refreshedFor.current === countdown.at) return
    refreshedFor.current = countdown.at
    onChanged()
  }, [countdown, now, onChanged])
  const verdict = election.details ? electionVerdict(election.details, election.ges) : 'unknown'
  const sorted = [...candidates.candidates].sort((a, b) => order === 'weight' || !candidates.complete
    ? (a.weight === b.weight ? 0 : a.weight > b.weight ? -1 : 1)
    : (a.nominationSeq ?? 0) - (b.nominationSeq ?? 0))

  return <article className="panel election-card">
    <div className="section-heading"><div>
      <div className="badges">
        <span className="pill">{ELECTION_STATE_NAMES[election.state] ?? election.state}</span>
        {election.kind !== undefined && <span className="pill">{ELECTION_KIND_NAMES[election.kind] ?? `Kind ${election.kind}`}</span>}
        {election.seatsAtStake !== undefined && <span className="pill">{election.seatsAtStake} seat{election.seatsAtStake === 1 ? '' : 's'}</span>}
        {election.details && election.details.kind !== 0 && <span className="pill">Cohort {election.details.cohortId}</span>}
        {election.details && election.details.parentElection !== 0n && <span className="pill">Retry of #{election.details.parentElection.toString()}</span>}
      </div>
      <h2>Election #{election.id.toString()}</h2>
      <p className="muted">{electionNextAction(election.state, election.subPhase)}
        {election.state === 4 && (election.details
          ? verdict === 'unknown'
            ? <> · outcome pending the snapshot GES<InfoHint text={HINTS.verdict} /></>
            : verdict === 'succeeded'
              ? <> · quorum reached — settling records Succeeded<InfoHint text={HINTS.verdict} /></>
              : <> · below quorum — settling records Failed and opens a retry at {(election.details.quorumBps / 200).toFixed(1)}%<InfoHint text={HINTS.verdict} /></>
          : <InfoHint text={HINTS.succeeded} />)}</p>
    </div>
    <Button variant="ghost" onClick={() => setOpen((value) => !value)}>{open ? 'Hide' : 'Details'}</Button></div>

    <div className="header-facts">
      {countdown && <span><small>{countdown.label}<InfoHint text={HINTS.exact} /></small>{formatDate(countdown.at)}<small>{formatRelative(countdown.at, now)}</small></span>}
      {election.details && <span><small>Cohort<InfoHint text={HINTS.cohort} /></small>
        {election.details.kind === 1 ? `Cohort ${COHORT_NAMES[election.details.cohortId] ?? election.details.cohortId}` : election.details.kind === 0 ? 'All seats' : `Cohort ${COHORT_NAMES[election.details.cohortId] ?? election.details.cohortId} seats`}
        <small>{election.details.kind === 0 ? 'any sitting member may run' : election.details.kind === 1 ? 'only its sitting members may run again' : 'no sitting member may register'}</small></span>}
      {bounds
        ? <>
          {election.state < 3 && <span><small>Voting opens<InfoHint text={HINTS.exact} /></small>{formatDate(bounds.voteStart)}</span>}
          <span><small>Voting closes<InfoHint text={HINTS.exact} /></small>{formatDate(bounds.voteEnd)}</span>
        </>
        : <>
          {election.voteStart !== undefined && <span><small>Voting opens<InfoHint text={HINTS.projection} /></small>{formatDate(election.voteStart)}</span>}
          {election.voteEnd !== undefined && <span><small>Voting closes<InfoHint text={HINTS.projection} /></small>{formatDate(election.voteEnd)}</span>}
        </>}
      {election.turnout !== undefined && election.state >= 3 && <span><small>Turnout<InfoHint text={HINTS.quorum} /></small>
        {formatGen(election.turnout)} GEN
        {election.quorumRequired !== undefined && election.ges !== undefined && <small>of {formatGen(election.quorumRequired)} GEN required ({formatPercent(election.turnout, election.ges)} of GES, quorum {(election.quorumBps ?? 0) / 100}%)</small>}
      </span>}
      <span><small>Slate<InfoHint text={candidates.complete ? HINTS.slate : HINTS.slateOnly} /></small>{election.slate.length}</span>
      <span><small>Winners</small>{election.winners.length}</span>
      <span><small>Alternates</small>{election.alternates.length}</span>
      {election.details && election.details.termEnd !== 0n && <span><small>Term ends</small>{formatDate(election.details.termEnd)}</span>}
      {election.transactionHash && <span><small>Started</small>
        <a className="tx-link" href={explorerTx(election.transactionHash)} target="_blank" rel="noreferrer">View on explorer</a></span>}
    </div>

    {open && <>
      <ElectionGuide steps={electionGuide({
        state: election.state, subPhase: election.subPhase, kind: election.kind,
        endorsementOpened, sealed, slateEmpty: election.slate.length === 0,
      })} />
      {candidates.candidates.length > 1 && candidates.complete && <p className="hint">
        Order: <button type="button" className="link-button" onClick={() => setOrder(order === 'weight' ? 'nomination' : 'weight')}>{order === 'weight' ? 'by weight' : 'as nominated'}</button></p>}
      <div className="voter-list">{sorted.map((candidate) => <CandidateRow key={candidate.address} candidate={candidate} election={election} elections={elections}
        mayEndorse={mayEndorse} mayWithdraw={inRegistration && own(candidate.address)}
        pick={election.state === 3 && !alreadyBalloted ? { picked: isPicked(candidate.address), full: picked.length >= 3, toggle: () => togglePick(candidate.address) } : undefined}
        onChanged={() => { void candidates.refresh(); onChanged() }} />)}
      {!candidates.loading && candidates.candidates.length === 0 && <div className="empty inline">
        <p>{candidates.complete ? 'No candidates.' : 'No candidates found in the scanned range.'}</p></div>}
      </div>

      {inRegistration && election.kind !== ELECTION_KIND_RUNOFF && (economics
        ? candidates.candidates.some((candidate) => own(candidate.address) && !candidate.withdrawn)
          ? <p className="hint">This account is a candidate in this election. Withdraw from its row above while registration is open; the bond is refunded on the spot.</p>
          : <NominateForm election={election} elections={elections!} economics={economics} onNominated={() => { void candidates.refresh(); onChanged() }} />
        : <p className="hint">Nomination is not offered on this deployment: <code>nominate</code> demands an exact value of bond + registration fee + manifesto storage, and none of the three is readable here.</p>)}
      {/* The slate is built ONLY from endorsements: nominating puts a name on
          the roll, endorsing is what lifts it into the top set the ballot is
          restricted to. A round that ends endorsement with nobody endorsed
          seals an empty slate, every ballot reverts NotSlated, and settle
          fails it on quorum — a silent outcome unless the page says so. */}
      {election.state >= 1 && election.state <= 4 && election.slate.length === 0 && candidates.candidates.length > 0 && !(election.state === 1 && election.subPhase === 'registration') && <div className="error-box">
        {election.state === 1
          ? 'No candidate has been endorsed yet. Only endorsed candidates reach the slate the ballot is restricted to: if endorsement closes with an empty slate, no ballot can be cast and this election fails at settle.'
          : 'The slate is empty: no candidate was endorsed while endorsement was open. No ballot can be cast, settle will fail this election, and the retry that follows starts with registration again.'}
      </div>}
      {mayEndorse && <p className="hint">Endorse up to three candidates; each endorsement carries this account's weight at the endorsement snapshot. Endorsing promotes a candidate towards the sealed slate.</p>}
      {cranks.some((crank) => crank.fn === 'castBallot') && <div className="form-grid">
        {address && identities.identities.length > 1 && <div className="full"><IdentityPicker label="Ballot as" identities={identities.identities} selected={ballotAs} onSelect={setBallotAs} loading={identities.loading} error={identities.error} /></div>}
        {ballotState && <div className="full your-power"><small>Weight at the vote snapshot</small><b>{formatGen(ballotState.weight)} GEN</b>
          <p>{alreadyBalloted
            ? castPicks === undefined ? 'Ballot cast.' : castPicks.length === 0 ? 'Ballot cast; the picks could not be read.' : `Ballot cast for ${castPicks.map((pick) => shortAddress(pick)).join(', ')}.`
            : ballotState.weight === 0n ? 'No weight at the snapshot: a ballot from this account would revert.' : 'Not balloted yet.'}</p></div>}
        {!alreadyBalloted && <label className="full"><span className="label-text">Ballot — one to three slated candidates<InfoHint text={HINTS.ballot} /></span>
          <input value={picks} onChange={(event) => setPicks(event.target.value)} placeholder="0xabc…, 0xdef…" />
        </label>}
      </div>}
      <div className="action-buttons">
        {/* Only the crank this phase actually accepts. The others are not
            disabled but absent: startEndorsement is idempotent, so calling it
            twice succeeds silently and the button would sit there reading
            "Confirmed" forever, inviting a second pointless transaction. */}
        {cranks.filter((crank) => !(crank.fn === 'castBallot' && alreadyBalloted)).map((crank) => {
          const ballot = crank.fn === 'castBallot' && ballotIdentity && elections ? ballotRoute(ballotIdentity, elections, election.id, picked as Address[]) : undefined
          return <TransactionButton key={crank.fn}
            address={ballot?.address ?? elections} abi={ballot ? ABI_BY_KEY[ballot.abi] : (GovernanceCouncilElectionsABI as never)}
            functionName={ballot?.functionName ?? crank.fn}
            args={ballot?.args ?? (crank.fn === 'castBallot' ? [election.id, picked] : [election.id])}
            disabled={crank.fn === 'castBallot' && (picked.length < 1 || picked.length > 3)}
            onConfirmed={() => { void candidates.refresh(); void identities.refresh(); onChanged() }}>
            {crank.label}{ballotIdentity && ballotIdentity.kind !== 'eoa' && crank.fn === 'castBallot' ? ` as ${shortAddress(ballotIdentity.address)}` : ''}
          </TransactionButton>
        })}
        {/* Claimable the moment the slate is sealed without you on it, not
            only after settlement — so it stands apart from the phase crank. */}
        {canClaim && <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never}
          functionName="claimBond" args={[election.id]} variant="ghost"
          onConfirmed={() => void candidates.refresh()}>Claim bond</TransactionButton>}
        {cranks.length === 0 && !canClaim && <p className="hint">
          {election.state < 2
            ? 'No transaction is needed in this phase.'
            : election.state === 2
              ? 'The slate is sealed. Voting opens at the time shown above; the ballot appears here then.'
              : 'Nothing left to do here: this election is recorded, and this account has no bond to claim.'}</p>}
        {election.state === 1 && election.subPhase === 'registration' && <p className="hint">
          Registration is open: <code>startEndorsement</code> closes it once the registration offset has elapsed, and
          endorsement runs until the nomination offset.</p>}
        {awaitingCrank && <p className="hint">
          The registration offset has elapsed but endorsement is not open yet: anyone may open it, and endorsing
          becomes possible right after.</p>}
        {endorsementOpened && election.state === 1 && <p className="hint">
          Endorsement is open. Nothing else needs a transaction until the endorsement window closes and the slate can be sealed.</p>}
      </div>
    </>}
  </article>
}

/** The on-chain manifesto, read on demand: it can be 16 KB, and most visitors never open it. */
/**
 * What to do next, as a checklist: the badge says where the election is, this
 * says what a person should do about it. Only the current step carries its
 * instruction; the rest are titles, so the list stays a glance rather than a
 * manual.
 */
function ElectionGuide({ steps }: { steps: ReturnType<typeof electionGuide> }) {
  return <ol className="timeline election-guide">{steps.map((step) => <li key={step.key} className={step.status}>
    <span>{step.status === 'done' ? <Check size={13} /> : step.status === 'skipped' ? <Minus size={13} /> : <Circle size={13} />}</span>
    <div><b>{step.title}</b>{step.status === 'current' && <small>{step.instruction}</small>}</div>
  </li>)}</ol>
}

function CandidateRow({ candidate, election, elections, mayEndorse, mayWithdraw, pick, onChanged }: {
  candidate: ElectionCandidate; election: ElectionSummary; elections?: Address; mayEndorse: boolean; mayWithdraw: boolean
  /** Present during Voting: the row's place in the ballot being composed. */
  pick?: { picked: boolean; full: boolean; toggle: () => void }
  onChanged: () => void
}) {
  // The manifesto opens as a full-width line UNDER the cells, not inside the
  // actions column: each row is its own grid, so a manifesto growing inside
  // the last track widened it and shifted that one row's columns out of line
  // with its neighbours.
  const [manifestoOpen, setManifestoOpen] = useState(false)
  const seat = election.winners.some((winner) => winner.toLowerCase() === candidate.address.toLowerCase())
    ? 'Elected'
    : election.alternates.some((alternate) => alternate.toLowerCase() === candidate.address.toLowerCase())
      ? 'Alternate'
      : 'Not seated'
  // Only slated candidates can be balloted (castBallot reverts NotSlated), so
  // the control is offered on those rows alone; the others say why.
  const pickable = pick !== undefined && candidate.slated && !candidate.withdrawn
  return <article className={pick?.picked ? 'picked' : undefined}>
    <span className={`vote-dot support-${candidate.withdrawn ? 0 : candidate.slated ? 1 : 2}`} />
    <span className="candidate-cell">
      {pickable && <button type="button" className="pick-toggle" aria-pressed={pick.picked}
        title={pick.picked ? 'Remove from ballot' : pick.full ? 'The ballot already holds three candidates' : 'Add to ballot'}
        disabled={!pick.picked && pick.full} onClick={pick.toggle}>
        {pick.picked ? <CheckSquare size={14} /> : <Square size={14} />}</button>}
      {pick !== undefined && !pickable && <span className="pick-toggle unavailable" title={candidate.withdrawn ? 'Withdrawn' : 'Not slated — cannot be balloted'}><Square size={14} /></span>}
      <a href={explorerAddress(candidate.address)} target="_blank" rel="noreferrer">{shortAddress(candidate.address)}</a>
    </span>
    <b>{formatGen(candidate.weight)} GEN</b>
    <span>{candidate.withdrawn ? 'Withdrawn' : candidate.slated ? 'Slated' : 'Nominated'}{candidate.autoNominated ? ' · incumbent' : ''}</span>
    <span>{candidate.autoNominated ? 'No bond' : candidate.bondClaimed ? `Bond ${candidate.withdrawn ? 'refunded' : 'claimed'}` : `Bond ${formatGen(candidate.bond)} GEN`}</span>
    <p>{seat}</p>
    <span className="row-actions">
      <button type="button" className="link-button manifesto-toggle" aria-expanded={manifestoOpen} onClick={() => setManifestoOpen((value) => !value)}>
        {manifestoOpen ? '▾' : '▸'} Manifesto</button>
      {mayEndorse && !candidate.withdrawn && <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never} functionName="endorse" args={[election.id, candidate.address]} variant="ghost" onConfirmed={onChanged}>Endorse</TransactionButton>}
      {mayWithdraw && !candidate.withdrawn && <TransactionButton address={elections} abi={GovernanceCouncilElectionsABI as never} functionName="withdrawCandidacy" args={[election.id]} variant="ghost" onConfirmed={onChanged}>Withdraw</TransactionButton>}
    </span>
    {manifestoOpen && <CandidateManifesto elections={elections} electionId={election.id} candidate={candidate.address} />}
  </article>
}

/** Mounted only while open, so the read happens on first expand and never for rows nobody looks at. */
function CandidateManifesto({ elections, electionId, candidate }: { elections?: Address; electionId: bigint; candidate: Address }) {
  const [text, setText] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!elections) return
    let cancelled = false
    publicClient.readContract({ address: elections, abi: GovernanceCouncilElectionsABI as never, functionName: 'candidateManifesto', args: [electionId, candidate] } as never)
      .then((value) => { if (!cancelled) setText(value as string) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [elections, electionId, candidate])
  return <div className="manifesto-body">
    {failed ? <p className="hint">The manifesto could not be read.</p> : text === undefined ? <p className="hint">Reading…</p> : text.trim() ? <pre className="raw-text">{text}</pre> : <p className="hint">Empty manifesto.</p>}
  </div>
}

function bps(value: number) { return `${value / 100}%` }

function ParametersPanel({ parameters }: { parameters: ElectionParameters }) {
  const history = useElectionParameterHistory()
  const economics = parameters.economics
  return <section className="panel">
    <div className="section-heading"><div><h2>Election parameters</h2>
      <p className="muted">The live values every election is measured against. A running election keeps the slate, floors and quorum it snapshotted at its start.</p></div>
      <Button variant="ghost" onClick={() => void parameters.refresh()}><RefreshCw size={15} /> Refresh</Button></div>
    <div className="header-facts">
      {isPresent(economics)
        ? <>
          <span><small>Candidate bond</small>{formatGen(economics.value.candidateBond)} GEN<small>refundable</small></span>
          <span><small>Registration fee</small>{formatGen(economics.value.registrationFee)} GEN<small>non-refundable</small></span>
          <span><small>Manifesto storage</small>{formatGen(economics.value.storageFeePerByte, 6)} GEN / byte<small>beyond the first 1,024 bytes</small></span>
        </>
        : <span><small>Nomination cost</small><em className="muted">{describeMissing(economics, 'The nomination cost')}</em></span>}
      {isPresent(parameters.periods)
        ? <span><small>Phases</small>{formatDuration(parameters.periods.value.registration)} · {formatDuration(parameters.periods.value.endorsement)} · {formatDuration(parameters.periods.value.preparation)} · {formatDuration(parameters.periods.value.voting)}<small>registration · endorsement · preparation · voting</small></span>
        : <span><small>Phases</small><em className="muted">{describeMissing(parameters.periods, 'The phase lengths')}</em></span>}
      {isPresent(parameters.quorums)
        ? <span><small>Quorum</small>{bps(parameters.quorums.value.quorumBps)} of GES<small>floor {bps(parameters.quorums.value.quorumFloorBps)} · seat floor {bps(parameters.quorums.value.minSupportBps)} · refund floor {bps(parameters.quorums.value.refundFloorBps)}</small></span>
        : <span><small>Quorum</small><em className="muted">{describeMissing(parameters.quorums, 'The quorum')}</em></span>}
      {isPresent(parameters.termLength)
        ? <span><small>Term</small>{formatDuration(parameters.termLength.value)}</span>
        : <span><small>Term</small><em className="muted">{describeMissing(parameters.termLength, 'The term length')}</em></span>}
      {parameters.slate && <span><small>Slate</small>{parameters.slate.slateCap} candidates<small>{parameters.slate.alternates} alternate{parameters.slate.alternates === 1 ? '' : 's'}</small></span>}
      {parameters.recall && <span><small>Recall</small>{formatDuration(parameters.recall.registration)} · {formatDuration(parameters.recall.endorsement)} · {formatDuration(parameters.recall.preparation)} · {formatDuration(parameters.recall.voting)}<small>cooldown {formatDuration(parameters.recall.cooldown)} · ratify grace {formatDuration(parameters.recall.ratifyGrace)}</small></span>}
    </div>
    <details onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !history.scanned && !history.loading) void history.scan() }}>
      <summary>Parameter changes</summary>
      <p className="hint">Every setter emits the values it stored, so a past parameter can be recovered from history. Scanned from the contract's creation block on demand; a deployment whose setters predate the events shows nothing here.</p>
      {history.progress && <p className="hint">{history.progress}</p>}
      {history.error && <div className="error-box">{history.partial ? 'The scan stopped early; the rows below are what it found. ' : ''}{history.error} <Button variant="ghost" onClick={() => void history.scan()}>Retry</Button></div>}
      {history.scanned && history.changes.length === 0 && <p className="hint">No parameter changes have been emitted on this deployment.</p>}
      {history.changes.length > 0 && <div className="voter-list">{history.changes.map((change) => <article key={`${change.transactionHash}:${change.event}`}>
        <b>{change.event.replace(/Set$/, '')}</b>
        <span>{Object.entries(change.values).map(([key, value]) => `${key} = ${value}`).join(' · ')}</span>
        <span>{change.timestamp !== undefined ? formatDate(change.timestamp) : `block ${change.blockNumber.toString()}`}</span>
        <a className="tx-link" href={explorerTx(change.transactionHash)} target="_blank" rel="noreferrer">View on explorer</a>
      </article>)}</div>}
    </details>
  </section>
}

export function ElectionsPage() {
  const { book } = useContracts()
  const { address } = useWallet()
  const { elections, loading, error, source, refresh } = useElections()
  // startElection is permissionless and due whenever no election is live
  // and a trigger has arrived: the bootstrap gate, a cohort expiry, a
  // special-election condition, a queued recall, or the retry a failed
  // election opens at a halved quorum. None of that is readable as one
  // flag, so the call is simulated: allowed means due, refused means the
  // contract said NoElectionDue (or why not).
  const anyLive = elections.some((election) => election.state >= 1 && election.state <= 4)
  const { allowed: startDue, reason: startRefusal } = useCanCall({
    address: book?.elections, abi: GovernanceCouncilElectionsABI as never, functionName: 'startElection',
    args: [], account: address, enabled: !loading && !anyLive,
  })
  const parameters = useElectionParameters()
  const economics = isPresent(parameters.economics) ? parameters.economics.value : undefined

  if (!book?.elections) {
    return <div className="page"><section className="empty"><h1>Select a deployment</h1>
      <p>Set an AddressManager in the header to load its council elections.</p></section></div>
  }

  return <div className="page wide">
    <div className="hero"><div>
      <p className="eyebrow">Protocol governance</p>
      <h1>Council elections</h1>
      <p>Bootstrap, cohort, special, recall and runoff elections, read directly from chain.</p>
    </div><Button variant="ghost" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</Button></div>

    <ParametersPanel parameters={parameters} />

    {!anyLive && elections.length > 0 && (startDue
      ? <section className="panel"><div className="section-heading"><div><p className="eyebrow">Due now</p><h2>An election can be started</h2>
        <p className="muted">{elections[0]?.state === 5 ? `Election #${elections[0].id} failed quorum, so its retry is due at a halved quorum.` : 'A cohort expiry, special-election trigger, queued recall or the bootstrap gate has arrived.'} Anyone may open it.</p></div>
        <TransactionButton address={book.elections} abi={GovernanceCouncilElectionsABI as never} functionName="startElection" args={[]} onConfirmed={() => void refresh()}>Start election</TransactionButton></div></section>
      : startDue === false && startRefusal && <p className="hint">No election is due: {startRefusal}</p>)}

    {error && <div className="error-box">{error}</div>}
    {loading && elections.length === 0 && <div className="loading-state">Reading elections directly from chain…</div>}
    {source === 'unknown' && elections.length > 0 && <div className="error-box">The election struct could not be read from the node, so phase boundaries below are the projections recorded at start. Refresh to try again.</div>}

    {!loading && elections.length === 0 && <section className="empty">
      <h2>No elections yet</h2>
      <p><code>electionCount()</code> is zero on this deployment. The first opens when someone calls
        <code>startElection()</code> past the bootstrap gate — which has no getter either, so the gate cannot be
        read in advance: the call either starts an election or reverts <code>NoElectionDue</code>.</p>
      <TransactionButton address={book.elections} abi={GovernanceCouncilElectionsABI as never}
        functionName="startElection" args={[]} onConfirmed={() => void refresh()}>Start an election</TransactionButton>
    </section>}

    {elections.map((election) => <ElectionCard key={election.id.toString()} election={election} elections={book.elections} economics={economics} onChanged={() => void refresh()} />)}
  </div>
}
