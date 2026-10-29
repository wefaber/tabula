// In-memory database for the fixture mode (local dev and tests). Two small tables shaped like the Gravida schema: one
// plain, one with a secret column so masking can be seen. It does not parse SQL: the console answers only `SHOW TABLES`
// and `SELECT * FROM <table>`, and writes from the console are accepted and ignored.
import { columnFromRow, type ColumnInfo, type Row } from './columns'
import { DbError } from './errors'
import { filterSql } from './queries'
import type { DbClient } from './client'
import type { ResultSet } from './xml'
import { quoteIdent } from './sqlSafe'

interface Table {
  cols: ColumnInfo[]
  rows: Row[]
}

const pkNames = (cols: ColumnInfo[]) =>
  cols.filter((c) => c.key === 'PRI').map((c) => c.name)

function seed(): Record<string, Table> {
  return {
    ubicacion: {
      cols: [
        columnFromRow([
          'id_ubicacion',
          'int(11)',
          'int',
          'NO',
          'PRI',
          null,
          'auto_increment',
        ]),
        columnFromRow([
          'seccion_inventario',
          'varchar(100)',
          'varchar',
          'NO',
          '',
          null,
          '',
        ]),
        columnFromRow([
          'esta_activa',
          'tinyint(1)',
          'tinyint',
          'NO',
          '',
          '1',
          '',
        ]),
      ],
      rows: [
        {
          id_ubicacion: '1',
          seccion_inventario: 'Laboratorio 1',
          esta_activa: '1',
        },
        {
          id_ubicacion: '2',
          seccion_inventario: 'Laboratorio 2',
          esta_activa: '0',
        },
      ],
    },
    usuario: {
      cols: [
        columnFromRow([
          'cedula',
          'varchar(15)',
          'varchar',
          'NO',
          'PRI',
          null,
          '',
        ]),
        columnFromRow(['nombre', 'varchar(80)', 'varchar', 'NO', '', null, '']),
        columnFromRow([
          'correo_electronico',
          'varchar(150)',
          'varchar',
          'NO',
          'UNI',
          null,
          '',
        ]),
        columnFromRow([
          'contrasena',
          'varchar(255)',
          'varchar',
          'NO',
          '',
          null,
          '',
        ]),
        columnFromRow([
          'rol',
          "enum('Administrador','Tecnico_Asistente','Solicitante')",
          'enum',
          'NO',
          '',
          'Solicitante',
          '',
        ]),
      ],
      rows: [
        {
          cedula: '1234567',
          nombre: 'Ana Pérez',
          correo_electronico: 'ana@example.test',
          contrasena: '$2y$10$fixtureHashFixtureHashFixtureHashFixtureHashAAAA',
          rol: 'Administrador',
        },
        {
          cedula: '7654321',
          nombre: "Luis O'Brien",
          correo_electronico: 'luis@example.test',
          contrasena: '$2y$10$fixtureHashFixtureHashFixtureHashFixtureHashBBBB',
          rol: 'Solicitante',
        },
      ],
    },
  }
}

export function fixtureDb(): DbClient {
  const tables = seed()
  const table = (name: string): Table => {
    const t = tables[name]
    if (!t) throw new DbError('BAD_INPUT', `No existe la tabla "${name}".`)
    return t
  }
  const keyEq = (row: Row, pk: Row, keys: string[]) =>
    keys.every((k) => String(row[k]) === String(pk[k]))
  const findIndex = (t: Table, pk: Row) => {
    const keys = pkNames(t.cols)
    return t.rows.findIndex((r) => keyEq(r, pk, keys))
  }
  const copy = (r: Row): Row => ({ ...r })
  const matches = (t: Table, filter: string): Row[] => {
    const term = filter.trim().toLowerCase()
    if (!term) return t.rows
    filterSql(t.cols, filter) // same length check as the real builder
    const searchable = t.cols.filter((c) => c.kind !== 'binary' && !c.secret)
    return t.rows.filter((r) =>
      searchable.some((c) =>
        String(r[c.name] ?? '')
          .toLowerCase()
          .includes(term),
      ),
    )
  }
  const sortByKey = (rows: Row[], cols: ColumnInfo[]) => {
    const keys = pkNames(cols)
    const use = keys.length ? keys : cols.slice(0, 1).map((c) => c.name)
    return [...rows].sort((a, b) =>
      use
        .map((k) => String(a[k] ?? ''))
        .join('\u0000')
        .localeCompare(use.map((k) => String(b[k] ?? '')).join('\u0000'), 'es'),
    )
  }

  return {
    async tables() {
      return Object.entries(tables)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, t]) => ({ name, rows: t.rows.length }))
    },

    async columns(name) {
      return tables[name]?.cols ?? []
    },

    async page(name, _cols, page) {
      const t = table(name)
      const found = matches(t, page.filter)
      const rows = sortByKey(found, t.cols)
        .slice(page.offset, page.offset + page.limit)
        .map(copy)
      return { rows, total: found.length }
    },

    async findRow(name, _cols, pk) {
      const t = table(name)
      const i = findIndex(t, pk)
      return i < 0 ? null : copy(t.rows[i] as Row)
    },

    async insert(name, cols, values) {
      const t = table(name)
      const row: Row = {}
      for (const c of cols) {
        const v = values[c.name]
        row[c.name] =
          v !== undefined
            ? v
            : c.key === 'PRI' && /auto_increment/i.test(c.extra)
              ? nextId(t)
              : c.defaultValue
      }
      const keys = pkNames(cols)
      if (keys.length && findIndex(t, row) >= 0)
        throw new DbError('DB_ERROR', `Duplicate entry for key 'PRIMARY'`)
      t.rows.push(row)
    },

    async update(name, _cols, pk, changes) {
      const t = table(name)
      const i = findIndex(t, pk)
      if (i >= 0) t.rows[i] = { ...(t.rows[i] as Row), ...changes }
    },

    async remove(name, _cols, pk) {
      const t = table(name)
      const i = findIndex(t, pk)
      if (i >= 0) t.rows.splice(i, 1)
    },

    async raw(sql, options) {
      if (options.write) return empty()
      const shown = /^\s*SHOW\s+TABLES\b/i.test(sql)
      if (shown)
        return {
          columns: ['Tables'],
          rows: Object.keys(tables).map((n) => [n]),
        }
      const m = /^\s*SELECT\s+\*\s+FROM\s+(`?)(\w+)\1\s*$/i.exec(sql)
      if (m && m[2]) {
        const t = table(m[2])
        const cols = t.cols.map((c) => c.name)
        const rows = sortByKey(t.rows, t.cols)
          .slice(0, options.limit)
          .map((r) => cols.map((c) => r[c] ?? null))
        return { columns: cols, rows }
      }
      return {
        columns: ['fixture'],
        rows: [
          [
            'La consola del fixture solo entiende SHOW TABLES y SELECT * FROM <tabla>.',
          ],
        ],
      }
    },

    async dump() {
      return `-- fixture dump ${new Date().toISOString()}\n-- tables: ${Object.keys(
        tables,
      )
        .map((n) => quoteIdent(n))
        .join(', ')}\n`
    },
  }
}

function empty(): ResultSet {
  return { columns: [], rows: [] }
}

function nextId(t: Table): string {
  const max = t.rows.reduce((m, r) => {
    const v = Number(Object.values(r)[0])
    return Number.isFinite(v) && v > m ? v : m
  }, 0)
  return String(max + 1)
}
