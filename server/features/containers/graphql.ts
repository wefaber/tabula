// GraphQL fields of containers: the stack's state, recent logs and the power mutation.
import { audit } from '../../audit'
import type { Ctx } from '../../deps'
import { builder, fail } from '../../graphql/builder'
import { log } from '../../log'
import {
  isService,
  planPower,
  PowerError,
  SERVICES,
  type ContainerRow,
  type PowerAction,
  type Service,
} from './domain'
import { publishState, snapshot } from './monitor'
import { executePower } from './power'

const ContainerRef = builder.objectRef<ContainerRow>('Container').implement({
  fields: (t) => ({
    service: t.exposeString('service'),
    id: t.exposeString('id'),
    name: t.exposeString('name'),
    state: t.exposeString('state'),
    health: t.exposeString('health', {
      description:
        '`healthy`, `unhealthy`, `starting` or empty without healthcheck.',
    }),
    image: t.exposeString('image'),
    tag: t.exposeString('tag'),
    startedAt: t.exposeString('startedAt', { nullable: true }),
    uptimeSeconds: t.exposeInt('uptimeSeconds', { nullable: true }),
    cpuPercent: t.exposeFloat('cpuPercent', { nullable: true }),
    memBytes: t.exposeFloat('memBytes', { nullable: true }),
    memLimitBytes: t.exposeFloat('memLimitBytes', { nullable: true }),
  }),
})

const LogLineRef = builder
  .objectRef<{ stream: string; text: string }>('ContainerLogLine')
  .implement({
    fields: (t) => ({
      stream: t.exposeString('stream'),
      text: t.exposeString('text'),
    }),
  })

const PowerActionEnum = builder.enumType('PowerAction', {
  values: ['up', 'down', 'restart'] as const,
})
const ServiceEnum = builder.enumType('ServiceName', {
  values: SERVICES,
})

/** Power actions run one at a time per panel process (blue and green never run together for long). */
const running = new WeakSet<object>()

async function podmanRows(ctx: Ctx): Promise<ContainerRow[]> {
  try {
    return await snapshot(ctx)
  } catch (error) {
    log.warn('containers query failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return fail(
      'PODMAN_UNAVAILABLE',
      'No pude hablar con Podman. Revisá que el socket rootless esté activo.',
    )
  }
}

async function deployInProgress(ctx: Ctx): Promise<boolean> {
  try {
    return await ctx.github.deployInProgress()
  } catch (error) {
    // GitHub down must not lock the panel out of its recovery tool.
    log.warn('deploy check failed, allowing power action', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function power(
  ctx: Ctx,
  action: PowerAction,
  service: Service | null,
): Promise<ContainerRow[]> {
  const auditAction = `power.${action}`
  const target = service ?? 'stack'
  const started = Date.now()

  if (await deployInProgress(ctx)) {
    audit(ctx.db, ctx.user, auditAction, target, { blocked: 'deploy' }, false)
    fail(
      'DEPLOY_IN_PROGRESS',
      'Hay un deploy de Gravida en curso. Esperá a que termine para tocar la energía.',
    )
  }
  if (running.has(ctx.bus))
    fail(
      'POWER_BUSY',
      'Ya hay una acción de energía en curso. Esperá a que termine.',
    )

  running.add(ctx.bus)
  try {
    const rows = await podmanRows(ctx)
    const steps = planPower(action, service, rows)
    try {
      await executePower(ctx, steps, undefined, () =>
        publishState(ctx, true).then(() => {}),
      )
    } catch (error) {
      audit(
        ctx.db,
        ctx.user,
        auditAction,
        target,
        {
          steps,
          error: error instanceof Error ? error.message : String(error),
          ms: Date.now() - started,
        },
        false,
      )
      throw error
    }
    audit(ctx.db, ctx.user, auditAction, target, {
      steps,
      ms: Date.now() - started,
    })
    return await publishState(ctx, true)
  } catch (error) {
    if (error instanceof PowerError) fail(error.code, error.message)
    throw error
  } finally {
    running.delete(ctx.bus)
  }
}

builder.queryFields((t) => ({
  containers: t.field({
    type: [ContainerRef],
    description:
      'Containers of the nexus project; empty when it was never brought up.',
    resolve: (_root, _args, ctx) => podmanRows(ctx),
  }),
  containerLogs: t.field({
    type: [LogLineRef],
    args: {
      service: t.arg({ type: ServiceEnum, required: true }),
      tail: t.arg.int(),
    },
    resolve: async (_root, args, ctx) => {
      if (!isService(args.service)) fail('BAD_INPUT', 'Servicio inválido.')
      const found = (await podmanRows(ctx)).find(
        (r) => r.service === args.service,
      )
      if (!found) fail('NOT_FOUND', 'Ese servicio no tiene container.')
      const out: { stream: string; text: string }[] = []
      for await (const line of ctx.podman.logs(found.id, {
        tail: Math.min(500, Math.max(1, Math.trunc(args.tail ?? 200))),
      }))
        out.push(line)
      return out
    },
  }),
}))

builder.mutationFields((t) => ({
  power: t.field({
    type: [ContainerRef],
    description:
      'Encender (db→back→front, espera health y /login.php), apagar (orden inverso) o reiniciar el stack o un servicio.',
    args: {
      action: t.arg({ type: PowerActionEnum, required: true }),
      service: t.arg({ type: ServiceEnum }),
    },
    resolve: (_root, args, ctx) =>
      power(ctx, args.action, args.service ?? null),
  }),
}))
