import { Info } from 'lucide-react'

/**
 * Small "i" affordance that explains a metric on hover/focus.
 *
 * `title` carries the same text so the native tooltip still works for
 * keyboard and assistive-tech users; the styled bubble is presentational and
 * hidden from the accessibility tree to avoid announcing it twice.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <span className="info-hint" tabIndex={0} role="note" aria-label={text} title={text}>
      <Info size={12} aria-hidden="true" />
      <span className="info-hint-bubble" aria-hidden="true">{text}</span>
    </span>
  )
}
