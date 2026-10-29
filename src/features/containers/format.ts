// Display helpers of containers. Mirrors server/features/containers/domain.ts (web and server do not share code).
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleOff,
  Clock,
  type LucideIcon,
} from 'lucide-react'

export interface ContainerRow {
  service: string
  id: string
  name: string
  state: string
  health: string
  image: string
  tag: string
  startedAt: string | null
  uptimeSeconds: number | null
  cpuPercent: number | null
  memBytes: number | null
  memLimitBytes: number | null
}

export type PowerAction = 'up' | 'down' | 'restart'

export const RECOVERY_COMMAND =
  'podman compose -f containers/compose.yaml --env-file ~/deploy/env/nexus-test.env up -d'

/** Seconds since `startedAt` (null when not running). */
export function uptimeOf(startedAt: string | null, now: number): number | null {
  if (!startedAt) return null
  const t = Date.parse(startedAt)
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 1000))
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min`
  return `${seconds} s`
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  const mib = bytes / 2 ** 20
  return mib >= 1024
    ? `${(mib / 1024).toFixed(1)} GiB`
    : `${Math.round(mib)} MiB`
}

export interface Status {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'muted'
  icon: LucideIcon
}

export function statusOf(c: Pick<ContainerRow, 'state' | 'health'>): Status {
  if (c.state === 'running') {
    if (c.health === 'unhealthy')
      return { label: 'Con fallas', tone: 'danger', icon: CircleAlert }
    if (c.health === 'starting')
      return { label: 'Arrancando', tone: 'warning', icon: Clock }
    return {
      label: c.health === 'healthy' ? 'Sano' : 'Corriendo',
      tone: 'success',
      icon: CircleCheck,
    }
  }
  if (c.state === 'paused')
    return { label: 'Pausado', tone: 'warning', icon: Clock }
  if (c.state === 'unknown')
    return { label: 'Estado desconocido', tone: 'warning', icon: CircleHelp }
  return { label: 'Apagado', tone: 'muted', icon: CircleOff }
}

export const TONE_CLASS: Record<Status['tone'], string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted',
}
