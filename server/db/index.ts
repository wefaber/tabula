// The panel's own SQLite (users, tokens, sessions, audit, plus whatever each feature stores). Never Gravida's data.
// Migrations are the files in ./migrations, applied in name order once each. Each feature owns its own numbered file
// (see ARCHITECTURE.md › Migrations), so parallel work never edits the same one.
import { Database } from 'bun:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dir, 'migrations')

export function openDb(file: string): Database {
  if (file !== ':memory:') mkdirSync(join(file, '..'), { recursive: true })
  const db = new Database(file, { create: true, strict: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

export function migrate(db: Database, dir = MIGRATIONS_DIR): string[] {
  db.run(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  const done = new Set(
    db
      .query<{ name: string }, []>('SELECT name FROM _migrations')
      .all()
      .map((r) => r.name),
  )
  const applied: string[] = []
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (done.has(name)) continue
    const sql = readFileSync(join(dir, name), 'utf8')
    db.transaction(() => {
      db.run(sql)
      db.query('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        new Date().toISOString(),
      )
    })()
    applied.push(name)
  }
  return applied
}

export function pendingMigrations(db: Database, dir = MIGRATIONS_DIR): number {
  const done = new Set(
    db
      .query<{ name: string }, []>('SELECT name FROM _migrations')
      .all()
      .map((r) => r.name),
  )
  return readdirSync(dir).filter((f) => f.endsWith('.sql') && !done.has(f))
    .length
}
