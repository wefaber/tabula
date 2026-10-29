// Boot: config → own DB + migrations → allowlist → adapters → feature jobs → listen on loopback.
import { join } from 'node:path'
import pkg from '../package.json'
import { fixtureGithub, githubClient } from './adapters/github'
import { fixturePodman, podmanClient } from './adapters/podman'
import { createApp } from './app'
import { syncUsers } from './auth'
import { fixtureWhois, tailscaleWhois } from './auth/whois'
import { Bus } from './bus'
import { loadConfig } from './config'
import { openDb } from './db'
import type { Deps } from './deps'
import { features } from './features'
import { log } from './log'

const config = loadConfig(process.env, pkg.version)
if (config.users.length === 0)
  log.warn('TABULA_USERS vacío: solo se puede entrar con token')

const db = openDb(join(config.dataDir, 'tabula.db'))
syncUsers(db, config.users)

const deps: Deps = {
  config,
  db,
  bus: new Bus(),
  podman: config.fixtures ? fixturePodman() : podmanClient(config.podmanSocket),
  whois: config.fixtures
    ? fixtureWhois()
    : tailscaleWhois(config.tailscaleSocket),
  github: config.fixtures
    ? fixtureGithub(config.github.repo)
    : githubClient(
        config.github.repo,
        (owner) => config.github.tokens[owner.toLowerCase()] ?? '',
      ),
}

const stops = features.flatMap((f) => (f.start ? [f.start(deps)] : []))
const app = createApp(deps).listen({ hostname: config.host, port: config.port })
log.info('listening', {
  url: `http://${config.host}:${config.port}`,
  version: config.version,
  fixtures: config.fixtures,
})

function shutdown() {
  for (const stop of stops) stop()
  void app.stop()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
