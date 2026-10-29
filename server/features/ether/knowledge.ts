// What Ether knows about the project besides the live panel: the structure of the GitHub repos in `config.ether.repos`
// (nexus-iti/gravida and nexus-iti/docs by default) and the few files that match the question. Same idea as the
// retrieval of eternum-board (numbered sources next to the question), with a lexical match over file paths instead of an
// embedding index. `outline` and `rankFiles` are pure; `collectKnowledge` tolerates a repo that does not answer.
import type { GithubClient } from '../../adapters/github'
import type { Deps } from '../../deps'

export interface RepoFile {
  path: string
  size: number
}

export interface RepoMap {
  repo: string
  branch: string
  files: RepoFile[]
  /** GitHub cut the tree: the listing is partial. */
  truncated: boolean
}

export interface KnowledgeSource {
  n: number
  repo: string
  path: string
  text: string
}

export interface Knowledge {
  /** Directory outline of every repo that answered, ready for the prompt. */
  structure: string
  sources: KnowledgeSource[]
}

export const MAX_SOURCES = 4
const MAX_SOURCE_CHARS = 1800
const MAX_FILE_BYTES = 100_000
const OUTLINE_LINES = 40
const TTL_MS = 10 * 60_000
const WAIT_MS = 6_000

const TEXT_EXT =
  /\.(md|mdx|txt|ya?ml|toml|sql|php|ts|tsx|js|jsx|json|sh|css|html|ini|conf)$/i
const SKIP_PATH =
  /(^|\/)(node_modules|vendor|dist|build|\.git|\.next|coverage)\/|(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|composer\.lock)$|\.min\./i

const STOP = new Set([
  'que',
  'como',
  'cual',
  'cuales',
  'donde',
  'para',
  'por',
  'con',
  'una',
  'uno',
  'los',
  'las',
  'del',
  'este',
  'esta',
  'esto',
  'hay',
  'es',
  'son',
  'se',
  'sobre',
  'the',
  'and',
  'how',
  'what',
  'funciona',
  'explicame',
  'decime',
  'dame',
  'puedo',
  'tiene',
  'tienen',
])

export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function isReadable(f: RepoFile): boolean {
  return (
    f.size <= MAX_FILE_BYTES && TEXT_EXT.test(f.path) && !SKIP_PATH.test(f.path)
  )
}

/** Directories (two levels deep) with their file counts, plus the files in the root. Free of file contents. */
export function outline(map: RepoMap, maxLines = OUTLINE_LINES): string {
  const root: string[] = []
  const dirs = new Map<string, number>()
  for (const f of map.files) {
    if (SKIP_PATH.test(f.path)) continue
    const parts = f.path.split('/')
    if (parts.length === 1) root.push(f.path)
    else {
      const key = `${parts.slice(0, Math.min(2, parts.length - 1)).join('/')}/`
      dirs.set(key, (dirs.get(key) ?? 0) + 1)
    }
  }
  const lines = [
    ...[...dirs]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([d, n]) => `${d} (${n})`),
    ...root.sort(),
  ]
  const shown = lines.slice(0, maxLines).map((l) => `  ${l}`)
  if (lines.length > maxLines)
    shown.push(`  … (+${lines.length - maxLines} más)`)
  const cut = map.truncated ? ', listado parcial' : ''
  return [
    `${map.repo} (rama ${map.branch}, ${map.files.length} archivos${cut})`,
    ...shown,
  ].join('\n')
}

/** The words of a question that can name a file: accents off, no filler. */
export function terms(question: string): string[] {
  const out = norm(question)
    .split(/[^a-z0-9ñ_.-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
  return [...new Set(out)]
}

/** Files whose path matches the question, best first. A match in the file name weighs more than one in a folder. */
export function rankFiles(
  maps: RepoMap[],
  question: string,
  limit = MAX_SOURCES,
): { repo: string; branch: string; path: string; score: number }[] {
  const words = terms(question)
  if (words.length === 0) return []
  const scored: {
    repo: string
    branch: string
    path: string
    score: number
  }[] = []
  for (const map of maps)
    for (const f of map.files) {
      if (!isReadable(f)) continue
      const path = norm(f.path)
      const base =
        path
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? path
      let score = 0
      for (const w of words) {
        if (base.includes(w)) score += 4
        else if (path.includes(w)) score += 2
      }
      if (score > 0 && /\.mdx?$/.test(path)) score += 1
      if (score > 0)
        scored.push({ repo: map.repo, branch: map.branch, path: f.path, score })
    }
  return scored
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, limit)
}

// ---- GitHub reads, cached per client ----

interface Cached<T> {
  at: number
  value: T
}

interface ClientCache {
  maps: Map<string, Cached<RepoMap | null>>
  files: Map<string, Cached<string | null>>
}

const caches = new WeakMap<GithubClient, ClientCache>()

function cacheOf(github: GithubClient): ClientCache {
  let c = caches.get(github)
  if (!c) {
    c = { maps: new Map(), files: new Map() }
    caches.set(github, c)
  }
  return c
}

async function cached<T>(
  store: Map<string, Cached<T>>,
  key: string,
  now: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.value
  const value = await load()
  store.set(key, { at: now, value })
  return value
}

async function loadMap(
  github: GithubClient,
  repo: string,
): Promise<RepoMap | null> {
  const info = await github.get<{ default_branch?: string }>(`/repos/${repo}`)
  if (!info) return null
  const branch = info.default_branch || 'main'
  const tree = await github.get<{
    tree?: { path: string; type: string; size?: number }[]
    truncated?: boolean
  }>(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (!tree?.tree) return null
  return {
    repo,
    branch,
    truncated: !!tree.truncated,
    files: tree.tree
      .filter((e) => e.type === 'blob')
      .map((e) => ({ path: e.path, size: e.size ?? 0 })),
  }
}

async function loadFile(
  github: GithubClient,
  repo: string,
  branch: string,
  path: string,
): Promise<string | null> {
  const file = await github.get<{ content?: string; encoding?: string }>(
    `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
  )
  if (!file?.content || file.encoding !== 'base64') return null
  return Buffer.from(file.content, 'base64').toString('utf8')
}

const settleWithin = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let t: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    t = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([p.catch(() => null), late]).finally(() =>
    clearTimeout(t),
  )
}

/** READMEs of the repos: what to read when no file name matches the question. */
const README = /^(docs\/)?readme\.md$/i

/**
 * Structure of every configured repo plus the files that match the question. Never throws: a repo that is private, down
 * or rate limited just contributes nothing, and the answer says what it could not see.
 */
export async function collectKnowledge(
  deps: Pick<Deps, 'config' | 'github'>,
  question: string,
  now = Date.now(),
): Promise<Knowledge> {
  const { github } = deps
  const store = cacheOf(github)
  const maps = (
    await Promise.all(
      deps.config.ether.repos.map((repo) =>
        settleWithin(
          cached(store.maps, repo, now, () => loadMap(github, repo)),
          WAIT_MS,
        ),
      ),
    )
  ).filter((m): m is RepoMap => !!m)

  let picks = rankFiles(maps, question)
  if (picks.length === 0)
    picks = maps.flatMap((m) =>
      m.files
        .filter((f) => README.test(f.path))
        .slice(0, 1)
        .map((f) => ({
          repo: m.repo,
          branch: m.branch,
          path: f.path,
          score: 0,
        })),
    )

  const sources: KnowledgeSource[] = []
  const texts = await Promise.all(
    picks.map((p) =>
      settleWithin(
        cached(store.files, `${p.repo}@${p.branch}:${p.path}`, now, () =>
          loadFile(github, p.repo, p.branch, p.path),
        ),
        WAIT_MS,
      ),
    ),
  )
  picks.forEach((p, i) => {
    const text = texts[i]
    if (text)
      sources.push({
        n: sources.length + 1,
        repo: p.repo,
        path: p.path,
        text: text.slice(0, MAX_SOURCE_CHARS),
      })
  })
  return { structure: maps.map((m) => outline(m)).join('\n\n'), sources }
}
