// References of a question (`@container:back`, `@api:login`, `@call:<id>`). `parseRefs` checks the shape before any work;
// `resolveRefs` checks each id against the real data (the snapshot, the apis checks, the calls table) and turns it into
// the facts Ether receives. An unknown id is refused here, never sent to Ether.
import type { Database } from 'bun:sqlite'
import { fail } from '../../graphql/builder'
import { readStatus } from '../apis/checks'
import { TARGETS, type EndpointSummary } from '../apis/domain'
import {
  MAX_REFS,
  parseRef,
  refKey,
  type EtherRef,
  type RefData,
} from '../../../shared/etherRefs'
import type { SnapshotContainer, SystemSnapshot } from './snapshot'

interface CallRow {
  atMs: number
  method: string
  path: string
  status: number
  bytes: number
}

const iso = (ms: number) => new Date(ms).toISOString()

/** Dedupes the list and refuses malformed tokens or more than MAX_REFS distinct ones. */
export function parseRefs(
  raw: readonly string[] | null | undefined,
): EtherRef[] {
  const out = new Map<string, EtherRef>()
  for (const token of raw ?? []) {
    const ref = parseRef(token)
    if (!ref) fail('BAD_INPUT', `Referencia inválida: ${token.slice(0, 60)}`)
    out.set(refKey(ref), ref)
  }
  if (out.size > MAX_REFS)
    fail('BAD_INPUT', `Hasta ${MAX_REFS} referencias por pregunta.`)
  return [...out.values()]
}

export function containerFacts(c: SnapshotContainer): string[] {
  return [
    `${c.state}${c.health ? `/${c.health}` : ''}`,
    `image=${c.image}`,
    ...(c.startedAt ? [`desde ${c.startedAt}`] : []),
  ]
}

export function apiFacts(s: EndpointSummary): string[] {
  if (!s.last) return ['sin checks todavía']
  const facts = [
    `${s.last.ok ? 'OK' : 'FALLA'}${s.last.status === null ? '' : `, HTTP ${s.last.status}`}`,
    `último check ${iso(s.last.atMs)}, ${s.last.latencyMs} ms`,
  ]
  if (s.uptime !== null) facts.push(`uptime 24 h ${s.uptime.toFixed(1)}%`)
  if (s.lastError)
    facts.push(`último error (${iso(s.lastError.atMs)}): ${s.lastError.error}`)
  return facts
}

export function callFacts(c: CallRow): string[] {
  return [
    `${c.method} ${c.path} → HTTP ${c.status}`,
    `${iso(c.atMs)}, ${c.bytes} bytes`,
  ]
}

/** Checks every reference against the data that exists now. Any unknown id fails the whole question. */
export function resolveRefs(
  deps: { db: Database },
  refs: EtherRef[],
  snapshot: SystemSnapshot,
): RefData[] {
  let statuses: EndpointSummary[] | null = null
  return refs.map((ref): RefData => {
    if (ref.kind === 'container') {
      const c = snapshot.containers.find((x) => x.service === ref.id)
      if (!c)
        fail(
          'BAD_INPUT',
          `No encontré el container ${ref.id} (¿el stack está levantado?).`,
        )
      return {
        kind: ref.kind,
        id: ref.id,
        title: `container ${ref.id}`,
        facts: containerFacts(c),
      }
    }
    if (ref.kind === 'api') {
      const known = TARGETS.some((t) => t.kind === 'api' && t.name === ref.id)
      if (!known) fail('BAD_INPUT', `No existe la API ${ref.id}.`)
      statuses ??= readStatus(deps)
      const s = statuses.find((e) => e.target.name === ref.id)
      if (!s) fail('BAD_INPUT', `No existe la API ${ref.id}.`)
      return {
        kind: ref.kind,
        id: ref.id,
        title: `api ${ref.id}`,
        facts: apiFacts(s),
      }
    }
    const row = deps.db
      .query<CallRow, [number]>(
        'SELECT at_ms AS atMs, method, path, status, bytes FROM calls_log WHERE id = ?',
      )
      .get(Number(ref.id))
    if (!row)
      fail('NOT_FOUND', 'No encontré esa llamada, o ya salió del historial.')
    return {
      kind: ref.kind,
      id: ref.id,
      title: `llamada ${ref.id}`,
      facts: callFacts(row),
    }
  })
}
