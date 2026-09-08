import { useEffect, useMemo, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import type { Address } from 'viem'
import GovernanceCouncilElectionsABI from '@/abi/GovernanceCouncilElections.json'
import GovernanceVotingPowerABI from '@/abi/GovernanceVotingPower.json'
import SecurityCouncilABI from '@/abi/SecurityCouncil.json'
import { Button } from '@/components/Button'
import { Criterion } from '@/components/Criterion'
import { InfoHint } from '@/components/InfoHint'
import { TransactionButton } from '@/components/TransactionButton'
import { publicClient } from '@/config/clients'
import { useContracts } from '@/config/ContractsContext'
import { useWallet } from '@/config/WalletContext'
import { byteLength, errorMessage, formatGen, MANIFESTO_FREE_BYTES, MANIFESTO_MAX_BYTES, manifestoWithinLimit, nominationCost, shortAddress, wrongPaymentRequired, type NominationEconomics } from '@/lib/governance'
import type { ElectionSummary } from '@/lib/types'

const abi = GovernanceCouncilElectionsABI as never

/**
 * Self-nomination for a council election.
 *
 * `nominate` demands an EXACT msg.value — bond + registration fee + storage
 * fee for every manifesto byte beyond the first KB — and reverts WrongPayment
 * on anything else. Before CON-864 none of the three figures was readable, so
 * there was no form; with `electionEconomics()` the cost is computed to the
 * wei and the call is simulated with it before the wallet is asked. A
 * WrongPayment from the simulation (the economics changed between reads) is
 * corrected once from the figure the contract itself asked for.
 */
export function NominateForm({ election, elections, economics, onNominated }: { election: ElectionSummary; elections: Address; economics: NominationEconomics; onNominated: () => void }) {
  const { address, isConnected } = useWallet()
  const { currentSet, stopState, migrationActive } = useContracts()
  const [manifesto, setManifesto] = useState('')
  const [balance, setBalance] = useState<bigint>()
  const [eligibility, setEligibility] = useState<{ live?: boolean; cooldownUntil?: bigint; excluded?: boolean; seated?: boolean }>({})
  const [preflight, setPreflight] = useState<'idle' | 'checking' | 'ready'>('idle')
  const [preflightError, setPreflightError] = useState('')
  const [adjusted, setAdjusted] = useState<bigint>()

  const bytes = byteLength(manifesto)
  const cost = useMemo(() => nominationCost(bytes, economics), [bytes, economics])
  const value = adjusted ?? cost.total
  const fingerprint = `${manifesto}|${value}`
  const [readyFor, setReadyFor] = useState('')

  useEffect(() => { if (address) void publicClient.getBalance({ address }).then(setBalance).catch(() => setBalance(undefined)) }, [address])
  useEffect(() => {
    if (!address) { setEligibility({}); return }
    let cancelled = false
    void Promise.all([
      publicClient.readContract({ address: elections, abi, functionName: 'isLiveCandidate', args: [address] } as never).catch(() => undefined) as Promise<boolean | undefined>,
      publicClient.readContract({ address: elections, abi, functionName: 'recallCooldownOf', args: [address] } as never).then((until) => BigInt(until as bigint | number)).catch(() => undefined),
      currentSet?.votingPower ? publicClient.readContract({ address: currentSet.votingPower, abi: GovernanceVotingPowerABI as never, functionName: 'isExcluded', args: [address] } as never).catch(() => undefined) as Promise<boolean | undefined> : Promise.resolve(undefined),
      currentSet?.council ? publicClient.readContract({ address: currentSet.council, abi: SecurityCouncilABI as never, functionName: 'isSeated', args: [address] } as never).catch(() => undefined) as Promise<boolean | undefined> : Promise.resolve(undefined),
    ]).then(([live, cooldownUntil, excluded, seated]) => { if (!cancelled) setEligibility({ live, cooldownUntil, excluded, seated }) })
    return () => { cancelled = true }
  }, [address, elections, currentSet])

  const now = BigInt(Math.floor(Date.now() / 1000))
  const governanceReady = !!stopState && !stopState.freezeActive && !stopState.maintenanceActive && !migrationActive
  const sizeOk = manifestoWithinLimit(bytes)
  const fundsOk = balance !== undefined && balance >= value
  const notLive = eligibility.live === false
  const noCooldown = eligibility.cooldownUntil !== undefined && eligibility.cooldownUntil <= now
  const notExcluded = eligibility.excluded === false
  // a sitting member may only stand for its own cohort's election; the
  // contract decides the cohort, so a seated account is flagged, not blocked
  const seated = eligibility.seated === true
  const formReady = isConnected && !!address && governanceReady && sizeOk && fundsOk && notLive && noCooldown && notExcluded

  const runPreflight = async () => {
    if (!address) return
    setPreflight('checking'); setPreflightError('')
    const simulate = (sendValue: bigint) => publicClient.simulateContract({ address: elections, abi, functionName: 'nominate', args: [election.id, manifesto], account: address, value: sendValue } as never)
    try {
      await simulate(value)
      setPreflight('ready'); setReadyFor(fingerprint)
    } catch (error) {
      const required = wrongPaymentRequired(error)
      if (required !== undefined && required !== value) {
        // the contract named its price: adopt it and prove it once
        try {
          await simulate(required)
          setAdjusted(required); setPreflight('ready'); setReadyFor(`${manifesto}|${required}`)
          setPreflightError(`The contract requires ${formatGen(required, 6)} GEN, not ${formatGen(value, 6)} — the economics changed since they were read. Adjusted.`)
          return
        } catch (second) { setPreflight('idle'); setPreflightError(errorMessage(second)); return }
      }
      setPreflight('idle'); setPreflightError(errorMessage(error))
    }
  }

  return <div className="nominate-form">
    <div className="form-grid">
      <label className="full"><span className="label-text">Manifesto<InfoHint text="Stored on-chain with the nomination and shown to every voter. The first 1,024 bytes are free; every byte beyond them is charged the storage fee, non-refundable. 16 KB cap." /></span>
        <textarea value={manifesto} onChange={(event) => { setManifesto(event.target.value); setPreflight('idle'); setAdjusted(undefined) }} placeholder="Why should the council seat you?" />
        <div className={`byte-counter ${sizeOk ? '' : 'danger-text'}`}>{bytes.toLocaleString()} / {MANIFESTO_MAX_BYTES.toLocaleString()} bytes · {cost.billableBytes.toLocaleString()} billable beyond the free {MANIFESTO_FREE_BYTES.toLocaleString()}</div>
      </label>
    </div>
    <div className="header-facts">
      <span><small>Bond</small>{formatGen(cost.bond)} GEN<small>refundable</small></span>
      <span><small>Registration fee</small>{formatGen(cost.fees - BigInt(cost.billableBytes) * economics.storageFeePerByte)} GEN<small>non-refundable</small></span>
      <span><small>Storage fee</small>{formatGen(BigInt(cost.billableBytes) * economics.storageFeePerByte, 6)} GEN<small>{cost.billableBytes.toLocaleString()} × {formatGen(economics.storageFeePerByte, 6)}</small></span>
      <span><small>Exact value</small><b>{formatGen(value, 6)} GEN</b>{adjusted !== undefined && <small>adjusted to the contract's figure</small>}</span>
    </div>
    <ul className="criteria">
      <Criterion met={isConnected && !!address}>{address ? `Wallet ${shortAddress(address)}` : 'Connect a wallet'}</Criterion>
      <Criterion met={governanceReady}>Governance active; no freeze, maintenance, or migration</Criterion>
      <Criterion met={sizeOk}>Manifesto within the 16 KB cap</Criterion>
      <Criterion met={fundsOk} pending={!!address && balance === undefined}>{balance === undefined ? 'Exact nomination cost available' : `${formatGen(balance)} GEN available for the ${formatGen(value, 6)} GEN cost`}</Criterion>
      <Criterion met={notLive} pending={!!address && eligibility.live === undefined}>Not already a live candidate elsewhere</Criterion>
      <Criterion met={noCooldown} pending={!!address && eligibility.cooldownUntil === undefined}>No recall cooldown</Criterion>
      <Criterion met={notExcluded} pending={!!address && eligibility.excluded === undefined}>Not excluded from governance</Criterion>
      {seated && <li><span /><em className="muted">This account holds a council seat: it may stand only in its own cohort's election, which the contract checks at nominate.</em></li>}
    </ul>
    <div className="preflight">
      <Button variant="secondary" onClick={() => void runPreflight()} disabled={!formReady || preflight === 'checking'}>{preflight === 'checking' ? <><LoaderCircle className="spin" size={16} /> Simulating…</> : 'Run on-chain preflight'}</Button>
      {preflight === 'ready' && readyFor === fingerprint && <p className="success-text"><Check size={15} /> eth_call succeeded at the current head with exactly {formatGen(value, 6)} GEN.</p>}
      {preflightError && <div className="error-box compact">{preflightError}</div>}
    </div>
    <div className="action-buttons">
      <TransactionButton address={elections} abi={abi} functionName="nominate" args={[election.id, manifesto]} value={value}
        disabled={!(preflight === 'ready' && readyFor === fingerprint)} onConfirmed={onNominated}>
        Nominate with {formatGen(value, 6)} GEN
      </TransactionButton>
      {!(preflight === 'ready' && readyFor === fingerprint) && <p className="hint">Preflight first: the exact value is what the contract checks, and a stale figure reverts WrongPayment.</p>}
    </div>
  </div>
}
