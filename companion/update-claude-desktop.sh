#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  update-claude-desktop.sh — Chequeo/actualización de Claude Desktop
#  vía dnf, para el botón "Revisar versión de Claude Desktop" de la
#  extensión GNOME PowerZoid Claude.
#
#  Uso:
#    update-claude-desktop.sh --check [--json]   # solo consulta
#    update-claude-desktop.sh --yes              # actualiza (pide sudo)
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

PKG="claude-desktop-unofficial"
REPO="claude-desktop"

mode=""
json=false
for arg in "$@"; do
    case "$arg" in
        --check) mode="check";;
        --yes)   mode="update";;
        --json)  json=true;;
        *) echo "Argumento desconocido: $arg" >&2; exit 1;;
    esac
done

if [[ -z "$mode" ]]; then
    echo "Uso: $0 --check [--json] | --yes" >&2
    exit 1
fi

json_error() {
    printf '{"error":"%s"}\n' "$1"
}

installed_version() {
    rpm -q --qf '%{version}-%{release}\n' "$PKG" 2>/dev/null | head -n1
}

if [[ "$mode" == "check" ]]; then
    installed="$(installed_version || true)"
    if [[ -z "$installed" ]]; then
        if $json; then json_error "$PKG no está instalado"; else echo "$PKG no está instalado"; fi
        exit 0
    fi

    set +e
    check_out="$(dnf -y --repo="$REPO" check-update "$PKG" 2>/dev/null)"
    rc=$?
    set -e

    case "$rc" in
        0)
            latest="$installed"
            available=false
            ;;
        100)
            latest="$(awk -v pkg="$PKG" '$1 ~ "^"pkg"\\." {print $2; exit}' <<<"$check_out")"
            [[ -z "$latest" ]] && latest="$installed"
            available=true
            ;;
        *)
            if $json; then json_error "No se pudo consultar el repositorio $REPO (dnf salió con $rc)"; else echo "Error al consultar el repositorio (código $rc)"; fi
            exit 0
            ;;
    esac

    if $json; then
        printf '{"installed":"%s","latest":"%s","update_available":%s}\n' "$installed" "$latest" "$available"
    else
        if $available; then
            echo "Actualización disponible: $installed → $latest"
        else
            echo "Claude Desktop al día (v$installed)"
        fi
    fi

elif [[ "$mode" == "update" ]]; then
    echo "Actualizando $PKG vía dnf (repo: $REPO)…"
    sudo dnf upgrade -y --repo="$REPO" "$PKG"
fi
