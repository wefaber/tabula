// apiStatus: current state of every endpoint (and the DB) plus its last 24 h as a 48-slot series.
import { builder } from '../../graphql/builder'
import { readStatus } from './checks'
import { INTERVAL_MS, type Bucket, type EndpointSummary } from './domain'

const iso = (ms: number) => new Date(ms).toISOString()

const BucketRef = builder.objectRef<Bucket>('ApiBucket').implement({
  fields: (t) => ({
    at: t.string({ resolve: (b) => iso(b.atMs) }),
    ok: t.boolean({
      nullable: true,
      description: 'null: no check in this slot.',
      resolve: (b) => b.ok,
    }),
    latencyMs: t.int({ nullable: true, resolve: (b) => b.latencyMs }),
  }),
})

const EndpointRef = builder
  .objectRef<EndpointSummary>('ApiEndpoint')
  .implement({
    fields: (t) => ({
      name: t.string({ resolve: (e) => e.target.name }),
      kind: t.string({ resolve: (e) => e.target.kind }),
      path: t.string({ resolve: (e) => e.target.path }),
      checked: t.boolean({
        description: 'false until the first check lands.',
        resolve: (e) => e.last !== null,
      }),
      ok: t.boolean({ resolve: (e) => e.last?.ok ?? false }),
      status: t.int({ nullable: true, resolve: (e) => e.last?.status ?? null }),
      latencyMs: t.int({
        nullable: true,
        resolve: (e) => e.last?.latencyMs ?? null,
      }),
      checkedAt: t.string({
        nullable: true,
        resolve: (e) => (e.last ? iso(e.last.atMs) : null),
      }),
      lastError: t.string({
        nullable: true,
        resolve: (e) => e.lastError?.error ?? null,
      }),
      lastErrorAt: t.string({
        nullable: true,
        resolve: (e) => (e.lastError ? iso(e.lastError.atMs) : null),
      }),
      uptime: t.float({
        nullable: true,
        description: '% of healthy checks in the last 24 h.',
        resolve: (e) => e.uptime,
      }),
      avgLatencyMs: t.int({
        nullable: true,
        resolve: (e) => e.avgLatencyMs,
      }),
      series: t.field({ type: [BucketRef], resolve: (e) => e.series }),
    }),
  })

const StatusRef = builder
  .objectRef<{ intervalSeconds: number; endpoints: EndpointSummary[] }>(
    'ApiStatus',
  )
  .implement({
    fields: (t) => ({
      intervalSeconds: t.exposeInt('intervalSeconds'),
      endpoints: t.field({ type: [EndpointRef], resolve: (s) => s.endpoints }),
    }),
  })

builder.queryFields((t) => ({
  apiStatus: t.field({
    type: StatusRef,
    resolve: (_root, _args, ctx) => ({
      intervalSeconds: INTERVAL_MS / 1000,
      endpoints: readStatus(ctx),
    }),
  }),
}))
