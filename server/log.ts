// JSON lines to stdout/stderr; journald keeps them. Never log secrets, tokens or SQL values.
type Level = 'info' | 'warn' | 'error'

function write(
  level: Level,
  msg: string,
  fields: Record<string, unknown> = {},
) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    msg,
    ...fields,
  })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) =>
    write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    write('error', msg, fields),
}
