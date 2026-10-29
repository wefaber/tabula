// The chip groups of the preferences, shared by the header dialog and the first-use tour.
import { Chip } from '@wefaber/ui'
import {
  Contrast as ContrastIcon,
  Languages,
  Monitor,
  Moon,
  Palette,
  Sun,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useT, type Key } from '@/lib/i18n'
import type { Contrast, Language, Prefs, Scale, Theme } from '@/lib/prefs'

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
]
const THEMES: { value: Theme; label: Key; icon: LucideIcon }[] = [
  { value: 'dark', label: 'theme.dark', icon: Moon },
  { value: 'light', label: 'theme.light', icon: Sun },
  { value: 'system', label: 'theme.system', icon: Monitor },
]
const SCALES: Scale[] = [90, 100, 115, 130]
const CONTRASTS: { value: Contrast; label: Key }[] = [
  { value: 'normal', label: 'contrast.normal' },
  { value: 'high', label: 'contrast.high' },
]

interface Props {
  prefs: Prefs
  choose: (patch: Partial<Prefs>) => void
}

function Group({
  legend,
  icon: Icon,
  children,
}: {
  legend: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 flex items-center gap-1.5 text-meta text-muted">
        <Icon aria-hidden className="size-4" />
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

export function LanguageGroup({ prefs, choose }: Props) {
  const t = useT()
  return (
    <Group legend={t('prefs.language')} icon={Languages}>
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
  )
}

export function ThemeGroup({ prefs, choose }: Props) {
  const t = useT()
  return (
    <Group legend={t('prefs.theme')} icon={Palette}>
      {THEMES.map(({ value, label, icon: Icon }) => (
        <Chip
          key={value}
          selected={prefs.theme === value}
          onClick={() => choose({ theme: value })}
        >
          <Icon aria-hidden className="mr-1.5 size-4" />
          {t(label)}
        </Chip>
      ))}
    </Group>
  )
}

export function ScaleGroup({ prefs, choose }: Props) {
  const t = useT()
  return (
    <Group legend={t('prefs.scale')} icon={Type}>
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
  )
}

export function ContrastGroup({ prefs, choose }: Props) {
  const t = useT()
  return (
    <Group legend={t('prefs.contrast')} icon={ContrastIcon}>
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
  )
}
