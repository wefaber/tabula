# 0002. Dominio en el tailnet, whois y tokens

Estado: aceptado (2026-10-28). Reemplaza la versión con Tailscale Serve.

**Contexto.** Faku, Pablo y Jean están en el tailnet. El panel vive en `https://gravidadev.wefaber.net`. Tailscale Serve
(que inyecta `Tailscale-User-Login`) no sirve con un dominio propio, y el panel puede apagar el stack y editar su DB.

**Decisión.** nginx escucha solo en la IP del tailnet del VPS (`100.113.187.112:443`), permite `100.64.0.0/10` y niega el
resto; el cert sale por DNS-01 y el registro A apunta a esa IP del tailnet (solo resuelve a algo alcanzable desde el
tailnet). nginx pasa `X-Real-IP: $remote_addr` (la IP del dispositivo) y vacía `Tailscale-User-Login`. El panel pregunta a
tailscaled (`/localapi/v0/whois`) de quién es esa IP y compara el login con `TABULA_USERS`; solo consulta IPs del
tailnet y cachea 60 s. Alternativa: token personal (`tbl_...`, solo el sha256) canjeado en `/auth/token` por una cookie
HttpOnly/SameSite=Strict de 30 días. Orden: cookie, bearer, whois. El header de Serve solo se cree con
`TABULA_TRUST_SERVE_HEADER=1`.

**Consecuencias.** Hace falta `sudo tailscale set --operator=hermes` una vez para que el servicio lea el socket. Nada
puede ponerse delante de nginx (el proxy taparía `$remote_addr`); nunca exponer 4171/4172. Un token alcanza solo desde
dispositivos que lleguen a la IP del tailnet. Roles `admin` y `member`; por ahora ambos con acceso completo, todo auditado.
