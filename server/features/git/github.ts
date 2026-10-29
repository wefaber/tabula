// Reads the Gravida repo through `deps.github.get` (ETag/304 on the real client, fixtures in dev and tests) and keeps a
// short-lived snapshot so the three queries and the poll job share the same requests.
import { readFile } from 'node:fs/promises'
import { GithubError } from '../../adapters/github'
import type { Deps } from '../../deps'
import { fail } from '../../graphql/builder'
import {
  groupBySha,
  isActive,
  parseDeployState,
  parsePushes,
  parseRuns,
  signature,
  summarizeRuns,
  toGitGraph,
  type ActiveDeploy,
  type BranchCommits,
  type CommitInfo,
  type CommitRuns,
  type Push,
  type RawActivity,
  type RawBranch,
  type RawCommit,
  type RawRun,
  type RunInfo,
} from './graph'

/** Branches fetched before the mapper keeps the most recent ones. */
const FETCH_BRANCHES = 15
const PRIMARY_PAGE = 100
const BRANCH_PAGE = 40

export const paths = {
  branches: (repo: string) => `/repos/${repo}/branches?per_page=100`,
  commits: (repo: string, branch: string, perPage: number) =>
    `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
  commit: (repo: string, sha: string) => `/repos/${repo}/commits/${sha}`,
  activity: (repo: string) =>
    `/repos/${repo}/activity?activity_type=push&per_page=50`,
  runs: (repo: string) => `/repos/${repo}/actions/runs?per_page=100`,
  runsOf: (repo: string, sha: string) =>
    `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`,
}

export interface Snapshot {
  at: number
  graph: ReturnType<typeof toGitGraph>['graph']
  commits: Map<string, CommitInfo>
  pushes: Push[]
  runs: RunInfo[]
  bySha: Map<string, RunInfo[]>
  signature: string
}

/** Without a token the real client would hit GitHub anonymously and burn the 60/h limit: say what is missing. */
export function assertConfigured(deps: Deps): void {
  if (!deps.config.fixtures && !deps.config.github.token)
    fail(
      'GITHUB_NOT_CONFIGURED',
      'Falta GITHUB_TOKEN: sin él el panel no puede leer el repo. Cargalo en ~/deploy/env/gravida-devpanel.env y reiniciá el servicio.',
    )
}

/** A GitHub failure becomes a stable code with the status, never a stack. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof GithubError)
      fail(
        'GITHUB_ERROR',
        e.status === 403 || e.status === 429
          ? 'GitHub limitó las consultas (rate limit). Probá de nuevo en un rato.'
          : e.status === 401
            ? 'GitHub rechazó el token (401). Revisá GITHUB_TOKEN.'
            : `GitHub respondió ${e.status}.`,
      )
    throw e
  }
}

async function build(deps: Deps, now: number): Promise<Snapshot> {
  const repo = deps.github.repo
  const get = deps.github.get.bind(deps.github)
  const branches = (await get<RawBranch[]>(paths.branches(repo))) ?? []
  const wanted = branches.slice(0, FETCH_BRANCHES)
  const primary = new Set(['main', 'master', 'dev', 'develop'])
  const input: BranchCommits[] = (
    await Promise.all(
      wanted.map(async (b) => ({
        name: b.name,
        tip: b.commit.sha,
        commits:
          (await get<RawCommit[]>(
            paths.commits(
              repo,
              b.name,
              primary.has(b.name) ? PRIMARY_PAGE : BRANCH_PAGE,
            ),
          )) ?? [],
      })),
    )
  ).filter((b) => b.commits.length > 0)

  const [activity, runsRaw] = await Promise.all([
    get<RawActivity[]>(paths.activity(repo)),
    get<{ workflow_runs?: RawRun[] }>(paths.runs(repo)),
  ])
  const { graph, commits } = toGitGraph(input)
  const pushes = parsePushes(activity)
  const runs = parseRuns(runsRaw)
  return {
    at: now,
    graph,
    commits,
    pushes,
    runs,
    bySha: groupBySha(runs),
    signature: signature(graph, pushes, runs),
  }
}

const TTL_MS = 30_000
const cache = new WeakMap<Deps, { at: number; value: Promise<Snapshot> }>()

/** Shared snapshot; `fresh` bypasses the TTL (the poll job). A failed load is not cached. */
export function snapshot(
  deps: Deps,
  opts: { fresh?: boolean; now?: number } = {},
): Promise<Snapshot> {
  assertConfigured(deps)
  const now = opts.now ?? Date.now()
  const hit = cache.get(deps)
  if (hit && !opts.fresh && now - hit.at < TTL_MS) return hit.value
  const value = guarded(() => build(deps, now))
  cache.set(deps, { at: now, value })
  value.catch(() => {
    if (cache.get(deps)?.value === value) cache.delete(deps)
  })
  return value
}

export function runsOfCommit(snap: Snapshot, sha: string): CommitRuns {
  return summarizeRuns(snap.bySha.get(sha) ?? [])
}

/** `null` when the state file does not exist yet (nothing deployed, or not the VPS). */
export async function readActiveDeploy(
  path: string,
): Promise<ActiveDeploy | null> {
  try {
    return parseDeployState(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export interface CommitDetail {
  info: CommitInfo
  ci: CommitRuns['ci']
  deploy: CommitRuns['deploy']
  runs: RunInfo[]
  active: boolean
  deployedAt: string | null
}

/** Details for one commit (full or abbreviated sha). `null` when GitHub does not know it. */
export async function commitDetail(
  deps: Deps,
  sha: string,
): Promise<CommitDetail | null> {
  const snap = await snapshot(deps)
  let info: CommitInfo | undefined = snap.commits.get(sha)
  if (!info && sha.length < 40)
    info = [...snap.commits.values()].find((c) => c.sha.startsWith(sha))
  if (!info) {
    const raw = await guarded(() =>
      deps.github.get<RawCommit>(paths.commit(deps.github.repo, sha)),
    )
    if (!raw) return null
    info = {
      sha: raw.sha,
      short: raw.sha.slice(0, 7),
      message: raw.commit.message,
      title: raw.commit.message.split('\n', 1)[0]?.trim() ?? '',
      author: raw.commit.author?.name ?? raw.author?.login ?? 'desconocido',
      login: raw.author?.login ?? null,
      date: raw.commit.committer?.date ?? raw.commit.author?.date ?? '',
      url: raw.html_url ?? '',
      branch: '',
      parents: raw.parents.map((p) => p.sha),
    }
  }
  const known = snap.bySha.get(info.sha)
  const runs =
    known ??
    parseRuns(
      await guarded(() =>
        deps.github.get<{ workflow_runs?: RawRun[] }>(
          paths.runsOf(deps.github.repo, info!.sha),
        ),
      ),
    )
  const summary = summarizeRuns(runs)
  const state = await readActiveDeploy(deps.config.nexus.stateFile)
  const active = isActive(state, info.sha)
  return {
    info,
    ci: summary.ci,
    deploy: summary.deploy,
    runs,
    active,
    deployedAt: active ? state!.deployedAt || null : null,
  }
}
