import { Loader2 } from 'lucide-react'

/** Section loading state: spinner and label in the middle of the screen, not tucked in a corner. */
export function Loader({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-20 grid place-items-center"
    >
      <div className="flex flex-col items-center gap-3 text-muted">
        <Loader2 aria-hidden className="size-8 animate-spin text-accent" />
        <span className="text-body">{label}</span>
      </div>
    </div>
  )
}
