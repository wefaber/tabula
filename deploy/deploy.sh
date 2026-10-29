#!/usr/bin/env bash
# deploy/deploy.sh — publica el build de tabula en el VPS.
#
# Lo corre el runner self-hosted de wefaber en el push a main
# (.github/workflows/deploy.yml) y también sirve para un deploy manual:
#   cd /home/hermes/repos/tabula && bash deploy/deploy.sh
#
# Este script NO toca git: asume que el árbol de trabajo ya está en el commit a
# publicar (lo deja actions/checkout, o el wrapper ~/deploy/tabula.sh).
#
# Publicación por release + symlink (un slot, swap atómico):
#   /var/www/tabula.wefaber.net.releases/<fecha>-<sha>/   cada build
#   /var/www/tabula.wefaber.net -> release actual          symlink (root de nginx)
# El release anterior queda en disco: el rollback es un `ln -sfn` al lado. Si el
# health check falla después del swap, el script vuelve solo al anterior.
#
# Health check: loopback (127.0.0.1:443, bloque dedicado del vhost), NO el
# hostname público — tabula es tailnet-only y el 443 de 100.113.187.112 lo tiene
# tailscaled. Con query cache-buster y verificando el bundle con hash del build.
set -euo pipefail

DOMAIN="${DOMAIN:-tabula.wefaber.net}"
DOCROOT="${DOCROOT:-/var/www/${DOMAIN}}"
RELEASES="${DOCROOT}.releases"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
BUN="${BUN:-bun}"

cd "$(dirname "$0")/.."

BUILD_SHA="${BUILD_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
BUILD_SHA="${BUILD_SHA:0:7}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
RELEASE="$RELEASES/$STAMP-$BUILD_SHA"

log() { echo "[tabula] $*"; }

log "deploy $(date -Is) sha=$BUILD_SHA"

log "instalando dependencias…"
"$BUN" install --frozen-lockfile

log "build…"
"$BUN" run build

if [ ! -f dist/index.html ]; then
  log "ERROR: no existe dist/index.html" >&2
  exit 1
fi
# Nunca publicar el template de dev de Vite.
if grep -q 'src/main.tsx' dist/index.html; then
  log "ERROR: dist/index.html referencia src/main.tsx (template de dev)" >&2
  exit 1
fi

log "armando release $RELEASE…"
mkdir -p "$RELEASE"
rsync -a --delete dist/ "$RELEASE/"

# Chequeo antes del swap: si el index pide un asset que no está en el release,
# el build o el rsync quedaron a medias y no hay que publicarlo.
ENTRY="$(grep -oE '/assets/[^"]+\.js' "$RELEASE/index.html" | head -1 || true)"
if [ -z "$ENTRY" ] || [ ! -f "$RELEASE$ENTRY" ]; then
  log "ERROR: el index no apunta a un asset existente ($ENTRY)" >&2
  exit 1
fi

PREV=""
if [ -L "$DOCROOT" ]; then
  PREV="$(readlink -f "$DOCROOT")"
fi

log "swap del symlink…"
TMPLINK="$RELEASES/.current.$$"
ln -sfn "$RELEASE" "$TMPLINK"
# mv -Tf: evita la ventana en que el path no existe (ln -sfn solo no alcanza).
mv -Tf "$TMPLINK" "$DOCROOT"

HEALTH_TMP="$(mktemp)"
CODE="000"
OK=0
for _ in 1 2 3 4 5; do
  CODE="$(curl -sk --resolve "$DOMAIN:443:127.0.0.1" \
    "https://$DOMAIN/?deploy=$STAMP" -o "$HEALTH_TMP" -w '%{http_code}' || true)"
  if [ "$CODE" = "200" ] && grep -q "$ENTRY" "$HEALTH_TMP"; then
    OK=1
    break
  fi
  sleep 2
done

if [ "$OK" != "1" ]; then
  log "ERROR: health check http=$CODE (esperaba 200 con $ENTRY)" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    log "rollback a $PREV" >&2
    ln -sfn "$PREV" "$TMPLINK"
    mv -Tf "$TMPLINK" "$DOCROOT"
  fi
  rm -f "$HEALTH_TMP"
  exit 1
fi
rm -f "$HEALTH_TMP"

log "assets: $(curl -sk --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$DOMAIN$ENTRY")"
log "live  : $(curl -sk --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$DOMAIN/") $DOMAIN"

# Los releases viejos se podan; el symlink nunca lo toca el rm.
if [ -d "$RELEASES" ] && [ "$(ls -1d "$RELEASES"/*/ 2>/dev/null | wc -l)" -gt "$KEEP_RELEASES" ]; then
  ls -1dt "$RELEASES"/*/ | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
    case "$old" in
      "$RELEASES"/*/) log "podando $old"; rm -rf "$old" ;;
    esac
  done
fi

log "listo: https://${DOMAIN}:9443/ (rollback: ln -sfn <release> $DOCROOT)"
