// Ask Ether. Owns everything under src/features/ether/. One orb (the only element with ambient motion), threads on the
// left, the conversation on the right. Live text comes from the `ether-<runId>` SSE channel; the stored text comes from
// GraphQL when the thread is opened.
import { Loader } from '@/app/Loader'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentOrb } from '@wefaber/orb'
import {
  Button,
  Chip,
  Dialog,
  EmptyState,
  IconButton,
  Textarea,
  Tile,
} from '@wefaber/ui'
import {
  Check,
  Copy,
  Plus,
  Reply,
  RotateCw,
  Send,
  Share2,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { follow, gql } from '@/lib/api'
import {
  IDLE_RUN,
  ORB_LABELS,
  START_RUN,
  isTerminal,
  orbPhase,
  reduceRun,
  type EtherEvent,
  type RunState,
} from '../../../shared/ether'
import {
  refToken,
  type EtherRef,
  type MessageSources,
} from '../../../shared/etherRefs'
import { RefChips, RefPicker, useRefComposer } from './refPicker'
import { SourcesRow } from './sources'
import { AnswerBody } from './Diagram'

interface Thread {
  slug: string
  title: string
  updatedAt: string
}

interface Message {
  id: number
  role: 'user' | 'ether'
  body: string
  status: 'pending' | 'done' | 'failed' | 'cancelled'
  runId: string | null
  createdAt: string
  /** Active share link of this answer, when the owner shared it. */
  shareToken: string | null
  /** What Ether looked at; null for questions and older answers. */
  sources: MessageSources | null
}

interface Shared {
  question: string | null
  answer: string
  sharedBy: string
  sharedAt: string
}

interface RunView extends RunState {
  runId: string
  streamKey: string
  seq: number
}

interface Attach {
  runId: string
  /** Secret that names the SSE channel; the server gives it only to the owner and admins. */
  streamKey: string
  thread: string
}

interface Live {
  thread: string
  question: string | null
  state: RunState
}

interface Failure {
  thread: string
  question: string
  refs: EtherRef[]
  message: string
}

const PROMPTS = [
  '¿Por qué falló el último deploy?',
  '¿Qué endpoint está más lento?',
  '¿Qué containers se reiniciaron hoy?',
]

const ME = /* GraphQL */ `
  query EtherMe {
    me {
      login
      role
    }
  }
`

const HEALTH = /* GraphQL */ `
  query EtherHealth {
    etherHealth {
      ok
      reason
    }
  }
`

const THREADS = /* GraphQL */ `
  query EtherThreads {
    etherThreads {
      slug
      title
      updatedAt
    }
  }
`

const MESSAGES = /* GraphQL */ `
  query EtherMessages($thread: String!) {
    etherMessages(thread: $thread) {
      id
      role
      body
      status
      runId
      createdAt
      shareToken
      sources {
        at
        activeTag
        containers {
          service
          state
          health
          image
        }
        errors {
          at
          what
        }
        tools {
          tool
          preview
        }
        refs {
          kind
          id
          title
          facts
        }
      }
    }
  }
`

const SHARED = /* GraphQL */ `
  query EtherShared($token: String!) {
    etherShared(token: $token) {
      question
      answer
      sharedBy
      sharedAt
    }
  }
`

const SHARE = /* GraphQL */ `
  mutation EtherShare($messageId: Int!) {
    etherShare(messageId: $messageId)
  }
`

const UNSHARE = /* GraphQL */ `
  mutation EtherUnshare($token: String!) {
    etherUnshare(token: $token)
  }
`

const RUN = /* GraphQL */ `
  query EtherRun($runId: String!) {
    etherRun(runId: $runId) {
      runId
      streamKey
      phase
      text
      tools {
        tool
        preview
      }
      approval
      error
      seq
    }
  }
`

const ASK = /* GraphQL */ `
  mutation AskEther($thread: String!, $question: String!, $refs: [String!]) {
    askEther(thread: $thread, question: $question, refs: $refs) {
      runId
      streamKey
    }
  }
`

const APPROVE = /* GraphQL */ `
  mutation EtherApprove($runId: String!, $deny: Boolean!) {
    etherApprove(runId: $runId, deny: $deny)
  }
`

const STOP = /* GraphQL */ `
  mutation EtherStop($runId: String!) {
    etherStop(runId: $runId)
  }
`

const newThread = () => crypto.randomUUID().slice(0, 8)

const readShareToken = (): string | null => {
  if (!window.location.hash.startsWith('#ether')) return null
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('s')
}

const linkFor = (token: string) =>
  `${window.location.origin}${window.location.pathname}#ether?s=${token}`

/** The same state the server reduces, rebuilt from a stored view when a page opens mid-run. */
const stateOf = (view: RunView): RunState => ({
  phase: view.phase as RunState['phase'],
  text: view.text,
  tools: view.tools,
  approval: view.approval,
  error: view.error,
})

export default function Section() {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ['ether', 'me'],
    queryFn: () => gql<{ me: { login: string; role: string } }>(ME),
  })
  const isAdmin = me.data?.me.role === 'admin'

  const health = useQuery({
    queryKey: ['ether', 'health'],
    queryFn: () =>
      gql<{ etherHealth: { ok: boolean; reason: string } }>(HEALTH),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const threads = useQuery({
    queryKey: ['ether', 'threads'],
    queryFn: () => gql<{ etherThreads: Thread[] }>(THREADS),
  })

  const [thread, setThread] = useState(newThread)
  const messages = useQuery({
    queryKey: ['ether', 'messages', thread],
    queryFn: () => gql<{ etherMessages: Message[] }>(MESSAGES, { thread }),
  })

  const [live, setLive] = useState<Live | null>(null)
  const [attach, setAttach] = useState<Attach | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [draft, setDraft] = useState('')
  const composer = useRefComposer(draft, setDraft)
  // A selected piece of an answer the next message replies to; sent as `Q: <piece>\nA: <reply>`.
  const [quote, setQuote] = useState('')
  const [sharedToken, setSharedToken] = useState(readShareToken)

  useEffect(() => {
    const onHash = () => setSharedToken(readShareToken())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // A run that is still in flight in this thread (a reload, or a thread reopened) is picked up again.
  const stored = messages.data?.etherMessages
  const open = stored?.findLast(
    (m) => m.role === 'ether' && m.status === 'pending' && m.runId,
  )
  // The stream key is only known from the stored view, so a reopened run is looked up first, then followed.
  const resumeId = open?.runId
  useEffect(() => {
    if (attach || live || !resumeId) return
    gql<{ etherRun: RunView | null }>(RUN, { runId: resumeId })
      .then(({ etherRun }) => {
        if (!etherRun) return
        setLive({ thread, question: null, state: stateOf(etherRun) })
        setAttach({ runId: resumeId, streamKey: etherRun.streamKey, thread })
      })
      .catch(() => {})
  }, [attach, live, resumeId, thread])
  // A run ended: reload the stored thread and list, then drop the live copy. Its own effect, because setAttach(null)
  // re-runs the follow effect's cleanup and that must not cancel the reload.
  const [ended, setEnded] = useState(false)
  useEffect(() => {
    if (!ended) return
    const timer = setTimeout(async () => {
      await qc.refetchQueries({ queryKey: ['ether', 'messages'] })
      await qc.refetchQueries({ queryKey: ['ether', 'threads'] })
      setLive(null)
      setEnded(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [ended, qc])
  const runId = attach?.runId
  const runThread = attach?.thread
  const streamKey = attach?.streamKey

  // Follow one run: buffer the bus while the stored view loads, then apply only what the view does not already cover.
  // When the run ends, the stored message is the record: reload the thread and the list, then drop the live copy.
  useEffect(() => {
    if (!runId || !runThread) return
    let base: number | null = null
    const pending: (EtherEvent & { seq: number })[] = []
    const finish = () => {
      setAttach(null)
      setEnded(true)
    }
    const apply = (ev: EtherEvent) => {
      setLive((prev) =>
        prev ? { ...prev, state: reduceRun(prev.state, ev) } : prev,
      )
      if (ev.type === 'done' || ev.type === 'error') finish()
    }
    const onEvent = (data: unknown) => {
      const ev = data as EtherEvent & { seq: number }
      if (base === null) pending.push(ev)
      else if (ev.seq > base) apply(ev)
    }
    const close = follow(`ether-${streamKey}`, {
      delta: onEvent,
      tool: onEvent,
      approval: onEvent,
      done: onEvent,
      error: onEvent,
    })
    gql<{ etherRun: RunView | null }>(RUN, { runId })
      .then(({ etherRun }) => {
        if (!etherRun) {
          base = -1
          return
        }
        base = etherRun.seq
        setLive((prev) => (prev ? { ...prev, state: stateOf(etherRun) } : prev))
        if (isTerminal(etherRun.phase)) finish()
      })
      .catch(() => {
        base = -1
      })
      .finally(() => {
        for (const ev of pending) if (base !== null && ev.seq > base) apply(ev)
        pending.length = 0
      })
    return close
  }, [runId, runThread, streamKey])

  const ask = useMutation({
    mutationFn: (input: { question: string; refs: EtherRef[] }) =>
      gql<{ askEther: { runId: string; streamKey: string } }>(ASK, {
        thread,
        question: input.question,
        refs: input.refs.map(refToken),
      }).then((d) => ({ ...d.askEther, thread })),
    onMutate: ({ question }) => {
      setFailure(null)
      setLive({ thread, question, state: START_RUN })
    },
    onSuccess: (run) => {
      setDraft('')
      composer.clear()
      setQuote('')
      setAttach(run)
    },
    onError: (e, { question, refs }) => {
      setLive(null)
      setFailure({ thread, question, refs, message: e.message })
    },
    // A new thread or a failed message now exists on the server, so the lists must reload.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ether', 'threads'] })
      void qc.invalidateQueries({ queryKey: ['ether', 'messages'] })
    },
  })

  const act = useMutation({
    mutationFn: (args: { op: 'approve' | 'deny' | 'stop'; runId: string }) =>
      args.op === 'stop'
        ? gql(STOP, { runId: args.runId })
        : gql(APPROVE, { runId: args.runId, deny: args.op === 'deny' }),
    onError: (e) =>
      setFailure({ thread, question: '', refs: [], message: e.message }),
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: ['ether', 'messages'] }),
  })

  const send = (question: string) => {
    const q = question.trim()
    if (!q || ask.isPending || (live && !isTerminal(live.state.phase))) return
    ask.mutate({
      question: quote ? `Q: ${quote}\nA: ${q}` : q,
      refs: composer.refs,
    })
  }

  // A shared link (`#ether?s=<token>`) opens the read-only answer instead of the conversation.
  if (sharedToken) {
    return (
      <Tile title="Respuesta compartida" className="min-h-[70svh]">
        <SharedView token={sharedToken} />
      </Tile>
    )
  }

  const sameThread = live?.thread === thread
  const running = sameThread && live !== null && !isTerminal(live.state.phase)
  const healthBad = health.data !== undefined && !health.data.etherHealth.ok
  const orb =
    healthBad && !running
      ? 'offline'
      : orbPhase(sameThread && live ? live.state : IDLE_RUN)
  const shown = (stored ?? []).filter((m) => m.status !== 'pending')
  // Once the reload after `ask` brings the question in, the live copy would repeat it.
  const last = shown.at(-1)
  const questionStored = last?.role === 'user' && last.body === live?.question

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Tile
        title="Hilos"
        actions={
          <Button size="md" onClick={() => setThread(newThread())}>
            <Plus className="size-4" aria-hidden />
            Nueva consulta
          </Button>
        }
      >
        {threads.data?.etherThreads.length ? (
          <ul className="flex flex-col gap-1">
            {threads.data.etherThreads.map((t) => (
              <li key={t.slug}>
                <button
                  type="button"
                  aria-current={t.slug === thread ? 'true' : undefined}
                  onClick={() => setThread(t.slug)}
                  className={`w-full truncate rounded-control px-3 py-2 text-left text-body hover:bg-text/8 ${t.slug === thread ? 'bg-text/8 font-medium' : 'text-muted'}`}
                >
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            Todavía no hiciste ninguna consulta. Arrancá con una pregunta.
          </EmptyState>
        )}
      </Tile>

      <Tile title="Ask Ether" className="flex min-h-[70svh] flex-col gap-4">
        <div className="flex items-center gap-4">
          <AgentOrb state={orb} size={72} labels={ORB_LABELS} />
          <p className="text-body-lg text-muted" aria-live="polite">
            {healthBad && !running
              ? `Ether no responde: ${health.data?.etherHealth.reason || 'sin motivo informado.'}`
              : running
                ? live?.state.phase === 'waiting_for_approval'
                  ? 'Ether pide aprobación para seguir.'
                  : 'Ether está trabajando…'
                : 'Preguntale a Ether por el stack, los deploys o el servidor.'}
          </p>
          {healthBad && !running ? (
            <Button className="ml-auto" onClick={() => health.refetch()}>
              <RotateCw className="size-4" aria-hidden />
              Reintentar
            </Button>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3">
          {shown.length === 0 && !(sameThread && live?.question) ? (
            <EmptyState>
              Todavía no hay mensajes en este hilo. Probá con una de estas:
              <span className="mt-3 flex flex-wrap gap-2">
                {PROMPTS.map((p) => (
                  <Chip
                    key={p}
                    onClick={() => send(p)}
                    disabled={ask.isPending}
                  >
                    {p}
                  </Chip>
                ))}
              </span>
            </EmptyState>
          ) : null}

          {shown.map((m) => (
            <Bubble
              key={m.id}
              who={m.role === 'user' ? 'Vos' : 'Ether'}
              tone={m.status === 'failed' ? 'error' : undefined}
            >
              {m.role === 'user' ? (
                <ReplyBody body={m.body} />
              ) : (
                <AnswerBody body={m.body} />
              )}
              {m.role === 'ether' && m.status === 'done' ? (
                <div className="mt-2 flex flex-wrap items-center gap-1 select-none">
                  <ReplyToSelection
                    onQuote={(text) => {
                      setQuote(text)
                      document.getElementById('ether-question')?.focus()
                    }}
                  />
                  <ShareControl
                    message={m}
                    onChanged={() => void messages.refetch()}
                  />
                </div>
              ) : null}
              {m.role === 'ether' && m.status === 'done' && m.sources ? (
                <SourcesRow sources={m.sources} />
              ) : null}
            </Bubble>
          ))}

          {sameThread && live?.question && !questionStored ? (
            <Bubble who="Vos">
              <ReplyBody body={live.question} />
            </Bubble>
          ) : null}

          {sameThread &&
          live &&
          (running || live.state.text || live.state.error) ? (
            <Bubble
              who="Ether"
              tone={live.state.phase === 'failed' ? 'error' : undefined}
            >
              <AnswerBody
                body={live.state.text || live.state.error || 'Pensando…'}
              />
              {live.state.tools.length > 0 ? (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {live.state.tools.map((t, i) => (
                    <span
                      key={`${t.tool}-${i}`}
                      title={t.preview}
                      className="inline-flex h-6 items-center rounded-control bg-text/8 px-2 font-mono text-meta text-muted"
                    >
                      {t.tool}
                    </span>
                  ))}
                </span>
              ) : null}
            </Bubble>
          ) : null}

          {sameThread &&
          live?.state.phase === 'waiting_for_approval' &&
          running ? (
            <div
              role="group"
              aria-label="Aprobación pendiente"
              className="rounded-card border border-border bg-surface-2 p-3"
            >
              {isAdmin ? (
                <>
                  <p className="flex items-center gap-2 text-body-lg font-medium">
                    <ShieldAlert className="size-4 text-warning" aria-hidden />
                    Ether quiere ejecutar:
                  </p>
                  <code className="mt-2 block overflow-x-auto rounded-control bg-bg p-2 font-mono text-meta">
                    {live.state.approval}
                  </code>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() =>
                        act.mutate({ op: 'approve', runId: runId ?? '' })
                      }
                      disabled={act.isPending}
                    >
                      <Check className="size-4" aria-hidden />
                      Aprobar
                    </Button>
                    <Button
                      onClick={() =>
                        act.mutate({ op: 'deny', runId: runId ?? '' })
                      }
                      disabled={act.isPending}
                    >
                      <X className="size-4" aria-hidden />
                      Rechazar
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-body-lg text-muted">
                  Esperando que un admin apruebe la acción.
                </p>
              )}
            </div>
          ) : null}

          {failure && failure.thread === thread ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-card border border-danger p-3 text-body-lg"
            >
              <span>{failure.message || 'No se pudo consultar a Ether.'}</span>
              {failure.question ? (
                <Button
                  onClick={() => {
                    setFailure(null)
                    ask.mutate({
                      question: failure.question,
                      refs: failure.refs,
                    })
                  }}
                >
                  <RotateCw className="size-4" aria-hidden />
                  Reintentar
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          {quote ? (
            <div className="flex items-start gap-2 rounded-control border border-border bg-surface-2 p-2 text-body">
              <p className="min-w-0 flex-1 border-l-2 border-accent pl-2 text-muted">
                <span className="font-mono text-meta">Respondiendo a</span>
                <br />
                {quote}
              </p>
              <IconButton
                label="Quitar la cita"
                icon={<X size={16} />}
                onClick={() => setQuote('')}
              />
            </div>
          ) : null}
          <RefChips refs={composer.refs} onRemove={composer.remove} />
          <label htmlFor="ether-question" className="sr-only">
            Pregunta para Ether
          </label>
          <div className="relative">
            <RefPicker composer={composer} />
            <Textarea
              id="ether-question"
              rows={3}
              maxLength={2000 - (quote ? quote.length + 6 : 0)}
              value={draft}
              className="pb-12"
              placeholder={
                quote
                  ? 'Tu respuesta a la cita. Enter envía, Shift+Enter agrega una línea. @ referencia un container, una API o una llamada.'
                  : 'Escribí tu pregunta. Enter envía, Shift+Enter agrega una línea. @ referencia un container, una API o una llamada.'
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (composer.onKeyDown(e)) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(draft)
                }
              }}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-2">
              {running && runId ? (
                <Button
                  variant="danger"
                  onClick={() => act.mutate({ op: 'stop', runId })}
                  disabled={act.isPending}
                >
                  <Square className="size-4" aria-hidden />
                  Detener
                </Button>
              ) : null}
              <Button
                variant="primary"
                type="submit"
                disabled={!draft.trim() || running || ask.isPending}
              >
                <Send className="size-4" aria-hidden />
                Enviar
              </Button>
            </div>
          </div>
        </form>
      </Tile>
    </div>
  )
}

function Bubble({
  who,
  tone,
  children,
}: {
  who: string
  tone?: 'error'
  children: ReactNode
}) {
  return (
    <div
      data-answer={who === 'Ether' ? '' : undefined}
      className={`rounded-card p-3 ${who === 'Vos' ? 'ml-auto max-w-[85%] bg-accent/12' : 'max-w-[90%] bg-surface-2'}`}
    >
      <p className="mb-1 font-mono text-meta text-muted">{who}</p>
      <div
        className={`whitespace-pre-wrap text-body-lg ${tone === 'error' ? 'text-danger' : ''}`}
      >
        {children}
      </div>
    </div>
  )
}

/** Share button under a finished answer. The link itself is managed in a modal. */
function ShareControl({
  message,
  onChanged,
}: {
  message: Message
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const share = useMutation({
    mutationFn: () =>
      gql<{ etherShare: string }>(SHARE, { messageId: message.id }).then(
        (d) => d.etherShare,
      ),
    onSuccess: (token) => {
      setLink(linkFor(token))
      onChanged()
    },
  })
  const unshare = useMutation({
    mutationFn: (token: string) => gql(UNSHARE, { token }),
    onSuccess: () => {
      setLink(null)
      onChanged()
    },
  })
  const url = link ?? (message.shareToken ? linkFor(message.shareToken) : null)
  const error = share.error ?? unshare.error

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Share2 className="size-4" aria-hidden />
        {url ? 'Compartida' : 'Compartir'}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false)
          setCopied(false)
        }}
        title="Compartir respuesta"
        closeLabel="Cerrar"
      >
        {url ? (
          <>
            <p className="text-muted">
              Cualquiera del panel con este link ve la respuesta, solo lectura.
              La conversación y el run siguen privados.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                aria-label="Link de la respuesta compartida"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-control border border-border bg-bg px-2 py-1 font-mono text-meta"
              />
              <Button
                variant="primary"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => setCopied(true))
                    .catch(() => {})
                }}
              >
                <Copy className="size-4" aria-hidden />
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <div>
              <Button
                variant="danger"
                onClick={() =>
                  message.shareToken && unshare.mutate(message.shareToken)
                }
                disabled={unshare.isPending || !message.shareToken}
              >
                Dejar de compartir
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              Se crea un link de solo lectura a esta respuesta. Podés dejar de
              compartirla cuando quieras.
            </p>
            <div>
              <Button
                variant="primary"
                onClick={() => share.mutate()}
                disabled={share.isPending}
              >
                <Share2 className="size-4" aria-hidden />
                Crear link
              </Button>
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-danger">
            {error.message}
          </p>
        ) : null}
      </Dialog>
    </>
  )
}

/** Shows `Q: <piece>` + `A: <reply>` as a quote plus the reply; any other message as it is. */
function ReplyBody({ body }: { body: string }) {
  const m = /^Q: ([\s\S]*?)\nA: ([\s\S]*)$/.exec(body)
  if (!m) return body
  return (
    <>
      <span className="mb-2 block border-l-2 border-accent pl-2 text-muted">
        {m[1]}
      </span>
      {m[2]}
    </>
  )
}

/** Appears under an answer when part of it is selected: "reply to this part". Only a selection inside that answer counts. */
function ReplyToSelection({ onQuote }: { onQuote: (text: string) => void }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const read = () => {
      const sel = window.getSelection()
      const bubble = box.current?.closest('[data-answer]')
      const inside =
        !!sel &&
        !sel.isCollapsed &&
        !!bubble?.contains(sel.anchorNode) &&
        !!bubble.contains(sel.focusNode)
      setText(inside ? sel.toString().trim().slice(0, 600) : '')
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [])
  return (
    <span ref={box}>
      {text ? (
        <Button
          variant="ghost"
          // mousedown would drop the selection before the click lands
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onQuote(text)
            window.getSelection()?.removeAllRanges()
          }}
        >
          <Reply className="size-4" aria-hidden />
          Responder a esta parte
        </Button>
      ) : null}
    </span>
  )
}

/** Read-only answer behind a share link. It shows the text only: never the run, its stream or its approvals. */
function SharedView({ token }: { token: string }) {
  const shared = useQuery({
    queryKey: ['ether', 'shared', token],
    queryFn: () =>
      gql<{ etherShared: Shared | null }>(SHARED, { token }).then(
        (d) => d.etherShared,
      ),
    retry: false,
  })
  const back = () => {
    window.location.hash = 'ether'
  }

  if (shared.isPending) return <Loader />
  if (!shared.data)
    return (
      <div className="flex flex-col gap-3">
        <EmptyState>
          Esta respuesta ya no está compartida, o el link está mal.
        </EmptyState>
        <Button onClick={back}>Volver a mis consultas</Button>
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      {shared.data.question ? (
        <Bubble who="Pregunta">{shared.data.question}</Bubble>
      ) : null}
      <Bubble who="Ether">
        <AnswerBody body={shared.data.answer} />
      </Bubble>
      <p className="text-meta text-muted">
        Compartida por {shared.data.sharedBy} · solo lectura
      </p>
      <div>
        <Button onClick={back}>Volver a mis consultas</Button>
      </div>
    </div>
  )
}
