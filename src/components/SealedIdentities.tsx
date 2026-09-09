import { Lock, LockOpen, ShieldQuestion } from 'lucide-react'
import { useContracts } from '@/config/ContractsContext'
import { explorerAddress } from '@/lib/rpc'
import { describeSeal } from '@/lib/sealedIdentities'

/**
 * The nine governance identities as the sealed AddressManager names them
 * (CON-865, spec §1.3): key, resolved address, and whether the book is
 * sealed. This replaces the ContractSet / migration view: there is no
 * active set, no set hash and no migration to show — a sealed book cannot
 * change, so what is listed here is the deployment, for good.
 */
export function SealedIdentities() {
  const { bookEntries, seal, loading } = useContracts()
  if (!bookEntries) return loading ? <p className="muted">Resolving governance identities…</p> : null
  const Icon = !seal ? ShieldQuestion : seal.sealed ? Lock : LockOpen
  return <section className="sealed-identities" aria-label="Sealed governance identities">
    <p className={`seal-status ${!seal ? 'unknown' : seal.sealed ? 'sealed' : 'open'}`}><Icon size={14} /> {describeSeal(seal)}</p>
    {seal?.manifestCommitment && <p className="seal-commitment"><small>Manifest commitment</small><code>{seal.manifestCommitment}</code></p>}
    <table>
      <thead><tr><th>Key</th><th>Role</th><th>Address</th></tr></thead>
      <tbody>
        {bookEntries.map((entry) => <tr key={entry.key}>
          <td><code>{entry.key}</code></td>
          <td>{entry.label}{!entry.required && <small> · optional</small>}</td>
          <td>{entry.address
            ? <a href={explorerAddress(entry.address)} target="_blank" rel="noreferrer"><code>{entry.address}</code></a>
            : <span className="muted">never selected</span>}</td>
        </tr>)}
      </tbody>
    </table>
  </section>
}
