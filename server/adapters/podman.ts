// Podman libpod REST API over the rootless socket. One client for every feature: containers and power (list, stats,
// start/stop/restart), API calls (front logs) and the DB editor (exec into `db`). The fixture keeps an in-memory
// stack so the panel runs on Windows without Podman.
import { demux, type LogLine } from './podmanStream'

export type { LogLine }

export interface ContainerSummary {
  id: string
  name: string
  /** Compose service (`db`, `back`, `front`). */
  service: string
  image: string
  state: 'running' | 'exited' | 'created' | 'paused' | 'stopped' | 'unknown'
  /** `healthy`, `unhealthy`, `starting` or '' when the container has no healthcheck. */
  health: string
  startedAt: string | null
}

export interface ContainerStats {
  id: string
  cpuPercent: number
  memBytes: number
  memLimitBytes: number
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface LogOptions {
  tail?: number
  /** Unix seconds. */
  since?: number
  follow?: boolean
  signal?: AbortSignal
}

export interface PodmanClient {
  ping(): Promise<boolean>
  list(project: string): Promise<ContainerSummary[]>
  stats(ids: string[]): Promise<ContainerStats[]>
  start(id: string): Promise<void>
  stop(id: string, timeoutSeconds?: number): Promise<void>
  restart(id: string, timeoutSeconds?: number): Promise<void>
  logs(id: string, options?: LogOptions): AsyncIterable<LogLine>
  exec(
    id: string,
    cmd: string[],
    env?: Record<string, string>,
  ): Promise<ExecResult>
}

const API = 'http://podman/v5.0.0/libpod'

export class PodmanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function podmanClient(socket: string): PodmanClient {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      unix: socket,
    } as RequestInit)
    if (!res.ok && res.status !== 304) {
      const body = await res.text().catch(() => '')
      let message = body
      try {
        message = (JSON.parse(body) as { message?: string }).message ?? body
      } catch {}
      throw new PodmanError(
        `podman ${init.method ?? 'GET'} ${path}: ${res.status} ${message}`.trim(),
        res.status,
      )
    }
    return res
  }

  const post = (path: string, body?: unknown) =>
    call(path, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })

  return {
    async ping() {
      try {
        return (
          await fetch('http://podman/_ping', { unix: socket } as RequestInit)
        ).ok
      } catch {
        return false
      }
    },

    async list(project) {
      const filters = encodeURIComponent(
        JSON.stringify({ label: [`com.docker.compose.project=${project}`] }),
      )
      const rows = (await (
        await call(`/containers/json?all=true&filters=${filters}`)
      ).json()) as RawContainer[]
      return rows
        .map(toSummary)
        .sort((a, b) => a.service.localeCompare(b.service))
    },

    async stats(ids) {
      if (ids.length === 0) return []
      const qs = ids
        .map((id) => `containers=${encodeURIComponent(id)}`)
        .join('&')
      const body = (await (
        await call(`/containers/stats?stream=false&${qs}`)
      ).json()) as {
        Stats?: {
          ContainerID: string
          CPU: number
          MemUsage: number
          MemLimit: number
        }[]
      }
      return (body.Stats ?? []).map((s) => ({
        id: s.ContainerID,
        cpuPercent: s.CPU,
        memBytes: s.MemUsage,
        memLimitBytes: s.MemLimit,
      }))
    },

    async start(id) {
      await post(`/containers/${encodeURIComponent(id)}/start`)
    },
    async stop(id, timeoutSeconds = 10) {
      await post(
        `/containers/${encodeURIComponent(id)}/stop?timeout=${timeoutSeconds}`,
      )
    },
    async restart(id, timeoutSeconds = 10) {
      await post(
        `/containers/${encodeURIComponent(id)}/restart?t=${timeoutSeconds}`,
      )
    },

    async *logs(id, { tail = 200, since, follow = false, signal } = {}) {
      const qs = new URLSearchParams({
        stdout: 'true',
        stderr: 'true',
        follow: String(follow),
        tail: String(tail),
      })
      if (since) qs.set('since', String(since))
      const res = await call(
        `/containers/${encodeURIComponent(id)}/logs?${qs}`,
        { signal },
      )
      if (res.body) yield* demux(res.body)
    },

    async exec(id, cmd, env = {}) {
      const created = (await (
        await post(`/containers/${encodeURIComponent(id)}/exec`, {
          Cmd: cmd,
          Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
          AttachStdout: true,
          AttachStderr: true,
        })
      ).json()) as { Id: string }
      const res = await post(`/exec/${created.Id}/start`, {
        Detach: false,
        Tty: false,
      })
      let stdout = ''
      let stderr = ''
      if (res.body) {
        for await (const line of demux(res.body, { raw: true })) {
          if (line.stream === 'stderr') stderr += line.text
          else stdout += line.text
        }
      }
      const info = (await (await call(`/exec/${created.Id}/json`)).json()) as {
        ExitCode?: number
      }
      return { exitCode: info.ExitCode ?? -1, stdout, stderr }
    },
  }
}

interface RawContainer {
  Id: string
  Names?: string[]
  Image: string
  State: string
  StartedAt?: number
  Labels?: Record<string, string>
  Status?: string
}

function toSummary(c: RawContainer): ContainerSummary {
  const states = ['running', 'exited', 'created', 'paused', 'stopped'] as const
  const state = (states as readonly string[]).includes(c.State)
    ? (c.State as ContainerSummary['state'])
    : 'unknown'
  const health =
    /\((healthy|unhealthy|starting)\)/.exec(c.Status ?? '')?.[1] ?? ''
  return {
    id: c.Id,
    name: c.Names?.[0] ?? c.Id.slice(0, 12),
    service: c.Labels?.['com.docker.compose.service'] ?? '',
    image: c.Image,
    state,
    health,
    startedAt:
      c.StartedAt && c.StartedAt > 0
        ? new Date(c.StartedAt * 1000).toISOString()
        : null,
  }
}

// ---------------------------------------------------------------- fixture

/** In-memory stack shaped like `nexus-test`: three services, front writes nginx access lines. */
export function fixturePodman(
  now: () => Date = () => new Date(),
): PodmanClient {
  const boot = now().toISOString()
  const stack: ContainerSummary[] = (['db', 'back', 'front'] as const).map(
    (service) => ({
      id: `fixture-${service}`,
      name: `nexus-test_${service}_1`,
      service,
      image:
        service === 'db'
          ? 'localhost/nexus-test_db:latest'
          : `localhost/nexus-${service}:d2ed724`,
      state: 'running',
      health: service === 'db' ? 'healthy' : '',
      startedAt: boot,
    }),
  )
  const find = (id: string) => {
    const c = stack.find((x) => x.id === id || x.name === id)
    if (!c) throw new PodmanError(`no such container: ${id}`, 404)
    return c
  }
  const sample = [
    'GET /api/sesion.php HTTP/1.1" 200 512',
    'POST /login.php HTTP/1.1" 401 88',
    'GET /api/equipos.php?pagina=2 HTTP/1.1" 200 4096',
    'POST /api/prestamos.php HTTP/1.1" 201 230',
    'GET /pages/home HTTP/1.1" 200 2048',
    'GET /api/incidencias.php HTTP/1.1" 500 64',
  ]
  const accessLine = (i: number, at: Date) =>
    `10.89.0.1 - - [${nginxDate(at)}] "${sample[i % sample.length]} "-" "Mozilla/5.0"`

  return {
    async ping() {
      return true
    },
    async list() {
      return stack.map((c) => ({ ...c }))
    },
    async stats(ids) {
      return ids.map((id, i) => ({
        id,
        cpuPercent: 0.4 + i * 1.3,
        memBytes: (60 + i * 40) * 2 ** 20,
        memLimitBytes: 2 ** 31,
      }))
    },
    async start(id) {
      const c = find(id)
      c.state = 'running'
      c.startedAt = now().toISOString()
      if (c.service === 'db') c.health = 'healthy'
    },
    async stop(id) {
      const c = find(id)
      c.state = 'exited'
      c.startedAt = null
      if (c.service === 'db') c.health = ''
    },
    async restart(id) {
      const c = find(id)
      c.state = 'running'
      c.startedAt = now().toISOString()
    },
    async *logs(id, { tail = 50, follow = false, signal } = {}) {
      const c = find(id)
      const base = now().getTime()
      for (let i = 0; i < tail; i++) {
        const at = new Date(base - (tail - i) * 7000)
        yield {
          stream: 'stdout',
          text:
            c.service === 'front'
              ? accessLine(i, at)
              : `${c.service} ok ${at.toISOString()}`,
        }
      }
      let i = tail
      while (follow && !signal?.aborted) {
        await Bun.sleep(2500)
        if (signal?.aborted) break
        yield {
          stream: 'stdout',
          text:
            c.service === 'front'
              ? accessLine(i++, now())
              : `${c.service} ok ${now().toISOString()}`,
        }
      }
    },
    async exec(id) {
      find(id)
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }
}

function nginxDate(d: Date): string {
  const months = [
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
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`
}
