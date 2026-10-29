// Sections in nav order. Adding a section = one line here + its folder; sections load on demand.
import {
  Activity,
  ArrowLeftRight,
  Boxes,
  Database,
  GitBranch,
  KeyRound,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export interface SectionDef {
  id: string
  label: string
  icon: LucideIcon
  component: LazyExoticComponent<ComponentType>
}

export const SECTIONS: SectionDef[] = [
  {
    id: 'containers',
    label: 'Containers',
    icon: Boxes,
    component: lazy(() => import('./containers')),
  },
  {
    id: 'apis',
    label: 'APIs',
    icon: Activity,
    component: lazy(() => import('./apis')),
  },
  {
    id: 'calls',
    label: 'Llamadas',
    icon: ArrowLeftRight,
    component: lazy(() => import('./calls')),
  },
  {
    id: 'db',
    label: 'Base de datos',
    icon: Database,
    component: lazy(() => import('./db')),
  },
  {
    id: 'git',
    label: 'Git',
    icon: GitBranch,
    component: lazy(() => import('./git')),
  },
  {
    id: 'ether',
    label: 'Ask Ether',
    icon: Sparkles,
    component: lazy(() => import('./ether')),
  },
  {
    id: 'access',
    label: 'Acceso',
    icon: KeyRound,
    component: lazy(() => import('./access')),
  },
]
