import { Info } from 'lucide-react'

/**
 * Small "i" affordance that explains a metric on hover/focus.
 *
 * Deliberately NO `title`: the browser renders its own tooltip for it, which
 * showed up alongside the styled bubble as a second, duplicate box. The
 * accessible name comes from `aria-label`, and the bubble opens on
 * :focus-visible, so keyboard and assistive-tech users lose nothing.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <span className="info-hint" tabIndex={0} role="note" aria-label={text}>
      <Info size={12} aria-hidden="true" />
      <span className="info-hint-bubble" aria-hidden="true">{text}</span>
    </span>
  )
}
