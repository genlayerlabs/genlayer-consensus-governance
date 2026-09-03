import { CheckCircle2, CircleAlert, Gauge, LoaderCircle } from 'lucide-react'
import { useAccountSummary } from '@/hooks/useAccountSummary'
import { formatDate, formatGen, shortAddress } from '@/lib/governance'

export function AccountSummary() {
  const { address, summary, loading, error } = useAccountSummary()
  if (!address) return <aside className="account-summary disconnected"><div><span className="summary-icon"><Gauge size={18} /></span><span><b>Read-only mode</b><small>Connect a wallet for voting power and proposal eligibility.</small></span></div></aside>
  const now = BigInt(Math.floor(Date.now() / 1_000))
  const cooldownUntil = summary && summary.directCooldownUntil > summary.delegateCooldownUntil ? summary.directCooldownUntil : summary?.delegateCooldownUntil ?? 0n
  const eligible = summary && summary.votingPower >= summary.requiredPower && summary.liveProposals < 2n && cooldownUntil <= now
  return <aside className="account-summary">
    <div><span className="summary-icon">{loading ? <LoaderCircle className="spin" size={18} /> : eligible ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}</span><span><b>{shortAddress(address)}</b><small>{eligible ? 'Eligible to propose' : 'Connected account'}</small></span></div>
    {summary && <><span><small>Voting power</small><b>{formatGen(summary.votingPower)} GEN</b></span><span><small>Proposal threshold</small><b>{formatGen(summary.requiredPower)} GEN</b></span><span><small>Live proposals</small><b>{summary.liveProposals.toString()} / 2</b></span><span><small>Proposal bond</small><b>{formatGen(summary.bond)} GEN</b></span>{cooldownUntil > now && <span className="danger-text"><small>Cooldown until</small><b>{formatDate(cooldownUntil)}</b></span>}</>}
    {error && <span className="danger-text"><small>Account data unavailable</small><b title={error}>RPC error</b></span>}
  </aside>
}
