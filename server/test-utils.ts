// Shared by tests: an in-memory deps set on the fixture adapters.
import { fixtureGithub } from './adapters/github'
import { fixturePodman } from './adapters/podman'
import { syncUsers } from './auth'
import { Bus } from './bus'
import { loadConfig } from './config'
import { openDb } from './db'
import type { Deps } from './deps'

export function testDeps(
  users = 'faku@x:admin:Faku,pablo@x:member:Pablo',
): Deps {
  const config = loadConfig(
    { DEVPANEL_FIXTURES: '1', DEVPANEL_USERS: users, DATA_DIR: ':memory:' },
    '0.0.0-test',
  )
  const db = openDb(':memory:')
  syncUsers(db, config.users)
  return {
    config,
    db,
    bus: new Bus(),
    podman: fixturePodman(),
    github: fixtureGithub(),
  }
}
