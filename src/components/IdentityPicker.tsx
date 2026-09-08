import type { Address } from 'viem'
import type { IdentityState } from '@/hooks/useVoterIdentities'
import { formatGen, shortAddress } from '@/lib/governance'
import { IDENTITY_KIND_LABELS, identityBlockReason } from '@/lib/identity'

/**
 * "Act as": the connected account plus every validator wallet and vesting it
 * controls. Unusable identities are listed and disabled with the reason,
 * never hidden — an owner needs to see WHY a validator cannot vote.
 */
export function IdentityPicker({ label, identities, selected, onSelect, loading, error, weightLabel = 'GEN' }: {
  label: string; identities: IdentityState[]; selected: Address | ''; onSelect: (address: Address | '') => void
  loading?: boolean; error?: string; weightLabel?: string
}) {
  return <div className="vote-as"><small>{label}</small><div className="vote-as-list">
    {identities.map((identity) => {
      const blocked = identity.unreachable ?? identityBlockReason(identity, shortAddress)
      const value = identity.kind === 'eoa' ? '' : identity.address
      return <button key={identity.address} className={selected === value ? 'selected' : ''} disabled={Boolean(blocked)} onClick={() => onSelect(value)} title={blocked || undefined}>
        <b>{shortAddress(identity.address)}</b><span>{blocked || IDENTITY_KIND_LABELS[identity.kind]}</span>
        <em>{formatGen(identity.weight)} {weightLabel}</em>
      </button>
    })}
  </div>{loading && <small className="muted">Looking up your validators and vesting…</small>}{error && <small className="danger-text">Identity lookup failed: {error}</small>}</div>
}
