// Pure domain of calls: the nginx `combined` log format, what the panel keeps of a line, and replay de-duplication.
// Combined: $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"

export const MAX_ROWS = 500
export const RETENTION_MS = 24 * 3_600_000
const MAX_PATH = 200

export interface Call {
  atMs: number
  method: string
  /** Path with the query string masked (`/api/equipos.php?pagina=*`). */
  path: string
  status: number
  bytes: number
}

const LINE =
  /^\S+ \S+ \S+ \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-)(?: "[^"]*" "[^"]*")?\s*$/
const REQUEST = /^([A-Z]{3,10}) (\S+) HTTP\/\d(?:\.\d)?$/
const TIME =
  /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** `28/Oct/2026:10:00:00 -0300` → epoch ms, or null. */
export function parseNginxTime(raw: string): number | null {
  const m = TIME.exec(raw)
  if (!m) return null
  const month = MONTHS.indexOf(m[2]!)
  if (month < 0) return null
  const utc = Date.UTC(+m[3]!, month, +m[1]!, +m[4]!, +m[5]!, +m[6]!)
  const offset = (+m[8]! * 60 + +m[9]!) * 60_000 * (m[7] === '-' ? -1 : 1)
  return utc - offset
}

/** Keeps the keys, drops the values: `?cedula=1234&q=ana` → `?cedula=*&q=*`. */
export function maskQuery(target: string): string {
  const q = target.indexOf('?')
  if (q < 0) return target
  const keys = target
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => `${pair.split('=')[0]}=*`)
  return keys.length
    ? `${target.slice(0, q)}?${keys.join('&')}`
    : target.slice(0, q)
}

/** What the panel follows: the API and the login endpoint. */
export function isTracked(target: string): boolean {
  const path = target.split('?')[0]!
  return path.startsWith('/api/') || path === '/login.php'
}

/** One access-log line → a Call, or null when it is not combined format, is cut, or is not an API request. */
export function parseCall(line: string): Call | null {
  const m = LINE.exec(line.trim())
  if (!m) return null
  const atMs = parseNginxTime(m[1]!)
  const req = REQUEST.exec(m[2]!)
  if (atMs === null || !req) return null
  const target = req[2]!
  if (!isTracked(target)) return null
  return {
    atMs,
    method: req[1]!,
    path: maskQuery(target).slice(0, MAX_PATH),
    status: Number(m[3]),
    bytes: m[4] === '-' ? 0 : Number(m[4]),
  }
}

export const callKey = (c: Call) =>
  `${c.atMs}|${c.method}|${c.path}|${c.status}|${c.bytes}`

/**
 * After a reconnect the log is replayed from the last stored second. Nginx timestamps have 1 s resolution, so lines
 * already stored from that second are skipped by count (burst of identical calls included), older ones outright.
 */
export function replaySkipper(
  boundaryMs: number | null,
  stored: readonly Call[],
): (call: Call) => boolean {
  if (boundaryMs === null) return () => false
  const left = new Map<string, number>()
  for (const c of stored)
    if (c.atMs === boundaryMs)
      left.set(callKey(c), (left.get(callKey(c)) ?? 0) + 1)
  return (call) => {
    if (call.atMs < boundaryMs) return true
    if (call.atMs > boundaryMs) return false
    const n = left.get(callKey(call)) ?? 0
    if (n === 0) return false
    left.set(callKey(call), n - 1)
    return true
  }
}

export type StatusFilter =
  | { kind: 'class'; digit: number }
  | { kind: 'exact'; code: number }

/** `2xx`..`5xx` or an exact code (`404`); null when it is neither. */
export function parseStatusFilter(raw: string): StatusFilter | null {
  const cls = /^([1-5])xx$/i.exec(raw)
  if (cls) return { kind: 'class', digit: Number(cls[1]) }
  if (/^[1-5]\d\d$/.test(raw)) return { kind: 'exact', code: Number(raw) }
  return null
}

export function statusRange(f: StatusFilter): [number, number] {
  return f.kind === 'class'
    ? [f.digit * 100, f.digit * 100 + 99]
    : [f.code, f.code]
}
