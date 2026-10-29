// One line per action that changes something. Features call `audit` from their mutations; the Access section lists it.
import type { Database } from 'bun:sqlite'
import type { User } from './auth'

export interface AuditEntry {
  id: number
  at: string
  userLogin: string
  action: string
  target: string
  detail: string
  ok: boolean
}

export function audit(
  db: Database,
  user: Pick<User, 'login'>,
  action: string,
  target = '',
  detail: unknown = {},
  ok = true,
): void {
  db.query(
    'INSERT INTO audit (at, user_login, action, target, detail, ok) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    new Date().toISOString(),
    user.login,
    action,
    target,
    JSON.stringify(detail),
    ok ? 1 : 0,
  )
}

export function listAudit(
  db: Database,
  limit: number,
  action?: string,
): AuditEntry[] {
  const rows = db
    .query<
      Omit<AuditEntry, 'ok'> & { ok: number },
      [string | null, string | null, number]
    >(
      `SELECT id, at, user_login AS userLogin, action, target, detail, ok FROM audit
       WHERE (? IS NULL OR action LIKE ? || '%') ORDER BY id DESC LIMIT ?`,
    )
    .all(action ?? null, action ?? null, limit)
  return rows.map((r) => ({ ...r, ok: r.ok === 1 }))
}
