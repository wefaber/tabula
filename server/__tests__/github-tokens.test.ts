import { afterEach, describe, expect, test } from 'bun:test'
import { githubClient } from '../adapters/github'
import { githubTokenFor, loadConfig } from '../config'
import { readiness } from '../ready'
import { testDeps } from '../test-utils'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('tokens de GitHub por organización', () => {
  test('cada organización tiene su variable, y GITHUB_TOKEN sigue valiendo para nexus-iti', () => {
    const both = loadConfig({
      GITHUB_TOKEN_NEXUS: 'n',
      GITHUB_TOKEN_WEFABER: 'w',
      GITHUB_TOKEN: 'viejo',
    })
    expect(both.github.tokens).toEqual({ 'nexus-iti': 'n', wefaber: 'w' })
    expect(both.github.token).toBe('n')
    expect(githubTokenFor(both, 'wefaber/tabula')).toBe('w')
    expect(githubTokenFor(both, 'Nexus-ITI/docs')).toBe('n')
    expect(githubTokenFor(both, 'otra-org/x')).toBe('')

    const legacy = loadConfig({ GITHUB_TOKEN: 'viejo' })
    expect(legacy.github.token).toBe('viejo')
    expect(githubTokenFor(legacy, 'wefaber/tabula')).toBe('')
  })

  test('el cliente manda el token de la organización dueña del repo', async () => {
    const seen: { url: string; auth: string | null }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        auth: new Headers(init.headers).get('authorization'),
      })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const tokens: Record<string, string> = { 'nexus-iti': 'n', wefaber: 'w' }
    const gh = githubClient('nexus-iti/gravida', (o) => tokens[o] ?? '')
    await gh.get('/repos/nexus-iti/docs/readme')
    await gh.get('/repos/wefaber/tabula/readme')
    await gh.get('/repos/otra-org/x')
    expect(seen.map((s) => s.auth)).toEqual(['Bearer n', 'Bearer w', null])
  })

  test('/ready dice qué token falta según los repos que lee Ether', async () => {
    const deps = testDeps()
    deps.config = {
      ...deps.config,
      fixtures: false,
      nexus: { ...deps.config.nexus, dbPassword: 'x' },
      github: {
        ...deps.config.github,
        token: 'n',
        tokens: { 'nexus-iti': 'n', wefaber: '' },
      },
      ether: {
        ...deps.config.ether,
        key: 'k',
        repos: ['nexus-iti/gravida', 'wefaber/tabula', 'otra-org/x'],
      },
    }
    const r = await readiness(deps)
    expect(r.problems.map((p) => p.detail)).toEqual([
      'Falta GITHUB_TOKEN_WEFABER para leer wefaber/tabula.',
      'No hay token de GitHub para la organización de otra-org/x.',
    ])
  })
})
