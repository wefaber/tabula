# Tabula

Panel de desarrollo del stack de Gravida (NEXUS) para Faku, Pablo y Jean. URL: **https://gravidadev.wefaber.net** (solo tailnet).

Todo en una pantalla, con el stack `nexus-test` (db, back, front) como sistema:

| Sección       | Qué hace                                                                           |
| ------------- | ---------------------------------------------------------------------------------- |
| Containers    | Estado, CPU/memoria y logs en vivo. Encender, apagar y reiniciar, con confirmación |
| APIs          | Chequeo cada 30 s de cada `api/*.php` y de la base, con historial de 24 h          |
| Llamadas      | Últimas 500 llamadas a la API, en vivo y con filtro                                |
| Base de datos | Tablas, edición de filas y consola SQL (escritura solo admin, con dump previo)     |
| Git           | Grafo de ramas (`@wefaber/gitview`), últimos pushes, CI y deploy por commit        |
| Ask Ether     | Preguntas sobre el sistema con aprobaciones y respuestas compartibles              |
| Acceso        | Tokens personales                                                                  |

Detalle de cada una: [docs/features.md](docs/features.md). Estado por versión: [docs/README.md](docs/README.md). Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md).

## Flujo de trabajo

`<tipo>/<función>` → PR a `dev` → PR `dev` → `main` (producción). `main` despliega solo (blue/green, con verificación y rollback).
Detalle en [ARCHITECTURE.md](ARCHITECTURE.md#flujo-de-ramas).

## Desarrollo

```bash
bun install
bun run dev          # API con adapters de prueba (sin Podman, DB ni GitHub) en :4171 y Vite en :5173, juntos
bun run dev:api      # solo la API
bun run dev:web      # solo Vite (proxy a :4171; `API_PORT` cambia el puerto)
bun run check        # format + lint + typecheck + test (lo mismo corre el CI)
```

`TABULA_DEV_LOGIN=dev@local` simula la identidad que resolvería el whois del tailnet (ignorado en producción).

## Acceso

Tailnet: entrás solo. nginx escucha en la IP del tailnet, el panel resuelve de quién es el dispositivo (`tailscale whois`) y
lo compara con `TABULA_USERS` (`login:rol:Nombre,...`). Fuera del tailnet no hay ruta: usá un token personal desde un
dispositivo que sí llegue (sección Acceso, o `bun run token create <login>` en el server).
