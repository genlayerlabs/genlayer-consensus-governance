import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/ui'

export function Button({ className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button className={cn('button', `button-${variant}`, className)} {...props} />
}
