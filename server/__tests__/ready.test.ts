import { describe, expect, test } from 'bun:test'
import { readiness } from '../ready'
import { testDeps } from '../test-utils'

describe('readiness problems', () => {
  test('fixtures: nothing to report', async () => {
    const r = await readiness(testDeps())
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
  })

  test('real mode without secrets names each module that cannot work', async () => {
    const deps = testDeps()
    deps.config = { ...deps.config, fixtures: false }
    const r = await readiness(deps)
    expect(r.problems.map((p) => p.module).sort()).toEqual([
      'Ask Ether',
      'Base de datos',
      'Git',
    ])
  })

  test('podman down is reported as Containers and makes the panel not ready', async () => {
    const deps = testDeps()
    deps.podman = { ...deps.podman, ping: async () => false }
    const r = await readiness(deps)
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([
      { module: 'Containers', detail: 'Podman no responde en el socket.' },
    ])
  })
})
