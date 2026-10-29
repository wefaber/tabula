// recentCalls(limit, status, path): newest first, with how many stored calls match the filters.
import { builder, fail } from '../../graphql/builder'
import { clampPage } from '../../graphql/limits'
import { parseStatusFilter, statusRange } from './domain'
import type { StoredCall } from './follow'

const CallRef = builder.objectRef<StoredCall>('Call').implement({
  fields: (t) => ({
    id: t.exposeInt('id'),
    at: t.string({ resolve: (c) => new Date(c.atMs).toISOString() }),
    method: t.exposeString('method'),
    path: t.exposeString('path'),
    status: t.exposeInt('status'),
    bytes: t.exposeInt('bytes'),
  }),
})

const CallsRef = builder
  .objectRef<{ total: number; items: StoredCall[] }>('CallsPage')
  .implement({
    fields: (t) => ({
      total: t.exposeInt('total', {
        description: 'Stored calls that match the filters (items is one page).',
      }),
      items: t.field({ type: [CallRef], resolve: (p) => p.items }),
    }),
  })

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

builder.queryFields((t) => ({
  recentCalls: t.field({
    type: CallsRef,
    args: {
      limit: t.arg.int(),
      status: t.arg.string({ description: '`2xx`..`5xx` or an exact code.' }),
      path: t.arg.string({ description: 'Substring of the path.' }),
    },
    resolve: (_root, args, ctx) => {
      const where: string[] = []
      const params: (string | number)[] = []
      if (args.status) {
        const filter = parseStatusFilter(args.status.trim())
        if (!filter)
          fail(
            'BAD_INPUT',
            'El estado tiene que ser 2xx, 3xx, 4xx, 5xx o un código como 404.',
          )
        const [from, to] = statusRange(filter)
        where.push('status BETWEEN ? AND ?')
        params.push(from, to)
      }
      const needle = args.path?.trim().slice(0, 100)
      if (needle) {
        where.push("path LIKE ? ESCAPE '\\'")
        params.push(`%${escapeLike(needle)}%`)
      }
      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : ''
      const total = ctx.db
        .query<{ n: number }, (string | number)[]>(
          `SELECT COUNT(*) AS n FROM calls_log${clause}`,
        )
        .get(...params)!.n
      const items = ctx.db
        .query<
          {
            id: number
            atMs: number
            method: string
            path: string
            status: number
            bytes: number
          },
          (string | number)[]
        >(
          `SELECT id, at_ms AS atMs, method, path, status, bytes FROM calls_log${clause} ORDER BY id DESC LIMIT ?`,
        )
        .all(...params, clampPage(args.limit))
      return { total, items }
    },
  }),
}))
