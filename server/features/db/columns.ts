// Column metadata (from information_schema) and the rules that depend on it. Pure.
import type { ValueKind } from './sqlSafe'

export interface ColumnInfo {
  name: string
  /** `COLUMN_TYPE`, e.g. `varchar(60)` or `enum('a','b')`. */
  type: string
  kind: ValueKind
  nullable: boolean
  key: 'PRI' | 'UNI' | 'MUL' | ''
  /** Raw `COLUMN_DEFAULT`; null when none or NULL. */
  defaultValue: string | null
  extra: string
  enumValues: string[]
  /** Looks like a password/hash/token: masked in the UI and kept out of the audit log. */
  secret: boolean
}

export interface TableInfo {
  name: string
  rows: number
}

export const MASK = '••••••••'

// Bare `clave` is left out on purpose: in configuracion_sistema it is the setting's key, not a password.
const SECRET_NAME =
  /(pass(word|wd)?|contrase|clave[_ ]?(acceso|secret|privad)|hash|token|secret|totp|salt|pwd|api[_-]?key|credential|private)/i

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

const NUMBER_TYPES = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'dec',
  'fixed',
  'float',
  'double',
  'real',
])
const BINARY_TYPES = new Set([
  'binary',
  'varbinary',
  'tinyblob',
  'blob',
  'mediumblob',
  'longblob',
  'bit',
])

/** Maps `DATA_TYPE` to the value kind that decides how a value is validated and quoted. */
export function kindOf(dataType: string): ValueKind {
  const t = dataType.toLowerCase()
  if (NUMBER_TYPES.has(t)) return 'number'
  if (BINARY_TYPES.has(t)) return 'binary'
  if (t === 'date') return 'date'
  if (t === 'datetime' || t === 'timestamp') return 'datetime'
  if (t === 'time') return 'time'
  if (t === 'year') return 'year'
  if (t === 'json') return 'json'
  return 'string'
}

/** `enum('a','b''c')` → ['a', "b'c"]. */
export function parseEnumValues(columnType: string): string[] {
  const m = /^(enum|set)\((.*)\)$/is.exec(columnType.trim())
  if (!m) return []
  const body = m[2] ?? ''
  const out: string[] = []
  let i = 0
  while (i < body.length) {
    if (body[i] !== "'") {
      i++
      continue
    }
    let value = ''
    i++
    for (;;) {
      const c = body[i]
      if (c === undefined) return out
      if (c === "'") {
        if (body[i + 1] === "'") {
          value += "'"
          i += 2
          continue
        }
        i++
        break
      }
      if (c === '\\' && body[i + 1] !== undefined) {
        value += body[i + 1]
        i += 2
        continue
      }
      value += c
      i++
    }
    out.push(value)
  }
  return out
}

/** Builds a ColumnInfo from one information_schema.COLUMNS row, in the order of `columnsQuery`. */
export function columnFromRow(row: (string | null)[]): ColumnInfo {
  const at = (i: number) => row[i] ?? ''
  const key = at(4)
  const name = at(0)
  return {
    name,
    type: at(1),
    kind: kindOf(at(2)),
    nullable: at(3) === 'YES',
    key: key === 'PRI' || key === 'UNI' || key === 'MUL' ? key : '',
    defaultValue: row[5] ?? null,
    extra: at(6),
    enumValues: parseEnumValues(at(1)),
    secret: isSecretName(name),
  }
}

export const pkColumns = (cols: ColumnInfo[]) =>
  cols.filter((c) => c.key === 'PRI')

/** Generated columns cannot be written. */
export const isGenerated = (c: ColumnInfo) => /GENERATED/i.test(c.extra)

export const isAutoIncrement = (c: ColumnInfo) =>
  /auto_increment/i.test(c.extra)

export type Row = Record<string, string | null>

/**
 * Masks what must not reach the browser: columns named like secrets, and the value column of a key/value table whose
 * key looks like a secret (`configuracion_sistema.clave = 'smtp_password'`).
 */
export function maskRow(cols: ColumnInfo[], row: Row): Row {
  const out: Row = { ...row }
  const keyCol = cols.find((c) => /^(clave|key|nombre|name)$/i.test(c.name))
  const valueCol = cols.find((c) => /^(valor|value)$/i.test(c.name))
  const keyIsSecret =
    keyCol && valueCol && isSecretName(String(row[keyCol.name] ?? ''))
  for (const c of cols) {
    const hide = c.secret || (keyIsSecret && c === valueCol)
    if (hide && out[c.name] !== null && out[c.name] !== undefined)
      out[c.name] = MASK
  }
  return out
}
