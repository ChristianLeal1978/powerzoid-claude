#!/usr/bin/env bash
set -euo pipefail

REPO_BASE="https://downloads.claude.ai/claude-desktop/apt/stable"
PACKAGES_URL="$REPO_BASE/dists/stable/main/binary-amd64/Packages"
LOG_DIR="$HOME/.local/share/claude-desktop-update"
LOG_FILE="$LOG_DIR/update.log"

mkdir -p "$LOG_DIR"

CHECK_ONLY=false
ASSUME_YES=false
JSON_OUTPUT=false

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  if $JSON_OUTPUT; then
    echo "$line" >> "$LOG_FILE"
  else
    echo "$line" | tee -a "$LOG_FILE"
  fi
}

# En modo --json imprime {"error":"..."} a stdout y sale con código != 0.
# Fuera de modo --json conserva el comportamiento previo (mensaje a stderr).
json_fail() {
  if $JSON_OUTPUT; then
    local msg=${1//\\/\\\\}
    msg=${msg//\"/\\\"}
    printf '{"error":"%s"}\n' "$msg"
  else
    echo "$1" >&2
  fi
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --yes|-y) ASSUME_YES=true ;;
    --json) JSON_OUTPUT=true ;;
    *) echo "Opción desconocida: $arg (usa --check, --yes o --json)" >&2; exit 1 ;;
  esac
done

for cmd in curl rpm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    json_fail "Falta '$cmd'. Instálalo con: sudo dnf install $cmd"
  fi
done

if ! $CHECK_ONLY; then
  for cmd in alien sudo; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      json_fail "Falta '$cmd'. Instálalo con: sudo dnf install $cmd"
    fi
  done
fi

if ! INSTALLED_VERSION=$(rpm -q claude-desktop --qf '%{VERSION}' 2>/dev/null); then
  INSTALLED_VERSION="no-instalado"
fi
log "Versión instalada: $INSTALLED_VERSION"

LATEST_FILENAME=$(curl -fsS "$PACKAGES_URL" \
  | grep '^Filename: pool/main/c/claude-desktop/claude-desktop_' \
  | sort -V | tail -n 1 | cut -d' ' -f2)

if [[ -z "$LATEST_FILENAME" ]]; then
  json_fail "No se pudo leer el índice de paquetes de Anthropic (revisa tu conexión a downloads.claude.ai)."
fi

LATEST_VERSION=$(basename "$LATEST_FILENAME" | sed -E 's/claude-desktop_([0-9.]+)_amd64\.deb/\1/')
log "Última versión disponible: $LATEST_VERSION"

if [[ "$INSTALLED_VERSION" == "$LATEST_VERSION" ]]; then
  UPDATE_AVAILABLE=false
else
  UPDATE_AVAILABLE=true
fi

if $JSON_OUTPUT && $CHECK_ONLY; then
  printf '{"installed":"%s","latest":"%s","update_available":%s}\n' \
    "$INSTALLED_VERSION" "$LATEST_VERSION" "$UPDATE_AVAILABLE"
  exit 0
fi

if ! $UPDATE_AVAILABLE; then
  log "Ya tienes la última versión. Nada que hacer."
  exit 0
fi

log "Hay versión nueva: $INSTALLED_VERSION -> $LATEST_VERSION"

if $CHECK_ONLY; then
  echo "Nueva versión disponible: $LATEST_VERSION (tienes: $INSTALLED_VERSION)"
  exit 0
fi

if ! $ASSUME_YES; then
  read -rp "¿Descargar e instalar la versión $LATEST_VERSION? [s/N] " confirm
  case "$confirm" in
    [sS]|[sS][iI]) ;;
    *) log "Cancelado por el usuario."; exit 0 ;;
  esac
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

log "Descargando $LATEST_FILENAME ..."
curl -fL "$REPO_BASE/$LATEST_FILENAME" -o "$WORKDIR/claude-desktop_${LATEST_VERSION}_amd64.deb"

log "Convirtiendo a .rpm con alien (puede tardar 1-2 min sin mostrar nada, es normal) ..."
(
  cd "$WORKDIR"
  sudo alien --to-rpm --scripts "claude-desktop_${LATEST_VERSION}_amd64.deb"
)

RPM_FILE=$(find "$WORKDIR" -maxdepth 1 -name '*.rpm' | head -n 1)
if [[ -z "$RPM_FILE" ]]; then
  log "ERROR: alien no generó ningún .rpm."
  exit 1
fi
log "Generado: $(basename "$RPM_FILE")"

log "Instalando con rpm -Uvh --replacefiles ..."
sudo rpm -Uvh --replacefiles --nosignature --nodigest "$RPM_FILE"

FINAL_VERSION=$(rpm -q claude-desktop --qf '%{VERSION}' 2>/dev/null || echo "error")
if [[ "$FINAL_VERSION" == "$LATEST_VERSION" ]]; then
  log "Listo. Claude Desktop actualizado a $FINAL_VERSION."
else
  log "ADVERTENCIA: la versión instalada ($FINAL_VERSION) no coincide con la esperada ($LATEST_VERSION). Revisa manualmente con: rpm -qi claude-desktop"
  exit 1
fi
