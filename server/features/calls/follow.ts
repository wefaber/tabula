// Follows the front's nginx access log and keeps the last calls. One long-lived log stream and one INSERT per
// tracked line is cheap, so it runs all the time: the table stays warm for whoever opens the section next.
import type { Database } from 'bun:sqlite'
import type { Deps } from '../../deps'
import { log } from '../../log'
import {
  MAX_ROWS,
  RETENTION_MS,
  parseCall,
  replaySkipper,
  type Call,
} from './domain'

export interface StoredCall extends Call {
  id: number
}

interface Row {
  id: number
  atMs: number
  method: string
  path: string
  status: number
  bytes: number
}

const SELECT =
  'SELECT id, at_ms AS atMs, method, path, status, bytes FROM calls_log'

export function insertCall(db: Database, call: Call): StoredCall {
  const { id } = db
    .query<{ id: number }, [number, string, string, number, number]>(
      'INSERT INTO calls_log (at_ms, method, path, status, bytes) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
    .get(call.atMs, call.method, call.path, call.status, call.bytes)!
  return { id, ...call }
}

/** Last 500 rows and nothing older than 24 h. */
export function pruneCalls(db: Database, now: number): void {
  db.query(
    `DELETE FROM calls_log WHERE at_ms < ?1
       OR id <= (SELECT id FROM calls_log ORDER BY id DESC LIMIT 1 OFFSET ?2)`,
  ).run(now - RETENTION_MS, MAX_ROWS)
}

export function lastCallMs(db: Database): number | null {
  return (
    db
      .query<{ at: number | null }, []>(
        'SELECT MAX(at_ms) AS at FROM calls_log',
      )
      .get()?.at ?? null
  )
}

export function callsAt(db: Database, atMs: number): Call[] {
  return db.query<Row, [number]>(`${SELECT} WHERE at_ms = ?`).all(atMs)
}

/**
 * One connection: backlog since the last stored second, then live lines until the stream ends or `signal` aborts.
 * Returns how many lines were stored.
 */
export async function followOnce(
  deps: Deps,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<number> {
  const { podman, config, db, bus } = deps
  const front = (await podman.list(config.nexus.project)).find(
    (c) => c.service === 'front',
  )
  if (!front) throw new Error('No encontré el container front')
  if (front.state !== 'running')
    throw new Error(`El container front está ${front.state}`)

  const boundary = lastCallMs(db)
  const skip = replaySkipper(
    boundary,
    boundary === null ? [] : callsAt(db, boundary),
  )
  const since = Math.floor(Math.max(boundary ?? 0, now() - RETENTION_MS) / 1000)
  let stored = 0
  let sincePrune = 0
  for await (const line of podman.logs(front.id, {
    follow: true,
    tail: MAX_ROWS,
    since,
    signal,
  })) {
    const call = parseCall(line.text)
    if (!call || skip(call)) continue
    bus.emit('calls', 'call', {
      ...insertCall(db, call),
      at: new Date(call.atMs).toISOString(),
    })
    stored++
    if (++sincePrune >= 25) {
      pruneCalls(db, now())
      sincePrune = 0
    }
  }
  pruneCalls(db, now())
  return stored
}

/** Reconnects with backoff (2 s → 30 s) while the front is down or restarting. */
export function startFollow(deps: Deps): () => void {
  const ctl = new AbortController()
  void (async () => {
    let wait = 2000
    while (!ctl.signal.aborted) {
      try {
        const stored = await followOnce(deps, ctl.signal)
        if (stored > 0) wait = 2000
      } catch (error) {
        if (ctl.signal.aborted) break
        log.warn('calls.follow.failed', { error: String(error) })
      }
      if (ctl.signal.aborted) break
      await Bun.sleep(wait)
      wait = Math.min(wait * 2, 30_000)
    }
  })()
  return () => ctl.abort()
}
