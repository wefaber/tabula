import { describe, expect, test } from 'bun:test'
import { fixturePodman, type PodmanClient } from '../../../adapters/podman'
import { createApp } from '../../../app'
import { testDeps } from '../../../test-utils'
import {
  isTracked,
  maskQuery,
  parseCall,
  parseNginxTime,
  parseStatusFilter,
  replaySkipper,
} from '../domain'
import { followOnce, insertCall, pruneCalls } from '../follow'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const line = (when: string, req: string, status = 200, bytes = 512) =>
  `10.89.0.1 - - [${when}] "${req}" ${status} ${bytes} "http://127.0.0.1:18080/pages/home" "${UA}"`

const T = '28/Oct/2026:10:15:32 +0000'
const T_MS = Date.UTC(2026, 9, 28, 10, 15, 32)

describe('parseCall', () => {
  test('reads a real combined line', () => {
    expect(parseCall(line(T, 'GET /api/sesion.php HTTP/1.1', 401, 83))).toEqual(
      {
        atMs: T_MS,
        method: 'GET',
        path: '/api/sesion.php',
        status: 401,
        bytes: 83,
      },
    )
  })

  test('masks query values and keeps the keys', () => {
    const call = parseCall(
      line(T, 'GET /api/usuarios.php?cedula=12345678&q=ana%20p HTTP/1.1'),
    )
    expect(call?.path).toBe('/api/usuarios.php?cedula=*&q=*')
    expect(JSON.stringify(call)).not.toContain('12345678')
  })

  test('tracks /login.php and ignores pages and assets', () => {
    expect(parseCall(line(T, 'POST /login.php HTTP/1.1', 401))?.path).toBe(
      '/login.php',
    )
    expect(parseCall(line(T, 'GET /pages/home HTTP/1.1'))).toBeNull()
    expect(parseCall(line(T, 'GET /assets/app.js?v=3 HTTP/1.1'))).toBeNull()
    expect(parseCall(line(T, 'GET /apix/foo HTTP/1.1'))).toBeNull()
  })

  test('handles HTTP/2, other methods and a "-" body size', () => {
    const l = `10.89.0.1 - - [${T}] "DELETE /api/equipos.php?id=4 HTTP/2.0" 204 - "-" "curl/8.5"`
    expect(parseCall(l)).toMatchObject({
      method: 'DELETE',
      status: 204,
      bytes: 0,
    })
  })

  test('applies the log timezone offset', () => {
    expect(parseNginxTime('28/Oct/2026:07:15:32 -0300')).toBe(T_MS)
    expect(parseNginxTime('28/Oct/2026:12:45:32 +0230')).toBe(T_MS)
  })

  test.each([
    ['empty', ''],
    ['plain text', 'nginx: [warn] conflicting server name'],
    [
      'bad TLS handshake request',
      `10.89.0.1 - - [${T}] "\\x16\\x03\\x01" 400 150 "-" "-"`,
    ],
    ['cut mid-line', `10.89.0.1 - - [${T}] "GET /api/sesion.php HTT`],
    [
      'bad month',
      line('28/Foo/2026:10:15:32 +0000', 'GET /api/x.php HTTP/1.1'),
    ],
    [
      'status not a number',
      `10.89.0.1 - - [${T}] "GET /api/x.php HTTP/1.1" abc 5 "-" "-"`,
    ],
    ['json log line', '{"msg":"listening"}'],
  ])('returns null for %s', (_name, input) => {
    expect(parseCall(input)).toBeNull()
  })

  test('keeps a line without referer and user agent (common format)', () => {
    const l = `10.89.0.1 - - [${T}] "GET /api/sesion.php HTTP/1.1" 200 12`
    expect(parseCall(l)?.status).toBe(200)
  })

  test('caps very long paths', () => {
    const call = parseCall(line(T, `GET /api/${'a'.repeat(900)} HTTP/1.1`))
    expect(call?.path.length).toBe(200)
  })
})

test('maskQuery edge cases', () => {
  expect(maskQuery('/api/a.php')).toBe('/api/a.php')
  expect(maskQuery('/api/a.php?')).toBe('/api/a.php')
  expect(maskQuery('/api/a.php?flag')).toBe('/api/a.php?flag=*')
  expect(maskQuery('/api/a.php?a=1&&b=')).toBe('/api/a.php?a=*&b=*')
})

test('isTracked ignores the query when matching', () => {
  expect(isTracked('/login.php?next=/api/x')).toBe(true)
  expect(isTracked('/pages/home?x=/api/')).toBe(false)
})

test('parseStatusFilter', () => {
  expect(parseStatusFilter('4xx')).toEqual({ kind: 'class', digit: 4 })
  expect(parseStatusFilter('404')).toEqual({ kind: 'exact', code: 404 })
  expect(parseStatusFilter('9xx')).toBeNull()
  expect(parseStatusFilter('abc')).toBeNull()
})

describe('replaySkipper', () => {
  const c = (atMs: number, path = '/api/a.php') => ({
    atMs,
    method: 'GET',
    path,
    status: 200,
    bytes: 1,
  })

  test('skips older lines and as many boundary-second duplicates as stored', () => {
    const skip = replaySkipper(2000, [c(2000), c(2000)])
    expect(skip(c(1000))).toBe(true)
    expect(skip(c(2000))).toBe(true)
    expect(skip(c(2000))).toBe(true)
    expect(skip(c(2000))).toBe(false) // a third identical call is new
    expect(skip(c(2000, '/api/b.php'))).toBe(false)
    expect(skip(c(3000))).toBe(false)
  })

  test('without a boundary nothing is skipped', () => {
    expect(replaySkipper(null, [])(c(1))).toBe(false)
  })
})

function podmanWith(lines: string[]): PodmanClient {
  return {
    ...fixturePodman(),
    async *logs() {
      for (const text of lines) yield { stream: 'stdout' as const, text }
    },
  }
}

describe('followOnce', () => {
  const ctl = new AbortController()
  const lines = [
    line(T, 'GET /api/sesion.php HTTP/1.1', 401),
    line(T, 'GET /pages/home HTTP/1.1'),
    'garbage',
    line('28/Oct/2026:10:15:33 +0000', 'POST /login.php HTTP/1.1', 401),
  ]

  test('stores tracked lines and emits them on the calls channel', async () => {
    const deps = testDeps()
    const seen: [string, { path: string }][] = []
    deps.bus.on('calls', (event, data) =>
      seen.push([event, data as { path: string }]),
    )
    const stored = await followOnce(
      { ...deps, podman: podmanWith(lines) },
      ctl.signal,
      () => T_MS + 5000,
    )
    expect(stored).toBe(2)
    expect(seen).toHaveLength(2)
    expect(seen[0]![0]).toBe('call')
    expect(seen[0]![1].path).toBe('/api/sesion.php')
  })

  test('reconnecting does not duplicate what is already stored', async () => {
    const deps = testDeps()
    const withLines = { ...deps, podman: podmanWith(lines) }
    await followOnce(withLines, ctl.signal, () => T_MS + 5000)
    const again = await followOnce(withLines, ctl.signal, () => T_MS + 5000)
    expect(again).toBe(0)
    const n = deps.db
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM calls_log')
      .get()!.n
    expect(n).toBe(2)
  })

  test('fails with a reason when the front is down', async () => {
    const deps = testDeps()
    const podman = fixturePodman()
    await podman.stop('fixture-front')
    await expect(followOnce({ ...deps, podman }, ctl.signal)).rejects.toThrow(
      'front',
    )
  })

  test('works on the fixture access log', async () => {
    const deps = testDeps()
    const podman: PodmanClient = {
      ...deps.podman,
      logs: (id, o) => deps.podman.logs(id, { ...o, follow: false, tail: 12 }),
    }
    const stored = await followOnce({ ...deps, podman }, ctl.signal)
    expect(stored).toBeGreaterThan(0)
  })
})

test('retention keeps at most 500 rows and nothing older than 24 h', () => {
  const { db } = testDeps()
  const now = Date.UTC(2026, 9, 28, 12)
  const call = (atMs: number, path: string) => ({
    atMs,
    method: 'GET',
    path,
    status: 200,
    bytes: 1,
  })
  insertCall(db, call(now - 25 * 3_600_000, '/api/old.php'))
  for (let i = 0; i < 520; i++)
    insertCall(db, call(now - i * 1000, `/api/n${i}.php`))
  pruneCalls(db, now)
  const rows = db
    .query<{ n: number; old: number }, []>(
      "SELECT COUNT(*) AS n, SUM(path = '/api/old.php') AS old FROM calls_log",
    )
    .get()!
  expect(rows.n).toBe(500)
  expect(rows.old).toBe(0)
})

describe('recentCalls', () => {
  async function ask(deps: ReturnType<typeof testDeps>, query: string) {
    const app = createApp(deps, { distDir: '/nonexistent' })
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'tailscale-user-login': 'faku@x',
        },
        body: JSON.stringify({ query }),
      }),
    )
    return res.json()
  }
  function seeded() {
    const deps = testDeps()
    const rows: [string, string, number][] = [
      ['GET', '/api/sesion.php', 200],
      ['POST', '/login.php', 401],
      ['GET', '/api/equipos.php?pagina=*', 200],
      ['GET', '/api/incidencias.php', 500],
      ['GET', '/api/100%_real.php', 404],
    ]
    rows.forEach(([method, path, status], i) =>
      insertCall(deps.db, {
        atMs: T_MS + i * 1000,
        method,
        path,
        status,
        bytes: 10,
      }),
    )
    return deps
  }

  test('newest first, with the match count', async () => {
    const body = await ask(
      seeded(),
      '{ recentCalls(limit: 2) { total items { path status at } } }',
    )
    expect(body.data.recentCalls.total).toBe(5)
    expect(
      body.data.recentCalls.items.map((i: { path: string }) => i.path),
    ).toEqual(['/api/100%_real.php', '/api/incidencias.php'])
  })

  test('filters by status class, exact code and path substring', async () => {
    const deps = seeded()
    const q = async (args: string) =>
      (await ask(deps, `{ recentCalls${args} { total items { path } } }`)).data
        .recentCalls
    expect((await q('(status: "5xx")')).total).toBe(1)
    expect((await q('(status: "404")')).items[0].path).toBe(
      '/api/100%_real.php',
    )
    expect((await q('(path: "equipos")')).total).toBe(1)
    expect((await q('(status: "2xx", path: "api")')).total).toBe(2)
  })

  test('LIKE wildcards in the filter are literal', async () => {
    const r = (await ask(seeded(), '{ recentCalls(path: "%") { total } }')).data
      .recentCalls
    expect(r.total).toBe(1)
  })

  test('page size is clamped and a bad status is a stable error', async () => {
    const deps = seeded()
    const ok = await ask(
      deps,
      '{ recentCalls(limit: 100000) { items { id } } }',
    )
    expect(ok.data.recentCalls.items.length).toBe(5)
    const bad = await ask(deps, '{ recentCalls(status: "oops") { total } }')
    expect(bad.errors[0].extensions.code).toBe('BAD_INPUT')
  })
})
