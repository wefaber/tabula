// Docker/libpod multiplexed stream (non-TTY logs and exec): frames of [stream, 0, 0, 0, size u32 BE] + payload.
// Pure over a ReadableStream, so it is tested with recorded bytes.

export interface LogLine {
  stream: 'stdout' | 'stderr'
  text: string
}

/**
 * Yields one entry per line (default) or per frame (`raw`, payload kept as is, for exec output).
 * Bytes that do not start with a valid header are passed through as stdout (a TTY container has no framing).
 */
export async function* demux(
  body: ReadableStream<Uint8Array>,
  { raw = false } = {},
): AsyncGenerator<LogLine> {
  const decoder = { stdout: new TextDecoder(), stderr: new TextDecoder() }
  const pending = { stdout: '', stderr: '' }
  let buf: Uint8Array = new Uint8Array(0)
  let framed: boolean | null = null

  function* emit(stream: LogLine['stream'], text: string): Generator<LogLine> {
    if (raw) {
      if (text) yield { stream, text }
      return
    }
    pending[stream] += text
    const parts = pending[stream].split('\n')
    pending[stream] = parts.pop() ?? ''
    for (const line of parts)
      if (line) yield { stream, text: line.replace(/\r$/, '') }
  }

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf = concat(buf, chunk)
    if (framed === null && buf.length >= 8)
      framed =
        (buf[0] === 1 || buf[0] === 2) &&
        buf[1] === 0 &&
        buf[2] === 0 &&
        buf[3] === 0
    if (framed === false) {
      yield* emit('stdout', decoder.stdout.decode(buf, { stream: true }))
      buf = new Uint8Array(0)
      continue
    }
    while (framed && buf.length >= 8) {
      const size = new DataView(buf.buffer, buf.byteOffset, 8).getUint32(4)
      if (buf.length < 8 + size) break
      const stream = buf[0] === 2 ? 'stderr' : 'stdout'
      yield* emit(
        stream,
        decoder[stream].decode(buf.subarray(8, 8 + size), { stream: true }),
      )
      buf = buf.slice(8 + size)
    }
  }
  if (framed === null && buf.length)
    yield* emit('stdout', decoder.stdout.decode(buf))
  for (const stream of ['stdout', 'stderr'] as const) {
    if (pending[stream])
      yield { stream, text: pending[stream].replace(/\r$/, '') }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
