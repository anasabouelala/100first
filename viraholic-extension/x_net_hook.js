/*
 * x_net_hook.js — MAIN-world passive interceptor for X (Twitter).
 *
 * WHY: Driving X's reply editor from JS is a dead end — Draft.js only commits
 * its editorState (which enables the Post button) on a *real* caret/keystroke
 * or a renderer-level trusted insert (CDP). A synthetic execCommand puts text
 * in the DOM but never enables the button. So instead of fighting the editor,
 * we REPLAY X's own CreateTweet GraphQL request using the user's live session.
 *
 * This script runs in the page's MAIN world (so it can wrap window.fetch /
 * XHR that X itself uses) and PASSIVELY captures the exact request the real
 * client sends when the user posts — URL (with queryId), headers (bearer,
 * csrf, client-transaction-id), and JSON body (variables + features). It NEVER
 * blocks or mutates the real request; it just forwards a copy to the isolated
 * content script via window.postMessage, which caches it for replay.
 *
 * No chrome.* APIs are available in MAIN world — hence the postMessage bridge.
 */
(function () {
    'use strict';
    if (window.__answerlyXHookInstalled) return;
    window.__answerlyXHookInstalled = true;

    // Match the CreateTweet mutation (replies use this too). Also accept the
    // long-form note tweet just in case the user composes via that path.
    function isCreateTweet(url) {
        return typeof url === 'string' &&
            /\/graphql\/[^/?]+\/(CreateTweet|CreateNoteTweet)\b/.test(url);
    }

    function publish(template) {
        try { window.postMessage({ source: 'ANSWERLY_X_CAPTURE', template: template }, '*'); } catch (_) {}
    }

    function headersToObj(h) {
        const out = {};
        try {
            if (!h) return out;
            if (typeof h.forEach === 'function') { h.forEach((v, k) => { out[String(k).toLowerCase()] = v; }); return out; }
            if (Array.isArray(h)) { h.forEach(pair => { if (pair && pair.length === 2) out[String(pair[0]).toLowerCase()] = pair[1]; }); return out; }
            if (typeof h === 'object') { for (const k in h) out[String(k).toLowerCase()] = h[k]; }
        } catch (_) {}
        return out;
    }

    // ── Wrap fetch (X's primary transport) ──
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
            try {
                const url = (typeof input === 'string') ? input : (input && input.url) || '';
                if (isCreateTweet(url)) {
                    const headers = Object.assign(
                        headersToObj(input && input.headers),
                        headersToObj(init && init.headers)
                    );
                    const body = (init && typeof init.body === 'string') ? init.body : null;
                    const method = (init && init.method) || (input && input.method) || 'POST';
                    if (body) publish({ url: url, method: method, headers: headers, body: body, capturedAt: Date.now() });
                }
            } catch (_) {}
            return origFetch.apply(this, arguments);
        };
    }

    // ── Wrap XHR (belt-and-suspenders) ──
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
        const open = XHR.prototype.open;
        const setHeader = XHR.prototype.setRequestHeader;
        const send = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
            try { this.__answerlyReq = { method: method, url: url, headers: {} }; } catch (_) {}
            return open.apply(this, arguments);
        };
        XHR.prototype.setRequestHeader = function (k, v) {
            try { if (this.__answerlyReq) this.__answerlyReq.headers[String(k).toLowerCase()] = v; } catch (_) {}
            return setHeader.apply(this, arguments);
        };
        XHR.prototype.send = function (body) {
            try {
                const r = this.__answerlyReq;
                if (r && isCreateTweet(r.url) && typeof body === 'string') {
                    publish({ url: r.url, method: r.method || 'POST', headers: r.headers || {}, body: body, capturedAt: Date.now() });
                }
            } catch (_) {}
            return send.apply(this, arguments);
        };
    }
})();
