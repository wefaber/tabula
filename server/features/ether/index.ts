// Ask Ether (v0.6.0). Owns everything under server/features/ether/: GraphQL fields (graphql.ts), jobs, pure domain + tests.
import type { Feature } from '../../deps'
import './graphql'
import { runsFor } from './runner'

export const feature: Feature = {
  name: 'ether',
  start(deps) {
    const runs = runsFor(deps)
    runs.boot()
    return () => runs.stopAll()
  },
}
