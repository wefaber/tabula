// Preferences from the server with an optimistic local apply. Shared by the header dialog and the first-use tour.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gql } from '@/lib/api'
import { applyPrefs, readCache, type Prefs } from '@/lib/prefs'

const PREFS = /* GraphQL */ `
  query Prefs {
    prefs {
      language
      theme
      scale
      contrast
    }
  }
`
const SET_PREFS = /* GraphQL */ `
  mutation SetPrefs(
    $language: String
    $theme: String
    $scale: Int
    $contrast: String
  ) {
    setPrefs(
      language: $language
      theme: $theme
      scale: $scale
      contrast: $contrast
    ) {
      language
      theme
      scale
      contrast
    }
  }
`

export function usePrefs() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['prefs'],
    queryFn: () => gql<{ prefs: Prefs }>(PREFS).then((r) => r.prefs),
  })
  const save = useMutation({
    mutationFn: (patch: Partial<Prefs>) =>
      gql<{ setPrefs: Prefs }>(SET_PREFS, patch).then((r) => r.setPrefs),
    onSuccess: (saved) => qc.setQueryData(['prefs'], saved),
    onError: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
  })
  const prefs = query.data ?? readCache()

  /** Applies at once, then saves; a failed save reloads the stored values. */
  const choose = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    applyPrefs(next)
    qc.setQueryData(['prefs'], next)
    save.mutate(patch)
  }

  return { prefs, server: query.data, choose, saveFailed: save.isError }
}
