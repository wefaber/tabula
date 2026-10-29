// Ask Ether: the run events the server reemits on `ether-<runId>` and the state machine both sides derive from them.
// Pure (no DB, network or clock) so the server accumulates the final text and the UI renders the very same state.

export type EtherEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; tool: string; preview: string }
  | { type: 'approval'; summary: string }
  | { type: 'done'; status: 'completed' | 'cancelled'; output: string }
  | { type: 'error'; message: string; offline: boolean }

export type RunPhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'offline'

export interface ToolStep {
  tool: string
  preview: string
}

export interface RunState {
  phase: RunPhase
  text: string
  tools: ToolStep[]
  /** What Ether wants to run, while `phase` is `waiting_for_approval`. */
  approval: string | null
  error: string | null
}

/** Subset of `@wefaber/orb` states the panel uses. */
export type OrbPhase =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'attention'
  | 'error'
  | 'offline'

export const MAX_TOOL_STEPS = 30
export const MAX_TEXT = 60_000

export const IDLE_RUN: RunState = {
  phase: 'idle',
  text: '',
  tools: [],
  approval: null,
  error: null,
}

export const START_RUN: RunState = { ...IDLE_RUN, phase: 'starting' }

export function isTerminal(phase: RunPhase): boolean {
  return (
    phase === 'completed' ||
    phase === 'cancelled' ||
    phase === 'failed' ||
    phase === 'offline'
  )
}

export function reduceRun(state: RunState, event: EtherEvent): RunState {
  // A late event after the run ended must not bring it back to life.
  if (isTerminal(state.phase)) return state
  switch (event.type) {
    case 'delta':
      return {
        ...state,
        phase: 'running',
        text: (state.text + event.text).slice(0, MAX_TEXT),
        approval: null,
      }
    case 'tool':
      return {
        ...state,
        phase: 'running',
        tools: [
          ...state.tools,
          { tool: event.tool, preview: event.preview },
        ].slice(-MAX_TOOL_STEPS),
        approval: null,
      }
    case 'approval':
      return {
        ...state,
        phase: 'waiting_for_approval',
        approval: event.summary,
      }
    case 'done':
      return {
        ...state,
        phase: event.status,
        text: event.output || state.text,
        approval: null,
      }
    case 'error':
      return {
        ...state,
        phase: event.offline ? 'offline' : 'failed',
        approval: null,
        error: event.message,
      }
  }
}

/** The orb mirrors the agent, never data loading: text flowing is speaking, anything earlier is thinking. */
export function orbPhase(state: RunState): OrbPhase {
  switch (state.phase) {
    case 'starting':
      return 'thinking'
    case 'running':
      return state.text ? 'speaking' : 'thinking'
    case 'waiting_for_approval':
      return 'attention'
    case 'failed':
      return 'error'
    case 'offline':
      return 'offline'
    default:
      return 'idle'
  }
}

export const ORB_LABELS: Record<OrbPhase, string> = {
  idle: 'Ether, en reposo',
  thinking: 'Ether, pensando',
  speaking: 'Ether, respondiendo',
  attention: 'Ether, espera tu aprobación',
  error: 'Ether, la consulta falló',
  offline: 'Ether, sin conexión',
}
