// SQL console: read by default. Writes need the admin's toggle, a dump on the server, and a confirmation dialog.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Dialog, Tile, Textarea } from '@wefaber/ui'
import { useState } from 'react'
import { ApiError, gql } from '@/lib/api'
import {
  CONSOLE,
  EXECUTE,
  type Cell,
  type ConsoleResult,
  type ExecResult,
} from './api'

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Error desconocido.'

type Outcome =
  | { kind: 'rows'; result: ConsoleResult }
  | { kind: 'exec'; result: ExecResult }

export function Console({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient()
  const [sql, setSql] = useState('SELECT * FROM usuario LIMIT 10')
  const [writeMode, setWriteMode] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const read = useMutation({
    mutationFn: () => gql<{ dbQuery: ConsoleResult }>(CONSOLE, { sql }),
    onSuccess: (r) => setOutcome({ kind: 'rows', result: r.dbQuery }),
    onError: () => setOutcome(null),
  })

  const write = useMutation({
    mutationFn: () => gql<{ dbExecute: ExecResult }>(EXECUTE, { sql }),
    onSuccess: (r) => {
      setOutcome({ kind: 'exec', result: r.dbExecute })
      setConfirmOpen(false)
      void qc.invalidateQueries({ queryKey: ['db'] })
    },
    onError: () => setConfirmOpen(false),
  })

  const busy = read.isPending || write.isPending
  const error = read.error ?? write.error

  return (
    <Tile title="Consola SQL">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Chip
          selected={writeMode}
          disabled={!isAdmin}
          aria-describedby="db-write-hint"
          onClick={() => setWriteMode((on) => !on)}
        >
          Escritura {writeMode ? 'activada' : 'desactivada'}
        </Chip>
        <p id="db-write-hint" className="text-meta text-muted">
          {!isAdmin
            ? 'Solo un admin puede escribir.'
            : writeMode
              ? 'Cada sentencia de escritura guarda un dump antes y pide confirmación.'
              : 'Solo lectura: SELECT, SHOW, DESCRIBE, EXPLAIN.'}
        </p>
      </div>

      <label htmlFor="db-sql" className="sr-only">
        Sentencia SQL
      </label>
      <Textarea
        id="db-sql"
        rows={6}
        spellCheck={false}
        className="font-mono text-meta"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {writeMode ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            Ejecutar…
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => read.mutate()}
          >
            {read.isPending ? 'Corriendo…' : 'Correr'}
          </Button>
        )}
      </div>

      <div role="alert" className="mt-3 text-meta text-danger" hidden={!error}>
        {error ? `No se pudo correr la sentencia (${errorText(error)}).` : null}
      </div>

      {outcome ? <Result outcome={outcome} /> : null}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Ejecutar sentencia de escritura"
        closeLabel="Cancelar"
      >
        <p className="text-body">
          Antes de correrla se guarda un dump de la base en el server (se
          conservan los últimos 10). Revisá la sentencia:
        </p>
        <pre className="max-h-48 overflow-auto rounded-card bg-surface-2 p-3 font-mono text-meta whitespace-pre-wrap">
          {sql}
        </pre>
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={write.isPending}
            onClick={() => write.mutate()}
          >
            {write.isPending ? 'Ejecutando…' : 'Ejecutar'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            Cancelar
          </Button>
        </div>
      </Dialog>
    </Tile>
  )
}

function Result({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'exec') {
    return (
      <p role="status" className="mt-3 rounded-card bg-surface-2 p-3 text-meta">
        {outcome.result.verb} aplicado. Dump previo:{' '}
        <code className="font-mono">{outcome.result.dumpFile}</code>
      </p>
    )
  }
  const { columns, rows, truncated } = outcome.result
  if (columns.length === 0) {
    return (
      <p className="mt-3 text-meta text-muted">
        La consulta no devolvió columnas.
      </p>
    )
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-meta text-muted tabular">
        {rows.length} filas{truncated ? ' (se muestran las primeras 500)' : ''}
      </p>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-meta">
          <thead className="bg-surface-2 text-left">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="px-2 py-1.5 font-mono font-medium whitespace-nowrap"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-2 py-3 text-muted">
                  Sin filas.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((v, j) => (
                    <td
                      key={j}
                      className="max-w-[24ch] truncate px-2 py-1 tabular"
                    >
                      <CellText value={v} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CellText({ value }: { value: Cell }) {
  if (value === null) return <span className="text-muted italic">NULL</span>
  return <span title={value}>{value}</span>
}
