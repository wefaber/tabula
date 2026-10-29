// Git (v0.5.0). Owns everything under server/features/git/: GraphQL fields (graphql.ts), the poll job, pure domain
// (graph.ts) and the GitHub reads (github.ts).
import type { Deps, Feature } from '../../deps'
import { log } from '../../log'
import { registerGitFixtures } from './fixtures'
import { snapshot } from './github'
import './graphql'

export const POLL_MS = 60_000

/**
 * One poll step: reload the history and emit `git`/`changed` on the bus only when what the section shows differs from
 * the previous step (the first step just records the baseline).
 */
export function makePoll(deps: Deps): () => Promise<void> {
  let last: string | null = null
  let failing = false
  return async () => {
    try {
      const snap = await snapshot(deps, { fresh: true })
      failing = false
      if (last !== null && snap.signature !== last)
        deps.bus.emit('git', 'changed', { at: new Date().toISOString() })
      last = snap.signature
    } catch (e) {
      if (!failing)
        log.warn('git: no se pudo leer GitHub', {
          error: e instanceof Error ? e.message : String(e),
        })
      failing = true
    }
  }
}

export const feature: Feature = {
  name: 'git',
  start(deps) {
    if (deps.config.fixtures) registerGitFixtures(deps.github.repo)
    // Without a token there is nothing to poll: the queries answer GITHUB_NOT_CONFIGURED on their own.
    if (!deps.config.fixtures && !deps.config.github.token) {
      log.warn('git: sin GITHUB_TOKEN, no se sincroniza el historial')
      return () => {}
    }
    const poll = makePoll(deps)
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(timer)
  },
}
