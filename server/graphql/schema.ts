// Assembles the schema: base fields, then every feature (each registers its own fields on import).
import { builder } from './builder'
import './base'
import '../features'

export const schema = builder.toSchema()
