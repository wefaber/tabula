// Runs the health checks and keeps their 24 h history. Never POSTs: login.php is rate limited per IP, and a periodic
// POST from loopback would end up banning the front itself.
import type { Deps } from '../../deps'
import { log } from '../../log'
import {
  DB_NAME,
  INTERVAL_MS,
  RETENTION_MS,
  TARGETS,
  judgeDb,
  judgeHttp,
  summarize,
  type CheckRow,
  type EndpointSummary,
  type LastError,
  type Target,
  type Verdict,
} from './domain'

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export interface Probe extends CheckRow {
  error: string | null
}

const TIMEOUT_MS = 5000

export async function probeHttp(
  target: Target,
  frontUrl: string,
  fetcher: Fetcher,
  now: () => number,
): Promise<Probe> {
  const started = now()
  let verdict: Verdict
  let status: number | null = null
  try {
    const res = await fetcher(new URL(target.path, frontUrl).toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    status = res.status
    const body = (await res.text()).slice(0, 4096)
    verdict = judgeHttp(res.status, res.headers.get('content-type'), body)
  } catch (error) {
    verdict = { ok: false, error: describe(error) }
  }
  return {
    endpoint: target.name,
    atMs: started,
    ok: verdict.ok,
    status,
    latencyMs: Math.max(0, now() - started),
    error: verdict.error,
  }
}

/** `SELECT 1` through `exec` in the db container; the password travels in MYSQL_PWD, never in argv. */
export async function probeDb(
  deps: Pick<Deps, 'podman' | 'config'>,
  now: () => number,
): Promise<Probe> {
  const { podman, config } = deps
  const started = now()
  let verdict: Verdict
  try {
    const db = (await podman.list(config.nexus.project)).find(
      (c) => c.service === 'db',
    )
    if (!db) verdict = { ok: false, error: 'No encontré el container db' }
    else if (db.state !== 'running')
      verdict = { ok: false, error: `El container db está ${db.state}` }
    else {
      const res = await podman.exec(
        db.id,
        [
          'mariadb',
          '-u',
          config.nexus.dbUser,
          '-N',
          '-B',
          '-e',
          'SELECT 1',
          config.nexus.dbName,
        ],
        { MYSQL_PWD: config.nexus.dbPassword },
      )
      verdict = judgeDb(res.exitCode, res.stdout, res.stderr)
    }
  } catch (error) {
    verdict = { ok: false, error: describe(error) }
  }
  return {
    endpoint: DB_NAME,
    atMs: started,
    ok: verdict.ok,
    status: null,
    latencyMs: Math.max(0, now() - started),
    error: verdict.error,
  }
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return `Sin respuesta en ${TIMEOUT_MS / 1000} s`
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 200)
}

/** One round over every target, stored and announced on the `apis` channel. */
export async function runChecks(
  deps: Deps,
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
): Promise<Probe[]> {
  const probes = await Promise.all([
    ...TARGETS.filter((t) => t.kind === 'api').map((t) =>
      probeHttp(t, deps.config.nexus.frontUrl, fetcher, now),
    ),
    probeDb(deps, now),
  ])
  const insert = deps.db.query(
    'INSERT INTO apis_checks (endpoint, at_ms, ok, status, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
  )
  deps.db.transaction(() => {
    for (const p of probes)
      insert.run(
        p.endpoint,
        p.atMs,
        p.ok ? 1 : 0,
        p.status,
        p.latencyMs,
        p.error,
      )
    deps.db
      .query('DELETE FROM apis_checks WHERE at_ms < ?')
      .run(now() - RETENTION_MS)
  })()
  deps.bus.emit('apis', 'checked', {
    at: new Date(now()).toISOString(),
    failing: probes.filter((p) => !p.ok).length,
  })
  return probes
}

interface RawRow {
  endpoint: string
  atMs: number
  ok: number
  status: number | null
  latencyMs: number
}

/** Current state plus the last 24 h of every target. */
export function readStatus(
  deps: Pick<Deps, 'db'>,
  now: number = Date.now(),
): EndpointSummary[] {
  const rows = deps.db
    .query<RawRow, [number]>(
      `SELECT endpoint, at_ms AS atMs, ok, status, latency_ms AS latencyMs
       FROM apis_checks WHERE at_ms >= ? ORDER BY at_ms`,
    )
    .all(now - RETENTION_MS)
  const errors = deps.db
    .query<{ endpoint: string; atMs: number; error: string }, [number]>(
      `SELECT endpoint, at_ms AS atMs, error FROM apis_checks
       WHERE id IN (SELECT MAX(id) FROM apis_checks WHERE ok = 0 AND at_ms >= ? GROUP BY endpoint)`,
    )
    .all(now - RETENTION_MS)
  const byEndpoint = new Map<string, CheckRow[]>()
  for (const r of rows) {
    const list = byEndpoint.get(r.endpoint) ?? []
    list.push({ ...r, ok: r.ok === 1 })
    byEndpoint.set(r.endpoint, list)
  }
  const lastErrors = new Map<string, LastError>(
    errors.map((e) => [e.endpoint, { atMs: e.atMs, error: e.error }]),
  )
  return TARGETS.map((t) =>
    summarize(
      t,
      byEndpoint.get(t.name) ?? [],
      lastErrors.get(t.name) ?? null,
      now,
    ),
  )
}

/** Fixture mode has no front: answer like a healthy Gravida (one endpoint flaps so the UI has something to show). */
export function fixtureFetcher(now: () => number = Date.now): Fetcher {
  return async (url) => {
    const name = new URL(url).pathname.replace(/^\/api\/|\.php$/g, '')
    await Bun.sleep(8 + ((name.length * 7 + (now() % 13)) % 40))
    const flapping =
      name === 'historial' && Math.floor(now() / 90_000) % 4 === 3
    if (flapping)
      return new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    const status = name === 'logout' ? 405 : 401
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Debes iniciar sesion para continuar.',
        data: null,
      }),
      { status, headers: { 'content-type': 'application/json' } },
    )
  }
}

export function startChecks(deps: Deps): () => void {
  const fetcher = deps.config.fixtures ? fixtureFetcher() : fetch
  let running = false
  let stopped = false
  const tick = async () => {
    if (running || stopped) return
    running = true
    try {
      await runChecks(deps, fetcher)
    } catch (error) {
      log.warn('apis.checks.failed', { error: String(error) })
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(tick, INTERVAL_MS)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
