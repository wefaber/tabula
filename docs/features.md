# Funcionalidades

Qué hace Tabula, sección por sección. Versión en la que entró cada una entre paréntesis; estado general en [README.md](README.md).
Todas las secciones requieren sesión (tailnet o token) y todo cambio de estado queda en la auditoría con quién lo hizo.

## Base (v0.1.0)

- **Acceso**: tailnet por whois (nginx pasa la IP del dispositivo, tailscaled dice de quién es) contra la lista `TABULA_USERS`, o token personal (`tbl_...`, guardado como sha256) que abre una sesión por cookie. Ver [ADR 0002](adr/0002-tailnet-whois-tokens.md).
- **Roles**: `admin` (Faku) y `member` (Pablo, Jean). Hoy ambos ven todo; lo destructivo y las aprobaciones de Ether son solo `admin`.
- **Sección Acceso**: crear y revocar tokens propios (admin revoca los de cualquiera). Revocar cierra las sesiones abiertas con ese token.
- **Atajos**: `1` a `7` cambian de sección, `[` y `]` van a la anterior o siguiente, `?` lista los atajos.
- **Fallas a la vista**: el header lista los módulos con problemas y qué se detectó (Podman, migraciones, falta de `DB_PASSWORD`, `GITHUB_TOKEN` o `ETHER_KEY`); una sección que rompe en el navegador muestra su error sin tumbar el resto.
- **Vivo**: eventos por SSE (`/sse/:channel`) para estado, llamadas y respuestas de Ether.
- **Recorrido de primer uso (v0.6.7)**: 5 pasos con barra de progreso (bienvenida con idioma y tema, las secciones, Ask Ether, atajos, acceso y ajustes) en español e inglés. Se abre una sola vez por usuario al entrar; Omitir, Esc o la X lo marcan como visto (`user_onboarding`). Se reabre con **Ver recorrido** desde el diálogo de atajos (`?`).
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
- **Responder a una parte**: seleccionás texto de una respuesta y la siguiente pregunta se manda como `Q: <cita>` y `A: <tu respuesta>`.
- **Compartir respuesta**: un modal crea un link de solo lectura a una respuesta puntual (`#ether?s=<token>`); el hilo queda privado y el link se puede revocar.
- El canal SSE de cada run usa una clave secreta que solo reciben el dueño y los admins.
- **Diagramas (v0.6.5)**: Ether puede responder con un bloque ` ```mermaid ` (flowchart para arquitectura, sequenceDiagram para flujos). El panel lo dibuja con [Pele](https://pele.run) (MIT) en el lugar del bloque: **Ampliar** lo abre en un diálogo y **Copiar Mermaid** copia el código. Si no dibuja, muestra el código. El SVG pasa por un sanitizador (`shared/mermaid.ts`) antes de llegar al DOM; los colores siguen el tema forest, claro y oscuro. Las respuestas compartidas también lo muestran.

## Preferencias (v0.6.4)

- **Engranaje** en el header abre el diálogo con cuatro opciones: idioma (Español, English), tema (Oscuro, Claro, Sistema), tamaño de texto (90, 100, 115 o 130%) y contraste (Normal, Alto). Cada cambio se aplica al toque y se guarda.
- **Por usuario, en el server**: tabla `user_prefs` (migración 0080), query `prefs` y mutation `setPrefs`. Los valores se validan; lo que no se manda queda como estaba. Cada cambio queda en la auditoría.
- **Sin destello**: el navegador guarda una copia local (`tabula-prefs`, y `tabula-theme` para el tema) que `index.html` lee antes del primer paint. Al cargar el shell, manda lo guardado en el server.
- **Tema Sistema** sigue `prefers-color-scheme` del navegador y se actualiza si cambia.
- **Escala**: zoom del documento (`--ui-scale` en `src/index.css`), porque los tokens de tipo están en px.
- **Contraste alto**: sube el texto secundario y los bordes en los dos temas de forest (`src/index.css`).
- **Idioma**: el shell (header, Salir, Panel ok, atajos, loader) y el diálogo salen en el idioma elegido. Las claves están en `src/lib/i18n.ts`.

### Referencias y fuentes (v0.6.6)

- **Referencias**: al escribir `@` en la pregunta aparece un picker con los containers, las APIs (`api/*.php`) y las últimas llamadas. Elegir una deja un chip sobre el textarea (`@container:back`, `@api:login`, `@call:<id>`). Flechas para moverse, Enter para elegir, Esc para cerrar. Hasta 5 por pregunta.
- Al enviar, el server valida cada id contra datos reales y adjunta lo que dice: estado del container, último veredicto de la API o la línea de la llamada. Van en un bloque `<referenced>` con el mismo saneado que el snapshot. Un id inexistente rechaza la pregunta sin escribir el hilo.
- **Fuentes**: debajo de cada respuesta terminada, una fila «Fuentes» con chips que abren un detalle: la foto del estado (containers, errores recientes, tag activo), los pasos de herramientas del run y cada referencia. Los datos se guardan con el mensaje (migración `0090_ether_sources`, campo `sources` en `EtherMessage`); las respuestas anteriores no tienen fuentes.

## Pendiente

- **Idioma en las secciones**: Containers, APIs, Llamadas, Base de datos, Git, Ask Ether y Acceso siguen en español. Para traducir una sección, sumar sus textos al diccionario de `src/lib/i18n.ts` y usar `useT()`.
- Ver [issue #12](https://github.com/wefaber/tabula/issues/12) (refactor de componentes grandes) y la lista de VPS en [ARCHITECTURE.md](../ARCHITECTURE.md): runner, `tabula.env`, nginx, DNS y certificado.
