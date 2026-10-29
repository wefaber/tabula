# Fixes 2026-10-28 · v0.6.2

`[ ]` pendiente · `[~]` parcial · `[x]` hecho y verificado en el navegador o con tests.

## Error local

- [x] `No se pudo leer el stack (Cannot query field "containers" on type "Query")`. No es un bug del código: había un server viejo (v0.6.0, de otra rama) ocupando el puerto 4171 y el Vite del front le apuntaba a él. Con el código actual, `containers` responde. Solución: frenar ese proceso y correr `bun run dev:api` desde esta carpeta. El `/ready` de ese server mostraba `ok:false` y `migrations:2`.
- [x] Para que el próximo caso se vea: el header ahora lista qué módulos fallan y por qué (ver UX).

## UX

- [x] Keyboard shortcuts: `1` a `7` por sección, `[` y `]` anterior/siguiente, `?` abre la ayuda. Se ignoran al escribir.
- [x] Si el panel tiene fallos, mostrar qué módulos fallan: el header muestra "N módulos con fallas" y el detalle (Podman, migraciones, falta `DB_PASSWORD`, `GITHUB_TOKEN` o `ETHER_KEY`). Una sección que rompe en el cliente muestra su propio error sin tumbar el resto.
- [x] Aviso de carga en la mitad de la pantalla, con loader (spinner).
- [ ] Pele y diagramas generados por Ether → #14
- [ ] Proceso de onboarding → #15
- [ ] Preferencias (idioma, tema, escala, contraste) → #16

## UI

- [x] Versión abajo a la derecha.
- [x] Botón Salir como botón relleno (antes un link subrayado), con icono.
- [x] El contenido de las secciones va centrado en el eje Y.

## Ask Ether

- [x] Botón Enviar dentro del textarea (Detener también).
- [ ] Referencias a componentes (containers, APIs, eventos recientes) → #17
- [ ] Fuentes de la respuesta, como eternum-board → #17
- [x] Responder a una parte de la respuesta: seleccionás texto, "Responder a esta parte", y se envía `Q: <cita>` + `A: <tu respuesta>`. En el hilo se ve como cita más respuesta.
- [x] Compartir abre un modal (crear link, copiar, dejar de compartir).
