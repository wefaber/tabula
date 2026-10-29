// GitHub-shaped responses for dev (DEVPANEL_FIXTURES=1) and tests: five branches with a fork, two merges, a hotfix and
// an open feature branch, pushes by two people, CI and deploy runs (one failed, one running). Registered by path on the
// shared fixture map from this folder.
import { createHash } from 'node:crypto'
import { githubFixtures } from '../../adapters/github'
import { paths } from './github'

interface Seed {
  id: string
  title: string
  who: 'faku' | 'pablo'
  at: string
  parents: string[]
  body?: string
}

const PEOPLE = {
  faku: { name: 'Faku', login: 'faku' },
  pablo: { name: 'Pablo', login: 'pablo-iti' },
}

/** Oldest first. `parents[0]` is the first parent, as in git. */
const SEEDS: Seed[] = [
  {
    id: 'c01',
    title: 'chore: scaffold inicial',
    who: 'faku',
    at: '2026-10-20T13:02:00Z',
    parents: [],
  },
  {
    id: 'c02',
    title: 'feat(auth): login con token',
    who: 'faku',
    at: '2026-10-20T16:40:00Z',
    parents: ['c01'],
  },
  {
    id: 'c03',
    title: 'feat(api): endpoint de turnos',
    who: 'pablo',
    at: '2026-10-21T11:15:00Z',
    parents: ['c02'],
    body: 'Lista y alta de turnos.\n\nIncluye paginación por cursor.',
  },
  {
    id: 'c04',
    title: 'feat(front): agenda semanal',
    who: 'faku',
    at: '2026-10-21T15:30:00Z',
    parents: ['c03'],
  },
  {
    id: 'c05',
    title: 'feat(eco): carga de ecografías',
    who: 'pablo',
    at: '2026-10-22T09:20:00Z',
    parents: ['c03'],
  },
  {
    id: 'c06',
    title: 'feat(eco): vista previa de imágenes',
    who: 'pablo',
    at: '2026-10-22T14:05:00Z',
    parents: ['c05'],
  },
  {
    id: 'c07',
    title: 'fix(api): paginación de turnos',
    who: 'faku',
    at: '2026-10-22T17:45:00Z',
    parents: ['c04'],
  },
  {
    id: 'c08',
    title: 'Merge pull request #12 from feat/ecografias',
    who: 'faku',
    at: '2026-10-23T10:10:00Z',
    parents: ['c07', 'c06'],
  },
  {
    id: 'c09',
    title: 'Merge pull request #13 from dev',
    who: 'faku',
    at: '2026-10-23T12:00:00Z',
    parents: ['c02', 'c08'],
    body: 'Release de la semana.',
  },
  {
    id: 'c10',
    title: 'fix(auth): redirect después del login',
    who: 'pablo',
    at: '2026-10-23T18:25:00Z',
    parents: ['c09'],
  },
  {
    id: 'c11',
    title: 'chore: actualizar dependencias',
    who: 'faku',
    at: '2026-10-24T09:00:00Z',
    parents: ['c08'],
  },
  {
    id: 'c12',
    title: 'feat(db): índice por fecha de turno',
    who: 'faku',
    at: '2026-10-24T13:40:00Z',
    parents: ['c11'],
  },
  {
    id: 'c13',
    title: 'Merge pull request #14 from hotfix/login',
    who: 'faku',
    at: '2026-10-24T15:00:00Z',
    parents: ['c09', 'c10'],
  },
  {
    id: 'c14',
    title: 'Merge branch main into dev',
    who: 'faku',
    at: '2026-10-24T15:20:00Z',
    parents: ['c12', 'c13'],
  },
  {
    id: 'c15',
    title: 'feat(reportes): resumen mensual',
    who: 'pablo',
    at: '2026-10-26T10:30:00Z',
    parents: ['c12'],
  },
  {
    id: 'c16',
    title: 'feat(reportes): exportar a CSV',
    who: 'pablo',
    at: '2026-10-26T16:10:00Z',
    parents: ['c15'],
  },
  {
    id: 'c17',
    title: 'feat(front): turnos por profesional',
    who: 'faku',
    at: '2026-10-27T11:50:00Z',
    parents: ['c14'],
  },
]

const TIPS: Record<string, string> = {
  main: 'c13',
  dev: 'c17',
  'feat/ecografias': 'c06',
  'hotfix/login': 'c10',
  'feat/reportes': 'c16',
}

/** Stable fake 40-hex sha per seed id. */
export const shaOf = (id: string) =>
  createHash('sha1').update(`gravida:${id}`).digest('hex')

const REPO_DEFAULT = 'nexus-iti/gravida'

function rawCommit(repo: string, s: Seed) {
  const who = PEOPLE[s.who]
  return {
    sha: shaOf(s.id),
    html_url: `https://github.com/${repo}/commit/${shaOf(s.id)}`,
    commit: {
      message: s.body ? `${s.title}\n\n${s.body}` : s.title,
      author: { name: who.name, date: s.at },
      committer: { name: who.name, date: s.at },
    },
    author: { login: who.login },
    parents: s.parents.map((p) => ({ sha: shaOf(p) })),
  }
}

/** Newest first, like the API: every commit reachable from the branch tip. */
function reachable(tip: string): Seed[] {
  const byId = new Map(SEEDS.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const stack = [tip]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...byId.get(id)!.parents)
  }
  return SEEDS.filter((s) => seen.has(s.id)).reverse()
}

function run(
  id: number,
  seed: string,
  name: string,
  path: string,
  status: string,
  conclusion: string | null,
  at: string,
  branch: string,
) {
  return {
    id,
    name,
    path,
    event: 'push',
    status,
    conclusion,
    head_sha: shaOf(seed),
    head_branch: branch,
    html_url: `https://github.com/${REPO_DEFAULT}/actions/runs/${id}`,
    created_at: at,
    updated_at: at,
  }
}

const CI = '.github/workflows/ci.yml'
const DEPLOY = '.github/workflows/deploy.yml'

const RUNS = [
  run(
    9017,
    'c17',
    'Deploy',
    DEPLOY,
    'in_progress',
    null,
    '2026-10-27T11:53:00Z',
    'dev',
  ),
  run(
    9016,
    'c17',
    'CI',
    CI,
    'completed',
    'success',
    '2026-10-27T11:51:00Z',
    'dev',
  ),
  run(
    9015,
    'c16',
    'CI',
    CI,
    'completed',
    'failure',
    '2026-10-26T16:12:00Z',
    'feat/reportes',
  ),
  run(
    9014,
    'c15',
    'CI',
    CI,
    'completed',
    'success',
    '2026-10-26T10:32:00Z',
    'feat/reportes',
  ),
  run(
    9013,
    'c14',
    'Deploy',
    DEPLOY,
    'completed',
    'success',
    '2026-10-24T15:24:00Z',
    'dev',
  ),
  run(
    9012,
    'c14',
    'CI',
    CI,
    'completed',
    'success',
    '2026-10-24T15:21:00Z',
    'dev',
  ),
  run(
    9011,
    'c13',
    'CI',
    CI,
    'completed',
    'success',
    '2026-10-24T15:01:00Z',
    'main',
  ),
  run(
    9010,
    'c12',
    'Deploy',
    DEPLOY,
    'completed',
    'failure',
    '2026-10-24T13:44:00Z',
    'dev',
  ),
  run(
    9009,
    'c12',
    'CI',
    CI,
    'completed',
    'success',
    '2026-10-24T13:41:00Z',
    'dev',
  ),
  run(
    9008,
    'c10',
    'CI',
    CI,
    'completed',
    'success',
    '2026-10-23T18:26:00Z',
    'hotfix/login',
  ),
]

const push = (
  id: number,
  ref: string,
  before: string | null,
  after: string,
  at: string,
  who: 'faku' | 'pablo',
) => ({
  id,
  before: before ? shaOf(before) : '0'.repeat(40),
  after: shaOf(after),
  ref: `refs/heads/${ref}`,
  timestamp: at,
  activity_type: 'push',
  actor: { login: PEOPLE[who].login },
})

const ACTIVITY = [
  push(5008, 'dev', 'c14', 'c17', '2026-10-27T11:52:00Z', 'faku'),
  push(5007, 'feat/reportes', 'c15', 'c16', '2026-10-26T16:11:00Z', 'pablo'),
  push(5006, 'feat/reportes', 'c12', 'c15', '2026-10-26T10:31:00Z', 'pablo'),
  push(5005, 'dev', 'c12', 'c14', '2026-10-24T15:21:00Z', 'faku'),
  push(5004, 'main', 'c09', 'c13', '2026-10-24T15:01:00Z', 'faku'),
  push(5003, 'dev', 'c11', 'c12', '2026-10-24T13:42:00Z', 'faku'),
  push(5002, 'hotfix/login', 'c09', 'c10', '2026-10-23T18:26:00Z', 'pablo'),
  push(5001, 'main', 'c02', 'c09', '2026-10-23T12:01:00Z', 'faku'),
]

/** Register the responses for `repo` on the shared fixture map. Idempotent. */
export function registerGitFixtures(repo = REPO_DEFAULT): void {
  githubFixtures.set(
    paths.branches(repo),
    Object.entries(TIPS).map(([name, id]) => ({
      name,
      commit: { sha: shaOf(id) },
      protected: name === 'main',
    })),
  )
  for (const [name, tip] of Object.entries(TIPS)) {
    for (const perPage of [100, 40])
      githubFixtures.set(
        paths.commits(repo, name, perPage),
        reachable(tip).map((s) => rawCommit(repo, s)),
      )
  }
  githubFixtures.set(paths.activity(repo), ACTIVITY)
  githubFixtures.set(paths.runs(repo), {
    total_count: RUNS.length,
    workflow_runs: RUNS,
  })
}

export const FIXTURE_TIPS = TIPS
