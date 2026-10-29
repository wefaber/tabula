# 0002. Tailscale Serve y tokens

Estado: aceptado (2026-10-28)

**Contexto.** Faku, Pablo y Jean están en el tailnet; hace falta también acceso desde dispositivos sin identidad de tailnet.

**Decisión.** nginx escucha solo en `127.0.0.1:4170`; Tailscale Serve (`https :8445`) es lo único que lo alcanza e inyecta
`Tailscale-User-Login`, que se valida contra `DEVPANEL_USERS`. Alternativa: token personal (`gdp_...`, solo se guarda el sha256)
que se canjea en `/auth/token` por una cookie HttpOnly/SameSite=Strict de 30 días. Orden: cookie, bearer, header.

**Consecuencias.** El header solo es confiable porque nada más llega a nginx; nunca exponer 4170 ni 4171/4172. Los tokens se
revocan desde la UI o `bun run token revoke`. Roles `admin` y `member`; por ahora ambos con acceso completo, todo auditado.
