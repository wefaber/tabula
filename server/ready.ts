// /ready: what a deploy checks before switching slots. The panel is ready when its own DB is migrated and Podman
// answers. Gravida's stack being down does NOT make the panel unready: the panel is how you bring it back up.
import { GITHUB_TOKEN_VARS, githubTokenFor } from './config'
import { pendingMigrations } from './db'
import type { Deps } from './deps'

/** A module that cannot do its job right now, and what was detected. */
export interface Problem {
  module: string
  detail: string
}

export interface Readiness {
  ok: boolean
  db: boolean
  migrations: number
  podman: boolean
  fixtures: boolean
  version: string
  problems: Problem[]
}

export async function readiness({
  db,
  podman,
  config,
}: Deps): Promise<Readiness> {
  let dbOk = false
  let pending = -1
  try {
    db.query('SELECT 1').get()
    pending = pendingMigrations(db)
    dbOk = true
  } catch {}
  const podmanOk = await podman.ping()
  const problems: Problem[] = []
  if (!dbOk)
    problems.push({
      module: 'Panel',
      detail: 'La base propia (SQLite) no responde.',
    })
  else if (pending > 0)
    problems.push({
      module: 'Panel',
      detail: `${pending} migraciones sin aplicar.`,
    })
  if (!podmanOk)
    problems.push({
      module: 'Containers',
      detail: 'Podman no responde en el socket.',
    })
  if (!config.fixtures) {
    if (!config.nexus.dbPassword)
      problems.push({ module: 'Base de datos', detail: 'Falta DB_PASSWORD.' })
    // One report per organization without a token; Git already covers the one that owns the Gravida repo.
    const reported = new Set<string>()
    if (!config.github.token) {
      const owner = config.github.repo.split('/')[0]?.toLowerCase() ?? ''
      reported.add(owner)
      problems.push({
        module: 'Git',
        detail: `Falta el token de GitHub de ${owner} (${GITHUB_TOKEN_VARS[owner] ?? 'GITHUB_TOKEN'}).`,
      })
    }
    for (const repo of config.ether.repos)
      if (!githubTokenFor(config, repo)) {
        const owner = repo.split('/')[0]?.toLowerCase() ?? ''
        if (reported.has(owner)) continue
        reported.add(owner)
        const name = GITHUB_TOKEN_VARS[owner]
        problems.push({
          module: 'Ask Ether',
          detail: name
            ? `Falta ${name} para leer ${repo}.`
            : `No hay token de GitHub para la organización de ${repo}.`,
        })
      }
    if (!config.ether.key)
      problems.push({
        module: 'Ask Ether',
        detail: 'Falta DEEPSEEK_API_KEY.',
      })
  }
  return {
    ok: dbOk && pending === 0 && podmanOk,
    db: dbOk,
    migrations: pending,
    podman: podmanOk,
    fixtures: config.fixtures,
    version: config.version,
    problems,
  }
}
