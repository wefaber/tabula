import { describe, expect, test } from 'bun:test'
import { createApp } from '../../../app'
import { testDeps } from '../../../test-utils'
import { completeOnboarding, hasCompletedOnboarding } from '../store'

const post = (
  a: ReturnType<typeof createApp>,
  query: string,
  headers: Record<string, string> = {},
) =>
  a.handle(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query }),
    }),
  )

describe('onboarding store', () => {
  test('a user has not seen the tour until they complete it, and completing twice is harmless', () => {
    const { db } = testDeps()
    const pablo = db
      .query<{ id: number }, []>("SELECT id FROM users WHERE login = 'pablo@x'")
      .get()!.id
    expect(hasCompletedOnboarding(db, pablo)).toBe(false)
    completeOnboarding(db, pablo, new Date('2026-10-28T10:00:00Z'))
    completeOnboarding(db, pablo, new Date('2026-10-29T10:00:00Z'))
    expect(hasCompletedOnboarding(db, pablo)).toBe(true)
    const rows = db
      .query<{ completed_at: string }, [number]>(
        'SELECT completed_at FROM user_onboarding WHERE user_id = ?',
      )
      .all(pablo)
    expect(rows).toEqual([{ completed_at: '2026-10-28T10:00:00.000Z' }])
  })

  test("one user's completion does not affect another", () => {
    const { db } = testDeps()
    const [faku, pablo] = db
      .query<{ id: number }, []>('SELECT id FROM users ORDER BY id')
      .all()
      .map((r) => r.id)
    completeOnboarding(db, faku!)
    expect(hasCompletedOnboarding(db, faku!)).toBe(true)
    expect(hasCompletedOnboarding(db, pablo!)).toBe(false)
  })
})

describe('onboarding graphql', () => {
  test('onboarding is false for a new user, completeOnboarding flips it and is audited', async () => {
    const deps = testDeps()
    const a = createApp(deps, { distDir: '/nonexistent' })
    const me = { 'tailscale-user-login': 'pablo@x' }

    const before = await post(a, '{ onboarding }', me)
    expect((await before.json()).data).toEqual({ onboarding: false })

    const done = await post(a, 'mutation { completeOnboarding }', me)
    expect((await done.json()).data).toEqual({ completeOnboarding: true })

    const after = await post(a, '{ onboarding }', me)
    expect((await after.json()).data).toEqual({ onboarding: true })

    const log = deps.db
      .query<{ userLogin: string }, [string]>(
        'SELECT user_login AS userLogin FROM audit WHERE action = ?',
      )
      .all('onboarding.complete')
    expect(log).toEqual([{ userLogin: 'pablo@x' }])
  })

  test('the tour state is per user: faku still sees it after pablo finished it', async () => {
    const deps = testDeps()
    const a = createApp(deps, { distDir: '/nonexistent' })
    await post(a, 'mutation { completeOnboarding }', {
      'tailscale-user-login': 'pablo@x',
    })
    const faku = await post(a, '{ onboarding }', {
      'tailscale-user-login': 'faku@x',
    })
    expect((await faku.json()).data).toEqual({ onboarding: false })
  })

  test('anonymous callers are rejected', async () => {
    const a = createApp(testDeps(), { distDir: '/nonexistent' })
    const res = await post(a, '{ onboarding }')
    expect(res.status).toBe(401)
  })
})
