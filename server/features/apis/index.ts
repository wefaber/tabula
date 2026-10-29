// Estado de APIs (v0.3.0). Owns everything under server/features/apis/: GraphQL fields (graphql.ts), jobs, pure domain + tests.
import type { Feature } from '../../deps'
import './graphql'

export const feature: Feature = {
  name: 'apis',
}
