// Ask Ether GraphQL: threads and messages of the caller, the live run, and the ask/approve/stop mutations.
// Approving is admin-only. A run's events are on the bus channel `ether-<runId>`, not in these responses.
import type { ToolStep } from '../../../shared/ether'
import { builder, fail, requireAdmin } from '../../graphql/builder'
import {
  THREAD_SLUG,
  listMessages,
  listThreads,
  type MessageRow,
  type ThreadRow,
} from './store'
import { runsFor } from './runner'

const ThreadRef = builder.objectRef<ThreadRow>('EtherThread').implement({
  fields: (t) => ({
    slug: t.exposeString('slug'),
    title: t.exposeString('title'),
    updatedAt: t.exposeString('updatedAt'),
  }),
})

const MessageRef = builder.objectRef<MessageRow>('EtherMessage').implement({
  fields: (t) => ({
    id: t.exposeInt('id'),
    role: t.exposeString('role'),
    body: t.exposeString('body'),
    status: t.exposeString('status'),
    runId: t.exposeString('runId', { nullable: true }),
    createdAt: t.exposeString('createdAt'),
  }),
})

const ToolStepRef = builder.objectRef<ToolStep>('EtherToolStep').implement({
  fields: (t) => ({
    tool: t.exposeString('tool'),
    preview: t.exposeString('preview'),
  }),
})

interface RunView {
  runId: string
  phase: string
  text: string
  tools: ToolStep[]
  /** Only for admins: members never see what Ether is asking to run. */
  approval: string | null
  error: string | null
  /** Last event number; a client that loaded this view ignores bus events with seq <= this. */
  seq: number
}

const RunRef = builder.objectRef<RunView>('EtherRun').implement({
  fields: (t) => ({
    runId: t.exposeString('runId'),
    phase: t.exposeString('phase'),
    text: t.exposeString('text'),
    tools: t.field({ type: [ToolStepRef], resolve: (r) => r.tools }),
    approval: t.exposeString('approval', { nullable: true }),
    error: t.exposeString('error', { nullable: true }),
    seq: t.exposeInt('seq'),
  }),
})

const HealthRef = builder
  .objectRef<{ ok: boolean; reason: string }>('EtherHealth')
  .implement({
    fields: (t) => ({
      ok: t.exposeBoolean('ok'),
      reason: t.exposeString('reason'),
    }),
  })

builder.queryFields((t) => ({
  etherThreads: t.field({
    type: [ThreadRef],
    description: 'Hilos del usuario, más reciente primero.',
    resolve: (_root, _args, ctx) => listThreads(ctx.db, ctx.user.id),
  }),
  etherMessages: t.field({
    type: [MessageRef],
    args: { thread: t.arg.string({ required: true }) },
    resolve: (_root, { thread }, ctx) =>
      THREAD_SLUG.test(thread) ? listMessages(ctx.db, ctx.user.id, thread) : [],
  }),
  etherRun: t.field({
    type: RunRef,
    nullable: true,
    description:
      'Estado de una consulta en curso (para retomar la vista al recargar).',
    args: { runId: t.arg.string({ required: true }) },
    resolve: (_root, { runId }, ctx) => {
      const run = runsFor(ctx).get(runId)
      if (!run || (run.userId !== ctx.user.id && ctx.user.role !== 'admin'))
        return null
      const isAdmin = ctx.user.role === 'admin'
      return {
        runId,
        phase: run.state.phase,
        text: run.state.text,
        tools: run.state.tools,
        approval: isAdmin ? run.state.approval : null,
        error: run.state.error,
        seq: run.seq,
      }
    },
  }),
  etherHealth: t.field({
    type: HealthRef,
    description:
      'Si Ether responde. Se consulta al abrir la sección y al reintentar.',
    resolve: (_root, _args, ctx) => runsFor(ctx).client.ping(),
  }),
}))

builder.mutationFields((t) => ({
  askEther: t.string({
    description:
      'Arranca una consulta a Ether en el hilo dado. Devuelve el runId; los eventos llegan por SSE.',
    args: {
      thread: t.arg.string({ required: true }),
      question: t.arg.string({ required: true }),
    },
    resolve: (_root, { thread, question }, ctx) =>
      runsFor(ctx).ask(ctx.user, thread, question),
  }),
  etherApprove: t.boolean({
    description: 'Aprueba (o rechaza) una acción que Ether pidió. Solo admin.',
    args: {
      runId: t.arg.string({ required: true }),
      deny: t.arg.boolean({ defaultValue: false }),
    },
    resolve: async (_root, { runId, deny }, ctx) => {
      requireAdmin(ctx)
      await runsFor(ctx).approve(ctx.user, runId, deny ?? false)
      return true
    },
  }),
  etherStop: t.boolean({
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_root, { runId }, ctx) => {
      if (!runsFor(ctx).get(runId))
        fail('NOT_FOUND', 'No encontré esa consulta, o ya terminó.')
      await runsFor(ctx).stop(ctx.user, runId)
      return true
    },
  }),
}))
