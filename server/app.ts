// HTTP shell: /health, /ready, token login, /graphql, /sse/:channel and, in production, the built SPA.
import { Elysia } from 'elysia'
import { createYoga } from 'graphql-yoga'
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import {
  closeSession,
  identify,
  openSession,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  userByToken,
} from './auth'
import { audit } from './audit'
import { CHANNEL, sseResponse } from './bus'
import type { Ctx, Deps } from './deps'

import { limitsPlugin } from './graphql/limits'
import { schema } from './graphql/schema'
import { readiness } from './ready'

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const httpError = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status)

/** Failed token exchanges across everyone (all traffic arrives from loopback, so there is no per-address bucket). */
function failureWindow(max: number, windowMs: number) {
  let hits: number[] = []
  return {
    blocked(now = Date.now()) {
      hits = hits.filter((t) => now - t < windowMs)
      return hits.length >= max
    },
    hit(now = Date.now()) {
      hits.push(now)
    },
  }
}

export function createApp(
  deps: Deps,
  { distDir = join(import.meta.dir, '..', 'dist') } = {},
) {
  const yoga = createYoga<{ ctx: Ctx }>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: !deps.config.production,
    landingPage: false,
    maskedErrors: true,
    plugins: [limitsPlugin()],
    context: ({ ctx }) => ctx,
  })

  const authOptions = {
    trustHeader: deps.config.trustServeHeader,
    devLogin: deps.config.devLogin,
  }
  const tokenFailures = failureWindow(20, 10 * 60_000)
  const secure = deps.config.production

  const app = new Elysia()
    .get('/health', () => json({ ok: true }))
    .get('/ready', async () => {
      const r = await readiness(deps)
      return json(r, r.ok ? 200 : 503)
    })
    .post('/auth/token', async ({ request }) => {
      if (tokenFailures.blocked())
        return httpError(
          429,
          'TOO_MANY_ATTEMPTS',
          'Demasiados intentos. Probá de nuevo en unos minutos.',
        )
      const body = (await request.json().catch(() => ({}))) as {
        token?: unknown
      }
      const found =
        typeof body.token === 'string'
          ? userByToken(deps.db, body.token.trim())
          : null
      if (!found) {
        tokenFailures.hit()
        return httpError(
          401,
          'BAD_TOKEN',
          'Ese token no sirve: revisalo o pedí uno nuevo.',
        )
      }
      const session = openSession(deps.db, found.id, found.tokenId)
      audit(deps.db, found, 'session.open', String(found.tokenId))
      return json({ ok: true }, 200, {
        'set-cookie': sessionCookie(session.value, session.expires, secure),
      })
    })
    .post('/auth/logout', ({ request }) => {
      const value = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
      if (value) closeSession(deps.db, value)
      return json({ ok: true }, 200, {
        'set-cookie': sessionCookie('', null, secure),
      })
    })
    .all('/graphql', async ({ request }) => {
      const auth = await identify(deps.db, request, authOptions, deps.whois)
      if (!auth)
        return httpError(
          401,
          'UNAUTHENTICATED',
          'Entrá con tu cuenta del tailnet o con un token.',
        )
      return yoga.fetch(request, {
        ctx: { ...deps, user: auth.user, method: auth.method },
      })
    })
    .get('/sse/:channel', async ({ request, params }) => {
      if (!(await identify(deps.db, request, authOptions, deps.whois)))
        return httpError(401, 'UNAUTHENTICATED', 'Sin sesión.')
      if (!CHANNEL.test(params.channel))
        return httpError(400, 'BAD_CHANNEL', 'Canal inválido.')
      return sseResponse(deps.bus, params.channel, request.signal)
    })

  if (existsSync(distDir)) {
    const index = join(distDir, 'index.html')
    app.get('/*', ({ request }) => {
      const path = normalize(
        decodeURIComponent(new URL(request.url).pathname),
      ).replace(/^([/\\])+/, '')
      const file = join(distDir, path)
      if (
        path &&
        file.startsWith(distDir) &&
        existsSync(file) &&
        !file.endsWith(distDir)
      ) {
        const immutable = path.startsWith('assets')
        return new Response(Bun.file(file), {
          headers: {
            'cache-control': immutable
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          },
        })
      }
      return new Response(Bun.file(index), {
        headers: { 'cache-control': 'no-cache', 'content-type': 'text/html' },
      })
    })
  }

  return app
}
