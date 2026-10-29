// Details of one row (edit) or a new row (insert), docked on the right. Delete lives here too, behind a typed label.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Dock, Field, IconButton } from '@wefaber/ui'
import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError, gql } from '@/lib/api'
import {
  DELETE,
  INSERT,
  MASK,
  rowLabel,
  UPSERT,
  type Cell,
  type Column,
  type Row,
} from './api'

export type Editing = { mode: 'edit'; row: Row } | { mode: 'insert' }

interface Props {
  table: string
  pk: string[]
  columns: Column[]
  editing: Editing
  onClose: () => void
}

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Error desconocido.'

export function RowDock({ table, pk, columns, editing, onClose }: Props) {
  const qc = useQueryClient()
  const isEdit = editing.mode === 'edit'
  const base: Row = isEdit ? editing.row : {}
  const [values, setValues] = useState<Row>(() =>
    Object.fromEntries(columns.map((c) => [c.name, base[c.name] ?? null])),
  )
  const [nulls, setNulls] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState('')
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['db'] })

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const writable = Object.fromEntries(
        columns
          .filter((c) => c.editable && !c.secret)
          .map((c) => [
            c.name,
            nulls[c.name] ? null : (values[c.name] ?? null),
          ]),
      )
      if (isEdit) {
        const key = Object.fromEntries(pk.map((k) => [k, base[k] ?? null]))
        return gql<{ dbUpsertRow: string }>(UPSERT, {
          table,
          pk: key,
          values: writable,
        })
      }
      return gql<{ dbInsertRow: boolean }>(INSERT, { table, values: writable })
    },
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: () => {
      const key = Object.fromEntries(pk.map((k) => [k, base[k] ?? null]))
      return gql<{ dbDeleteRow: boolean }>(DELETE, { table, pk: key, confirm })
    },
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })

  const label = isEdit ? rowLabel(table, pk, base) : `Nueva fila en ${table}`
  const expected = isEdit ? rowLabel(table, pk, base) : ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const askDelete = () => {
    if (confirm !== expected) {
      setConfirmError(`Para borrar, escribí exactamente ${expected}.`)
      return
    }
    setConfirmError(null)
    remove.mutate()
  }

  return (
    <Dock open width={420}>
      <aside
        aria-label={label}
        className="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-panel border border-border bg-surface p-4 shadow-float"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 truncate text-h3 font-semibold">{label}</h2>
          <IconButton label="Cerrar" icon={<X size={18} />} onClick={onClose} />
        </header>

        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
        >
          {columns.map((c) => (
            <FieldRow
              key={c.name}
              column={c}
              isNew={!isEdit}
              value={values[c.name] ?? null}
              isNull={!!nulls[c.name]}
              onChange={(v) => setValues((prev) => ({ ...prev, [c.name]: v }))}
              onNull={(on) => setNulls((prev) => ({ ...prev, [c.name]: on }))}
            />
          ))}

          <div
            aria-live="polite"
            className="text-meta text-danger"
            role={save.error ? 'alert' : undefined}
          >
            {save.error
              ? `No se pudo guardar (${errorText(save.error)}). Revisá los campos y reintentá.`
              : null}
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : 'Insertar fila'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>

        {isEdit ? (
          <section
            aria-labelledby="borrar-fila"
            className="flex flex-col gap-2 border-t border-border pt-3"
          >
            <h3 id="borrar-fila" className="text-body font-semibold">
              Borrar fila
            </h3>
            <p className="text-meta text-muted">
              Es irreversible. Para confirmar, escribí{' '}
              <code className="font-mono text-text">{expected}</code>.
            </p>
            <label htmlFor="db-confirm-delete" className="sr-only">
              Confirmación de borrado
            </label>
            <Field
              id="db-confirm-delete"
              density="compact"
              value={confirm}
              invalid={!!confirmError}
              aria-describedby={confirmError ? 'db-confirm-error' : undefined}
              placeholder={expected}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div
              id="db-confirm-error"
              aria-live="polite"
              className="text-meta text-danger"
            >
              {confirmError ??
                (remove.error
                  ? `No se pudo borrar (${errorText(remove.error)}).`
                  : null)}
            </div>
            <div>
              <Button
                variant="danger"
                onClick={askDelete}
                disabled={remove.isPending}
              >
                {remove.isPending ? 'Borrando…' : 'Borrar fila'}
              </Button>
            </div>
          </section>
        ) : null}
      </aside>
    </Dock>
  )
}

function FieldRow({
  column: c,
  isNew,
  value,
  isNull,
  onChange,
  onNull,
}: {
  column: Column
  isNew: boolean
  value: Cell
  isNull: boolean
  onChange: (v: Cell) => void
  onNull: (on: boolean) => void
}) {
  const id = `db-col-${c.name}`
  const locked =
    c.secret || !c.editable || (isNew && /auto_increment/i.test(c.extra))
  const hint = c.secret
    ? 'Columna protegida: no se muestra ni se edita desde el panel.'
    : !c.editable
      ? c.key === 'PRI'
        ? 'Clave primaria: no se cambia desde la fila.'
        : 'Se calcula sola.'
      : isNew && /auto_increment/i.test(c.extra)
        ? 'Automático si lo dejás vacío.'
        : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-mono text-meta text-muted">
          {c.name}
          <span className="ml-2 text-muted">
            {c.enumValues.length ? 'enum' : c.type}
          </span>
        </label>
        {c.nullable && !locked ? (
          <label className="flex items-center gap-1 text-meta text-muted">
            <input
              type="checkbox"
              checked={isNull}
              onChange={(e) => onNull(e.target.checked)}
            />
            NULL
          </label>
        ) : null}
      </div>
      {c.enumValues.length ? (
        <select
          id={id}
          disabled={locked || isNull}
          value={isNull ? '' : (value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 rounded-control border border-border bg-surface px-3 text-body-lg text-text disabled:opacity-50"
        >
          {c.nullable || isNew ? <option value="">—</option> : null}
          {c.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <Field
          id={id}
          value={c.secret ? MASK : isNull ? '' : (value ?? '')}
          disabled={locked || isNull}
          placeholder={isNull ? 'NULL' : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
