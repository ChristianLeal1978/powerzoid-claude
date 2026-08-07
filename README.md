# Claude Usage Monitor — Extensión GNOME Shell

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
git clone https://github.com/cnavarro/claude-usage-gnome
cd claude-usage-gnome

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

### Comando `claude-usage`

```bash
# Forma más rápida: solo el porcentaje
claude-usage set 75

# Con detalle completo (recomendado)
claude-usage set --used 150 --limit 200 --model "Claude Sonnet 4.5" --plan "Pro"

# Incluyendo cuándo se resetea
claude-usage set --used 150 --limit 200 --reset-at "mañana 09:00"

# Ver estado en la terminal
claude-usage status

# Cuando se resetea tu sesión al inicio del día
claude-usage reset

# Resetear y anotar la próxima fecha
claude-usage reset --reset-at "09:00 del 09/06/2026"
```

### Créditos de la API de Anthropic

Anthropic **no expone una API pública** para consultar el saldo de créditos de tu cuenta
(solo se ve en [console.anthropic.com](https://console.anthropic.com)). Por eso, igual que
con el uso de sesión, lo registras manualmente y la extensión lo muestra:

```bash
# Solo el saldo restante
claude-usage credits 42.50

# Con el total asignado/comprado (para ver una barra de progreso)
claude-usage credits 42.50 --total 100

# Ver el saldo guardado
claude-usage credits
```

Aparece como una línea adicional en el menú desplegable y también en `claude-usage status`.

### Flujo típico de uso

1. Abres Claude.ai y trabajas normalmente
2. Cuando ves el indicador de uso en la interfaz de Claude (e.g., "75 de 200 mensajes")
3. Abres una terminal y ejecutas:
   ```bash
   claude-usage set --used 75 --limit 200
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
~/.local/share/claude-usage/usage.json
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

## ¿Por qué no se actualiza solo?

Claude.ai **no tiene una API pública** para consultar los límites de sesión de un usuario.
Esta extensión usa un archivo local que tú actualizas con el CLI. Es la única forma confiable
sin depender de scraping (que es frágil y puede violar los términos de servicio).

Si en el futuro Anthropic publica una API para esto, se puede agregar la funcionalidad
con `claude-usage fetch` — el comando ya está preparado para ello.

---

## Desinstalar

```bash
bash install.sh --uninstall   # próximamente

# O manualmente:
gnome-extensions disable claude-usage@cnavarro.cl
rm -rf ~/.local/share/gnome-shell/extensions/claude-usage@cnavarro.cl
rm ~/.local/bin/claude-usage
rm -rf ~/.local/share/claude-usage    # ← solo si quieres borrar los datos
```

---

## Licencia

MIT — úsalo, modifícalo y distribúyelo libremente.
