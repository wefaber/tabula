// GraphQL over fetch. Sections call `gql`; errors keep the server's stable `extensions.code`.
export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status = 200) {
    super(message)
    this.code = code
    this.status = status
  }
}

interface GqlResponse<T> {
  data?: T
  errors?: { message: string; extensions?: { code?: string } }[]
  error?: { code: string; message: string }
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    credentials: 'same-origin',
  })
  // A proxy or crash answers with HTML, not GraphQL: say so before trying to read it as JSON.
  if (res.status >= 500)
    throw new ApiError(
      `El servidor respondió ${res.status}.`,
      'SERVER_ERROR',
      res.status,
    )
  const body = (await res.json().catch(() => ({}))) as GqlResponse<T>
  if (res.status === 401)
    throw new ApiError(
      body.error?.message ?? 'Sin sesión.',
      'UNAUTHENTICATED',
      401,
    )
  const first = body.errors?.[0]
  if (first)
    throw new ApiError(
      first.message,
      first.extensions?.code ?? 'ERROR',
      res.status,
    )
  if (!body.data)
    throw new ApiError('Respuesta vacía del servidor.', 'EMPTY', res.status)
  return body.data
}

/** Server-sent events on a channel; returns how to stop following. */
export function follow(
  channel: string,
  handlers: Record<string, (data: unknown) => void>,
): () => void {
  const source = new EventSource(`/sse/${channel}`)
  for (const [event, fn] of Object.entries(handlers)) {
    source.addEventListener(event, (e) =>
      fn(JSON.parse((e as MessageEvent<string>).data)),
    )
  }
  return () => source.close()
}
