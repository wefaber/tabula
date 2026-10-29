import { useQuery } from '@tanstack/react-query'
import { BackToTop, Chip, SectionTransition } from '@wefaber/ui'
import { Suspense, useEffect, useState } from 'react'
import { SECTIONS } from '@/features/registry'
import { ApiError, gql } from '@/lib/api'
import { Login } from './Login'

interface Session {
  me: { login: string; name: string; role: string }
  authMethod: string
  system: {
    ok: boolean
    db: boolean
    podman: boolean
    fixtures: boolean
    version: string
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
    }
  }
`

function sectionFromHash(): string {
  const id = window.location.hash.slice(1)
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

  useEffect(() => {
    const onHash = () => setActive(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (session.isPending) return <p className="p-6 text-muted">Cargando…</p>
  if (
    session.error instanceof ApiError &&
    session.error.code === 'UNAUTHENTICATED'
  )
    return <Login />
  if (session.error) {
    return (
      <p role="alert" className="p-6 text-danger">
        No se pudo conectar con el panel ({session.error.message}).{' '}
        <button className="underline" onClick={() => session.refetch()}>
          Reintentar
        </button>
      </p>
    )
  }

  const { me, system } = session.data
  const Current = SECTIONS.find((s) => s.id === active)?.component

  return (
    <div className="mx-auto flex min-h-svh max-w-[1800px] flex-col gap-4 p-4">
      <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-3 bg-bg/90 px-4 py-2 backdrop-blur">
        <h1 className="font-display text-h3 font-semibold">Tabula</h1>
        <nav
          aria-label="Secciones"
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
          <span
            className={system.ok ? 'text-success' : 'text-warning'}
            title={`DB ${system.db ? 'ok' : 'sin respuesta'} · Podman ${system.podman ? 'ok' : 'sin respuesta'}`}
          >
            {system.ok ? 'Panel ok' : 'Panel con fallas'}
          </span>
          {system.fixtures ? <span>datos de prueba</span> : null}
          <span className="tabular">v{system.version}</span>
          <span>{me.name}</span>
          <button
            className="underline"
            onClick={async () => {
              await fetch('/auth/logout', { method: 'POST' })
              window.location.reload()
            }}
          >
            Salir
          </button>
        </div>
      </header>

      <main className="flex-1">
        <SectionTransition id={active}>
          <Suspense fallback={<p className="text-muted">Cargando…</p>}>
            {Current ? <Current /> : null}
          </Suspense>
        </SectionTransition>
      </main>
      <BackToTop />
    </div>
  )
}
