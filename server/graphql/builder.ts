// The one Pothos builder. Feature folders import it and add their fields with `builder.queryField` /
// `builder.mutationField` from their own `graphql.ts`, so no feature edits another one's file.
import SchemaBuilder from '@pothos/core'
import { GraphQLError } from 'graphql'
import type { Ctx } from '../deps'

export const builder = new SchemaBuilder<{
  Context: Ctx
  DefaultFieldNullability: false
  Scalars: { JSON: { Input: unknown; Output: unknown } }
}>({ defaultFieldNullability: false })

builder.scalarType('JSON', {
  serialize: (value) => value,
  parseValue: (value) => value,
})

builder.queryType({})
builder.mutationType({})

/** Expected failures carry a stable code; anything else is masked by Yoga. */
export function fail(code: string, message: string, details?: unknown): never {
  throw new GraphQLError(message, {
    extensions: { code, ...(details === undefined ? {} : { details }) },
  })
}

export function requireAdmin(ctx: Ctx): void {
  if (ctx.user.role !== 'admin')
    fail('FORBIDDEN', 'Solo un admin puede hacer esto.')
}
