// Pure domain of apis: which endpoints exist, what "healthy" means and how 24 h of checks become a summary.
// No DB, network or clock here (`now` is passed), so everything is tested with plain data.

/** Every `api/*.php` of Gravida (the panel does not carry its source, so the list lives here). */
export const API_FILES = [
  'cambios_rol',
  'catalogos',
  'configuracion',
  'equipos',
  'foto_perfil',
  'historial',
  'incidencias',
  'logout',
  'planilla_ta',
  'prestamos',
  'recuperacion',
  'reportes_error',
  'seguridad_cuenta',
  'servicios',
  'sesion',
  'solicitudes_registro',
  'tareas',
  'ubicaciones',
  'usuarios',
] as const

export const DB_NAME = 'db'
export const INTERVAL_MS = 30_000
export const RETENTION_MS = 24 * 3_600_000
export const BUCKET_MS = 30 * 60_000
export const BUCKETS = RETENTION_MS / BUCKET_MS

export type EndpointKind = 'api' | 'db'

export interface Target {
  /** Stable key: file name without `.php`, or `db`. */
  name: string
  kind: EndpointKind
  /** Path under the front (`/api/equipos.php`); empty for the DB. */
  path: string
}

export const TARGETS: Target[] = [
  ...API_FILES.map((name) => ({
    name,
    kind: 'api' as const,
    path: `/api/${name}.php`,
  })),
  { name: DB_NAME, kind: 'db' as const, path: '' },
]

export interface Verdict {
  ok: boolean
  error: string | null
}

/**
 * A request without session is answered by nginx → php-fpm → the PHP router: 401/403 JSON (or 405 JSON on the
 * endpoints that only take POST) means the whole chain is up. 200 would mean the endpoint is open without a
 * session, which is worth flagging, and anything else (502/504, HTML, 5xx) is a failure.
 */
export function judgeHttp(
  status: number,
  contentType: string | null,
  body: string,
): Verdict {
  const json = /json/i.test(contentType ?? '') && isJson(body)
  if ([401, 403, 405].includes(status)) {
    return json
      ? { ok: true, error: null }
      : { ok: false, error: `HTTP ${status} sin JSON (¿lo respondió nginx?)` }
  }
  if (status >= 200 && status < 300)
    return { ok: false, error: `HTTP ${status} sin sesión (debería pedirla)` }
  if (status === 502 || status === 504)
    return { ok: false, error: `HTTP ${status}: php-fpm no responde` }
  return { ok: false, error: `HTTP ${status}` }
}

function isJson(body: string): boolean {
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}

/** `mariadb -e 'SELECT 1'` printed `1` and exited 0. */
export function judgeDb(exitCode: number, stdout: string, stderr: string) {
  if (exitCode === 0 && (stdout.trim() === '1' || stdout.trim() === ''))
    return { ok: true, error: null } satisfies Verdict
  const detail = (stderr || stdout).trim().split('\n')[0] ?? ''
  return {
    ok: false,
    error: `mariadb salió con ${exitCode}${detail ? `: ${detail.slice(0, 160)}` : ''}`,
  } satisfies Verdict
}

export interface CheckRow {
  endpoint: string
  atMs: number
  ok: boolean
  status: number | null
  latencyMs: number
}

export interface Bucket {
  atMs: number
  /** null: no check landed in this bucket. */
  ok: boolean | null
  latencyMs: number | null
}

export interface LastError {
  atMs: number
  error: string
}

export interface EndpointSummary {
  target: Target
  last: CheckRow | null
  lastError: LastError | null
  /** 0..100 over the checks in the window, null without checks. */
  uptime: number | null
  avgLatencyMs: number | null
  series: Bucket[]
}

/** The window is split into `BUCKETS` slots ending at `now`; a slot is failed if any check in it failed. */
export function buildSeries(
  rows: readonly CheckRow[],
  now: number,
  buckets = BUCKETS,
  bucketMs = BUCKET_MS,
): Bucket[] {
  const start = now - buckets * bucketMs
  const acc = Array.from({ length: buckets }, () => ({
    ok: true,
    n: 0,
    sum: 0,
  }))
  for (const r of rows) {
    const i = Math.floor((r.atMs - start) / bucketMs)
    const slot = acc[i]
    if (!slot || r.atMs > now) continue
    slot.n++
    slot.sum += r.latencyMs
    if (!r.ok) slot.ok = false
  }
  return acc.map((s, i) => ({
    atMs: start + i * bucketMs,
    ok: s.n ? s.ok : null,
    latencyMs: s.n ? Math.round(s.sum / s.n) : null,
  }))
}

export function summarize(
  target: Target,
  rows: readonly CheckRow[],
  lastError: LastError | null,
  now: number,
): EndpointSummary {
  const inWindow = rows.filter(
    (r) => r.atMs >= now - RETENTION_MS && r.atMs <= now,
  )
  const last = inWindow.reduce<CheckRow | null>(
    (best, r) => (!best || r.atMs >= best.atMs ? r : best),
    null,
  )
  const okRows = inWindow.filter((r) => r.ok)
  return {
    target,
    last,
    lastError,
    uptime: inWindow.length ? (okRows.length / inWindow.length) * 100 : null,
    avgLatencyMs: okRows.length
      ? Math.round(okRows.reduce((s, r) => s + r.latencyMs, 0) / okRows.length)
      : null,
    series: buildSeries(inWindow, now),
  }
}
