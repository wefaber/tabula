// Pure domain of containers y energía: power order, action plans, row shaping. No DB, network or clock (`now` is passed).
import type { ContainerStats, ContainerSummary } from '../../adapters/podman'

/** Start order of the stack; stopping uses the reverse. */
export const SERVICES = ['db', 'back', 'front'] as const
export type Service = (typeof SERVICES)[number]
export type PowerAction = 'up' | 'down' | 'restart'

export class PowerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function isService(value: string): value is Service {
  return (SERVICES as readonly string[]).includes(value)
}

/** Services in the order the action touches them. */
export function powerOrder(action: PowerAction): Service[] {
  return action === 'down' ? [...SERVICES].reverse() : [...SERVICES]
}

/** What to wait for after a step: db must be healthy, front must answer `/login.php` with 200. */
export type Wait = 'health' | 'http'

export interface Step {
  service: Service
  /** `wait` = nothing to run, just wait for readiness (the service was already running). */
  op: 'start' | 'stop' | 'restart' | 'wait'
  wait?: Wait
}

const WAIT_OF: Record<Service, Wait | undefined> = {
  db: 'health',
  back: undefined,
  front: 'http',
}

export function isReady(
  c: Pick<ContainerSummary, 'state' | 'health'>,
): boolean {
  return c.state === 'running' && (c.health === 'healthy' || c.health === '')
}

/**
 * Turns an action into ordered steps over the containers that exist.
 * `up`/`down` are stack-wide; `restart` takes one service, or restarts the whole stack (stop in reverse, start in order).
 */
export function planPower(
  action: PowerAction,
  service: Service | null,
  containers: Pick<ContainerSummary, 'service' | 'state' | 'health'>[],
): Step[] {
  if (containers.length === 0)
    throw new PowerError(
      'NO_CONTAINERS',
      'No hay containers del proyecto. Levantalo a mano con el comando de recuperación.',
    )
  if (service && action !== 'restart')
    throw new PowerError(
      'BAD_INPUT',
      'Encender y apagar valen para todo el stack; solo reiniciar acepta un servicio.',
    )
  const byService = new Map(containers.map((c) => [c.service, c]))
  const needed = service ? [service] : SERVICES
  const missing = needed.filter((s) => !byService.has(s))
  if (missing.length > 0)
    throw new PowerError(
      'SERVICE_MISSING',
      `Falta el container de ${missing.join(', ')}. Levantalo a mano con el comando de recuperación.`,
    )

  if (action === 'restart' && service)
    return [{ service, op: 'restart', wait: WAIT_OF[service] }]

  const stops = (): Step[] =>
    powerOrder('down').flatMap((s) =>
      byService.get(s)?.state === 'running'
        ? [{ service: s, op: 'stop' as const }]
        : [],
    )
  const starts = (fresh: boolean): Step[] =>
    powerOrder('up').flatMap((s): Step[] => {
      const c = byService.get(s)
      const wait = WAIT_OF[s]
      if (fresh || c?.state !== 'running')
        return [{ service: s, op: 'start', wait }]
      return wait && !isReady(c) ? [{ service: s, op: 'wait', wait }] : []
    })

  if (action === 'down') return stops()
  if (action === 'up') return starts(false)
  return [...stops(), ...starts(true)]
}

// ------------------------------------------------------------------ rows

export interface ContainerRow {
  service: string
  id: string
  name: string
  state: ContainerSummary['state']
  health: string
  image: string
  tag: string
  startedAt: string | null
  uptimeSeconds: number | null
  cpuPercent: number | null
  memBytes: number | null
  memLimitBytes: number | null
}

/** `localhost/nexus-back:d2ed724` → `d2ed724`; `registry:5000/app` → `latest`; digest refs → short digest. */
export function imageTag(image: string): string {
  const at = image.indexOf('@')
  if (at >= 0)
    return image
      .slice(at + 1)
      .replace(/^sha256:/, '')
      .slice(0, 12)
  const lastSlash = image.lastIndexOf('/')
  const colon = image.indexOf(':', lastSlash + 1)
  return colon >= 0 ? image.slice(colon + 1) : 'latest'
}

/** Whole seconds since `startedAt`; null when it is not running or the date is unusable. */
export function uptimeSeconds(
  startedAt: string | null,
  now: Date,
): number | null {
  if (!startedAt) return null
  const t = Date.parse(startedAt)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 1000))
}

/** `3725` → `1 h 2 min`; `45` → `45 s`; `200000` → `2 d 7 h`. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min`
  return `${seconds} s`
}

export function toRows(
  summaries: ContainerSummary[],
  stats: ContainerStats[],
  now: Date,
): ContainerRow[] {
  const statById = new Map(stats.map((s) => [s.id, s]))
  const rank = (s: string) => {
    const i = (SERVICES as readonly string[]).indexOf(s)
    return i < 0 ? SERVICES.length : i
  }
  return summaries
    .map((c): ContainerRow => {
      const running = c.state === 'running'
      const st = running ? statById.get(c.id) : undefined
      return {
        service: c.service,
        id: c.id,
        name: c.name,
        state: c.state,
        health: c.health,
        image: c.image,
        tag: imageTag(c.image),
        startedAt: running ? c.startedAt : null,
        uptimeSeconds: running ? uptimeSeconds(c.startedAt, now) : null,
        cpuPercent: st ? st.cpuPercent : null,
        memBytes: st ? st.memBytes : null,
        memLimitBytes: st ? st.memLimitBytes : null,
      }
    })
    .sort(
      (a, b) =>
        rank(a.service) - rank(b.service) || a.name.localeCompare(b.name),
    )
}

/** Change detector for the `state` event: uptime ticks every second and CPU/mem jitter, so they are bucketed. */
export function signature(rows: ContainerRow[]): string {
  return JSON.stringify(
    rows.map((r) => [
      r.id,
      r.state,
      r.health,
      r.image,
      r.startedAt,
      r.cpuPercent === null ? null : Math.round(r.cpuPercent * 10) / 10,
      r.memBytes === null ? null : Math.round(r.memBytes / 2 ** 20),
    ]),
  )
}
