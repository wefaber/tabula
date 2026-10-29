// APIs: estado de cada api/*.php y de la DB, con su historial de 24 h. Se actualiza por SSE sin mover la grilla.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, Minus, X } from 'lucide-react'
import { Chip, EmptyState, Field, Tile } from '@wefaber/ui'
import { useEffect, useMemo, useState } from 'react'
import { follow, gql } from '@/lib/api'

interface Bucket {
  at: string
  ok: boolean | null
  latencyMs: number | null
}

interface Endpoint {
  name: string
  kind: 'api' | 'db'
  path: string
  checked: boolean
  ok: boolean
  status: number | null
  latencyMs: number | null
  checkedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  uptime: number | null
  avgLatencyMs: number | null
  series: Bucket[]
}

interface Status {
  intervalSeconds: number
  endpoints: Endpoint[]
}

const STATUS = /* GraphQL */ `
  query ApiStatus {
    apiStatus {
      intervalSeconds
      endpoints {
        name
        kind
        path
        checked
        ok
        status
        latencyMs
        checkedAt
        lastError
        lastErrorAt
        uptime
        avgLatencyMs
        series {
          at
          ok
          latencyMs
        }
      }
    }
  }
`

type Filter = 'all' | 'fail' | 'api' | 'db'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'fail', label: 'Con fallas' },
  { id: 'api', label: 'Solo API' },
  { id: 'db', label: 'Base de datos' },
]

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es-UY') : '—'

function Estado({ e }: { e: Endpoint }) {
  if (!e.checked)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Circle aria-hidden className="size-4" />
        Sin datos todavía
      </span>
    )
  return e.ok ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <Check aria-hidden className="size-4" />
      Sano
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-danger">
      <X aria-hidden className="size-4" />
      Falla
    </span>
  )
}

function Sparkline({ name, series }: { name: string; series: Bucket[] }) {
  const fallas = series.filter((b) => b.ok === false).length
  return (
    <div
      role="img"
      aria-label={`Últimas 24 h de ${name}: ${fallas} tramos con fallas de ${series.length}`}
      className="flex h-6 w-full min-w-24 items-end gap-px"
    >
      {series.map((b) => (
        <span
          key={b.at}
          title={`${hora(b.at)} · ${b.ok === null ? 'sin datos' : b.ok ? 'sano' : 'falla'}${b.latencyMs === null ? '' : ` · ${b.latencyMs} ms`}`}
          className={`w-full rounded-sm ${
            b.ok === null
              ? 'h-1 bg-text/12'
              : b.ok
                ? 'h-full bg-success/70'
                : 'h-full bg-danger'
          }`}
        />
      ))}
    </div>
  )
}

export default function Section() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const status = useQuery({
    queryKey: ['apis'],
    queryFn: () => gql<{ apiStatus: Status }>(STATUS),
    refetchInterval: 60_000,
  })

  useEffect(
    () =>
      follow('apis', {
        checked: () => void qc.invalidateQueries({ queryKey: ['apis'] }),
      }),
    [qc],
  )

  const todas = useMemo(
    () => status.data?.apiStatus.endpoints ?? [],
    [status.data],
  )
  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return todas.filter((e) => {
      if (filter === 'fail' && (!e.checked || e.ok)) return false
      if (filter === 'api' && e.kind !== 'api') return false
      if (filter === 'db' && e.kind !== 'db') return false
      return !q || e.name.includes(q) || e.path.includes(q)
    })
  }, [todas, filter, query])

  const fallando = todas.filter((e) => e.checked && !e.ok).length

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filtros"
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            selected={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Chip>
        ))}
        <Field
          aria-label="Buscar endpoint"
          placeholder="Buscar endpoint"
          density="compact"
          className="ml-auto w-56"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="tabular text-meta text-muted" aria-live="polite">
          {visibles.length} de {todas.length}
          {fallando ? ` · ${fallando} con fallas` : ''}
        </span>
      </div>

      <Tile title="Endpoints">
        {status.isPending ? (
          <p className="text-muted">Cargando…</p>
        ) : status.error ? (
          <p role="alert" className="text-danger">
            No se pudo leer el estado de las APIs ({status.error.message}).{' '}
            <button className="underline" onClick={() => status.refetch()}>
              Reintentar
            </button>
          </p>
        ) : visibles.length === 0 ? (
          <EmptyState>
            {todas.length === 0
              ? 'Todavía no hay endpoints para chequear.'
              : 'Ningún endpoint coincide con el filtro. Probá con "Todas".'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {visibles.map((e) => (
              <li
                key={e.name}
                className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,2fr)_9rem_6.5rem_5rem_minmax(0,1.5fr)] md:items-center md:gap-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {e.kind === 'db' ? (
                      <span>Base de datos (db)</span>
                    ) : (
                      <span className="truncate">{e.name}.php</span>
                    )}
                  </p>
                  <p className="truncate font-mono text-meta text-muted">
                    {e.kind === 'db' ? 'SELECT 1 en el container db' : e.path}
                  </p>
                  {e.lastError && !e.ok ? (
                    <p className="text-meta text-danger">
                      {e.lastError} · {hora(e.lastErrorAt)}
                    </p>
                  ) : null}
                </div>
                <div className="text-meta">
                  <Estado e={e} />
                  {e.status !== null ? (
                    <span className="tabular ml-2 text-muted">
                      HTTP {e.status}
                    </span>
                  ) : null}
                </div>
                <div className="tabular text-meta">
                  {e.latencyMs === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <span>{e.latencyMs} ms</span>
                  )}
                  <span className="block text-muted">
                    prom. {e.avgLatencyMs ?? '—'} ms
                  </span>
                </div>
                <div className="tabular text-meta">
                  {e.uptime === null ? (
                    <span className="text-muted">
                      <Minus aria-hidden className="inline size-3.5" /> sin
                      datos
                    </span>
                  ) : (
                    <span>{e.uptime.toFixed(1)} %</span>
                  )}
                  <span className="block text-muted">24 h</span>
                </div>
                <Sparkline name={e.name} series={e.series} />
              </li>
            ))}
          </ul>
        )}
      </Tile>
      {status.data ? (
        <p className="text-meta text-muted">
          Chequeo cada {status.data.apiStatus.intervalSeconds} s, sin sesión y
          sin POST. Login no se consulta.
        </p>
      ) : null}
    </div>
  )
}
