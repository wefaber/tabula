import { describe, expect, test } from 'bun:test'
import { execute, parse } from 'graphql'
import { userByLogin } from '../../../auth'
import { listAudit } from '../../../audit'
import { schema } from '../../../graphql/schema'
import { testDeps } from '../../../test-utils'
import { DEFAULT_PREFS, invalidPref, mergePrefs } from '../domain'

describe('invalidPref / mergePrefs', () => {
  test('acepta solo los valores permitidos', () => {
    expect(
      invalidPref({
        language: 'en',
        theme: 'system',
        scale: 130,
        contrast: 'high',
      }),
    ).toBeNull()
    expect(invalidPref({ language: 'fr' })).toBe('language')
    expect(invalidPref({ theme: 'auto' })).toBe('theme')
    expect(invalidPref({ scale: 110 })).toBe('scale')
    expect(invalidPref({ contrast: 'low' })).toBe('contrast')
  })

  test('un campo no mandado conserva el valor anterior', () => {
    const next = mergePrefs(DEFAULT_PREFS, { scale: 115 })
    expect(next).toEqual({ ...DEFAULT_PREFS, scale: 115 })
  })
})

describe('prefs GraphQL', () => {
  const setup = () => {
    const deps = testDeps()
    const faku = userByLogin(deps.db, 'faku@x')!
    const pablo = userByLogin(deps.db, 'pablo@x')!
    const run = (
      user: typeof faku,
      query: string,
      variables?: Record<string, unknown>,
    ) =>
      execute({
        schema,
        document: parse(query),
        variableValues: variables,
        contextValue: { ...deps, user, method: 'token' },
      })
    return { deps, faku, pablo, run }
  }

  const QUERY = `query { prefs { language theme scale contrast } }`
  const SET = `mutation ($language: String, $theme: String, $scale: Int, $contrast: String) {
    setPrefs(language: $language, theme: $theme, scale: $scale, contrast: $contrast) { language theme scale contrast }
  }`

  test('sin guardar devuelve los valores por defecto', async () => {
    const { faku, run } = setup()
    expect((await run(faku, QUERY)).data?.prefs).toEqual({
      language: 'es',
      theme: 'dark',
      scale: 100,
      contrast: 'normal',
    })
  })

  test('setPrefs guarda un parcial y lo devuelve; las prefs son por usuario', async () => {
    const { faku, pablo, run } = setup()
    const saved = await run(faku, SET, { language: 'en', scale: 130 })
    expect(saved.errors).toBeUndefined()
    expect(saved.data?.setPrefs).toEqual({
      language: 'en',
      theme: 'dark',
      scale: 130,
      contrast: 'normal',
    })
    expect((await run(faku, QUERY)).data?.prefs).toEqual(saved.data?.setPrefs)
    expect((await run(pablo, QUERY)).data?.prefs).toEqual(DEFAULT_PREFS)
  })

  test('un valor fuera de rango no guarda nada y devuelve INVALID', async () => {
    const { faku, run } = setup()
    const res = await run(faku, SET, { scale: 110, theme: 'dark' })
    expect(res.errors?.[0]?.message).toBe('Valor no válido para scale.')
    expect(res.errors?.[0]?.extensions?.code).toBe('INVALID')
    expect((await run(faku, QUERY)).data?.prefs).toEqual(DEFAULT_PREFS)
  })

  test('cada cambio queda en la auditoría', async () => {
    const { deps, faku, run } = setup()
    await run(faku, SET, { contrast: 'high' })
    const entry = listAudit(deps.db, 1)[0]
    expect(entry?.action).toBe('prefs.set')
    expect(entry?.userLogin).toBe('faku@x')
    expect(JSON.parse(entry!.detail)).toEqual({ contrast: 'high' })
  })
})
