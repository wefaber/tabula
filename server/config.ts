// Runtime config from the environment. Server side it comes from ~/deploy/env/tabula.env (systemd
// EnvironmentFile); locally from .env.local, which Bun loads on its own.
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Role = 'admin' | 'member'

export interface AllowedUser {
  login: string
  name: string
  role: Role
}

export interface Config {
  production: boolean
  /** Fixture adapters instead of Podman, MariaDB, GitHub and DeepSeek: local dev and tests. */
  fixtures: boolean
  /** Local dev only: acts as the `Tailscale-User-Login` header Serve would inject. Ignored in production. */
  devLogin: string
  /** Public name of the panel (nginx vhost on the tailnet address). */
  domain: string
  /** tailscaled local API socket, used to resolve a tailnet IP to its login. */
  tailscaleSocket: string
  /** Believe `Tailscale-User-Login`: only when Tailscale Serve (not nginx) is in front. */
  trustServeHeader: boolean
  host: string
  port: number
  dataDir: string
  version: string
  /** Tailnet logins allowed in, from TABULA_USERS (`login:role:Name`, comma separated). */
  users: AllowedUser[]
  podmanSocket: string
  nexus: {
    project: string
    frontUrl: string
    stateFile: string
    dbName: string
    dbUser: string
    dbPassword: string
  }
  github: { repo: string; token: string }
  /** Ask Ether talks straight to DeepSeek (OpenAI-compatible chat). `repos` are the GitHub repos it reads for context. */
  ether: { url: string; key: string; model: string; repos: string[] }
}

export function parseUsers(raw: string): AllowedUser[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [login = '', role = 'member', name] = part
        .split(':')
        .map((s) => s.trim())
      if (!login) throw new Error(`TABULA_USERS: entrada sin login: "${part}"`)
      if (role !== 'admin' && role !== 'member')
        throw new Error(`TABULA_USERS: rol inválido "${role}" para ${login}`)
      return {
        login: login.toLowerCase(),
        role,
        name: name || login.split('@')[0] || login,
      }
    })
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  version = '0.0.0',
): Config {
  const production = env.NODE_ENV === 'production'
  const fixtures = env.TABULA_FIXTURES === '1'
  const home = homedir()
  return {
    production,
    fixtures,
    devLogin: production ? '' : (env.TABULA_DEV_LOGIN ?? '').toLowerCase(),
    domain: env.TABULA_DOMAIN ?? 'tabula.wefaber.net',
    tailscaleSocket:
      env.TAILSCALE_SOCKET ?? '/var/run/tailscale/tailscaled.sock',
    trustServeHeader: env.TABULA_TRUST_SERVE_HEADER === '1',
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 4171),
    dataDir:
      env.DATA_DIR ??
      (production ? '/home/hermes/data/tabula' : join(process.cwd(), 'data')),
    version,
    users: parseUsers(
      env.TABULA_USERS ?? (fixtures ? 'dev@local:admin:Dev' : ''),
    ),
    podmanSocket: env.PODMAN_SOCKET ?? '/run/user/1001/podman/podman.sock',
    nexus: {
      project: env.NEXUS_PROJECT ?? 'nexus-test',
      frontUrl: env.NEXUS_FRONT_URL ?? 'http://127.0.0.1:18080',
      stateFile:
        env.NEXUS_STATE_FILE ?? join(home, 'deploy/state/nexus-deploy.env'),
      dbName: env.DB_NAME ?? 'nexus',
      dbUser: env.DB_USER ?? 'nexus_app',
      dbPassword: env.DB_PASSWORD ?? '',
    },
    github: {
      repo: env.GITHUB_REPO ?? 'nexus-iti/gravida',
      token: env.GITHUB_TOKEN ?? '',
    },
    ether: {
      url: env.DEEPSEEK_URL ?? 'https://api.deepseek.com/v1',
      key: env.DEEPSEEK_API_KEY ?? '',
      model: env.DEEPSEEK_MODEL ?? 'deepseek-flash',
      repos: (env.ETHER_REPOS ?? 'nexus-iti/gravida,nexus-iti/docs')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    },
  }
}
