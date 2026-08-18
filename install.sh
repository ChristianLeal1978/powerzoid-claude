#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  PowerZoid Claude — Instalador para Fedora 44 / GNOME 50
#  Uso: bash install.sh
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

EXTENSION_UUID="powerzoid-claude@cleal.cl"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
BIN_DIR="$HOME/.local/bin"
SERVICE_DIR="$HOME/.config/systemd/user"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
ok()  { echo -e "  ${G}✓${NC}  $*"; }
info(){ echo -e "  ${DIM}→${NC}  $*"; }
warn(){ echo -e "  ${Y}⚠${NC}  $*"; }
h()   { echo -e "\n${BOLD}$*${NC}"; }

h "═══ PowerZoid Claude — Instalador ═══"

# ── Requisitos ────────────────────────────────────────────────────
command -v python3 &>/dev/null || { echo -e "${R}Error:${NC} instala python3 primero"; exit 1; }

# ── 1. Extensión GNOME Shell ──────────────────────────────────────
h "1. Extensión GNOME Shell"
mkdir -p "$EXTENSION_DIR"
cp "$DIR/extension/metadata.json"  "$EXTENSION_DIR/"
cp "$DIR/extension/extension.js"   "$EXTENSION_DIR/"
cp "$DIR/extension/stylesheet.css" "$EXTENSION_DIR/"
ok "Archivos instalados en $EXTENSION_DIR"

# Habilitar
if command -v gnome-extensions &>/dev/null; then
    gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null || true
    ok "Extensión habilitada"
fi

# ── 2. Herramientas CLI ───────────────────────────────────────────
h "2. Herramientas CLI"
mkdir -p "$BIN_DIR"
cp "$DIR/companion/powerzoid-claude"                 "$BIN_DIR/powerzoid-claude"
cp "$DIR/companion/powerzoid-claude-server"          "$BIN_DIR/powerzoid-claude-server"
cp "$DIR/companion/powerzoid-claude-poller"          "$BIN_DIR/powerzoid-claude-poller"
cp "$DIR/companion/powerzoid-claude-credits-poller"  "$BIN_DIR/powerzoid-claude-credits-poller"
chmod +x "$BIN_DIR"/powerzoid-claude*
ok "powerzoid-claude, powerzoid-claude-server, powerzoid-claude-poller, powerzoid-claude-credits-poller → $BIN_DIR"

# PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    warn "$BIN_DIR no está en tu PATH."
    echo -e "     Agrega a ~/.bashrc:  ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

# ── 3. Servicios systemd ──────────────────────────────────────────
h "3. Servicios systemd"
mkdir -p "$SERVICE_DIR"
cp "$DIR/companion/powerzoid-claude-server.service"          "$SERVICE_DIR/"
cp "$DIR/companion/powerzoid-claude-poller.service"          "$SERVICE_DIR/"
cp "$DIR/companion/powerzoid-claude-poller.timer"            "$SERVICE_DIR/"
cp "$DIR/companion/powerzoid-claude-credits-poller.service"  "$SERVICE_DIR/"
cp "$DIR/companion/powerzoid-claude-credits-poller.timer"    "$SERVICE_DIR/"
systemctl --user daemon-reload

# Servidor HTTP local
systemctl --user enable --now powerzoid-claude-server.service 2>/dev/null || true
systemctl --user is-active --quiet powerzoid-claude-server.service \
    && ok "Servidor HTTP activo (puerto 7891)" \
    || warn "Servidor no arrancó — inícialo con: systemctl --user start powerzoid-claude-server"

# Poller cada 5 minutos
systemctl --user enable --now powerzoid-claude-poller.timer 2>/dev/null || true
systemctl --user is-active --quiet powerzoid-claude-poller.timer \
    && ok "Poller activo (cada 5 min, sin necesitar el navegador)" \
    || warn "Timer no arrancó — inícialo con: systemctl --user start powerzoid-claude-poller.timer"

# Ejecutar poller ahora para tener datos inmediatamente
info "Obteniendo uso actual desde claude.ai…"
"$BIN_DIR/powerzoid-claude-poller" 2>/dev/null && ok "Datos obtenidos" || warn "No se pudieron obtener datos (abre Firefox con claude.ai primero)"

# Créditos de la API (Playwright) — requiere login manual una sola vez
if python3 -c "import playwright" &>/dev/null; then
    systemctl --user enable --now powerzoid-claude-credits-poller.timer 2>/dev/null || true
    ok "Poller de créditos de API instalado (cada 30 min)"
    warn "Falta iniciar sesión una vez:  powerzoid-claude-credits-poller --login"
else
    warn "Playwright no está instalado — el poller de créditos de API no funcionará."
    echo -e "     Instálalo con:"
    echo -e "       ${BOLD}pip install --user playwright${NC}"
    echo -e "       ${BOLD}python3 -m playwright install chromium${NC}"
    echo -e "     Luego: ${BOLD}systemctl --user enable --now powerzoid-claude-credits-poller.timer${NC}"
fi

# ── Resumen ───────────────────────────────────────────────────────
USERSCRIPT="$(cd "$DIR" && pwd)/userscript/powerzoid-claude-monitor.user.js"

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  ✓ Instalación completa — falta un paso manual       ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}Paso 1:${NC} Instala Violentmonkey en tu navegador"
echo -e "  Firefox: ${DIM}https://addons.mozilla.org/es/firefox/addon/violentmonkey/${NC}"
echo -e "  Chrome:  ${DIM}https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegedbjkdiaebcehnmendek${NC}"
echo ""
echo -e "${BOLD}Paso 2:${NC} Instala el userscript — abre esta URL en el navegador:"
echo -e "  ${BOLD}file://${USERSCRIPT}${NC}"
echo -e "  ${DIM}(Violentmonkey lo detecta y pregunta si instalarlo)${NC}"
echo ""
echo -e "${BOLD}Paso 3:${NC} Cierra sesión y vuelve a entrar para cargar la extensión GNOME"
echo -e "  ${DIM}(necesario en Wayland — solo la primera vez)${NC}"
echo ""
echo -e "${BOLD}Paso 4:${NC} Inicia sesión una vez para ver tus créditos de la API automáticamente"
echo -e "  ${BOLD}powerzoid-claude-credits-poller --login${NC}"
echo -e "  ${DIM}(abre un navegador, inicias sesión en platform.claude.com y listo — se actualiza solo cada 30 min)${NC}"
echo ""
echo -e "${DIM}Estado:   gnome-extensions info $EXTENSION_UUID${NC}"
echo -e "${DIM}Logs:     journalctl --user -u powerzoid-claude-server -f${NC}"
echo -e "${DIM}Poller:   journalctl --user -u powerzoid-claude-poller -f${NC}"
echo -e "${DIM}Créditos: journalctl --user -u powerzoid-claude-credits-poller -f${NC}"
echo ""
