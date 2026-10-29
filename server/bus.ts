// In-process event bus behind /sse/:channel. Features emit on their own channels (`containers`, `calls`,
// `ether:<run>` ...); the browser subscribes with EventSource. No replay: clients load the current state over
// GraphQL first, then follow changes here.

type Listener = (event: string, data: unknown) => void

export class Bus {
  private listeners = new Map<string, Set<Listener>>()

  on(channel: string, fn: Listener): () => void {
    let set = this.listeners.get(channel)
    if (!set) this.listeners.set(channel, (set = new Set()))
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.listeners.delete(channel)
    }
  }

  emit(channel: string, event: string, data: unknown): void {
    for (const fn of this.listeners.get(channel) ?? []) fn(event, data)
  }

  /** Subscribers on a channel: jobs that are expensive to run (log follow) can idle while nobody watches. */
  watching(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0
  }
}

export const CHANNEL = /^[a-z0-9][a-z0-9:_-]{0,63}$/

/** An SSE response that forwards one channel until the client leaves. */
export function sseResponse(
  bus: Bus,
  channel: string,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      send(`retry: 3000\n: ${channel}\n\n`)
      const off = bus.on(channel, (event, data) =>
        send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      )
      const ping = setInterval(() => send(': ping\n\n'), 20_000)
      cleanup = () => {
        off()
        clearInterval(ping)
      }
      signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
