// onboarding (is my tour done?) and completeOnboarding (mark it done for me). Each user only ever touches their own row.
import { audit } from '../../audit'
import { builder } from '../../graphql/builder'
import { completeOnboarding, hasCompletedOnboarding } from './store'

builder.queryFields((t) => ({
  onboarding: t.boolean({
    description:
      'True once the current user has finished or closed the first-use tour.',
    resolve: (_root, _args, ctx) => hasCompletedOnboarding(ctx.db, ctx.user.id),
  }),
}))

builder.mutationFields((t) => ({
  completeOnboarding: t.boolean({
    resolve: (_root, _args, ctx) => {
      completeOnboarding(ctx.db, ctx.user.id)
      audit(ctx.db, ctx.user, 'onboarding.complete', String(ctx.user.id))
      return true
    },
  }),
}))
