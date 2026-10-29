// Pure domain of the git section: GitHub REST payloads -> the graph @wefaber/gitview draws, pushes, CI runs and the
// deploy state file. No network, no DB, no clock: tested with recorded responses.
import type { GitGraph } from '@wefaber/gitview/graph'

// --- GitHub payloads (only the fields we read) ---------------------------------------------------------------

export interface RawBranch {
  name: string
  commit: { sha: string }
}

export interface RawCommit {
  sha: string
  html_url?: string
  commit: {
    message: string
    author?: { name?: string; date?: string } | null
    committer?: { name?: string; date?: string } | null
  }
  author?: { login?: string } | null
  parents: { sha: string }[]
}

export interface RawActivity {
  id: number
  before?: string
  after?: string
  ref?: string
  timestamp?: string
  activity_type?: string
  actor?: { login?: string } | null
}

export interface RawRun {
  id: number
  name?: string | null
  path?: string
  event?: string
  status?: string | null
  conclusion?: string | null
  html_url?: string
  head_sha: string
  head_branch?: string | null
  created_at?: string
  updated_at?: string
}

// --- Graph ---------------------------------------------------------------------------------------------------

export interface BranchCommits {
  name: string
  /** Tip sha, from `/branches`. */
  tip: string
  /** Newest first, as `/commits?sha=<branch>` returns them. */
  commits: RawCommit[]
}

export interface CommitInfo {
  sha: string
  short: string
  /** Full message (title + body). */
  message: string
  title: string
  author: string
  login: string | null
  date: string
  url: string
  /** Branch whose lane the commit sits on. */
  branch: string
  parents: string[]
}

export interface GraphResult {
  graph: GitGraph
  commits: Map<string, CommitInfo>
}

/** Branches that always come first, in this order: they are the long-lived lines. */
const PRIMARY = ['main', 'master', 'dev', 'develop']
export const MAX_BRANCHES = 8

const dateOf = (c: RawCommit) =>
  c.commit.committer?.date ?? c.commit.author?.date ?? ''

const titleOf = (message: string) => message.split('\n', 1)[0]?.trim() ?? ''

/**
 * One lane per branch, columns follow time (parents always before children). A commit sits on the lane of the first
 * branch (main, dev, then the most recently touched) whose first-parent chain reaches it; commits only reachable
 * through a merge fall back to the first branch listing them. Edges only join commits inside the set.
 */
export function toGitGraph(
  input: BranchCommits[],
  maxBranches = MAX_BRANCHES,
): GraphResult {
  const byName = new Map(input.map((b) => [b.name, b]))
  const tipDate = (b: BranchCommits) =>
    b.commits.find((c) => c.sha === b.tip)
      ? dateOf(b.commits.find((c) => c.sha === b.tip)!)
      : b.commits[0]
        ? dateOf(b.commits[0])
        : ''
  const primary = PRIMARY.flatMap((n) => {
    const b = byName.get(n)
    return b ? [b] : []
  })
  const rest = input
    .filter((b) => !PRIMARY.includes(b.name))
    .sort(
      (a, b) =>
        tipDate(b).localeCompare(tipDate(a)) || a.name.localeCompare(b.name),
    )
  const branches = [...primary, ...rest]
    .filter((b) => b.commits.length > 0)
    .slice(0, maxBranches)

  const raw = new Map<string, RawCommit>()
  for (const b of branches) for (const c of b.commits) raw.set(c.sha, c)

  // Lane by first-parent chain, in branch priority order.
  const laneOf = new Map<string, number>()
  branches.forEach((b, i) => {
    let cur: string | undefined = b.tip
    while (cur && raw.has(cur) && !laneOf.has(cur)) {
      laneOf.set(cur, i)
      cur = raw.get(cur)!.parents[0]?.sha
    }
  })
  branches.forEach((b, i) => {
    for (const c of b.commits) if (!laneOf.has(c.sha)) laneOf.set(c.sha, i)
  })

  // Compact: lanes without commits (a branch pointing at another's tip) disappear.
  const used = [...new Set(laneOf.values())].sort((a, b) => a - b)
  const lane = new Map(used.map((old, i) => [old, i]))

  // Kahn over (date, sha): time order that never puts a child before its parent.
  const children = new Map<string, string[]>()
  const pending = new Map<string, number>()
  for (const c of raw.values()) {
    const inSet = c.parents.filter((p) => raw.has(p.sha))
    pending.set(c.sha, inSet.length)
    for (const p of inSet)
      children.set(p.sha, [...(children.get(p.sha) ?? []), c.sha])
  }
  const key = (sha: string) => `${dateOf(raw.get(sha)!)}\0${sha}`
  const ready = [...pending].filter(([, n]) => n === 0).map(([sha]) => sha)
  const order: string[] = []
  while (ready.length) {
    ready.sort((a, b) => key(a).localeCompare(key(b)))
    const sha = ready.shift()!
    order.push(sha)
    for (const child of children.get(sha) ?? []) {
      const left = (pending.get(child) ?? 1) - 1
      pending.set(child, left)
      if (left === 0) ready.push(child)
    }
  }

  const commits = new Map<string, CommitInfo>()
  const nodes = order.map((sha, column) => {
    const c = raw.get(sha)!
    const message = c.commit.message
    const branch = branches[laneOf.get(sha)!]!.name
    commits.set(sha, {
      sha,
      short: sha.slice(0, 7),
      message,
      title: titleOf(message),
      author: c.commit.author?.name ?? c.author?.login ?? 'desconocido',
      login: c.author?.login ?? null,
      date: dateOf(c),
      url: c.html_url ?? '',
      branch,
      parents: c.parents.map((p) => p.sha),
    })
    return {
      sha,
      short: sha.slice(0, 7),
      message: titleOf(message),
      date: dateOf(c),
      column,
      lane: lane.get(laneOf.get(sha)!)!,
    }
  })

  const edges = order.flatMap((sha) =>
    (raw.get(sha)?.parents ?? [])
      .filter((p) => raw.has(p.sha))
      .map((p) => ({ from: p.sha, to: sha })),
  )

  return {
    graph: {
      lanes: Math.max(1, used.length),
      columns: nodes.length,
      nodes,
      branches: branches
        .filter((b) => raw.has(b.tip))
        .map((b) => ({ name: b.name, sha: b.tip })),
      edges,
    },
    commits,
  }
}

// --- Pushes --------------------------------------------------------------------------------------------------

export interface Push {
  id: string
  actor: string
  /** Short ref name (`dev`, `v1.2`). */
  ref: string
  kind: 'branch' | 'tag'
  at: string
  before: string
  after: string
}

/** `/activity` entries -> pushes, newest first. Entries without a ref or a time are dropped. */
export function parsePushes(raw: RawActivity[] | null, limit = 30): Push[] {
  return (raw ?? [])
    .flatMap((a): Push[] => {
      const ref = a.ref ?? ''
      const m = /^refs\/(heads|tags)\/(.+)$/.exec(ref)
      if (!m || !a.timestamp || !a.after) return []
      return [
        {
          id: String(a.id),
          actor: a.actor?.login ?? 'desconocido',
          ref: m[2]!,
          kind: m[1] === 'tags' ? 'tag' : 'branch',
          at: a.timestamp,
          before: a.before ?? '',
          after: a.after,
        },
      ]
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}

// --- CI / deploy runs ----------------------------------------------------------------------------------------

export type RunState =
  | 'success'
  | 'failure'
  | 'running'
  | 'queued'
  | 'cancelled'
  | 'skipped'

export interface RunInfo {
  id: number
  name: string
  kind: 'ci' | 'deploy'
  state: RunState
  url: string
  at: string
  sha: string
}

export function runState(run: Pick<RawRun, 'status' | 'conclusion'>): RunState {
  if (run.status === 'completed' || run.conclusion) {
    switch (run.conclusion) {
      case 'success':
        return 'success'
      case 'cancelled':
        return 'cancelled'
      case 'skipped':
      case 'neutral':
      case 'stale':
        return 'skipped'
      default:
        return 'failure'
    }
  }
  return run.status === 'queued' ||
    run.status === 'pending' ||
    run.status === 'waiting'
    ? 'queued'
    : 'running'
}

export function parseRuns(raw: { workflow_runs?: RawRun[] } | null): RunInfo[] {
  return (raw?.workflow_runs ?? [])
    .map((r) => ({
      id: r.id,
      name: r.name ?? r.path ?? 'workflow',
      kind: /(^|\/)deploy[^/]*\.ya?ml$/.test(r.path ?? '')
        ? ('deploy' as const)
        : ('ci' as const),
      state: runState(r),
      url: r.html_url ?? '',
      at: r.created_at ?? r.updated_at ?? '',
      sha: r.head_sha,
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

const SEVERITY: RunState[] = [
  'failure',
  'running',
  'queued',
  'cancelled',
  'success',
  'skipped',
]

/** One state for many runs: a failure wins, then anything still moving, then the rest. `null` without runs. */
export function worstState(runs: RunInfo[]): RunState | null {
  for (const s of SEVERITY) if (runs.some((r) => r.state === s)) return s
  return null
}

export interface CommitRuns {
  ci: RunState | null
  deploy: RunState | null
  runs: RunInfo[]
}

/** CI = every non-deploy workflow; deploy = the newest deploy run. */
export function summarizeRuns(runs: RunInfo[]): CommitRuns {
  const ci = runs.filter((r) => r.kind === 'ci')
  const deploy = runs.find((r) => r.kind === 'deploy')
  return { ci: worstState(ci), deploy: deploy?.state ?? null, runs }
}

export function groupBySha(runs: RunInfo[]): Map<string, RunInfo[]> {
  const out = new Map<string, RunInfo[]>()
  for (const r of runs) out.set(r.sha, [...(out.get(r.sha) ?? []), r])
  return out
}

// --- Deploy state file ---------------------------------------------------------------------------------------

export interface ActiveDeploy {
  tag: string
  commit: string
  deployedAt: string
}

/** `nexus-deploy.env`: `TAG=…`, `DEPLOYED_AT=…`, `COMMIT=…`. `null` without a usable TAG. */
export function parseDeployState(text: string): ActiveDeploy | null {
  const vars = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) vars.set(m[1]!, m[2]!.trim())
  }
  const tag = vars.get('TAG') ?? ''
  if (!tag || tag === '-') return null
  const commit = vars.get('COMMIT')
  return {
    tag,
    commit: commit && commit !== '-' ? commit : '',
    deployedAt: vars.get('DEPLOYED_AT') ?? '',
  }
}

/** The image tag is the short commit by default, so match on either the full sha or the tag as a prefix. */
export function isActive(active: ActiveDeploy | null, sha: string): boolean {
  if (!active) return false
  return (
    (active.commit !== '' && active.commit === sha) ||
    sha.startsWith(active.tag) ||
    active.tag.startsWith(sha)
  )
}

// --- Change detection ----------------------------------------------------------------------------------------

/** Fingerprint of everything the section shows; the poll job emits only when it changes. */
export function signature(
  graph: GitGraph,
  pushes: Push[],
  runs: RunInfo[],
): string {
  return [
    graph.nodes.map((n) => `${n.sha}:${n.lane}`).join(','),
    graph.branches.map((b) => `${b.name}@${b.sha}`).join(','),
    pushes.map((p) => p.id).join(','),
    runs.map((r) => `${r.id}:${r.state}`).join(','),
  ].join('|')
}
