import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Check, CircleAlert, FileText, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { decodeEventLog, type Hex } from 'viem'
import { useWallet } from '@/config/WalletContext'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import GovernanceClassRegistryABI from '@/abi/GovernanceClassRegistry.json'
import { useContracts } from '@/config/ContractsContext'
import { publicClient } from '@/config/clients'
import { genlayerTestnet } from '@/config/chain'
import { useAccountSummary } from '@/hooks/useAccountSummary'
import { byteLength, CLASS_NAMES, descriptionHash, encodeOperation, errorMessage, formatDuration, formatGen, normalizeClassParams, operationBytes, payloadHash, shortAddress } from '@/lib/governance'
import type { ClassParams, Operation } from '@/lib/types'
import { explorerTx } from '@/lib/rpc'
import { Button } from '@/components/Button'

interface DraftOperation {
  target: string
  mode: 'abi' | 'raw'
  signature: string
  argsJson: string
  rawSelector: string
  rawArgs: string
  value: string
}

const emptyOperation = (): DraftOperation => ({ target: '', mode: 'abi', signature: '', argsJson: '[]', rawSelector: '0x', rawArgs: '0x', value: '0' })
const defaultLimits = { description: 16_384, operations: 32, operationArgs: 8_192, payload: 65_536 }

function Criterion({ met, children, pending = false }: { met: boolean; children: React.ReactNode; pending?: boolean }) {
  return <li className={met ? 'met' : ''}><span>{pending ? <LoaderCircle className="spin" size={15} /> : met ? <Check size={15} /> : <CircleAlert size={15} />}</span>{children}</li>
}

export function CreateProposalPage() {
  const navigate = useNavigate()
  const { address, chainId, isConnected, writeContract } = useWallet()
  const contracts = useContracts()
  const account = useAccountSummary()
  const [classId, setClassId] = useState(0)
  const [classes, setClasses] = useState<Record<number, ClassParams>>({})
  const [limits, setLimits] = useState(defaultLimits)
  const [description, setDescription] = useState('# ')
  const [timelock, setTimelock] = useState('')
  const [retryAllowed, setRetryAllowed] = useState(true)
  const [drafts, setDrafts] = useState<DraftOperation[]>([])
  const [permissions, setPermissions] = useState<boolean[]>([])
  const [balance, setBalance] = useState<bigint>()
  const [preflight, setPreflight] = useState<'idle' | 'checking' | 'ready' | 'failed'>('idle')
  const [preflightError, setPreflightError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [transactionHash, setTransactionHash] = useState<Hex>()

  useEffect(() => {
    if (!contracts.currentSet || !contracts.voting) return
    let cancelled = false
    void Promise.all([
      ...Array.from({ length: 6 }, (_, id) => publicClient.readContract({ address: contracts.currentSet!.classRegistry, abi: GovernanceClassRegistryABI, functionName: 'classParams', args: [id] } as any)),
      publicClient.readContract({ address: contracts.voting!, abi: GovernanceVotingABI, functionName: 'sizeLimits' } as any),
    ]).then((values) => {
      if (cancelled) return
      const next: Record<number, ClassParams> = {}
      values.slice(0, 6).forEach((value, id) => { const normalized = normalizeClassParams(value); if (normalized.thresholdDen > 0) next[id] = normalized })
      setClasses(next)
      const size = values[6] as any
      setLimits({ description: Number(size[0]), operations: Number(size[1]), operationArgs: Number(size[2]), payload: Number(size[3]) })
    }).catch((error) => setPreflightError(errorMessage(error)))
    return () => { cancelled = true }
  }, [contracts.currentSet, contracts.voting])

  useEffect(() => {
    const selected = classes[classId]
    if (selected && !timelock) setTimelock(selected.timelockMin.toString())
  }, [classes, classId, timelock])

  useEffect(() => { if (address) void publicClient.getBalance({ address }).then(setBalance).catch(() => setBalance(undefined)) }, [address])

  const encoded = useMemo(() => drafts.map((draft) => {
    try { return { operation: encodeOperation(draft) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }), [drafts])
  const operations = useMemo(() => encoded.flatMap((result) => result.operation ? [result.operation] : []) as Operation[], [encoded])
  const formFingerprint = `${classId}|${description}|${timelock}|${retryAllowed}|${operations.map((operation) => `${operation.target}${operation.selector}${operation.args}${operation.value}`).join('|')}`
  const selectedClass = classes[classId]
  const now = BigInt(Math.floor(Date.now() / 1_000))
  const summary = account.summary
  const cooldown = summary && summary.directCooldownUntil > summary.delegateCooldownUntil ? summary.directCooldownUntil : summary?.delegateCooldownUntil ?? 0n
  const argsBytes = operations.reduce((sum, operation) => sum + operationBytes(operation), 0)
  const l1Operations = operations.filter((operation) => operation.target.toLowerCase() === contracts.currentSet?.l1Bridge.toLowerCase()).length
  const sizesValid = byteLength(description) <= limits.description && drafts.length <= limits.operations && operations.every((operation) => operationBytes(operation) <= limits.operationArgs) && argsBytes <= limits.payload
  const operationsValid = operations.length === drafts.length && permissions.length === operations.length && permissions.every(Boolean) && l1Operations <= 1
  const timelockValue = /^\d+$/.test(timelock) ? BigInt(timelock) : -1n
  const timelockValid = !!selectedClass && timelockValue >= selectedClass.timelockMin && timelockValue <= selectedClass.timelockMax
  const walletReady = isConnected && chainId === genlayerTestnet.id
  const governanceReady = !!contracts.voting && !!contracts.currentSet && !contracts.stopState?.freezeActive && !contracts.stopState?.maintenanceActive && !contracts.migrationActive
  const accountReady = !!summary && summary.votingPower >= summary.requiredPower && summary.liveProposals < 2n && cooldown <= now && (balance ?? 0n) >= summary.bond
  const formReady = description.trim().length > 1 && !!selectedClass && timelockValid && sizesValid && operationsValid

  useEffect(() => { setPreflight('idle'); setPreflightError('') }, [formFingerprint])

  useEffect(() => {
    if (!contracts.currentSet || operations.length !== drafts.length) { setPermissions([]); return }
    let cancelled = false
    setPermissions([])
    void Promise.all(operations.map((operation) => publicClient.readContract({ address: contracts.currentSet!.classRegistry, abi: GovernanceClassRegistryABI, functionName: 'isPermitted', args: [classId, operation] } as any) as Promise<boolean>))
      .then((values) => { if (!cancelled) setPermissions(values) })
      .catch(() => { if (!cancelled) setPermissions(operations.map(() => false)) })
    return () => { cancelled = true }
  }, [contracts.currentSet, classId, drafts.length, operations])

  const updateDraft = (index: number, patch: Partial<DraftOperation>) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const moveDraft = (index: number, direction: -1 | 1) => setDrafts((current) => { const next = [...current]; const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next })

  const runPreflight = async () => {
    if (!contracts.voting || !address || !summary || !formReady) return
    setPreflight('checking'); setPreflightError('')
    try {
      await publicClient.simulateContract({ address: contracts.voting, abi: GovernanceVotingABI, functionName: 'propose', args: [classId, operations, description, timelockValue, retryAllowed], account: address, value: summary.bond } as any)
      setPreflight('ready')
    } catch (error) { setPreflight('failed'); setPreflightError(errorMessage(error)) }
  }

  const submit = async () => {
    if (!contracts.voting || !address || !summary || preflight !== 'ready') return
    setSubmitting(true); setPreflightError('')
    try {
      const hash = await writeContract({ address: contracts.voting, abi: GovernanceVotingABI, functionName: 'propose', args: [classId, operations, description, timelockValue, retryAllowed], value: summary.bond })
      setTransactionHash(hash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
      const created = receipt.logs.flatMap((log) => { try { const decoded = decodeEventLog({ abi: GovernanceVotingABI as any, data: log.data, topics: log.topics }) as any; return decoded.eventName === 'ProposalCreated' ? [decoded] : [] } catch { return [] } }).at(0) as any
      const proposalId = created?.args?.id
      if (proposalId) navigate(`/proposals/${proposalId}`)
      else navigate('/')
    } catch (error) { setPreflight('failed'); setPreflightError(errorMessage(error)) }
    finally { setSubmitting(false) }
  }

  return <div className="page wide create-page">
    <section className="hero"><div><p className="eyebrow">On-chain proposal builder</p><h1>Create proposal</h1><p>Build an executable GLIP or a signalling RFC, validate every rule, then submit directly from your wallet.</p></div></section>
    {!contracts.voting ? <section className="empty"><h2>Select a deployment first</h2><p>Use the AddressManager control in the header. The builder resolves all governance contracts from that address.</p></section> : <div className="builder-grid"><div className="builder-main">
      <section className="panel"><p className="eyebrow">1 · Proposal class</p><h2>Choose the rules and scope</h2><div className="class-grid">{CLASS_NAMES.slice(0, 6).map((name, id) => <button className={classId === id ? 'selected' : ''} key={name} disabled={!classes[id]} onClick={() => { setClassId(id); setTimelock(classes[id]?.timelockMin.toString() ?? '') }}><b>{name}</b><small>{classes[id] ? `${classes[id].quorumBps / 100}% quorum · >${classes[id].thresholdNum}/${classes[id].thresholdDen} approval` : 'Unavailable'}</small></button>)}</div>{selectedClass && <div className="class-rules"><span><small>For floor</small>{selectedClass.forFloorBps / 100}% GES</span><span><small>Timelock range</small>{formatDuration(selectedClass.timelockMin)}–{formatDuration(selectedClass.timelockMax)}</span><span><small>Risk Review</small>{selectedClass.requiresRiskReview ? 'Required' : 'No'}</span><span><small>Payload scope</small>Checked operation-by-operation</span></div>}</section>

      <section className="panel"><p className="eyebrow">2 · On-chain description</p><h2>Explain the change</h2><p className="muted">Include a title on the first line, motivation, rationale, decoded intent for each operation, and a rollback plan. This full text is stored on L2.</p><textarea className="description-editor" value={description} onChange={(event) => { setDescription(event.target.value); setPreflight('idle') }} placeholder={'# Proposal title\n\n## Motivation\n…\n\n## Operations\n…\n\n## Rollback plan\n…'} /><div className={`byte-counter ${byteLength(description) > limits.description ? 'danger-text' : ''}`}>{byteLength(description).toLocaleString()} / {limits.description.toLocaleString()} bytes · hash <code>{descriptionHash(description).slice(0, 18)}…</code></div></section>

      <section className="panel"><div className="section-heading"><div><p className="eyebrow">3 · Execution payload</p><h2>{drafts.length ? 'Operations' : 'RFC mode'}</h2></div><Button variant="secondary" onClick={() => { setDrafts((current) => [...current, emptyOperation()]); setPreflight('idle') }} disabled={drafts.length >= limits.operations}><Plus size={16} /> Add operation</Button></div>
        {drafts.length === 0 && <div className="rfc-callout"><FileText size={22} /><div><b>This will be a signalling RFC</b><p>No execution payload will be stored or run. Add an operation to create an executable proposal.</p></div></div>}
        <div className="operation-editors">{drafts.map((draft, index) => <article key={index}><header><span>Operation {index + 1}</span><div><Button variant="ghost" title="Move up" onClick={() => moveDraft(index, -1)} disabled={index === 0}><ArrowUp size={15} /></Button><Button variant="ghost" title="Move down" onClick={() => moveDraft(index, 1)} disabled={index === drafts.length - 1}><ArrowDown size={15} /></Button><Button variant="ghost" title="Remove" onClick={() => setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></Button></div></header>
          <div className="form-grid"><label className="full">Target address<input value={draft.target} onChange={(event) => updateDraft(index, { target: event.target.value })} placeholder="0x…" /></label><label>Input mode<select value={draft.mode} onChange={(event) => updateDraft(index, { mode: event.target.value as 'abi' | 'raw' })}><option value="abi">Function signature</option><option value="raw">Raw calldata</option></select></label><label>Native value (wei)<input value={draft.value} onChange={(event) => updateDraft(index, { value: event.target.value })} inputMode="numeric" /></label>{draft.mode === 'abi' ? <><label className="full">Function signature<input value={draft.signature} onChange={(event) => updateDraft(index, { signature: event.target.value })} placeholder="setParameter(uint256,address)" /></label><label className="full">Arguments as JSON array<textarea value={draft.argsJson} onChange={(event) => updateDraft(index, { argsJson: event.target.value })} placeholder={'[42, "0x…"]'} /></label></> : <><label>4-byte selector<input value={draft.rawSelector} onChange={(event) => updateDraft(index, { rawSelector: event.target.value })} placeholder="0x12345678" /></label><label>ABI-encoded arguments<input value={draft.rawArgs} onChange={(event) => updateDraft(index, { rawArgs: event.target.value })} placeholder="0x" /></label></>}</div>
          {encoded[index]?.error ? <p className="field-error">{encoded[index].error}</p> : encoded[index]?.operation && <div className="encoded-preview"><span>{permissions[index] ? <Check size={14} /> : <CircleAlert size={14} />} {permissions[index] ? 'Permitted for this class' : 'Not permitted or still checking'}</span><code>{encoded[index].operation!.selector}{encoded[index].operation!.args.slice(2, 34)}…</code><small>{operationBytes(encoded[index].operation!).toLocaleString()} argument bytes</small></div>}</article>)}</div>
        {operations.length > 0 && <div className="payload-summary"><span><small>Payload hash</small><code>{payloadHash(operations)}</code></span><span><small>Total argument bytes</small>{argsBytes.toLocaleString()} / {limits.payload.toLocaleString()}</span><span><small>L1 bridge operations</small>{l1Operations} / 1</span></div>}
      </section>

      <section className="panel"><p className="eyebrow">4 · Execution settings</p><h2>Timelock and retry policy</h2><div className="form-grid"><label>Class timelock (seconds)<input value={timelock} onChange={(event) => { setTimelock(event.target.value); setPreflight('idle') }} inputMode="numeric" /><small>{selectedClass && `${formatDuration(selectedClass.timelockMin)} minimum · ${formatDuration(selectedClass.timelockMax)} maximum`}</small></label><label className="checkbox"><input type="checkbox" checked={retryAllowed} onChange={(event) => { setRetryAllowed(event.target.checked); setPreflight('idle') }} /><span><b>Allow execution retry</b><small>Keep the proposal queued after a failed execution attempt.</small></span></label></div></section>
    </div>

    <aside className="builder-aside"><section className="panel sticky"><p className="eyebrow">Submission readiness</p><h2>On-chain criteria</h2><ul className="criteria"><Criterion met={walletReady}>{walletReady ? `Wallet ${shortAddress(address)}` : 'Connect wallet on the configured network'}</Criterion><Criterion met={governanceReady}>Governance active; no freeze, maintenance, or migration</Criterion><Criterion met={!!summary && summary.ges > 0n} pending={account.loading}>Epoch/GES initialized (final epoch check occurs in eth_call)</Criterion><Criterion met={!!summary && summary.votingPower >= summary.requiredPower} pending={account.loading}>{summary ? `${formatGen(summary.votingPower)} / ${formatGen(summary.requiredPower)} GEN proposal power` : 'At least 1% of GES voting power'}</Criterion><Criterion met={!!summary && (balance ?? 0n) >= summary.bond} pending={balance === undefined}>{summary ? `${formatGen(summary.bond)} GEN exact bond available` : 'Exact 0.1% GES bond available'}</Criterion><Criterion met={!!summary && summary.liveProposals < 2n}>{summary ? `${summary.liveProposals} of 2 live proposals` : 'Fewer than two live proposals'}</Criterion><Criterion met={cooldown <= now}>No direct or delegate proposal-spam cooldown</Criterion><Criterion met={!!selectedClass}>Selected class exists and is votable</Criterion><Criterion met={timelockValid}>Timelock is within class range</Criterion><Criterion met={sizesValid}>Description and payload size limits</Criterion><Criterion met={operationsValid}>{drafts.length ? 'Every operation permitted; at most one L1 bridge call' : 'RFC has an empty payload'}</Criterion></ul>
        <div className="preflight"><Button variant="secondary" onClick={() => void runPreflight()} disabled={!walletReady || !governanceReady || !accountReady || !formReady || preflight === 'checking'}>{preflight === 'checking' ? <><LoaderCircle className="spin" size={16} /> Simulating…</> : 'Run on-chain preflight'}</Button>{preflight === 'ready' && <p className="success-text"><Check size={15} /> eth_call succeeded at the current head.</p>}{preflightError && <div className="error-box compact">{preflightError}</div>}{transactionHash && <a className="tx-link" href={explorerTx(transactionHash)} target="_blank" rel="noreferrer">View submitted transaction</a>}</div>
        <Button onClick={() => void submit()} disabled={preflight !== 'ready' || submitting}>{submitting ? <><LoaderCircle className="spin" size={16} /> Confirming…</> : `Submit ${drafts.length ? 'proposal' : 'RFC'} · ${summary ? formatGen(summary.bond) : '—'} GEN`}</Button><p className="hint">Any head-state change after preflight can still cause the wallet transaction to revert. Contract errors are shown verbatim with a plain-language explanation when known.</p>
      </section></aside></div>}
  </div>
}
