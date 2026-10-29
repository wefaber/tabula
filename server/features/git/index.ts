// Git (v0.5.0). Owns everything under server/features/git/: GraphQL fields (graphql.ts), jobs, pure domain + tests.
import type { Feature } from '../../deps'
import './graphql'

export const feature: Feature = {
  name: 'git',
}
