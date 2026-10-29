// "Fuentes" under a finished answer: what Ether looked at (the state photo, the tool steps of the run, the referenced
// items). Each chip opens a Dialog with its detail. The data is the one stored with the answer; nothing is fetched here.
import { Chip, Dialog, EmptyState } from '@wefaber/ui'
import { useState } from 'react'
import {
  refKey,
  refToken,
  type MessageSources,
} from '../../../shared/etherRefs'

/** `state`, `tools`, or the index of a referenced item in `sources.refs`. */
type Open = 'state' | 'tools' | number | null

const TITLES = {
  state: 'Estado del sistema',
  tools: 'Herramientas usadas',
} as const

export function SourcesRow({ sources }: { sources: MessageSources }) {
  const [open, setOpen] = useState<Open>(null)
  const errors = sources.errors.length
  const ref = typeof open === 'number' ? sources.refs[open] : undefined
  const title =
    open === null
      ? ''
      : ref
        ? refToken(ref)
        : open === 'state' || open === 'tools'
          ? TITLES[open]
          : ''

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 select-none">
      <span className="font-mono text-meta text-muted">Fuentes</span>
      <Chip onClick={() => setOpen('state')}>
        Estado · {sources.containers.length} containers
        {errors ? ` · ${errors} errores` : ''}
      </Chip>
      <Chip onClick={() => setOpen('tools')}>
        Herramientas · {sources.tools.length}
      </Chip>
      {sources.refs.map((r, i) => (
        <Chip key={refKey(r)} onClick={() => setOpen(i)}>
          {refToken(r)}
        </Chip>
      ))}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={title}
        closeLabel="Cerrar"
      >
        {open === 'state' ? <StateDetail sources={sources} /> : null}
        {open === 'tools' ? <ToolsDetail sources={sources} /> : null}
        {ref ? <Facts facts={ref.facts} /> : null}
      </Dialog>
    </div>
  )
}

function StateDetail({ sources }: { sources: MessageSources }) {
  return (
    <div className="flex flex-col gap-3 text-body">
      <p className="font-mono text-meta text-muted">
        Foto tomada {sources.at}
        {sources.activeTag ? ` · tag activo ${sources.activeTag}` : ''}
      </p>
      <section className="flex flex-col gap-1">
        <h3 className="font-mono text-meta text-muted">Containers</h3>
        {sources.containers.length ? (
          <ul className="flex flex-col gap-1">
            {sources.containers.map((c) => (
              <li key={c.service} className="font-mono text-meta">
                {c.service}: {c.state}
                {c.health ? `/${c.health}` : ''} · {c.image}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No había containers del stack.</EmptyState>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-mono text-meta text-muted">Errores recientes</h3>
        {sources.errors.length ? (
          <ul className="flex flex-col gap-1">
            {sources.errors.map((e, i) => (
              <li key={`${e.at}-${i}`} className="font-mono text-meta">
                {e.at} · {e.what}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Sin errores recientes.</EmptyState>
        )}
      </section>
    </div>
  )
}

function ToolsDetail({ sources }: { sources: MessageSources }) {
  if (sources.tools.length === 0)
    return <EmptyState>Ether no usó herramientas en esta respuesta.</EmptyState>
  return (
    <ol className="flex flex-col gap-2">
      {sources.tools.map((t, i) => (
        <li key={`${t.tool}-${i}`} className="flex flex-col gap-0.5">
          <span className="font-mono text-meta">{t.tool}</span>
          {t.preview ? (
            <span className="font-mono text-meta text-muted break-all">
              {t.preview}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Facts({ facts }: { facts: string[] }) {
  return (
    <ul className="flex flex-col gap-1 text-body">
      {facts.map((f, i) => (
        <li key={i} className="font-mono text-meta break-all">
          {f}
        </li>
      ))}
    </ul>
  )
}
