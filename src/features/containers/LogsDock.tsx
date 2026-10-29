// Live logs of one service in a Dock: SSE on `containers-<service>`; the server replays its ring buffer on join.
import { Dock, EmptyState, IconButton } from '@wefaber/ui'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { follow } from '@/lib/api'
import type { ContainerRow } from './format'

interface LogLine {
  seq: number
  stream: 'stdout' | 'stderr'
  text: string
  at: string
}

const MAX_LINES = 1000

function useLogs(service: string | null): LogLine[] {
  const [state, setState] = useState<{ service: string; lines: LogLine[] }>({
    service: '',
    lines: [],
  })

  // Highest seq shown per service, so reopening a service does not append the server's replay again.
  const seen = useRef({ service: '', seq: 0 })

  useEffect(() => {
    if (!service) return
    let last = seen.current.service === service ? seen.current.seq : 0
    return follow(`containers-${service}`, {
      line: (data) => {
        const line = data as LogLine
        if (line.seq <= last) return
        last = line.seq
        seen.current = { service, seq: last }
        setState((prev) => ({
          service,
          lines: [...(prev.service === service ? prev.lines : []), line].slice(
            -MAX_LINES,
          ),
        }))
      },
    })
  }, [service])

  return state.service === service ? state.lines : []
}

export function LogsDock({
  container,
  onClose,
}: {
  container: ContainerRow | null
  onClose: () => void
}) {
  const service = container?.service ?? null
  const lines = useLogs(container?.state === 'running' ? service : null)
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <Dock open={container !== null} width={640}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-tile border border-(--tile-edge) bg-surface p-tile">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-h3 font-semibold">
            Logs de {service}
            <span className="ml-2 font-mono text-meta font-normal text-muted">
              {container?.name}
            </span>
          </h2>
          <IconButton
            label="Cerrar logs"
            icon={<X size={18} />}
            onClick={onClose}
          />
        </header>
        {container?.state !== 'running' ? (
          <EmptyState>
            {service} está apagado, no hay logs en vivo. Encendé el stack para
            seguirlos.
          </EmptyState>
        ) : (
          <div
            ref={box}
            role="log"
            aria-label={`Logs de ${service}`}
            onScroll={(e) => {
              const el = e.currentTarget
              pinned.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
            className="min-h-0 flex-1 overflow-auto rounded-card bg-surface-2 p-3 font-mono text-meta"
          >
            {lines.length === 0 ? (
              <p className="text-muted">Esperando líneas…</p>
            ) : (
              lines.map((l) => (
                <div
                  key={l.seq}
                  className={`whitespace-pre-wrap break-all ${l.stream === 'stderr' ? 'text-warning' : ''}`}
                >
                  {l.text}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Dock>
  )
}
