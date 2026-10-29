// Preferences: the allowed values, the defaults and the check for a partial update. Pure: no DB, no clock.
export const LANGUAGES = ['es', 'en'] as const
export const THEMES = ['dark', 'light', 'system'] as const
/** Text scale in percent. The UI applies it as a zoom factor, so only these steps exist. */
export const SCALES = [90, 100, 115, 130] as const
export const CONTRASTS = ['normal', 'high'] as const

export type Language = (typeof LANGUAGES)[number]
export type Theme = (typeof THEMES)[number]
export type Scale = (typeof SCALES)[number]
export type Contrast = (typeof CONTRASTS)[number]

export interface Prefs {
  language: Language
  theme: Theme
  scale: Scale
  contrast: Contrast
}

export const DEFAULT_PREFS: Prefs = {
  language: 'es',
  theme: 'dark',
  scale: 100,
  contrast: 'normal',
}

/** The first field of `patch` that does not hold an allowed value, or null when the whole patch is valid. */
export function invalidPref(
  patch: Partial<Record<keyof Prefs, unknown>>,
): keyof Prefs | null {
  const allowed: Record<keyof Prefs, readonly unknown[]> = {
    language: LANGUAGES,
    theme: THEMES,
    scale: SCALES,
    contrast: CONTRASTS,
  }
  for (const field of Object.keys(allowed) as (keyof Prefs)[]) {
    if (patch[field] !== undefined && !allowed[field].includes(patch[field]))
      return field
  }
  return null
}

/** Defaults, then the stored row, then the patch. Callers validate the patch first with `invalidPref`. */
export function mergePrefs(base: Prefs, patch: Partial<Prefs>): Prefs {
  return {
    language: patch.language ?? base.language,
    theme: patch.theme ?? base.theme,
    scale: patch.scale ?? base.scale,
    contrast: patch.contrast ?? base.contrast,
  }
}
