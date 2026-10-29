# Gravida Dev Panel

Panel de desarrollo del stack de Gravida (NEXUS) para Faku, Pablo y Jean. Tailnet-only.

- Estado de las APIs y de los containers (`nexus-test`: db, back, front)
- Últimas llamadas a la API
- Editor de la base de datos
- Encender, apagar y reiniciar el stack
- Git y últimos pushes (`@wefaber/gitview`)
- Ask Ether, preguntas sobre el sistema

Estado por sección: [docs/README.md](docs/README.md). Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md).

## Desarrollo

```bash
bun install
bun run dev:api      # API con adapters de prueba (sin Podman, DB ni GitHub), :4171
bun run dev          # Vite en :5173, proxy a :4171
bun run check        # format + lint + typecheck + test (lo mismo corre el CI)
```

`DEVPANEL_DEV_LOGIN=dev@local` simula la identidad que inyecta Tailscale Serve (ignorado en producción).

## Acceso

Tailnet: entra solo, por el header `Tailscale-User-Login`, si el login está en `DEVPANEL_USERS`
(`login:rol:Nombre,...`). Fuera del tailnet: token personal (sección Acceso, o `bun run token create <login>` en el server).
