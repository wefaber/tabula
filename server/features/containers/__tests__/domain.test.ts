import { describe, expect, test } from 'bun:test'
import type { ContainerSummary } from '../../../adapters/podman'
import {
  formatUptime,
  imageTag,
  isReady,
  planPower,
  PowerError,
  powerOrder,
  signature,
  toRows,
  uptimeSeconds,
} from '../domain'

const c = (
  service: string,
  state: ContainerSummary['state'] = 'running',
  health = '',
): ContainerSummary => ({
  id: `id-${service}`,
  name: `nexus-test_${service}_1`,
  service,
  image: `localhost/nexus-${service}:d2ed724`,
  state,
  health,
  startedAt: '2026-01-01T00:00:00.000Z',
})

const stack = (state: ContainerSummary['state'], dbHealth = 'healthy') => [
  c('db', state, dbHealth),
  c('back', state),
  c('front', state),
]

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return (e as PowerError).code
  }
  return undefined
}

describe('power order', () => {
  test('up is db, back, front; down is the reverse', () => {
    expect(powerOrder('up')).toEqual(['db', 'back', 'front'])
    expect(powerOrder('down')).toEqual(['front', 'back', 'db'])
  })
})

describe('planPower', () => {
  test('up from a stopped stack starts in order, waiting db health and the front', () => {
    expect(planPower('up', null, stack('exited', ''))).toEqual([
      { service: 'db', op: 'start', wait: 'health' },
      { service: 'back', op: 'start', wait: undefined },
      { service: 'front', op: 'start', wait: 'http' },
    ])
  })

  test('up skips running services but still waits for an unhealthy db', () => {
    const steps = planPower('up', null, [
      c('db', 'running', 'starting'),
      c('back', 'running'),
      c('front', 'exited'),
    ])
    expect(steps).toEqual([
      { service: 'db', op: 'wait', wait: 'health' },
      { service: 'front', op: 'start', wait: 'http' },
    ])
  })

  test('up on a healthy running stack is a no-op', () => {
    expect(planPower('up', null, stack('running'))).toEqual([])
  })

  test('down stops only what runs, front first', () => {
    const steps = planPower('down', null, [
      c('db'),
      c('back', 'exited'),
      c('front'),
    ])
    expect(steps.map((s) => `${s.op}:${s.service}`)).toEqual([
      'stop:front',
      'stop:db',
    ])
  })

  test('restart of one service touches only that service', () => {
    expect(planPower('restart', 'db', stack('running'))).toEqual([
      { service: 'db', op: 'restart', wait: 'health' },
    ])
    expect(planPower('restart', 'back', stack('running'))).toEqual([
      { service: 'back', op: 'restart', wait: undefined },
    ])
  })

  test('restart of the stack stops in reverse then starts in order', () => {
    const steps = planPower('restart', null, stack('running'))
    expect(steps.map((s) => `${s.op}:${s.service}`)).toEqual([
      'stop:front',
      'stop:back',
      'stop:db',
      'start:db',
      'start:back',
      'start:front',
    ])
  })

  test('no containers is NO_CONTAINERS', () => {
    expect(codeOf(() => planPower('up', null, []))).toBe('NO_CONTAINERS')
  })

  test('up/down with a service is BAD_INPUT, a missing service is SERVICE_MISSING', () => {
    expect(codeOf(() => planPower('up', 'db', stack('running')))).toBe(
      'BAD_INPUT',
    )
    expect(codeOf(() => planPower('up', null, [c('db'), c('back')]))).toBe(
      'SERVICE_MISSING',
    )
    expect(codeOf(() => planPower('restart', 'front', [c('db')]))).toBe(
      'SERVICE_MISSING',
    )
  })
})

describe('isReady', () => {
  test('running and healthy, or running without healthcheck', () => {
    expect(isReady({ state: 'running', health: 'healthy' })).toBe(true)
    expect(isReady({ state: 'running', health: '' })).toBe(true)
    expect(isReady({ state: 'running', health: 'starting' })).toBe(false)
    expect(isReady({ state: 'exited', health: '' })).toBe(false)
  })
})

describe('uptime and image tag', () => {
  const now = new Date('2026-01-01T01:02:05.000Z')
  test('uptimeSeconds', () => {
    expect(uptimeSeconds('2026-01-01T00:00:00.000Z', now)).toBe(3725)
    expect(uptimeSeconds('2026-01-02T00:00:00.000Z', now)).toBe(0)
    expect(uptimeSeconds(null, now)).toBeNull()
    expect(uptimeSeconds('nope', now)).toBeNull()
  })
  test('formatUptime', () => {
    expect(formatUptime(null)).toBe('—')
    expect(formatUptime(45)).toBe('45 s')
    expect(formatUptime(300)).toBe('5 min')
    expect(formatUptime(3725)).toBe('1 h 2 min')
    expect(formatUptime(200_000)).toBe('2 d 7 h')
  })
  test('imageTag', () => {
    expect(imageTag('localhost/nexus-back:d2ed724')).toBe('d2ed724')
    expect(imageTag('localhost:5000/app')).toBe('latest')
    expect(imageTag('docker.io/library/mariadb:11')).toBe('11')
    expect(imageTag('app@sha256:0123456789abcdef0123')).toBe('0123456789ab')
  })
})

describe('rows', () => {
  const now = new Date('2026-01-01T00:10:00.000Z')
  test('orders by stack order; only running containers carry stats and uptime', () => {
    const rows = toRows(
      [c('front'), c('db', 'running', 'healthy'), c('back', 'exited')],
      [
        { id: 'id-db', cpuPercent: 1.5, memBytes: 100, memLimitBytes: 1000 },
        { id: 'id-back', cpuPercent: 9, memBytes: 9, memLimitBytes: 9 },
      ],
      now,
    )
    expect(rows.map((r) => r.service)).toEqual(['db', 'back', 'front'])
    expect(rows[0]).toMatchObject({
      uptimeSeconds: 600,
      cpuPercent: 1.5,
      tag: 'd2ed724',
    })
    expect(rows[1]).toMatchObject({
      uptimeSeconds: null,
      cpuPercent: null,
      startedAt: null,
    })
    expect(rows[2]?.cpuPercent).toBeNull()
  })

  test('signature ignores uptime ticks and sub-bucket jitter, not state changes', () => {
    const base = [c('db', 'running', 'healthy')]
    const stat = (cpu: number, mem: number) => [
      { id: 'id-db', cpuPercent: cpu, memBytes: mem, memLimitBytes: 2 ** 30 },
    ]
    const a = signature(toRows(base, stat(1.01, 100 * 2 ** 20), now))
    const later = new Date(now.getTime() + 30_000)
    expect(signature(toRows(base, stat(1.02, 100 * 2 ** 20), later))).toBe(a)
    expect(signature(toRows(base, stat(3, 100 * 2 ** 20), now))).not.toBe(a)
    expect(signature(toRows([c('db', 'exited')], [], now))).not.toBe(a)
  })
})
