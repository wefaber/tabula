// Use cases of the DB editor. Checks identifiers against information_schema, validates values, audits every change
// (who, table, pk, changed column names; never values), and runs the console through the classifier.
import { audit } from '../../audit'
import type { Ctx } from '../../deps'
import { clampPage } from '../../graphql/limits'
import {
  isSecretName,
  MASK,
  maskRow,
  type ColumnInfo,
  type Row,
  type TableInfo,
} from './columns'
import type { DbClient } from './client'
import { DbError } from './errors'
import { dumpFileName, pruneDumps, writeDump } from './dumps'
import { MAX_FILTER } from './queries'
import { assertKnown, literal } from './sqlSafe'
import { classifyStatement } from './statement'

export const QUERY_LIMIT = 500

export interface RowsPage {
  table: string
  columns: ColumnInfo[]
  rows: Row[]
  total: number
  page: number
  pageSize: number
  pk: string[]
}

export interface QueryResult {
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
  verb: string
}

export interface ExecResult {
  verb: string
  dumpFile: string
}

/** Where dumps go and how many to keep: from config, passed in so the service stays testable. */
export interface DumpTarget {
  dir: string
  dbName: string
  now: () => Date
}

const pkNames = (cols: ColumnInfo[]) =>
  cols.filter((c) => c.key === 'PRI').map((c) => c.name)

export async function listTables(client: DbClient): Promise<TableInfo[]> {
  return client.tables()
}

async function tableColumns(
  client: DbClient,
  table: string,
): Promise<{ name: string; cols: ColumnInfo[] }> {
  const names = (await client.tables()).map((t) => t.name)
  const name = assertKnown(table, names, 'la tabla')
  return { name, cols: await client.columns(name) }
}

export async function schemaOf(
  client: DbClient,
  table: string,
): Promise<ColumnInfo[]> {
  return (await tableColumns(client, table)).cols
}

export async function rowsPage(
  client: DbClient,
  table: string,
  args: {
    page?: number | null
    pageSize?: number | null
    filter?: string | null
  },
): Promise<RowsPage> {
  const { name, cols } = await tableColumns(client, table)
  const pageSize = clampPage(args.pageSize, 25)
  const page = Math.max(1, Math.trunc(args.page ?? 1))
  const filter = args.filter ?? ''
  if (filter.length > MAX_FILTER)
    throw new DbError(
      'BAD_INPUT',
      `El filtro tiene hasta ${MAX_FILTER} caracteres.`,
    )
  const got = await client.page(name, cols, {
    filter,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  })
  return {
    table: name,
    columns: cols,
    rows: got.rows.map((r) => maskRow(cols, r)),
    total: got.total,
    page,
    pageSize,
    pk: pkNames(cols),
  }
}

/** The key as given, checked against the table's primary key: same columns, nothing missing, nothing extra. */
function keyOf(cols: ColumnInfo[], pk: Row): Row {
  const keys = pkNames(cols)
  if (keys.length === 0)
    throw new DbError(
      'NO_PK',
      'La tabla no tiene clave primaria: no se edita desde el panel.',
    )
  const given = Object.keys(pk).sort().join(',')
  if (given !== [...keys].sort().join(','))
    throw new DbError('BAD_INPUT', `La clave tiene que ser ${keys.join(', ')}.`)
  const out: Row = {}
  for (const k of keys) {
    const v = pk[k]
    if (v === null || v === undefined || v === '')
      throw new DbError('BAD_INPUT', `Falta la clave ${k}.`)
    out[k] = String(v)
  }
  return out
}

/** Human key for targets and for the delete confirmation: `ubicacion#1` or `consulta_ubicacion#1234,2`. */
export function rowLabel(table: string, cols: ColumnInfo[], pk: Row): string {
  return `${table}#${pkNames(cols)
    .map((k) => pk[k])
    .join(',')}`
}

/**
 * Turns the values the UI sends into the writes to do. Drops the mask (an untouched secret), refuses secrets, generated
 * columns and unknown names, and validates each value against its column kind and enum.
 */
export function checkValues(cols: ColumnInfo[], values: Row): Row {
  const out: Row = {}
  for (const name of Object.keys(values)) {
    assertKnown(
      name,
      cols.map((c) => c.name),
      'la columna',
    )
    const c = cols.find((x) => x.name === name) as ColumnInfo
    const raw = values[name]
    if (c.secret) {
      if (raw === MASK) continue
      throw new DbError(
        'BAD_INPUT',
        'Las columnas protegidas no se editan desde el panel.',
      )
    }
    if (c.extra && /GENERATED/i.test(c.extra))
      throw new DbError('BAD_INPUT', `${name} se calcula sola y no se escribe.`)
    if (raw === null || raw === undefined) {
      out[name] = null
      continue
    }
    const v = typeof raw === 'boolean' ? (raw ? '1' : '0') : String(raw)
    if (c.enumValues.length && !c.enumValues.includes(v))
      throw new DbError(
        'BAD_INPUT',
        `${name}: el valor no está entre las opciones.`,
      )
    literal(v, c.kind) // throws BAD_INPUT when the text does not fit the kind
    out[name] = v
  }
  return out
}

export function diffRow(current: Row, next: Row): Row {
  const changes: Row = {}
  for (const name of Object.keys(next)) {
    if ((current[name] ?? null) !== (next[name] ?? null))
      changes[name] = next[name] ?? null
  }
  return changes
}

/** Runs `fn`, then audits it as ok or failed. Audit holds the error code only, never the message (it may echo data). */
async function audited<T>(
  ctx: Ctx,
  action: string,
  target: string,
  detail: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const out = await fn()
    audit(ctx.db, ctx.user, action, target, detail, true)
    return out
  } catch (err) {
    const code = err instanceof DbError ? err.code : 'ERROR'
    audit(ctx.db, ctx.user, action, target, { ...detail, error: code }, false)
    throw err
  }
}

/** Upsert by PK: updates the columns that changed, or inserts the row when the key is new. */
export async function upsertRow(
  ctx: Ctx,
  client: DbClient,
  table: string,
  pk: Row,
  values: Row,
): Promise<'insert' | 'update' | 'none'> {
  const { name, cols } = await tableColumns(client, table)
  const key = keyOf(cols, pk)
  const writes = checkValues(cols, values)
  for (const k of pkNames(cols)) {
    if (k in writes && writes[k] !== key[k])
      throw new DbError(
        'BAD_INPUT',
        'La clave primaria no se cambia desde la fila.',
      )
    delete writes[k]
  }
  const target = rowLabel(name, cols, key)
  const current = await client.findRow(name, cols, key)
  if (!current) {
    await audited(
      ctx,
      'db.row.insert',
      target,
      { table: name, pk: key, changed: Object.keys(writes) },
      () => client.insert(name, cols, { ...key, ...writes }),
    )
    return 'insert'
  }
  const changes = diffRow(current, writes)
  if (Object.keys(changes).length === 0) return 'none'
  await audited(
    ctx,
    'db.row.update',
    target,
    { table: name, pk: key, changed: Object.keys(changes) },
    () => client.update(name, cols, key, changes),
  )
  return 'update'
}

export async function insertRow(
  ctx: Ctx,
  client: DbClient,
  table: string,
  values: Row,
): Promise<void> {
  const { name, cols } = await tableColumns(client, table)
  const writes = checkValues(cols, values)
  await audited(
    ctx,
    'db.row.insert',
    name,
    { table: name, changed: Object.keys(writes) },
    () => client.insert(name, cols, writes),
  )
}

export async function deleteRow(
  ctx: Ctx,
  client: DbClient,
  table: string,
  pk: Row,
  confirm: string,
): Promise<void> {
  const { name, cols } = await tableColumns(client, table)
  const key = keyOf(cols, pk)
  const expected = rowLabel(name, cols, key)
  if (confirm !== expected)
    throw new DbError(
      'CONFIRM_REQUIRED',
      `Para borrar, escribí exactamente "${expected}".`,
    )
  await audited(ctx, 'db.row.delete', expected, { table: name, pk: key }, () =>
    client.remove(name, cols, key),
  )
}

/** Console read: one statement, read-only, row-capped; secret-named columns are masked in the result. */
export async function query(
  client: DbClient,
  sql: string,
): Promise<QueryResult> {
  const c = classifyStatement(sql)
  if (!c.ok) throw new DbError('BAD_INPUT', c.reason)
  if (c.kind !== 'read')
    throw new DbError(
      'READ_ONLY',
      'La consola de lectura no escribe. Para cambiar datos, activá la escritura (solo admin).',
    )
  // Masking works on result column names, so a protected column named in the statement (even aliased) is refused.
  if (c.idents.some((i) => isSecretName(i)))
    throw new DbError(
      'BAD_INPUT',
      'La consola no lee columnas protegidas (contraseñas, tokens, hashes).',
    )
  const rs = await client.raw(c.sql, { write: false, limit: QUERY_LIMIT + 1 })
  const truncated = rs.rows.length > QUERY_LIMIT
  const masked = rs.columns.map((col) => isSecretName(col))
  const rows = rs.rows
    .slice(0, QUERY_LIMIT)
    .map((r) => r.map((v, i) => (masked[i] && v !== null ? MASK : v)))
  return { columns: rs.columns, rows, truncated, verb: c.verb }
}

/** Console write. Admin check and confirmation are the caller's; this dumps first and fails closed if the dump fails. */
export async function execute(
  ctx: Ctx,
  client: DbClient,
  sql: string,
  target: DumpTarget,
): Promise<ExecResult> {
  const c = classifyStatement(sql)
  if (!c.ok) throw new DbError('BAD_INPUT', c.reason)
  if (c.kind !== 'write')
    throw new DbError(
      'BAD_INPUT',
      'Esta sentencia es de lectura: usá la consola de lectura.',
    )

  const dumpFile = dumpFileName(target.now(), target.dbName)
  await writeDump(target.dir, dumpFile, await client.dump())
  await pruneDumps(target.dir)

  await audited(
    ctx,
    'db.execute',
    c.verb,
    { verb: c.verb, sql: c.redacted, dump: dumpFile },
    () => client.raw(c.sql, { write: true, limit: QUERY_LIMIT }),
  )
  return { verb: c.verb, dumpFile }
}
