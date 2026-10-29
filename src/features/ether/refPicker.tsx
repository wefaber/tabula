// References in the question. Typing `@` opens a picker of containers, APIs and recent calls; a pick becomes a chip over
// the textarea and leaves the text clean. The chips travel with the question as ids; the server checks them against
// real data and attaches what they say. Owns the picker state so the Ask Ether section only wires it.
import { useQuery } from '@tanstack/react-query'
import { IconButton } from '@wefaber/ui'
import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { gql } from '@/lib/api'
import {
  MAX_REFS,
  refKey,
  refToken,
  type EtherRef,
  type RefKind,
} from '../../../shared/etherRefs'

interface Option {
  ref: EtherRef
  label: string
  hint: string
}

interface OptionsData {
  containers: { service: string; state: string; health: string }[]
  apiStatus: { endpoints: { name: string; kind: string; ok: boolean }[] }
  recentCalls: {
    items: { id: number; method: string; path: string; status: number }[]
  }
}

const OPTIONS = /* GraphQL */ `
  query EtherRefOptions {
    containers {
      service
      state
      health
    }
    apiStatus {
      endpoints {
        name
        kind
        ok
      }
    }
    recentCalls(limit: 15) {
      items {
        id
        method
        path
        status
      }
    }
  }
`

const MAX_OPTIONS = 8
/** The `@` being typed at the end of the question, and what follows it. */
const TRIGGER = /(?:^|\s)@([a-z0-9_:-]*)$/i

const ref = (kind: RefKind, id: string): EtherRef => ({ kind, id })

function optionsOf(data: OptionsData | undefined): Option[] {
  if (!data) return []
  const containers = data.containers.map((c) => ({
    ref: ref('container', c.service),
    label: `@container:${c.service}`,
    hint: `${c.state}${c.health ? `/${c.health}` : ''}`,
  }))
  const apis = data.apiStatus.endpoints
    .filter((e) => e.kind === 'api')
    .map((e) => ({
      ref: ref('api', e.name),
      label: `@api:${e.name}`,
      hint: e.ok ? 'OK' : 'FALLA',
    }))
  const calls = data.recentCalls.items.map((c) => ({
    ref: ref('call', String(c.id)),
    label: `@call:${c.id}`,
    hint: `${c.method} ${c.path} ${c.status}`,
  }))
  return [...containers, ...apis, ...calls]
}

/** Picker and chips state for the question. `onKeyDown` returns true when it consumed the key (the send must not run). */
export function useRefComposer(
  draft: string,
  setDraft: (value: string) => void,
) {
  const [refs, setRefs] = useState<EtherRef[]>([])
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const match = TRIGGER.exec(draft)
  // null: the picker is closed (no `@` at the end, or Esc closed it for this text).
  const query = match && draft !== dismissedFor ? (match[1] ?? '') : null
  const data = useQuery({
    queryKey: ['ether', 'refs'],
    queryFn: () => gql<OptionsData>(OPTIONS),
    enabled: query !== null,
    staleTime: 15_000,
  })

  const full = refs.length >= MAX_REFS
  const options =
    query === null
      ? []
      : optionsOf(data.data)
          .filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
          .slice(0, MAX_OPTIONS)
  const current = Math.min(active, Math.max(options.length - 1, 0))

  const pick = (option: Option) => {
    setDraft(draft.replace(/@[a-z0-9_:-]*$/i, ''))
    setRefs((prev) =>
      prev.length >= MAX_REFS ||
      prev.some((r) => refKey(r) === refKey(option.ref))
        ? prev
        : [...prev, option.ref],
    )
    setActive(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (query === null || full) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      setDismissedFor(draft)
      return true
    }
    const n = options.length
    if (n === 0) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((current + 1) % n)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((current - 1 + n) % n)
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const option = options[current]
      if (option) pick(option)
      return true
    }
    return false
  }

  return {
    refs,
    remove: (target: EtherRef) =>
      setRefs((prev) => prev.filter((r) => refKey(r) !== refKey(target))),
    clear: () => setRefs([]),
    query,
    loading: query !== null && data.isPending,
    full,
    options,
    active: current,
    pick,
    onKeyDown,
  }
}

export type RefComposer = ReturnType<typeof useRefComposer>

/** Chips over the textarea: the references the next question carries. Each one can be removed. */
export function RefChips({
  refs,
  onRemove,
}: {
  refs: EtherRef[]
  onRemove: (ref: EtherRef) => void
}) {
  if (refs.length === 0) return null
  return (
    <div
      role="group"
      aria-label="Referencias de la pregunta"
      className="flex flex-wrap gap-1.5"
    >
      {refs.map((r) => (
        <span
          key={refKey(r)}
          className="inline-flex h-7 items-center gap-1 rounded-control bg-accent/12 pl-2.5 pr-1 font-mono text-meta"
        >
          {refToken(r)}
          <IconButton
            label={`Quitar ${refToken(r)}`}
            icon={<X size={14} />}
            onClick={() => onRemove(r)}
          />
        </span>
      ))}
    </div>
  )
}

/** The list over the textarea while an `@` is being typed. Options are buttons; the keys are handled by the composer. */
export function RefPicker({ composer }: { composer: RefComposer }) {
  if (composer.query === null) return null
  const { options, active, full, loading } = composer
  return (
    <div
      role="listbox"
      aria-label="Referencias"
      className="absolute bottom-full left-0 z-10 mb-1 flex w-full max-w-md flex-col gap-0.5 rounded-card border border-border bg-surface p-1 shadow-float"
    >
      {full ? (
        <p className="px-2 py-1.5 text-meta text-muted">
          Ya tenés {MAX_REFS} referencias. Quitá una para agregar otra.
        </p>
      ) : loading ? (
        <p className="px-2 py-1.5 text-meta text-muted">
          Cargando referencias…
        </p>
      ) : options.length === 0 ? (
        <p className="px-2 py-1.5 text-meta text-muted">
          Sin coincidencias. Escribí la pregunta sin referencia.
        </p>
      ) : (
        options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            role="option"
            aria-selected={i === active}
            // mousedown would take the focus off the textarea before the click lands
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => composer.pick(o)}
            className={`flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left ${i === active ? 'bg-text/8' : 'hover:bg-text/8'}`}
          >
            <span className="font-mono text-meta">{o.label}</span>
            <span className="truncate text-meta text-muted">{o.hint}</span>
          </button>
        ))
      )}
    </div>
  )
}
