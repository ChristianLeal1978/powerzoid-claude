// ==UserScript==
// @name         Claude Usage Monitor
// @namespace    https://github.com/cnavarro/claude-usage-gnome
// @version      1.3.1
// @description  Lee el uso de mensajes y el saldo de Usage credits de Claude.ai y los envía al servidor local para mostrarlos en GNOME Shell
// @author       Christian Navarro
// @match        https://claude.ai/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SERVER_URL  = 'http://127.0.0.1:7891/update';
    const DEBUG       = true;

    // ── Estado ───────────────────────────────────────────────────────────
    let lastPayloadKey  = null;
    let sendHookApplied = false;

    // ────────────────────────────────────────────────────────────────────
    // EXTRACCIÓN DE USO DESDE EL DOM
    // ────────────────────────────────────────────────────────────────────

    function extractUsage() {
        return tryProgressBar() || tryTextPatterns() || null;
    }

    function tryProgressBar() {
        for (const bar of document.querySelectorAll('[role="progressbar"]')) {
            const now = bar.getAttribute('aria-valuenow');
            const max = bar.getAttribute('aria-valuemax');
            const min = parseFloat(bar.getAttribute('aria-valuemin') || '0');
            if (now === null) continue;
            const nowF = parseFloat(now);
            const maxF = max ? parseFloat(max) : 100;
            const pct  = maxF > 0 ? Math.round((nowF - min) / (maxF - min) * 100) : nowF;
            if (pct < 0 || pct > 100) continue;
            dbg('progressBar', { now, max, pct });
            return { percentage: pct, used: nowF, limit: maxF };
        }
        return null;
    }

    const PATTERNS = [
        { re: /\b(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+messages?\b/i,   parse: (m) => usedOfLimit(m[1], m[2]) },
        { re: /\b(\d[\d,]*)\s+de\s+(\d[\d,]*)\s+mensajes?\b/i,   parse: (m) => usedOfLimit(m[1], m[2]) },
        { re: /\b(\d[\d,]*)\s+messages?\s+remaining\b/i,          parse: (m, ctx) => remaining(m[1], ctx) },
        { re: /\b(\d[\d,]*)\s+mensajes?\s+restantes\b/i,          parse: (m, ctx) => remaining(m[1], ctx) },
        { re: /\b([\d.]+)\s*%\s*(?:of\s+(?:your\s+)?(?:usage\s+)?limit|used|de\s+uso)?\b/i,
          parse: (m) => { const p = parseFloat(m[1]); return (p>=0 && p<=100) ? {percentage:p} : null; } },
    ];

    function usedOfLimit(a, b) {
        const used = parseInt(a.replace(/,/g,''), 10), limit = parseInt(b.replace(/,/g,''), 10);
        if (!limit) return null;
        return { percentage: Math.min(100, Math.round(used/limit*100)), used, limit };
    }

    function remaining(rawR, ctx) {
        const r = parseInt(rawR.replace(/,/g,''), 10);
        const m = ctx.match(/(?:out of|of|\/)\s*(\d[\d,]*)/i);
        if (!m) return null;
        const limit = parseInt(m[1].replace(/,/g,''), 10);
        return usedOfLimit(String(limit - r), String(limit));
    }

    function tryTextPatterns() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => ['SCRIPT','STYLE','NOSCRIPT'].includes(n.parentElement?.tagName)
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent.trim();
            if (text.length < 3 || text.length > 300) continue;
            for (const {re, parse} of PATTERNS) {
                const m = text.match(re);
                if (m) { const r = parse(m, text); if (r) { dbg('textPattern', {text,r}); return r; } }
            }
        }
        return null;
    }

    // "Usage credits" (settings/usage): el monto aparece ANTES de la etiqueta,
    // ej. "$7.57 \n Current balance". Es independiente del % de uso: se manda
    // como campo aparte cuando aparece, sin pisar el resto del payload.
    function tryUsageCreditsBalance() {
        const text = document.body.innerText || '';
        const m = text.match(/\$([\d,]+\.\d{2})[\s\S]{0,50}?Current balance/i);
        if (!m) return null;
        return parseFloat(m[1].replace(/,/g, ''));
    }

    function detectModel() {
        const sels = [
            '[data-testid="model-selector-dropdown"] [data-testid="model-name"]',
            '[data-testid="model-selector"]',
            'button[aria-haspopup="listbox"] span',
        ];
        for (const s of sels) {
            const t = document.querySelector(s)?.textContent?.trim();
            if (t) return t.slice(0, 50);
        }
        const m = document.body.innerText?.match(/Claude\s+(?:Opus|Sonnet|Haiku)[\s\d.]*/i);
        return m ? m[0].trim().slice(0, 50) : undefined;
    }

    // ────────────────────────────────────────────────────────────────────
    // ENVÍO AL SERVIDOR
    // ────────────────────────────────────────────────────────────────────

    function sendToServer(usage, trigger) {
        const payload = { ...usage };
        const model   = detectModel();
        if (model) payload.model = model;

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
        const usage   = extractUsage();
        const balance = tryUsageCreditsBalance();

        const payload = {};
        if (usage) Object.assign(payload, usage);
        if (balance !== null) payload.usage_credits_balance_usd = balance;

        if (Object.keys(payload).length > 0) sendToServer(payload, trigger);
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

    // 2. Hook en el botón de envío de Claude
    //    Se reaplicará si el DOM cambia (el botón puede recrearse)
    function applySendHook() {
        // Selectores conocidos del botón de envío de Claude
        const sendSelectors = [
            'button[aria-label="Send message"]',
            'button[aria-label="Enviar mensaje"]',
            'button[data-testid="send-button"]',
            'button[type="submit"]',
        ];
        let found = false;
        for (const sel of sendSelectors) {
            document.querySelectorAll(sel).forEach(btn => {
                if (btn.dataset.cuHooked) return;
                btn.dataset.cuHooked = '1';
                btn.addEventListener('click', () => {
                    dbg('event', 'send button clicked');
                    // Verificar varias veces: respuesta puede tardar
                    setTimeout(() => checkAndSend('send+2s'),   2000);
                    setTimeout(() => checkAndSend('send+6s'),   6000);
                    setTimeout(() => checkAndSend('send+15s'), 15000);
                });
                found = true;
            });
        }
        // Escuchar Enter en el textarea también
        document.querySelectorAll('textarea').forEach(ta => {
            if (ta.dataset.cuHooked) return;
            ta.dataset.cuHooked = '1';
            ta.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    setTimeout(() => checkAndSend('enter+2s'),   2000);
                    setTimeout(() => checkAndSend('enter+6s'),   6000);
                    setTimeout(() => checkAndSend('enter+15s'), 15000);
                }
            });
        });
        return found;
    }

    // 3. MutationObserver: re-aplicar hooks cuando el DOM cambie,
    //    y capturar cuando aparezca el indicador de uso
    let mutationDebounce = null;
    const observer = new MutationObserver(() => {
        clearTimeout(mutationDebounce);
        mutationDebounce = setTimeout(() => {
            applySendHook();
            // Solo intentar captura si la pestaña está visible
            if (!document.hidden) checkAndSend('mutation');
        }, 800);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Check inicial
    applySendHook();
    checkAndSend('init');

    console.info('[Claude Usage Monitor v1.3] Activo');
    dbg('debug', 'modo debug activado');

    function dbg(label, data) {
        if (DEBUG) console.debug(`[CU] ${label}`, data);
    }

})();
