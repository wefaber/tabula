// GitHub REST for the Gravida repo, read-only token. Conditional requests (ETag) keep polling inside the rate limit:
// a 304 does not count against it. Features build on `get`; fixtures are registered by path.

export interface GithubClient {
  repo: string
  /** `path` is relative to the API root (`/repos/...`). `null` on 404. */
  get<T>(path: string): Promise<T | null>
  /** True while a run of Gravida's deploy workflow is queued or running. */
  deployInProgress(): Promise<boolean>
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function githubClient(repo: string, token: string): GithubClient {
  const cache = new Map<string, { etag: string; body: unknown }>()

  async function get<T>(path: string): Promise<T | null> {
    const cached = cache.get(path)
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'tabula',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cached ? { 'if-none-match': cached.etag } : {}),
      },
    })
    if (res.status === 304 && cached) return cached.body as T
    if (res.status === 404) return null
    if (!res.ok)
      throw new GithubError(
        `GitHub ${path}: ${res.status} ${await res.text().catch(() => '')}`.trim(),
        res.status,
      )
    const body = (await res.json()) as T
    const etag = res.headers.get('etag')
    if (etag) cache.set(path, { etag, body })
    return body
  }

  return {
    repo,
    get,
    async deployInProgress() {
      for (const status of ['in_progress', 'queued'] as const) {
        const runs = await get<{ total_count: number }>(
          `/repos/${repo}/actions/workflows/deploy.yml/runs?status=${status}&per_page=1`,
        )
        if (runs && runs.total_count > 0) return true
      }
      return false
    },
  }
}

/** Fixture responses by request path. Each feature registers the paths it reads, from its own fixture file. */
export const githubFixtures = new Map<string, unknown>()

export function fixtureGithub(repo = 'nexus-iti/gravida'): GithubClient {
  return {
    repo,
    async get<T>(path: string) {
      const exact = githubFixtures.get(path)
      if (exact !== undefined) return exact as T
      const noQuery = githubFixtures.get(path.split('?')[0] ?? path)
      return (noQuery ?? null) as T | null
    },
    async deployInProgress() {
      return false
    },
  }
}
