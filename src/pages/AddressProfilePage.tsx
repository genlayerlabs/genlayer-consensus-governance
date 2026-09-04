import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { isAddress, getAddress, type Address } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { formatDate, formatGen, shortAddress, SUPPORT_NAMES, ZERO_ADDRESS } from '@/lib/governance'
import { explorerAddress, explorerTx, scanLogs } from '@/lib/rpc'
import { deploymentConfig } from '@/config/chain'

interface Profile {
  votingPower: bigint
  delegate: Address
  excluded: boolean
  controller?: Address
  cooldownUntil: bigint
  isCouncilMember: boolean
  validators: Address[]
  votes: { proposalId: bigint; support: number; weight: bigint; reason: string; transactionHash: `0x${string}` }[]
  proposalsCreated: bigint[]
}

/**
 * An on-chain-derived address page.
 *
 * Deliberately not a profile: the mechanics spec defines no delegate-metadata
 * registry, so there is no name, statement or avatar to show and inventing an
 * off-chain one would make the app depend on something the protocol does not
 * have. Everything here is a contract read or a log filtered by an indexed
 * topic — VoteCast is indexed by voter and ProposalCreated by proposer, so
 * both are cheap per-address queries rather than full scans.
 */
export function AddressProfilePage() {
  const { address: param } = useParams()
  const { currentSet, voting } = useContracts()
  const [profile, setProfile] = useState<Profile>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const target = param && isAddress(param) ? getAddress(param) : undefined

  const load = useCallback(async () => {
    if (!target || !currentSet || !voting) return
    setLoading(true); setError(undefined)
    try {
      const power = (functionName: string, args: unknown[]) =>
        publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI, functionName, args } as never)

      const [votingPower, delegate, excluded, controller, cooldown, validators, isCouncilMember] = await Promise.all([
        power('getVotes', [target]) as Promise<bigint>,
        power('delegates', [target]) as Promise<Address>,
        power('isExcluded', [target]) as Promise<boolean>,
        power('governanceControllerOf', [target]).catch(() => ZERO_ADDRESS) as Promise<Address>,
        power('delegationSpamCooldownUntil', [target]).then((v) => BigInt(v as never)) as Promise<bigint>,
        power('liveValidatorsOf', [target]).catch(() => []) as Promise<Address[]>,
        currentSet.council
          ? publicClient.readContract({ address: currentSet.council, abi: SecurityCouncilABI, functionName: 'isMember', args: [target] } as never).catch(() => false) as Promise<boolean>
          : Promise.resolve(false),
      ])

      const [voteLogs, createdLogs] = await Promise.all([
        scanLogs({ address: voting, abi: GovernanceVotingABI as never, eventName: 'VoteCast' as never, args: { voter: target }, fromBlock: deploymentConfig.deploymentStartBlock }),
        scanLogs({ address: voting, abi: GovernanceVotingABI as never, eventName: 'ProposalCreated' as never, args: { proposer: target }, fromBlock: deploymentConfig.deploymentStartBlock }).catch(() => []),
      ])

      setProfile({
        votingPower, delegate, excluded,
        controller: controller && controller !== ZERO_ADDRESS ? controller : undefined,
        cooldownUntil: cooldown,
        isCouncilMember: Boolean(isCouncilMember),
        validators,
        votes: (voteLogs as any[]).map((log) => ({
          proposalId: log.args.proposalId, support: Number(log.args.support),
          weight: log.args.weight, reason: log.args.reason ?? '', transactionHash: log.transactionHash,
        })).reverse(),
        proposalsCreated: (createdLogs as any[]).map((log) => log.args.id),
      })
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setLoading(false) }
  }, [target, currentSet, voting])

  useEffect(() => { void load() }, [load])

  if (!target) return <div className="page"><div className="error-box">Not a valid address.</div></div>

  const now = BigInt(Math.floor(Date.now() / 1000))

  return <div className="page">
    <Link className="back-link" to="/delegates"><ArrowLeft size={16} /> Delegation</Link>
    <div className="proposal-header">
      <div className="badges">
        {profile?.isCouncilMember && <span className="pill">Security Council</span>}
        {profile?.excluded && <span className="pill">Excluded</span>}
        {profile?.controller && <span className="pill">Contract</span>}
      </div>
      <h1>{shortAddress(target)}</h1>
      <p><a href={explorerAddress(target)} target="_blank" rel="noreferrer">{target}</a></p>
    </div>

    {error && <div className="error-box">{error}</div>}
    {loading && !profile && <div className="loading-state">Reading this address directly from chain…</div>}

    {profile && <>
      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Voting power</p><h2>Standing</h2></div></div>
        <div className="header-facts">
          <span><small>Voting power</small>{formatGen(profile.votingPower)} GEN</span>
          <span><small>Delegate</small>{profile.delegate === ZERO_ADDRESS ? 'Parked' : profile.delegate.toLowerCase() === target.toLowerCase() ? 'Self' : shortAddress(profile.delegate)}</span>
          <span><small>Validator positions</small>{profile.validators.length}</span>
          <span><small>Proposals created</small>{profile.proposalsCreated.length}</span>
          <span><small>Votes cast</small>{profile.votes.length}</span>
          {profile.controller && <span><small>Controlled by</small>{shortAddress(profile.controller)}</span>}
          {profile.cooldownUntil > now && <span className="danger-text"><small>Spam cooldown until</small>{formatDate(profile.cooldownUntil)}</span>}
        </div>
        <p className="hint">
          Editable delegate metadata — a name, statement, links or avatar — is deliberately absent. The governance
          mechanics spec defines no profile registry and no off-chain pointer, so there is nothing on-chain to
          render and inventing a source would make this page depend on something the protocol does not have.
        </p>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">On-chain VoteCast logs</p><h2>Voting history</h2></div>
          <span>{profile.votes.length}</span></div>
        <div className="voter-list">{profile.votes.map((vote, index) => <article key={`${vote.transactionHash}-${index}`}>
          <span className={`vote-dot support-${vote.support}`} />
          <Link to={`/proposals/${vote.proposalId}`}>Proposal #{vote.proposalId.toString()}</Link>
          <b>{SUPPORT_NAMES[vote.support] ?? vote.support}</b>
          <span>{formatGen(vote.weight)} GEN</span>
          <p>{vote.reason || 'No reason supplied'}</p>
          <a href={explorerTx(vote.transactionHash)} target="_blank" rel="noreferrer">↗</a>
        </article>)}
        {profile.votes.length === 0 && <div className="empty inline"><p>No votes cast by this address in the scanned range.</p></div>}
        </div>
      </section>
    </>}
  </div>
}
