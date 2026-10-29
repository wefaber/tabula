// What every resolver, job and route receives. Built once at boot (server/index.ts) or per test.
import type { Database } from 'bun:sqlite'
import type { GithubClient } from './adapters/github'
import type { PodmanClient } from './adapters/podman'
import type { AuthMethod, User } from './auth'
import type { Bus } from './bus'
import type { Config } from './config'

export interface Deps {
  config: Config
  db: Database
  bus: Bus
  podman: PodmanClient
  github: GithubClient
}

/** GraphQL context: /graphql only runs for an authenticated user, so `user` is never null here. */
export interface Ctx extends Deps {
  user: User
  method: AuthMethod
}

/** A feature folder under server/features/. `start` runs its background jobs and returns how to stop them. */
export interface Feature {
  name: string
  start?(deps: Deps): () => void
}
