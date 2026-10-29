// Ask Ether's diagrams. A closed ```mermaid block in an answer becomes an SVG drawn by Pele, with a dialog to enlarge
// it and a copy of the source. When it does not draw, the source shows as text. Used by the thread and the shared view.
import { Button, Dialog } from '@wefaber/ui'
import { Check, Copy, Maximize2 } from 'lucide-react'
import { Fragment, useId, useMemo, useState } from 'react'
import { drawMermaid, splitMermaid } from '../../../shared/mermaid'

/** An answer as text, with each Mermaid block drawn in place. */
export function AnswerBody({ body }: { body: string }) {
  return (
    <>
      {splitMermaid(body).map((part, i) =>
        part.kind === 'text' ? (
          <Fragment key={i}>{part.text}</Fragment>
        ) : (
          <Diagram key={i} code={part.code} />
        ),
      )}
    </>
  )
}

export function Diagram({ code }: { code: string }) {
  const id = useId()
  const drawn = useMemo(
    () => drawMermaid(code, `ether-${id.replace(/\W/g, '')}`),
    [code, id],
  )
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => {})
  }

  const toolbar = (
    <div className="mt-2 flex flex-wrap items-center gap-1 select-none">
      {'svg' in drawn ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Maximize2 className="size-4" aria-hidden />
          Ampliar
        </Button>
      ) : null}
      <Button variant="ghost" onClick={copy}>
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {copied ? 'Copiado' : 'Copiar Mermaid'}
      </Button>
    </div>
  )

  if ('error' in drawn)
    return (
      <figure className="flex flex-col gap-2">
        <p role="note" className="text-meta text-muted">
          No se pudo dibujar el diagrama ({drawn.error}). Este es el código
          Mermaid:
        </p>
        <pre className="overflow-x-auto rounded-control bg-bg p-2 font-mono text-meta">
          {code}
        </pre>
        {toolbar}
      </figure>
    )

  return (
    <figure className="flex flex-col gap-1">
      <div
        className="overflow-x-auto rounded-card bg-surface p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: drawn.svg }}
      />
      {toolbar}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Diagrama"
        closeLabel="Cerrar"
      >
        <div
          className="overflow-auto [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: drawn.svg }}
        />
      </Dialog>
    </figure>
  )
}
