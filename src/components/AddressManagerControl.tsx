import { useEffect, useState } from 'react'
import { RefreshCw, Settings } from 'lucide-react'
import { useContracts } from '@/config/ContractsContext'
import { repoUrl } from '@/config/networksRepo'
import { shortAddress } from '@/lib/governance'
import { Button } from './Button'
import { SealedIdentities } from './SealedIdentities'

export function AddressManagerControl() {
  const contracts = useContracts()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(contracts.addressManager ?? '')
  const [error, setError] = useState('')
  useEffect(() => setValue(contracts.addressManager ?? ''), [contracts.addressManager])
  // Nothing to show until a deployment is chosen: open the dialog once the list has loaded.
  useEffect(() => {
    if (!contracts.addressManager && !contracts.deploymentsLoading) setOpen(true)
  }, [contracts.addressManager, contracts.deploymentsLoading])
  const selected = contracts.deployments.find((d) => d.name === contracts.selectedDeployment)
  const save = () => {
    try { contracts.setAddressManager(value); setError(''); setOpen(false) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  const choose = (name: string) => {
    if (name === '') return
    try { contracts.selectDeployment(name); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <>
    <Button variant="ghost" onClick={() => setOpen(true)} title="Configure deployment"><Settings size={16} /> {selected ? selected.label : shortAddress(contracts.addressManager)}</Button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={() => contracts.addressManager && setOpen(false)}>
      <section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="address-manager-title" onMouseDown={(event) => event.stopPropagation()}>
        <p className="eyebrow">Deployment</p>
        <h2 id="address-manager-title">Choose a deployment</h2>
        <p className="muted">The folders of <a href={repoUrl()} target="_blank" rel="noreferrer">genlayer-networks</a>, newest first. The nine governance identities are resolved by key from the sealed AddressManager of the chosen folder. The choice stays in this browser only.</p>
        <label>Deployment
          <div className="deployment-picker">
            <select value={selected?.name ?? ''} onChange={(event) => choose(event.target.value)} disabled={contracts.deploymentsLoading || contracts.deployments.length === 0}>
              {contracts.deployments.length === 0 && <option value="">{contracts.deploymentsLoading ? 'Loading deployments…' : 'No deployments listed'}</option>}
              {!selected && contracts.deployments.length > 0 && <option value="">{contracts.addressManager ? 'Custom AddressManager' : 'Select a deployment'}</option>}
              {contracts.deployments.map((d) => <option key={d.name} value={d.name}>{d.label}</option>)}
            </select>
            <Button variant="secondary" type="button" onClick={contracts.refreshDeployments} disabled={contracts.deploymentsLoading} title="Reload the deployment list from genlayer-networks" aria-label="Refresh deployments"><RefreshCw size={16} className={contracts.deploymentsLoading ? 'spin' : undefined} /></Button>
          </div>
        </label>
        {contracts.deploymentsError && <div className="error-box">Deployment list: {contracts.deploymentsError}</div>}
        <label>AddressManager address (any deployment)<input value={value} onChange={(event) => setValue(event.target.value)} placeholder="0x…" /></label>
        {(error || contracts.error) && <div className="error-box">{error || contracts.error}</div>}
        {!error && !contracts.error && contracts.addressManager && value.trim().toLowerCase() === contracts.addressManager.toLowerCase() && <SealedIdentities />}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setOpen(false)} disabled={!contracts.addressManager}>Cancel</Button>{contracts.addressManager && <Button variant="ghost" onClick={() => { contracts.setAddressManager(''); setValue(''); }}>Clear</Button>}<Button onClick={save}>Use this AddressManager</Button></div>
      </section>
    </div>}
  </>
}
