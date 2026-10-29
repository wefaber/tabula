// Preferences: the gear in the header opens a dialog. Every change applies at once and is saved to the server.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Chip, Dialog, IconButton } from '@wefaber/ui'
import { Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { gql } from '@/lib/api'
import { useT, type Key } from '@/lib/i18n'
import {
  applyPrefs,
  readCache,
  type Contrast,
  type Language,
  type Prefs,
  type Scale,
  type Theme,
} from '@/lib/prefs'

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

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
]
const THEMES: { value: Theme; label: Key }[] = [
  { value: 'dark', label: 'theme.dark' },
  { value: 'light', label: 'theme.light' },
  { value: 'system', label: 'theme.system' },
]
const SCALES: Scale[] = [90, 100, 115, 130]
const CONTRASTS: { value: Contrast; label: Key }[] = [
  { value: 'normal', label: 'contrast.normal' },
  { value: 'high', label: 'contrast.high' },
]

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-meta text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

/** Header button and its dialog. Also loads the server copy on mount so every page view uses the saved prefs. */
export function PreferencesButton() {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
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

  useEffect(() => {
    if (query.data) applyPrefs(query.data)
  }, [query.data])

  const prefs = query.data ?? readCache()
  const choose = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    applyPrefs(next)
    qc.setQueryData(['prefs'], next)
    save.mutate(patch)
  }

  return (
    <>
      <IconButton
        label={t('prefs.open')}
        icon={<Settings aria-hidden size={18} />}
        onClick={() => setOpen(true)}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('prefs.title')}
        closeLabel={t('common.close')}
      >
        <Group legend={t('prefs.language')}>
          {LANGUAGES.map(({ value, label }) => (
            <Chip
              key={value}
              selected={prefs.language === value}
              onClick={() => choose({ language: value })}
            >
              {label}
            </Chip>
          ))}
        </Group>
        <Group legend={t('prefs.theme')}>
          {THEMES.map(({ value, label }) => (
            <Chip
              key={value}
              selected={prefs.theme === value}
              onClick={() => choose({ theme: value })}
            >
              {t(label)}
            </Chip>
          ))}
        </Group>
        <Group legend={t('prefs.scale')}>
          {SCALES.map((value) => (
            <Chip
              key={value}
              selected={prefs.scale === value}
              onClick={() => choose({ scale: value })}
            >
              {value}%
            </Chip>
          ))}
        </Group>
        <Group legend={t('prefs.contrast')}>
          {CONTRASTS.map(({ value, label }) => (
            <Chip
              key={value}
              selected={prefs.contrast === value}
              onClick={() => choose({ contrast: value })}
            >
              {t(label)}
            </Chip>
          ))}
        </Group>
        {save.isError ? (
          <p role="alert" className="text-danger">
            {t('prefs.saveError')}
          </p>
        ) : null}
      </Dialog>
    </>
  )
}
