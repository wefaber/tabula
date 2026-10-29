// Every feature folder, in nav order. Each one registers its GraphQL fields on import and may start jobs.
import type { Feature } from '../deps'
import { feature as apis } from './apis'
import { feature as calls } from './calls'
import { feature as containers } from './containers'
import { feature as db } from './db'
import { feature as ether } from './ether'
import { feature as git } from './git'
import { feature as prefs } from './prefs'

export const features: Feature[] = [
  containers,
  apis,
  calls,
  db,
  git,
  ether,
  prefs,
]
