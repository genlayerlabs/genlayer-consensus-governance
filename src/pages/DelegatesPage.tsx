import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import { Button } from '@/components/Button'
import { InfoHint } from '@/components/InfoHint'
import { TransactionButton } from '@/components/TransactionButton'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { useDelegateDirectory } from '@/hooks/useDelegateDirectory'
import { useMyDelegation } from '@/hooks/useMyDelegation'
import { formatDate, formatGen, MIN_ENTRY_VALUE, shortAddress, ZERO_ADDRESS } from '@/lib/governance'
import { explorerAddress } from '@/lib/rpc'

const HINTS = {
  snapshot:
    'A delegation change only affects proposals and elections whose snapshot happens later. Anything already open keeps the weights it fixed when its voting opened — changing your delegate now cannot move a live vote.',
  floor:
    'A new third-party delegation is admitted per validator position, not on your total. Each position that would open an entry on the delegate must independently clear the floor, so several small positions cannot be combined to reach it.',
  park:
    'Delegating to the zero address parks your power: it stops counting for anyone, including you. It is reversible at any time by delegating again.',
  notSupported:
    'Not supported at launch: splitting weight across several delegates, delegation that passes through a delegate to their own delegate, and an owner overriding a delegate on a vote already cast.',
}

function MyDelegation({ onChanged }: { onChanged: () => void }) {
  const { currentSet } = useContracts()
  const { address, isConnected } = useWallet()
  const { summary, error, refresh } = useMyDelegation()
  const [target, setTarget] = useState('')
  const now = BigInt(Math.floor(Date.now() / 1000))

  if (!isConnected) {
    return <section className="panel"><div className="section-heading"><div>
      <p className="eyebrow">Your delegation</p><h2>Read-only mode</h2></div></div>
      <p className="hint">Connect a wallet to see and change where your voting power goes.</p></section>
  }
  if (error) return <section className="panel"><div className="error-box">{error}</div></section>
  if (!summary) return <section className="panel"><div className="loading-state">Reading your delegation…</div></section>

  const blockedPositions = summary.positions.filter((position) => !position.meetsFloor && (position.shares > 0n || position.pending > 0n))
  const canDelegateOut = summary.positions.length > 0 && blockedPositions.length === 0
  const done = () => { void refresh(); onChanged() }

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">Your delegation</p>
      <h2>{summary.parked ? 'Parked' : summary.self ? 'Self-delegated' : `Delegated to ${shortAddress(summary.delegate)}`}</h2></div></div>

    <div className="header-facts">
      <span><small>Voting power</small>{formatGen(summary.votingPower)} GEN</span>
      <span><small>Current delegate</small>{summary.parked ? 'None (parked)' : shortAddress(summary.delegate)}</span>
      <span><small>Positions</small>{summary.positions.length}</span>
      {summary.excluded && <span className="danger-text"><small>Excluded</small>Cannot delegate</span>}
      {summary.cooldownUntil > now && <span className="danger-text"><small>Cooldown until</small>{formatDate(summary.cooldownUntil)}</span>}
    </div>

    <p className="hint"><InfoHint text={HINTS.snapshot} /> A change here applies only to proposals and elections
      whose snapshot is still ahead. <InfoHint text={HINTS.notSupported} /> Split, transitive and in-vote override
      delegation are not supported at launch.</p>

    {blockedPositions.length > 0 && <div className="role-note"><AlertTriangle size={18} /><p>
      <b>Below the per-position floor</b>
      {blockedPositions.length} of your {summary.positions.length} positions {blockedPositions.length === 1 ? 'is' : 'are'} worth
      less than {formatGen(MIN_ENTRY_VALUE)} GEN, so delegating to a third party would revert. The floor applies to
      each position separately, not to your {formatGen(summary.votingPower)} GEN total. Self-delegating and parking
      are unaffected.</p></div>}

    <div className="form-grid">
      <label className="full">Delegate to
        <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="0x…" />
      </label>
    </div>
    <div className="action-buttons">
      <TransactionButton
        address={currentSet?.votingPower} abi={GovernanceVotingPowerABI as never}
        functionName="delegate" args={[target]}
        disabled={!target.trim() || summary.excluded || !canDelegateOut} onConfirmed={done}
      >Delegate</TransactionButton>
      <TransactionButton
        address={currentSet?.votingPower} abi={GovernanceVotingPowerABI as never} variant="secondary"
        functionName="delegate" args={[address]} disabled={summary.self || summary.excluded} onConfirmed={done}
      >Self-delegate</TransactionButton>
      <TransactionButton
        address={currentSet?.votingPower} abi={GovernanceVotingPowerABI as never} variant="ghost"
        functionName="delegate" args={[ZERO_ADDRESS]} disabled={summary.parked} onConfirmed={done}
      >Park<InfoHint text={HINTS.park} /></TransactionButton>
    </div>
  </section>
}

export function DelegatesPage() {
  const { currentSet } = useContracts()
  const directory = useDelegateDirectory()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('power')
  const [hideExcluded, setHideExcluded] = useState(false)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = directory.entries.filter((entry) => {
      if (hideExcluded && entry.excluded) return false
      if (!needle) return true
      return entry.address.toLowerCase().includes(needle) || entry.delegate.toLowerCase().includes(needle)
    })
    return [...rows].sort((a, b) => {
      if (sort === 'delegators') return b.delegators.length - a.delegators.length
      if (sort === 'address') return a.address.localeCompare(b.address)
      return a.votingPower === b.votingPower ? 0 : a.votingPower > b.votingPower ? -1 : 1
    })
  }, [directory.entries, query, sort, hideExcluded])

  const total = directory.entries.reduce((sum, entry) => sum + entry.votingPower, 0n)

  if (!currentSet) {
    return <div className="page"><section className="empty"><h1>Select a deployment</h1>
      <p>Set an AddressManager in the header to load its delegation state.</p></section></div>
  }

  return <div className="page wide">
    <div className="hero"><div>
      <p className="eyebrow">Protocol governance</p>
      <h1>Delegation</h1>
      <p>Every address that can hold voting power, read directly from staking and the voting-power ledger.</p>
    </div><Button variant="ghost" onClick={() => void directory.refresh()}><RefreshCw size={15} /> Refresh</Button></div>

    <MyDelegation onChanged={() => void directory.refresh()} />

    <section className="panel">
      <div className="section-heading"><div><p className="eyebrow">Directory</p><h2>Delegates</h2></div>
        <span>{visible.length} of {directory.entries.length}</span></div>

      <div className="filters">
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by address" />
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="power">Voting power</option>
          <option value="delegators">Delegators</option>
          <option value="address">Address</option>
        </select>
        <label className="checkbox"><input type="checkbox" checked={hideExcluded} onChange={(event) => setHideExcluded(event.target.checked)} /> Hide excluded</label>
      </div>

      {directory.progress && <p className="scan-progress">{directory.progress}</p>}
      {directory.error && <div className="error-box">{directory.error}</div>}
      {directory.truncated && <div className="role-note"><ShieldAlert size={18} /><p><b>Partial universe</b>
        The paged reads hit their page ceiling, so addresses beyond it are not listed. The contracts expose no
        delegate registry, so this directory is the union of validators and their delegators rather than an
        enumeration of delegates.</p></div>}

      <div className="voter-list">{visible.map((entry) => <article key={entry.address}>
        <span className={`vote-dot support-${entry.excluded ? 0 : entry.delegatedAway ? 2 : 1}`} />
        <Link to={`/address/${entry.address}`}>{shortAddress(entry.address)}</Link>
        <b>{formatGen(entry.votingPower)} GEN</b>
        <span>{total > 0n ? `${((Number(entry.votingPower) / Number(total)) * 100).toFixed(1)}% of observed` : '—'}</span>
        <span>{entry.delegators.length} delegator{entry.delegators.length === 1 ? '' : 's'}</span>
        <p>
          {entry.excluded ? 'Excluded from governance' : entry.delegatedAway ? `Delegated to ${shortAddress(entry.delegate)}` : entry.delegate === ZERO_ADDRESS ? 'Parked' : 'Self-delegated'}
          {entry.isCouncilMember && ' · Security Council'}
          {entry.controller && ` · controlled by ${shortAddress(entry.controller)}`}
        </p>
        <a href={explorerAddress(entry.address)} target="_blank" rel="noreferrer">↗</a>
      </article>)}
      {!directory.loading && visible.length === 0 && <div className="empty inline">
        <p>No addresses matched.</p></div>}
      </div>
    </section>
  </div>
}
