// Pure parser for `mariadb --xml` output. XML (unlike --batch) tells NULL apart from the text "NULL" and keeps tabs and
// newlines inside values. The client escapes & < > " in attributes and text, so a value never contains a literal "<":
// the tag regexes below cannot be fooled by data, including the echoed `statement="..."` attribute.

export interface ResultSet {
  columns: string[]
  rows: (string | null)[][]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x'
            ? Number.parseInt(body.slice(2), 16)
            : Number(body.slice(1))
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      }
      return ENTITIES[body] ?? whole
    },
  )
}

const RESULTSET = /<resultset\b[^>]*>([\s\S]*?)<\/resultset>/g
const ROW = /<row>([\s\S]*?)<\/row>/g
const FIELD =
  /<field\s+name="([^"]*)"(?:\s+xsi:nil="true"\s*\/>|\s*\/>|\s*>([^<]*)<\/field>)/g

/** One entry per result set, in order. `SET` and DML statements print nothing. */
export function parseXml(stdout: string): ResultSet[] {
  const sets: ResultSet[] = []
  for (const rs of stdout.matchAll(RESULTSET)) {
    const columns: string[] = []
    const rows: (string | null)[][] = []
    for (const row of (rs[1] ?? '').matchAll(ROW)) {
      const values: (string | null)[] = []
      const names: string[] = []
      for (const f of (row[1] ?? '').matchAll(FIELD)) {
        names.push(decodeEntities(f[1] ?? ''))
        values.push(
          f[0].includes('xsi:nil="true"') ? null : decodeEntities(f[2] ?? ''),
        )
      }
      if (columns.length === 0) columns.push(...names)
      rows.push(values)
    }
    sets.push({ columns, rows })
  }
  return sets
}

/** The last result set (what the caller's own statement printed after the session `SET`s), or an empty one. */
export function lastResult(stdout: string): ResultSet {
  const sets = parseXml(stdout)
  return sets[sets.length - 1] ?? { columns: [], rows: [] }
}
