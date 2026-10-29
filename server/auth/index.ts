// Who is asking. Three ways in, checked in this order:
//   1. session cookie, opened by exchanging a token on /auth/token;
//   2. `Authorization: Bearer <token>` (agents, scripts);
//   3. `Tailscale-User-Login`, injected by Tailscale Serve for tailnet users, checked against TABULA_USERS.
// The app listens on loopback only and Tailscale Serve is the only thing in front of it, so (3) can be trusted.
import type { Database } from 'bun:sqlite'
import type { AllowedUser, Role } from '../config'

export interface User {
  id: number
  login: string
  name: string
  role: Role
}

export const SESSION_COOKIE = 'tabula_session'
const SESSION_DAYS = 30
const TOKEN_PREFIX = 'tbl_'

export function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function randomSecret(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    'base64url',
  )
}

/** Upserts the allowlist. Users dropped from TABULA_USERS are deactivated, never deleted (audit keeps their login). */
export function syncUsers(db: Database, users: AllowedUser[]): void {
  db.transaction(() => {
    db.run('UPDATE users SET active = 0')
    const upsert = db.query(
      `INSERT INTO users (login, name, role, active) VALUES ($login, $name, $role, 1)
       ON CONFLICT (login) DO UPDATE SET name = excluded.name, role = excluded.role, active = 1`,
    )
    for (const u of users)
      upsert.run({ login: u.login, name: u.name, role: u.role })
  })()
}

const userColumns = 'u.id, u.login, u.name, u.role'

export function userByLogin(db: Database, login: string): User | null {
  return db
    .query<User, [string]>(
      `SELECT ${userColumns} FROM users u WHERE u.login = ? AND u.active = 1`,
    )
    .get(login.toLowerCase())
}

export function userByToken(
  db: Database,
  token: string,
): (User & { tokenId: number }) | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const row = db
    .query<User & { tokenId: number }, [string]>(
      `SELECT ${userColumns}, t.id AS tokenId FROM tokens t JOIN users u ON u.id = t.user_id
       WHERE t.hash = ? AND t.revoked_at IS NULL AND u.active = 1`,
    )
    .get(sha256(token))
  if (row)
    db.query('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.tokenId,
    )
  return row
}

export function createToken(
  db: Database,
  userId: number,
  label: string,
): { id: number; token: string } {
  const token = `${TOKEN_PREFIX}${randomSecret()}`
  const row = db
    .query<{ id: number }, [number, string, string, string]>(
      'INSERT INTO tokens (user_id, label, hash, created_at) VALUES (?, ?, ?, ?) RETURNING id',
    )
    .get(
      userId,
      label.trim() || 'sin nombre',
      sha256(token),
      new Date().toISOString(),
    )
  return { id: row!.id, token }
}

/** Revokes a token and closes every session opened with it. Returns false if it was not found or already revoked. */
export function revokeToken(
  db: Database,
  tokenId: number,
  byUser: User,
): boolean {
  const owner = db
    .query<{ user_id: number }, [number]>(
      'SELECT user_id FROM tokens WHERE id = ? AND revoked_at IS NULL',
    )
    .get(tokenId)
  if (!owner || (owner.user_id !== byUser.id && byUser.role !== 'admin'))
    return false
  db.transaction(() => {
    db.query('UPDATE tokens SET revoked_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      tokenId,
    )
    db.query('DELETE FROM sessions WHERE token_id = ?').run(tokenId)
  })()
  return true
}

export function openSession(
  db: Database,
  userId: number,
  tokenId: number | null,
  now = new Date(),
): { value: string; expires: Date } {
  const value = randomSecret()
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  db.query(
    'INSERT INTO sessions (hash, user_id, token_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    sha256(value),
    userId,
    tokenId,
    now.toISOString(),
    expires.toISOString(),
  )
  return { value, expires }
}

export function closeSession(db: Database, value: string): void {
  db.query('DELETE FROM sessions WHERE hash = ?').run(sha256(value))
}

export function userBySession(
  db: Database,
  value: string,
  now = new Date(),
): User | null {
  return db
    .query<User, [string, string]>(
      `SELECT ${userColumns} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.hash = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(sha256(value), now.toISOString())
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function sessionCookie(
  value: string,
  expires: Date | null,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (secure) parts.push('Secure')
  parts.push(expires ? `Expires=${expires.toUTCString()}` : 'Max-Age=0')
  return parts.join('; ')
}

export type AuthMethod = 'session' | 'token' | 'tailnet'

export interface AuthOptions {
  /** Believe `Tailscale-User-Login`. Only valid behind Tailscale Serve, which sets it; behind nginx a client could forge it. */
  trustHeader?: boolean
  /** Local dev: stands in for the identity Serve would inject. */
  devLogin?: string
}

export type Identity = { user: User; method: AuthMethod }

/** Synchronous identities: session cookie, bearer token, trusted header, dev login. */
export function authenticate(
  db: Database,
  request: Request,
  { trustHeader = false, devLogin = '' }: AuthOptions = {},
): Identity | null {
  const cookie = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (cookie) {
    const user = userBySession(db, cookie)
    if (user) return { user, method: 'session' }
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )?.[1]
  if (bearer) {
    const found = userByToken(db, bearer)
    if (found) {
      const { tokenId: _tokenId, ...user } = found
      return { user, method: 'token' }
    }
  }
  const login =
    (trustHeader ? request.headers.get('tailscale-user-login') : null) ||
    devLogin
  if (login) {
    const user = userByLogin(db, login)
    if (user) return { user, method: 'tailnet' }
  }
  return null
}

/**
 * Everything `authenticate` knows, then the tailnet: nginx sets `X-Real-IP` to the device's tailnet address
 * (overwriting any client value; the app only listens on loopback) and tailscaled says whose device it is.
 */
export async function identify(
  db: Database,
  request: Request,
  options: AuthOptions,
  whois: (ip: string) => Promise<string | null>,
): Promise<Identity | null> {
  const found = authenticate(db, request, options)
  if (found) return found
  const ip = request.headers.get('x-real-ip')?.trim()
  if (!ip) return null
  const login = await whois(ip)
  const user = login ? userByLogin(db, login) : null
  return user ? { user, method: 'tailnet' } : null
}
