/**
 * Claude Usage Monitor — extension.js
 * Compatible con GNOME Shell 45-48 (Fedora 42-44)
 *
 * Lee el porcentaje de uso desde:
 *   ~/.local/share/claude-usage/usage.json
 *
 * Formato esperado del JSON:
 *   {
 *     "percentage": 75,
 *     "used": 150,
 *     "limit": 200,
 *     "model": "Claude Sonnet 4.5",
 *     "plan": "Pro",
 *     "reset_at": "mañana 09:00",
 *     "updated_at": "14:30 08/06/2026"
 *   }
 */

import GLib    from 'gi://GLib';
import Gio     from 'gi://Gio';
import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Extension }    from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu   from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu   from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main        from 'resource:///org/gnome/shell/ui/main.js';

// ── Configuración ──────────────────────────────────────────────────────────
const USAGE_FILE_PARTS  = ['.local', 'share', 'claude-usage', 'usage.json'];
const REFRESH_SECONDS   = 30;   // intervalo de refresco por timer
const ICON_NEUTRAL      = '⬡';  // hexágono (logo Anthropic)
const ICON_LOW          = '🟢';
const ICON_MED          = '🟡';
const ICON_HIGH         = '🔴';

// ── Helpers ────────────────────────────────────────────────────────────────
function usageFilePath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ...USAGE_FILE_PARTS]);
}

function usageDirPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ...USAGE_FILE_PARTS.slice(0, -1)]);
}

function pctToIcon(pct) {
    if (pct >= 90) return ICON_HIGH;
    if (pct >= 60) return ICON_MED;
    return ICON_LOW;
}

function buildProgressBar(pct, width = 20) {
    const filled = Math.round(Math.min(100, Math.max(0, pct)) / 100 * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

// ── Indicador ──────────────────────────────────────────────────────────────
const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {

    _init() {
        super._init(0.0, 'Claude Usage Monitor');

        // ── Widget en la barra superior ──
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });

        this._iconLabel = new St.Label({
            text: ICON_NEUTRAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-usage-icon',
        });

        this._pctLabel = new St.Label({
            text: ' ─ ─',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-usage-pct',
        });

        box.add_child(this._iconLabel);
        box.add_child(this._pctLabel);
        this.add_child(box);

        // ── Menú desplegable ──
        this._buildMenu();

        // ── Inicialización ──
        GLib.mkdir_with_parents(usageDirPath(), 0o755);
        this._refresh();
        this._setupFileMonitor();
        this._startTimer();
    }

    // ── Construcción del menú ──────────────────────────────────────────────
    _buildMenu() {
        // Nombre del modelo
        this._menuModel = new PopupMenu.PopupMenuItem('  Claude', { reactive: false });
        this._menuModel.label.style_class = 'claude-menu-model';
        this.menu.addMenuItem(this._menuModel);

        // Barra de progreso (texto Unicode)
        this._menuBar = new PopupMenu.PopupMenuItem('', { reactive: false });
        this._menuBar.label.style_class = 'claude-menu-bar';
        this.menu.addMenuItem(this._menuBar);

        // Línea de mensajes usados / límite
        this._menuStats = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._menuStats);

        // Fecha de reset y última actualización
        this._menuReset = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._menuReset);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Botón: Actualizar
        const refreshItem = new PopupMenu.PopupMenuItem('↻  Actualizar ahora');
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        // Botón: Abrir Claude.ai
        const openItem = new PopupMenu.PopupMenuItem('↗  Abrir Claude.ai');
        openItem.connect('activate', () => {
            try {
                Gio.AppInfo.launch_default_for_uri('https://claude.ai', null);
            } catch (e) { /* ignorar */ }
        });
        this.menu.addMenuItem(openItem);

        // Botón: Ayuda del CLI
        const helpItem = new PopupMenu.PopupMenuItem('?  Cómo actualizar el uso…');
        helpItem.connect('activate', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(
                    'https://github.com/cnavarro/claude-usage-gnome#uso', null
                );
            } catch (e) { /* ignorar */ }
        });
        this.menu.addMenuItem(helpItem);
    }

    // ── Monitoreo de archivo ───────────────────────────────────────────────
    _setupFileMonitor() {
        try {
            const dirFile = Gio.File.new_for_path(usageDirPath());
            this._fileMonitor = dirFile.monitor_directory(
                Gio.FileMonitorFlags.NONE, null
            );
            this._fileMonitor.connect('changed', (_mon, file, _other, event) => {
                if (file.get_basename() === 'usage.json' &&
                    (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                     event === Gio.FileMonitorEvent.CREATED)) {
                    this._refresh();
                }
            });
        } catch (e) {
            log(`[Claude Usage] Monitor de archivo: ${e.message}`);
        }
    }

    // ── Timer de refresco ─────────────────────────────────────────────────
    _startTimer() {
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_SECONDS,
            () => { this._refresh(); return GLib.SOURCE_CONTINUE; }
        );
    }

    // ── Tiempo hasta el reset ────────────────────────────────────────────
    _timeUntil(isoString) {
        if (!isoString) return '';
        try {
            const resetMs = new Date(isoString).getTime();
            const nowMs   = Date.now();
            const diffMs  = resetMs - nowMs;
            if (diffMs <= 0) return '↺';
            const totalMin = Math.floor(diffMs / 60000);
            const hours    = Math.floor(totalMin / 60);
            const mins     = totalMin % 60;
            return hours > 0
                ? `${hours}:${String(mins).padStart(2, '0')}h`
                : `${mins}m`;
        } catch (_) {
            return '';
        }
    }

    // ── Lectura y renderizado ─────────────────────────────────────────────
    _refresh() {
        try {
            const file = Gio.File.new_for_path(usageFilePath());

            if (!file.query_exists(null)) {
                this._renderEmpty('Sin datos · ejecuta: claude-usage set <n>');
                return;
            }

            const [ok, raw] = file.load_contents(null);
            if (!ok) { this._renderEmpty('Error al leer el archivo'); return; }

            const data = JSON.parse(new TextDecoder().decode(raw));
            this._renderData(data);

        } catch (e) {
            log(`[Claude Usage] Error al refrescar: ${e.message}`);
            this._renderEmpty(`Error: ${e.message}`);
        }
    }

    _renderData(d) {
        const pct    = Math.min(100, Math.max(0, Number(d.percentage) || 0));
        const used   = d.used   !== undefined ? d.used   : '?';
        const limit  = d.limit  !== undefined ? d.limit  : '?';
        const model  = d.model  ?? 'Claude';
        const plan   = d.plan   ? ` · ${d.plan}` : '';
        const resetAt = d.reset_at  ?? 'N/D';
        const updAt   = d.updated_at ?? '';

        // ── Barra superior ──
        const timeLeft = this._timeUntil(d.reset_at_iso || '');
        this._iconLabel.set_text(pctToIcon(pct));
        this._pctLabel.set_text(
            timeLeft ? ` ${pct}% · ${timeLeft}` : ` ${pct}%`
        );

        // ── Menú ──
        this._menuModel.label.set_text(`  ${model}${plan}`);

        const bar = buildProgressBar(pct);
        this._menuBar.label.set_text(`  ${bar}  ${pct}%`);

        this._menuStats.label.set_text(`  Mensajes: ${used} / ${limit}`);

        let resetLine = `  Reset: ${resetAt}`;
        if (updAt) resetLine += `   ·   ${updAt}`;
        this._menuReset.label.set_text(resetLine);
    }

    _renderEmpty(msg = 'Sin datos') {
        this._iconLabel.set_text(ICON_NEUTRAL);
        this._pctLabel.set_text(' ─ ─');
        this._menuModel.label.set_text('  Claude Usage Monitor');
        this._menuBar.label.set_text(`  ${msg}`);
        this._menuStats.label.set_text('');
        this._menuReset.label.set_text('  Comando: claude-usage set 75');
    }

    // ── Limpieza ──────────────────────────────────────────────────────────
    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
        super.destroy();
    }
});

// ── Clase principal de la extensión ───────────────────────────────────────
export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new ClaudeIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
