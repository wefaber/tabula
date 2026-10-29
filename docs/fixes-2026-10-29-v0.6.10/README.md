# Fixes 2026-10-29 · v0.6.10

`[ ]` pendiente · `[~]` parcial · `[x]` hecho y verificado.

## Shell

- [x] No había botón para volver a ver el onboarding: ahora está en el diálogo de Preferencias ("Ver recorrido"), además del diálogo de atajos. Verificado: el botón abre el paso 1 de 5.
- [x] Faltaban íconos en Preferencias: cada grupo (idioma, tema, tamaño de texto, contraste) lleva ícono, y las opciones de tema también. Verificado por DOM (4 leyendas y 3 chips con `svg`).
- [x] El botón "Salir" no hacía nada: con identidad de tailnet (la forma normal de entrar) el servidor te vuelve a identificar al recargar. Ahora "Salir" solo aparece con sesión por cookie/token; con tailnet se muestra "Tailnet" con la explicación en el tooltip. El texto del recorrido se ajustó.

## Ether

- [~] Probado de punta a punta con fixtures (UI -> GraphQL -> runner -> SSE -> UI): pregunta, aprobación pedida, aprobar, respuesta final con fuentes; y una pregunta sin aprobación. Falta probar contra el Hermes real (`ETHER_URL`), que no se alcanza desde esta PC.
- [x] Bug hallado en la prueba: mientras corría una consulta, el mensaje del usuario aparecía duplicado (el guardado y el "en vivo"). Ahora se oculta el en vivo cuando ya está guardado.
