// First-use tour: welcome (what it is, language, theme), the sections, the utilities, with a progress bar.
// Opens by itself once per user; openOnboarding() reopens it (button in the shortcuts dialog).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, Kbd } from '@wefaber/ui'
import {
  Check,
  Compass,
  Keyboard,
  KeyRound,
  LayoutGrid,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { gql } from '@/lib/api'
import { useT, type Key, type T } from '@/lib/i18n'
import { usePrefs } from '@/lib/usePrefs'
import { SECTIONS } from '@/features/registry'
import { LanguageGroup, ThemeGroup } from './PrefsControls'
import { OPEN_ONBOARDING_EVENT } from './onboardingEvents'

const STATUS = /* GraphQL */ `
  query Onboarding {
    onboarding
  }
`
const COMPLETE = /* GraphQL */ `
  mutation {
    completeOnboarding
  }
`

type StepId = 'welcome' | 'sections' | 'ether' | 'keys' | 'access'

interface Step {
  id: StepId
  icon: LucideIcon
  title: Key
  desc: Key
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    icon: Compass,
    title: 'tour.welcome.title',
    desc: 'tour.welcome.desc',
  },
  {
    id: 'sections',
    icon: LayoutGrid,
    title: 'tour.sections.title',
    desc: 'tour.sections.desc',
  },
  {
    id: 'ether',
    icon: Sparkles,
    title: 'tour.ether.title',
    desc: 'tour.ether.desc',
  },
  {
    id: 'keys',
    icon: Keyboard,
    title: 'tour.keys.title',
    desc: 'tour.keys.desc',
  },
  {
    id: 'access',
    icon: KeyRound,
    title: 'tour.access.title',
    desc: 'tour.access.desc',
  },
]

const SECTION_COPY: Record<string, Key> = {
  containers: 'tour.section.containers',
  apis: 'tour.section.apis',
  calls: 'tour.section.calls',
  db: 'tour.section.db',
  git: 'tour.section.git',
  ether: 'tour.section.ether',
  access: 'tour.section.access',
}

function Points({ keys, t }: { keys: Key[]; t: T }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {keys.map((key) => (
        <li key={key} className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
            <Check aria-hidden className="size-3" />
          </span>
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  )
}

function Progress({ index, t }: { index: number; t: T }) {
  const percent = Math.round(((index + 1) / STEPS.length) * 100)
  const label = t('tour.step', { current: index + 1, total: STEPS.length })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-meta tracking-widest text-accent uppercase">
          {t('tour.title')}
        </span>
        <span className="tabular text-meta text-muted">{label}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('tour.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        className="h-1.5 overflow-hidden rounded-full bg-text/10"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-(--dur-layout) ease-standard motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function Welcome({ t }: { t: T }) {
  const { prefs, choose } = usePrefs()
  return (
    <>
      <Points
        keys={['tour.welcome.p1', 'tour.welcome.p2', 'tour.welcome.p3']}
        t={t}
      />
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-2 p-3">
        <LanguageGroup prefs={prefs} choose={choose} />
        <ThemeGroup prefs={prefs} choose={choose} />
        <p className="text-meta text-muted">{t('tour.welcome.prefs')}</p>
      </div>
    </>
  )
}

function Sections({ t }: { t: T }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <li
          key={id}
          className="flex items-start gap-2.5 rounded-card border border-border bg-surface-2 p-2.5"
        >
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          <span className="min-w-0">
            <strong className="block font-semibold">{label}</strong>
            <span className="text-meta text-muted">
              {SECTION_COPY[id] ? t(SECTION_COPY[id]) : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Shortcuts({ t }: { t: T }) {
  const rows: { keys: string[]; what: Key }[] = [
    { keys: ['1'], what: 'shortcuts.section' },
    { keys: ['[', ']'], what: 'shortcuts.nav' },
    { keys: ['?'], what: 'shortcuts.help' },
    { keys: ['Enter'], what: 'shortcuts.send' },
  ]
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(({ keys, what }) => (
        <li key={what} className="flex items-center justify-between gap-3">
          <span>{t(what)}</span>
          <span className="flex shrink-0 gap-1.5">
            {keys.map((k) => (
              <Kbd key={k} keys={k} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

function body(id: StepId, t: T): ReactNode {
  switch (id) {
    case 'welcome':
      return <Welcome t={t} />
    case 'sections':
      return <Sections t={t} />
    case 'ether':
      return (
        <Points
          keys={[
            'tour.ether.p1',
            'tour.ether.p2',
            'tour.ether.p3',
            'tour.ether.p4',
          ]}
          t={t}
        />
      )
    case 'keys':
      return <Shortcuts t={t} />
    case 'access':
      return (
        <Points
          keys={['tour.access.p1', 'tour.access.p2', 'tour.access.p3']}
          t={t}
        />
      )
  }
}

export function Onboarding() {
  const t = useT()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => gql<{ onboarding: boolean }>(STATUS),
  })
  const complete = useMutation({
    mutationFn: () => gql(COMPLETE),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  })
  // Opens by itself the first time (until completed); openOnboarding() forces it again. Closing dismisses it for this visit.
  const [forced, setForced] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [index, setIndex] = useState(0)
  const open = !dismissed && (forced || status.data?.onboarding === false)

  useEffect(() => {
    const reopen = () => {
      setDismissed(false)
      setForced(true)
      setIndex(0)
    }
    window.addEventListener(OPEN_ONBOARDING_EVENT, reopen)
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, reopen)
  }, [])

  const close = () => {
    setDismissed(true)
    setForced(false)
    complete.mutate()
  }

  const last = index === STEPS.length - 1
  const step = STEPS[index]!
  const Icon = step.icon

  return (
    <Dialog
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-control bg-accent/15 text-accent"
          >
            <Icon className="size-5" />
          </span>
          {t(step.title)}
        </span>
      }
      closeLabel={t('tour.close')}
    >
      <Progress index={index} t={t} />
      <div className="flex flex-col gap-4 text-body">
        <p className="text-muted" aria-live="polite">
          {t(step.desc)}
        </p>
        {body(step.id, t)}
      </div>
      <footer className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={close}>
          {t('tour.skip')}
        </Button>
        <div className="flex gap-2">
          {index > 0 ? (
            <Button variant="secondary" onClick={() => setIndex(index - 1)}>
              {t('tour.back')}
            </Button>
          ) : null}
          {last ? (
            <Button variant="primary" onClick={close}>
              {t('tour.finish')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIndex(index + 1)}>
              {t('tour.next')}
            </Button>
          )}
        </div>
      </footer>
    </Dialog>
  )
}
