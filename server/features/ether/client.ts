// Ask Ether's model, behind one interface: `deepseekEther` over fetch (DeepSeek chat completions, OpenAI-compatible,
// streamed) and `fixtureEther` for dev and tests. Ether is the panel's assistant, not an agent: it has no tools of its
// own. Everything it knows travels in the prompt (panel snapshot + repo context), so a run is one stateless completion.
import type { EtherEvent } from '../../../shared/ether'
import type { Config } from '../../config'

export type EtherErrorCode = 'OFFLINE' | 'TIMEOUT' | 'AUTH' | 'HTTP'

export class EtherError extends Error {
  code: EtherErrorCode
  status: number
  constructor(message: string, code: EtherErrorCode, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
  get offline(): boolean {
    return this.code === 'OFFLINE' || this.code === 'TIMEOUT'
  }
}

export interface RunStatus {
  status: string
  output: string
  error: string
  approval: string | null
}

export interface EtherClient {
  /** Is the model endpoint answering with this key? `reason` is user-facing when it is not. */
  ping(): Promise<{ ok: boolean; reason: string }>
  /** Starts a run and returns its id once the model accepted the request. Throws without retrying. */
  start(input: string, sessionId: string, system?: string): Promise<string>
  /** Events until a terminal one (done/error). Ends silently when `signal` aborts. */
  events(runId: string, signal: AbortSignal): AsyncIterable<EtherEvent>
  status(runId: string): Promise<RunStatus>
  approve(runId: string, choice: 'once' | 'deny'): Promise<void>
  stop(runId: string): Promise<void>
}

const RUN_TIMEOUT_MS = 180_000
const PING_TIMEOUT_MS = 5_000
const TEMPERATURE = 0.2

/** Incremental SSE parser: feed text chunks, get the `data:` payloads of complete events. */
export function sseData() {
  let buffer = ''
  return (chunk: string): string[] => {
    buffer += chunk.replaceAll('\r\n', '\n')
    const out: string[] = []
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
      if (data.length) out.push(data.join('\n'))
    }
    return out
  }
}

/** Text of one streamed chunk (`choices[0].delta.content`), or null for anything else: an odd event never breaks the answer. */
export function deltaText(data: string): string | null {
  let j: unknown
  try {
    j = JSON.parse(data)
  } catch {
    return null
  }
  if (!j || typeof j !== 'object') return null
  const choices = (j as { choices?: unknown }).choices
  const first = Array.isArray(choices) ? (choices[0] as unknown) : null
  if (!first || typeof first !== 'object') return null
  const delta = (first as { delta?: unknown }).delta
  if (!delta || typeof delta !== 'object') return null
  const content = (delta as { content?: unknown }).content
  return typeof content === 'string' && content ? content : null
}

/** The user-facing error for a non-2xx answer of the model endpoint. */
export function httpError(status: number): EtherError {
  if (status === 401 || status === 403)
    return new EtherError(
      'DeepSeek rechazó la clave del panel.',
      'AUTH',
      status,
    )
  if (status === 402)
    return new EtherError(
      'La cuenta de DeepSeek no tiene saldo.',
      'HTTP',
      status,
    )
  if (status === 429)
    return new EtherError(
      'DeepSeek está limitando las consultas. Probá en un momento.',
      'HTTP',
      status,
    )
  return new EtherError(
    `DeepSeek respondió ${status}.`,
    status >= 500 ? 'OFFLINE' : 'HTTP',
    status,
  )
}

interface LiveRun {
  parts: string[]
  state: 'running' | 'completed' | 'cancelled' | 'failed'
  error: EtherError | null
  ctl: AbortController
  wake: Set<() => void>
}

export function deepseekEther(
  cfg: Config['ether'],
  fetchFn: typeof fetch = fetch,
): EtherClient {
  const base = cfg.url.replace(/\/+$/, '')
  const runs = new Map<string, LiveRun>()
  let counter = 0

  const noKey = () =>
    new EtherError(
      'Falta la clave de DeepSeek en la config del panel (DEEPSEEK_API_KEY).',
      'AUTH',
    )
  const get = (runId: string): LiveRun => {
    const run = runs.get(runId)
    if (!run)
      throw new EtherError(`No existe la consulta ${runId}.`, 'HTTP', 404)
    return run
  }
  const settle = (
    run: LiveRun,
    state: LiveRun['state'],
    error?: EtherError,
  ) => {
    if (run.state !== 'running') return
    run.state = state
    run.error = error ?? null
    for (const w of run.wake) w()
  }

  /** Reads the streamed body into `run.parts` until the model ends it. Never throws: it settles the run. */
  async function pump(run: LiveRun, body: ReadableStream<Uint8Array>) {
    const parse = sseData()
    const decoder = new TextDecoder()
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const data of parse(decoder.decode(value, { stream: true }))) {
          if (data === '[DONE]') return settle(run, 'completed')
          const piece = deltaText(data)
          if (piece) {
            run.parts.push(piece)
            for (const w of run.wake) w()
          }
        }
      }
      settle(run, 'completed')
    } catch {
      if (
        run.ctl.signal.aborted &&
        run.ctl.signal.reason?.name !== 'TimeoutError'
      )
        settle(run, 'cancelled')
      else
        settle(
          run,
          'failed',
          new EtherError('Se cortó la conexión con DeepSeek.', 'OFFLINE'),
        )
    } finally {
      reader.cancel().catch(() => {})
    }
  }

  return {
    async ping() {
      if (!cfg.key) return { ok: false, reason: noKey().message }
      try {
        const res = await fetchFn(`${base}/models`, {
          headers: { authorization: `Bearer ${cfg.key}` },
          signal: AbortSignal.timeout(PING_TIMEOUT_MS),
        })
        return res.ok
          ? { ok: true, reason: '' }
          : { ok: false, reason: httpError(res.status).message }
      } catch {
        return { ok: false, reason: 'No se pudo conectar con DeepSeek.' }
      }
    },

    async start(input, _sessionId, system = '') {
      if (!cfg.key) throw noKey()
      const ctl = new AbortController()
      const run: LiveRun = {
        parts: [],
        state: 'running',
        error: null,
        ctl,
        wake: new Set(),
      }
      let res: Response
      try {
        res = await fetchFn(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${cfg.key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: cfg.model,
            temperature: TEMPERATURE,
            stream: true,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: input },
            ],
          }),
          signal: AbortSignal.any([
            ctl.signal,
            AbortSignal.timeout(RUN_TIMEOUT_MS),
          ]),
        })
      } catch (e) {
        if (e instanceof Error && e.name === 'TimeoutError')
          throw new EtherError('DeepSeek no respondió a tiempo.', 'TIMEOUT')
        throw new EtherError('No se pudo conectar con DeepSeek.', 'OFFLINE')
      }
      if (!res.ok) throw httpError(res.status)
      if (!res.body)
        throw new EtherError('DeepSeek no devolvió respuesta.', 'HTTP')
      const runId = `run_${Date.now().toString(36)}${String(++counter).padStart(4, '0')}`
      runs.set(runId, run)
      void pump(run, res.body)
      // A finished run is only needed for the runner's late status polls.
      setTimeout(() => runs.delete(runId), RUN_TIMEOUT_MS + 60_000).unref()
      return runId
    },

    async *events(runId, signal) {
      const run = get(runId)
      let i = 0
      for (;;) {
        while (i < run.parts.length) {
          if (signal.aborted) return
          yield { type: 'delta', text: run.parts[i++] ?? '' }
        }
        if (run.state !== 'running') break
        // Sequential on purpose: this is a stream consumer, each wait is for the next chunk and the order is the answer.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await new Promise<void>((resolve) => {
          const done = () => {
            run.wake.delete(done)
            signal.removeEventListener('abort', done)
            resolve()
          }
          run.wake.add(done)
          signal.addEventListener('abort', done, { once: true })
        })
        if (signal.aborted) return
      }
      const output = run.parts.join('')
      if (run.state === 'failed')
        yield {
          type: 'error',
          message: run.error?.message ?? 'Ether no pudo terminar la consulta.',
          offline: run.error?.offline ?? false,
        }
      else
        yield {
          type: 'done',
          status: run.state === 'cancelled' ? 'cancelled' : 'completed',
          output,
        }
    },

    async status(runId) {
      const run = get(runId)
      return {
        status: run.state === 'failed' ? 'failed' : run.state,
        output: run.parts.join(''),
        error: run.error?.message ?? '',
        approval: null,
      }
    },

    async approve() {
      // Ether has no tools to approve: nothing waits on this.
    },

    async stop(runId) {
      const run = get(runId)
      run.ctl.abort()
      settle(run, 'cancelled')
    },
  }
}

// ---- Fixture: deterministic runs for dev and tests ----

export const FIXTURE_ANSWER =
  'Revisé el estado del stack: db, back y front están arriba y sanos. El último deploy terminó bien; ' +
  'lo único que vi fueron un par de 401 en /login.php, que son intentos con clave incorrecta y no fallas del servicio.'

export const FIXTURE_APPROVED =
  'Listo, reinicié el container back y volvió a responder 200 en el health check.'

export const FIXTURE_DENIED =
  'Entendido, no toqué nada. El container back sigue como estaba.'

/** Questions that make the fixture ask for approval, like a real restart would. */
export const FIXTURE_NEEDS_APPROVAL = /reinici|restart|apag[aá]|reconstru/i

/** Answer to a question that asks for a diagram: one Mermaid block, so the diagram path runs without a live Ether. */
export const FIXTURE_DIAGRAM = [
  'Así se conectan las piezas que mira el panel:',
  '',
  '```mermaid',
  'flowchart LR',
  '  Panel[Tabula] --> API[API Elysia]',
  '  API --> Podman[Podman rootless]',
  '  API --> GitHub[GitHub REST]',
  '  API --> LLM[DeepSeek]',
  '```',
  '',
  'La API habla con Podman por el socket, con GitHub en solo lectura y con DeepSeek para Ether.',
].join('\n')
export const FIXTURE_DIAGRAM_QUESTION = /diagrama/i

interface FixtureRun {
  asksApproval: boolean
  answer: string
  decision: Promise<'once' | 'deny' | 'stop'>
  decide: (d: 'once' | 'deny' | 'stop') => void
  decided: 'once' | 'deny' | 'stop' | null
}

function chunks(text: string, size = 24): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/** `delayMs` paces the stream so the UI can be watched; tests pass 0. */
export function fixtureEther({
  delayMs = 0,
}: { delayMs?: number } = {}): EtherClient & {
  inputs: { input: string; sessionId: string }[]
} {
  const runs = new Map<string, FixtureRun>()
  const inputs: { input: string; sessionId: string }[] = []
  let counter = 0
  const sleep = (ms: number) =>
    ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve()

  const get = (runId: string) => {
    const run = runs.get(runId)
    if (!run)
      throw new EtherError(`No existe la consulta ${runId}.`, 'HTTP', 404)
    return run
  }

  return {
    inputs,
    async ping() {
      return { ok: true, reason: '' }
    },

    async start(input, sessionId) {
      inputs.push({ input, sessionId })
      const runId = `run_fixture${String(++counter).padStart(4, '0')}`
      let decide: FixtureRun['decide'] = () => {}
      const decision = new Promise<'once' | 'deny' | 'stop'>((resolve) => {
        decide = (d) => {
          if (run.decided) return
          run.decided = d
          resolve(d)
        }
      })
      // The question is the part after the snapshot's closing marker.
      const question = input.split('</snapshot>').pop() ?? input
      const run: FixtureRun = {
        asksApproval: FIXTURE_NEEDS_APPROVAL.test(question),
        answer: FIXTURE_DIAGRAM_QUESTION.test(question)
          ? FIXTURE_DIAGRAM
          : FIXTURE_ANSWER,
        decision,
        decide,
        decided: null,
      }
      runs.set(runId, run)
      return runId
    },

    async *events(runId, signal) {
      const run = get(runId)
      const live = () => !signal.aborted
      yield { type: 'tool', tool: 'podman', preview: 'podman ps --all' }
      await sleep(delayMs)
      if (run.asksApproval) {
        yield {
          type: 'approval',
          summary: 'systemctl --user restart nexus-test_back_1',
        }
        const decision = await Promise.race([
          run.decision,
          new Promise<'stop'>((resolve) =>
            signal.addEventListener('abort', () => resolve('stop'), {
              once: true,
            }),
          ),
        ])
        if (!live()) return
        if (decision === 'stop') {
          yield { type: 'done', status: 'cancelled', output: '' }
          return
        }
        const answer = decision === 'once' ? FIXTURE_APPROVED : FIXTURE_DENIED
        if (decision === 'once')
          yield { type: 'tool', tool: 'terminal', preview: 'restart back' }
        for (const text of chunks(answer)) {
          if (!live()) return
          yield { type: 'delta', text }
          await sleep(delayMs)
        }
        yield { type: 'done', status: 'completed', output: answer }
        return
      }
      for (const text of chunks(run.answer)) {
        if (!live()) return
        if (run.decided === 'stop') {
          yield { type: 'done', status: 'cancelled', output: '' }
          return
        }
        yield { type: 'delta', text }
        await sleep(delayMs)
      }
      yield { type: 'done', status: 'completed', output: run.answer }
    },

    async status(runId) {
      const run = get(runId)
      return {
        status: run.decided === 'stop' ? 'cancelled' : 'running',
        output: '',
        error: '',
        approval: null,
      }
    },

    async approve(runId, choice) {
      get(runId).decide(choice)
    },

    async stop(runId) {
      get(runId).decide('stop')
    },
  }
}
