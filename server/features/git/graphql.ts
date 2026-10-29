// GraphQL of git: gitGraph, gitPushes(limit), gitCommit(sha). Read-only: no mutations, so nothing to audit.
import { builder, fail } from '../../graphql/builder'
import { clampPage } from '../../graphql/limits'
import { commitDetail, snapshot } from './github'
import { worstState, type Push, type RunInfo } from './graph'

interface NodeRow {
  sha: string
  short: string
  message: string
  date: string
  column: number
  lane: number
  author: string
}

interface BranchRow {
  name: string
  sha: string
  ci: string | null
}

interface GraphRow {
  lanes: number
  columns: number
  nodes: NodeRow[]
  branches: BranchRow[]
  edges: { from: string; to: string }[]
}

const NodeRef = builder.objectRef<NodeRow>('GitNode').implement({
  fields: (t) => ({
    sha: t.exposeString('sha'),
    short: t.exposeString('short'),
    message: t.exposeString('message'),
    date: t.exposeString('date'),
    column: t.exposeInt('column'),
    lane: t.exposeInt('lane'),
    author: t.exposeString('author'),
  }),
})

const BranchRef = builder.objectRef<BranchRow>('GitBranch').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    sha: t.exposeString('sha'),
    ci: t.exposeString('ci', {
      nullable: true,
      description: 'success | failure | running | queued | cancelled | skipped',
    }),
  }),
})

const EdgeRef = builder
  .objectRef<{ from: string; to: string }>('GitEdge')
  .implement({
    fields: (t) => ({
      from: t.exposeString('from'),
      to: t.exposeString('to'),
    }),
  })

const GraphRef = builder.objectRef<GraphRow>('GitGraph').implement({
  fields: (t) => ({
    lanes: t.exposeInt('lanes'),
    columns: t.exposeInt('columns'),
    nodes: t.field({ type: [NodeRef], resolve: (g) => g.nodes }),
    branches: t.field({ type: [BranchRef], resolve: (g) => g.branches }),
    edges: t.field({ type: [EdgeRef], resolve: (g) => g.edges }),
  }),
})

interface PushRow extends Push {
  short: string
  title: string
}

const PushRef = builder.objectRef<PushRow>('GitPush').implement({
  fields: (t) => ({
    id: t.exposeString('id'),
    actor: t.exposeString('actor'),
    ref: t.exposeString('ref'),
    kind: t.exposeString('kind', { description: 'branch | tag' }),
    at: t.exposeString('at'),
    after: t.exposeString('after'),
    short: t.exposeString('short'),
    title: t.exposeString('title', {
      description:
        'Title of the pushed commit; empty when it is out of the loaded history.',
    }),
  }),
})

const RunRef = builder.objectRef<RunInfo>('GitRun').implement({
  fields: (t) => ({
    id: t.exposeInt('id'),
    name: t.exposeString('name'),
    kind: t.exposeString('kind', { description: 'ci | deploy' }),
    state: t.exposeString('state'),
    url: t.exposeString('url'),
    at: t.exposeString('at'),
  }),
})

interface CommitRow {
  sha: string
  short: string
  message: string
  title: string
  author: string
  login: string | null
  date: string
  url: string
  branch: string
  parents: string[]
  ci: string | null
  deploy: string | null
  runs: RunInfo[]
  active: boolean
  deployedAt: string | null
}

const CommitRef = builder.objectRef<CommitRow>('GitCommit').implement({
  fields: (t) => ({
    sha: t.exposeString('sha'),
    short: t.exposeString('short'),
    message: t.exposeString('message'),
    title: t.exposeString('title'),
    author: t.exposeString('author'),
    login: t.exposeString('login', { nullable: true }),
    date: t.exposeString('date'),
    url: t.exposeString('url'),
    branch: t.exposeString('branch'),
    parents: t.exposeStringList('parents'),
    ci: t.exposeString('ci', { nullable: true }),
    deploy: t.exposeString('deploy', { nullable: true }),
    runs: t.field({ type: [RunRef], resolve: (c) => c.runs }),
    active: t.exposeBoolean('active', {
      description:
        'True when this commit is the tag running in the test stack.',
    }),
    deployedAt: t.exposeString('deployedAt', { nullable: true }),
  }),
})

const SHA = /^[0-9a-f]{7,40}$/i

builder.queryFields((t) => ({
  gitGraph: t.field({
    type: GraphRef,
    resolve: async (_root, _args, ctx) => {
      const snap = await snapshot(ctx)
      const { graph, commits } = snap
      return {
        lanes: graph.lanes,
        columns: graph.columns,
        nodes: graph.nodes.map((n) => ({
          ...n,
          author: commits.get(n.sha)?.author ?? '',
        })),
        branches: graph.branches.map((b) => ({
          ...b,
          ci: worstState(
            (snap.bySha.get(b.sha) ?? []).filter((r) => r.kind === 'ci'),
          ),
        })),
        edges: graph.edges,
      }
    },
  }),
  gitPushes: t.field({
    type: [PushRef],
    args: { limit: t.arg.int() },
    resolve: async (_root, { limit }, ctx) => {
      const snap = await snapshot(ctx)
      return snap.pushes.slice(0, clampPage(limit, 20)).map((p) => ({
        ...p,
        short: p.after.slice(0, 7),
        title: snap.commits.get(p.after)?.title ?? '',
      }))
    },
  }),
  gitCommit: t.field({
    type: CommitRef,
    nullable: true,
    args: { sha: t.arg.string({ required: true }) },
    resolve: async (_root, { sha }, ctx) => {
      if (!SHA.test(sha)) fail('BAD_INPUT', 'El sha no es válido.')
      const detail = await commitDetail(ctx, sha.toLowerCase())
      if (!detail) return null
      return {
        ...detail.info,
        ci: detail.ci,
        deploy: detail.deploy,
        runs: detail.runs,
        active: detail.active,
        deployedAt: detail.deployedAt,
      }
    },
  }),
}))
