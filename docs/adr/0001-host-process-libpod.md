# 0001. Proceso en el host y Podman por el socket libpod

Estado: aceptado (2026-10-28)

**Contexto.** El panel tiene que listar, encender, apagar y reiniciar containers de `nexus-test`, leer sus logs y ejecutar SQL
en la db. La red `internal` de Gravida no es alcanzable desde el host y el compose no se toca.

**Decisión.** Un proceso Bun en el host (systemd, blue/green) que habla con la API libpod REST por
`/run/user/1001/podman/podman.sock`. El acceso a la DB es `exec` en el container `db` (`mariadb`), no una conexión de red.
"Sistema" significa el stack `nexus-test`, no el VPS: apagar el VPS mataría el panel.

**Consecuencias.** El panel solo funciona donde está el socket; en local usa adapters fixture. Una vulnerabilidad en el panel
da control sobre los containers de Gravida: por eso es tailnet-only, auditado y con usuarios acotados.
