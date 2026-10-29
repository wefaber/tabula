// Ask Ether GraphQL: threads and messages of the caller, the live run, and the ask/approve/stop mutations.
// Approving is admin-only. A run's events are on the bus channel `ether-<runId>`, not in these responses.
import type { ToolStep } from '../../../shared/ether'
import type {
  MessageSources,
  RefData,
  SourceContainer,
  SourceError,
} from '../../../shared/etherRefs'
import { builder, fail, requireAdmin } from '../../graphql/builder'
import { audit } from '../../audit'
import {
  THREAD_SLUG,
  createShare,
  getShare,
  listMessages,
  listThreads,
  revokeShare,
  type MessageRow,
  type SharedAnswer,
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
    shareToken: t.exposeString('shareToken', { nullable: true }),
    sources: t.field({
      type: SourcesRef,
      nullable: true,
      description:
        'Qué miró Ether para esta respuesta. Null en preguntas y respuestas anteriores.',
      resolve: (m) => m.sources,
    }),
  }),
})

const SharedRef = builder
  .objectRef<SharedAnswer>('EtherSharedAnswer')
  .implement({
    fields: (t) => ({
      question: t.exposeString('question', { nullable: true }),
      answer: t.exposeString('answer'),
      sharedBy: t.exposeString('sharedBy'),
      sharedAt: t.exposeString('sharedAt'),
    }),
  })

const ToolStepRef = builder.objectRef<ToolStep>('EtherToolStep').implement({
  fields: (t) => ({
    tool: t.exposeString('tool'),
    preview: t.exposeString('preview'),
  }),
})

const SourceContainerRef = builder
  .objectRef<SourceContainer>('EtherSourceContainer')
  .implement({
    fields: (t) => ({
      service: t.exposeString('service'),
      state: t.exposeString('state'),
      health: t.exposeString('health'),
      image: t.exposeString('image'),
    }),
  })

const SourceErrorRef = builder
  .objectRef<SourceError>('EtherSourceError')
  .implement({
    fields: (t) => ({
      at: t.exposeString('at'),
      what: t.exposeString('what'),
    }),
  })

const SourceRefRef = builder.objectRef<RefData>('EtherSourceRef').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    id: t.exposeString('id'),
    title: t.exposeString('title'),
    facts: t.exposeStringList('facts'),
  }),
})

const SourcesRef = builder.objectRef<MessageSources>('EtherSources').implement({
  fields: (t) => ({
    at: t.exposeString('at'),
    activeTag: t.exposeString('activeTag', { nullable: true }),
    containers: t.field({
      type: [SourceContainerRef],
      resolve: (s) => s.containers,
    }),
    errors: t.field({ type: [SourceErrorRef], resolve: (s) => s.errors }),
    tools: t.field({ type: [ToolStepRef], resolve: (s) => s.tools }),
    refs: t.field({ type: [SourceRefRef], resolve: (s) => s.refs }),
  }),
})

interface RunView {
  runId: string
  /** Secret channel key for SSE; only handed to the run's owner and to admins. */
  streamKey: string
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
    streamKey: t.exposeString('streamKey'),
    phase: t.exposeString('phase'),
    text: t.exposeString('text'),
    tools: t.field({ type: [ToolStepRef], resolve: (r) => r.tools }),
    approval: t.exposeString('approval', { nullable: true }),
    error: t.exposeString('error', { nullable: true }),
    seq: t.exposeInt('seq'),
  }),
})

const AskRef = builder
  .objectRef<{ runId: string; streamKey: string }>('EtherAsk')
  .implement({
    fields: (t) => ({
      runId: t.exposeString('runId'),
      streamKey: t.exposeString('streamKey', {
        description:
          'Clave secreta del canal SSE: solo la recibe quien pregunta.',
      }),
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
        streamKey: run.streamKey,
        phase: run.state.phase,
        text: run.state.text,
        tools: run.state.tools,
        approval: isAdmin ? run.state.approval : null,
        error: run.state.error,
        seq: run.seq,
      }
    },
  }),
  etherShared: t.field({
    type: SharedRef,
    nullable: true,
    description:
      'Respuesta compartida por un link. Solo lectura; cualquier usuario logueado la puede abrir.',
    args: { token: t.arg.string({ required: true }) },
    resolve: (_root, { token }, ctx) => getShare(ctx.db, token),
  }),
  etherHealth: t.field({
    type: HealthRef,
    description:
      'Si Ether responde. Se consulta al abrir la sección y al reintentar.',
    resolve: (_root, _args, ctx) => runsFor(ctx).client.ping(),
  }),
}))

builder.mutationFields((t) => ({
  askEther: t.field({
    type: AskRef,
    description:
      'Arranca una consulta a Ether en el hilo dado. Devuelve el runId; los eventos llegan por SSE.',
    args: {
      thread: t.arg.string({ required: true }),
      question: t.arg.string({ required: true }),
      refs: t.arg.stringList({
        description:
          'Referencias de la pregunta: `@container:back`, `@api:login`, `@call:<id>`. Hasta 5; se validan contra datos reales.',
      }),
    },
    resolve: (_root, { thread, question, refs }, ctx) =>
      runsFor(ctx).ask(ctx.user, thread, question, refs),
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
  etherShare: t.string({
    description:
      'Comparte una respuesta terminada de tu hilo. Devuelve el token del link.',
    args: { messageId: t.arg.int({ required: true }) },
    resolve: (_root, { messageId }, ctx) => {
      const token = createShare(ctx.db, ctx.user.id, messageId, new Date())
      if (!token)
        fail('NOT_FOUND', 'No encontré esa respuesta, o todavía no terminó.')
      audit(ctx.db, ctx.user, 'ether.share', String(messageId))
      return token
    },
  }),
  etherUnshare: t.boolean({
    args: { token: t.arg.string({ required: true }) },
    resolve: (_root, { token }, ctx) => {
      if (!revokeShare(ctx.db, ctx.user, token, new Date()))
        fail('NOT_FOUND', 'No encontré ese link, o ya no estaba compartido.')
      audit(ctx.db, ctx.user, 'ether.unshare', '')
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
