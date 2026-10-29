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
    'shell.tailnet': 'Tailnet',
    'shell.tailnet.hint':
      'Entraste con tu cuenta del tailnet: no hay sesión para cerrar.',
    'shell.sessionError': 'No se pudo conectar con el panel ({error}).',
    'loader.loading': 'Cargando…',
    'shortcuts.title': 'Atajos de teclado',
    'shortcuts.tour': 'Ver recorrido',
    'shortcuts.nav': 'Sección anterior o siguiente',
    'tour.title': 'Guía rápida',
    'tour.step': 'Paso {current} de {total}',
    'tour.progress': 'Progreso de la guía',
    'tour.skip': 'Omitir',
    'tour.back': 'Atrás',
    'tour.next': 'Siguiente',
    'tour.finish': 'Listo',
    'tour.close': 'Cerrar el recorrido',
    'tour.welcome.title': 'Te damos la bienvenida a Tabula',
    'tour.welcome.desc':
      'El panel para operar el stack de Gravida sin entrar por SSH: ves qué anda, qué falla y podés actuar desde acá.',
    'tour.welcome.p1': 'Estado de containers y APIs en vivo, con historial',
    'tour.welcome.p2':
      'Las últimas llamadas, la base de datos y el git en un lugar',
    'tour.welcome.p3': 'Ask Ether responde preguntas sobre el sistema',
    'tour.welcome.prefs':
      'Elegí idioma y tema. Después los cambiás desde el engranaje.',
    'tour.sections.title': 'Las secciones',
    'tour.sections.desc':
      'Cada solapa de arriba es una parte del panel. También las abrís con las teclas del 1 al 7.',
    'tour.section.containers':
      'Estado, CPU y logs de db, back y front. Encender, apagar y reiniciar.',
    'tour.section.apis':
      'Chequeo de cada endpoint de la API cada 30 segundos, con historial de 24 horas.',
    'tour.section.calls':
      'Las últimas llamadas a la API, en vivo y con filtro.',
    'tour.section.db':
      'Tablas, edición de filas y consola SQL (escribir es solo para admin).',
    'tour.section.git':
      'Grafo de ramas, últimos pushes y el CI y deploy de cada commit.',
    'tour.section.ether':
      'Preguntas sobre el sistema, con la foto del estado adjunta.',
    'tour.section.access':
      'Tus tokens y el registro de lo que se hizo en el panel.',
    'tour.ether.title': 'Preguntale a Ether',
    'tour.ether.desc':
      'Cada pregunta viaja con una foto de los containers, los errores recientes de la API y el tag activo.',
    'tour.ether.p1':
      'Escribí @ para referenciar un container, una API o una llamada reciente',
    'tour.ether.p2':
      'Seleccioná parte de una respuesta y respondé solo a esa parte',
    'tour.ether.p3': 'Compartí una respuesta con un link de solo lectura',
    'tour.ether.p4': 'Si Ether pide ejecutar algo, solo un admin lo aprueba',
    'tour.keys.title': 'Atajos de teclado',
    'tour.keys.desc': 'Moverte por el panel sin tocar el mouse.',
    'tour.access.title': 'Acceso y ajustes',
    'tour.access.desc':
      'Cómo entrar desde otro dispositivo y cómo dejar el panel a tu medida.',
    'tour.access.p1':
      'Fuera del tailnet entrás con un token: Acceso, nombre, Crear token. Se muestra una sola vez.',
    'tour.access.p2':
      'El engranaje del encabezado cambia idioma, tema, tamaño de texto y contraste.',
    'tour.access.p3':
      'Salir cierra la sesión de token (desde el tailnet entrás solo). Repetí esta guía desde Preferencias o el atajo ?.',
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
    'prefs.tour': 'Ver recorrido',
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
    'shell.tailnet': 'Tailnet',
    'shell.tailnet.hint':
      'You are signed in through your tailnet account: there is no session to end.',
    'shell.sessionError': 'Could not connect to the panel ({error}).',
    'loader.loading': 'Loading…',
    'shortcuts.title': 'Keyboard shortcuts',
    'shortcuts.tour': 'Take the tour',
    'shortcuts.nav': 'Previous or next section',
    'tour.title': 'Quick guide',
    'tour.step': 'Step {current} of {total}',
    'tour.progress': 'Guide progress',
    'tour.skip': 'Skip',
    'tour.back': 'Back',
    'tour.next': 'Next',
    'tour.finish': 'Done',
    'tour.close': 'Close the tour',
    'tour.welcome.title': 'Welcome to Tabula',
    'tour.welcome.desc':
      'The panel to run the Gravida stack without going through SSH: see what works, what fails, and act from here.',
    'tour.welcome.p1': 'Live container and API status, with history',
    'tour.welcome.p2': 'Recent calls, the database and git in one place',
    'tour.welcome.p3': 'Ask Ether answers questions about the system',
    'tour.welcome.prefs':
      'Pick a language and a theme. You can change them later from the gear.',
    'tour.sections.title': 'The sections',
    'tour.sections.desc':
      'Each tab at the top is a part of the panel. You can also open them with keys 1 to 7.',
    'tour.section.containers':
      'Status, CPU and logs of db, back and front. Power on, off and restart.',
    'tour.section.apis':
      'Every API endpoint checked every 30 seconds, with a 24-hour history.',
    'tour.section.calls': 'The latest API calls, live and filterable.',
    'tour.section.db':
      'Tables, row editing and an SQL console (writing is admin only).',
    'tour.section.git':
      'Branch graph, latest pushes, and the CI and deploy of each commit.',
    'tour.section.ether':
      'Questions about the system, with a snapshot of its state attached.',
    'tour.section.access':
      'Your tokens and the log of what was done in the panel.',
    'tour.ether.title': 'Ask Ether',
    'tour.ether.desc':
      'Every question travels with a snapshot of the containers, recent API errors and the active tag.',
    'tour.ether.p1': 'Type @ to reference a container, an API or a recent call',
    'tour.ether.p2': 'Select part of an answer and reply only to that part',
    'tour.ether.p3': 'Share an answer with a read-only link',
    'tour.ether.p4':
      'If Ether asks to run something, only an admin approves it',
    'tour.keys.title': 'Keyboard shortcuts',
    'tour.keys.desc': 'Move around the panel without touching the mouse.',
    'tour.access.title': 'Access and settings',
    'tour.access.desc':
      'How to sign in from another device and how to set the panel up your way.',
    'tour.access.p1':
      'Outside the tailnet you sign in with a token: Access, name, Create token. It is shown once.',
    'tour.access.p2':
      'The gear in the header changes language, theme, text size and contrast.',
    'tour.access.p3':
      'Log out ends a token session (on the tailnet you are signed in automatically). Repeat this guide from Preferences or the ? shortcut.',
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
    'prefs.tour': 'Take the tour',
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
