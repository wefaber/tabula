// Preferences GraphQL: the caller's own prefs and their update. Every field is per user; nobody reads another's.
import type { Database } from 'bun:sqlite'
import { audit } from '../../audit'
import { builder, fail } from '../../graphql/builder'
import {
  DEFAULT_PREFS,
  invalidPref,
  mergePrefs,
  type Contrast,
  type Language,
  type Prefs,
  type Scale,
  type Theme,
} from './domain'

const PrefsRef = builder.objectRef<Prefs>('Prefs').implement({
  fields: (t) => ({
    language: t.exposeString('language'),
    theme: t.exposeString('theme'),
    scale: t.exposeInt('scale'),
    contrast: t.exposeString('contrast'),
  }),
})

interface PrefsRow {
  language: Language
  theme: Theme
  scale: Scale
  contrast: Contrast
}

function readPrefs(db: Database, userId: number): Prefs {
  const row = db
    .query<PrefsRow, [number]>(
      'SELECT language, theme, scale, contrast FROM user_prefs WHERE user_id = ?',
    )
    .get(userId)
  return row ? { ...row } : DEFAULT_PREFS
}

builder.queryFields((t) => ({
  prefs: t.field({
    type: PrefsRef,
    description:
      'Preferencias del usuario que pregunta; si nunca guardó, los valores por defecto.',
    resolve: (_root, _args, ctx) => readPrefs(ctx.db, ctx.user.id),
  }),
}))

builder.mutationFields((t) => ({
  setPrefs: t.field({
    type: PrefsRef,
    description:
      'Guarda las preferencias pasadas; los campos que no se mandan quedan como estaban.',
    args: {
      language: t.arg.string(),
      theme: t.arg.string(),
      scale: t.arg.int(),
      contrast: t.arg.string(),
    },
    resolve: (_root, args, ctx) => {
      const patch = {
        language: args.language ?? undefined,
        theme: args.theme ?? undefined,
        scale: args.scale ?? undefined,
        contrast: args.contrast ?? undefined,
      } as Partial<Prefs>
      const bad = invalidPref(patch)
      if (bad) fail('INVALID', `Valor no válido para ${bad}.`)
      const next = mergePrefs(readPrefs(ctx.db, ctx.user.id), patch)
      ctx.db
        .query(
          `INSERT INTO user_prefs (user_id, language, theme, scale, contrast, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET language = excluded.language, theme = excluded.theme,
             scale = excluded.scale, contrast = excluded.contrast, updated_at = excluded.updated_at`,
        )
        .run(
          ctx.user.id,
          next.language,
          next.theme,
          next.scale,
          next.contrast,
          new Date().toISOString(),
        )
      audit(ctx.db, ctx.user, 'prefs.set', ctx.user.login, patch)
      return next
    },
  }),
}))
