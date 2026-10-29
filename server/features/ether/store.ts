// Threads and messages in the panel's own SQLite (migration 0060). Per user: nobody reads another person's threads.
import type { Database } from 'bun:sqlite'

export interface ThreadRow {
  id: number
  slug: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface MessageRow {
  id: number
  role: 'user' | 'ether'
  body: string
  runId: string | null
  status: 'pending' | 'done' | 'failed' | 'cancelled'
  createdAt: string
}

export const RETENTION_DAYS = 30
export const MAX_THREADS_PER_USER = 40
export const MAX_BODY = 20_000
export const THREAD_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

export function sessionId(login: string, slug: string): string {
  return `gdp-${login.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${slug}`
}

export function titleOf(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

export function listThreads(db: Database, userId: number): ThreadRow[] {
  return db
    .query<ThreadRow, [number]>(
      `SELECT id, slug, title, created_at AS createdAt, updated_at AS updatedAt
       FROM ether_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
    )
    .all(userId)
}

export function listMessages(
  db: Database,
  userId: number,
  slug: string,
): MessageRow[] {
  return db
    .query<MessageRow, [number, string]>(
      `SELECT m.id, m.role, m.body, m.run_id AS runId, m.status, m.created_at AS createdAt
       FROM ether_messages m JOIN ether_threads t ON t.id = m.thread_id
       WHERE t.user_id = ? AND t.slug = ? ORDER BY m.id`,
    )
    .all(userId, slug)
}

/** Finds the thread or opens it; touching it moves it to the top of the list. */
export function touchThread(
  db: Database,
  userId: number,
  slug: string,
  title: string,
  now: Date,
): number {
  const at = now.toISOString()
  const found = db
    .query<{ id: number }, [number, string]>(
      'SELECT id FROM ether_threads WHERE user_id = ? AND slug = ?',
    )
    .get(userId, slug)
  if (found) {
    db.query('UPDATE ether_threads SET updated_at = ? WHERE id = ?').run(
      at,
      found.id,
    )
    return found.id
  }
  const res = db
    .query(
      'INSERT INTO ether_threads (user_id, slug, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, slug, title, at, at)
  return Number(res.lastInsertRowid)
}

export function addMessage(
  db: Database,
  threadId: number,
  role: MessageRow['role'],
  body: string,
  now: Date,
  opts: { runId?: string; status?: MessageRow['status'] } = {},
): number {
  const res = db
    .query(
      'INSERT INTO ether_messages (thread_id, role, body, run_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      threadId,
      role,
      body.slice(0, MAX_BODY),
      opts.runId ?? null,
      opts.status ?? 'done',
      now.toISOString(),
    )
  return Number(res.lastInsertRowid)
}

export function finishMessage(
  db: Database,
  messageId: number,
  body: string,
  status: MessageRow['status'],
): void {
  db.query('UPDATE ether_messages SET body = ?, status = ? WHERE id = ?').run(
    body.slice(0, MAX_BODY),
    status,
    messageId,
  )
}

export function setMessageRun(
  db: Database,
  messageId: number,
  runId: string,
): void {
  db.query('UPDATE ether_messages SET run_id = ? WHERE id = ?').run(
    runId,
    messageId,
  )
}

/** A reboot kills the pumps: any message still pending will never finish. */
export function closeDangling(db: Database): number {
  return db
    .query(
      `UPDATE ether_messages SET status = 'failed',
         body = CASE WHEN body = '' THEN 'El panel se reinició antes de que Ether terminara.' ELSE body END
       WHERE status = 'pending'`,
    )
    .run().changes
}

/** Threads untouched for RETENTION_DAYS go, and each user keeps their latest MAX_THREADS_PER_USER. */
export function prune(db: Database, now: Date): number {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000)
  let removed = db
    .query('DELETE FROM ether_threads WHERE updated_at < ?')
    .run(cutoff.toISOString()).changes
  removed += db
    .query(
      `DELETE FROM ether_threads WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC, id DESC) AS n
           FROM ether_threads
         ) WHERE n > ?
       )`,
    )
    .run(MAX_THREADS_PER_USER).changes
  return removed
}
