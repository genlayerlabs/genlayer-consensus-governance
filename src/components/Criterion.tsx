import { Check, CircleAlert, LoaderCircle } from 'lucide-react'

/** One row of an on-chain readiness list: met, unmet, or still being read. */
export function Criterion({ met, children, pending = false }: { met: boolean; children: React.ReactNode; pending?: boolean }) {
  return <li className={met ? 'met' : ''}><span>{pending ? <LoaderCircle className="spin" size={15} /> : met ? <Check size={15} /> : <CircleAlert size={15} />}</span>{children}</li>
}
