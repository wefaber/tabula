#!/usr/bin/env bash
# Blue/green deploy of the Tabula. Run by .github/workflows/deploy.yml on the wefaber runner.
#
#   deploy/tabula.sh <sha>      build output of the checkout -> idle slot -> health -> switch
#   deploy/tabula.sh rollback   switch back to the previous slot (still running)
#   deploy/tabula.sh status     active slot and health of both
#
# Slots: blue :4171, green :4172 (systemd tabula@<slot>). nginx listens on the tailnet address and
# proxies to the include /home/hermes/deploy/nginx/tabula-upstream.conf, which this script rewrites.
# Public name: https://tabula.wefaber.net:9443 (nginx vhost on the tailnet address, see deploy/nginx-tabula.conf).
#   :443 on the tailnet IP belongs to tailscaled; nginx listens on :9443 and on 127.0.0.1:443 for checks.
# Env: ~/deploy/env/tabula.env.
set -euo pipefail

APP=tabula
BASE="${TABULA_BASE:-/home/hermes/apps/$APP}"
STATE="${TABULA_STATE:-/home/hermes/deploy/state/$APP.slot}"
UPSTREAM="${TABULA_UPSTREAM:-/home/hermes/deploy/nginx/$APP-upstream.conf}"
DOMAIN="${TABULA_DOMAIN:-tabula.wefaber.net}"
TAILNET_IP="${TABULA_TAILNET_IP:-100.113.187.112}"
# :443 de la IP del tailnet lo tiene tailscaled; nginx sirve el panel en :9443.
PUBLIC_PORT="${TABULA_PUBLIC_PORT:-9443}"
PUBLIC="https://$DOMAIN:$PUBLIC_PORT"
CMD="${1:-deploy}"

port() { [ "$1" = blue ] && echo 4171 || echo 4172; }
other() { [ "$1" = blue ] && echo green || echo blue; }
active() { cat "$STATE" 2>/dev/null || echo green; }   # first deploy lands on blue
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# The real domain, as a tailnet client reaches it: SNI + Host intact, address pinned to the VPS tailnet IP.
# nginx reload is graceful: for a few seconds after it, old workers still answer with the previous upstream.
# So poll, and with a version argument require that version (the slot just switched to).
public_ready() {
  local want="${1:-}" body
  for _ in $(seq 1 20); do
    if body="$(curl -fsS --max-time 5 --resolve "$DOMAIN:$PUBLIC_PORT:$TAILNET_IP" "$PUBLIC/ready" 2>/dev/null)"; then
      if [ -z "$want" ] || grep -q "\"version\":\"$want\"" <<<"$body"; then return 0; fi
    fi
    sleep 1
  done
  return 1
}
ready() { curl -fsS --max-time 5 "http://127.0.0.1:$(port "$1")/ready" >/dev/null; }

wait_ready() {
  for _ in $(seq 1 30); do ready "$1" && return 0; sleep 1; done
  return 1
}

switch_to() {
  local slot="$1"
  mkdir -p "$(dirname "$UPSTREAM")" "$(dirname "$STATE")"
  printf 'upstream %s_upstream { server 127.0.0.1:%s; }\n' "$APP" "$(port "$slot")" > "$UPSTREAM"
  sudo /usr/sbin/nginx -t
  sudo /usr/bin/systemctl reload nginx
  printf '%s' "$slot" > "$STATE"
}

case "$CMD" in
  status)
    echo "active: $(active)"
    for s in blue green; do ready "$s" && echo "$s: ready" || echo "$s: down"; done
    ;;
  rollback)
    prev="$(other "$(active)")"
    ready "$prev" || die "el slot $prev no responde: no hay a donde volver"
    switch_to "$prev"
    public_ready || die "rollback hecho pero $PUBLIC/ready no responde"
    echo "rollback ok -> $prev"
    ;;
  deploy | *)
    SHA="${1:-$(git rev-parse --short HEAD)}"; [ "$SHA" = deploy ] && SHA="$(git rev-parse --short HEAD)"
    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    cur="$(active)"; idle="$(other "$cur")"
    dest="$BASE/$idle"
    echo "==> $SHA -> slot $idle (active: $cur)"
    [ -d "$ROOT/dist" ] || die "falta dist/: corré el build antes"
    mkdir -p "$dest"
    # Only what runs: server, shared, scripts, dist, package files, lockfile. node_modules are installed in place.
    rsync -a --delete --exclude node_modules --exclude data \
      "$ROOT/server" "$ROOT/shared" "$ROOT/scripts" "$ROOT/dist" "$ROOT/package.json" "$ROOT/bun.lock" "$dest/"
    (cd "$dest" && /opt/bun/bun install --frozen-lockfile --production)
    echo "$SHA" > "$dest/.sha"
    sudo /usr/bin/systemctl restart "$APP@$idle"
    wait_ready "$idle" || { sudo /usr/bin/systemctl stop "$APP@$idle"; die "el slot $idle no quedó ready; sigue sirviendo $cur"; }
    version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)"
    switch_to "$idle"
    public_ready "$version" || { switch_to "$cur"; die "$PUBLIC/ready no sirve v$version; volví a $cur"; }
    echo "==> deploy ok: $SHA activo en $idle (el slot $cur queda arriba para rollback)"
    ;;
esac
