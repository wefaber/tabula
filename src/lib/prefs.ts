// Preferences as the page applies them. The localStorage copy is what index.html reads before first paint;
// the server copy (query `prefs`) replaces it once the shell loads. Keep the inline script in index.html in step.
import { setLang } from './i18n'

export type Language = 'es' | 'en'
export type Theme = 'dark' | 'light' | 'system'
export type Scale = 90 | 100 | 115 | 130
export type Contrast = 'normal' | 'high'

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

const CACHE_KEY = 'tabula-prefs'
/** Kept under its old name: index.html has always read this key to pick the theme before paint. */
const THEME_KEY = 'tabula-theme'

let current: Prefs = DEFAULT_PREFS

export function readCache(): Prefs {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
      : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

const systemLight = window.matchMedia('(prefers-color-scheme: light)')
systemLight.addEventListener('change', () => {
  if (current.theme === 'system') applyPrefs(current)
})

/** Puts `prefs` on the page: html lang, data-theme, data-contrast, the --ui-scale zoom, and the language of the shell. */
export function applyPrefs(prefs: Prefs): void {
  current = prefs
  const root = document.documentElement
  const light =
    prefs.theme === 'light' || (prefs.theme === 'system' && systemLight.matches)
  root.dataset.theme = light ? 'light' : 'dark'
  root.dataset.contrast = prefs.contrast
  root.style.setProperty('--ui-scale', String(prefs.scale / 100))
  setLang(prefs.language)
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs))
    localStorage.setItem(THEME_KEY, prefs.theme)
  } catch {
    // Private window or blocked storage: the page still works, it just starts from the defaults next time.
  }
}
