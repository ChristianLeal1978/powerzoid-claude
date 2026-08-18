# PowerZoid Claude — Extensión GNOME Shell

Muestra el **porcentaje de uso de tu sesión de Claude** directamente en la barra superior de GNOME.

```
🟢 43%    ← indicador en la barra superior
```

Al hacer clic se despliega:

```
  Claude Sonnet 4.5  ·  Pro
  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░  43%

  Mensajes: 86 / 200
  Reset: mañana 09:00   ·   14:30  08/06/2026

  💳 Créditos API: $42.50 / $100.00
  ─────────────────────────────
  ↻  Actualizar ahora
  ↗  Abrir Claude.ai
```

---

## Requisitos

- **Fedora 44** con GNOME Shell 48 (o Fedora 42/43 con GNOME 46/47)
- Python 3 (incluido en Fedora)

---

## Instalación

```bash
# 1. Clona o descarga este repositorio
git clone https://github.com/ChristianLeal1978/powerzoid-claude
cd powerzoid-claude

# 2. Ejecuta el instalador
bash install.sh

# 3. Reinicia GNOME Shell
# Presiona Alt+F2, escribe 'r', presiona Enter
# (si usas Wayland, debes cerrar y volver a abrir sesión)

# 4. Verifica que la extensión esté habilitada
gnome-extensions list --enabled
```

---

## Uso diario

### Comando `powerzoid-claude`

```bash
# Forma más rápida: solo el porcentaje
powerzoid-claude set 75

# Con detalle completo (recomendado)
powerzoid-claude set --used 150 --limit 200 --model "Claude Sonnet 4.5" --plan "Pro"

# Incluyendo cuándo se resetea
powerzoid-claude set --used 150 --limit 200 --reset-at "mañana 09:00"

# Ver estado en la terminal
powerzoid-claude status

# Cuando se resetea tu sesión al inicio del día
powerzoid-claude reset

# Resetear y anotar la próxima fecha
powerzoid-claude reset --reset-at "09:00 del 09/06/2026"
```

### Créditos de la API de Anthropic (automático)

Anthropic **no expone una API pública** para consultar el saldo de créditos de tu cuenta
(solo se ve en el Dashboard de [platform.claude.com](https://platform.claude.com/dashboard),
en la tarjeta "Organization credits"). Para no tener que copiarlo a mano, `powerzoid-claude-credits-poller`
usa un navegador Chromium controlado por [Playwright](https://playwright.dev/) con una sesión
propia y persistente para leerlo automáticamente.

**Instalación (una sola vez):**

```bash
pip install --user playwright
python3 -m playwright install chromium
```

**Inicia sesión una sola vez** (se abre un navegador visible; inicias sesión normalmente
en `platform.claude.com` y vuelves a la terminal a presionar Enter):

```bash
powerzoid-claude-credits-poller --login
```

La sesión queda guardada en `~/.local/share/powerzoid-claude/browser-profile` — un perfil de
Chromium dedicado que no toca tu navegador normal. Desde ahí, el timer de systemd
(`powerzoid-claude-credits-poller.timer`) consulta el saldo cada 30 minutos en segundo plano,
sin ventanas visibles:

```bash
systemctl --user status powerzoid-claude-credits-poller.timer
journalctl --user -u powerzoid-claude-credits-poller -f   # ver logs
powerzoid-claude-credits-poller                            # forzar una consulta ahora
```

Si la sesión expira (cookies vencidas), el poller lo indica en el log — vuelve a correr
`--login` y sigue automático.

El saldo aparece como una línea en el menú desplegable de la extensión y en `powerzoid-claude status`.

**Alternativa manual** (si prefieres no usar Playwright, o para corregir el valor a mano):

```bash
powerzoid-claude credits 42.50
powerzoid-claude credits 42.50 --total 100   # con el total, para ver una barra de progreso
powerzoid-claude credits                     # ver el valor guardado
```

### Flujo típico de uso

1. Abres Claude.ai y trabajas normalmente
2. Cuando ves el indicador de uso en la interfaz de Claude (e.g., "75 de 200 mensajes")
3. Abres una terminal y ejecutas:
   ```bash
   powerzoid-claude set --used 75 --limit 200
   ```
4. La barra superior de GNOME se actualiza automáticamente en segundos

---

## Indicadores de color

| Color | Significado          |
|-------|----------------------|
| 🟢    | Uso bajo  (< 60%)    |
| 🟡    | Uso medio (60–89%)   |
| 🔴    | Uso alto  (≥ 90%)    |
| ⬡     | Sin datos            |

---

## Formato del archivo de datos

El CLI y la extensión comparten este archivo:
```
~/.local/share/powerzoid-claude/usage.json
```

Puedes editarlo directamente:
```json
{
  "percentage": 75.0,
  "used": 150,
  "limit": 200,
  "model": "Claude Sonnet 4.5",
  "plan": "Pro",
  "reset_at": "mañana 09:00",
  "updated_at": "14:30  08/06/2026",
  "api_credits_usd": 42.50,
  "api_credits_total_usd": 100.0,
  "api_credits_updated_at": "14:30  08/06/2026"
}
```

---

## ¿Por qué no se actualiza solo desde una API oficial?

Ni el uso de sesión de Claude.ai ni el saldo de créditos de la API tienen un endpoint público
documentado por Anthropic. Por eso esta extensión combina tres fuentes, de más a menos directa:

1. **`powerzoid-claude set`** — entrada manual, siempre funciona como respaldo.
2. **`powerzoid-claude-poller`** — lee las cookies de sesión de tu navegador (Firefox/Chrome/Vivaldi)
   y consulta el endpoint interno que usa la propia web de claude.ai.
3. **`powerzoid-claude-credits-poller`** — usa un navegador Chromium controlado por Playwright,
   con tu propia sesión iniciada una vez, para leer el saldo desde el Dashboard del Console.

Las opciones 2 y 3 dependen de la estructura interna de las páginas de Anthropic y pueden
romperse si esta cambia — en ese caso, `powerzoid-claude set` / `powerzoid-claude credits` siguen
funcionando como respaldo manual. Si en el futuro Anthropic publica APIs oficiales para
esto, `powerzoid-claude fetch` ya está preparado para usarlas.

---

## Desinstalar

```bash
bash install.sh --uninstall   # próximamente

# O manualmente:
gnome-extensions disable powerzoid-claude@cleal.cl
rm -rf ~/.local/share/gnome-shell/extensions/powerzoid-claude@cleal.cl
systemctl --user disable --now powerzoid-claude-poller.timer powerzoid-claude-credits-poller.timer powerzoid-claude-server.service
rm ~/.local/bin/powerzoid-claude ~/.local/bin/powerzoid-claude-server ~/.local/bin/powerzoid-claude-poller ~/.local/bin/powerzoid-claude-credits-poller
rm ~/.config/systemd/user/powerzoid-claude-*.{service,timer}
rm -rf ~/.local/share/powerzoid-claude    # ← borra datos y la sesión del navegador de créditos
```

---

## Licencia

MIT — úsalo, modifícalo y distribúyelo libremente.
