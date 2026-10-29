// Token admin from the server shell (first token for someone, or recovery):
//   bun scripts/token.ts create <login> [label]   prints the token once
//   bun scripts/token.ts list
//   bun scripts/token.ts revoke <id>
// Uses the same DATA_DIR and TABULA_USERS as the service (EnvironmentFile ~/deploy/env/tabula.env).
import { join } from 'node:path'
import pkg from '../package.json'
import {
  createToken,
  revokeToken,
  syncUsers,
  userByLogin,
} from '../server/auth'
import { audit } from '../server/audit'
import { loadConfig } from '../server/config'
import { openDb } from '../server/db'

const [cmd, arg, ...rest] = process.argv.slice(2)
const config = loadConfig(process.env, pkg.version)
const db = openDb(join(config.dataDir, 'tabula.db'))
syncUsers(db, config.users)
const cli = { login: 'cli' }

if (cmd === 'create' && arg) {
  const user = userByLogin(db, arg)
  if (!user) {
    console.error(`"${arg}" no está en TABULA_USERS (o está inactivo).`)
    process.exit(1)
  }
  const { id, token } = createToken(db, user.id, rest.join(' ') || 'cli')
  audit(db, cli, 'token.create', String(id), { for: user.login })
  console.log(token)
} else if (cmd === 'list') {
  console.table(
    db
      .query(
        `SELECT t.id, u.login, t.label, t.created_at, t.last_used_at, t.revoked_at
         FROM tokens t JOIN users u ON u.id = t.user_id ORDER BY t.id`,
      )
      .all(),
  )
} else if (cmd === 'revoke' && arg) {
  const ok = revokeToken(db, Number(arg), {
    id: 0,
    login: 'cli',
    name: 'cli',
    role: 'admin',
  })
  if (ok) audit(db, cli, 'token.revoke', arg)
  console.log(ok ? 'revocado' : 'no encontrado o ya revocado')
  process.exit(ok ? 0 : 1)
} else {
  console.error(
    'uso: bun scripts/token.ts create <login> [label] | list | revoke <id>',
  )
  process.exit(2)
}
