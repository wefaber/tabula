# Funcionalidades

Qué hace Tabula, sección por sección. Versión en la que entró cada una entre paréntesis; estado general en [README.md](README.md).
Todas las secciones requieren sesión (tailnet o token) y todo cambio de estado queda en la auditoría con quién lo hizo.

## Base (v0.1.0)

- **Acceso**: tailnet por whois (nginx pasa la IP del dispositivo, tailscaled dice de quién es) contra la lista `TABULA_USERS`, o token personal (`tbl_...`, guardado como sha256) que abre una sesión por cookie. Ver [ADR 0002](adr/0002-tailnet-whois-tokens.md).
- **Roles**: `admin` (Faku) y `member` (Pablo, Jean). Hoy ambos ven todo; lo destructivo y las aprobaciones de Ether son solo `admin`.
- **Sección Acceso**: crear y revocar tokens propios (admin revoca los de cualquiera). Revocar cierra las sesiones abiertas con ese token.
- **Vivo**: eventos por SSE (`/sse/:channel`) para estado, llamadas y respuestas de Ether.
- **Endpoints**: `/health`, `/ready` (devuelve la versión que corre), `/graphql` con límites de profundidad (8) y largo (4000).
- **Deploy**: blue/green en el VPS, verificado contra el dominio real y con rollback. Ver [ARCHITECTURE.md](../ARCHITECTURE.md).

## Containers y energía (v0.2.0)

- Estado del stack `nexus-test` (`db`, `back`, `front`): estado, health, uptime, imagen y tag, CPU y memoria. Se refresca cada 5 s y se emite solo si cambia.
- **Logs en vivo** de cada container en un dock; el panel solo sigue los logs de los que alguien está mirando.
- **Encender, apagar, reiniciar** el stack completo o un container. Orden db → back → front al subir, inverso al bajar. Al subir espera health de la db y un 200 en `login.php` del front.
- Una acción de energía a la vez; se bloquea si hay un deploy de Gravida en curso. "Sistema" es el stack, no el VPS.

## APIs (v0.3.0)

- Chequea cada 30 s todos los `api/*.php` de Gravida y la base, sin sesión: un 401/403/405 en JSON prueba que nginx → php-fpm → router responden. Un 200 sin sesión se marca como alerta; 5xx, 502/504 o HTML son falla.
- Nunca hace POST periódico a `login.php` (el límite por IP bloquearía a loopback).
- Historial de 24 h en tramos de 30 minutos, latencia y último error por endpoint.

## Llamadas (v0.3.0)

- Últimas 500 llamadas a la API y a `login.php`, leídas del access log del container `front`: hora, método, ruta, status y bytes. Retención 24 h.
- La query string se enmascara (`/api/equipos.php?pagina=*`). Filtro por texto, y se actualiza en vivo.

## Base de datos (v0.4.0)

- Lista de tablas con conteo de filas, esquema de columnas y tabla paginada con filtro.
- **Editar, insertar y borrar** filas por clave primaria. Valida cada valor contra el tipo y los enum de la columna. Las columnas protegidas se muestran enmascaradas y no se editan; las generadas tampoco. Borrar exige tipear el nombre de la fila (`ubicacion#1`).
- **Consola SQL**: lectura por defecto (hasta 500 filas, `truncated` si hay más). Escritura solo para admin, con toggle y confirmación; antes de ejecutar toma un dump y si el dump falla no escribe. Se guardan los últimos 10 en `data/dumps/`.
- Los identificadores se validan contra el esquema real; el SQL de escritura se audita con los secretos redactados.

## Git (v0.5.0)

- Grafo de ramas con `@wefaber/gitview`: un carril por rama, merges y bifurcaciones, con el CI de cada commit.
- Últimos pushes (quién, rama, cuándo) desde la API de actividad de GitHub.
- Dock por commit: mensaje, autor, runs de CI y deploy, y si es el tag activo en el stack. Respuestas cacheadas 30 s. Necesita `GITHUB_TOKEN` de solo lectura.

## Ask Ether (v0.6.0)

- Preguntas sobre el sistema a Ether (perfil Hermes `gravida`). Cada pregunta lleva una foto del estado: containers, errores recientes de API, tag activo.
- Hilos por usuario, con respuesta en streaming, pasos de herramientas y botón para frenar el run. Historial 30 días.
- **Aprobaciones**: si Ether pide ejecutar algo, solo `admin` lo ve y lo aprueba o rechaza.
- **Compartir respuesta**: link de solo lectura a una respuesta puntual (`#ether?s=<token>`); el hilo queda privado y el link se puede revocar.
- El canal SSE de cada run usa una clave secreta que solo reciben el dueño y los admins.

## Pendiente

Ver [issue #12](https://github.com/wefaber/tabula/issues/12) (refactor de componentes grandes) y la lista de VPS en [ARCHITECTURE.md](../ARCHITECTURE.md): runner, `tabula.env`, nginx, DNS y certificado.
