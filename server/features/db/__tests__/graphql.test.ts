import { afterAll, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../../app'
import { testDeps } from '../../../test-utils'

const ADMIN = { 'tailscale-user-login': 'faku@x' }
const MEMBER = { 'tailscale-user-login': 'pablo@x' }

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const deps = testDeps()
  const dir = mkdtempSync(join(tmpdir(), 'devpanel-db-'))
  dirs.push(dir)
  deps.config.dataDir = dir
  return { app: createApp(deps, { distDir: '/nonexistent' }), dir }
}

async function gql(
  app: ReturnType<typeof createApp>,
  headers: Record<string, string>,
  query: string,
  variables?: Record<string, unknown>,
) {
  const res = await app.handle(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query, variables }),
    }),
  )
  return (await res.json()) as {
    data?: Record<string, any>
    errors?: { message: string; extensions?: { code?: string } }[]
  }
}

const codeOf = (r: Awaited<ReturnType<typeof gql>>) =>
  r.errors?.[0]?.extensions?.code

describe('db: reads', () => {
  test('lists the tables with row counts', async () => {
    const { app } = setup()
    const r = await gql(app, MEMBER, '{ dbTables { name rows } }')
    expect(r.data?.dbTables).toEqual([
      { name: 'ubicacion', rows: 2 },
      { name: 'usuario', rows: 2 },
    ])
  })

  test('rows are paged, masked and report their primary key', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      MEMBER,
      '{ dbRows(table: "usuario", page: 1, pageSize: 1) { total pk rows columns { name secret editable } } }',
    )
    const page = r.data?.dbRows
    expect(page.total).toBe(2)
    expect(page.pk).toEqual(['cedula'])
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].contrasena).toBe('••••••••')
    expect(
      page.columns.find((c: { name: string }) => c.name === 'contrasena'),
    ).toMatchObject({
      secret: true,
      editable: true,
    })
    expect(
      page.columns.find((c: { name: string }) => c.name === 'cedula').editable,
    ).toBe(false)
  })

  test('an unknown table is refused, and a table name is never interpolated raw', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      MEMBER,
      '{ dbRows(table: "usuario; DROP TABLE usuario") { total } }',
    )
    expect(codeOf(r)).toBe('BAD_INPUT')
    expect(r.errors?.[0]?.message).toContain('No existe la tabla')
  })

  test('filter searches text but not secrets', async () => {
    const { app } = setup()
    const hit = await gql(
      app,
      MEMBER,
      '{ dbRows(table: "usuario", filter: "Ana") { total } }',
    )
    expect(hit.data?.dbRows.total).toBe(1)
    const secret = await gql(
      app,
      MEMBER,
      '{ dbRows(table: "usuario", filter: "fixtureHash") { total } }',
    )
    expect(secret.data?.dbRows.total).toBe(0)
  })

  test('the console masks secret-named columns in its results', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      MEMBER,
      '{ dbQuery(sql: "SELECT * FROM usuario") { columns rows truncated } }',
    )
    const result: { columns: string[]; rows: string[][] } = r.data?.dbQuery
    const { columns, rows } = result
    expect(rows[0]?.[columns.indexOf('contrasena')]).toBe('••••••••')
    expect(rows[0][columns.indexOf('nombre')]).toBe('Ana Pérez')
  })
})

describe('db: console reads', () => {
  test('a write in the read console is refused', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      ADMIN,
      '{ dbQuery(sql: "DELETE FROM usuario") { verb } }',
    )
    expect(codeOf(r)).toBe('READ_ONLY')
  })

  test('a protected column cannot be read under an alias', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      MEMBER,
      '{ dbQuery(sql: "SELECT contrasena AS c FROM usuario") { columns } }',
    )
    expect(codeOf(r)).toBe('BAD_INPUT')
    expect(r.errors?.[0]?.message).toContain('columnas protegidas')
  })

  test('comments and multi-statements are refused with BAD_INPUT', async () => {
    const { app } = setup()
    expect(
      codeOf(
        await gql(
          app,
          ADMIN,
          '{ dbQuery(sql: "SELECT 1; DROP TABLE usuario") { verb } }',
        ),
      ),
    ).toBe('BAD_INPUT')
    expect(
      codeOf(
        await gql(app, ADMIN, '{ dbQuery(sql: "SELECT 1 -- x") { verb } }'),
      ),
    ).toBe('BAD_INPUT')
  })
})

describe('db: row edits', () => {
  const upsert = (
    app: ReturnType<typeof createApp>,
    headers: Record<string, string>,
    values: unknown,
    pk: unknown = { id_ubicacion: '1' },
  ) =>
    gql(
      app,
      headers,
      'mutation($pk: JSON!, $v: JSON!) { dbUpsertRow(table: "ubicacion", pk: $pk, values: $v) }',
      { pk, v: values },
    )

  test('updates only the changed columns and audits their names, never their values', async () => {
    const { app } = setup()
    const r = await upsert(app, ADMIN, {
      seccion_inventario: 'Lab Secreto Nuevo',
      esta_activa: '1',
    })
    expect(r.data?.dbUpsertRow).toBe('update')
    const log = await gql(
      app,
      ADMIN,
      '{ audit(limit: 5, action: "db.") { action target detail ok } }',
    )
    const entry = log.data?.audit[0]
    expect(entry.action).toBe('db.row.update')
    expect(entry.target).toBe('ubicacion#1')
    expect(entry.detail).toContain('seccion_inventario')
    expect(entry.detail).not.toContain('esta_activa')
    expect(entry.detail).not.toContain('Lab Secreto Nuevo')
  })

  test('no change means no write and no audit line', async () => {
    const { app } = setup()
    const before = await gql(
      app,
      ADMIN,
      '{ audit(limit: 50, action: "db.") { id } }',
    )
    const r = await upsert(app, ADMIN, { seccion_inventario: 'Laboratorio 1' })
    expect(r.data?.dbUpsertRow).toBe('none')
    const after = await gql(
      app,
      ADMIN,
      '{ audit(limit: 50, action: "db.") { id } }',
    )
    expect(after.data?.audit.length).toBe(before.data?.audit.length)
  })

  test('a new key inserts the row', async () => {
    const { app } = setup()
    const r = await upsert(
      app,
      ADMIN,
      { seccion_inventario: 'Laboratorio 3', esta_activa: '1' },
      { id_ubicacion: '9' },
    )
    expect(r.data?.dbUpsertRow).toBe('insert')
    const page = await gql(
      app,
      MEMBER,
      '{ dbRows(table: "ubicacion", pageSize: 10) { total } }',
    )
    expect(page.data?.dbRows.total).toBe(3)
  })

  test('the primary key cannot be changed from the row', async () => {
    const { app } = setup()
    const r = await upsert(app, ADMIN, { id_ubicacion: '5' })
    expect(codeOf(r)).toBe('BAD_INPUT')
  })

  test('secret columns cannot be written; the mask is ignored', async () => {
    const { app } = setup()
    const denied = await gql(
      app,
      ADMIN,
      'mutation($pk: JSON!, $v: JSON!) { dbUpsertRow(table: "usuario", pk: $pk, values: $v) }',
      { pk: { cedula: '1234567' }, v: { contrasena: 'nueva' } },
    )
    expect(codeOf(denied)).toBe('BAD_INPUT')
    const masked = await gql(
      app,
      ADMIN,
      'mutation($pk: JSON!, $v: JSON!) { dbUpsertRow(table: "usuario", pk: $pk, values: $v) }',
      {
        pk: { cedula: '1234567' },
        v: { contrasena: '••••••••', nombre: 'Ana P.' },
      },
    )
    expect(masked.data?.dbUpsertRow).toBe('update')
  })

  test('an enum value outside the list is refused', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      ADMIN,
      'mutation($pk: JSON!, $v: JSON!) { dbUpsertRow(table: "usuario", pk: $pk, values: $v) }',
      { pk: { cedula: '1234567' }, v: { rol: 'Root' } },
    )
    expect(codeOf(r)).toBe('BAD_INPUT')
  })

  test('a member can edit rows but gets the same checks', async () => {
    const { app } = setup()
    const r = await upsert(app, MEMBER, { seccion_inventario: 'Lab miembro' })
    expect(r.data?.dbUpsertRow).toBe('update')
  })
})

describe('db: delete', () => {
  test('refuses without the typed label, and deletes with it', async () => {
    const { app } = setup()
    const mut =
      'mutation($pk: JSON!, $c: String!) { dbDeleteRow(table: "ubicacion", pk: $pk, confirm: $c) }'
    const wrong = await gql(app, ADMIN, mut, {
      pk: { id_ubicacion: '1' },
      c: 'ubicacion',
    })
    expect(codeOf(wrong)).toBe('CONFIRM_REQUIRED')
    expect(wrong.errors?.[0]?.message).toContain('ubicacion#1')
    const ok = await gql(app, ADMIN, mut, {
      pk: { id_ubicacion: '1' },
      c: 'ubicacion#1',
    })
    expect(ok.data?.dbDeleteRow).toBe(true)
    const left = await gql(
      app,
      MEMBER,
      '{ dbRows(table: "ubicacion") { total } }',
    )
    expect(left.data?.dbRows.total).toBe(1)
    const log = await gql(
      app,
      ADMIN,
      '{ audit(limit: 1, action: "db.row.delete") { target ok } }',
    )
    expect(log.data?.audit[0]).toEqual({ target: 'ubicacion#1', ok: true })
  })
})

describe('db: console writes (admin)', () => {
  test('members cannot execute', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      MEMBER,
      'mutation { dbExecute(sql: "DELETE FROM usuario", confirm: true) { verb } }',
    )
    expect(codeOf(r)).toBe('FORBIDDEN')
  })

  test('an unconfirmed execute is refused before any dump', async () => {
    const { app, dir } = setup()
    const r = await gql(
      app,
      ADMIN,
      'mutation { dbExecute(sql: "DELETE FROM usuario", confirm: false) { verb } }',
    )
    expect(codeOf(r)).toBe('CONFIRM_REQUIRED')
    expect(existsSync(join(dir, 'dumps'))).toBe(false)
  })

  test('a confirmed write dumps first, runs, and audits the redacted statement', async () => {
    const { app, dir } = setup()
    const r = await gql(
      app,
      ADMIN,
      'mutation { dbExecute(sql: "UPDATE ubicacion SET seccion_inventario = \'Secreto\' WHERE id_ubicacion = 1", confirm: true) { verb dumpFile } }',
    )
    expect(r.data?.dbExecute.verb).toBe('UPDATE')
    const dumpFile = r.data?.dbExecute.dumpFile as string
    expect(readdirSync(join(dir, 'dumps'))).toEqual([dumpFile])
    expect(readFileSync(join(dir, 'dumps', dumpFile), 'utf8')).toContain(
      'fixture dump',
    )
    const log = await gql(
      app,
      ADMIN,
      '{ audit(limit: 1, action: "db.execute") { detail ok } }',
    )
    expect(log.data?.audit[0].ok).toBe(true)
    expect(log.data?.audit[0].detail).toContain('WHERE id_ubicacion = ?')
    expect(log.data?.audit[0].detail).not.toContain('Secreto')
  })

  test('a read statement is not an execute', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      ADMIN,
      'mutation { dbExecute(sql: "SELECT 1", confirm: true) { verb } }',
    )
    expect(codeOf(r)).toBe('BAD_INPUT')
  })

  test('a classifier refusal is returned as BAD_INPUT', async () => {
    const { app } = setup()
    const r = await gql(
      app,
      ADMIN,
      'mutation { dbExecute(sql: "CREATE USER x", confirm: true) { verb } }',
    )
    expect(codeOf(r)).toBe('BAD_INPUT')
  })
})
