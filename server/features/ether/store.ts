// Threads and messages in the panel's own SQLite (migration 0060). Per user: nobody reads another person's threads.
import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import type { User } from '../../auth'
import type { MessageSources } from '../../../shared/etherRefs'

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
  /** Active share of this answer, when the owner shared it. */
  shareToken: string | null
  /** What Ether looked at for this answer (migration 0090). Null for questions, old answers and failed starts. */
  sources: MessageSources | null
}

export interface SharedAnswer {
  question: string | null
  answer: string
  sharedBy: string
  sharedAt: string
}

export const SHARE_TOKEN = /^[0-9a-f]{32}$/
export const RETENTION_DAYS = 30
export const MAX_THREADS_PER_USER = 40
export const MAX_BODY = 20_000
export const THREAD_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

export function sessionId(login: string, slug: string): string {
  return `tabula-${login.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${slug}`
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

/** The stored sources JSON, or null when there is none or it does not parse (never throws on a read). */
export function parseSources(raw: string | null): MessageSources | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as MessageSources
  } catch {
    return null
  }
}

export function listMessages(
  db: Database,
  userId: number,
  slug: string,
): MessageRow[] {
  return db
    .query<
      Omit<MessageRow, 'sources'> & { sourcesJson: string | null },
      [number, string]
    >(
      `SELECT m.id, m.role, m.body, m.run_id AS runId, m.status, m.created_at AS createdAt, m.sources AS sourcesJson,
              (SELECT s.token FROM ether_shares s WHERE s.message_id = m.id AND s.revoked_at IS NULL) AS shareToken
       FROM ether_messages m JOIN ether_threads t ON t.id = m.thread_id
       WHERE t.user_id = ? AND t.slug = ? ORDER BY m.id`,
    )
    .all(userId, slug)
    .map(({ sourcesJson, ...m }) => ({
      ...m,
      sources: parseSources(sourcesJson),
    }))
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
  sources: MessageSources | null = null,
): void {
  db.query(
    'UPDATE ether_messages SET body = ?, status = ?, sources = ? WHERE id = ?',
  ).run(
    body.slice(0, MAX_BODY),
    status,
    sources ? JSON.stringify(sources) : null,
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

/** Shares one finished answer from the caller's own thread. The same active token comes back if it is already shared. */
export function createShare(
  db: Database,
  userId: number,
  messageId: number,
  now: Date,
): string | null {
  const own = db
    .query<{ id: number }, [number, number]>(
      `SELECT m.id FROM ether_messages m JOIN ether_threads t ON t.id = m.thread_id
       WHERE m.id = ? AND t.user_id = ? AND m.role = 'ether' AND m.status = 'done'`,
    )
    .get(messageId, userId)
  if (!own) return null
  const active = db
    .query<{ token: string }, [number]>(
      'SELECT token FROM ether_shares WHERE message_id = ? AND revoked_at IS NULL',
    )
    .get(messageId)
  if (active) return active.token
  const token = randomBytes(16).toString('hex')
  db.query(
    'INSERT INTO ether_shares (token, message_id, created_by, created_at) VALUES (?, ?, ?, ?)',
  ).run(token, messageId, userId, now.toISOString())
  return token
}

/** Read-only view of a shared answer: its text and the question before it. Nothing about the run. */
export function getShare(db: Database, token: string): SharedAnswer | null {
  if (!SHARE_TOKEN.test(token)) return null
  return (
    db
      .query<SharedAnswer, [string]>(
        `SELECT (SELECT q.body FROM ether_messages q WHERE q.thread_id = m.thread_id AND q.role = 'user' AND q.id < m.id
                 ORDER BY q.id DESC LIMIT 1) AS question,
                m.body AS answer, u.login AS sharedBy, s.created_at AS sharedAt
         FROM ether_shares s
         JOIN ether_messages m ON m.id = s.message_id
         JOIN ether_threads t ON t.id = m.thread_id
         JOIN users u ON u.id = t.user_id
         WHERE s.token = ? AND s.revoked_at IS NULL`,
      )
      .get(token) ?? null
  )
}

/** The owner of the answer, or an admin, stops the link. */
export function revokeShare(
  db: Database,
  user: Pick<User, 'id' | 'role'>,
  token: string,
  now: Date,
): boolean {
  if (!SHARE_TOKEN.test(token)) return false
  return (
    db
      .query(
        `UPDATE ether_shares SET revoked_at = ?
         WHERE token = ? AND revoked_at IS NULL AND (created_by = ? OR ? = 'admin')`,
      )
      .run(now.toISOString(), token, user.id, user.role).changes === 1
  )
}
