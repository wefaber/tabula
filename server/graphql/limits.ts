// House public-API limits: depth 8 (introspection not counted), query text 4000 chars, page size 1..100.
import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql'
import type { Plugin } from 'graphql-yoga'

export const MAX_DEPTH = 8
export const MAX_QUERY_LENGTH = 4000

export function clampPage(
  size: number | null | undefined,
  fallback = 50,
): number {
  return Math.min(100, Math.max(1, Math.trunc(size ?? fallback)))
}

function depthOf(
  set: SelectionSetNode | undefined,
  ctx: ValidationContext,
  seen: Set<string>,
): number {
  if (!set) return 0
  let max = 0
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      if (sel.name.value.startsWith('__')) continue
      max = Math.max(
        max,
        sel.selectionSet ? 1 + depthOf(sel.selectionSet, ctx, seen) : 1,
      )
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(sel.selectionSet, ctx, seen))
    } else if (sel.kind === Kind.FRAGMENT_SPREAD && !seen.has(sel.name.value)) {
      const frag = ctx.getFragment(sel.name.value)
      if (frag)
        max = Math.max(
          max,
          depthOf(frag.selectionSet, ctx, new Set([...seen, sel.name.value])),
        )
    }
  }
  return max
}

export function depthLimit(max = MAX_DEPTH) {
  return (ctx: ValidationContext): ASTVisitor => ({
    OperationDefinition(node) {
      const depth = depthOf(node.selectionSet, ctx, new Set())
      if (depth > max)
        ctx.reportError(
          new GraphQLError(
            `La consulta es demasiado profunda (${depth} > ${max}).`,
            { extensions: { code: 'QUERY_TOO_DEEP' } },
          ),
        )
    },
  })
}

export function useLimits(): Plugin {
  return {
    onParams({ params }) {
      if ((params.query?.length ?? 0) > MAX_QUERY_LENGTH) {
        throw new GraphQLError('La consulta es demasiado larga.', {
          extensions: { code: 'QUERY_TOO_LONG', http: { status: 400 } },
        })
      }
    },
    onValidate({ addValidationRule }) {
      addValidationRule(depthLimit())
    },
  }
}
