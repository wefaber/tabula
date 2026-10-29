import { Loader2 } from 'lucide-react'
import { useT } from '@/lib/i18n'

/** Section loading state: spinner and label in the middle of the screen, not tucked in a corner. */
export function Loader({ label }: { label?: string }) {
  const t = useT()
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-20 grid place-items-center"
    >
      <div className="flex flex-col items-center gap-3 text-muted">
        <Loader2 aria-hidden className="size-8 animate-spin text-accent" />
        <span className="text-body">{label ?? t('loader.loading')}</span>
      </div>
    </div>
  )
}
