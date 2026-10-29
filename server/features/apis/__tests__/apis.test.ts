import { describe, expect, test } from 'bun:test'
import { fixturePodman, type PodmanClient } from '../../../adapters/podman'
import { createApp } from '../../../app'
import { testDeps } from '../../../test-utils'
import {
  fixtureFetcher,
  probeDb,
  probeHttp,
  readStatus,
  runChecks,
  type Fetcher,
} from '../checks'
import {
  BUCKETS,
  BUCKET_MS,
  RETENTION_MS,
  TARGETS,
  buildSeries,
  judgeDb,
  judgeHttp,
} from '../domain'

const JSON_CT = 'application/json'
const json = (status: number, ct = JSON_CT, body = '{"status":"error"}') =>
  new Response(body, { status, headers: { 'content-type': ct } })

describe('judgeHttp', () => {
  test('401/403/405 JSON is healthy: nginx, php-fpm and the router answered', () => {
    for (const s of [401, 403, 405])
      expect(judgeHttp(s, JSON_CT, '{"a":1}')).toEqual({
        ok: true,
        error: null,
      })
  })

  test('401 that is not JSON came from somewhere else', () => {
    expect(judgeHttp(401, 'text/html', '<html>').ok).toBe(false)
    expect(judgeHttp(401, JSON_CT, 'not json').ok).toBe(false)
  })

  test('200 without a session, 5xx and 404 are failures with a reason', () => {
    expect(judgeHttp(200, JSON_CT, '{}').error).toContain('sin sesión')
    expect(judgeHttp(502, 'text/html', '').error).toContain('php-fpm')
    expect(judgeHttp(504, 'text/html', '').error).toContain('php-fpm')
    expect(judgeHttp(500, JSON_CT, '{}').error).toBe('HTTP 500')
    expect(judgeHttp(404, 'text/html', '').ok).toBe(false)
  })
})

describe('judgeDb', () => {
  test('exit 0 is healthy, otherwise the first error line is kept', () => {
    expect(judgeDb(0, '1\n', '').ok).toBe(true)
    const bad = judgeDb(1, '', 'ERROR 1045 (28000): Access denied\nmore')
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('Access denied')
    expect(bad.error).not.toContain('more')
  })
})

describe('buildSeries', () => {
  const now = 100 * BUCKET_MS
  const row = (ago: number, ok: boolean, latencyMs: number) => ({
    endpoint: 'x',
    atMs: now - ago,
    ok,
    status: ok ? 401 : 502,
    latencyMs,
  })

  test('always returns 48 slots ending at now, empty ones as null', () => {
    const s = buildSeries([], now)
    expect(s).toHaveLength(BUCKETS)
    expect(s.every((b) => b.ok === null && b.latencyMs === null)).toBe(true)
    expect(s[0]!.atMs).toBe(now - RETENTION_MS)
  })

  test('averages latency and marks a slot failed if any check failed', () => {
    const s = buildSeries(
      [row(10, true, 10), row(20, false, 30), row(30, true, 20)],
      now,
    )
    expect(s.at(-1)).toMatchObject({ ok: false, latencyMs: 20 })
  })

  test('ignores rows outside the window', () => {
    const s = buildSeries(
      [row(RETENTION_MS + 1, true, 5), row(-1, true, 5)],
      now,
    )
    expect(s.every((b) => b.ok === null)).toBe(true)
  })
})

describe('probes', () => {
  const now = () => 1000
  const target = TARGETS[0]!

  test('healthy 401 JSON', async () => {
    const f: Fetcher = async () => json(401)
    const p = await probeHttp(target, 'http://front', f, now)
    expect(p).toMatchObject({
      endpoint: target.name,
      ok: true,
      status: 401,
      error: null,
    })
  })

  test('hits the right URL with GET only', async () => {
    const seen: { url: string; method?: string }[] = []
    await probeHttp(
      target,
      'http://front:18080',
      async (url, init) => {
        seen.push({ url, method: init.method })
        return json(401)
      },
      now,
    )
    expect(seen).toEqual([
      {
        url: `http://front:18080${target.path}`,
        method: 'GET',
      },
    ])
  })

  test('network errors and timeouts become failures, not throws', async () => {
    const refused = await probeHttp(
      target,
      'http://front',
      async () => {
        throw new Error('connect ECONNREFUSED')
      },
      now,
    )
    expect(refused).toMatchObject({ ok: false, status: null })
    expect(refused.error).toContain('ECONNREFUSED')
    const slow = await probeHttp(
      target,
      'http://front',
      async () => {
        throw new DOMException('timeout', 'TimeoutError')
      },
      now,
    )
    expect(slow.error).toContain('Sin respuesta')
  })

  test('db probe passes the password by env, never in argv', async () => {
    const deps = testDeps()
    let call: { cmd: string[]; env?: Record<string, string> } | null = null
    const podman: PodmanClient = {
      ...fixturePodman(),
      async exec(_id, cmd, env) {
        call = { cmd, env }
        return { exitCode: 0, stdout: '1\n', stderr: '' }
      },
    }
    const config = {
      ...deps.config,
      nexus: { ...deps.config.nexus, dbPassword: 's3cret' },
    }
    const p = await probeDb({ podman, config }, now)
    expect(p.ok).toBe(true)
    expect(call!.env).toEqual({ MYSQL_PWD: 's3cret' })
    expect(call!.cmd.join(' ')).not.toContain('s3cret')
    expect(call!.cmd[0]).toBe('mariadb')
  })

  test('db probe reports a stopped container and a failing exec', async () => {
    const deps = testDeps()
    const stopped = fixturePodman()
    await stopped.stop('fixture-db')
    expect(
      (await probeDb({ podman: stopped, config: deps.config }, now)).error,
    ).toContain('exited')
    const failing: PodmanClient = {
      ...fixturePodman(),
      exec: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'ERROR 2002: socket',
      }),
    }
    const p = await probeDb({ podman: failing, config: deps.config }, now)
    expect(p.ok).toBe(false)
    expect(p.error).toContain('socket')
  })
})

describe('runChecks + apiStatus', () => {
  test('stores one row per target, announces it and reads it back', async () => {
    const deps = testDeps()
    const events: unknown[] = []
    deps.bus.on('apis', (e, d) => events.push([e, d]))
    const t0 = Date.UTC(2026, 9, 28, 12)
    let clock = t0
    await runChecks(
      deps,
      async () => json(401),
      () => clock,
    )
    clock = t0 + 30_000
    await runChecks(
      deps,
      async (url) =>
        url.endsWith('equipos.php') ? json(502, 'text/html', '') : json(401),
      () => clock,
    )

    expect(events).toHaveLength(2)
    const status = readStatus(deps, clock + 1000)
    expect(status).toHaveLength(TARGETS.length)
    const equipos = status.find((s) => s.target.name === 'equipos')!
    expect(equipos.last).toMatchObject({ ok: false, status: 502 })
    expect(equipos.lastError?.error).toContain('php-fpm')
    expect(equipos.uptime).toBe(50)
    expect(status.find((s) => s.target.name === 'sesion')!.uptime).toBe(100)
    expect(status.find((s) => s.target.name === 'db')!.last?.ok).toBe(true)
  })

  test('history older than 24 h is dropped', async () => {
    const deps = testDeps()
    const t0 = Date.UTC(2026, 9, 28, 12)
    await runChecks(
      deps,
      async () => json(401),
      () => t0,
    )
    await runChecks(
      deps,
      async () => json(401),
      () => t0 + RETENTION_MS + 60_000,
    )
    const n = deps.db
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM apis_checks')
      .get()!.n
    expect(n).toBe(TARGETS.length)
  })

  test('the fixture fetcher looks like a healthy Gravida', async () => {
    const deps = testDeps()
    const probes = await runChecks(
      deps,
      fixtureFetcher(() => 0),
    )
    expect(probes.every((p) => p.ok)).toBe(true)
  })

  test('apiStatus answers over GraphQL for a tailnet user', async () => {
    const deps = testDeps()
    await runChecks(deps, async () => json(401))
    const app = createApp(deps, { distDir: '/nonexistent' })
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'tailscale-user-login': 'faku@x',
        },
        body: JSON.stringify({
          query:
            '{ apiStatus { intervalSeconds endpoints { name kind path ok status uptime series { at ok latencyMs } } } }',
        }),
      }),
    )
    const { data } = await res.json()
    expect(data.apiStatus.intervalSeconds).toBe(30)
    expect(data.apiStatus.endpoints).toHaveLength(TARGETS.length)
    const sesion = data.apiStatus.endpoints.find(
      (e: { name: string }) => e.name === 'sesion',
    )
    expect(sesion).toMatchObject({
      kind: 'api',
      path: '/api/sesion.php',
      ok: true,
      status: 401,
    })
    expect(sesion.series).toHaveLength(BUCKETS)
  })

  test('before the first check every endpoint is reported as unchecked', () => {
    const [first] = readStatus(testDeps())
    expect(first!.last).toBeNull()
    expect(first!.uptime).toBeNull()
  })
})

test('the endpoint list covers every Gravida api file and never login.php', () => {
  expect(TARGETS.filter((t) => t.kind === 'api')).toHaveLength(19)
  expect(TARGETS.some((t) => t.path.includes('login'))).toBe(false)
})
