import { STATE_NAMES } from '@/lib/governance'

export function StatusBadge({ state }: { state: number }) {
  const name = STATE_NAMES[state] ?? `State ${state}`
  return <span className={`status status-${name.toLowerCase().replaceAll(' ', '-')}`}>{name}</span>
}
