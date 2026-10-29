// /ready: what a deploy checks before switching slots. The panel is ready when its own DB is migrated and Podman
// answers. Gravida's stack being down does NOT make the panel unready: the panel is how you bring it back up.
import { pendingMigrations } from './db'
import type { Deps } from './deps'

export interface Readiness {
  ok: boolean
  db: boolean
  migrations: number
  podman: boolean
  fixtures: boolean
  version: string
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
  return {
    ok: dbOk && pending === 0 && podmanOk,
    db: dbOk,
    migrations: pending,
    podman: podmanOk,
    fixtures: config.fixtures,
    version: config.version,
  }
}
