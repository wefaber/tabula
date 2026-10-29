// Últimas llamadas (v0.3.0). Owns everything under server/features/calls/: GraphQL fields (graphql.ts), jobs, pure domain + tests.
import type { Feature } from '../../deps'
import { startFollow } from './follow'
import './graphql'

export const feature: Feature = {
  name: 'calls',
  start: startFollow,
}
