import { describe, expect, test } from 'bun:test'
import { fixtureGithub } from '../../../adapters/github'
import { fixturePodman, type PodmanClient } from '../../../adapters/podman'
import { createApp } from '../../../app'
import { listAudit } from '../../../audit'
import type { Deps } from '../../../deps'
import { testDeps } from '../../../test-utils'
import { planPower, PowerError } from '../domain'
import {
  createLogFollowers,
  publishState,
  snapshot,
  STATE_CHANNEL,
} from '../monitor'
import { executePower, type PowerIo } from '../power'

/** Wraps a podman client to record the order of lifecycle calls. */
function recording(inner: PodmanClient) {
  const calls: string[] = []
  const podman: PodmanClient = {
    ...inner,
    async start(id) {
      calls.push(`start:${id.replace('fixture-', '')}`)
      return inner.start(id)
    },
    async stop(id, t) {
      calls.push(`stop:${id.replace('fixture-', '')}`)
      return inner.stop(id, t)
    },
    async restart(id, t) {
      calls.push(`restart:${id.replace('fixture-', '')}`)
      return inner.restart(id, t)
    },
  }
  return { podman, calls }
}

const instantIo = (overrides: Partial<PowerIo> = {}): PowerIo => {
  let t = 0
  return {
    probeFront: async () => true,
    sleep: async (ms) => {
      t += ms
    },
    now: () => t,
    healthTimeoutMs: 5000,
    httpTimeoutMs: 5000,
    pollMs: 1000,
    ...overrides,
  }
}

const gqlPost = (
  app: ReturnType<typeof createApp>,
  query: string,
  login = 'faku@x',
) =>
  app
    .handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'tailscale-user-login': login,
        },
        body: JSON.stringify({ query }),
      }),
    )
    .then((r) => r.json() as Promise<any>)

function withPodman(deps: Deps, podman: PodmanClient): Deps {
  return { ...deps, podman }
}

describe('executePower', () => {
  test('down then up goes in the documented order', async () => {
    const base = testDeps()
    const { podman, calls } = recording(base.podman)
    const deps = withPodman(base, podman)
    const list = await podman.list('nexus-test')

    await executePower(deps, planPower('down', null, list), instantIo())
    expect(calls).toEqual(['stop:front', 'stop:back', 'stop:db'])

    calls.length = 0
    const stopped = await podman.list('nexus-test')
    await executePower(deps, planPower('up', null, stopped), instantIo())
    expect(calls).toEqual(['start:db', 'start:back', 'start:front'])
    expect(
      (await podman.list('nexus-test')).every((c) => c.state === 'running'),
    ).toBe(true)
  })

  test('waits for the db to become healthy before moving on', async () => {
    const base = testDeps()
    const inner = base.podman
    let polls = 0
    const calls: string[] = []
    const podman: PodmanClient = {
      ...inner,
      async list(project) {
        const rows = await inner.list(project)
        return rows.map((c) =>
          c.service === 'db' && c.state === 'running' && polls++ < 2
            ? { ...c, health: 'starting' }
            : c,
        )
      },
      async start(id) {
        calls.push(`start:${id}`)
        return inner.start(id)
      },
    }
    const deps = withPodman(base, podman)
    await inner.stop('fixture-db')
    await inner.stop('fixture-back')
    await inner.stop('fixture-front')
    const io = instantIo()
    await executePower(
      deps,
      planPower('up', null, await inner.list('nexus-test')),
      io,
    )
    expect(polls).toBeGreaterThan(2)
    expect(calls).toEqual([
      'start:fixture-db',
      'start:fixture-back',
      'start:fixture-front',
    ])
  })

  test('a db that never gets healthy ends in POWER_TIMEOUT and does not start back', async () => {
    const base = testDeps()
    const inner = base.podman
    const started: string[] = []
    const podman: PodmanClient = {
      ...inner,
      async list(project) {
        return (await inner.list(project)).map((c) =>
          c.service === 'db' ? { ...c, health: 'unhealthy' } : c,
        )
      },
      async start(id) {
        started.push(id)
      },
    }
    const deps = withPodman(base, podman)
    const plan = planPower(
      'up',
      null,
      (await inner.list('nexus-test')).map((c) => ({
        ...c,
        state: 'exited' as const,
      })),
    )
    const error = await executePower(deps, plan, instantIo()).catch((e) => e)
    expect(error).toBeInstanceOf(PowerError)
    expect((error as PowerError).code).toBe('POWER_TIMEOUT')
    expect(started).toEqual(['fixture-db'])
  })

  test('a front that never answers 200 ends in POWER_TIMEOUT', async () => {
    const deps = testDeps()
    const plan = planPower('restart', 'front', await deps.podman.list('x'))
    const error = await executePower(
      deps,
      plan,
      instantIo({ probeFront: async () => false }),
    ).catch((e) => e)
    expect((error as PowerError).code).toBe('POWER_TIMEOUT')
  })
})

describe('state on the bus', () => {
  test('emits `state` on the first read and again only after a change', async () => {
    const deps = testDeps()
    const seen: unknown[] = []
    deps.bus.on(STATE_CHANNEL, (event, data) => {
      if (event === 'state') seen.push(data)
    })
    await publishState(deps)
    await publishState(deps)
    expect(seen).toHaveLength(1)
    await deps.podman.stop('fixture-front')
    await publishState(deps)
    expect(seen).toHaveLength(2)
    await publishState(deps, true)
    expect(seen).toHaveLength(3)
  })
})

describe('log followers', () => {
  test('follow only while somebody watches the channel, then stop', async () => {
    const deps = testDeps()
    const followers = createLogFollowers(deps)
    const rows = await snapshot(deps)

    await followers.reconcile(rows)
    expect(followers.activeServices()).toEqual([])

    const lines: { seq: number; text: string }[] = []
    const off = deps.bus.on('containers-front', (event, data) => {
      if (event === 'line') lines.push(data as { seq: number; text: string })
    })
    await followers.reconcile(rows)
    expect(followers.activeServices()).toEqual(['front'])
    await Bun.sleep(50)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]?.text).toContain('GET')
    expect(lines.every((l, i) => i === 0 || l.seq > lines[i - 1]!.seq)).toBe(
      true,
    )

    off()
    await followers.reconcile(rows)
    expect(followers.activeServices()).toEqual([])
    followers.stop()
  })

  test('a viewer that joins later gets the ring replayed with the same seqs', async () => {
    const deps = testDeps()
    const followers = createLogFollowers(deps)
    const rows = await snapshot(deps)
    const first: number[] = []
    const second: number[] = []
    deps.bus.on('containers-db', (_e, d) =>
      first.push((d as { seq: number }).seq),
    )
    await followers.reconcile(rows)
    await Bun.sleep(50)
    deps.bus.on('containers-db', (_e, d) =>
      second.push((d as { seq: number }).seq),
    )
    await followers.reconcile(rows)
    expect(second.length).toBeGreaterThan(0)
    expect(second.every((s) => first.includes(s))).toBe(true)
    followers.stop()
  })
})

describe('graphql', () => {
  const app = (deps = testDeps()) => ({
    deps,
    app: createApp(deps, { distDir: '/nonexistent' }),
  })

  test('containers query lists the stack with state, tag and stats', async () => {
    const { app: a } = app()
    const res = await gqlPost(
      a,
      '{ containers { service state health tag uptimeSeconds cpuPercent memBytes } }',
    )
    expect(
      res.data.containers.map((c: { service: string }) => c.service),
    ).toEqual(['db', 'back', 'front'])
    expect(res.data.containers[0]).toMatchObject({
      state: 'running',
      health: 'healthy',
    })
    expect(res.data.containers[0].memBytes).toBeGreaterThan(0)
  })

  test('containers is empty when the project has no containers', async () => {
    const base = testDeps()
    const { app: a } = app(
      withPodman(base, { ...base.podman, list: async () => [] }),
    )
    expect((await gqlPost(a, '{ containers { service } }')).data).toEqual({
      containers: [],
    })
  })

  test('power down then up audits both and leaves the stack running', async () => {
    const { app: a, deps } = app()
    const down = await gqlPost(
      a,
      'mutation { power(action: down) { service state } }',
    )
    expect(down.data.power.map((c: { state: string }) => c.state)).toEqual([
      'exited',
      'exited',
      'exited',
    ])
    const up = await gqlPost(
      a,
      'mutation { power(action: up) { service state health } }',
    )
    expect(
      up.data.power.every((c: { state: string }) => c.state === 'running'),
    ).toBe(true)
    const actions = listAudit(deps.db, 10).map((e) => [e.action, e.ok])
    expect(actions).toEqual([
      ['power.up', true],
      ['power.down', true],
    ])
  })

  test('restart of one service restarts only that service', async () => {
    const base = testDeps()
    const { podman, calls } = recording(base.podman)
    const { app: a, deps } = app(withPodman(base, podman))
    const res = await gqlPost(
      a,
      'mutation { power(action: restart, service: back) { service } }',
    )
    expect(res.errors).toBeUndefined()
    expect(calls).toEqual(['restart:back'])
    const [entry] = listAudit(deps.db, 1)
    expect(entry).toMatchObject({
      action: 'power.restart',
      target: 'back',
      ok: true,
    })
  })

  test('a deploy in progress blocks power with DEPLOY_IN_PROGRESS and audits the attempt', async () => {
    const base = testDeps()
    const { podman, calls } = recording(base.podman)
    const deps: Deps = {
      ...base,
      podman,
      github: { ...fixtureGithub(), deployInProgress: async () => true },
    }
    const a = createApp(deps, { distDir: '/nonexistent' })
    const res = await gqlPost(a, 'mutation { power(action: down) { service } }')
    expect(res.errors[0].extensions.code).toBe('DEPLOY_IN_PROGRESS')
    expect(calls).toEqual([])
    const [entry] = listAudit(deps.db, 1)
    expect(entry).toMatchObject({ action: 'power.down', ok: false })
  })

  test('up/down with a service is BAD_INPUT; power on an empty project is NO_CONTAINERS', async () => {
    const { app: a } = app()
    const bad = await gqlPost(
      a,
      'mutation { power(action: up, service: db) { service } }',
    )
    expect(bad.errors[0].extensions.code).toBe('BAD_INPUT')

    const base = testDeps()
    const empty = createApp(
      withPodman(base, { ...base.podman, list: async () => [] }),
      { distDir: '/nonexistent' },
    )
    const none = await gqlPost(
      empty,
      'mutation { power(action: up) { service } }',
    )
    expect(none.errors[0].extensions.code).toBe('NO_CONTAINERS')
  })

  test('a second power action while one runs is POWER_BUSY', async () => {
    const base = testDeps()
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow: PodmanClient = {
      ...fixturePodman(),
      async stop() {
        await gate
      },
    }
    const a = createApp(withPodman(base, slow), { distDir: '/nonexistent' })
    const first = gqlPost(a, 'mutation { power(action: down) { service } }')
    await Bun.sleep(20)
    const second = await gqlPost(
      a,
      'mutation { power(action: down) { service } }',
    )
    expect(second.errors[0].extensions.code).toBe('POWER_BUSY')
    release()
    expect((await first).errors).toBeUndefined()
  })

  test('containerLogs returns the tail of a service', async () => {
    const { app: a } = app()
    const res = await gqlPost(
      a,
      '{ containerLogs(service: front, tail: 5) { stream text } }',
    )
    expect(res.data.containerLogs).toHaveLength(5)
  })
})
