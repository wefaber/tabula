// Who is behind a tailnet IP. nginx listens on the VPS tailnet address, so it sees each device's own 100.x address
// and passes it as X-Real-IP (overwriting whatever the client sent); tailscaled's local API answers with the login that
// owns that device. Tagged nodes have no user and resolve to null. Needs `sudo tailscale set --operator=hermes` once so
// the service user can read the socket.
export type Whois = (ip: string) => Promise<string | null>

const TAILNET_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/
const TAILNET_V6 = /^fd7a:115c:a1e0:/i
const TTL_MS = 60_000

/** Only tailnet addresses are ever sent to tailscaled; anything else (public, loopback, garbage) is no identity. */
export function isTailnetIp(ip: string): boolean {
  return TAILNET_V4.test(ip) || TAILNET_V6.test(ip)
}

export function tailscaleWhois(
  socket: string,
  now: () => number = Date.now,
): Whois {
  const cache = new Map<string, { login: string | null; at: number }>()
  return async (ip) => {
    if (!isTailnetIp(ip)) return null
    const hit = cache.get(ip)
    if (hit && now() - hit.at < TTL_MS) return hit.login
    let login: string | null = null
    try {
      const res = await fetch(
        `http://local-tailscaled.sock/localapi/v0/whois?addr=${encodeURIComponent(`${ip}:0`)}`,
        { unix: socket, signal: AbortSignal.timeout(2000) } as RequestInit,
      )
      if (res.ok) {
        const body = (await res.json()) as {
          UserProfile?: { LoginName?: string }
        }
        login = body.UserProfile?.LoginName?.toLowerCase() || null
      }
    } catch {
      // tailscaled unreachable: no identity, the caller falls back to a token. Not cached, so it recovers on its own.
      return null
    }
    cache.set(ip, { login, at: now() })
    return login
  }
}

/** Local dev and tests: a fixed map of ip -> login. */
export function fixtureWhois(map: Record<string, string> = {}): Whois {
  return async (ip) => map[ip] ?? null
}
