import { describe, expect, test } from 'bun:test'
import { DbError } from '../errors'
import {
  assertKnown,
  escapeLike,
  escapeString,
  likeContains,
  literal,
  quoteIdent,
  quoteString,
  wellFormed,
} from '../sqlSafe'

/** Reads a MariaDB string literal body back (default sql_mode, backslash escapes). Test oracle only. */
function unescapeMySql(body: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string
    if (c === '\\') {
      const n = body[++i] as string
      const map: Record<string, string> = {
        '0': '\0',
        b: '\b',
        n: '\n',
        r: '\r',
        t: '\t',
        Z: '\x1a',
      }
      out += map[n] ?? n
    } else if (c === "'" && body[i + 1] === "'") {
      out += "'"
      i++
    } else {
      out += c
    }
  }
  return out
}

const roundTrip = (v: string) => unescapeMySql(quoteString(v).slice(1, -1))

const HOSTILE = [
  '',
  'plain',
  "O'Brien",
  "'; DROP TABLE usuario; --",
  'a\\b',
  'trailing backslash \\',
  "\\'",
  '"double"',
  'nul\0byte',
  'line\nbreak\r\nand\ttab',
  'ctrl-Z \x1a end',
  'backspace\b',
  'ñandú 🙂 日本語',
  '%_ wildcards',
  '`backtick`',
  '\\0 literal backslash zero',
  'x'.repeat(5000),
]

describe('quoteIdent', () => {
  test('backtick-quotes and doubles embedded backticks', () => {
    expect(quoteIdent('usuario')).toBe('`usuario`')
    expect(quoteIdent('we`ird')).toBe('`we``ird`')
  })
  test('refuses empty, NUL, padded and over-long names', () => {
    expect(() => quoteIdent('')).toThrow(DbError)
    expect(() => quoteIdent('a\0b')).toThrow(DbError)
    expect(() => quoteIdent(' padded')).toThrow(DbError)
    expect(() => quoteIdent('x'.repeat(65))).toThrow('demasiado largo')
  })
})

describe('assertKnown', () => {
  test('accepts only names from the allow-list, exact match', () => {
    const allowed = ['usuario', 'ubicacion']
    expect(assertKnown('usuario', allowed)).toBe('usuario')
    expect(() => assertKnown('Usuario', allowed)).toThrow('No existe')
    expect(() => assertKnown('usuario; DROP', allowed)).toThrow(DbError)
  })
  test('the rejection message does not echo control characters', () => {
    try {
      assertKnown('a\x00\n<script>', ['x'])
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as DbError).message).not.toContain('\n')
      expect((err as DbError).message).not.toContain('\0')
    }
  })
})

describe('escapeString / quoteString', () => {
  test.each(HOSTILE)('round-trips %p through a literal', (v) => {
    expect(roundTrip(v)).toBe(v)
  })

  test('quote and backslash are escaped', () => {
    expect(escapeString("it's")).toBe("it\\'s")
    expect(escapeString('a\\b')).toBe('a\\\\b')
    expect(escapeString('"')).toBe('\\"')
  })

  test('NUL and control characters become escapes, not raw bytes', () => {
    expect(escapeString('\0')).toBe('\\0')
    expect(escapeString('\n\r\t')).toBe('\\n\\r\\t')
    expect(escapeString('\x1a')).toBe('\\Z')
    expect(escapeString('\b')).toBe('\\b')
    expect(quoteString('a\0b')).not.toContain('\0')
  })

  test('unicode passes through untouched', () => {
    expect(escapeString('ñ 🙂 日本')).toBe('ñ 🙂 日本')
  })

  test('lone surrogates are replaced by U+FFFD (never invalid UTF-8)', () => {
    expect(wellFormed('a\uD800b')).toBe('a�b')
    expect(wellFormed('\uDC00')).toBe('�')
    expect(wellFormed('🙂')).toBe('🙂')
    expect(escapeString('a\uD800b')).toBe('a�b')
  })

  test('a value that tries to close the literal stays inside it', () => {
    const sql = quoteString("x' OR '1'='1")
    expect(sql).toBe("'x\\' OR \\'1\\'=\\'1'")
  })

  test('refuses values over the length cap', () => {
    expect(() => escapeString('x'.repeat(60_001))).toThrow('demasiado largo')
  })
})

describe('LIKE escaping', () => {
  test('wildcards and backslash match literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
    expect(unescapeMySql(likeContains('a%b').slice(1, -1))).toBe('%a\\%b%')
  })
})

describe('literal', () => {
  test('null and undefined are NULL for every kind', () => {
    for (const k of [
      'number',
      'string',
      'date',
      'datetime',
      'time',
      'year',
      'json',
    ] as const) {
      expect(literal(null, k)).toBe('NULL')
      expect(literal(undefined, k)).toBe('NULL')
    }
  })

  test('numbers: accepted as numbers or numeric text, rejected otherwise', () => {
    expect(literal(42, 'number')).toBe('42')
    expect(literal(-3.5, 'number')).toBe('-3.5')
    expect(literal('  +7 ', 'number')).toBe('7')
    expect(literal('1e3', 'number')).toBe('1e3')
    expect(literal(true, 'number')).toBe('1')
    expect(() => literal('1; DROP TABLE x', 'number')).toThrow(DbError)
    expect(() => literal('NaN', 'number')).toThrow(DbError)
    expect(() => literal(Number.NaN, 'number')).toThrow(DbError)
    expect(() => literal('', 'number')).toThrow(DbError)
  })

  test('dates and times: strict shapes only', () => {
    expect(literal('2026-10-19', 'date')).toBe("'2026-10-19'")
    expect(() => literal('2026-13-01', 'date')).toThrow(DbError)
    expect(() => literal('19/10/2026', 'date')).toThrow(DbError)
    expect(literal('2026-10-19T21:22:59', 'datetime')).toBe(
      "'2026-10-19 21:22:59'",
    )
    expect(literal('2026-10-19 21:22:59.123', 'datetime')).toBe(
      "'2026-10-19 21:22:59.123'",
    )
    expect(() => literal('2026-10-19', 'datetime')).toThrow(DbError)
    expect(literal('08:30:00', 'time')).toBe("'08:30:00'")
    expect(() => literal('8am', 'time')).toThrow(DbError)
    expect(literal('2026', 'year')).toBe("'2026'")
    expect(() => literal('26', 'year')).toThrow(DbError)
  })

  test('text and json: escaped, numbers and booleans stringified', () => {
    expect(literal("O'Brien", 'string')).toBe("'O\\'Brien'")
    expect(literal(12, 'string')).toBe("'12'")
    expect(() => literal({ a: 1 }, 'string')).toThrow(DbError)
  })

  test('binary columns cannot be written from the panel', () => {
    expect(() => literal('0x00', 'binary')).toThrow(DbError)
  })
})
