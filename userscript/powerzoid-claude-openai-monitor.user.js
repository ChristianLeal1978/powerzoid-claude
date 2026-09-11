// ==UserScript==
// @name         PowerZoid Claude — OpenAI Monitor
// @namespace    https://github.com/ChristianLeal1978/powerzoid-claude
// @version      1.0.0
// @description  Lee el saldo de créditos de OpenAI (platform.openai.com) y lo envía al servidor local para mostrarlo en GNOME Shell
// @author       Christian Navarro
// @match        https://platform.openai.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SERVER_URL       = 'http://127.0.0.1:7891/update';
    const DEBUG             = true;
    const POLL_INTERVAL_MS  = 5 * 60 * 1000; // reintento periódico (además de los eventos)

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

    function sendToServer(balance, trigger) {
        const payload = { openai_credits_usd: balance };
        const key = JSON.stringify(payload);
        if (key === lastPayloadKey) return;
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

    function checkAndSend(trigger) {
        const balance = extractCreditBalance();
        if (balance !== null) sendToServer(balance, trigger);
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

    // Check inicial
    checkAndSend('init');

    // 3. Reintento periódico mientras la pestaña quede abierta y quieta.
    setInterval(() => checkAndSend('interval'), POLL_INTERVAL_MS);

    console.info('[PowerZoid Claude — OpenAI Monitor v1.0] Activo');
    dbg('debug', 'modo debug activado');

})();
