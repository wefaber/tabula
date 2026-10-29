// Pure SQL value/identifier safety. Nothing here touches the network or the clock. Every value that reaches a
// statement goes through `literal`; every identifier through `assertKnown` (checked against information_schema by the
// caller) and then `quoteIdent`. The statements run with sql_mode stripped of NO_BACKSLASH_ESCAPES/ANSI_QUOTES, so
// backslash escaping below is the contract with the server.
import { DbError } from './errors'

export type ValueKind =
  | 'number'
  | 'string'
  | 'date'
  | 'datetime'
  | 'time'
  | 'year'
  | 'json'
  | 'binary'

export const MAX_IDENT = 64
export const MAX_VALUE_LENGTH = 60_000

const bad = (message: string): never => {
  throw new DbError('BAD_INPUT', message)
}

/** Backtick-quotes an identifier. Callers must have checked it against information_schema first. */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0)
    return bad('Identificador vacío.')
  if (name.length > MAX_IDENT)
    return bad(`Identificador demasiado largo (máximo ${MAX_IDENT}).`)
  if (name.includes('\0')) return bad('Identificador inválido.')
  if (name !== name.trim()) return bad('Identificador inválido.')
  return `\`${name.replaceAll('`', '``')}\``
}

/** Returns `name` when it is one of `allowed`, else throws. The allowed list comes from information_schema. */
export function assertKnown(
  name: string,
  allowed: Iterable<string>,
  what = 'identificador',
): string {
  for (const candidate of allowed) if (candidate === name) return name
  return bad(`No existe ${what} "${shorten(String(name))}".`)
}

function shorten(s: string): string {
  const clean = s.replace(/[^\p{L}\p{N}_$ .-]/gu, '?')
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean
}

// Each entry maps the raw character to its two-character SQL escape (backslash + letter/char).
const ESCAPES: Record<string, string> = {
  '\0': '\\0',
  '\b': '\\b',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\x1a': '\\Z',
  '\\': '\\\\',
  "'": "\\'",
  '"': '\\"',
}

/** Replaces lone surrogates with U+FFFD (what `String.prototype.toWellFormed` does; the lib target predates it). */
export function wellFormed(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '�',
  )
}

/** Escapes text for use inside a single- or double-quoted literal (no surrounding quotes). */
export function escapeString(value: string): string {
  if (typeof value !== 'string') return bad('Se esperaba texto.')
  if (value.length > MAX_VALUE_LENGTH)
    return bad(`Valor demasiado largo (máximo ${MAX_VALUE_LENGTH} caracteres).`)
  return wellFormed(value).replace(
    // oxlint-disable-next-line no-control-regex -- the control characters are the point: they get escaped
    /[\0\b\n\r\t\x1a\\'"]/g,
    (c) => ESCAPES[c] ?? c,
  )
}

export function quoteString(value: string): string {
  return `'${escapeString(value)}'`
}

/** Escapes LIKE wildcards so the term matches literally. Run `escapeString` on the result afterwards. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** `'%term%'`, literal match, ready to embed. */
export function likeContains(term: string): string {
  return quoteString(`%${escapeLike(term)}%`)
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const TIME = /^-?\d{1,3}:[0-5]\d:[0-5]\d(\.\d{1,6})?$/
const DATETIME =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[ T]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?$/
const YEAR = /^\d{4}$/

/** SQL literal for `value` given the column kind. `null` → NULL. Throws BAD_INPUT when the value does not fit. */
export function literal(value: unknown, kind: ValueKind): string {
  if (value === null || value === undefined) return 'NULL'
  switch (kind) {
    case 'number': {
      if (typeof value === 'boolean') return value ? '1' : '0'
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) return bad('Número inválido.')
        return String(value)
      }
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'string') {
        const t = value.trim()
        if (!NUMBER.test(t)) return bad('Se esperaba un número.')
        return t.startsWith('+') ? t.slice(1) : t
      }
      return bad('Se esperaba un número.')
    }
    case 'date':
      return quoteMatching(value, DATE, 'una fecha AAAA-MM-DD')
    case 'datetime':
      return quoteMatching(
        typeof value === 'string' ? value.trim().replace('T', ' ') : value,
        DATETIME,
        'fecha y hora AAAA-MM-DD HH:MM:SS',
      )
    case 'time':
      return quoteMatching(value, TIME, 'una hora HH:MM:SS')
    case 'year':
      return quoteMatching(value, YEAR, 'un año de 4 dígitos')
    case 'json':
    case 'string': {
      if (typeof value === 'string') return quoteString(value)
      if (typeof value === 'number' || typeof value === 'boolean')
        return quoteString(String(value))
      return bad('Se esperaba texto.')
    }
    case 'binary':
      return bad('Las columnas binarias no se editan desde el panel.')
  }
}

function quoteMatching(value: unknown, re: RegExp, what: string): string {
  if (typeof value !== 'string' || !re.test(value.trim()))
    return bad(`Se esperaba ${what}.`)
  return quoteString(value.trim())
}
