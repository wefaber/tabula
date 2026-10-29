// Git. Owns everything under src/features/git/. The timeline is the whole section: the chrome floats over it.
import { Loader } from '@/app/Loader'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dock, EmptyState, IconButton, Menu, MenuItem } from '@wefaber/ui'
import {
  GitTimeline,
  type GitGraph,
  type GitTimelineLabels,
} from '@wefaber/gitview'
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Rocket,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, follow, gql } from '@/lib/api'

const DOCK_WIDTH = 380

const GRAPH = /* GraphQL */ `
  query GitGraph {
    gitGraph {
      lanes
      columns
      nodes {
        sha
        short
        message
        date
        column
        lane
        author
      }
      branches {
        name
        sha
        ci
      }
      edges {
        from
        to
      }
    }
    gitPushes(limit: 20) {
      id
      actor
      ref
      kind
      at
      after
      short
      title
    }
  }
`

const COMMIT = /* GraphQL */ `
  query GitCommit($sha: String!) {
    gitCommit(sha: $sha) {
      sha
      short
      title
      message
      author
      login
      date
      url
      branch
      ci
      deploy
      active
      deployedAt
      runs {
        id
        name
        kind
        state
        url
        at
      }
    }
  }
`

type RunState =
  | 'success'
  | 'failure'
  | 'running'
  | 'queued'
  | 'cancelled'
  | 'skipped'

interface GraphData {
  gitGraph: {
    lanes: number
    columns: number
    nodes: GitGraph['nodes']
    branches: { name: string; sha: string; ci: RunState | null }[]
    edges: GitGraph['edges']
  }
  gitPushes: {
    id: string
    actor: string
    ref: string
    kind: string
    at: string
    after: string
    short: string
    title: string
  }[]
}

interface CommitData {
  gitCommit: {
    sha: string
    short: string
    title: string
    message: string
    author: string
    login: string | null
    date: string
    url: string
    branch: string
    ci: RunState | null
    deploy: RunState | null
    active: boolean
    deployedAt: string | null
    runs: {
      id: number
      name: string
      kind: 'ci' | 'deploy'
      state: RunState
      url: string
      at: string
    }[]
  } | null
}

const STATE: Record<
  RunState,
  { label: string; icon: LucideIcon; tone: string }
> = {
  success: { label: 'ok', icon: CircleCheck, tone: 'text-success' },
  failure: { label: 'falló', icon: CircleX, tone: 'text-danger' },
  running: { label: 'en curso', icon: LoaderCircle, tone: 'text-accent' },
  queued: { label: 'en cola', icon: Clock, tone: 'text-muted' },
  cancelled: { label: 'cancelado', icon: CircleSlash, tone: 'text-muted' },
  skipped: { label: 'omitido', icon: CircleSlash, tone: 'text-muted' },
}

// Estado con ícono y texto, nunca solo color.
function StateChip({ state, prefix }: { state: RunState; prefix?: string }) {
  const { label, icon: Icon, tone } = STATE[state]
  return (
    <span className={`inline-flex items-center gap-1.5 text-meta ${tone}`}>
      <Icon size={14} aria-hidden />
      {prefix ? `${prefix}: ${label}` : label}
    </span>
  )
}

const LABELS: GitTimelineLabels = {
  region:
    'Historial de commits. Rueda o flechas para moverte, Enter para abrir el commit central.',
  hint: 'Rueda o arrastrá para moverte en el tiempo · Shift + rueda para subir y bajar · clic en un commit para ver el detalle',
  commit: (short, message) => `${short} ${message}`,
}

const fmt = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
}

type Open = 'pushes' | 'branches' | null

export default function Section() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<Open>(null)

  const graph = useQuery({
    queryKey: ['git', 'graph'],
    queryFn: () => gql<GraphData>(GRAPH),
    retry: false,
    refetchOnWindowFocus: false,
  })

  // Un cambio en el repo llega por SSE; el panel recarga el historial sin mover el layout.
  useEffect(
    () =>
      follow('git', {
        changed: () => void qc.invalidateQueries({ queryKey: ['git'] }),
      }),
    [qc],
  )

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const data = graph.data?.gitGraph
  const timeline = useMemo<GitGraph | null>(
    () =>
      data
        ? {
            lanes: data.lanes,
            columns: data.columns,
            nodes: data.nodes,
            branches: data.branches.map(({ name, sha }) => ({ name, sha })),
            edges: data.edges,
          }
        : null,
    [data],
  )

  if (graph.isPending) return <Loader label="Cargando historial…" />

  if (graph.error) {
    const err = graph.error
    const notConfigured =
      err instanceof ApiError && err.code === 'GITHUB_NOT_CONFIGURED'
    return (
      <div role="alert">
        <EmptyState>
          {notConfigured ? (
            <>
              Falta GITHUB_TOKEN en el servidor, así que no se puede leer el
              repo. Cargalo en{' '}
              <span className="font-mono">~/deploy/env/tabula.env</span> y
              reiniciá el servicio.
            </>
          ) : (
            <>
              No se pudo leer el historial ({err.message}).{' '}
              <button
                className="underline"
                onClick={() => void graph.refetch()}
              >
                Reintentar
              </button>
            </>
          )}
        </EmptyState>
      </div>
    )
  }

  if (!timeline || timeline.nodes.length === 0)
    return (
      <EmptyState>
        Todavía no hay commits en el repo. Cuando alguien haga push a una rama,
        aparecen acá.
      </EmptyState>
    )

  const pushes = graph.data!.gitPushes
  const branches = data!.branches

  return (
    <div className="relative h-[calc(100svh-8rem)] min-h-[420px] overflow-hidden rounded-tile">
      <div className="absolute inset-0">
        <GitTimeline
          graph={timeline}
          selected={selected}
          onSelect={setSelected}
          inset={selected ? DOCK_WIDTH : 0}
          locale="es-AR"
          labels={LABELS}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-3">
        <p className="pointer-events-auto rounded-control border border-border bg-surface px-3 py-1.5 font-mono text-meta text-muted tabular">
          {timeline.columns} commits en {timeline.lanes}{' '}
          {timeline.lanes === 1 ? 'rama' : 'ramas'}
        </p>

        <div className="pointer-events-auto flex gap-2">
          <Menu
            label="Últimos pushes"
            align="end"
            className="w-80"
            open={menu === 'pushes'}
            onOpenChange={(o) => setMenu(o ? 'pushes' : null)}
            trigger={(p) => (
              <button type="button" className={triggerClass} {...p}>
                <Rocket size={14} aria-hidden /> Pushes
              </button>
            )}
          >
            {pushes.length === 0 ? (
              <p className="p-3 text-meta text-muted">
                Todavía no hay pushes recientes.
              </p>
            ) : (
              pushes.map((p) => (
                <MenuItem
                  key={p.id}
                  hint={<span className="font-mono">{p.short}</span>}
                  onSelect={() => setSelected(p.after)}
                >
                  <span className="block truncate">
                    {p.actor} → {p.ref}
                  </span>
                  <span className="block truncate text-meta text-muted">
                    {p.title || fmt(p.at)}
                  </span>
                </MenuItem>
              ))
            )}
          </Menu>

          <Menu
            label="Ramas"
            align="end"
            className="w-64"
            open={menu === 'branches'}
            onOpenChange={(o) => setMenu(o ? 'branches' : null)}
            trigger={(p) => (
              <button type="button" className={triggerClass} {...p}>
                <GitBranch size={14} aria-hidden /> Ramas
              </button>
            )}
          >
            {branches.map((b) => (
              <MenuItem
                key={b.name}
                icon={b.ci ? <CiIcon state={b.ci} /> : undefined}
                hint={<span className="font-mono">{b.sha.slice(0, 7)}</span>}
                onSelect={() => setSelected(b.sha)}
              >
                {b.name}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </div>

      <Dock open={selected !== null} width={DOCK_WIDTH}>
        {selected && (
          <CommitDock sha={selected} onClose={() => setSelected(null)} />
        )}
      </Dock>
    </div>
  )
}

const triggerClass =
  'inline-flex h-8 items-center gap-1.5 rounded-control bg-surface px-3 text-body font-medium text-text border border-border shadow-float hover:bg-text/8'

function CiIcon({ state }: { state: RunState }) {
  const { icon: Icon, tone } = STATE[state]
  return (
    <span className={tone} aria-label={`CI ${STATE[state].label}`}>
      <Icon size={14} aria-hidden />
    </span>
  )
}

function CommitDock({ sha, onClose }: { sha: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['git', 'commit', sha],
    queryFn: () => gql<CommitData>(COMMIT, { sha }),
    retry: false,
  })
  const commit = detail.data?.gitCommit

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-tile border border-border bg-surface p-4 shadow-float">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-meta text-muted">
            <GitCommitHorizontal
              size={14}
              aria-hidden
              className="text-accent"
            />
            {commit?.short ?? sha.slice(0, 7)}
            {commit?.branch ? ` · ${commit.branch}` : ''}
          </p>
          <h2 className="mt-1 text-h3 font-semibold break-words">
            {commit?.title ?? (detail.isPending ? 'Cargando…' : 'Commit')}
          </h2>
        </div>
        <IconButton
          label="Cerrar (Esc)"
          icon={<X size={16} />}
          onClick={onClose}
        />
      </header>

      {detail.error && (
        <p role="alert" className="text-danger">
          No se pudo leer el commit ({detail.error.message}).{' '}
          <button className="underline" onClick={() => void detail.refetch()}>
            Reintentar
          </button>
        </p>
      )}

      {detail.data && !commit && (
        <EmptyState>GitHub no conoce este commit.</EmptyState>
      )}

      {commit && (
        <>
          {commit.message.includes('\n') && (
            <p className="whitespace-pre-wrap break-words text-body leading-relaxed">
              {commit.message.split('\n').slice(1).join('\n').trim()}
            </p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
            <dt className="text-muted">Autor</dt>
            <dd>{commit.author}</dd>
            <dt className="text-muted">Fecha</dt>
            <dd>{fmt(commit.date)}</dd>
            <dt className="text-muted">Commit</dt>
            <dd className="break-all font-mono text-meta">{commit.sha}</dd>
          </dl>

          <section aria-label="CI y deploy" className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {commit.ci ? (
                <StateChip state={commit.ci} prefix="CI" />
              ) : (
                <span className="text-meta text-muted">Sin CI</span>
              )}
              {commit.deploy ? (
                <StateChip state={commit.deploy} prefix="Deploy" />
              ) : (
                <span className="text-meta text-muted">Sin deploy</span>
              )}
            </div>
            {commit.active ? (
              <p className="rounded-control bg-accent/10 px-3 py-2 text-meta text-text">
                Es el tag activo en el stack de pruebas
                {commit.deployedAt ? ` desde ${fmt(commit.deployedAt)}` : ''}.
              </p>
            ) : null}
            {commit.runs.length > 0 && (
              <ul className="flex flex-col gap-1">
                {commit.runs.map((r) => (
                  <li key={r.id}>
                    <a
                      className="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 text-body hover:bg-text/8"
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="truncate">{r.name}</span>
                      <StateChip state={r.state} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <a
            className="inline-flex h-8 items-center gap-1.5 self-start rounded-control bg-text/8 px-3 text-body font-medium text-text hover:bg-text/12"
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver en GitHub
          </a>
        </>
      )}
    </div>
  )
}
