import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, Search } from 'lucide-react'
import { useWallet } from '@/config/WalletContext'
import { useContracts } from '@/config/ContractsContext'
import { useProposals } from '@/hooks/useProposals'
import { CLASS_NAMES, formatDate, formatGen, formatPercent, proposalNextAction, STATE_NAMES, SUPPORT_NAMES, shortAddress, voteChecks } from '@/lib/governance'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/Button'

export function ProposalsPage() {
  const { voting } = useContracts()
  const { address } = useWallet()
  const { proposals, loading, error, progress, loadMore, hasMore } = useProposals()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [proposalClass, setProposalClass] = useState('all')
  const [kind, setKind] = useState('all')
  const [sort, setSort] = useState('newest')
  const visible = useMemo(() => proposals.filter((proposal) => {
    const needle = search.toLowerCase().trim()
    const matchesSearch = !needle || proposal.core.id.toString() === needle || proposal.title.toLowerCase().includes(needle) || proposal.core.proposer.toLowerCase().includes(needle) || proposal.operations.some((op) => op.target.toLowerCase().includes(needle))
    const matchesStatus = status === 'all' || proposal.state === Number(status)
    const isRfc = proposal.operations.length === 0
    const matchesKind = kind === 'all' || (kind === 'rfc' ? isRfc : !isRfc) || (kind === 'mine' && proposal.core.proposer.toLowerCase() === address?.toLowerCase()) || (kind === 'voted' && proposal.connectedVote?.hasVoted)
    const matchesClass = proposalClass === 'all' || proposal.core.classId === Number(proposalClass)
    return matchesSearch && matchesStatus && matchesKind && matchesClass
  }).sort((a, b) => sort === 'oldest' ? Number(a.core.id - b.core.id) : sort === 'ending' ? Number(a.voteEnd - b.voteEnd) : sort === 'execution' ? Number(b.state === 8) - Number(a.state === 8) || Number(b.core.id - a.core.id) : sort === 'activity' ? Number((b.votes.for + b.votes.against + b.votes.abstain) - (a.votes.for + a.votes.against + a.votes.abstain)) : Number(b.core.id - a.core.id)), [proposals, search, status, proposalClass, kind, sort, address])

  return <div className="page wide">
    <section className="hero"><div><p className="eyebrow">Protocol governance</p><h1>Proposals</h1><p>Discover, inspect, and participate directly on-chain.</p></div><Link to="/create"><Button><Plus size={17} /> Create proposal</Button></Link></section>
    {!voting ? <section className="empty"><h2>Select a deployment</h2><p>Set an AddressManager in the header to discover its governance proposals.</p></section> : <>
      <section className="filters">
        <label className="search"><Search size={16} /><input aria-label="Search proposals" placeholder="Search title, ID, proposer, or target" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{STATE_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
        <select aria-label="Filter class" value={proposalClass} onChange={(event) => setProposalClass(event.target.value)}><option value="all">All classes</option>{CLASS_NAMES.slice(0, 6).map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
        <select aria-label="Filter kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All proposals</option><option value="proposal">Executable</option><option value="rfc">RFC</option><option value="mine">My proposals</option><option value="voted">My votes</option></select>
        <select aria-label="Sort proposals" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="ending">Ending soon</option><option value="execution">Execution-ready</option><option value="activity">Voting activity</option></select>
      </section>
      {error && <div className="error-box">{error}</div>}
      <section className="proposal-list" aria-busy={loading}>
        {visible.map((proposal) => {
          const turnout = proposal.votes.for + proposal.votes.against + proposal.votes.abstain
          const checks = voteChecks(proposal.votes, proposal.rules, proposal.ges)
          return <Link className="proposal-card" to={`/proposals/${proposal.core.id}`} key={proposal.core.id.toString()}>
            <div className="proposal-primary"><div className="badges"><StatusBadge state={proposal.state} /><span className="pill">{CLASS_NAMES[proposal.core.classId] ?? `Class ${proposal.core.classId}`}</span><span className="pill">{proposal.operations.length ? 'Executable' : 'RFC'}</span></div><h2>{proposal.title}</h2><p>GLIP #{proposal.core.id} · {shortAddress(proposal.core.proposer)} · Created {formatDate(proposal.core.creationTime)}</p><p className="proposal-dates">Voting opens {formatDate(proposal.voteStart)} · Ends {formatDate(proposal.voteEnd)}</p></div>
            <div className="proposal-metrics"><span><small>For</small>{formatGen(proposal.votes.for)} GEN</span><span><small>Against</small>{formatGen(proposal.votes.against)} GEN</span><span><small>Quorum</small>{formatPercent(turnout, checks.quorumRequired)}</span>{proposal.connectedVote && <span><small>Your vote</small>{proposal.connectedVote.hasVoted ? `${proposal.connectedVote.support === undefined ? 'Voted' : SUPPORT_NAMES[proposal.connectedVote.support]} · ${formatGen(proposal.connectedVote.weight)} GEN` : 'Not voted'}</span>}<span className="next-action"><small>Next action</small>{proposalNextAction(proposal.state, proposal.core.retryAllowed)}</span><ArrowRight size={20} /></div>
          </Link>
        })}
        {!loading && proposals.length === 0 && <div className="empty"><h2>No proposals discovered yet</h2><p>The browser scans `ProposalCreated` logs in bounded ranges. Continue scanning for older activity.</p></div>}
      </section>
      <div className="load-more">{progress && <p>{progress}</p>}<Button variant="secondary" onClick={() => void loadMore()} disabled={loading || !hasMore}>{loading ? 'Scanning chain…' : hasMore ? 'Load more proposals' : 'Reached genesis'}</Button></div>
    </>}
  </div>
}
