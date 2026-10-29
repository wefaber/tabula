// Mini i18n without a library. Only the shell (header, loader, shortcuts) and the preferences dialog are translated;
// the sections still render their Spanish copy (see docs/features.md › Idioma).
import { useSyncExternalStore } from 'react'

export type Lang = 'es' | 'en'

const DICT = {
  es: {
    'common.close': 'Cerrar',
    'common.retry': 'Reintentar',
    'shell.sections': 'Secciones',
    'shell.problems.one': '1 módulo con fallas',
    'shell.problems.many': '{n} módulos con fallas',
    'shell.problems.label': 'Módulos con fallas',
    'shell.ok': 'Panel ok',
    'shell.fixtures': 'datos de prueba',
    'shell.logout': 'Salir',
    'shell.sessionError': 'No se pudo conectar con el panel ({error}).',
    'loader.loading': 'Cargando…',
    'shortcuts.title': 'Atajos de teclado',
    'shortcuts.tour': 'Ver recorrido',
    'shortcuts.section':
      'Ir a la sección por número (1 a 7, en el orden del menú)',
    'shortcuts.prev': 'Sección anterior',
    'shortcuts.next': 'Sección siguiente',
    'shortcuts.help': 'Mostrar estos atajos',
    'shortcuts.send':
      'Enviar la pregunta en Ask Ether (Shift+Enter agrega una línea)',
    'prefs.open': 'Preferencias',
    'prefs.title': 'Preferencias',
    'prefs.language': 'Idioma',
    'prefs.theme': 'Tema',
    'prefs.scale': 'Tamaño de texto',
    'prefs.contrast': 'Contraste',
    'prefs.saveError': 'No se pudo guardar. Se recargó lo guardado; reintentá.',
    'theme.dark': 'Oscuro',
    'theme.light': 'Claro',
    'theme.system': 'Sistema',
    'contrast.normal': 'Normal',
    'contrast.high': 'Alto',
  },
  en: {
    'common.close': 'Close',
    'common.retry': 'Retry',
    'shell.sections': 'Sections',
    'shell.problems.one': '1 module with failures',
    'shell.problems.many': '{n} modules with failures',
    'shell.problems.label': 'Modules with failures',
    'shell.ok': 'Panel ok',
    'shell.fixtures': 'test data',
    'shell.logout': 'Log out',
    'shell.sessionError': 'Could not connect to the panel ({error}).',
    'loader.loading': 'Loading…',
    'shortcuts.title': 'Keyboard shortcuts',
    'shortcuts.tour': 'Take the tour',
    'shortcuts.section': 'Go to a section by number (1 to 7, in menu order)',
    'shortcuts.prev': 'Previous section',
    'shortcuts.next': 'Next section',
    'shortcuts.help': 'Show these shortcuts',
    'shortcuts.send':
      'Send the question in Ask Ether (Shift+Enter adds a line)',
    'prefs.open': 'Preferences',
    'prefs.title': 'Preferences',
    'prefs.language': 'Language',
    'prefs.theme': 'Theme',
    'prefs.scale': 'Text size',
    'prefs.contrast': 'Contrast',
    'prefs.saveError':
      'Could not save. The saved values were reloaded; try again.',
    'theme.dark': 'Dark',
    'theme.light': 'Light',
    'theme.system': 'System',
    'contrast.normal': 'Normal',
    'contrast.high': 'High',
  },
} as const

export type Key = keyof (typeof DICT)['es']

let lang: Lang = document.documentElement.lang === 'en' ? 'en' : 'es'
const listeners = new Set<() => void>()

/** Switches the language and re-renders every component that reads `useT`. */
export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  document.documentElement.lang = next
  for (const listen of listeners) listen()
}

function translate(
  current: Lang,
  key: Key,
  vars: Record<string, string | number> = {},
): string {
  let text: string = DICT[current][key]
  for (const [name, value] of Object.entries(vars))
    text = text.replace(`{${name}}`, String(value))
  return text
}

export type T = (key: Key, vars?: Record<string, string | number>) => string

/**
 * The `t` of the current language. It changes identity with the language, so a component that does
 * `const t = useT()` re-renders on a switch and the React Compiler does not keep the old strings.
 */
export function useT(): T {
  const current = useSyncExternalStore(
    (listen) => {
      listeners.add(listen)
      return () => listeners.delete(listen)
    },
    () => lang,
  )
  return (key, vars) => translate(current, key, vars)
}
