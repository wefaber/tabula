# Gravida Dev Panel

Panel de operación del stack de Gravida. Bun + Elysia + GraphQL (Yoga/Pothos) + React 19 + Tailwind v4. Español rioplatense en la UI, inglés en código y commits.

## Leer antes de trabajar

| Tocás…                | Leé                                                     |
| --------------------- | ------------------------------------------------------- |
| Server, datos, deploy | `ARCHITECTURE.md` (incluye "Una feature = una carpeta") |
| UI                    | `DESIGN.md`, luego `~/.claude/standards/DESIGN.md`      |
| Una sección nueva     | `docs/README.md` (estado de cada sección)               |

## Reglas

- Una feature vive en `server/features/<n>/` y `src/features/<n>/`. No edites archivos de otra feature ni los compartidos
  (`server/graphql/builder.ts`, `server/deps.ts`, `src/app/`) salvo que la tarea lo pida; si hace falta, hacelo mínimo y decilo.
- Migraciones SQLite: un archivo nuevo `server/db/migrations/NNNN_<feature>.sql` por feature (nunca editar uno aplicado).
- Todo cambio de estado llama a `audit()`. Nada de secretos en logs ni en respuestas.
- Tests con adapters fixture (`server/test-utils.ts`), nunca contra Podman, GitHub o Hermes reales.
- Antes de commitear: `bun run check` en verde. Rama + PR a `main`, nunca push directo.
