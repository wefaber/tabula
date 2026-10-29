// Base de datos: pick a table (pills on top), filter and page its rows, open one in the dock, or run SQL below.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Chip, EmptyState, Field, Tile } from '@wefaber/ui'
import { useDeferredValue, useEffect, useState } from 'react'
import { gql } from '@/lib/api'
import {
  ME,
  ROWS,
  TABLES,
  type Cell,
  type RowsPage,
  type TableSummary,
  rowLabel,
} from './api'
import { Console } from './Console'
import { RowDock, type Editing } from './RowDock'

const PAGE_SIZE = 25

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : 'Error desconocido.'

export default function Section() {
  const me = useQuery({
    queryKey: ['db', 'me'],
    queryFn: () => gql<{ me: { role: string } }>(ME),
  })
  const tables = useQuery({
    queryKey: ['db', 'tables'],
    queryFn: () => gql<{ dbTables: TableSummary[] }>(TABLES),
  })
  const [picked, setPicked] = useState<string | null>(null)
  const names = tables.data?.dbTables.map((t) => t.name) ?? []
  const table = picked && names.includes(picked) ? picked : (names[0] ?? null)
  const isAdmin = me.data?.me.role === 'admin'

  if (tables.isPending)
    return <p className="p-2 text-muted">Cargando tablas…</p>
  if (tables.error)
    return (
      <p role="alert" className="p-2 text-danger">
        No se pudieron leer las tablas ({errorText(tables.error)}).{' '}
        <button className="underline" onClick={() => tables.refetch()}>
          Reintentar
        </button>
      </p>
    )
  if (!table) return <EmptyState>La base no tiene tablas todavía.</EmptyState>

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Tablas" className="flex flex-wrap gap-2">
        {tables.data.dbTables.map((t) => (
          <Chip
            key={t.name}
            role="tab"
            selected={t.name === table}
            onClick={() => setPicked(t.name)}
          >
            {t.name}
            <span className="ml-1.5 text-muted tabular">{t.rows}</span>
          </Chip>
        ))}
      </div>

      <RowsTile key={table} table={table} />

      <Console isAdmin={isAdmin} />
    </div>
  )
}

function RowsTile({ table }: { table: string }) {
  const [page, setPage] = useState(1)
  const [term, setTerm] = useState('')
  const filter = useDeferredValue(term.trim())
  const [editing, setEditing] = useState<Editing | null>(null)

  const rows = useQuery({
    queryKey: ['db', 'rows', table, page, filter],
    queryFn: () =>
      gql<{ dbRows: RowsPage }>(ROWS, {
        table,
        page,
        pageSize: PAGE_SIZE,
        filter,
      }),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const data = rows.data?.dbRows
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const canInsert = !!data && data.columns.length > 0

  return (
    <Tile
      title={table}
      actions={
        <Button
          variant="secondary"
          disabled={!canInsert}
          onClick={() => setEditing({ mode: 'insert' })}
        >
          Insertar fila
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label htmlFor="db-filter" className="text-meta text-muted">
          Filtrar
        </label>
        <Field
          id="db-filter"
          density="compact"
          className="max-w-xs"
          value={term}
          placeholder="Texto en cualquier columna"
          maxLength={100}
          onChange={(e) => {
            setTerm(e.target.value)
            setPage(1)
          }}
        />
        {data ? (
          <span className="text-meta text-muted tabular" aria-live="polite">
            {data.total} {data.total === 1 ? 'fila' : 'filas'}
          </span>
        ) : null}
      </div>

      {rows.error ? (
        <p role="alert" className="mb-3 text-danger">
          No se pudieron leer las filas ({errorText(rows.error)}).{' '}
          <button className="underline" onClick={() => rows.refetch()}>
            Reintentar
          </button>
        </p>
      ) : null}

      {!data && rows.isPending ? (
        <p className="text-muted">Cargando filas…</p>
      ) : null}

      {data && data.total === 0 ? (
        <EmptyState>
          {filter
            ? `Ninguna fila tiene "${filter}".`
            : 'La tabla está vacía. Tocá "Insertar fila" para cargar la primera.'}
        </EmptyState>
      ) : null}

      {data && data.total > 0 ? (
        <div
          className={`overflow-x-auto rounded-card border border-border ${rows.isPlaceholderData ? 'opacity-60' : ''}`}
        >
          <table className="w-full text-body">
            <thead className="bg-surface-2 text-left">
              <tr>
                {data.columns.map((c) => (
                  <th
                    key={c.name}
                    scope="col"
                    className="px-3 py-2 font-mono text-meta font-medium whitespace-nowrap"
                  >
                    {c.name}
                    {c.secret ? (
                      <span className="ml-1 text-muted">protegida</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                const label = rowLabel(table, data.pk, row)
                return (
                  <tr
                    key={label + i}
                    className="border-t border-border hover:bg-text/4"
                  >
                    {data.columns.map((c, j) => (
                      <td
                        key={c.name}
                        className="max-w-[32ch] truncate px-3 py-2 tabular"
                      >
                        {j === 0 ? (
                          <button
                            type="button"
                            className="font-medium underline-offset-2 hover:underline"
                            aria-label={`Abrir ${label}`}
                            onClick={() => setEditing({ mode: 'edit', row })}
                          >
                            <CellValue value={row[c.name] ?? null} />
                          </button>
                        ) : (
                          <CellValue value={row[c.name] ?? null} />
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {data ? (
        <nav
          aria-label="Paginación"
          className="mt-3 flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-meta text-muted tabular">
            Página {page} de {pages}
          </span>
          <div className="flex gap-2">
            <Button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </nav>
      ) : null}

      {editing && data ? (
        <RowDock
          // A new key per row: switching rows with the dock open must reset its fields, not keep the old values.
          key={
            editing.mode === 'edit'
              ? rowLabel(table, data.pk, editing.row)
              : 'insert'
          }
          table={table}
          pk={data.pk}
          columns={data.columns}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Tile>
  )
}

function CellValue({ value }: { value: Cell }) {
  if (value === null) return <span className="text-muted italic">NULL</span>
  return <span title={value.length > 40 ? value : undefined}>{value}</span>
}
