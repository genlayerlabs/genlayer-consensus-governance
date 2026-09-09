import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Ban, Check, Circle, ExternalLink, Hourglass, RefreshCw, ShieldAlert, Trophy, Vote } from 'lucide-react'
import { useWallet } from '@/config/WalletContext'
import { decodeAbiParameters, keccak256, stringToHex, toFunctionSelector } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import GovernanceClassRegistryABI from '@/abi/GovernanceClassRegistry.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import GovernanceGESRegistryABI from '@/abi/GovernanceGESRegistry.json'
import GovernanceABI from '@/abi/Governance.json'
import GovernanceL1BridgeABI from '@/abi/GovernanceL1Bridge.json'
import { useContracts } from '@/config/ContractsContext'
import { InfoHint } from '@/components/InfoHint'
import { useCanCall } from '@/hooks/useCanCall'
import { useGlfRole } from '@/hooks/useGlfRole'
import { useProposal } from '@/hooks/useProposal'
import { useVoterIdentities } from '@/hooks/useVoterIdentities'
import { IdentityPicker } from '@/components/IdentityPicker'
import { ABI_BY_KEY } from '@/lib/abis'
import { voteRoute } from '@/lib/identity'
import { useVoteRecords } from '@/hooks/useVoteRecords'
import { byteLength, CLASS_NAMES, descriptionHash, formatDate, formatDuration, formatGen, formatPercent, payloadHash, preserveAlignedBlocks, PROBE_HASH, proposalNextAction, shortAddress, STATE_NAMES, SUPPORT_NAMES, VETO_GROUNDS, voteChecks, voteVerdict, ZERO_HASH } from '@/lib/governance'
import { explorerAddress, explorerTx } from '@/lib/rpc'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { TransactionButton } from '@/components/TransactionButton'
import type { GovernanceIdentities, Operation, ProposalSummary } from '@/lib/types'

function parseId(value?: string) {
  try { const id = BigInt(value ?? ''); return id > 0n ? id : undefined } catch { return undefined }
}

/** Name and decode an operation whose target is one of the sealed book's identities (CON-865). */
function decodeKnownOperation(operation: Operation, book: GovernanceIdentities) {
  const candidates = [
    [book.voting, 'GovernanceVoting', GovernanceVotingABI], [book.votingPower, 'GovernanceVotingPower', GovernanceVotingPowerABI],
    [book.classRegistry, 'GovernanceClassRegistry', GovernanceClassRegistryABI], [book.clock, 'GovernanceClock', GovernanceClockABI],
    [book.gesRegistry, 'GovernanceGESRegistry', GovernanceGESRegistryABI], [book.executor, 'Governance executor', GovernanceABI],
    [book.l1Bridge, 'GovernanceL1Bridge', GovernanceL1BridgeABI],
  ] as const
  // an optional member the deployment never selected is undefined and can match nothing
  const candidate = candidates.find(([address]) => address?.toLowerCase() === operation.target.toLowerCase())
  if (!candidate) return undefined
  const item = (candidate[2] as any[]).find((entry) => entry.type === 'function' && toFunctionSelector(entry) === operation.selector)
  if (!item) return { contract: candidate[1], signature: `Unknown selector ${operation.selector}`, args: undefined }
  const signature = `${item.name}(${item.inputs.map((input: any) => input.type).join(',')})`
  try {
    const args = decodeAbiParameters(item.inputs, operation.args)
    return { contract: candidate[1], signature, args: JSON.stringify(args, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) }
  } catch { return { contract: candidate[1], signature, args: 'Arguments could not be decoded with the vendored ABI.' } }
}

function Rule({ title, current, required, met, detail }: { title: string; current: string; required: string; met: boolean; detail: string }) {
  return <article className={`rule-card ${met ? 'met' : 'unmet'}`}><span>{met ? <Check size={17} /> : <Circle size={17} />}</span><div><small>{title}</small><b>{current} <em>{met ? 'meets' : 'needs'} {required}</em></b><p>{detail}</p></div></article>
}

function Lifecycle({ state, creationTime, voteStart, voteEnd, eta, deadline, requiresRiskReview, hasL1, rules, postVote }: { state: number; creationTime: number; voteStart: bigint; voteEnd: bigint; eta: bigint; deadline: bigint; requiresRiskReview: boolean; hasL1: boolean; rules: ProposalSummary['rules']; postVote: ProposalSummary['postVote'] }) {
  // vetoClose = voteEnd + the window in force; the two-member extension
  // (§5.5 rule 1) swaps in extendedVetoWindow, so read the flag rather than
  // assuming. Both later deadlines hang off this instant.
  const vetoClose = voteEnd + BigInt(postVote.vetoExtended ? rules.extendedVetoWindow : rules.vetoWindow)
  // Approval offsets are unfrozen seconds from creation; both bodies may
  // approve, and the FIRST one sets the eta, so report whichever landed.
  const approvedAt = (offset: number) => formatDate(BigInt(creationTime) + BigInt(offset))
  const riskReviewStatus = postVote.scApprovedAtOffset !== 0
    ? `Approved by the Security Council ${approvedAt(postVote.scApprovedAtOffset)}`
    : postVote.glfApprovedAtOffset !== 0
      ? `Approved by the GLF signer ${approvedAt(postVote.glfApprovedAtOffset)}`
      : `Approve before ${formatDate(vetoClose + BigInt(rules.reviewWindow))} or the proposal expires`
  const steps = [
    { label: 'Created & preparation', when: `Voting opens ${formatDate(voteStart)}`, done: state > 0, current: state === 0 },
    { label: 'Active voting', when: `Deadline ${formatDate(voteEnd)}`, done: state > 1, current: state === 1 },
    { label: 'Vote outcome', when: state === 2 ? 'Defeated — see passage rules' : 'Succeeded after settlement', done: state >= 3 && state !== 13, current: state === 2 || state === 3 || state === 13 },
    { label: 'GLF veto window', when: `Closes ${formatDate(vetoClose)}${postVote.vetoExtended ? ' (extended)' : ''}`, done: state > 4 && state !== 5, current: state === 4 || state === 5 },
    // Risk Review is not open-ended: _postVoteState expires the proposal at
    // anchor + reviewWindow if neither body has approved, so the deadline
    // belongs on the step that is waiting for a human.
    // Once a body has approved, the expiry warning is not just redundant but
    // wrong — nothing expires any more, and it repeats the ETA shown below it
    // for a different reason. Report WHO approved instead; the deadline only
    // belongs on a step still waiting for someone.
    ...(requiresRiskReview ? [{ label: 'Risk Review', when: riskReviewStatus, done: state > 6 && state !== 5, current: state === 6 }] : []),
    { label: 'Class timelock', when: eta ? `Execution ETA ${formatDate(eta)}` : 'ETA is set during settlement', done: state > 7 && state !== 11, current: state === 7 },
    { label: 'Execution window', when: deadline ? `Expires ${formatDate(deadline)}` : 'Permissionless after timelock', done: state === 9, current: state === 8 || state === 10 || state === 11 },
    ...(hasL1 ? [{ label: 'L2 → L1 execution leg', when: 'Bridge message, L1 timelock, execution, cancellation, and expiry are verified from the deployed bridge', done: state === 9, current: state === 8 || state === 10 }] : []),
  ]
  return <ol className="timeline">{steps.map((step) => <li className={step.current ? 'current' : step.done ? 'done' : ''} key={step.label}><span>{step.done ? <Check size={14} /> : <Circle size={14} />}</span><div><b>{step.label}</b><small>{step.when}</small></div></li>)}</ol>
}

export function ProposalPage() {
  const { proposalId } = useParams()
  const id = parseId(proposalId)
  const { voting, book } = useContracts()
  const { isConnected, address } = useWallet()
  const { proposal, loading, error, refresh } = useProposal(id)
  // The roles are read from glfVetoSigner()/glfMembers() where the deployment
  // exposes them (CON-864). Where it does not, the account is probed by
  // simulating the gated call — and only while a review is actually open:
  // outside state 6 the call reverts WrongState for everyone, which would
  // read as "not the signer".
  const glf = useGlfRole(address)
  const rolesReadable = glf.source === 'getter'
  const probeRoles = glf.source === 'absent' || glf.source === 'unknown'
  const { allowed: probedSigner } = useCanCall({
    address: voting, abi: GovernanceVotingABI as never, functionName: 'approveRiskReview',
    args: [id], account: address, enabled: proposal?.state === 6 && probeRoles,
  })
  const isGlfSigner = rolesReadable ? glf.isSigner : probedSigner
  const voters = useVoteRecords(voting, id, proposal?.blockNumber)
  const [support, setSupport] = useState(1)
  const [reason, setReason] = useState('')
  const [voterFilter, setVoterFilter] = useState('all')
  // '' = the connected EOA; otherwise the validator wallet or vesting to vote THROUGH
  const [voteAs, setVoteAs] = useState<`0x${string}` | ''>('')
  const [vetoGround, setVetoGround] = useState(0)
  const [vetoRationale, setVetoRationale] = useState('')

  // Same question as Risk Review, twice over: veto is the GLF SIGNER,
  // extendVetoWindow is any GLF MEMBER. Without the getters both are probed;
  // veto() rejects a zero rationale hash BEFORE it checks the caller, so the
  // probe has to carry a non-zero one — this hash is never submitted.
  const { allowed: probedVeto } = useCanCall({
    address: voting, abi: GovernanceVotingABI as never, functionName: 'veto',
    args: [id, vetoGround, PROBE_HASH], account: address, enabled: proposal?.state === 4 && probeRoles,
  })
  const { allowed: probedExtend } = useCanCall({
    address: voting, abi: GovernanceVotingABI as never, functionName: 'extendVetoWindow',
    args: [id], account: address, enabled: proposal?.state === 4 && probeRoles,
  })
  const canVeto = rolesReadable ? glf.isSigner : probedVeto
  const canExtend = rolesReadable ? glf.isMember : probedExtend

  // Hooks must run before the early returns below, so this sits with the other
  // hooks rather than beside the derived values that consume it.
  // The snapshot is the vote-start instant, which is still AHEAD while the
  // proposal is Pending: getPastVotesForGovernance reverts FutureLookup for
  // it. Until voting opens, list the identities with their live weight.
  const identities = useVoterIdentities({ proposalId: id, snapshot: proposal && proposal.state >= 1 ? proposal.voteStart : undefined })

  const allFilteredVoters = useMemo(() => voters.records.filter((record) => voterFilter === 'all' || record.support === Number(voterFilter)), [voters.records, voterFilter])
  const filteredVoters = allFilteredVoters.slice(0, voters.visibleCount)
  if (!id) return <div className="page"><div className="error-box">Invalid proposal ID.</div></div>
  if (!voting) return <div className="page"><Link className="back-link" to="/"><ArrowLeft size={16} /> Proposals</Link><section className="empty"><h1>Select a deployment</h1><p>Configure an AddressManager before loading this proposal.</p></section></div>
  if (loading && !proposal) return <div className="page"><div className="loading-state">Loading proposal #{id.toString()} directly from chain…</div></div>
  if (error || !proposal) return <div className="page"><Link className="back-link" to="/"><ArrowLeft size={16} /> Proposals</Link><div className="error-box">{error ?? 'Proposal not found.'}</div></div>

  const turnout = proposal.votes.for + proposal.votes.against + proposal.votes.abstain
  const decided = proposal.votes.for + proposal.votes.against
  const checks = voteChecks(proposal.votes, proposal.rules, proposal.ges)
  const verdict = voteVerdict(proposal.state, proposal.votes, checks)
  const descriptionVerified = descriptionHash(proposal.description).toLowerCase() === proposal.core.descriptionHash.toLowerCase()
  const payloadVerified = payloadHash(proposal.operations).toLowerCase() === proposal.core.payloadHash.toLowerCase()
  const reasonTooLong = byteLength(reason) > 1_024
  const selectedIdentity = identities.identities.find((identity) => identity.kind !== 'eoa' && identity.address === voteAs)
  // A validator wallet or vesting votes ITS OWN snapshot weight through its
  // passthrough — never the EOA's.
  const activeWeight = selectedIdentity ? selectedIdentity.weight : (proposal.connectedVote?.weight ?? 0n)
  const activeHasVoted = selectedIdentity ? selectedIdentity.hasVoted : Boolean(proposal.connectedVote?.hasVoted)
  const route = address ? voteRoute(selectedIdentity ?? { kind: 'eoa', address }, voting, id, support, reason) : undefined
  const canVote = proposal.state === 1 && !activeHasVoted && activeWeight > 0n
  const l1Bridge = book?.l1Bridge?.toLowerCase()
  const hasL1 = !!l1Bridge && proposal.operations.some((operation) => operation.target.toLowerCase() === l1Bridge)

  return <div className="page wide proposal-detail">
    <Link className="back-link" to="/"><ArrowLeft size={16} /> All proposals</Link>
    <header className="proposal-header">
      <div className="badges"><StatusBadge state={proposal.state} /><span className="pill">{CLASS_NAMES[proposal.core.classId] ?? `Class ${proposal.core.classId}`}</span><span className="pill">{proposal.operations.length ? `${proposal.operations.length} operation${proposal.operations.length === 1 ? '' : 's'}` : 'RFC · no payload'}</span></div>
      <h1>{proposal.title}</h1>
      <p>GLIP<InfoHint text="GenLayer Improvement Proposal — the on-chain proposal object itself, stored in full on L2. A GLIP with an empty payload is an RFC: it signals approval of the text without executing anything." /> #{id.toString()} by <a href={explorerAddress(proposal.core.proposer)} target="_blank" rel="noreferrer">{shortAddress(proposal.core.proposer)} <ExternalLink size={13} /></a></p>
      <div className="header-facts"><span><small>Created</small>{formatDate(proposal.core.creationTime)}</span><span><small>Snapshot</small>{formatDate(proposal.voteStart)}</span><span><small>Vote deadline</small>{formatDate(proposal.voteEnd)}</span><span><small>Next action</small>{proposalNextAction(proposal.state, proposal.core.retryAllowed)}</span>{proposal.transactionHash && <span><small>Creation transaction</small><a className="tx-link" href={explorerTx(proposal.transactionHash)} target="_blank" rel="noreferrer">View on explorer <ExternalLink size={12} /></a></span>}</div>
    </header>

    <div className="detail-grid"><div className="detail-main">
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">Vote result</p><h2>Three independent passage rules</h2></div><Button variant="ghost" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</Button></div>
        {/* The rule cards below say WHICH condition held; this says who won.
            Showing only the components leaves the reader to do the boolean
            algebra, and an executable proposal should never be ambiguous. */}
        <div className={`verdict verdict-${verdict.outcome}`}>
          <span className="verdict-icon">{verdict.outcome === 'passed' ? <Trophy size={20} /> : verdict.outcome === 'defeated' ? <Ban size={20} /> : <Hourglass size={20} />}</span>
          <b>{verdict.headline}</b>
          <small>{verdict.final ? 'Final — settled on-chain' : 'Provisional — voting is still open'}</small>
          <p>{verdict.reason}</p>
        </div>
        <div className="tally"><span><small>For</small><b>{formatGen(proposal.votes.for)} GEN</b><em>{formatPercent(proposal.votes.for, turnout)}</em></span><span><small>Against</small><b>{formatGen(proposal.votes.against)} GEN</b><em>{formatPercent(proposal.votes.against, turnout)}</em></span><span><small>Abstain</small><b>{formatGen(proposal.votes.abstain)} GEN</b><em>{formatPercent(proposal.votes.abstain, turnout)}</em></span></div>
        <div className="rule-grid">
          <Rule title="Turnout / quorum" current={formatPercent(turnout, proposal.ges)} required={`${proposal.rules.quorumBps / 100}% of GES`} met={checks.quorumMet} detail={`${formatGen(turnout)} of ${formatGen(proposal.ges)} GEN snapshot GES; ${formatGen(checks.quorumRequired)} GEN minimum.`} />
          <Rule title="For floor" current={formatPercent(proposal.votes.for, proposal.ges)} required={`${proposal.rules.forFloorBps / 100}% of GES`} met={checks.floorMet} detail={`${formatGen(proposal.votes.for)} For; ${formatGen(checks.floorRequired)} GEN minimum.`} />
          <Rule title="Approval threshold" current={formatPercent(proposal.votes.for, decided)} required={`>${proposal.rules.thresholdNum}/${proposal.rules.thresholdDen} of For + Against`} met={checks.thresholdMet} detail="Abstain counts toward quorum but is excluded from this denominator." />
        </div>
      </section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">On-chain description</p><h2>Proposal text</h2></div><span className={descriptionVerified ? 'verified' : 'unverified'}>{descriptionVerified ? <><Check size={14} /> Hash verified</> : <><ShieldAlert size={14} /> Hash mismatch</>}</span></div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{preserveAlignedBlocks(proposal.description)}</ReactMarkdown></div><details><summary>Raw text and hash</summary><pre className="raw-text">{proposal.description}</pre><code className="hash">{proposal.core.descriptionHash}</code></details></section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">Execution payload</p><h2>{proposal.operations.length ? 'Ordered operations' : 'Signalling RFC'}</h2></div><span className={payloadVerified ? 'verified' : 'unverified'}>{payloadVerified ? <><Check size={14} /> Hash verified</> : <><ShieldAlert size={14} /> Hash mismatch</>}</span></div>
        {proposal.operations.length === 0 ? <div className="empty inline"><p>This proposal has no executable operations. Its zero payload hash identifies it as an RFC.</p></div> : <div className="operations">{proposal.operations.map((operation, index) => { const decoded = book ? decodeKnownOperation(operation, book) : undefined; return <article className="operation" key={`${operation.target}-${index}`}><span className="operation-index">{index + 1}</span><div><p><b>{decoded?.contract ?? shortAddress(operation.target)}</b> · <span className={proposal.operationPermissions[index] ? 'success-text' : 'danger-text'}>{proposal.operationPermissions[index] ? 'Permitted for class' : 'Not currently permitted'}</span></p><a href={explorerAddress(operation.target)} target="_blank" rel="noreferrer">{operation.target}</a><dl>{decoded && <><div><dt>Decoded call</dt><dd><code>{decoded.signature}</code></dd></div>{decoded.args && <div><dt>Decoded arguments</dt><dd><pre>{decoded.args}</pre></dd></div>}</>}<div><dt>Selector</dt><dd><code>{operation.selector}</code></dd></div><div><dt>Native value</dt><dd>{formatGen(operation.value)} GEN</dd></div><div><dt>Raw arguments</dt><dd><code>{operation.args}</code></dd></div><div><dt>Calldata</dt><dd><code>{operation.selector}{operation.args.slice(2)}</code></dd></div></dl></div></article> })}</div>}
        <details><summary>Payload commitment</summary><code className="hash">{proposal.core.payloadHash}</code></details>
      </section>

      <section className="panel"><p className="eyebrow">Lifecycle</p><h2>Proposal timeline</h2><Lifecycle state={proposal.state} creationTime={proposal.core.creationTime} voteStart={proposal.voteStart} voteEnd={proposal.voteEnd} eta={proposal.executionEta} deadline={proposal.executionDeadline} requiresRiskReview={proposal.rules.requiresRiskReview} hasL1={hasL1} rules={proposal.rules} postVote={proposal.postVote} /><div className="contract-pin"><small>Governance identities</small><code>{shortAddress(book?.voting)} · {shortAddress(book?.votingPower)} · {shortAddress(book?.gesRegistry)} · {shortAddress(book?.classRegistry)} · {shortAddress(book?.clock)}</code><p>Voting power, GES, and permissions resolve against the sealed AddressManager. Nothing is pinned per proposal: a sealed book cannot change, so the environment this proposal was created under is the one it settles and executes under.</p></div></section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">On-chain VoteCast logs</p><h2>Voters</h2></div><span>{voters.records.length} loaded</span></div><div className="tabs">{['all', '1', '0', '2'].map((value) => <button className={voterFilter === value ? 'active' : ''} key={value} onClick={() => setVoterFilter(value)}>{value === 'all' ? 'All' : SUPPORT_NAMES[Number(value)]}</button>)}</div>
        {voters.progress && <p className="scan-progress">{voters.progress}</p>}{voters.error && <div className="error-box">{voters.partial ? 'Partial results shown. ' : ''}{voters.error}<Button variant="secondary" onClick={() => void voters.retry()}>Retry scan</Button></div>}
        <div className="voter-list">{filteredVoters.map((record) => <article key={record.voter}><span className={`vote-dot support-${record.support}`} /><a href={explorerAddress(record.voter)} target="_blank" rel="noreferrer">{shortAddress(record.voter)}</a><b>{SUPPORT_NAMES[record.support]}</b><span>{formatGen(record.weight)} GEN</span><span>{formatPercent(record.weight, turnout)} of turnout</span><p>{record.reason || 'No reason supplied'}</p><a href={explorerTx(record.transactionHash)} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a></article>)}{!voters.loading && !voters.error && voters.records.length === 0 && <div className="empty inline"><p>No VoteCast logs found for this proposal.</p></div>}</div>
        {voters.visibleCount < allFilteredVoters.length && <Button variant="secondary" onClick={voters.loadMore}>Load more voters</Button>}
      </section>
    </div>

    <aside className="detail-aside">
      <section className="panel sticky"><p className="eyebrow">Your action</p><h2>{proposal.state === 1 ? 'Cast vote' : STATE_NAMES[proposal.state]}</h2>
        {proposal.connectedVote && <div className="your-power"><small>Snapshot voting power</small><b>{formatGen(proposal.connectedVote.weight)} GEN</b><p>{proposal.connectedVote.hasVoted ? `Voted ${proposal.connectedVote.support === undefined ? '' : SUPPORT_NAMES[proposal.connectedVote.support]}` : 'Not voted'}</p></div>}
        {proposal.state === 1 && <>{address && <IdentityPicker label="Vote as" identities={identities.identities.length ? identities.identities : [{ kind: 'eoa', address, weight: proposal.connectedVote?.weight ?? 0n, hasVoted: Boolean(proposal.connectedVote?.hasVoted) }]} selected={voteAs} onSelect={setVoteAs} loading={identities.loading} error={identities.error} />}<div className="vote-options">{SUPPORT_NAMES.map((name, index) => <button className={support === index ? 'selected' : ''} onClick={() => setSupport(index)} key={name}>{name}</button>)}</div><label>Optional on-chain reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are you voting this way?" /><small className={reasonTooLong ? 'danger-text' : ''}>{byteLength(reason).toLocaleString()} / 1,024 bytes</small></label><TransactionButton
          address={route?.address ?? voting}
          abi={route ? ABI_BY_KEY[route.abi] : undefined}
          // The passthroughs are always the 3-arg form; '' means no reason.
          functionName={route?.functionName ?? 'castVote'}
          args={route?.args ?? [id, support]}
          disabled={!canVote || reasonTooLong}
          onConfirmed={async () => { await refresh(); await identities.refresh() }}
        ><Vote size={16} /> Cast {SUPPORT_NAMES[support]} vote{selectedIdentity ? ` as ${shortAddress(selectedIdentity.address)}` : ''}</TransactionButton>{!isConnected && <p className="hint">Connect a wallet to vote.</p>}{activeHasVoted && <p className="hint">{selectedIdentity ? 'This identity already voted.' : 'This account already voted.'}</p>}{!activeHasVoted && activeWeight === 0n && <p className="hint">{selectedIdentity ? 'This identity had no weight at the snapshot.' : 'This account had zero weight at the snapshot.'}</p>}</>}
        {(proposal.state === 2 || proposal.state === 3) && <TransactionButton address={voting} functionName="settle" args={[id]} onConfirmed={refresh}>Settle proposal</TransactionButton>}
        {(proposal.state === 8 || (proposal.state === 10 && proposal.core.retryAllowed)) && <TransactionButton address={voting} functionName="execute" args={[id]} gasHeadroom onConfirmed={refresh}>{proposal.state === 10 ? 'Retry execution' : 'Execute proposal'}</TransactionButton>}
        {proposal.state === 11 && <TransactionButton address={voting} functionName="expire" args={[id]} onConfirmed={refresh}>Record expiry</TransactionButton>}
        {proposal.state === 4 && <div className="glf-actions">
          {/* Each half is shown when its role allows it, or when the role
              could not be determined. Both refused means the account holds
              neither role, and the note says so instead of offering a button
              that would revert. */}
          {canVeto === false && canExtend === false
            ? <div className="role-note"><ShieldAlert size={18} /><p><b>GLF veto window</b>
              This account is neither the GLF veto signer nor a GLF member, so it can neither veto this proposal
              nor extend the window.
              {rolesReadable
                ? <> The veto signer is <code>{shortAddress(glf.signer!)}</code>; membership is read from the contract.</>
                : ' This deployment exposes no getter for either role, so this is the result of simulating the calls from this account, not a membership list.'}</p></div>
            : <>
          {canVeto !== false && <><label>Veto ground
            <select value={vetoGround} onChange={(event) => setVetoGround(Number(event.target.value))}>
              {VETO_GROUNDS.map((ground, index) => <option key={ground} value={index}>{index} · {ground}</option>)}
            </select>
          </label>
          <label><span className="label-text">Rationale<InfoHint text="Only its keccak hash goes on-chain, committing to a rationale published within 72 hours. A veto cannot be recorded without one, and a ground can never be reused on the same proposal." /></span>
            <textarea value={vetoRationale} onChange={(event) => setVetoRationale(event.target.value)} placeholder="Why is this being vetoed?" />
          </label></>}
          {canVeto !== false && <TransactionButton
            address={voting} functionName="veto" variant="danger"
            args={[id, vetoGround, vetoRationale ? keccak256(stringToHex(vetoRationale)) : ZERO_HASH]}
            disabled={!vetoRationale.trim()} onConfirmed={refresh}
          >Veto proposal</TransactionButton>}
          {canVeto !== false && !vetoRationale.trim() && <p className="hint">
            A rationale is required — <code>veto</code> reverts <code>EmptyRationale</code> on a zero hash. Only its
            keccak hash is stored; publish the text within 72 hours.</p>}
          {canExtend !== false && <TransactionButton address={voting} functionName="extendVetoWindow" args={[id]} variant="secondary" onConfirmed={refresh}>
            Extend veto window
          </TransactionButton>}
            </>}
        </div>}
        {proposal.state === 6 && <div className="glf-actions">
          {/* Allowed: give the signer the button and nothing else, since the
              council route is not theirs to take. Refused: no button, and say
              where approval has to come from instead. Unknown (wallet away,
              node unreachable, no getter and the probe failed) keeps both,
              because an RPC failure must never look like a denial. */}
          {isGlfSigner === true
            ? <TransactionButton address={voting} functionName="approveRiskReview" args={[id]} onConfirmed={refresh}>
              <Check size={16} /> Approve Risk Review
            </TransactionButton>
            : <>
              <div className="role-note"><ShieldAlert size={18} /><p><b>Risk Review</b>
                Either the GLF signer or the Security Council may approve. The GLF signs alone but sets the ETA a full
                review window out; the council needs its standard threshold yet executes sooner. Council approval is
                raised as an action on the <Link to="/council">Security Council</Link> page.
                {rolesReadable && glf.signer && <> The GLF signer is <code>{shortAddress(glf.signer)}</code>.</>}
                {isGlfSigner === false && ' This account is not the GLF signer, so its approval must come from the council.'}</p></div>
              {isGlfSigner === undefined && <TransactionButton address={voting} functionName="approveRiskReview" args={[id]} onConfirmed={refresh}>
                <Check size={16} /> Approve Risk Review
              </TransactionButton>}
            </>}
        </div>}
        <div className="proposal-settings"><span><small>Class timelock</small>{formatDuration(proposal.core.classTimelock)}</span><span><small>Retry allowed</small>{proposal.core.retryAllowed ? 'Yes' : 'No'}</span><span><small>Risk Review</small>{proposal.rules.requiresRiskReview ? 'Required' : 'Not required'}</span><span><small>Late quorum window</small>{formatDuration(proposal.rules.lateQuorumWindow)}</span></div>
      </section>
    </aside></div>
  </div>
}
