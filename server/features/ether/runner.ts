// Runs of Ask Ether: starts one on Hermes, pumps its events to the bus (`ether-<runId>`), keeps the live state so a
// page that opens mid-run can catch up, and stores the final text. One live run per person, a few across the panel.
import { randomBytes } from 'node:crypto'
import { audit } from '../../audit'
import type { User } from '../../auth'
import { fail } from '../../graphql/builder'
import type { Deps } from '../../deps'
import {
  START_RUN,
  isTerminal,
  reduceRun,
  type EtherEvent,
  type RunState,
} from '../../../shared/ether'
import type { MessageSources } from '../../../shared/etherRefs'
import {
  EtherError,
  etherClient,
  fixtureEther,
  type EtherClient,
} from './client'
import { parseRefs, resolveRefs } from './refs'
import { buildInput, collectSnapshot } from './snapshot'
import {
  addMessage,
  closeDangling,
  finishMessage,
  prune,
  sessionId,
  setMessageRun,
  THREAD_SLUG,
  titleOf,
  touchThread,
} from './store'

export const MAX_QUESTION = 2000
const AUDIT_QUESTION = 200
const MAX_LIVE_RUNS = 4

export interface ActiveRun {
  runId: string
  /** Secret channel key: the bus channel is `ether-<streamKey>`, never derived from the run id. */
  streamKey: string
  userId: number
  login: string
  thread: string
  messageId: number
  state: RunState
  /** Photo taken when the question was sent; the tool steps are added when the run ends. */
  sources: MessageSources
  /** Counts emitted events so a late subscriber can drop what its snapshot already covers. */
  seq: number
  abort: AbortController
}

export interface RunnerOptions {
  now?: () => Date
  maxRunMs?: number
  stopGraceMs?: number
  pollMs?: number
  /** How long a finished run stays queryable before only the stored message remains. */
  keepMs?: number
}

export const channelOf = (streamKey: string) => `ether-${streamKey}`

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** An Ether failure turned into the stable GraphQL error the UI reads (`ETHER_OFFLINE` shows the retry state). */
export function failFrom(e: unknown): never {
  if (e instanceof EtherError)
    fail(e.offline ? 'ETHER_OFFLINE' : `ETHER_${e.code}`, e.message)
  throw e
}

export class EtherRuns {
  readonly active = new Map<string, ActiveRun>()
  private readonly now: () => Date
  private readonly maxRunMs: number
  private readonly stopGraceMs: number
  private readonly pollMs: number
  private readonly keepMs: number

  constructor(
    private readonly deps: Deps,
    readonly client: EtherClient,
    opts: RunnerOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date())
    this.maxRunMs = opts.maxRunMs ?? 15 * 60_000
    this.stopGraceMs = opts.stopGraceMs ?? 5_000
    this.pollMs = opts.pollMs ?? 2_000
    this.keepMs = opts.keepMs ?? 120_000
  }

  /** Boot: close messages whose pump died with the last process, and drop expired threads. */
  boot(): void {
    closeDangling(this.deps.db)
    prune(this.deps.db, this.now())
  }

  stopAll(): void {
    for (const run of this.active.values()) run.abort.abort()
  }

  async ask(
    user: User,
    thread: string,
    rawQuestion: string,
    rawRefs?: readonly string[] | null,
  ): Promise<{ runId: string; streamKey: string }> {
    const question = rawQuestion.trim()
    if (!THREAD_SLUG.test(thread))
      fail('BAD_INPUT', 'El hilo no es válido: probá abrir uno nuevo.')
    if (!question) fail('BAD_INPUT', 'Escribí qué querés preguntarle a Ether.')
    if (question.length > MAX_QUESTION)
      fail(
        'BAD_INPUT',
        `La pregunta tiene que tener hasta ${MAX_QUESTION} caracteres.`,
      )
    const refs = parseRefs(rawRefs)
    for (const run of this.active.values())
      if (run.userId === user.id && !isTerminal(run.state.phase))
        fail(
          'BUSY',
          'Ya tenés una consulta en curso. Esperá que termine o detenela.',
        )
    const live = [...this.active.values()].filter(
      (r) => !isTerminal(r.state.phase),
    ).length
    if (live >= MAX_LIVE_RUNS)
      fail(
        'BUSY',
        'Ether está atendiendo varias consultas. Probá de nuevo en un momento.',
      )

    const { db } = this.deps
    const at = this.now()
    // Refs are checked before anything is written: an unknown id refuses the question without a message in the thread.
    const snapshot = await collectSnapshot(this.deps, at)
    const referenced = resolveRefs(this.deps, refs, snapshot)
    const threadId = touchThread(db, user.id, thread, titleOf(question), at)
    addMessage(db, threadId, 'user', question, at)
    const messageId = addMessage(db, threadId, 'ether', '', at, {
      status: 'pending',
    })
    const session = sessionId(user.login, thread)

    let runId: string
    try {
      runId = await this.client.start(
        buildInput(question, snapshot, referenced),
        session,
      )
    } catch (e) {
      const reason =
        e instanceof EtherError ? e.message : 'No se pudo consultar a Ether.'
      finishMessage(db, messageId, reason, 'failed')
      audit(
        db,
        user,
        'ether.ask',
        thread,
        { question: clip(question, AUDIT_QUESTION), error: reason },
        false,
      )
      return failFrom(e)
    }

    setMessageRun(db, messageId, runId)
    audit(db, user, 'ether.ask', thread, {
      question: clip(question, AUDIT_QUESTION),
      runId,
      session,
    })
    const streamKey = randomBytes(16).toString('hex')
    const run: ActiveRun = {
      runId,
      streamKey,
      userId: user.id,
      login: user.login,
      thread,
      messageId,
      state: START_RUN,
      sources: {
        at: snapshot.at,
        activeTag: snapshot.activeTag,
        containers: snapshot.containers.map((c) => ({
          service: c.service,
          state: c.state,
          health: c.health,
          image: c.image,
        })),
        errors: snapshot.errors,
        tools: [],
        refs: referenced,
      },
      seq: 0,
      abort: new AbortController(),
    }
    this.active.set(runId, run)
    void this.pump(run)
    return { runId, streamKey }
  }

  get(runId: string): ActiveRun | undefined {
    return this.active.get(runId)
  }

  waitingApprovals(): ActiveRun[] {
    return [...this.active.values()].filter(
      (r) => r.state.phase === 'waiting_for_approval',
    )
  }

  async approve(user: User, runId: string, deny: boolean): Promise<void> {
    const run = this.active.get(runId)
    if (!run) fail('NOT_FOUND', 'No encontré esa consulta, o ya terminó.')
    if (run.state.phase !== 'waiting_for_approval')
      fail('NOT_WAITING', 'Esa consulta no está esperando aprobación.')
    try {
      await this.client.approve(runId, deny ? 'deny' : 'once')
    } catch (e) {
      audit(
        this.deps.db,
        user,
        'ether.approve',
        runId,
        { choice: deny ? 'deny' : 'once', error: 'falló el envío' },
        false,
      )
      return failFrom(e)
    }
    audit(this.deps.db, user, 'ether.approve', runId, {
      choice: deny ? 'deny' : 'once',
      asked: clip(run.state.approval ?? '', AUDIT_QUESTION),
      owner: run.login,
    })
  }

  async stop(user: User, runId: string): Promise<void> {
    const run = this.active.get(runId)
    if (!run) fail('NOT_FOUND', 'No encontré esa consulta, o ya terminó.')
    if (run.userId !== user.id && user.role !== 'admin')
      fail(
        'FORBIDDEN',
        'Solo quien hizo la consulta o un admin puede detenerla.',
      )
    if (isTerminal(run.state.phase)) return
    try {
      await this.client.stop(runId)
    } catch (e) {
      return failFrom(e)
    }
    audit(this.deps.db, user, 'ether.stop', runId, { owner: run.login })
    // Hermes ends the stream with run.cancelled; if it does not, close the run here instead of leaving it hanging.
    setTimeout(() => {
      if (isTerminal(run.state.phase)) return
      this.emit(run, { type: 'done', status: 'cancelled', output: '' })
      run.abort.abort()
    }, this.stopGraceMs).unref()
  }

  private emit(run: ActiveRun, event: EtherEvent): void {
    const next = reduceRun(run.state, event)
    if (next === run.state) return
    run.state = next
    run.seq += 1
    this.deps.bus.emit(channelOf(run.streamKey), event.type, {
      ...event,
      seq: run.seq,
    })
  }

  private async pump(run: ActiveRun): Promise<void> {
    const timer = setTimeout(() => {
      this.emit(run, {
        type: 'error',
        message:
          'Ether tardó demasiado. Puede que la consulta siga corriendo en el servidor.',
        offline: false,
      })
      run.abort.abort()
    }, this.maxRunMs)
    try {
      try {
        for await (const ev of this.client.events(
          run.runId,
          run.abort.signal,
        )) {
          this.emit(run, ev)
          if (isTerminal(run.state.phase)) break
        }
      } catch {
        // The stream broke, not the run: fall through to polling its status.
      }
      if (!isTerminal(run.state.phase) && !run.abort.signal.aborted)
        await this.poll(run)
    } finally {
      clearTimeout(timer)
      this.finish(run)
    }
  }

  /** Fallback when the SSE stream drops before a terminal event. Never starts a second run. */
  private async poll(run: ActiveRun): Promise<void> {
    let asked = ''
    while (!isTerminal(run.state.phase) && !run.abort.signal.aborted) {
      try {
        const st = await this.client.status(run.runId)
        if (st.status === 'waiting_for_approval' && st.approval !== asked) {
          asked = st.approval ?? ''
          this.emit(run, {
            type: 'approval',
            summary: asked || 'Ether pide permiso para seguir.',
          })
        } else if (st.status === 'completed')
          this.emit(run, {
            type: 'done',
            status: 'completed',
            output: st.output,
          })
        else if (st.status === 'cancelled')
          this.emit(run, {
            type: 'done',
            status: 'cancelled',
            output: st.output,
          })
        else if (st.status === 'failed')
          this.emit(run, {
            type: 'error',
            message: st.error || 'Ether no pudo terminar la consulta.',
            offline: false,
          })
      } catch (e) {
        this.emit(run, {
          type: 'error',
          message:
            e instanceof EtherError
              ? e.message
              : 'Se perdió la conexión con Ether.',
          offline: !(e instanceof EtherError) || e.offline,
        })
      }
      if (isTerminal(run.state.phase)) return
      await new Promise((r) => setTimeout(r, this.pollMs))
    }
  }

  private finish(run: ActiveRun): void {
    const { state } = run
    // An abort (shutdown) can leave the run mid-flight: close it so the message does not stay pending forever.
    if (!isTerminal(state.phase))
      this.emit(run, {
        type: 'error',
        message: 'La consulta se cortó antes de terminar.',
        offline: false,
      })
    const final = run.state
    const sources = { ...run.sources, tools: final.tools }
    try {
      if (final.phase === 'completed')
        finishMessage(
          this.deps.db,
          run.messageId,
          final.text || 'Ether no devolvió texto.',
          'done',
          sources,
        )
      else if (final.phase === 'cancelled')
        finishMessage(
          this.deps.db,
          run.messageId,
          final.text || 'Detuviste la consulta.',
          'cancelled',
          sources,
        )
      else
        finishMessage(
          this.deps.db,
          run.messageId,
          final.error ?? 'La consulta falló.',
          'failed',
          sources,
        )
    } catch {}
    setTimeout(() => this.active.delete(run.runId), this.keepMs).unref()
  }
}

const instances = new WeakMap<Deps['db'], EtherRuns>()

/** One runner per database, built on first use: the fixture client when `TABULA_FIXTURES=1`, Hermes otherwise. */
export function runsFor(deps: Deps): EtherRuns {
  let runs = instances.get(deps.db)
  if (!runs) {
    const client = deps.config.fixtures
      ? fixtureEther({ delayMs: 60 })
      : etherClient(deps.config.ether)
    runs = new EtherRuns(deps, client)
    instances.set(deps.db, runs)
  }
  return runs
}
