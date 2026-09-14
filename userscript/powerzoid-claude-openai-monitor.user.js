// ==UserScript==
// @name         PowerZoid Claude — OpenAI Monitor
// @namespace    https://github.com/ChristianLeal1978/powerzoid-claude
// @version      1.2.0
// @description  Lee el saldo de créditos de OpenAI (platform.openai.com) y lo envía al servidor local para mostrarlo en GNOME Shell. Recarga la pestaña sola cada cierto tiempo para no requerir abrirla a mano.
// @author       Christian Navarro
// @match        https://platform.openai.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SERVER_URL        = 'http://127.0.0.1:7891/update';
    const DEBUG              = true;
    const RELOAD_INTERVAL_MS = 15 * 60 * 1000; // recarga la pestaña para que la SPA vuelva a pedir el saldo real

    let lastPayloadKey = null;

    function dbg(label, data) {
        if (DEBUG) console.debug(`[PowerZoid OpenAI] ${label}`, data);
    }

    // ────────────────────────────────────────────────────────────────────
    // EXTRACCIÓN DEL SALDO DESDE EL DOM
    // ────────────────────────────────────────────────────────────────────

    // El Home / Billing overview de platform.openai.com muestra una tarjeta
    // con la etiqueta "Credit balance" seguida (arriba o abajo, según el
    // layout) de un monto "$XX.XX". Se busca en el texto plano de la página
    // para no depender de la estructura exacta del DOM.
    function extractCreditBalance() {
        const text = document.body.innerText || '';
        const m = text.match(/Credit balance[\s\S]{0,200}?\$([\d,]+\.\d{2})/i);
        if (!m) return null;
        return parseFloat(m[1].replace(/,/g, ''));
    }

    // ────────────────────────────────────────────────────────────────────
    // ENVÍO AL SERVIDOR
    // ────────────────────────────────────────────────────────────────────

    function sendToServer(balance, trigger, force) {
        const payload = { openai_credits_usd: balance };
        const key = JSON.stringify(payload);
        // El check inicial ('init', forzado) se reenvía siempre, aunque el
        // saldo no haya cambiado: así se refresca el timestamp en el servidor
        // y la extensión no lo marca como desactualizado. Los demás triggers
        // (mutation/visibility) sí deduplican para no spamear el servidor.
        if (!force && key === lastPayloadKey) return;
        lastPayloadKey = key;

        dbg('send', { trigger, payload });

        GM_xmlhttpRequest({
            method  : 'POST',
            url     : SERVER_URL,
            headers : { 'Content-Type': 'application/json' },
            data    : JSON.stringify(payload),
            onerror : () => dbg('send', 'servidor no disponible'),
        });
    }

    function checkAndSend(trigger, force) {
        const balance = extractCreditBalance();
        if (balance !== null) sendToServer(balance, trigger, force);
        else dbg('check', `sin datos (${trigger})`);
    }

    // ────────────────────────────────────────────────────────────────────
    // EVENTOS CLAVE
    // ────────────────────────────────────────────────────────────────────

    // 1. La pestaña vuelve a ser visible → captura inmediata
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            dbg('event', 'tab visible');
            setTimeout(() => checkAndSend('visibility'), 300);
        }
    });

    // 2. MutationObserver: el saldo puede tardar en aparecer (carga async del
    //    dashboard) o cambiar de tarjeta al navegar entre secciones (SPA).
    let mutationDebounce = null;
    const observer = new MutationObserver(() => {
        clearTimeout(mutationDebounce);
        mutationDebounce = setTimeout(() => {
            if (!document.hidden) checkAndSend('mutation');
        }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Check inicial. Forzado: si el saldo quedó igual al de la última recarga,
    // igual hay que reenviarlo para refrescar el timestamp en el servidor
    // (mismo motivo que el fix de créditos de Anthropic en b23609c).
    checkAndSend('init', true);

    // 3. Recarga periódica mientras la pestaña quede abierta: a diferencia de
    // solo reenviar el mismo valor extraído al cargar, esto hace que la SPA
    // vuelva a pedirle el saldo al backend de OpenAI, así el monto mostrado
    // no queda congelado en lo que había cuando se abrió la pestaña por
    // primera vez. No requiere volver a abrir la página a mano.
    setInterval(() => location.reload(), RELOAD_INTERVAL_MS);

    console.info('[PowerZoid Claude — OpenAI Monitor v1.2.0] Activo');
    dbg('debug', 'modo debug activado');

})();
