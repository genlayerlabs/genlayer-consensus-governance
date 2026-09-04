import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Ban, Check, Circle, ExternalLink, Hourglass, RefreshCw, ShieldAlert, Trophy, Vote } from 'lucide-react'
import { useWallet } from '@/config/WalletContext'
import { decodeAbiParameters, toFunctionSelector } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import GovernanceClassRegistryABI from '@/abi/GovernanceClassRegistry.json'
import GovernanceClockABI from '@/abi/GovernanceClock.json'
import GovernanceGESRegistryABI from '@/abi/GovernanceGESRegistry.json'
import GovernanceABI from '@/abi/Governance.json'
import GovernanceL1BridgeABI from '@/abi/GovernanceL1Bridge.json'
import ValidatorWalletABI from '@/abi/ValidatorWallet.json'
import { useContracts } from '@/config/ContractsContext'
import { InfoHint } from '@/components/InfoHint'
import { useProposal } from '@/hooks/useProposal'
import { useValidatorWallets } from '@/hooks/useValidatorWallets'
import { useVoteRecords } from '@/hooks/useVoteRecords'
import { byteLength, CLASS_NAMES, descriptionHash, formatDate, formatDuration, formatGen, formatPercent, payloadHash, preserveAlignedBlocks, proposalNextAction, shortAddress, STATE_NAMES, SUPPORT_NAMES, voteChecks, voteVerdict } from '@/lib/governance'
import { explorerAddress, explorerTx } from '@/lib/rpc'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { TransactionButton } from '@/components/TransactionButton'
import type { ContractSet, Operation, ProposalSummary } from '@/lib/types'

function parseId(value?: string) {
  try { const id = BigInt(value ?? ''); return id > 0n ? id : undefined } catch { return undefined }
}

function decodeKnownOperation(operation: Operation, set: ContractSet) {
  const candidates = [
    [set.voting, 'GovernanceVoting', GovernanceVotingABI], [set.votingPower, 'GovernanceVotingPower', GovernanceVotingPowerABI],
    [set.classRegistry, 'GovernanceClassRegistry', GovernanceClassRegistryABI], [set.clock, 'GovernanceClock', GovernanceClockABI],
    [set.gesRegistry, 'GovernanceGESRegistry', GovernanceGESRegistryABI], [set.executor, 'Governance executor', GovernanceABI],
    [set.l1Bridge, 'GovernanceL1Bridge', GovernanceL1BridgeABI],
  ] as const
  const candidate = candidates.find(([address]) => address.toLowerCase() === operation.target.toLowerCase())
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
  const { voting } = useContracts()
  const { isConnected, address } = useWallet()
  const { proposal, loading, error, refresh } = useProposal(id)
  const voters = useVoteRecords(voting, id, proposal?.blockNumber)
  const [support, setSupport] = useState(1)
  const [reason, setReason] = useState('')
  const [voterFilter, setVoterFilter] = useState('all')
  // '' = the connected EOA; otherwise the validator wallet to vote THROUGH
  const [voteAs, setVoteAs] = useState('')

  // Hooks must run before the early returns below, so this sits with the other
  // hooks rather than beside the derived values that consume it.
  const validatorWallets = useValidatorWallets(id, proposal?.voteStart)

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
  const selectedWallet = validatorWallets.wallets.find((wallet) => wallet.address === voteAs)
  // Governance rights on a validator wallet are onlyOwner, so a wallet the
  // connected account owns votes ITS OWN snapshot weight through the
  // govCastVote passthrough — never the EOA's.
  const activeWeight = selectedWallet ? selectedWallet.weight : (proposal.connectedVote?.weight ?? 0n)
  const activeHasVoted = selectedWallet ? selectedWallet.hasVoted : Boolean(proposal.connectedVote?.hasVoted)
  const canVote = proposal.state === 1 && !activeHasVoted && activeWeight > 0n
  const hasL1 = proposal.operations.some((operation) => operation.target.toLowerCase() === proposal.contractSet.l1Bridge.toLowerCase())

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
        {proposal.operations.length === 0 ? <div className="empty inline"><p>This proposal has no executable operations. Its zero payload hash identifies it as an RFC.</p></div> : <div className="operations">{proposal.operations.map((operation, index) => { const decoded = decodeKnownOperation(operation, proposal.contractSet); return <article className="operation" key={`${operation.target}-${index}`}><span className="operation-index">{index + 1}</span><div><p><b>{decoded?.contract ?? shortAddress(operation.target)}</b> · <span className={proposal.operationPermissions[index] ? 'success-text' : 'danger-text'}>{proposal.operationPermissions[index] ? 'Permitted for class' : 'Not currently permitted'}</span></p><a href={explorerAddress(operation.target)} target="_blank" rel="noreferrer">{operation.target}</a><dl>{decoded && <><div><dt>Decoded call</dt><dd><code>{decoded.signature}</code></dd></div>{decoded.args && <div><dt>Decoded arguments</dt><dd><pre>{decoded.args}</pre></dd></div>}</>}<div><dt>Selector</dt><dd><code>{operation.selector}</code></dd></div><div><dt>Native value</dt><dd>{formatGen(operation.value)} GEN</dd></div><div><dt>Raw arguments</dt><dd><code>{operation.args}</code></dd></div><div><dt>Calldata</dt><dd><code>{operation.selector}{operation.args.slice(2)}</code></dd></div></dl></div></article> })}</div>}
        <details><summary>Payload commitment</summary><code className="hash">{proposal.core.payloadHash}</code></details>
      </section>

      <section className="panel"><p className="eyebrow">Lifecycle</p><h2>Proposal timeline</h2><Lifecycle state={proposal.state} creationTime={proposal.core.creationTime} voteStart={proposal.voteStart} voteEnd={proposal.voteEnd} eta={proposal.executionEta} deadline={proposal.executionDeadline} requiresRiskReview={proposal.rules.requiresRiskReview} hasL1={hasL1} rules={proposal.rules} postVote={proposal.postVote} /><div className="contract-pin"><small>Pinned contract set</small><code>{proposal.core.contractsHash}</code><p>Historical voting power, GES, and permissions resolve against this immutable contract set.</p></div></section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">On-chain VoteCast logs</p><h2>Voters</h2></div><span>{voters.records.length} loaded</span></div><div className="tabs">{['all', '1', '0', '2'].map((value) => <button className={voterFilter === value ? 'active' : ''} key={value} onClick={() => setVoterFilter(value)}>{value === 'all' ? 'All' : SUPPORT_NAMES[Number(value)]}</button>)}</div>
        {voters.progress && <p className="scan-progress">{voters.progress}</p>}{voters.error && <div className="error-box">{voters.partial ? 'Partial results shown. ' : ''}{voters.error}<Button variant="secondary" onClick={() => void voters.retry()}>Retry scan</Button></div>}
        <div className="voter-list">{filteredVoters.map((record) => <article key={record.voter}><span className={`vote-dot support-${record.support}`} /><a href={explorerAddress(record.voter)} target="_blank" rel="noreferrer">{shortAddress(record.voter)}</a><b>{SUPPORT_NAMES[record.support]}</b><span>{formatGen(record.weight)} GEN</span><span>{formatPercent(record.weight, turnout)} of turnout</span><p>{record.reason || 'No reason supplied'}</p><a href={explorerTx(record.transactionHash)} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a></article>)}{!voters.loading && !voters.error && voters.records.length === 0 && <div className="empty inline"><p>No VoteCast logs found for this proposal.</p></div>}</div>
        {voters.visibleCount < allFilteredVoters.length && <Button variant="secondary" onClick={voters.loadMore}>Load more voters</Button>}
      </section>
    </div>

    <aside className="detail-aside">
      <section className="panel sticky"><p className="eyebrow">Your action</p><h2>{proposal.state === 1 ? 'Cast vote' : STATE_NAMES[proposal.state]}</h2>
        {proposal.connectedVote && <div className="your-power"><small>Snapshot voting power</small><b>{formatGen(proposal.connectedVote.weight)} GEN</b><p>{proposal.connectedVote.hasVoted ? `Voted ${proposal.connectedVote.support === undefined ? '' : SUPPORT_NAMES[proposal.connectedVote.support]}` : 'Not voted'}</p></div>}
        {proposal.state === 1 && <><div className="vote-as"><small>Vote as</small><div className="vote-as-list">
          <button className={voteAs === '' ? 'selected' : ''} onClick={() => setVoteAs('')}>
            <b>{shortAddress(address ?? '0x')}</b><span>Connected account</span>
            <em>{formatGen(proposal.connectedVote?.weight ?? 0n)} GEN</em>
          </button>
          {validatorWallets.wallets.map((wallet) => {
            // Listed even when unusable: an owner needs to see WHY a validator
            // cannot vote, not merely find it missing.
            const blocked = wallet.hasVoted ? 'Already voted' : wallet.delegatedTo ? `Delegated to ${shortAddress(wallet.delegatedTo)}` : wallet.weight === 0n ? 'No weight at snapshot' : ''
            return <button key={wallet.address} className={voteAs === wallet.address ? 'selected' : ''} disabled={Boolean(blocked)} onClick={() => setVoteAs(wallet.address)} title={blocked || undefined}>
              <b>{shortAddress(wallet.address)}</b><span>{blocked || 'Validator'}</span>
              <em>{formatGen(wallet.weight)} GEN</em>
            </button>
          })}
        </div>{validatorWallets.loading && <small className="muted">Looking up your validators…</small>}{validatorWallets.error && <small className="danger-text">Validator lookup failed: {validatorWallets.error}</small>}</div><div className="vote-options">{SUPPORT_NAMES.map((name, index) => <button className={support === index ? 'selected' : ''} onClick={() => setSupport(index)} key={name}>{name}</button>)}</div><label>Optional on-chain reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are you voting this way?" /><small className={reasonTooLong ? 'danger-text' : ''}>{byteLength(reason).toLocaleString()} / 1,024 bytes</small></label><TransactionButton
          address={selectedWallet ? selectedWallet.address : voting}
          abi={selectedWallet ? (ValidatorWalletABI as never) : undefined}
          // The wallet passthrough is always the 3-arg form; '' means no reason.
          functionName={selectedWallet ? 'govCastVote' : reason ? 'castVoteWithReason' : 'castVote'}
          args={selectedWallet ? [id, support, reason] : reason ? [id, support, reason] : [id, support]}
          disabled={!canVote || reasonTooLong}
          onConfirmed={async () => { await refresh(); await validatorWallets.refresh() }}
        ><Vote size={16} /> Cast {SUPPORT_NAMES[support]} vote{selectedWallet ? ` as ${shortAddress(selectedWallet.address)}` : ''}</TransactionButton>{!isConnected && <p className="hint">Connect a wallet to vote.</p>}{activeHasVoted && <p className="hint">{selectedWallet ? 'This validator already voted.' : 'This account already voted.'}</p>}{!activeHasVoted && activeWeight === 0n && <p className="hint">{selectedWallet ? 'This validator had no weight at the snapshot.' : 'This account had zero weight at the snapshot.'}</p>}</>}
        {(proposal.state === 2 || proposal.state === 3) && <TransactionButton address={voting} functionName="settle" args={[id]} onConfirmed={refresh}>Settle proposal</TransactionButton>}
        {(proposal.state === 8 || (proposal.state === 10 && proposal.core.retryAllowed)) && <TransactionButton address={voting} functionName="execute" args={[id]} onConfirmed={refresh}>{proposal.state === 10 ? 'Retry execution' : 'Execute proposal'}</TransactionButton>}
        {proposal.state === 11 && <TransactionButton address={voting} functionName="expire" args={[id]} onConfirmed={refresh}>Record expiry</TransactionButton>}
        {proposal.state === 4 && <div className="role-note"><ShieldAlert size={18} /><p><b>GLF veto window</b>Veto and extension calls are role-gated. This contract does not expose enumerable GLF membership, so the POC will not claim authorization it cannot verify.</p></div>}
        {proposal.state === 6 && <div className="role-note"><ShieldAlert size={18} /><p><b>Risk Review</b>Approval is restricted to the Security Council contract or GLF signer. Dedicated council workflows are Phase 2.</p></div>}
        <div className="proposal-settings"><span><small>Class timelock</small>{formatDuration(proposal.core.classTimelock)}</span><span><small>Retry allowed</small>{proposal.core.retryAllowed ? 'Yes' : 'No'}</span><span><small>Risk Review</small>{proposal.rules.requiresRiskReview ? 'Required' : 'Not required'}</span><span><small>Late quorum window</small>{formatDuration(proposal.rules.lateQuorumWindow)}</span></div>
      </section>
    </aside></div>
  </div>
}
