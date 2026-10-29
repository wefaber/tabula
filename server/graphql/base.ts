// Base fields: who am I, panel health, my tokens, the audit log.
import { createToken, revokeToken } from '../auth'
import { audit, listAudit, type AuditEntry } from '../audit'
import { readiness, type Readiness } from '../ready'
import { builder, fail } from './builder'
import { clampPage } from './limits'
import type { User } from '../auth'

const UserRef = builder.objectRef<User>('User').implement({
  fields: (t) => ({
    login: t.exposeString('login'),
    name: t.exposeString('name'),
    role: t.exposeString('role'),
  }),
})

const SystemRef = builder.objectRef<Readiness>('System').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    db: t.exposeBoolean('db'),
    migrations: t.exposeInt('migrations'),
    podman: t.exposeBoolean('podman'),
    fixtures: t.exposeBoolean('fixtures'),
    version: t.exposeString('version'),
  }),
})

interface TokenRow {
  id: number
  label: string
  userLogin: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const TokenRef = builder.objectRef<TokenRow>('Token').implement({
  fields: (t) => ({
    id: t.exposeInt('id'),
    label: t.exposeString('label'),
    userLogin: t.exposeString('userLogin'),
    createdAt: t.exposeString('createdAt'),
    lastUsedAt: t.exposeString('lastUsedAt', { nullable: true }),
    revokedAt: t.exposeString('revokedAt', { nullable: true }),
  }),
})

const AuditRef = builder.objectRef<AuditEntry>('AuditEntry').implement({
  fields: (t) => ({
    id: t.exposeInt('id'),
    at: t.exposeString('at'),
    userLogin: t.exposeString('userLogin'),
    action: t.exposeString('action'),
    target: t.exposeString('target'),
    detail: t.exposeString('detail'),
    ok: t.exposeBoolean('ok'),
  }),
})

const CreatedTokenRef = builder
  .objectRef<{ id: number; token: string }>('CreatedToken')
  .implement({
    fields: (t) => ({
      id: t.exposeInt('id'),
      token: t.exposeString('token', {
        description: 'Plain token. Shown once; only its sha256 is stored.',
      }),
    }),
  })

builder.queryFields((t) => ({
  me: t.field({
    type: UserRef,
    resolve: (_root, _args, ctx) => ctx.user,
  }),
  authMethod: t.string({ resolve: (_root, _args, ctx) => ctx.method }),
  system: t.field({
    type: SystemRef,
    resolve: (_root, _args, ctx) => readiness(ctx),
  }),
  tokens: t.field({
    type: [TokenRef],
    description: 'Own tokens; an admin sees everyone’s.',
    resolve: (_root, _args, ctx) =>
      ctx.db
        .query<TokenRow, [number, number]>(
          `SELECT t.id, t.label, u.login AS userLogin, t.created_at AS createdAt, t.last_used_at AS lastUsedAt,
                  t.revoked_at AS revokedAt
           FROM tokens t JOIN users u ON u.id = t.user_id
           WHERE t.user_id = ? OR ? = 1 ORDER BY t.id DESC`,
        )
        .all(ctx.user.id, ctx.user.role === 'admin' ? 1 : 0),
  }),
  audit: t.field({
    type: [AuditRef],
    args: { limit: t.arg.int(), action: t.arg.string() },
    resolve: (_root, args, ctx) =>
      listAudit(ctx.db, clampPage(args.limit), args.action ?? undefined),
  }),
}))

builder.mutationFields((t) => ({
  createToken: t.field({
    type: CreatedTokenRef,
    args: { label: t.arg.string({ required: true }) },
    resolve: (_root, { label }, ctx) => {
      if (label.trim().length > 60)
        fail(
          'BAD_INPUT',
          'El nombre del token tiene que tener hasta 60 caracteres.',
        )
      const created = createToken(ctx.db, ctx.user.id, label)
      audit(ctx.db, ctx.user, 'token.create', String(created.id), { label })
      return created
    },
  }),
  revokeToken: t.boolean({
    args: { id: t.arg.int({ required: true }) },
    resolve: (_root, { id }, ctx) => {
      const ok = revokeToken(ctx.db, id, ctx.user)
      if (!ok) fail('NOT_FOUND', 'No encontré ese token, o ya estaba revocado.')
      audit(ctx.db, ctx.user, 'token.revoke', String(id))
      return true
    },
  }),
}))
