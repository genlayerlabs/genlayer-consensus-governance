import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { useContracts } from '@/config/ContractsContext'
import { shortAddress } from '@/lib/governance'
import { Button } from './Button'

export function AddressManagerControl() {
  const contracts = useContracts()
  const [open, setOpen] = useState(!contracts.addressManager)
  const [value, setValue] = useState(contracts.addressManager ?? '')
  const [error, setError] = useState('')
  useEffect(() => setValue(contracts.addressManager ?? ''), [contracts.addressManager])
  const save = () => {
    try { contracts.setAddressManager(value); setError(''); setOpen(false) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <>
    <Button variant="ghost" onClick={() => setOpen(true)} title="Configure AddressManager"><Settings size={16} /> {shortAddress(contracts.addressManager)}</Button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={() => contracts.addressManager && setOpen(false)}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="address-manager-title" onMouseDown={(event) => event.stopPropagation()}>
        <p className="eyebrow">Deployment</p>
        <h2 id="address-manager-title">Connect an AddressManager</h2>
        <p className="muted">Governance contracts are resolved directly from this on-chain address book. The value stays in this browser only.</p>
        <label>AddressManager address<input value={value} onChange={(event) => setValue(event.target.value)} placeholder="0x…" autoFocus /></label>
        {(error || contracts.error) && <div className="error-box">{error || contracts.error}</div>}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setOpen(false)} disabled={!contracts.addressManager}>Cancel</Button>{contracts.addressManager && <Button variant="ghost" onClick={() => { contracts.setAddressManager(''); setValue(''); }}>Clear</Button>}<Button onClick={save}>Use deployment</Button></div>
      </section>
    </div>}
  </>
}
