import { useQuery } from '@tanstack/react-query'
import {
  BackToTop,
  Button,
  Chip,
  Popover,
  SectionTransition,
} from '@wefaber/ui'
import { AlertTriangle, LogOut } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { SECTIONS } from '@/features/registry'
import { ApiError, gql } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Loader } from './Loader'
import { Login } from './Login'
import { PreferencesButton } from './Preferences'
import { Onboarding } from './Onboarding'
import { SectionBoundary } from './SectionBoundary'
import { Shortcuts } from './Shortcuts'

interface Session {
  me: { login: string; name: string; role: string }
  authMethod: string
  system: {
    ok: boolean
    db: boolean
    podman: boolean
    fixtures: boolean
    version: string
    problems: { module: string; detail: string }[]
  }
}

const SESSION = /* GraphQL */ `
  query Session {
    me {
      login
      name
      role
    }
    authMethod
    system {
      ok
      db
      podman
      fixtures
      version
      problems {
        module
        detail
      }
    }
  }
`

function sectionFromHash(): string {
  // `#ether?s=<token>` opens a section with a parameter; only the part before `?` names the section.
  const id = window.location.hash.slice(1).split('?')[0] ?? ''
  return SECTIONS.some((s) => s.id === id) ? id : (SECTIONS[0]?.id ?? '')
}

export default function App() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => gql<Session>(SESSION),
    refetchInterval: 30_000,
    retry: false,
  })
  const [active, setActive] = useState(sectionFromHash)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const t = useT()

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (session.isPending) return <Loader />
  if (
    session.error instanceof ApiError &&
    session.error.code === 'UNAUTHENTICATED'
  )
    return <Login />
  if (session.error) {
    return (
      <p role="alert" className="p-6 text-danger">
        {t('shell.sessionError', { error: session.error.message })}{' '}
        <button className="underline" onClick={() => session.refetch()}>
          {t('common.retry')}
        </button>
      </p>
    )
  }

  const { me, system } = session.data
  const section = SECTIONS.find((s) => s.id === active)
  const Current = section?.component

  return (
    <div className="mx-auto flex min-h-svh max-w-[1800px] flex-col gap-4 p-4">
      <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-3 bg-bg/90 px-4 py-2 backdrop-blur">
        <h1 className="font-display text-h3 font-semibold">Tabula</h1>
        <nav
          aria-label={t('shell.sections')}
          className="flex flex-wrap gap-1"
          role="tablist"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <Chip
              key={id}
              role="tab"
              selected={id === active}
              onClick={() => {
                window.location.hash = id
              }}
            >
              <Icon aria-hidden className="mr-1.5 size-4" />
              {label}
            </Chip>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-meta text-muted">
          {system.problems.length > 0 ? (
            <Popover
              open={problemsOpen}
              onOpenChange={setProblemsOpen}
              label={t('shell.problems.label')}
              trigger={(props) => (
                <Button variant="ghost" className="text-warning" {...props}>
                  <AlertTriangle aria-hidden className="size-4" />
                  {system.problems.length === 1
                    ? t('shell.problems.one')
                    : t('shell.problems.many', { n: system.problems.length })}
                </Button>
              )}
            >
              <ul className="flex w-72 flex-col gap-2 p-3">
                {system.problems.map((p) => (
                  <li key={`${p.module}:${p.detail}`}>
                    <strong className="font-semibold text-text">
                      {p.module}
                    </strong>
                    <br />
                    <span>{p.detail}</span>
                  </li>
                ))}
              </ul>
            </Popover>
          ) : (
            <span className="text-success">{t('shell.ok')}</span>
          )}
          {system.fixtures ? <span>{t('shell.fixtures')}</span> : null}
          <span>{me.name}</span>
          <PreferencesButton />
          <Button
            variant="secondary"
            onClick={async () => {
              await fetch('/auth/logout', { method: 'POST' })
              window.location.reload()
            }}
          >
            <LogOut aria-hidden className="size-4" />
            {t('shell.logout')}
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <div className="my-auto w-full">
          <SectionTransition id={active}>
            <SectionBoundary
              key={active}
              module={section?.label ?? 'La sección'}
            >
              <Suspense fallback={<Loader />}>
                {Current ? <Current /> : null}
              </Suspense>
            </SectionBoundary>
          </SectionTransition>
        </div>
      </main>
      <footer className="flex justify-end text-meta text-muted">
        <span className="tabular">v{system.version}</span>
      </footer>
      <Shortcuts active={active} />
      <Onboarding />
      <BackToTop />
    </div>
  )
}
