import { describe, expect, test } from 'bun:test'
import type { GithubClient } from '../../../adapters/github'
import { testDeps } from '../../../test-utils'
import { userByLogin } from '../../../auth'
import {
  collectKnowledge,
  isReadable,
  outline,
  rankFiles,
  terms,
  type RepoMap,
} from '../knowledge'
import { EtherRuns } from '../runner'
import { fixtureEther } from '../client'
import { recentTurns, addMessage, touchThread } from '../store'

const GRAVIDA: RepoMap = {
  repo: 'nexus-iti/gravida',
  branch: 'main',
  truncated: false,
  files: [
    { path: 'README.md', size: 900 },
    { path: 'api/login.php', size: 2000 },
    { path: 'api/incidencias.php', size: 4000 },
    { path: 'front/src/App.tsx', size: 3000 },
    { path: 'node_modules/x/index.js', size: 10 },
    { path: 'front/logo.png', size: 5000 },
  ],
}

const DOCS: RepoMap = {
  repo: 'nexus-iti/docs',
  branch: 'main',
  truncated: true,
  files: [
    { path: 'docs/deploy.md', size: 1200 },
    { path: 'docs/login-flow.md', size: 800 },
    { path: 'big/dump.sql', size: 900_000 },
  ],
}

describe('conocimiento de los repos', () => {
  test('solo se leen archivos de texto razonables, sin dependencias', () => {
    expect(isReadable({ path: 'api/login.php', size: 10 })).toBe(true)
    expect(isReadable({ path: 'front/logo.png', size: 10 })).toBe(false)
    expect(isReadable({ path: 'node_modules/x/index.js', size: 10 })).toBe(
      false,
    )
    expect(isReadable({ path: 'big/dump.sql', size: 900_000 })).toBe(false)
  })

  test('el esquema lista carpetas con su cantidad y avisa si es parcial', () => {
    const text = outline(GRAVIDA)
    expect(text).toContain('nexus-iti/gravida (rama main, 6 archivos)')
    expect(text).toContain('  api/ (2)')
    expect(text).toContain('  README.md')
    expect(text).not.toContain('node_modules')
    expect(outline(DOCS)).toContain('listado parcial')
    expect(outline(GRAVIDA, 1)).toContain('más)')
  })

  test('las palabras de la pregunta pierden acentos y relleno', () => {
    expect(terms('¿Cómo funciona el login de la API?')).toEqual([
      'login',
      'api',
    ])
  })

  test('el nombre pesa más que la carpeta, la prosa (.md) desempata y se mezclan los repos', () => {
    const ranked = rankFiles([GRAVIDA, DOCS], 'cómo es el login')
    expect(ranked.map((r) => r.path)).toEqual([
      'docs/login-flow.md',
      'api/login.php',
    ])
    expect(rankFiles([GRAVIDA], 'zzz inexistente')).toEqual([])
    expect(rankFiles([GRAVIDA], '¿y?')).toEqual([])
  })
})

function fakeGithub(): GithubClient & { paths: string[] } {
  const paths: string[] = []
  const b64 = (s: string) => Buffer.from(s).toString('base64')
  const trees: Record<string, RepoMap> = {
    'nexus-iti/gravida': GRAVIDA,
    'nexus-iti/docs': DOCS,
  }
  return {
    repo: 'nexus-iti/gravida',
    paths,
    async deployInProgress() {
      return false
    },
    async get<T>(path: string) {
      paths.push(path)
      const repo = /^\/repos\/([^/]+\/[^/]+)/.exec(path)?.[1] ?? ''
      const map = trees[repo]
      if (!map) return null
      if (path === `/repos/${repo}`) return { default_branch: 'main' } as T
      if (path.includes('/git/trees/'))
        return {
          truncated: map.truncated,
          tree: map.files.map((f) => ({ ...f, type: 'blob' })),
        } as T
      const file = decodeURIComponent(
        /\/contents\/([^?]+)/.exec(path)?.[1] ?? '',
      )
      return { encoding: 'base64', content: b64(`contenido de ${file}`) } as T
    },
  }
}

describe('collectKnowledge', () => {
  test('trae la estructura de ambos repos y los archivos que coinciden', async () => {
    const deps = testDeps()
    const github = fakeGithub()
    const k = await collectKnowledge(
      { config: deps.config, github },
      'el login',
    )
    expect(k.structure).toContain('nexus-iti/gravida')
    expect(k.structure).toContain('nexus-iti/docs')
    expect(k.sources.map((s) => `${s.repo}:${s.path}`)).toEqual([
      'nexus-iti/docs:docs/login-flow.md',
      'nexus-iti/gravida:api/login.php',
    ])
    expect(k.sources[0]).toMatchObject({
      n: 1,
      text: 'contenido de docs/login-flow.md',
    })
  })

  test('sin coincidencias lee el README de cada repo', async () => {
    const deps = testDeps()
    const k = await collectKnowledge(
      { config: deps.config, github: fakeGithub() },
      'zzz',
    )
    expect(k.sources.map((s) => s.path)).toEqual(['README.md'])
  })

  test('repite la consulta sin volver a GitHub mientras el caché vale', async () => {
    const deps = testDeps()
    const github = fakeGithub()
    await collectKnowledge({ config: deps.config, github }, 'el login', 1000)
    const first = github.paths.length
    await collectKnowledge({ config: deps.config, github }, 'el login', 2000)
    expect(github.paths.length).toBe(first)
    await collectKnowledge(
      { config: deps.config, github },
      'el login',
      1000 + 11 * 60_000,
    )
    expect(github.paths.length).toBeGreaterThan(first)
  })

  test('un repo que no responde no rompe la consulta', async () => {
    const deps = testDeps()
    const github: GithubClient = {
      repo: 'x',
      async get() {
        throw new Error('rate limit')
      },
      async deployInProgress() {
        return false
      },
    }
    const k = await collectKnowledge({ config: deps.config, github }, 'login')
    expect(k).toEqual({ structure: '', sources: [] })
  })
})

describe('runner con contexto', () => {
  test('el prompt lleva estructura, fuentes e historial, y las lecturas quedan como pasos', async () => {
    const deps = testDeps()
    deps.github = fakeGithub()
    const faku = userByLogin(deps.db, 'faku@x')!
    const fx = fixtureEther()
    const runs = new EtherRuns(deps, fx, { pollMs: 5 })
    const first = await runs.ask(faku, 'ctx', 'hola')
    await until(() => runs.get(first.runId)?.state.phase === 'completed')
    const { runId } = await runs.ask(faku, 'ctx', 'explicame el login')
    await until(() => runs.get(runId)?.state.phase === 'completed')
    const input = fx.inputs.at(-1)?.input ?? ''
    expect(input).toContain('<structure>')
    expect(input).toContain('[2] nexus-iti/gravida: api/login.php')
    expect(input).toContain('<history>')
    expect(input).toContain('Pregunta: hola')
    const read = runs.get(runId)?.state.tools.filter((t) => t.tool === 'leyó')
    expect(read?.map((t) => t.preview)).toEqual([
      'nexus-iti/docs: docs/login-flow.md',
      'nexus-iti/gravida: api/login.php',
    ])
  })

  test('el historial toma solo intercambios respondidos, los últimos', () => {
    const deps = testDeps()
    const faku = userByLogin(deps.db, 'faku@x')!
    const now = new Date()
    const t = touchThread(deps.db, faku.id, 'h', 'x', now)
    for (let i = 1; i <= 5; i++) {
      addMessage(deps.db, t, 'user', `q${i}`, now)
      addMessage(deps.db, t, 'ether', `a${i}`, now, {
        status: i === 5 ? 'failed' : 'done',
      })
    }
    expect(recentTurns(deps.db, faku.id, 'h').map((x) => x.q)).toEqual([
      'q2',
      'q3',
      'q4',
    ])
  })
})

async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout esperando estado')
    await new Promise((r) => setTimeout(r, 5))
  }
}
