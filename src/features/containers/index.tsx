// Containers y energía: one tile per service of the nexus stack, power buttons and live logs in a Dock.
import { Loader } from '@/app/Loader'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Tile,
} from '@wefaber/ui'
import { Copy, Power, PowerOff, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, follow, gql } from '@/lib/api'
import {
  formatBytes,
  formatUptime,
  RECOVERY_COMMAND,
  statusOf,
  TONE_CLASS,
  uptimeOf,
  type ContainerRow,
  type PowerAction,
} from './format'
import { LogsDock } from './LogsDock'

const FIELDS = `service id name state health image tag startedAt uptimeSeconds cpuPercent memBytes memLimitBytes`
const CONTAINERS = /* GraphQL */ `
  query Containers {
    containers { ${FIELDS} }
  }
`
const POWER = /* GraphQL */ `
  mutation Power($action: PowerAction!, $service: ServiceName) {
    power(action: $action, service: $service) { ${FIELDS} }
  }
`

type PowerRequest = {
  action: PowerAction
  service: string | null
}

const WORKING: Record<PowerAction, string> = {
  up: 'Encendiendo el stack: db, back y front, esperando health y /login.php. Puede tardar hasta un par de minutos.',
  down: 'Apagando el stack: front, back y db.',
  restart: 'Reiniciando…',
}

function describe(request: PowerRequest): { title: string; verb: string } {
  const what = request.service ? `el servicio ${request.service}` : 'el stack'
  if (request.action === 'up')
    return { title: 'Encender el stack', verb: 'Encender' }
  if (request.action === 'down')
    return { title: 'Apagar el stack', verb: 'Apagar' }
  return { title: `Reiniciar ${what}`, verb: 'Reiniciar' }
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

export default function Containers() {
  const qc = useQueryClient()
  const now = useNow(10_000)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<PowerRequest | null>(null)
  const [last, setLast] = useState<PowerRequest | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  const data = useQuery({
    queryKey: ['containers'],
    queryFn: () => gql<{ containers: ContainerRow[] }>(CONTAINERS),
    select: (d) => d.containers,
    retry: false,
  })

  useEffect(
    () =>
      follow('containers', {
        state: (rows) => {
          setStreamError(null)
          qc.setQueryData(['containers'], { containers: rows })
        },
        error: (e) => setStreamError((e as { message: string }).message),
      }),
    [qc],
  )

  const power = useMutation({
    mutationFn: (request: PowerRequest) =>
      gql<{ power: ContainerRow[] }>(POWER, request),
    onMutate: (request) => setLast(request),
    onSuccess: (r) => qc.setQueryData(['containers'], { containers: r.power }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['containers'] }),
  })

  const rows = data.data ?? []
  const busy = power.isPending
  const anyRunning = rows.some((r) => r.state === 'running')
  const allRunning = rows.length > 0 && rows.every((r) => r.state === 'running')
  const open = rows.find((r) => r.service === selected) ?? null

  function run(request: PowerRequest) {
    setConfirm(null)
    power.mutate(request)
  }

  return (
    <div className="flex flex-col gap-4">
      <Tile
        title="Energía del stack"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={busy || rows.length === 0 || allRunning}
              onClick={() => setConfirm({ action: 'up', service: null })}
            >
              <Power aria-hidden className="size-4" /> Encender
            </Button>
            <Button
              disabled={busy || !anyRunning}
              onClick={() => setConfirm({ action: 'restart', service: null })}
            >
              <RotateCw aria-hidden className="size-4" /> Reiniciar
            </Button>
            <Button
              variant="danger"
              disabled={busy || !anyRunning}
              onClick={() => setConfirm({ action: 'down', service: null })}
            >
              <PowerOff aria-hidden className="size-4" /> Apagar
            </Button>
          </div>
        }
      >
        {busy && last ? (
          <p role="status" className="text-muted">
            {WORKING[last.action]}
          </p>
        ) : power.error ? (
          <p role="alert" className="text-danger">
            No se pudo {last ? describe(last).verb.toLowerCase() : 'ejecutar'} (
            {power.error.message}).{' '}
            {power.error instanceof ApiError &&
            power.error.code === 'DEPLOY_IN_PROGRESS' ? null : last ? (
              <button className="underline" onClick={() => power.mutate(last)}>
                Reintentar
              </button>
            ) : null}
          </p>
        ) : (
          <p className="text-muted">
            Encender sube db, back y front en orden y espera el health de la db
            y que el front responda 200 en /login.php. Apagar baja en orden
            inverso. Se bloquea mientras haya un deploy de Gravida en curso.
          </p>
        )}
      </Tile>

      {streamError ? (
        <p role="alert" className="text-warning">
          Se perdió la lectura en vivo de Podman ({streamError}). Los datos
          pueden estar viejos.
        </p>
      ) : null}

      {data.isPending ? (
        <Loader />
      ) : data.error ? (
        <EmptyState>
          <span role="alert" className="text-danger">
            No se pudo leer el stack ({data.error.message}).{' '}
          </span>
          <button className="underline" onClick={() => data.refetch()}>
            Reintentar
          </button>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>
          <p>No hay containers del proyecto. Levantalo a mano en el VPS con:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="select-all rounded-control bg-surface-2 px-2 py-1 font-mono text-meta">
              {RECOVERY_COMMAND}
            </code>
            <IconButton
              label="Copiar comando"
              icon={<Copy size={16} />}
              onClick={() =>
                void navigator.clipboard?.writeText(RECOVERY_COMMAND)
              }
            />
          </div>
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const status = statusOf(c)
            const Icon = status.icon
            return (
              <Tile
                key={c.id}
                title={c.service}
                actions={
                  <Button
                    disabled={busy || c.state !== 'running'}
                    onClick={() =>
                      setConfirm({ action: 'restart', service: c.service })
                    }
                  >
                    <RotateCw aria-hidden className="size-4" /> Reiniciar
                  </Button>
                }
                className={selected === c.service ? 'ring-1 ring-accent' : ''}
              >
                <button
                  className="flex w-full flex-col gap-2 rounded-card text-left"
                  aria-label={`Ver logs de ${c.service}`}
                  onClick={() => setSelected(c.service)}
                >
                  <span
                    className={`flex items-center gap-1.5 font-medium ${TONE_CLASS[status.tone]}`}
                  >
                    <Icon aria-hidden className="size-4" />
                    {status.label}
                  </span>
                  <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted">Imagen</dt>
                    <dd
                      className="truncate font-mono text-meta"
                      title={c.image}
                    >
                      {c.image.split('/').pop()}
                    </dd>
                    <dt className="text-muted">Tag</dt>
                    <dd className="font-mono text-meta">{c.tag}</dd>
                    <dt className="text-muted">Uptime</dt>
                    <dd>{formatUptime(uptimeOf(c.startedAt, now))}</dd>
                    <dt className="text-muted">CPU</dt>
                    <dd>
                      {c.cpuPercent === null
                        ? '—'
                        : `${c.cpuPercent.toFixed(1)} %`}
                    </dd>
                    <dt className="text-muted">Memoria</dt>
                    <dd>
                      {formatBytes(c.memBytes)}
                      {c.memLimitBytes
                        ? ` / ${formatBytes(c.memLimitBytes)}`
                        : ''}
                    </dd>
                  </dl>
                  <span className="text-meta text-muted">
                    Tocá para ver logs
                  </span>
                </button>
              </Tile>
            )
          })}
        </div>
      )}

      <LogsDock container={open} onClose={() => setSelected(null)} />
      <ConfirmPower
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={run}
      />
    </div>
  )
}

function ConfirmPower({
  request,
  onCancel,
  onConfirm,
}: {
  request: PowerRequest | null
  onCancel: () => void
  onConfirm: (request: PowerRequest) => void
}) {
  return (
    <Dialog
      open={request !== null}
      onClose={onCancel}
      title={request ? describe(request).title : ''}
      closeLabel="Cancelar"
    >
      {request ? (
        <ConfirmForm
          request={request}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  )
}

/** Mounted only while the dialog is open, so the typed word starts empty every time. */
function ConfirmForm({
  request,
  onCancel,
  onConfirm,
}: {
  request: PowerRequest
  onCancel: () => void
  onConfirm: (request: PowerRequest) => void
}) {
  const [typed, setTyped] = useState('')
  const info = describe(request)
  const isDown = request.action === 'down'
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!isDown || typed.trim().toLowerCase() === 'apagar')
          onConfirm(request)
      }}
    >
      {isDown ? (
        <>
          <p>
            Vas a apagar db, back y front de nexus-test. Gravida deja de
            responder hasta que alguien lo vuelva a encender.
          </p>
          <label htmlFor="power-typed" className="text-meta text-muted">
            Escribí <b>apagar</b> para confirmar
          </label>
          <Field
            id="power-typed"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </>
      ) : request.action === 'up' ? (
        <p>
          Enciende db, back y front en ese orden y espera a que la db esté sana
          y el front responda en /login.php.
        </p>
      ) : request.service ? (
        <p>
          Reinicia solo {request.service}. Mientras tanto Gravida puede dar
          errores.
        </p>
      ) : (
        <p>
          Baja el stack en orden inverso y lo vuelve a subir. Gravida queda sin
          servicio unos minutos.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          type="submit"
          variant={isDown ? 'danger' : 'primary'}
          disabled={isDown && typed.trim().toLowerCase() !== 'apagar'}
        >
          {info.verb}
        </Button>
      </div>
    </form>
  )
}
