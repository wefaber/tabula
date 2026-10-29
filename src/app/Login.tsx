import { Button, Field, Tile } from '@wefaber/ui'
import { useState } from 'react'

/** Shown when the request carries no tailnet identity and no session: the way in is a token. */
export function Login() {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim()) {
      setError('Pegá tu token para entrar.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null)
    if (res?.ok) {
      window.location.reload()
      return
    }
    const body = (await res?.json().catch(() => null)) as {
      error?: { message: string }
    } | null
    setError(body?.error?.message ?? 'No se pudo conectar con el panel.')
    setBusy(false)
  }

  return (
    <div className="mx-auto grid min-h-svh max-w-sm place-items-center p-4">
      <Tile title="Entrar al panel">
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <p className="text-muted">
            Desde el tailnet entrás solo. Fuera de él, usá un token personal. Se
            guarda una cookie de sesión por 30 días.
          </p>
          <label htmlFor="token" className="text-meta text-muted">
            Token
          </label>
          <Field
            id="token"
            type="password"
            autoComplete="off"
            value={token}
            invalid={error !== null}
            aria-describedby="token-error"
            onChange={(e) => setToken(e.target.value)}
          />
          <p
            id="token-error"
            role="alert"
            aria-live="polite"
            className="min-h-5 text-danger"
          >
            {error}
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={false}
            aria-busy={busy}
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Tile>
    </div>
  )
}
