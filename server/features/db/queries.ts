// Pure SQL builders for the editor. The service checks identifiers against information_schema before calling these;
// here every identifier is quoted with `quoteIdent` and every value goes through `literal` with its column's kind.
import { isGenerated, type ColumnInfo, type Row } from './columns'
import { DbError } from './errors'
import {
  assertKnown,
  likeContains,
  literal,
  quoteIdent,
  quoteString,
} from './sqlSafe'

export const MAX_FILTER = 100

const q = (name: string) => quoteIdent(name)
const pkCols = (cols: ColumnInfo[]) => cols.filter((c) => c.key === 'PRI')
const names = (cols: ColumnInfo[]) => cols.map((c) => c.name)

export function columnsSql(schema: string, table: string): string {
  return `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${quoteString(schema)} AND TABLE_NAME = ${quoteString(table)} ORDER BY ORDINAL_POSITION`
}

export function tablesSql(schema: string): string {
  return `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quoteString(schema)} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
}

/** One `UNION ALL` branch per table: `name, n`. The names come from information_schema. */
export function countsSql(tables: string[]): string {
  if (tables.length === 0)
    return 'SELECT 1 AS name, 0 AS n FROM DUAL WHERE 1 = 0'
  return tables
    .map((t) => `SELECT ${quoteString(t)} AS name, COUNT(*) AS n FROM ${q(t)}`)
    .join(' UNION ALL ')
}

/** Binary values are not shown; a marker says whether the cell is empty. */
const selectExpr = (c: ColumnInfo) =>
  c.kind === 'binary'
    ? `IF(${q(c.name)} IS NULL, NULL, '(binario)') AS ${q(c.name)}`
    : q(c.name)

/** Columns the text filter searches: never binary, never secrets (a LIKE on a hash is a password oracle). */
const searchable = (cols: ColumnInfo[]) =>
  cols.filter((c) => c.kind !== 'binary' && !c.secret)

export function filterSql(cols: ColumnInfo[], term: string): string {
  const t = term.trim()
  if (!t) return ''
  if (t.length > MAX_FILTER)
    throw new DbError(
      'BAD_INPUT',
      `El filtro tiene hasta ${MAX_FILTER} caracteres.`,
    )
  const pattern = likeContains(t)
  const parts = searchable(cols).map(
    (c) => `CAST(${q(c.name)} AS CHAR) LIKE ${pattern}`,
  )
  return parts.length ? ` WHERE (${parts.join(' OR ')})` : ' WHERE 1 = 0'
}

const orderBy = (cols: ColumnInfo[]) => {
  const keys = pkCols(cols)
  return (keys.length ? keys : cols.slice(0, 1))
    .map((c) => q(c.name))
    .join(', ')
}

const nonNegative = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new DbError('BAD_INPUT', `${what} inválido.`)
  return n
}

export function selectPageSql(
  table: string,
  cols: ColumnInfo[],
  page: { filter: string; offset: number; limit: number },
): string {
  if (cols.length === 0)
    throw new DbError('BAD_INPUT', 'La tabla no tiene columnas.')
  const limit = nonNegative(page.limit, 'El tamaño de página')
  const offset = nonNegative(page.offset, 'El desplazamiento')
  return `SELECT ${cols.map(selectExpr).join(', ')} FROM ${q(table)}${filterSql(cols, page.filter)} ORDER BY ${orderBy(cols)} LIMIT ${limit} OFFSET ${offset}`
}

export function countRowsSql(
  table: string,
  cols: ColumnInfo[],
  filter: string,
): string {
  return `SELECT COUNT(*) AS n FROM ${q(table)}${filterSql(cols, filter)}`
}

/** `col = value AND ...` over the primary key. Refuses tables without one and incomplete keys. */
export function pkWhere(cols: ColumnInfo[], pk: Row): string {
  const keys = pkCols(cols)
  if (keys.length === 0)
    throw new DbError(
      'NO_PK',
      'La tabla no tiene clave primaria: solo se puede consultar.',
    )
  return keys
    .map((c) => {
      const v = pk[c.name]
      if (v === undefined || v === null)
        throw new DbError('BAD_INPUT', `Falta la clave ${c.name}.`)
      return `${q(c.name)} = ${literal(v, c.kind)}`
    })
    .join(' AND ')
}

export function findRowSql(table: string, cols: ColumnInfo[], pk: Row): string {
  return `SELECT ${cols.map(selectExpr).join(', ')} FROM ${q(table)} WHERE ${pkWhere(cols, pk)} LIMIT 1`
}

/** Checks every key is a real column and none is generated; returns the columns to write, in table order. */
function writable(cols: ColumnInfo[], values: Row): ColumnInfo[] {
  for (const n of Object.keys(values)) assertKnown(n, names(cols), 'la columna')
  const picked = cols.filter((c) => values[c.name] !== undefined)
  for (const c of picked)
    if (isGenerated(c))
      throw new DbError(
        'BAD_INPUT',
        `${c.name} se calcula sola y no se escribe.`,
      )
  return picked
}

export function insertSql(
  table: string,
  cols: ColumnInfo[],
  values: Row,
): string {
  const picked = writable(cols, values)
  return `INSERT INTO ${q(table)} (${picked.map((c) => q(c.name)).join(', ')}) VALUES (${picked.map((c) => literal(values[c.name], c.kind)).join(', ')})`
}

export function updateSql(
  table: string,
  cols: ColumnInfo[],
  pk: Row,
  changes: Row,
): string {
  if (Object.keys(changes).length === 0)
    throw new DbError('BAD_INPUT', 'No hay cambios para guardar.')
  if (pkCols(cols).some((c) => c.name in changes))
    throw new DbError(
      'BAD_INPUT',
      'La clave primaria no se cambia desde la fila.',
    )
  const sets = writable(cols, changes).map(
    (c) => `${q(c.name)} = ${literal(changes[c.name], c.kind)}`,
  )
  return `UPDATE ${q(table)} SET ${sets.join(', ')} WHERE ${pkWhere(cols, pk)} LIMIT 1`
}

export function deleteSql(table: string, cols: ColumnInfo[], pk: Row): string {
  return `DELETE FROM ${q(table)} WHERE ${pkWhere(cols, pk)} LIMIT 1`
}
