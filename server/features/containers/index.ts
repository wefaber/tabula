// Containers y energía (v0.2.0). Owns everything under server/features/containers/: GraphQL fields (graphql.ts), jobs, pure domain + tests.
import type { Deps, Feature } from '../../deps'
import { log } from '../../log'
import type { ContainerRow } from './domain'
import { createLogFollowers, publishState, STATE_CHANNEL } from './monitor'
import './graphql'

const STATE_EVERY_MS = 5000
const LOGS_EVERY_MS = 1000

/** Reads list+stats every 5 s and emits `state` on change; follows logs only for channels somebody watches. */
export function startJobs(deps: Deps): () => void {
  let rows: ContainerRow[] = []
  let failing = false
  let busy = false
  const followers = createLogFollowers(deps)

  async function readState() {
    if (busy) return
    busy = true
    try {
      rows = await publishState(deps, failing)
      failing = false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!failing) {
        failing = true
        log.warn('containers poll failed', { error: message })
        deps.bus.emit(STATE_CHANNEL, 'error', { message })
      }
      rows = []
    } finally {
      busy = false
    }
  }

  void readState()
  const state = setInterval(readState, STATE_EVERY_MS)
  const logs = setInterval(() => {
    void followers.reconcile(rows).catch((error: unknown) =>
      log.warn('log reconcile failed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }, LOGS_EVERY_MS)

  return () => {
    clearInterval(state)
    clearInterval(logs)
    followers.stop()
  }
}

export const feature: Feature = {
  name: 'containers',
  start: startJobs,
}
