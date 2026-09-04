import { CheckCircle2, CircleAlert, Gauge, LoaderCircle } from 'lucide-react'
import { InfoHint } from '@/components/InfoHint'
import { useAccountSummary } from '@/hooks/useAccountSummary'
import { formatDate, formatGen, shortAddress } from '@/lib/governance'

const HINTS = {
  votingPower: 'Your stake-derived weight, including anything delegated to you. What counts for a given proposal is your weight at THAT proposal\u2019s snapshot — the moment voting opens — not this live figure.',
  threshold: 'Minimum voting power needed to open a proposal: 1% of the Governance Eligible Supply. Measured at the proposal\u2019s snapshot; below it, propose() reverts.',
  liveProposals: 'How many of your proposals are alive at once, against a cap of 2. A slot frees when a proposal reaches a terminal state (executed, defeated, expired, vetoed) — not when voting closes.',
  bond: 'Refundable deposit sent with a proposal: 0.1% of the Governance Eligible Supply, paid as an exact amount. Returned on every outcome except a Security Council spam designation, where it is forfeited to the treasury.',
  cooldown: 'You cannot propose until this time. Set when the Security Council designates one of your proposals as spam; it also applies to accounts delegating to you.',
}

export function AccountSummary() {
  const { address, summary, loading, error } = useAccountSummary()
  if (!address) return <aside className="account-summary disconnected"><div><span className="summary-icon"><Gauge size={18} /></span><span><b>Read-only mode</b><small>Connect a wallet for voting power and proposal eligibility.</small></span></div></aside>
  const now = BigInt(Math.floor(Date.now() / 1_000))
  const cooldownUntil = summary && summary.directCooldownUntil > summary.delegateCooldownUntil ? summary.directCooldownUntil : summary?.delegateCooldownUntil ?? 0n
  const eligible = summary && summary.votingPower >= summary.requiredPower && summary.liveProposals < 2n && cooldownUntil <= now
  return <aside className="account-summary">
    <div><span className="summary-icon">{loading ? <LoaderCircle className="spin" size={18} /> : eligible ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}</span><span><b>{shortAddress(address)}</b><small>{eligible ? 'Eligible to propose' : 'Connected account'}</small></span></div>
    {summary && <><span><small>Voting power<InfoHint text={HINTS.votingPower} /></small><b>{formatGen(summary.votingPower)} GEN</b></span><span><small>Proposal threshold<InfoHint text={HINTS.threshold} /></small><b>{formatGen(summary.requiredPower)} GEN</b></span><span><small>Live proposals<InfoHint text={HINTS.liveProposals} /></small><b>{summary.liveProposals.toString()} / 2</b></span><span><small>Proposal bond<InfoHint text={HINTS.bond} /></small><b>{formatGen(summary.bond)} GEN</b></span>{cooldownUntil > now && <span className="danger-text"><small>Cooldown until<InfoHint text={HINTS.cooldown} /></small><b>{formatDate(cooldownUntil)}</b></span>}</>}
    {error && <span className="danger-text"><small>Account data unavailable</small><b title={error}>RPC error</b></span>}
  </aside>
}
