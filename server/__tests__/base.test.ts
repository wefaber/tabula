import { describe, expect, test } from 'bun:test'
import { demux } from '../adapters/podmanStream'
import { createApp } from '../app'
import {
  authenticate,
  createToken,
  identify,
  revokeToken,
  userByLogin,
} from '../auth'
import { fixtureWhois, isTailnetIp, tailscaleWhois } from '../auth/whois'
import { parseUsers } from '../config'
import { MAX_QUERY_LENGTH, clampPage } from '../graphql/limits'
import { testDeps } from '../test-utils'

function frame(stream: 1 | 2, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text)
  const out = new Uint8Array(8 + payload.length)
  out[0] = stream
  new DataView(out.buffer).setUint32(4, payload.length)
  out.set(payload, 8)
  return out
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk)
      c.close()
    },
  })
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('demux', () => {
  test('splits frames into lines and keeps the stream', async () => {
    const lines = await collect(
      demux(streamOf(frame(1, 'a\nb\n'), frame(2, 'err\n'))),
    )
    expect(lines).toEqual([
      { stream: 'stdout', text: 'a' },
      { stream: 'stdout', text: 'b' },
      { stream: 'stderr', text: 'err' },
    ])
  })

  test('joins a line cut across frames and across chunks', async () => {
    const joined = new Uint8Array([...frame(1, 'hel'), ...frame(1, 'lo\n')])
    const lines = await collect(
      demux(streamOf(joined.slice(0, 11), joined.slice(11))),
    )
    expect(lines).toEqual([{ stream: 'stdout', text: 'hello' }])
  })

  test('flushes a last line with no newline', async () => {
    const lines = await collect(demux(streamOf(frame(1, 'tail'))))
    expect(lines).toEqual([{ stream: 'stdout', text: 'tail' }])
  })

  test('raw keeps payloads untouched', async () => {
    const lines = await collect(
      demux(streamOf(frame(1, 'x\ny')), { raw: true }),
    )
    expect(lines).toEqual([{ stream: 'stdout', text: 'x\ny' }])
  })

  test('unframed bytes (tty) pass through as stdout', async () => {
    const lines = await collect(
      demux(streamOf(new TextEncoder().encode('plain text line\n'))),
    )
    expect(lines).toEqual([{ stream: 'stdout', text: 'plain text line' }])
  })
})

describe('config', () => {
  test('parseUsers reads login:role:name and lowercases the login', () => {
    expect(parseUsers('Faku@X:admin:Faku, pablo@x')).toEqual([
      { login: 'faku@x', role: 'admin', name: 'Faku' },
      { login: 'pablo@x', role: 'member', name: 'pablo' },
    ])
  })
  test('parseUsers rejects an unknown role', () => {
    expect(() => parseUsers('a@x:root')).toThrow('rol inválido')
  })
})

describe('auth', () => {
  const trust = { trustHeader: true }
  const req = (headers: Record<string, string>) =>
    new Request('http://localhost/graphql', { headers })

  test('tailnet header only works for allowlisted logins', () => {
    const { db } = testDeps()
    expect(
      authenticate(db, req({ 'tailscale-user-login': 'faku@x' }), trust)
        ?.method,
    ).toBe('tailnet')
    expect(
      authenticate(db, req({ 'tailscale-user-login': 'intruso@x' }), trust),
    ).toBeNull()
  })

  test('bearer token works until revoked', () => {
    const { db } = testDeps()
    const user = userByLogin(db, 'pablo@x')!
    const { id, token } = createToken(db, user.id, 'notebook')
    expect(
      authenticate(db, req({ authorization: `Bearer ${token}` }))?.user.login,
    ).toBe('pablo@x')
    expect(revokeToken(db, id, user)).toBe(true)
    expect(
      authenticate(db, req({ authorization: `Bearer ${token}` })),
    ).toBeNull()
  })

  test('a member cannot revoke someone else’s token, an admin can', () => {
    const { db } = testDeps()
    const pablo = userByLogin(db, 'pablo@x')!
    const faku = userByLogin(db, 'faku@x')!
    const { id } = createToken(db, faku.id, 'mio')
    expect(revokeToken(db, id, pablo)).toBe(false)
    expect(revokeToken(db, id, faku)).toBe(true)
  })

  test('only the hash is stored', () => {
    const { db } = testDeps()
    const { token } = createToken(db, userByLogin(db, 'faku@x')!.id, 't')
    const rows = db.query<{ hash: string }, []>('SELECT hash FROM tokens').all()
    expect(rows.some((r) => r.hash === token)).toBe(false)
  })

  test('a user dropped from the allowlist loses access', async () => {
    const deps = testDeps()
    const { syncUsers } = await import('../auth')
    syncUsers(deps.db, [{ login: 'faku@x', name: 'Faku', role: 'admin' }])
    expect(
      authenticate(deps.db, req({ 'tailscale-user-login': 'pablo@x' }), trust),
    ).toBeNull()
  })
})

describe('http app', () => {
  const app = () => createApp(testDeps(), { distDir: '/nonexistent' })
  const post = (
    a: ReturnType<typeof app>,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    a.handle(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    )

  test('/health and /ready answer without auth', async () => {
    const a = app()
    expect(
      (await a.handle(new Request('http://localhost/health'))).status,
    ).toBe(200)
    const ready = await a.handle(new Request('http://localhost/ready'))
    expect(ready.status).toBe(200)
    expect((await ready.json()).ok).toBe(true)
  })

  test('/graphql without identity is 401 with a stable code', async () => {
    const res = await post(app(), '/graphql', { query: '{ me { login } }' })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED')
  })

  test('/graphql answers for a tailnet user', async () => {
    const res = await post(
      app(),
      '/graphql',
      { query: '{ me { login role } authMethod }' },
      { 'tailscale-user-login': 'faku@x' },
    )
    expect((await res.json()).data).toEqual({
      me: { login: 'faku@x', role: 'admin' },
      authMethod: 'tailnet',
    })
  })

  test('token exchange sets an HttpOnly cookie that then opens /graphql', async () => {
    const deps = testDeps()
    const a = createApp(deps, { distDir: '/nonexistent' })
    const { token } = createToken(
      deps.db,
      userByLogin(deps.db, 'pablo@x')!.id,
      'phone',
    )
    const res = await post(a, '/auth/token', { token })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    const gqlRes = await post(
      a,
      '/graphql',
      { query: '{ authMethod }' },
      { cookie: cookie.split(';')[0]! },
    )
    expect((await gqlRes.json()).data.authMethod).toBe('session')
  })

  test('a wrong token is 401 and never opens a session', async () => {
    const res = await post(app(), '/auth/token', { token: 'tbl_nope' })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('token creation is audited and the plain token is returned once', async () => {
    const a = app()
    const headers = { 'tailscale-user-login': 'faku@x' }
    const created = await post(
      a,
      '/graphql',
      { query: 'mutation { createToken(label: "x") { id token } }' },
      headers,
    )
    const { token } = (await created.json()).data.createToken
    expect(token).toStartWith('tbl_')
    const log = await post(
      a,
      '/graphql',
      { query: '{ audit { action userLogin } tokens { label } }' },
      headers,
    )
    const data = (await log.json()).data
    expect(data.audit[0]).toEqual({
      action: 'token.create',
      userLogin: 'faku@x',
    })
    expect(JSON.stringify(data)).not.toContain(token)
  })

  test('limits: deep queries and long queries are rejected', async () => {
    const a = app()
    const headers = { 'tailscale-user-login': 'faku@x' }
    const deep = `{ ${'me { '.repeat(9)}login${' }'.repeat(9)} }`
    const r1 = await post(a, '/graphql', { query: deep }, headers)
    expect(JSON.stringify(await r1.json())).toMatch(
      /QUERY_TOO_DEEP|Cannot query field/,
    )
    const r2 = await post(
      a,
      '/graphql',
      { query: `{ me { login } } #${'x'.repeat(MAX_QUERY_LENGTH)}` },
      headers,
    )
    expect(JSON.stringify(await r2.json())).toContain('QUERY_TOO_LONG')
  })

  test('/sse rejects unknown channels and anonymous callers', async () => {
    const a = app()
    expect(
      (await a.handle(new Request('http://localhost/sse/containers'))).status,
    ).toBe(401)
    const bad = await a.handle(
      new Request('http://localhost/sse/..%2Fetc', {
        headers: { 'tailscale-user-login': 'faku@x' },
      }),
    )
    expect(bad.status).toBe(400)
  })
})

test('clampPage keeps page sizes in 1..100', () => {
  expect(clampPage(0)).toBe(1)
  expect(clampPage(500)).toBe(100)
  expect(clampPage(null)).toBe(50)
})

test('devLogin stands in for the tailnet header, and is off in production', async () => {
  const { loadConfig } = await import('../config')
  const dev = loadConfig({ TABULA_DEV_LOGIN: 'Dev@Local' })
  const prod = loadConfig({
    NODE_ENV: 'production',
    TABULA_DEV_LOGIN: 'dev@local',
  })
  expect(dev.devLogin).toBe('dev@local')
  expect(prod.devLogin).toBe('')
})

describe('tailnet identity (whois)', () => {
  const withIp = (ip: string, headers: Record<string, string> = {}) =>
    new Request('http://localhost/graphql', {
      headers: { 'x-real-ip': ip, ...headers },
    })
  const opts = { trustHeader: false, devLogin: '' }

  test('a device of an allowlisted login gets in, a stranger does not', async () => {
    const { db } = testDeps()
    const whois = fixtureWhois({
      '100.64.0.7': 'pablo@x',
      '100.64.0.8': 'intruso@x',
    })
    expect(
      (await identify(db, withIp('100.64.0.7'), opts, whois))?.user.login,
    ).toBe('pablo@x')
    expect(await identify(db, withIp('100.64.0.8'), opts, whois)).toBeNull()
    expect(await identify(db, withIp('100.64.0.9'), opts, whois)).toBeNull()
  })

  test('the forged Tailscale-User-Login header is ignored behind nginx', async () => {
    const { db } = testDeps()
    const req = withIp('100.64.0.9', { 'tailscale-user-login': 'faku@x' })
    expect(await identify(db, req, opts, fixtureWhois())).toBeNull()
  })

  test('a token still wins and needs no tailnet', async () => {
    const { db } = testDeps()
    const { token } = createToken(db, userByLogin(db, 'faku@x')!.id, 't')
    const req = withIp('203.0.113.5', { authorization: `Bearer ${token}` })
    expect((await identify(db, req, opts, fixtureWhois()))?.method).toBe(
      'token',
    )
  })

  test('only tailnet addresses are ever looked up', () => {
    expect(isTailnetIp('100.64.0.1')).toBe(true)
    expect(isTailnetIp('100.127.255.254')).toBe(true)
    expect(isTailnetIp('fd7a:115c:a1e0::1')).toBe(true)
    for (const ip of [
      '100.63.0.1',
      '100.128.0.1',
      '127.0.0.1',
      '203.0.113.5',
      'x',
      '',
    ]) {
      expect(isTailnetIp(ip)).toBe(false)
    }
  })

  test('tailscaleWhois skips non-tailnet IPs without touching the socket', async () => {
    const whois = tailscaleWhois('/nonexistent.sock')
    expect(await whois('203.0.113.5')).toBeNull()
    expect(await whois('100.64.0.1')).toBeNull() // socket missing -> no identity, no throw
  })

  test('the app answers a tailnet device through whois', async () => {
    const deps = testDeps('faku@x:admin:Faku', { '100.64.0.7': 'faku@x' })
    const app = createApp(deps, { distDir: '/nonexistent' })
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': '100.64.0.7',
        },
        body: JSON.stringify({ query: '{ me { login } authMethod }' }),
      }),
    )
    expect((await res.json()).data).toEqual({
      me: { login: 'faku@x' },
      authMethod: 'tailnet',
    })
  })
})
