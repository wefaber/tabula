// GraphQL fields of db. Registered on the shared builder; the logic lives in service.ts.
import { join } from 'node:path'
import { builder, fail, requireAdmin } from '../../graphql/builder'
import type { Ctx } from '../../deps'
import type { ColumnInfo, Row, TableInfo } from './columns'
import { mariadbClient, type DbClient } from './client'
import { DbError } from './errors'
import { fixtureDb } from './fixture'
import {
  deleteRow,
  execute,
  insertRow,
  listTables,
  query,
  rowsPage,
  schemaOf,
  upsertRow,
  type ExecResult,
  type QueryResult,
  type RowsPage,
} from './service'

const TableRef = builder.objectRef<TableInfo>('DbTable').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    rows: t.exposeInt('rows'),
  }),
})

const ColumnRef = builder.objectRef<ColumnInfo>('DbColumn').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    type: t.exposeString('type'),
    kind: t.exposeString('kind'),
    nullable: t.exposeBoolean('nullable'),
    key: t.exposeString('key'),
    defaultValue: t.exposeString('defaultValue', { nullable: true }),
    extra: t.exposeString('extra'),
    enumValues: t.exposeStringList('enumValues'),
    secret: t.exposeBoolean('secret', {
      description:
        'Protected column: masked in the panel and kept out of the audit log.',
    }),
    editable: t.boolean({
      description: 'False for the primary key and generated columns.',
      resolve: (c) => c.key !== 'PRI' && !/GENERATED/i.test(c.extra),
    }),
  }),
})

const RowsRef = builder.objectRef<RowsPage>('DbRows').implement({
  fields: (t) => ({
    table: t.exposeString('table'),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
    pk: t.exposeStringList('pk'),
    columns: t.field({ type: [ColumnRef], resolve: (r) => r.columns }),
    rows: t.field({
      type: 'JSON',
      description: 'Masked rows: column name → text or null.',
      resolve: (r) => r.rows,
    }),
  }),
})

const QueryRef = builder.objectRef<QueryResult>('DbQueryResult').implement({
  fields: (t) => ({
    columns: t.exposeStringList('columns'),
    rows: t.field({ type: 'JSON', resolve: (r) => r.rows }),
    truncated: t.exposeBoolean('truncated'),
    verb: t.exposeString('verb'),
  }),
})

const ExecRef = builder.objectRef<ExecResult>('DbExecResult').implement({
  fields: (t) => ({
    verb: t.exposeString('verb'),
    dumpFile: t.exposeString('dumpFile', {
      description: 'Name of the dump taken before the statement ran.',
    }),
  }),
})

// One client per db connection in fixture mode (state survives between requests, not between tests).
const fixtures = new WeakMap<object, DbClient>()

function clientFor(ctx: Ctx): DbClient {
  if (ctx.config.fixtures) {
    let client = fixtures.get(ctx.db)
    if (!client) {
      client = fixtureDb()
      fixtures.set(ctx.db, client)
    }
    return client
  }
  const { project, dbName, dbUser, dbPassword } = {
    project: ctx.config.nexus.project,
    dbName: ctx.config.nexus.dbName,
    dbUser: ctx.config.nexus.dbUser,
    dbPassword: ctx.config.nexus.dbPassword,
  }
  return mariadbClient(ctx.podman, project, { dbName, dbUser, dbPassword })
}

/** Turns the service's expected failures into GraphQL errors with their stable code. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DbError) fail(err.code, err.message)
    throw err
  }
}

const dumpTarget = (ctx: Ctx) => ({
  dir: join(ctx.config.dataDir, 'dumps'),
  dbName: ctx.config.nexus.dbName,
  now: () => new Date(),
})

builder.queryFields((t) => ({
  dbTables: t.field({
    type: [TableRef],
    resolve: (_root, _args, ctx) => guard(() => listTables(clientFor(ctx))),
  }),
  dbRows: t.field({
    type: RowsRef,
    args: {
      table: t.arg.string({ required: true }),
      page: t.arg.int(),
      pageSize: t.arg.int(),
      filter: t.arg.string(),
    },
    resolve: (_root, args, ctx) =>
      guard(() => rowsPage(clientFor(ctx), args.table, args)),
  }),
  dbSchema: t.field({
    type: [ColumnRef],
    args: { table: t.arg.string({ required: true }) },
    resolve: (_root, { table }, ctx) =>
      guard(() => schemaOf(clientFor(ctx), table)),
  }),
  dbQuery: t.field({
    type: QueryRef,
    description: 'Read-only console: one SELECT, SHOW, DESCRIBE or EXPLAIN.',
    args: { sql: t.arg.string({ required: true }) },
    resolve: (_root, { sql }, ctx) => guard(() => query(clientFor(ctx), sql)),
  }),
}))

builder.mutationFields((t) => ({
  dbUpsertRow: t.string({
    description:
      'Updates the changed columns of the row with this primary key, or inserts it when the key is new.',
    args: {
      table: t.arg.string({ required: true }),
      pk: t.arg({ type: 'JSON', required: true }),
      values: t.arg({ type: 'JSON', required: true }),
    },
    resolve: (_root, args, ctx) =>
      guard(() =>
        upsertRow(
          ctx,
          clientFor(ctx),
          args.table,
          args.pk as Row,
          args.values as Row,
        ),
      ),
  }),
  dbInsertRow: t.boolean({
    args: {
      table: t.arg.string({ required: true }),
      values: t.arg({ type: 'JSON', required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await guard(() =>
        insertRow(ctx, clientFor(ctx), args.table, args.values as Row),
      )
      return true
    },
  }),
  dbDeleteRow: t.boolean({
    description:
      'Deletes by primary key. `confirm` must equal the row label, e.g. `ubicacion#1`.',
    args: {
      table: t.arg.string({ required: true }),
      pk: t.arg({ type: 'JSON', required: true }),
      confirm: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await guard(() =>
        deleteRow(
          ctx,
          clientFor(ctx),
          args.table,
          args.pk as Row,
          args.confirm,
        ),
      )
      return true
    },
  }),
  dbExecute: t.field({
    type: ExecRef,
    description:
      'Admin only. Runs one write statement after a dump. `confirm` must be true.',
    args: {
      sql: t.arg.string({ required: true }),
      confirm: t.arg.boolean({ required: true }),
    },
    resolve: (_root, args, ctx) => {
      requireAdmin(ctx)
      if (!args.confirm)
        fail(
          'CONFIRM_REQUIRED',
          'Confirmá la ejecución antes de correr la sentencia.',
        )
      return guard(() =>
        execute(ctx, clientFor(ctx), args.sql, dumpTarget(ctx)),
      )
    },
  }),
}))
