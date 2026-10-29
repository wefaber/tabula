import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { githubFixtures } from '../../../adapters/github'
import { createApp } from '../../../app'
import { testDeps } from '../../../test-utils'
import { registerGitFixtures, shaOf } from '../fixtures'
import { snapshot } from '../github'
import {
  isActive,
  parseDeployState,
  parsePushes,
  parseRuns,
  runState,
  signature,
  summarizeRuns,
  toGitGraph,
  worstState,
  type BranchCommits,
  type RawCommit,
} from '../graph'
import { makePoll } from '../index'

beforeAll(() => registerGitFixtures())

const commit = (
  sha: string,
  date: string,
  parents: string[] = [],
): RawCommit => ({
  sha,
  commit: {
    message: `msg ${sha}`,
    committer: { date },
    author: { name: 'A', date },
  },
  author: { login: 'a' },
  parents: parents.map((p) => ({ sha: p })),
})

describe('toGitGraph', () => {
  test('recorded repo: lanes by branch, parents before children, merges as edges', async () => {
    const { graph, commits } = await snapshot(testDeps())
    expect(graph.nodes).toHaveLength(17)
    expect(graph.columns).toBe(17)
    expect(graph.lanes).toBe(5)
    expect(graph.edges).toHaveLength(20)

    const col = new Map(graph.nodes.map((n) => [n.sha, n.column]))
    for (const e of graph.edges)
      expect(col.get(e.from)!).toBeLessThan(col.get(e.to)!)

    const laneOf = (id: string) =>
      graph.nodes.find((n) => n.sha === shaOf(id))!.lane
    // main and dev first, then by most recent tip.
    expect(laneOf('c13')).toBe(0)
    expect(laneOf('c09')).toBe(0)
    expect(laneOf('c02')).toBe(0)
    expect(laneOf('c17')).toBe(1)
    expect(laneOf('c08')).toBe(1)
    expect(laneOf('c16')).toBe(2)
    expect(laneOf('c10')).toBe(3)
    expect(laneOf('c06')).toBe(4)
    expect(laneOf('c05')).toBe(4)
    expect(commits.get(shaOf('c06'))?.branch).toBe('feat/ecografias')
  })

  test('branch labels sit on the tips', async () => {
    const { graph } = await snapshot(testDeps())
    expect(
      Object.fromEntries(graph.branches.map((b) => [b.name, b.sha])),
    ).toEqual({
      main: shaOf('c13'),
      dev: shaOf('c17'),
      'feat/ecografias': shaOf('c06'),
      'hotfix/login': shaOf('c10'),
      'feat/reportes': shaOf('c16'),
    })
  })

  test('node and commit info carry title, body, author and url', async () => {
    const { graph, commits } = await snapshot(testDeps())
    const c03 = commits.get(shaOf('c03'))!
    expect(c03.title).toBe('feat(api): endpoint de turnos')
    expect(c03.message).toContain('paginación por cursor')
    expect(c03.author).toBe('Pablo')
    expect(c03.login).toBe('pablo-iti')
    expect(c03.url).toContain(`/commit/${shaOf('c03')}`)
    expect(graph.nodes.find((n) => n.sha === shaOf('c03'))?.message).toBe(
      'feat(api): endpoint de turnos',
    )
  })

  test('a child dated before its parent still lands after it', () => {
    const input: BranchCommits[] = [
      {
        name: 'main',
        tip: 'b',
        commits: [
          commit('b', '2026-01-01T00:00:00Z', ['a']),
          commit('a', '2026-01-02T00:00:00Z'),
        ],
      },
    ]
    const { graph } = toGitGraph(input)
    expect(graph.nodes.map((n) => n.sha)).toEqual(['a', 'b'])
  })

  test('branches on the same tip share a lane and empty lanes disappear', () => {
    const list = [
      commit('b', '2026-01-02T00:00:00Z', ['a']),
      commit('a', '2026-01-01T00:00:00Z'),
    ]
    const { graph } = toGitGraph([
      { name: 'main', tip: 'b', commits: list },
      { name: 'dev', tip: 'b', commits: list },
    ])
    expect(graph.lanes).toBe(1)
    expect(graph.nodes.every((n) => n.lane === 0)).toBe(true)
    expect(graph.branches.map((b) => b.name)).toEqual(['main', 'dev'])
  })

  test('parents outside the loaded page draw no edge', () => {
    const { graph } = toGitGraph([
      {
        name: 'main',
        tip: 'b',
        commits: [commit('b', '2026-01-02T00:00:00Z', ['gone'])],
      },
    ])
    expect(graph.edges).toEqual([])
  })

  test('keeps only the most recent branches beyond the cap', () => {
    const branches = ['x1', 'x2', 'x3', 'x4'].map((name, i) => ({
      name,
      tip: name,
      commits: [commit(name, `2026-01-0${i + 1}T00:00:00Z`)],
    }))
    const { graph } = toGitGraph(branches, 2)
    expect(graph.branches.map((b) => b.name)).toEqual(['x4', 'x3'])
  })

  test('empty input is an empty one-lane graph', () => {
    const { graph } = toGitGraph([])
    expect(graph).toEqual({
      lanes: 1,
      columns: 0,
      nodes: [],
      branches: [],
      edges: [],
    })
  })
})

describe('parsePushes', () => {
  test('recorded activity: newest first, who, ref and when', async () => {
    const raw = githubFixtures.get(
      '/repos/nexus-iti/gravida/activity?activity_type=push&per_page=50',
    ) as never
    const pushes = parsePushes(raw, 3)
    expect(pushes).toHaveLength(3)
    expect(pushes[0]).toMatchObject({
      actor: 'faku',
      ref: 'dev',
      kind: 'branch',
      after: shaOf('c17'),
      at: '2026-10-27T11:52:00Z',
    })
    expect(pushes.map((p) => p.at)).toEqual(
      [...pushes.map((p) => p.at)].sort().reverse(),
    )
  })

  test('tags are kinds of their own and malformed entries are dropped', () => {
    const pushes = parsePushes([
      {
        id: 1,
        ref: 'refs/tags/v1.0',
        after: 'a'.repeat(40),
        timestamp: '2026-01-01T00:00:00Z',
        actor: { login: 'x' },
      },
      {
        id: 2,
        ref: 'refs/pull/3/head',
        after: 'b',
        timestamp: '2026-01-01T00:00:00Z',
      },
      { id: 3, ref: 'refs/heads/dev', after: 'c' },
      {
        id: 4,
        ref: 'refs/heads/dev',
        after: 'd',
        timestamp: '2026-01-02T00:00:00Z',
        actor: null,
      },
    ])
    expect(pushes.map((p) => [p.ref, p.kind, p.actor])).toEqual([
      ['dev', 'branch', 'desconocido'],
      ['v1.0', 'tag', 'x'],
    ])
    expect(parsePushes(null)).toEqual([])
  })
})

describe('runs', () => {
  test('states map from status + conclusion', () => {
    expect(runState({ status: 'completed', conclusion: 'success' })).toBe(
      'success',
    )
    expect(runState({ status: 'completed', conclusion: 'timed_out' })).toBe(
      'failure',
    )
    expect(runState({ status: 'completed', conclusion: 'cancelled' })).toBe(
      'cancelled',
    )
    expect(runState({ status: 'completed', conclusion: 'skipped' })).toBe(
      'skipped',
    )
    expect(runState({ status: 'in_progress', conclusion: null })).toBe(
      'running',
    )
    expect(runState({ status: 'queued', conclusion: null })).toBe('queued')
  })

  test('recorded runs: deploy is told from CI by workflow path', () => {
    const runs = parseRuns(
      githubFixtures.get(
        '/repos/nexus-iti/gravida/actions/runs?per_page=100',
      ) as never,
    )
    const c17 = summarizeRuns(runs.filter((r) => r.sha === shaOf('c17')))
    expect(c17).toMatchObject({ ci: 'success', deploy: 'running' })
    const c12 = summarizeRuns(runs.filter((r) => r.sha === shaOf('c12')))
    expect(c12).toMatchObject({ ci: 'success', deploy: 'failure' })
    expect(summarizeRuns([])).toEqual({ ci: null, deploy: null, runs: [] })
  })

  test('a failure outranks running and success', () => {
    const mk = (state: 'success' | 'failure' | 'running') =>
      ({
        id: 1,
        name: 'CI',
        kind: 'ci',
        state,
        url: '',
        at: '',
        sha: 'x',
      }) as const
    expect(worstState([mk('success'), mk('failure'), mk('running')])).toBe(
      'failure',
    )
    expect(worstState([mk('success'), mk('running')])).toBe('running')
    expect(worstState([])).toBeNull()
  })
})

describe('deploy state', () => {
  test('parses the env file written by nexus-deploy.sh', () => {
    const state = parseDeployState(
      'TAG=abc1234\nDEPLOYED_AT=2026-10-27T12:00:00Z\nCOMMIT=abc1234def5678abc1234def5678abc1234def56\n',
    )
    expect(state).toEqual({
      tag: 'abc1234',
      deployedAt: '2026-10-27T12:00:00Z',
      commit: 'abc1234def5678abc1234def5678abc1234def56',
    })
    expect(isActive(state, 'abc1234def5678abc1234def5678abc1234def56')).toBe(
      true,
    )
    expect(isActive(state, 'ffff234def5678abc1234def5678abc1234def56')).toBe(
      false,
    )
    expect(isActive(null, 'abc')).toBe(false)
  })

  test('the tag alone (short commit) is enough, a dash tag is nothing', () => {
    const state = parseDeployState('TAG=abc1234\nCOMMIT=-\n')
    expect(isActive(state, 'abc1234ffffffffffffffffffffffffffffffff')).toBe(
      true,
    )
    expect(parseDeployState('TAG=-\n')).toBeNull()
    expect(parseDeployState('')).toBeNull()
  })
})

describe('signature', () => {
  test('changes with a new push or a run changing state, not with a re-read', async () => {
    const a = await snapshot(testDeps())
    const b = await snapshot(testDeps())
    expect(a.signature).toBe(b.signature)
    const moved = signature(a.graph, a.pushes.slice(1), a.runs)
    expect(moved).not.toBe(a.signature)
    const flipped = signature(
      a.graph,
      a.pushes,
      a.runs.map((r, i) => (i === 0 ? { ...r, state: 'success' as const } : r)),
    )
    expect(flipped).not.toBe(a.signature)
  })
})

describe('poll job', () => {
  test('emits `git` only when something changed', async () => {
    const deps = testDeps()
    const events: string[] = []
    deps.bus.on('git', (event) => events.push(event))
    const poll = makePoll(deps)
    await poll()
    await poll()
    expect(events).toEqual([])

    const key =
      '/repos/nexus-iti/gravida/activity?activity_type=push&per_page=50'
    const original = githubFixtures.get(key) as unknown[]
    try {
      githubFixtures.set(key, [
        {
          id: 9999,
          ref: 'refs/heads/dev',
          before: shaOf('c17'),
          after: shaOf('c17'),
          timestamp: '2026-10-28T10:00:00Z',
          actor: { login: 'faku' },
        },
        ...original,
      ])
      await poll()
      expect(events).toEqual(['changed'])
      await poll()
      expect(events).toEqual(['changed'])
    } finally {
      githubFixtures.set(key, original)
    }
  })
})

describe('graphql', () => {
  const headers = { 'tailscale-user-login': 'faku@x' }
  const run = async (
    deps: ReturnType<typeof testDeps>,
    query: string,
    variables?: Record<string, unknown>,
  ) => {
    const app = createApp(deps, { distDir: '/nonexistent' })
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
      }),
    )
    return (await res.json()) as {
      data?: Record<string, any>
      errors?: { message: string; extensions?: { code?: string } }[]
    }
  }

  test('gitGraph returns lanes, nodes, branch tips and edges', async () => {
    const { data } = await run(
      testDeps(),
      '{ gitGraph { lanes columns nodes { sha short message column lane author } branches { name sha ci } edges { from to } } }',
    )
    expect(data!.gitGraph.lanes).toBe(5)
    expect(data!.gitGraph.nodes).toHaveLength(17)
    const dev = data!.gitGraph.branches.find(
      (b: { name: string }) => b.name === 'dev',
    )
    expect(dev).toEqual({ name: 'dev', sha: shaOf('c17'), ci: 'success' })
    const reportes = data!.gitGraph.branches.find(
      (b: { name: string }) => b.name === 'feat/reportes',
    )
    expect(reportes.ci).toBe('failure')
  })

  test('gitPushes respects limit and resolves the pushed commit title', async () => {
    const { data } = await run(
      testDeps(),
      'query($n: Int) { gitPushes(limit: $n) { actor ref kind at short title } }',
      { n: 2 },
    )
    expect(data!.gitPushes).toHaveLength(2)
    expect(data!.gitPushes[0]).toMatchObject({
      actor: 'faku',
      ref: 'dev',
      title: 'feat(front): turnos por profesional',
    })
  })

  test('gitCommit: message, author, CI, deploy run, and the active tag', async () => {
    const deps = testDeps()
    const dir = mkdtempSync(join(tmpdir(), 'git-state-'))
    const stateFile = join(dir, 'nexus-deploy.env')
    deps.config.nexus.stateFile = stateFile
    const query =
      'query($sha: String!) { gitCommit(sha: $sha) { sha title message author login branch ci deploy active deployedAt parents runs { name kind state } } }'

    const missing = await run(deps, query, { sha: shaOf('c17') })
    expect(missing.errors).toBeUndefined()
    expect(missing.data!.gitCommit).toMatchObject({
      title: 'feat(front): turnos por profesional',
      author: 'Faku',
      login: 'faku',
      branch: 'dev',
      ci: 'success',
      deploy: 'running',
      active: false,
      deployedAt: null,
      parents: [shaOf('c14')],
    })
    expect(
      missing.data!.gitCommit.runs.map((r: { kind: string }) => r.kind).sort(),
    ).toEqual(['ci', 'deploy'])

    writeFileSync(
      stateFile,
      `TAG=${shaOf('c14').slice(0, 7)}\nDEPLOYED_AT=2026-10-24T15:24:00Z\nCOMMIT=${shaOf('c14')}\n`,
    )
    const active = await run(deps, query, { sha: shaOf('c14') })
    expect(active.data!.gitCommit).toMatchObject({
      active: true,
      deployedAt: '2026-10-24T15:24:00Z',
      deploy: 'success',
    })
    const other = await run(deps, query, { sha: shaOf('c17') })
    expect(other.data!.gitCommit.active).toBe(false)
  })

  test('gitCommit accepts a short sha, answers null for unknown and rejects junk', async () => {
    const deps = testDeps()
    const query = 'query($sha: String!) { gitCommit(sha: $sha) { sha } }'
    const short = await run(deps, query, { sha: shaOf('c08').slice(0, 8) })
    expect(short.data!.gitCommit.sha).toBe(shaOf('c08'))
    const unknown = await run(deps, query, { sha: 'f'.repeat(40) })
    expect(unknown.data!.gitCommit).toBeNull()
    const junk = await run(deps, query, { sha: 'zz; drop' })
    expect(junk.errors?.[0]?.extensions?.code).toBe('BAD_INPUT')
  })

  test('without a GitHub token every query says GITHUB_NOT_CONFIGURED, no crash', async () => {
    const deps = testDeps()
    deps.config.fixtures = false
    deps.config.github.token = ''
    for (const q of [
      '{ gitGraph { lanes } }',
      '{ gitPushes { id } }',
      '{ gitCommit(sha: "abcdef0") { sha } }',
    ]) {
      const res = await run(deps, q)
      expect(res.errors?.[0]?.extensions?.code).toBe('GITHUB_NOT_CONFIGURED')
    }
  })
})
