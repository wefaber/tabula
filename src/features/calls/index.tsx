// Llamadas: las últimas requests de la API y de login, en vivo. Filas de altura fija: llegar una fila no mueve nada.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Minus, OctagonAlert, TriangleAlert } from 'lucide-react'
import { Chip, EmptyState, Field, Tile } from '@wefaber/ui'
import { useEffect, useRef, useState } from 'react'
import { follow, gql } from '@/lib/api'

interface Call {
  id: number
  at: string
  method: string
  path: string
  status: number
  bytes: number
}

interface CallsPage {
  total: number
  items: Call[]
}

const CALLS = /* GraphQL */ `
  query RecentCalls($limit: Int, $status: String, $path: String) {
    recentCalls(limit: $limit, status: $status, path: $path) {
      total
      items {
        id
        at
        method
        path
        status
        bytes
      }
    }
  }
`

const STATUS_CHIPS = ['Todos', '2xx', '3xx', '4xx', '5xx'] as const
const PAGE = 100

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-UY', { hour12: false })

/** Icon + color + code: never color alone (DESIGN.md › color means something). */
function Estado({ status }: { status: number }) {
  const clase = Math.floor(status / 100)
  const { Icon, tono, texto } =
    clase === 2
      ? { Icon: Check, tono: 'text-success', texto: 'OK' }
      : clase === 3
        ? { Icon: Minus, tono: 'text-muted', texto: 'Redirección' }
        : clase === 4
          ? {
              Icon: TriangleAlert,
              tono: 'text-warning',
              texto: 'Error del cliente',
            }
          : {
              Icon: OctagonAlert,
              tono: 'text-danger',
              texto: 'Error del servidor',
            }
  return (
    <span className={`tabular inline-flex items-center gap-1.5 ${tono}`}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>{status}</span>
      <span className="sr-only">{texto}</span>
    </span>
  )
}

export default function Section() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<(typeof STATUS_CHIPS)[number]>('Todos')
  const [path, setPath] = useState('')
  const [pathFiltro, setPathFiltro] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Escribir en el filtro no dispara una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => setPathFiltro(path.trim()), 300)
    return () => clearTimeout(t)
  }, [path])

  const filtroStatus = status === 'Todos' ? '' : status
  const key = ['calls', filtroStatus, pathFiltro]
  const llamadas = useQuery({
    queryKey: key,
    queryFn: () =>
      gql<{ recentCalls: CallsPage }>(CALLS, {
        limit: PAGE,
        status: filtroStatus || null,
        path: pathFiltro || null,
      }),
  })

  // Cada llamada nueva refresca la página con un poco de demora: barato aun con mucho tráfico.
  useEffect(() => {
    const stop = follow('calls', {
      call: () => {
        clearTimeout(timer.current)
        timer.current = setTimeout(
          () => void qc.invalidateQueries({ queryKey: ['calls'] }),
          800,
        )
      },
    })
    return () => {
      clearTimeout(timer.current)
      stop()
    }
  }, [qc])

  const page = llamadas.data?.recentCalls
  const items = page?.items ?? []

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filtros"
      >
        {STATUS_CHIPS.map((s) => (
          <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>
            {s}
          </Chip>
        ))}
        <Field
          aria-label="Filtrar por ruta"
          placeholder="Ruta, por ejemplo equipos"
          density="compact"
          className="ml-auto w-64"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <span className="tabular text-meta text-muted" aria-live="polite">
          {page ? `${page.total} resultados` : 'Cargando…'}
          {page && page.total > items.length
            ? ` · mostrando ${items.length}`
            : ''}
        </span>
      </div>

      <Tile title="Últimas llamadas">
        {llamadas.error ? (
          <p role="alert" className="text-danger">
            No se pudieron leer las llamadas ({llamadas.error.message}).{' '}
            <button className="underline" onClick={() => llamadas.refetch()}>
              Reintentar
            </button>
          </p>
        ) : items.length === 0 && page ? (
          <EmptyState>
            {page.total === 0 && !filtroStatus && !pathFiltro
              ? 'Todavía no hay llamadas. Cuando alguien use la API van a aparecer acá.'
              : 'Ninguna llamada coincide con los filtros.'}
          </EmptyState>
        ) : (
          <div className="h-[28rem] overflow-auto rounded-card bg-surface-2">
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-24" />
                <col className="w-20" />
                <col />
                <col className="w-44" />
                <col className="w-20" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface-2 text-meta text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Hora
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Método
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ruta
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Bytes
                  </th>
                </tr>
              </thead>
              <tbody className="text-meta">
                {items.map((c) => (
                  <tr key={c.id} className="h-9 border-t border-border">
                    <td className="tabular px-3 text-muted">{hora(c.at)}</td>
                    <td className="px-3 font-mono">{c.method}</td>
                    <td className="truncate px-3 font-mono" title={c.path}>
                      {c.path}
                    </td>
                    <td className="px-3">
                      <Estado status={c.status} />
                    </td>
                    <td className="tabular px-3 text-right text-muted">
                      {c.bytes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>
      <p className="text-meta text-muted">
        Se guardan las últimas 500 llamadas de las últimas 24 h. Las query
        strings salen enmascaradas (`?cedula=*`).
      </p>
    </div>
  )
}
