# Fixes 2026-10-29 · v0.6.7

`[ ]` pendiente · `[~]` parcial · `[x]` hecho y verificado.

## Onboarding

- [x] Sección de bienvenida: explica para qué sirve el sistema y deja elegir idioma y tema ahí mismo (el cambio se aplica y se guarda al instante).
- [x] Mostrar las secciones principales: paso con una tarjeta por sección (ícono, nombre y qué hace), tomadas del registro de secciones.
- [x] Utilidades: pasos de Ask Ether (referencias con `@`, responder a una parte, compartir, aprobaciones), atajos de teclado, y acceso por token y ajustes.
- [x] Barra de progreso como la de Lux: etiqueta "Guía rápida", "Paso X de N" y barra con `role="progressbar"` (20% a 100%, sin animación con `prefers-reduced-motion`).
- [x] Todo el recorrido está en español e inglés (antes estaba solo en español).
- [~] Verificado en el navegador por DOM (pasos, progreso, cambio de idioma en vivo); no pude mirar el render a la vista porque la ventana del preview estaba oculta. Falta una mirada tuya al diseño.
