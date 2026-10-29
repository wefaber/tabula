// `bun run dev`: the API (fixtures, watch) and Vite together. If something already answers on the API port it is not
// this checkout's server (a stale one makes the panel fail with "Cannot query field ..."), so it stops and says which.
const port = Number(process.env.API_PORT ?? 4171)
const env: Record<string, string | undefined> = {
  ...process.env,
  PORT: String(port),
  API_PORT: String(port),
  TABULA_FIXTURES: process.env.TABULA_FIXTURES ?? '1',
}
if (env.TABULA_FIXTURES === '1')
  env.TABULA_DEV_LOGIN = process.env.TABULA_DEV_LOGIN ?? 'dev@local'

const busy = await fetch(`http://127.0.0.1:${port}/ready`, {
  signal: AbortSignal.timeout(1500),
})
  .then(
    async (res) => ((await res.json()) as { version?: string }).version ?? '?',
  )
  .catch(() => null)
if (busy !== null) {
  console.error(
    `El puerto ${port} ya lo usa un server de Tabula (v${busy}). Frenalo antes de correr \`bun run dev\`, o usá API_PORT=<otro puerto>.`,
  )
  process.exit(1)
}

const children = [
  Bun.spawn(['bun', '--watch', 'server/index.ts'], {
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
  }),
  Bun.spawn(['bun', 'run', 'dev:web'], {
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
  }),
]

const stop = () => {
  for (const child of children) child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

// One of them dying takes the other down, so a crashed API is not left behind a live Vite.
await Promise.race(children.map((child) => child.exited))
stop()
process.exit(0)
