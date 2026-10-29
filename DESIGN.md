# Design

Extiende `~/.claude/standards/DESIGN.md` (house) y solo lo acota.

- Tema **forest** de `@wefaber/tokens` (oscuro por defecto, claro con `data-theme="light"`). Solo roles, nunca colores sueltos.
- Primitivas de `@wefaber/ui` (`Tile`, `Button`, `Chip`, `Field`, `Dock`, `SectionTransition`, `EmptyState`), íconos de `lucide-react`.
- Una sección por vez (pills arriba), cada sección en tiles; filtros arriba del contenido; detalles en `Dock` a la derecha.
- Estados vacíos con caja punteada que dice qué hacer. Errores con motivo y acción ("No se pudo X (motivo). Reintentar").
- Acciones destructivas (apagar, borrar fila, SQL de escritura) piden confirmación; borrar filas pide tipear el nombre.
- Lo que cambia en vivo (estado, llamadas) se actualiza por SSE sin mover el layout. Sin animaciones en loop salvo el orb de Ask Ether.
- Copy en español rioplatense ("Tocá", "Elegí"), sin signos de exclamación ni emojis.
