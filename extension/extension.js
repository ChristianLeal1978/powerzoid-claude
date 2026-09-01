/**
 * PowerZoid Claude — extension.js
 * Compatible con GNOME Shell 45-48 (Fedora 42-44)
 *
 * Lee el porcentaje de uso desde:
 *   ~/.local/share/powerzoid-claude/usage.json
 *
 * Formato esperado del JSON:
 *   {
 *     "percentage": 75,
 *     "used": 150,
 *     "limit": 200,
 *     "model": "Claude Sonnet 4.5",
 *     "plan": "Pro",
 *     "reset_at": "mañana 09:00",
 *     "updated_at": "14:30 08/06/2026",
 *     "api_credits_usd": 48.41,
 *     "usage_credits_balance_usd": 7.57
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
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

// ── Configuración ──────────────────────────────────────────────────────────
const USAGE_FILE_PARTS  = ['.local', 'share', 'powerzoid-claude', 'usage.json'];
const REFRESH_SECONDS   = 30;   // intervalo de refresco por timer
const ICON_NEUTRAL      = '⬡';  // hexágono (logo Anthropic)
const ICON_LOW          = '🟢';
const ICON_MED          = '🟡';
const ICON_HIGH         = '🔴';

const DESKTOP_UPDATE_SCRIPT_PARTS = ['.local', 'bin', 'update-claude-desktop.sh'];

const VALID_ALIGNS   = ['left', 'center', 'right'];
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE     = 8;
const MAX_FONT_SIZE     = 20;

const CONFIG_DIR_PARTS  = ['.config', 'powerzoid-claude'];
const POSITION_FILE     = 'panel-position';
const FONT_SIZE_FILE    = 'font-size';

// ── Helpers ────────────────────────────────────────────────────────────────
function usageFilePath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ...USAGE_FILE_PARTS]);
}

function usageDirPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ...USAGE_FILE_PARTS.slice(0, -1)]);
}

function desktopUpdateScriptPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ...DESKTOP_UPDATE_SCRIPT_PARTS]);
}

function configDirPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), ...CONFIG_DIR_PARTS]);
}

function panelPositionPath() {
    return GLib.build_filenamev([configDirPath(), POSITION_FILE]);
}

function fontSizePath() {
    return GLib.build_filenamev([configDirPath(), FONT_SIZE_FILE]);
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

function formatUsd(amount) {
    const n = Number(amount);
    return n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

// Color según el saldo restante: verde por defecto, amarillo <= $20, rojo <= $10.
const MONEY_COLOR_OK   = '#a6e3a1';
const MONEY_COLOR_WARN = '#f9e2af';
const MONEY_COLOR_LOW  = '#f38ba8';

function moneyColor(amount) {
    const n = Number(amount);
    if (n <= 10) return MONEY_COLOR_LOW;
    if (n <= 20) return MONEY_COLOR_WARN;
    return MONEY_COLOR_OK;
}

// ── Indicador ──────────────────────────────────────────────────────────────
const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {

    _init(extension, initialAlign = 'left', initialFontSize = DEFAULT_FONT_SIZE) {
        super._init(0.0, 'PowerZoid Claude');

        this._ext          = extension;
        this._currentAlign = initialAlign;
        this._fontSize     = initialFontSize;
        this._fontSizeItem = null;
        this._alignItems   = {};

        // ── Widget en la barra superior ──
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });

        this._creditsPanelLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'powerzoid-claude-credits-panel',
        });
        this._creditsPanelLabel.visible = false;

        this._iconLabel = new St.Label({
            text: ICON_NEUTRAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'powerzoid-claude-icon',
        });

        this._pctLabel = new St.Label({
            text: ' ─ ─',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'powerzoid-claude-pct',
        });

        this._usageCreditsPanelLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'powerzoid-claude-overuse-panel',
        });
        this._usageCreditsPanelLabel.visible = false;

        box.add_child(this._creditsPanelLabel);
        box.add_child(this._iconLabel);
        box.add_child(this._pctLabel);
        box.add_child(this._usageCreditsPanelLabel);
        this.add_child(box);

        // ── Menú desplegable ──
        this._buildMenu();

        // ── Inicialización ──
        GLib.mkdir_with_parents(usageDirPath(), 0o755);
        this._refresh();
        this._setupFileMonitor();
        this._startTimer();

        // ── Actualización de Claude Desktop ──
        this._desktopUpdateInfo = null;
        this._desktopUpdateChecking = false;
    }

    // ── Construcción del menú ──────────────────────────────────────────────
    _buildMenu() {
        // Nombre del modelo
        this._menuModel = new PopupMenu.PopupMenuItem('  Claude', { reactive: false });
        this._menuModel.label.style_class = 'powerzoid-claude-menu-model';
        this.menu.addMenuItem(this._menuModel);

        // Barra de progreso (texto Unicode)
        this._menuBar = new PopupMenu.PopupMenuItem('', { reactive: false });
        this._menuBar.label.style_class = 'powerzoid-claude-menu-bar';
        this.menu.addMenuItem(this._menuBar);

        // Línea de mensajes usados / límite
        this._menuStats = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._menuStats);

        // Fecha de reset y última actualización
        this._menuReset = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._menuReset);

        // Créditos de API restantes (opcional, entrada manual)
        this._menuCredits = new PopupMenu.PopupMenuItem('', { reactive: false });
        this._menuCredits.visible = false;
        this.menu.addMenuItem(this._menuCredits);

        // Saldo de "usage credits" (claude.ai, cubre excedentes del plan)
        this._menuUsageCreditsBalance = new PopupMenu.PopupMenuItem('', { reactive: false });
        this._menuUsageCreditsBalance.visible = false;
        this.menu.addMenuItem(this._menuUsageCreditsBalance);

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
                    'https://github.com/ChristianLeal1978/powerzoid-claude#uso', null
                );
            } catch (e) { /* ignorar */ }
        });
        this.menu.addMenuItem(helpItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Submenú de alineación ─────────────────────────────────────────
        this._posSubMenu = new PopupMenu.PopupSubMenuMenuItem('Posición en barra');
        this.menu.addMenuItem(this._posSubMenu);

        [
            ['← Alinear a la izquierda', 'left'],
            ['↔ Alinear al centro',       'center'],
            ['→ Alinear a la derecha',    'right'],
        ].forEach(([label, align]) => {
            const item = new PopupMenu.PopupMenuItem(label);
            this._alignItems[align] = item;
            item.connect('activate', () => this._setAlignment(align));
            this._posSubMenu.menu.addMenuItem(item);
        });
        this._updateAlignMarks(this._currentAlign);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Tamaño de letra ────────────────────────────────────────────
        this._fontSizeItem = new PopupMenu.PopupMenuItem(this._fontSizeLabel(), { reactive: false });
        this._fontSizeItem.label.set_style('color: #aaa; font-style: italic;');
        this.menu.addMenuItem(this._fontSizeItem);

        const increaseItem = new PopupMenu.PopupMenuItem('A+   Aumentar letra');
        increaseItem.connect('activate', () => this._changeFontSize(1));
        this.menu.addMenuItem(increaseItem);

        const decreaseItem = new PopupMenu.PopupMenuItem('A−   Reducir letra');
        decreaseItem.connect('activate', () => this._changeFontSize(-1));
        this.menu.addMenuItem(decreaseItem);

        const resetItem = new PopupMenu.PopupMenuItem('↺    Restablecer tamaño');
        resetItem.connect('activate', () => {
            this._fontSize = DEFAULT_FONT_SIZE;
            this._fontSizeItem?.label.set_text(this._fontSizeLabel());
            this._ext.saveFontSize(this._fontSize);
            this._refresh();
        });
        this.menu.addMenuItem(resetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Botón: Actualización de Claude Desktop (chequeo manual)
        this._desktopUpdateItem = new PopupMenu.PopupMenuItem('↻  Revisar versión de Claude Desktop');
        this._desktopUpdateItem.connect('activate', () => this._onDesktopUpdateActivate());
        this.menu.addMenuItem(this._desktopUpdateItem);
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
            log(`[PowerZoid Claude] Monitor de archivo: ${e.message}`);
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

    // ── Alineación ─────────────────────────────────────────────────────────
    _setAlignment(align) {
        if (align === this._currentAlign) return;
        this._ext.savePanelPosition(align);

        // Reinicio completo de la extensión: evita bugs de rendering al
        // reubicar actores directamente entre boxes del panel.
        const uuid = this._ext.uuid;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            Main.extensionManager.disableExtension(uuid);
            Main.extensionManager.enableExtension(uuid);
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateAlignMarks(activeAlign) {
        Object.entries(this._alignItems).forEach(([align, item]) => {
            item.setOrnament(
                align === activeAlign ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE
            );
        });
    }

    // ── Tamaño de letra ───────────────────────────────────────────────────
    _fontSizeLabel() {
        return `Tamaño: ${this._fontSize} px`;
    }

    _changeFontSize(delta) {
        this._fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, this._fontSize + delta));
        this._fontSizeItem?.label.set_text(this._fontSizeLabel());
        this._ext.saveFontSize(this._fontSize);
        this._refresh();
    }

    _iconStyle() {
        return `font-size: ${this._fontSize + 1}px;`;
    }

    _pctStyle() {
        return `font-size: ${this._fontSize}px;`;
    }

    _creditsPanelStyle(color) {
        return `font-size: ${this._fontSize}px; color: ${color};`;
    }

    _overusePanelStyle(color) {
        return `font-size: ${this._fontSize}px; color: ${color};`;
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
            const days     = Math.floor(totalMin / 1440);
            const hours    = Math.floor((totalMin % 1440) / 60);
            const mins     = totalMin % 60;
            if (days > 0)  return `${days}d ${hours}h`;
            if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}`;
            return `${mins}m`;
        } catch (_) {
            return '';
        }
    }

    // ── Lectura y renderizado ─────────────────────────────────────────────
    _refresh() {
        try {
            const file = Gio.File.new_for_path(usageFilePath());

            if (!file.query_exists(null)) {
                this._renderEmpty('Sin datos · ejecuta: powerzoid-claude set <n>');
                return;
            }

            const [ok, raw] = file.load_contents(null);
            if (!ok) { this._renderEmpty('Error al leer el archivo'); return; }

            const data = JSON.parse(new TextDecoder().decode(raw));
            this._renderData(data);

        } catch (e) {
            log(`[PowerZoid Claude] Error al refrescar: ${e.message}`);
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
        this._iconLabel.set_style(this._iconStyle());
        this._pctLabel.set_text(
            timeLeft ? ` ${pct}% · ${timeLeft}` : ` ${pct}%`
        );
        this._pctLabel.set_style(this._pctStyle());

        const panelCredits = d.api_credits_usd;
        if (panelCredits !== undefined && panelCredits !== null) {
            this._creditsPanelLabel.set_text(`💳 $${Number(panelCredits).toFixed(2)} `);
            this._creditsPanelLabel.set_style(this._creditsPanelStyle(moneyColor(panelCredits)));
            this._creditsPanelLabel.visible = true;
        } else {
            this._creditsPanelLabel.visible = false;
        }

        const panelBalance = d.usage_credits_balance_usd;
        if (panelBalance !== undefined && panelBalance !== null) {
            this._usageCreditsPanelLabel.set_text(` 💰 ${formatUsd(panelBalance)}`);
            this._usageCreditsPanelLabel.set_style(this._overusePanelStyle(moneyColor(panelBalance)));
            this._usageCreditsPanelLabel.visible = true;
        } else {
            this._usageCreditsPanelLabel.visible = false;
        }

        // ── Menú ──
        this._menuModel.label.set_text(`  ${model}${plan}`);

        const bar = buildProgressBar(pct);
        this._menuBar.label.set_text(`  ${bar}  ${pct}%`);

        this._menuStats.label.set_text(`  Mensajes: ${used} / ${limit}`);

        let resetLine = `  Reset: ${resetAt}`;
        if (updAt) resetLine += `   ·   ${updAt}`;
        this._menuReset.label.set_text(resetLine);

        // ── Créditos de API (opcional) ──
        const credits = d.api_credits_usd;
        if (credits !== undefined && credits !== null) {
            const total = d.api_credits_total_usd;
            const text  = total
                ? `  💳 Créditos API: $${Number(credits).toFixed(2)} / $${Number(total).toFixed(2)}`
                : `  💳 Créditos API: $${Number(credits).toFixed(2)}`;
            this._menuCredits.label.set_text(text);
            this._menuCredits.label.set_style(`color: ${moneyColor(credits)};`);
            this._menuCredits.visible = true;
        } else {
            this._menuCredits.visible = false;
        }

        // ── Saldo de usage credits (claude.ai) ──
        const balance = d.usage_credits_balance_usd;
        if (balance !== undefined && balance !== null) {
            this._menuUsageCreditsBalance.label.set_text(
                `  💰 Usage credits: ${formatUsd(balance)}`
            );
            this._menuUsageCreditsBalance.label.set_style(`color: ${moneyColor(balance)};`);
            this._menuUsageCreditsBalance.visible = true;
        } else {
            this._menuUsageCreditsBalance.visible = false;
        }
    }

    _renderEmpty(msg = 'Sin datos') {
        this._iconLabel.set_text(ICON_NEUTRAL);
        this._iconLabel.set_style(this._iconStyle());
        this._pctLabel.set_text(' ─ ─');
        this._pctLabel.set_style(this._pctStyle());
        this._menuModel.label.set_text('  PowerZoid Claude');
        this._menuBar.label.set_text(`  ${msg}`);
        this._menuStats.label.set_text('');
        this._menuReset.label.set_text('  Comando: powerzoid-claude set 75');
        this._menuCredits.visible = false;
        this._creditsPanelLabel.visible = false;
        this._menuUsageCreditsBalance.visible = false;
        this._usageCreditsPanelLabel.visible = false;
    }

    // ── Actualización de Claude Desktop (chequeo manual) ──────────────────
    _onDesktopUpdateActivate() {
        if (this._desktopUpdateChecking) return;

        // Si ya sabemos que hay actualización disponible, este clic la dispara.
        if (this._desktopUpdateInfo?.update_available) {
            this._launchDesktopUpdateTerminal();
            return;
        }

        // Si no, este clic dispara (o reintenta) el chequeo de versión.
        this._checkDesktopUpdate();
    }

    _checkDesktopUpdate() {
        if (this._desktopUpdateChecking) return;

        const scriptPath = desktopUpdateScriptPath();
        if (!GLib.file_test(scriptPath, GLib.FileTest.IS_EXECUTABLE)) {
            this._renderDesktopUpdateError();
            return;
        }

        this._desktopUpdateChecking = true;
        this._desktopUpdateItem.label.set_text('↻  Revisando Claude Desktop…');
        this._desktopUpdateItem.setSensitive(false);

        let proc;
        try {
            proc = Gio.Subprocess.new(
                [scriptPath, '--check', '--json'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) {
            log(`[PowerZoid Claude] No se pudo iniciar la verificación de Claude Desktop: ${e.message}`);
            this._desktopUpdateChecking = false;
            this._renderDesktopUpdateError();
            return;
        }

        proc.communicate_utf8_async(null, null, (source, res) => {
            this._desktopUpdateChecking = false;
            try {
                const [, stdout] = source.communicate_utf8_finish(res);
                const data = JSON.parse(stdout.trim());
                if (data.error) throw new Error(data.error);
                this._desktopUpdateInfo = data;
                this._renderDesktopUpdate(data);
            } catch (e) {
                log(`[PowerZoid Claude] Error al verificar Claude Desktop: ${e.message}`);
                this._renderDesktopUpdateError();
            }
        });
    }

    _renderDesktopUpdate(data) {
        if (data.update_available) {
            const verb = data.installed === 'no-instalado' ? 'Instalar' : 'Actualizar a';
            this._desktopUpdateItem.label.set_text(`⬇  ${verb} Claude Desktop v${data.latest}`);
        } else {
            this._desktopUpdateItem.label.set_text(`✓  Claude Desktop al día (v${data.installed})`);
        }
        this._desktopUpdateItem.setSensitive(true);
    }

    _renderDesktopUpdateError() {
        this._desktopUpdateInfo = null;
        this._desktopUpdateItem.label.set_text('⚠  No se pudo verificar Claude Desktop (reintentar)');
        this._desktopUpdateItem.setSensitive(true);
    }

    _launchDesktopUpdateTerminal() {
        const scriptPath = desktopUpdateScriptPath();
        const innerCmd = `${GLib.shell_quote(scriptPath)} --yes; echo; ` +
            `read -p "Presiona Enter para cerrar..."`;

        const bin = GLib.find_program_in_path('gnome-terminal') ??
            GLib.find_program_in_path('kgx') ??
            GLib.find_program_in_path('ptyxis');

        if (!bin) {
            this._notifyDesktopUpdateError(
                'No se encontró un emulador de terminal (gnome-terminal, kgx o ptyxis).'
            );
            return;
        }

        try {
            Gio.Subprocess.new([bin, '--', 'bash', '-c', innerCmd], Gio.SubprocessFlags.NONE);
        } catch (e) {
            log(`[PowerZoid Claude] No se pudo abrir terminal para actualizar: ${e.message}`);
            this._notifyDesktopUpdateError('No se pudo abrir el emulador de terminal.');
        }
    }

    _notifyDesktopUpdateError(msg) {
        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source({
                title: 'PowerZoid Claude',
                iconName: 'dialog-error-symbolic',
            });
            Main.messageTray.add(this._notifSource);
        }

        const notification = new MessageTray.Notification({
            source: this._notifSource,
            title: 'Claude Desktop',
            body: msg,
            iconName: 'dialog-error-symbolic',
        });
        this._notifSource.addNotification(notification);
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
export default class PowerZoidClaudeExtension extends Extension {
    enable() {
        const align    = this._loadPanelPosition();
        const fontSize = this._loadFontSize();
        this._indicator = new ClaudeIndicator(this, align, fontSize);
        Main.panel.addToStatusArea(this.uuid, this._indicator, -1, align);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }

    // ── Alineación ──────────────────────────────────────────────────────
    _loadPanelPosition() {
        try {
            const file = Gio.File.new_for_path(panelPositionPath());
            const [, bytes] = file.load_contents(null);
            const val = new TextDecoder().decode(bytes).trim();
            return VALID_ALIGNS.includes(val) ? val : 'left';
        } catch (_e) {}
        return 'left';
    }

    savePanelPosition(align) {
        try {
            Gio.File.new_for_path(configDirPath()).make_directory_with_parents(null);
        } catch (_e) {}
        try {
            const file = Gio.File.new_for_path(panelPositionPath());
            file.replace_contents(
                new TextEncoder().encode(align),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (_e) {}
    }

    // ── Tamaño de letra ────────────────────────────────────────────────
    _loadFontSize() {
        try {
            const file = Gio.File.new_for_path(fontSizePath());
            const [, bytes] = file.load_contents(null);
            const val = parseInt(new TextDecoder().decode(bytes).trim(), 10);
            if (Number.isInteger(val))
                return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, val));
        } catch (_e) {}
        return DEFAULT_FONT_SIZE;
    }

    saveFontSize(size) {
        try {
            Gio.File.new_for_path(configDirPath()).make_directory_with_parents(null);
        } catch (_e) {}
        try {
            const file = Gio.File.new_for_path(fontSizePath());
            file.replace_contents(
                new TextEncoder().encode(String(size)),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (_e) {}
    }
}
