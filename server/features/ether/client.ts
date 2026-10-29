// Hermes run API (Ether), behind one interface: `etherClient` over fetch for the VPS, `fixtureEther` for dev and tests.
// Contract: POST /p/<profile>/v1/runs {input, session_id} -> {run_id}; GET .../runs/<id>/events (SSE, ends with a
// run.* event); GET .../runs/<id>; POST .../approval {choice}; POST .../stop. A run survives the request that started
// it, so a request that times out is NEVER sent again: resending would duplicate side effects on the server.
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
  /** GET /v1/health: is Ether answering? `reason` is user-facing when it is not. */
  ping(): Promise<{ ok: boolean; reason: string }>
  /** Starts a run and returns its id. Throws without retrying. */
  start(input: string, sessionId: string): Promise<string>
  /** Events until a terminal one (done/error). Ends silently when `signal` aborts. */
  events(runId: string, signal: AbortSignal): AsyncIterable<EtherEvent>
  status(runId: string): Promise<RunStatus>
  approve(runId: string, choice: 'once' | 'deny'): Promise<void>
  stop(runId: string): Promise<void>
}

const START_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 15_000

const asText = (v: unknown): string => (typeof v === 'string' ? v : '')

/** What Ether wants approved, as one short line. Never longer than a command should be. */
export function approvalSummary(raw: unknown): string {
  if (typeof raw === 'string') return raw.slice(0, 500)
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const key of ['command', 'description', 'message', 'summary']) {
      const v = asText(o[key])
      if (v) return v.slice(0, 500)
    }
    return JSON.stringify(raw).slice(0, 500)
  }
  return 'Ether pide permiso para seguir.'
}

/** One decoded SSE `data:` payload -> the panel's event, or null for the ones the panel ignores. */
export function mapHermesEvent(
  ev: Record<string, unknown>,
  fallbackName = '',
): EtherEvent | null {
  const name = asText(ev.event) || asText(ev.type) || fallbackName
  switch (name) {
    case 'message.delta': {
      const text = asText(ev.delta)
      return text ? { type: 'delta', text } : null
    }
    case 'tool.started':
      return {
        type: 'tool',
        tool: asText(ev.tool) || 'tool',
        preview: asText(ev.preview).slice(0, 240),
      }
    case 'run.completed':
      return { type: 'done', status: 'completed', output: asText(ev.output) }
    case 'run.cancelled':
    case 'run.stopped':
      return { type: 'done', status: 'cancelled', output: asText(ev.output) }
    case 'run.failed':
    case 'run.error':
      return {
        type: 'error',
        message: asText(ev.error) || 'Ether no pudo terminar la consulta.',
        offline: false,
      }
  }
  if (
    name.includes('approval') &&
    !/resolved|responded|granted|denied/.test(name)
  )
    return { type: 'approval', summary: approvalSummary(ev.approval ?? ev) }
  return null
}

/** Incremental SSE parser: feed text chunks, get decoded `{name, data}` frames. */
export function sseFrames() {
  let buffer = ''
  return (chunk: string): { name: string; data: unknown }[] => {
    buffer += chunk.replaceAll('\r\n', '\n')
    const frames: { name: string; data: unknown }[] = []
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      let name = ''
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (data.length === 0) continue
      try {
        frames.push({ name, data: JSON.parse(data.join('\n')) })
      } catch {}
    }
    return frames
  }
}

export function etherClient(
  cfg: Config['ether'],
  fetchFn: typeof fetch = fetch,
): EtherClient {
  const base = `${cfg.url.replace(/\/+$/, '')}/p/${encodeURIComponent(cfg.profile)}`
  const headers = (json = false): Record<string, string> => ({
    authorization: `Bearer ${cfg.key}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  })

  async function call(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    if (!cfg.key)
      throw new EtherError(
        'Falta la clave de Ether en la config del panel (ETHER_KEY).',
        'AUTH',
      )
    let res: Response
    try {
      res = await fetchFn(base + path, {
        method,
        headers: headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError')
        throw new EtherError(
          'Ether no respondió a tiempo. No reenvié la consulta: puede que igual esté corriendo.',
          'TIMEOUT',
        )
      throw new EtherError('No se pudo conectar con Ether.', 'OFFLINE')
    }
    if (res.status === 401 || res.status === 403)
      throw new EtherError(
        'Ether rechazó la clave del panel.',
        'AUTH',
        res.status,
      )
    if (!res.ok)
      throw new EtherError(
        `Ether respondió ${res.status}.`,
        res.status >= 500 ? 'OFFLINE' : 'HTTP',
        res.status,
      )
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  }

  return {
    async ping() {
      try {
        await call('GET', '/v1/health', undefined, 5_000)
        return { ok: true, reason: '' }
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof EtherError ? e.message : 'Ether no responde.',
        }
      }
    },

    async start(input, sessionId) {
      const out = await call(
        'POST',
        '/v1/runs',
        { input, session_id: sessionId },
        START_TIMEOUT_MS,
      )
      const id = asText(out.run_id)
      if (!id)
        throw new EtherError('Ether no devolvió el id de la consulta.', 'HTTP')
      return id
    },

    async *events(runId, signal) {
      if (!cfg.key)
        throw new EtherError(
          'Falta la clave de Ether en la config del panel (ETHER_KEY).',
          'AUTH',
        )
      let res: Response
      try {
        res = await fetchFn(
          `${base}/v1/runs/${encodeURIComponent(runId)}/events`,
          {
            headers: { ...headers(), accept: 'text/event-stream' },
            signal,
          },
        )
      } catch {
        if (signal.aborted) return
        throw new EtherError('Se cortó la conexión con Ether.', 'OFFLINE')
      }
      if (!res.ok || !res.body)
        throw new EtherError(
          `Ether respondió ${res.status} al seguir la consulta.`,
          res.status >= 500 ? 'OFFLINE' : 'HTTP',
          res.status,
        )
      const parse = sseFrames()
      const decoder = new TextDecoder()
      const reader = res.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          for (const frame of parse(decoder.decode(value, { stream: true }))) {
            const mapped = mapHermesEvent(
              (frame.data ?? {}) as Record<string, unknown>,
              frame.name,
            )
            if (!mapped) continue
            yield mapped
            if (mapped.type === 'done' || mapped.type === 'error') return
          }
        }
      } catch {
        if (signal.aborted) return
        throw new EtherError('Se cortó la conexión con Ether.', 'OFFLINE')
      } finally {
        reader.cancel().catch(() => {})
      }
    },

    async status(runId) {
      const o = await call(
        'GET',
        `/v1/runs/${encodeURIComponent(runId)}`,
        undefined,
        CALL_TIMEOUT_MS,
      )
      return {
        status: asText(o.status),
        output: asText(o.output),
        error: asText(o.error),
        approval: o.approval ? approvalSummary(o.approval) : null,
      }
    },

    async approve(runId, choice) {
      await call(
        'POST',
        `/v1/runs/${encodeURIComponent(runId)}/approval`,
        { choice },
        CALL_TIMEOUT_MS,
      )
    },

    async stop(runId) {
      await call(
        'POST',
        `/v1/runs/${encodeURIComponent(runId)}/stop`,
        {},
        CALL_TIMEOUT_MS,
      )
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
  '  API --> Hermes[Ether Hermes]',
  '```',
  '',
  'La API habla con Podman por el socket, con GitHub en solo lectura y con Hermes por loopback.',
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
