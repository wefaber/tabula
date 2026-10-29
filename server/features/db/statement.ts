// Pure SQL statement classifier for the console. It does not try to understand SQL: it lexes just enough to find
// strings, quoted identifiers and bare words, and then applies an allow-list. Anything it cannot be sure about is
// rejected. Reasons are user-facing (rioplatense).
//
// Rejected outright: comments of any kind (they can hide a statement from one parser and not another), a backslash
// outside a string (the mariadb client runs `\!` as a shell command), control characters, an unterminated string,
// more than one statement, and file access (INTO OUTFILE / DUMPFILE, LOAD_FILE, LOAD DATA).

import { wellFormed } from './sqlSafe'

export type StatementKind = 'read' | 'write'

export type Classified =
  | {
      ok: true
      kind: StatementKind
      /** First keyword, uppercase. */
      verb: string
      /** The statement without its trailing semicolon. */
      sql: string
      /** Literals replaced by `?`, collapsed and truncated: safe for the audit log. */
      redacted: string
      /** Lowercase bare words and quoted identifiers, in order. */
      idents: string[]
    }
  | { ok: false; reason: string }

export const MAX_STATEMENT_LENGTH = 20_000

const READ_VERBS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'])

const NEVER = new Set([
  'OUTFILE',
  'DUMPFILE',
  'INFILE',
  'LOAD_FILE',
  'SLEEP',
  'BENCHMARK',
  'GET_LOCK',
  'RELEASE_LOCK',
  'RELEASE_ALL_LOCKS',
  'IS_FREE_LOCK',
  'IS_USED_LOCK',
  'NEXTVAL',
  'SETVAL',
])

/** Extra for reads: anything that writes into a variable/file or executes what it explains. */
const NEVER_IN_READ = new Set(['INTO', 'ANALYZE', 'PROCEDURE', 'LOAD'])

const CREATE_OBJECTS = new Set([
  'TABLE',
  'TEMPORARY',
  'INDEX',
  'UNIQUE',
  'FULLTEXT',
  'SPATIAL',
  'VIEW',
])
const ALTER_OBJECTS = new Set(['TABLE', 'IGNORE', 'ONLINE'])
const DROP_OBJECTS = new Set(['TABLE', 'TEMPORARY', 'INDEX', 'VIEW'])
const WRITE_VERBS = new Set([
  'INSERT',
  'REPLACE',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'CREATE',
  'ALTER',
  'DROP',
  'RENAME',
])

interface Scan {
  words: string[]
  idents: string[]
  redacted: string
  body: string
}

const isSpace = (c: string) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r'
const isWordStart = (c: string) =>
  /[A-Za-z_$]/.test(c) || c.charCodeAt(0) >= 0x80
const isWordPart = (c: string) =>
  /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) >= 0x80

/** Returns the lexed statement, or a rejection reason. */
function scan(sql: string): Scan | string {
  const words: string[] = []
  const idents: string[] = []
  let redacted = ''
  let semicolonAt = -1
  let i = 0
  while (i < sql.length) {
    const c = sql[i] as string
    const code = c.charCodeAt(0)
    if (semicolonAt >= 0 && !isSpace(c))
      return 'Hay más de una sentencia. Mandá de a una, sin ";" en el medio.'
    if (isSpace(c)) {
      redacted += ' '
      i++
      continue
    }
    if (code < 0x20 || code === 0x7f)
      return 'La sentencia tiene caracteres de control.'
    if (c === "'" || c === '"') {
      let j = i + 1
      for (;;) {
        if (j >= sql.length) return 'Hay un texto entre comillas sin cerrar.'
        const d = sql[j] as string
        if (d === '\\') {
          j += 2
          continue
        }
        if (d === c) {
          if (sql[j + 1] === c) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      redacted += "'?'"
      i = j + 1
      continue
    }
    if (c === '`') {
      let j = i + 1
      let name = ''
      for (;;) {
        if (j >= sql.length) return 'Hay un nombre entre comillas sin cerrar.'
        const d = sql[j] as string
        if (d === '`') {
          if (sql[j + 1] === '`') {
            name += '`'
            j += 2
            continue
          }
          break
        }
        name += d
        j++
      }
      idents.push(name.toLowerCase())
      redacted += `\`${name.replaceAll('`', '``')}\``
      i = j + 1
      continue
    }
    if (
      c === '#' ||
      (c === '-' && sql[i + 1] === '-') ||
      (c === '/' && sql[i + 1] === '*')
    )
      return 'No se admiten comentarios en la sentencia.'
    if (c === '\\') return 'No se admite "\\" fuera de un texto entre comillas.'
    if (c === ';') {
      semicolonAt = i
      i++
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1
      while (j < sql.length && /[A-Za-z0-9_.]/.test(sql[j] as string)) j++
      redacted += '?'
      i = j
      continue
    }
    if (isWordStart(c)) {
      let j = i + 1
      while (j < sql.length && isWordPart(sql[j] as string)) j++
      const word = sql.slice(i, j)
      words.push(word.toUpperCase())
      idents.push(word.toLowerCase())
      redacted += word
      i = j
      continue
    }
    redacted += c
    i++
  }
  const body = semicolonAt >= 0 ? sql.slice(0, semicolonAt) : sql
  return { words, idents, redacted, body: body.trim() }
}

function hasPair(words: string[], a: string, b: string): boolean {
  return words.some((w, i) => w === a && words[i + 1] === b)
}

/** Classifies one statement. Pure: no I/O. */
export function classifyStatement(input: string): Classified {
  const fail = (reason: string): Classified => ({ ok: false, reason })
  if (typeof input !== 'string' || input.trim() === '')
    return fail('Escribí una sentencia.')
  if (input.length > MAX_STATEMENT_LENGTH)
    return fail(
      `La sentencia es demasiado larga (máximo ${MAX_STATEMENT_LENGTH} caracteres).`,
    )
  const scanned = scan(wellFormed(input))
  if (typeof scanned === 'string') return fail(scanned)
  const { words, idents, body } = scanned
  const verb = words[0]
  if (!verb) return fail('Escribí una sentencia.')

  for (const w of words) if (NEVER.has(w)) return fail(`No se admite ${w}.`)

  const preview = scanned.redacted.replace(/\s+/g, ' ').trim().slice(0, 200)
  const ok = (kind: StatementKind): Classified => ({
    ok: true,
    kind,
    verb,
    sql: body,
    redacted: preview,
    idents,
  })

  if (READ_VERBS.has(verb)) {
    for (const w of words)
      if (NEVER_IN_READ.has(w))
        return fail(`No se admite ${w} en una consulta de lectura.`)
    if (hasPair(words, 'FOR', 'UPDATE') || hasPair(words, 'LOCK', 'IN'))
      return fail('Una consulta de lectura no puede bloquear filas.')
    if (hasPair(words, 'NEXT', 'VALUE'))
      return fail('NEXT VALUE cambia una secuencia.')
    return ok('read')
  }

  if (!WRITE_VERBS.has(verb))
    return fail(
      `${verb} no está permitido. Se admiten SELECT, SHOW, DESCRIBE y EXPLAIN (lectura) e INSERT, UPDATE, DELETE, REPLACE, TRUNCATE, CREATE/ALTER/DROP TABLE|INDEX|VIEW y RENAME TABLE (escritura).`,
    )

  let rest = words.slice(1)
  if (verb === 'CREATE' && rest[0] === 'OR' && rest[1] === 'REPLACE')
    rest = rest.slice(2)
  const next = rest[0] ?? ''
  const shape =
    verb === 'CREATE'
      ? CREATE_OBJECTS.has(next)
      : verb === 'ALTER'
        ? ALTER_OBJECTS.has(next)
        : verb === 'DROP'
          ? DROP_OBJECTS.has(next)
          : verb === 'RENAME'
            ? next === 'TABLE'
            : true
  if (!shape)
    return fail(
      `${verb} ${next || '(vacío)'} no está permitido: solo tablas, índices y vistas.`,
    )
  return ok('write')
}
