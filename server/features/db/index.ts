// Base de datos (v0.4.0). Owns everything under server/features/db/: GraphQL fields (graphql.ts), jobs, pure domain + tests.
import type { Feature } from '../../deps'
import './graphql'

export const feature: Feature = {
  name: 'db',
}
