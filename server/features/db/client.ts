// The database behind the editor. `DbClient` is the only thing the service sees: the real implementation runs `mariadb`
// inside the `db` container through Podman exec (password in the exec env, never in argv); the fixture keeps two small
// tables in memory. The interface is typed operations plus one raw entry point for the console.
import type { PodmanClient } from '../../adapters/podman'
import {
  columnFromRow,
  type ColumnInfo,
  type Row,
  type TableInfo,
} from './columns'
import { DbError } from './errors'
import { lastResult, type ResultSet } from './xml'
import {
  columnsSql,
  countRowsSql,
  countsSql,
  deleteSql,
  findRowSql,
  insertSql,
  selectPageSql,
  tablesSql,
  updateSql,
} from './queries'

export interface RawOptions {
  write: boolean
  /** Max rows the server returns (sql_select_limit). */
  limit: number
}

export interface DbClient {
  tables(): Promise<TableInfo[]>
  columns(table: string): Promise<ColumnInfo[]>
  page(
    table: string,
    cols: ColumnInfo[],
    page: { filter: string; offset: number; limit: number },
  ): Promise<{ rows: Row[]; total: number }>
  findRow(table: string, cols: ColumnInfo[], pk: Row): Promise<Row | null>
  insert(table: string, cols: ColumnInfo[], values: Row): Promise<void>
  update(
    table: string,
    cols: ColumnInfo[],
    pk: Row,
    changes: Row,
  ): Promise<void>
  remove(table: string, cols: ColumnInfo[], pk: Row): Promise<void>
  raw(sql: string, options: RawOptions): Promise<ResultSet>
  dump(): Promise<string>
}

export interface DbConn {
  dbName: string
  dbUser: string
  dbPassword: string
}

/** Statement timeout for everything the panel runs. */
const MAX_STATEMENT_SECONDS = 10

const rowOf = (columns: string[], values: (string | null)[]): Row =>
  Object.fromEntries(columns.map((c, i) => [c, values[i] ?? null]))

/** First line of the server's stderr, without the client's `ERROR 1064 (42000) at line 1:` prefix. */
export function serverMessage(stderr: string): string {
  const line = stderr.split('\n').find((l) => l.trim()) ?? 'error desconocido'
  return line
    .replace(/^ERROR \d+ \([0-9A-Z]+\) at line \d+: /, '')
    .slice(0, 300)
}

export function mariadbClient(
  podman: PodmanClient,
  project: string,
  conn: DbConn,
): DbClient {
  async function containerId(): Promise<string> {
    const db = (await podman.list(project)).find((c) => c.service === 'db')
    if (!db || db.state !== 'running')
      throw new DbError('DB_DOWN', 'El container de la base no está corriendo.')
    return db.id
  }

  async function run(sql: string, options: RawOptions): Promise<ResultSet> {
    const id = await containerId()
    // The SETs print nothing in --xml, so the last result set is the caller's statement.
    const prelude = `SET SESSION sql_select_limit = ${options.limit}, max_statement_time = ${MAX_STATEMENT_SECONDS}; `
    const res = await podman.exec(
      id,
      [
        'mariadb',
        '--xml',
        '--user',
        conn.dbUser,
        '--database',
        conn.dbName,
        '--execute',
        prelude + sql,
      ],
      { MYSQL_PWD: conn.dbPassword },
    )
    if (res.exitCode !== 0)
      throw new DbError('DB_ERROR', serverMessage(res.stderr))
    return lastResult(res.stdout)
  }

  const read = (sql: string, limit = 1000) => run(sql, { write: false, limit })
  const write = (sql: string) => run(sql, { write: true, limit: 1000 })

  return {
    async tables() {
      const names = (await read(tablesSql(conn.dbName))).rows.map(
        (r) => r[0] ?? '',
      )
      if (names.length === 0) return []
      const counts = (await read(countsSql(names))).rows
      return counts.map((r) => ({ name: r[0] ?? '', rows: Number(r[1] ?? 0) }))
    },

    async columns(table) {
      return (await read(columnsSql(conn.dbName, table))).rows.map(
        columnFromRow,
      )
    },

    async page(table, cols, page) {
      const [rs, total] = await Promise.all([
        read(selectPageSql(table, cols, page), page.limit),
        read(countRowsSql(table, cols, page.filter)),
      ])
      return {
        rows: rs.rows.map((r) => rowOf(rs.columns, r)),
        total: Number(total.rows[0]?.[0] ?? 0),
      }
    },

    async findRow(table, cols, pk) {
      const rs = await read(findRowSql(table, cols, pk), 1)
      const first = rs.rows[0]
      return first ? rowOf(rs.columns, first) : null
    },

    async insert(table, cols, values) {
      await write(insertSql(table, cols, values))
    },

    async update(table, cols, pk, changes) {
      await write(updateSql(table, cols, pk, changes))
    },

    async remove(table, cols, pk) {
      await write(deleteSql(table, cols, pk))
    },

    raw(sql, options) {
      return run(sql, options)
    },

    async dump() {
      const id = await containerId()
      const res = await podman.exec(
        id,
        [
          'mariadb-dump',
          '--single-transaction',
          '--routines',
          '--triggers',
          '--no-tablespaces',
          '--user',
          conn.dbUser,
          conn.dbName,
        ],
        { MYSQL_PWD: conn.dbPassword },
      )
      if (res.exitCode !== 0)
        throw new DbError(
          'DB_ERROR',
          `No se pudo hacer el dump: ${serverMessage(res.stderr)}`,
        )
      return res.stdout
    },
  }
}
