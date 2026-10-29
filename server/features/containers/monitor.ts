// Background side of containers: state snapshots on the bus and log followers that run only while somebody watches.
import type { LogLine } from '../../adapters/podman'
import type { Deps } from '../../deps'
import { log } from '../../log'
import {
  SERVICES,
  signature,
  toRows,
  type ContainerRow,
  type Service,
} from './domain'

export const STATE_CHANNEL = 'containers'
export const logChannel = (service: Service) => `containers-${service}`

export async function snapshot(
  deps: Deps,
  now = new Date(),
): Promise<ContainerRow[]> {
  const summaries = await deps.podman.list(deps.config.nexus.project)
  const running = summaries.filter((c) => c.state === 'running')
  const stats = await deps.podman.stats(running.map((c) => c.id))
  return toRows(summaries, stats, now)
}

const lastSignature = new WeakMap<object, string>()

/** Emits `state` on the bus when something changed since the last emit (or always with `force`). */
export async function publishState(
  deps: Deps,
  force = false,
): Promise<ContainerRow[]> {
  const rows = await snapshot(deps)
  const sig = signature(rows)
  if (force || lastSignature.get(deps.bus) !== sig) {
    lastSignature.set(deps.bus, sig)
    deps.bus.emit(STATE_CHANNEL, 'state', rows)
  }
  return rows
}

export interface LogEvent {
  /** Monotonic across followers, so a client can drop lines it already has. */
  seq: number
  stream: LogLine['stream']
  text: string
  at: string
}

const RING = 200
let seq = Date.now()

/**
 * One follower per service while `bus.watching(channel) > 0`. A viewer that joins a running follower gets the ring
 * buffer replayed (with the same `seq`s, so existing viewers ignore the repeats).
 */
export function createLogFollowers(deps: Deps) {
  interface Follower {
    containerId: string
    abort: AbortController
    ring: LogEvent[]
    viewers: number
  }
  const active = new Map<Service, Follower>()
  /** Unix seconds a follower ended on its own: the next one resumes from there instead of replaying the tail. */
  const endedAt = new Map<Service, number>()

  async function run(service: Service, f: Follower, since?: number) {
    const channel = logChannel(service)
    try {
      for await (const line of deps.podman.logs(f.containerId, {
        tail: RING,
        since,
        follow: true,
        signal: f.abort.signal,
      })) {
        const event: LogEvent = {
          seq: ++seq,
          stream: line.stream,
          text: line.text,
          at: new Date().toISOString(),
        }
        f.ring.push(event)
        if (f.ring.length > RING) f.ring.shift()
        deps.bus.emit(channel, 'line', event)
      }
    } catch (error) {
      if (!f.abort.signal.aborted)
        log.warn('log follow ended', {
          service,
          error: error instanceof Error ? error.message : String(error),
        })
    } finally {
      // Ended on its own (container stopped, socket error): the next reconcile starts a new one if still watched.
      if (active.get(service) === f) {
        active.delete(service)
        endedAt.set(service, Math.floor(Date.now() / 1000))
      }
    }
  }

  return {
    /** Starts, stops and refreshes followers. Cheap enough to call every second. */
    async reconcile(rows: ContainerRow[]) {
      for (const service of SERVICES) {
        const channel = logChannel(service)
        const viewers = deps.bus.watching(channel)
        const row = rows.find((r) => r.service === service)
        const current = active.get(service)

        if (current && (viewers === 0 || row?.id !== current.containerId)) {
          current.abort.abort()
          active.delete(service)
          endedAt.delete(service)
        }
        const live = active.get(service)
        if (live) {
          if (viewers > live.viewers)
            for (const event of live.ring) deps.bus.emit(channel, 'line', event)
          live.viewers = viewers
          continue
        }
        if (viewers === 0) endedAt.delete(service)
        if (viewers > 0 && row?.state === 'running') {
          const f: Follower = {
            containerId: row.id,
            abort: new AbortController(),
            ring: [],
            viewers,
          }
          active.set(service, f)
          void run(service, f, endedAt.get(service))
        }
      }
    },
    stop() {
      for (const f of active.values()) f.abort.abort()
      active.clear()
      endedAt.clear()
    },
    activeServices: () => [...active.keys()],
  }
}
