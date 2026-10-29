# Architecture

Extiende `~/.claude/standards/ARCHITECTURE.md`. Decisiones en [docs/adr](docs/adr).

Un proceso Bun en el host del VPS (no en container): Elysia sirve `/health`, `/ready`, `/auth/*`, `/graphql`, `/sse/:channel`
y la SPA. Habla con Podman por el socket rootless, con GitHub por REST y con Hermes (Ether) por loopback. Su SQLite propio
(`/home/hermes/data/tabula/tabula.db`) guarda usuarios, tokens, sesiones, auditoría y lo que cada feature necesite.
Nunca toca los datos de Gravida salvo por el editor de DB, vía `exec` en el container `db`.

```
https://gravidadev.wefaber.net -> nginx (vhost en la IP del tailnet, :443) -> tabula@blue|green (:4171/:4172)
                                                   |- tailscaled.sock (whois de la IP del cliente)
                                                   |- podman.sock  -> containers nexus-test (list/stats/logs/exec/power)
                                                   |- api.github.com (read-only)
                                                   '- 127.0.0.1:8642 Hermes (perfil gravida)
```

## Layout

```
server/
  index.ts · app.ts · deps.ts · bus.ts · audit.ts · config.ts · ready.ts
  adapters/   podman.ts (+ podmanStream.ts) · github.ts      cada uno con implementación real y fixture
  auth/       whois de tailnet · tokens (sha256) · sesiones (cookie HttpOnly)
  db/         openDb + migrations/NNNN_*.sql
  graphql/    builder.ts (Pothos) · base.ts (me, system, tokens, audit) · limits.ts · schema.ts
  features/   <n>/ index.ts (Feature: nombre + jobs) · graphql.ts · dominio puro + tests
src/
  app/        shell (nav, login, sesión)
  lib/        gql, follow (SSE)
  features/   <n>/index.tsx (una sección por carpeta) · registry.ts
scripts/token.ts · deploy/ · docs/
```

## Una feature = una carpeta

Para que varias features se escriban en paralelo sin pisarse:

- **Server**: `server/features/<n>/` es de la feature. Registra sus campos con `builder.queryFields` / `mutationFields` en
  `graphql.ts` (ya importado por `index.ts`). Los jobs arrancan en `Feature.start(deps)` y devuelven cómo pararlos.
  Dominio puro (sin DB, red ni reloj; `now` se pasa) con tests en `__tests__/` de la feature.
- **Web**: `src/features/<n>/index.tsx` exporta `default` el componente de la sección. `src/features/registry.ts` ya la carga.
- **Migraciones**: archivo propio `server/db/migrations/NNNN_<n>.sql`. Reservados: containers 0010, apis 0020, calls 0030,
  db 0040, git 0050, ether 0060. Las tablas llevan el prefijo de la feature.
- **Compartido** (no se edita salvo necesidad): `deps.ts`, `graphql/builder.ts`, `bus.ts`, `adapters/*`, `src/app/*`.
- **Tiempo real**: `deps.bus.emit('<canal>', '<evento>', datos)` en el server; `follow('<canal>', {...})` en la web.
- **Auditoría**: toda mutación llama `audit(ctx.db, ctx.user, 'feature.accion', objetivo, detalle)`.
- **Roles**: `requireAdmin(ctx)` para lo que solo hace un admin.

## Config (env)

`TABULA_USERS` (`login:rol:Nombre,...`), `PORT`, `DATA_DIR`, `PODMAN_SOCKET`, `NEXUS_PROJECT` (`nexus-test`), `NEXUS_FRONT_URL`
(`http://127.0.0.1:18080`), `NEXUS_STATE_FILE`, `DB_NAME`/`DB_USER`/`DB_PASSWORD`, `GITHUB_REPO`/`GITHUB_TOKEN`,
`ETHER_URL`/`ETHER_KEY`/`ETHER_PROFILE`, `TABULA_DOMAIN` (`gravidadev.wefaber.net`), `TAILSCALE_SOCKET`, `TABULA_TRUST_SERVE_HEADER` (solo si hubiera Tailscale Serve adelante). En el VPS vienen de `~/deploy/env/tabula.env`. Local: `TABULA_FIXTURES=1`.

## Delivery

Push a `main` dispara `.github/workflows/deploy.yml` (runner wefaber): install, `check`, build y
`deploy/tabula.sh <sha>` (rsync al slot libre, `/ready`, switch del upstream de nginx, reload, y `/ready` sobre `https://gravidadev.wefaber.net`). El slot anterior
queda arriba; rollback = `deploy/tabula.sh rollback`. Las migraciones son expand/contract porque blue y green
comparten la DB.
