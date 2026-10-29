# Tabula

Panel de desarrollo del stack de Gravida (NEXUS) para Faku, Pablo y Jean. URL: **https://gravidadev.wefaber.net** (solo tailnet).

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

`TABULA_DEV_LOGIN=dev@local` simula la identidad que resolvería el whois del tailnet (ignorado en producción).

## Acceso

Tailnet: entrás solo. nginx escucha en la IP del tailnet, el panel resuelve de quién es el dispositivo (`tailscale whois`) y
lo compara con `TABULA_USERS` (`login:rol:Nombre,...`). Fuera del tailnet no hay ruta: usá un token personal desde un
dispositivo que sí llegue (sección Acceso, o `bun run token create <login>` en el server).
