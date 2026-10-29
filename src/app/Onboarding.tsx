// Recorrido de primer uso: 4 pasos, una vez por usuario. Se reabre con openOnboarding() (botón en atajos).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, Kbd } from '@wefaber/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { gql } from '@/lib/api'
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

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Las secciones',
    body: (
      <p>
        Cada solapa de arriba es una parte del panel: Containers, APIs,
        Llamadas, Base de datos, Git y Ask Ether. Acceso está al final y muestra
        tus tokens y el registro de acciones.
      </p>
    ),
  },
  {
    title: 'Pedir un token',
    body: (
      <p>
        Para entrar desde un dispositivo fuera del tailnet, andá a Acceso,
        escribí un nombre y tocá Crear token. Copialo en ese momento: se muestra
        una sola vez y después solo queda su huella.
      </p>
    ),
  },
  {
    title: 'Atajos de teclado',
    body: (
      <div className="flex flex-col gap-2">
        <p>Sin tocar el mouse, podés moverte por el panel:</p>
        <ul className="flex flex-col gap-1.5">
          <li className="flex items-center justify-between gap-3">
            <span>Ir a una sección por número</span>
            <Kbd keys="1" />
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Sección anterior o siguiente</span>
            <span className="flex gap-2">
              <Kbd keys="[" />
              <Kbd keys="]" />
            </span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Lista completa de atajos</span>
            <Kbd keys="?" />
          </li>
        </ul>
      </div>
    ),
  },
  {
    title: 'Ask Ether',
    body: (
      <p>
        Preguntale a Ether por el estado del sistema. Cada pregunta ya lleva una
        foto de los containers, los errores recientes de API y el tag activo. Si
        Ether pide ejecutar algo, solo un admin lo aprueba o rechaza.
      </p>
    ),
  },
]

export function Onboarding() {
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
  const [step, setStep] = useState(0)
  const open = !dismissed && (forced || status.data?.onboarding === false)

  useEffect(() => {
    const reopen = () => {
      setDismissed(false)
      setForced(true)
      setStep(0)
    }
    window.addEventListener(OPEN_ONBOARDING_EVENT, reopen)
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, reopen)
  }, [])

  const close = () => {
    setDismissed(true)
    setForced(false)
    complete.mutate()
  }

  const last = step === STEPS.length - 1
  const current = STEPS[step]!

  return (
    <Dialog
      open={open}
      onClose={close}
      title={current.title}
      closeLabel="Cerrar el recorrido"
    >
      <div className="flex flex-col gap-4 text-body">{current.body}</div>
      <footer className="flex items-center justify-between gap-3">
        <span className="tabular text-meta text-muted">
          Paso {step + 1} de {STEPS.length}
        </span>
        <div className="flex gap-2">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep(step - 1)}>
              Atrás
            </Button>
          ) : null}
          {last ? (
            <Button variant="primary" onClick={close}>
              Terminar
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Siguiente
            </Button>
          )}
        </div>
      </footer>
    </Dialog>
  )
}
