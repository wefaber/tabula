// Runs a power plan against Podman: step by step, waiting for db health and for the front to answer.
import type { Deps } from '../../deps'
import { isReady, PowerError, type Step } from './domain'

export interface PowerIo {
  /** True once `GET <front>/login.php` answers 200. */
  probeFront(): Promise<boolean>
  sleep(ms: number): Promise<void>
  now(): number
  healthTimeoutMs: number
  httpTimeoutMs: number
  pollMs: number
}

export function defaultIo(deps: Deps): PowerIo {
  return {
    async probeFront() {
      // Fixtures have no nginx behind NEXUS_FRONT_URL.
      if (deps.config.fixtures) return true
      try {
        const res = await fetch(`${deps.config.nexus.frontUrl}/login.php`, {
          signal: AbortSignal.timeout(3000),
          redirect: 'manual',
        })
        return res.status === 200
      } catch {
        return false
      }
    },
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
    healthTimeoutMs: 90_000,
    httpTimeoutMs: 60_000,
    pollMs: 1000,
  }
}

async function until(
  io: PowerIo,
  timeoutMs: number,
  check: () => Promise<boolean>,
  timeoutError: () => PowerError,
): Promise<void> {
  const deadline = io.now() + timeoutMs
  while (!(await check())) {
    if (io.now() >= deadline) throw timeoutError()
    await io.sleep(io.pollMs)
  }
}

/** Executes `steps` in order. `onStep` fires after each one so the caller can publish fresh state. */
export async function executePower(
  deps: Deps,
  steps: Step[],
  io: PowerIo = defaultIo(deps),
  onStep: () => Promise<void> | void = () => {},
): Promise<void> {
  for (const step of steps) {
    const current = async () => {
      const found = (await deps.podman.list(deps.config.nexus.project)).find(
        (c) => c.service === step.service,
      )
      if (!found)
        throw new PowerError(
          'SERVICE_MISSING',
          `Desapareció el container de ${step.service}.`,
        )
      return found
    }
    const target = await current()
    if (step.op === 'start') await deps.podman.start(target.id)
    else if (step.op === 'stop') await deps.podman.stop(target.id)
    else if (step.op === 'restart') await deps.podman.restart(target.id)
    await onStep()

    if (step.wait === 'health')
      await until(
        io,
        io.healthTimeoutMs,
        async () => isReady(await current()),
        () =>
          new PowerError(
            'POWER_TIMEOUT',
            `${step.service} no quedó sano en ${io.healthTimeoutMs / 1000} s. Mirá sus logs.`,
          ),
      )
    else if (step.wait === 'http')
      await until(
        io,
        io.httpTimeoutMs,
        () => io.probeFront(),
        () =>
          new PowerError(
            'POWER_TIMEOUT',
            `El front no respondió 200 en /login.php en ${io.httpTimeoutMs / 1000} s. Mirá sus logs.`,
          ),
      )
    if (step.wait) await onStep()
  }
}
