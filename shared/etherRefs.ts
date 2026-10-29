// Ask Ether references (`@container:back`, `@api:login`, `@call:<id>`) and the sources an answer shows.
// Pure: the picker, the server and the tests read the same grammar and the same shape.
import type { ToolStep } from './ether'

export const MAX_REFS = 5

export type RefKind = 'container' | 'api' | 'call'

export interface EtherRef {
  kind: RefKind
  id: string
}

/** `@container:back`, `@api:login` or `@call:42`. The leading `@` is optional on the wire. */
const TOKEN = /^@?(container|api|call):([a-z0-9_-]{1,40})$/

export function parseRef(raw: string): EtherRef | null {
  const m = TOKEN.exec(raw.trim())
  if (!m) return null
  const kind = m[1] as RefKind
  const id = m[2] ?? ''
  if (kind === 'call' && !/^\d{1,12}$/.test(id)) return null
  return { kind, id }
}

export const refToken = (ref: EtherRef) => `@${ref.kind}:${ref.id}`

export const refKey = (ref: EtherRef) => `${ref.kind}:${ref.id}`

/** Data of one referenced item, as Ether receives it and as the answer shows it under "Fuentes". */
export interface RefData {
  kind: RefKind
  id: string
  title: string
  facts: string[]
}

export interface SourceContainer {
  service: string
  state: string
  health: string
  image: string
}

export interface SourceError {
  at: string
  what: string
}

/** What Ether looked at for one answer: the state photo, the tool steps of the run and the referenced items. */
export interface MessageSources {
  at: string
  activeTag: string | null
  containers: SourceContainer[]
  errors: SourceError[]
  tools: ToolStep[]
  refs: RefData[]
}
