/**
 * Viraholic Engagement Agent v4.1
 * Injected into social platforms to perform stealth interactions.
 * Simulates human biometrics: Bezier mouse paths, gaussian delays,
 * typo simulation, wheel events, and realistic click sequences.
 *
 * v4.1 changes:
 *  - Structured instrumentation at every doComment step. Every log line
 *    is tagged `[AUTO-COMMENT]` and includes the platform, step name,
 *    and the payload that step received/produced. When you test, open
 *    the stealth popup's devtools console and you'll see exactly where
 *    the flow halts.
 *  - LinkedIn selector hardening: scope `aria-label*="Comment"` to the
 *    article and add fallback selectors for newer DOM.
 *  - Quill / contenteditable robustness: dispatch InputEvent in addition
 *    to execCommand so React-controlled editors see the value change.
 *  - Submit-readiness polling: don't check `.disabled` once — poll for
 *    up to 4s in case the framework re-renders after input events.
 *  - Post-submit verification: after clicking submit, look for our text
 *    in a newly rendered comment node before reporting success. Catches
 *    silent failures (anti-spam, hidden captcha, etc.).
 */
(function() {
    const LOG = (step, payload) => {
        try { console.info('[AUTO-COMMENT]', step, payload || ''); }
        catch (_) { /* console may be locked down in iframes */ }
        // ALSO forward the trace to the background service-worker console. The
        // engagement window is a short-lived popup whose console is destroyed the
        // moment the window closes, so in-page logs are invisible for debugging.
        // The SW console persists and is inspectable in chrome://extensions →
        // "Inspect views: service worker" — this is where the user can actually
        // SEE which insert method (cdp / execCommand / paste) won or failed.
        try {
            chrome.runtime.sendMessage({ type: 'AGENT_LOG', step, payload: payload || null }, () => { void chrome.runtime.lastError; });
        } catch (_) { /* SW may be asleep; in-page log above still fired */ }
    };

    // Platform-specific selectors
    const PLATFORMS = {
        'x.com': {
            likeSelector: '[data-testid="like"], [aria-label*="Like"]',
            alreadyLikedSelector: '[data-testid="unlike"], [aria-label*="Liked"]',
            replyTrigger: '[data-testid="reply"], [aria-label*="Reply"]',
            replyBoxSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content',
            replyButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
            commentVerifySelector: '[data-testid="tweetText"]',
            // Repost / Quote (the retweet button opens a menu with "Repost" and "Quote")
            repostTrigger: '[data-testid="retweet"], [aria-label*="Repost"], [aria-label*="repost" i]',
            repostConfirmSelector: '[data-testid="retweetConfirm"]',
            alreadyRepostedSelector: '[data-testid="unretweet"]',
            quoteComposerSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content',
            quoteButtonSelector: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'
        },
        'twitter.com': {
            likeSelector: '[data-testid="like"], [aria-label*="Like"]',
            alreadyLikedSelector: '[data-testid="unlike"], [aria-label*="Liked"]',
            replyTrigger: '[data-testid="reply"], [aria-label*="Reply"]',
            replyBoxSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content',
            replyButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
            commentVerifySelector: '[data-testid="tweetText"]',
            repostTrigger: '[data-testid="retweet"], [aria-label*="Repost"], [aria-label*="repost" i]',
            repostConfirmSelector: '[data-testid="retweetConfirm"]',
            alreadyRepostedSelector: '[data-testid="unretweet"]',
            quoteComposerSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content',
            quoteButtonSelector: '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'
        },
        'linkedin.com': {
            // Like: class-based (react-button) is language-agnostic; aria-label
            // variants cover EN "Like", FR "J'aime"/"aimer", DE "Gefällt mir",
            // ES "Recomendar", IT "Consiglia", AR "أعجبني"/"إعجاب".
            likeSelector: 'button.react-button__trigger, .reactions-react-button button, button[aria-label*="Like" i], button[aria-label*="aime" i], button[aria-label*="Gefällt" i], button[aria-label*="Recomendar" i], button[aria-label*="Consiglia" i], button[aria-label*="إعجاب"], button[aria-label*="أعجب"]',
            alreadyLikedSelector: 'button.react-button__trigger--active, button[aria-pressed="true"].react-button__trigger, button[aria-pressed="true"][aria-label*="Like" i], button[aria-pressed="true"][aria-label*="aime" i], button[aria-pressed="true"][aria-label*="إعجاب"]',
            // Expanded LinkedIn reply triggers. The aria-label is sometimes
            // "Comment on …" (starts-with), sometimes contains "Comment" elsewhere.
            // We also accept the social-actions container's comment icon.
            // Class-based (.comment-button / social-actions-button) is
            // language-agnostic; aria-label variants cover EN/FR/DE/ES/IT/AR.
            replyTrigger: 'button.comment-button, .artdeco-button--tertiary.comment-button, button.social-actions-button[aria-label*="comment" i], button[aria-label*="Comment" i], button[aria-label*="commenter" i], button[aria-label*="commentaire" i], button[aria-label*="Kommentar" i], button[aria-label*="Comentar" i], button[aria-label*="Commenta" i], button[aria-label*="تعليق"], button[aria-label*="علّق"], button[aria-label*="علق"]',
            // NEW home feed: the comment button has NO aria-label and NO class —
            // only the visible label "Commenter"/"Comment". Selector-based lookup
            // misses it entirely (this is why feed commenting did nothing), so we
            // fall back to a text scan on the action bar. Covers EN/FR/DE/ES/IT/AR.
            replyTriggerTextRe: /^(commenter|comment|kommentieren|comentar|commenta|تعليق|علّق|علق)$/i,
            // Comment editor differs by surface:
            //  • Permalink / old feed  → Quill  (.ql-editor[contenteditable]).
            //  • New home feed inline  → TipTap/ProseMirror
            //    (div[role="textbox"][contenteditable] inside the tiptap wrapper).
            replyBoxSelector: '[data-testid="ui-core-tiptap-text-editor-wrapper"] [contenteditable="true"], div.tiptap.ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"][aria-label*="comment" i], [role="textbox"][contenteditable="true"][aria-label*="commentaire" i], .ql-editor[contenteditable="true"], .comments-comment-box__content-editor [contenteditable="true"], .comments-comment-box__content-editor',
            // Submit button class was renamed (…__submit-button--cr) and the new
            // feed inline composer has NO stable class and NO <form>. Match by
            // class-prefix where possible; the runtime also falls back to a
            // text scan ("Comment"/"Commenter"/"Publier"/"Post") within the card.
            replyButtonSelector: 'button[class*="comments-comment-box__submit-button"]:not([disabled]), .comments-comment-box__dispatch-area button[type="submit"]:not([disabled]), button[class*="comments-comment-box__submit-button"], .comments-comment-box__dispatch-area button[type="submit"]',
            // Text scan fallback for the submit button (new inline composer).
            // EN/FR/DE/ES/IT/AR submit-label variants.
            replyButtonTextRe: /^(comment|commenter|publier|post|répondre|reply|kommentieren|comentar|publicar|commenta|pubblica|نشر|تعليق|انشر)$/i,
            commentVerifySelector: '.comments-comment-item__main-content, .comments-comment-item .feed-shared-text, [data-testid="expandable-text-box"]'
        },
        'reddit.com': {
            likeSelector: 'button[aria-label="upvote"], [data-click-id="upvote"]',
            alreadyLikedSelector: 'button[aria-pressed="true"][aria-label="upvote"], .upvoted',
            replyTrigger: 'button[aria-label*="Reply"], [data-click-id="body"] .reply-button',
            replyBoxSelector: '.public-DraftEditor-content, shreddit-composer textarea, textarea[placeholder*="thoughts"]',
            replyButtonSelector: 'button[type="submit"], shreddit-composer [slot="submit-button"]',
            commentVerifySelector: '[data-testid="comment"]'
        },
        'producthunt.com': {
            // NOTE: `button:contains("Reply")` was an invalid CSS selector
            // (`:contains` is jQuery, not native). It silently never matched.
            // Use a real attribute-based selector instead.
            likeSelector: 'button[aria-label*="upvote"], button.vote-button',
            alreadyLikedSelector: 'button[aria-pressed="true"][aria-label*="upvote"]',
            replyTrigger: 'button[aria-label*="Reply" i], .reply-button',
            replyBoxSelector: 'textarea[placeholder*="comment" i], .comment-box',
            replyButtonSelector: 'button[type="submit"]',
            commentVerifySelector: '[data-test*="comment"]'
        }
    };

    // Virtual cursor position tracking
    const cursor = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };

    // Gaussian random (Box-Muller) — looks human, uniform random does not
    function g(mean, std) {
        let u = 0, v = 0;
        while (!u) u = Math.random();
        while (!v) v = Math.random();
        return Math.max(0, (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) * std + mean);
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Element is "visible" if it has layout AND is in the viewport-reachable
    // DOM. `offsetParent === null` alone is a false-negative for fixed/sticky
    // containers — fall back to getBoundingClientRect dimensions.
    function isVisible(el) {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    async function waitForElement(sel, timeout = 15000) {
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const el = document.querySelector(sel);
            if (el && isVisible(el)) return el;
            await sleep(500);
        }
        LOG('waitForElement TIMEOUT', { selector: sel, timeoutMs: timeout });
        return null;
    }

    // Query a selector scoped to a container (or document if scope is null).
    async function waitForElementIn(scope, sel, timeout = 8000) {
        const root = scope || document;
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const el = root.querySelector(sel);
            if (el && isVisible(el)) return el;
            await sleep(400);
        }
        LOG('waitForElementIn TIMEOUT', { selector: sel, scoped: !!scope, timeoutMs: timeout });
        return null;
    }

    // ── Wrong-post guard ──
    // The agent navigates to the exact post URL, but on X/Twitter a status
    // page renders the focused tweet PLUS a stream of replies, and a profile
    // URL renders a whole timeline. `document.querySelector('[data-testid="reply"]')`
    // returns the FIRST reply button in the DOM — frequently a different tweet
    // than the one we intend. We resolve the specific <article> that contains
    // a permalink matching the target status id and scope all reply actions to
    // it. If we can't identify it, we return null (caller falls back to the
    // first article in the primary column, which is the focused tweet on a
    // status page).
    function extractStatusId(url) {
        const m = /\/status(?:es)?\/(\d+)/.exec(url || '');
        return m ? m[1] : null;
    }

    async function resolveTargetArticle(postUrl, timeout = 8000) {
        const host = location.hostname.replace(/^www\./, '');
        const isX = host === 'x.com' || host === 'twitter.com';
        if (!isX) return null; // only X needs article scoping for now

        const id = extractStatusId(postUrl) || extractStatusId(location.href);
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article[role="article"], article'));
            if (id) {
                // Prefer the article whose permalink matches the target id.
                const match = articles.find(a => a.querySelector(`a[href*="/status/${id}"]`));
                if (match && isVisible(match)) {
                    LOG('targetArticle.matchedById', { id });
                    return match;
                }
            }
            await sleep(400);
        }

        // No id match — on a status page the focused tweet is the first article
        // in the primary column. Use that rather than the global first match,
        // which could be a promoted/ad tweet outside the column.
        const col = document.querySelector('[data-testid="primaryColumn"]') || document;
        const first = col.querySelector('article[data-testid="tweet"], article[role="article"], article');
        if (first && isVisible(first)) {
            LOG('targetArticle.fallbackFirstInColumn', { hadId: !!id });
            return first;
        }
        LOG('targetArticle.none', { hadId: !!id });
        return null;
    }

    // Extract the author handle from an X status URL (x.com/HANDLE/status/ID).
    function extractXHandle(url) {
        const m = String(url || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//i);
        return m ? m[1].toLowerCase() : null;
    }

    // Read the handles the OPEN composer is replying to. X renders a
    // "Replying to @a @b" line (localized: "En réponse à …") right above the
    // reply editor — inline or in the modal. Returns lowercased handles, or []
    // when no such context is present (e.g. a top-level composer). Used to ABORT
    // when the agent is about to reply to the WRONG tweet (a sub-comment instead
    // of the focal post) — the bug where "it commented a comment of this post".
    function xReplyContextHandles(box) {
        const scope = (box && (box.closest('[role="dialog"]')
            || box.closest('[data-testid="primaryColumn"]'))) || document;
        // Find the "Replying to" container by its text, scoped near the composer.
        const re = /^(replying to|en réponse à|respondiendo a|en réponse|antwort an|in risposta a|الرد على|رد على)/i;
        const candidates = Array.from(scope.querySelectorAll('div, span'))
            .filter(el => isVisible(el) && re.test((el.textContent || '').trim()));
        // Prefer the shallowest match (the context line, not a parent wrapping
        // the whole composer).
        let ctx = null, best = Infinity;
        for (const el of candidates) {
            const depth = (el.textContent || '').length;
            if (depth < best) { best = depth; ctx = el; }
        }
        if (!ctx) return [];
        const handles = new Set();
        // Anchors to /handle inside the context line.
        Array.from(ctx.querySelectorAll('a[href^="/"]')).forEach(a => {
            const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
            if (m) handles.add(m[1].toLowerCase());
        });
        // Fallback: parse @mentions from the visible text.
        (ctx.textContent.match(/@([A-Za-z0-9_]{1,15})/g) || []).forEach(h => handles.add(h.slice(1).toLowerCase()));
        return [...handles];
    }

    // Bezier curve mouse movement
    function bezierPoint(t, p0, p1, p2, p3) {
        const u = 1 - t, tt = t*t, uu = u*u;
        return {
            x: uu*u*p0.x + 3*uu*t*p1.x + 3*u*tt*p2.x + tt*t*p3.x,
            y: uu*u*p0.y + 3*uu*t*p1.y + 3*u*tt*p2.y + tt*t*p3.y
        };
    }

    async function moveTo(tx, ty) {
        const sx = cursor.x, sy = cursor.y;
        const d = Math.hypot(tx - sx, ty - sy);
        if (d < 5) return;

        // Occasional overshoot (15% chance)
        const overshoot = Math.random() < 0.15;
        const ex = overshoot ? tx + (Math.random() - 0.5) * 35 : tx;
        const ey = overshoot ? ty + (Math.random() - 0.5) * 35 : ty;

        const bias = (Math.random() - 0.5) * d * 0.4;
        const p1 = { x: sx + (ex-sx)*0.3 + bias, y: sy + (ey-sy)*0.3 - bias };
        const p2 = { x: sx + (ex-sx)*0.7 - bias, y: sy + (ey-sy)*0.7 + bias };
        const steps = Math.max(8, Math.floor(d / 12));
        const stepTime = g(450, 100) / steps;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
            const pos = bezierPoint(ease, {x:sx,y:sy}, p1, p2, {x:ex,y:ey});
            cursor.x = pos.x; cursor.y = pos.y;
            document.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, clientX: cursor.x, clientY: cursor.y,
                screenX: cursor.x + window.screenX, screenY: cursor.y + window.screenY
            }));
            await sleep(stepTime);
        }

        if (overshoot) {
            await sleep(g(120, 40));
            await moveTo(tx, ty);
        } else {
            cursor.x = tx; cursor.y = ty;
        }
    }

    async function scrollTo(el) {
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= window.innerHeight) return;
        const dist = r.top - window.innerHeight / 2;
        const steps = Math.floor(g(18, 4));
        for (let i = 0; i < steps; i++) {
            const p = i / steps;
            const e = p < 0.5 ? 2*p*p : -1+(4-2*p)*p;
            const delta = (dist / steps) * (1 + (e - p) * 0.4);
            document.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, deltaY: delta, deltaX: 0,
                clientX: cursor.x, clientY: cursor.y
            }));
            window.scrollBy(0, delta);
            await sleep(g(35, 8));
        }
        await sleep(g(400, 100));
    }

    async function click(el) {
        const r = el.getBoundingClientRect();
        const tx = r.left + r.width * (0.25 + Math.random() * 0.5);
        const ty = r.top + r.height * (0.25 + Math.random() * 0.5);
        await moveTo(tx, ty);

        const opts = {
            bubbles: true, cancelable: true, view: window,
            clientX: cursor.x, clientY: cursor.y,
            screenX: cursor.x + window.screenX, screenY: cursor.y + window.screenY
        };
        const ptr = { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
        // Fire the FULL pointer + mouse sequence. Modern React apps (X's tweet
        // button included) bind on pointer events, and a bare mouse `click`
        // alone is frequently ignored. Order matters: over → enter → down → up
        // → click, with pointer events interleaved.
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        try { el.dispatchEvent(new PointerEvent('pointerover', ptr)); } catch {}
        try { el.dispatchEvent(new PointerEvent('pointerenter', ptr)); } catch {}
        await sleep(g(130, 35));
        try { el.dispatchEvent(new PointerEvent('pointerdown', ptr)); } catch {}
        el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
        await sleep(g(75, 20));
        try { el.dispatchEvent(new PointerEvent('pointerup', { ...ptr, buttons: 0 })); } catch {}
        el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        await sleep(g(250, 80));
    }

    // Typing with realistic speed variance and occasional typos
    const NEARBY = {a:'qwsz',s:'awedxz',d:'serfcx',f:'drtgvc',g:'ftyhbv',h:'gyujnb',j:'huikmn',
        k:'jiolm',l:'kop',q:'wa',w:'qeas',e:'wrsd',r:'etdf',t:'ryfg',y:'tugh',u:'yihj',
        i:'uojk',o:'ipkl',p:'ol',z:'asx',x:'zsdc',c:'xdfv',v:'cfgb',b:'vghn',n:'bhjm',m:'njk'};

    // Detect X / Twitter's Draft.js editor. Draft.js owns its own internal
    // ContentState and listens for `beforeinput` to mutate it. Firing BOTH
    // execCommand AND an InputEvent on the same character produces duplicate
    // inserts ("garbage at the start of the comment") — Draft processes both
    // events. Similarly, the typo-simulation backspace can't reliably erase
    // from Draft's internal model via execCommand('delete'), so the typo
    // letters leak into the posted text. We treat Draft.js specially below.
    function isDraftEditor(el) {
        if (!el) return false;
        if (el.classList && el.classList.contains('public-DraftEditor-content')) return true;
        // Walk up — the contenteditable target inside Draft.js often is a child.
        let cur = el;
        for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
            if (cur.classList && cur.classList.contains('public-DraftEditor-content')) return true;
            if (cur.getAttribute && cur.getAttribute('data-testid') === 'tweetTextarea_0') return true;
        }
        return false;
    }

    // Resolve the REAL editable node. data-testid="tweetTextarea_0" is usually
    // the contenteditable itself, but on some X layouts it sits on a wrapper —
    // focusing/typing into the wrapper makes text land "next to" the editor (the
    // placeholder stays, the button never enables). Always descend to the actual
    // .public-DraftEditor-content / [contenteditable] so caret + inserts target
    // the node Draft.js tracks.
    function resolveEditable(el) {
        if (!el) return el;
        if (el.isContentEditable) return el;
        if (el.classList && el.classList.contains('public-DraftEditor-content')) return el;
        const inner = el.querySelector && el.querySelector(
            '.public-DraftEditor-content, [contenteditable="true"], [role="textbox"][contenteditable]'
        );
        return inner || el;
    }

    async function typeChar(el, ch) {
        // NOTE: Draft.js (X) is handled OUT-OF-BAND — see pasteIntoDraft() below.
        // type() routes Draft.js editors through paste before ever reaching this
        // per-char loop, so this function never runs on X. Kept for non-Draft
        // contentEditable (Quill / LinkedIn) and plain inputs/textareas.
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        if (el.isContentEditable) {
            const ok = document.execCommand('insertText', false, ch);
            if (!ok) {
                const sel = window.getSelection();
                if (sel && sel.rangeCount) {
                    const range = sel.getRangeAt(0);
                    range.insertNode(document.createTextNode(ch));
                    range.collapse(false);
                }
            }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        } else {
            const p = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (p) { p.set.call(el, el.value + ch); el.dispatchEvent(new Event('input', { bubbles: true })); }
            else document.execCommand('insertText', false, ch);
        }
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }

    // ── Draft.js content-verified insertion ──
    // X uses Draft.js, a React-controlled contentEditable with an internal
    // ContentState that desyncs from synthetic DOM mutations. The old code
    // ran SEVERAL insertion methods in a fallback chain whose length-only
    // success check could misfire on a stale DOM read — so a slow-but-OK
    // paste would be followed by a SECOND execCommand insert, interleaving
    // at the caret and producing the "WhWeWhW…" garbage. We fix that here:
    //   1. Clear the field first (never append to a stale draft).
    //   2. Try ONE method.
    //   3. Verify by CONTENT (not just length) with multi-frame polling.
    //   4. Only fall back if the field is still effectively empty.
    //   5. If the result doesn't match the intended text, clear and report
    //      failure — we NEVER submit garbage.

    function readDraft(el) {
        // Strip zero-width spaces / BOM Draft sometimes injects into empty blocks.
        return (el.innerText || el.textContent || '').replace(/[​﻿]/g, '');
    }
    // Loose normaliser for comparison — Draft can swap whitespace / add a
    // trailing newline, so we collapse runs of whitespace and trim.
    function normTxt(s) {
        return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    // Did the editor end up holding (approximately) the intended text and
    // nothing extra? Garbage like "WhWeWhW…" is LONGER than the target and
    // won't be a prefix/equal, so this rejects it.
    function draftMatches(observed, intended) {
        const o = normTxt(observed), t = normTxt(intended);
        if (!o) return false;
        if (o === t) return true;
        // Allow Draft to truncate trailing chars (rare) but reject extra
        // leading garbage: require the observed text to be contained in the
        // intended text OR the intended text contained in observed with a
        // tight length tolerance (no more than 3 extra chars).
        if (t.includes(o) && o.length >= t.length * 0.85) return true;
        if (o.includes(t) && o.length <= t.length + 3) return true;
        return false;
    }

    // Select-all + delete to empty the editor. Returns once it reads empty
    // (or after a short bounded wait).
    async function clearDraft(el) {
        try {
            el.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch {}
        try { document.execCommand('delete', false, null); } catch {}
        await sleep(g(120, 30));
        // If anything remains, try one more delete pass.
        if (readDraft(el).trim().length) {
            try { document.execCommand('delete', false, null); } catch {}
            await sleep(g(120, 30));
        }
    }

    // Poll for up to `timeout` ms for the editor content to match `text`.
    async function pollDraftMatch(el, text, timeout = 1600) {
        const t = Date.now();
        let last = '';
        while (Date.now() - t < timeout) {
            last = readDraft(el);
            if (draftMatches(last, text)) return { ok: true, observed: last };
            await sleep(120);
        }
        return { ok: false, observed: last };
    }

    // Is the submit/reply button currently ENABLED? This is the ONLY reliable
    // proxy for "Draft.js editorState actually received the text" — X keeps the
    // tweet/reply button disabled (aria-disabled) until editorState is non-empty.
    // A visible-DOM text match (pollDraftMatch) can be satisfied while editorState
    // is still empty (the classic execCommand-no-op / synthetic-mutation desync),
    // so we treat button-enabled as the source of truth.
    //   returns true  → button found and enabled (editorState definitely has text)
    //   returns false → button found but disabled (editorState still empty)
    //   returns null  → no selector / no button to check (fall back to text-only)
    function submitEnabled(submitSel, scope) {
        if (!submitSel) return null;
        const root = scope || document;
        let cands;
        try { cands = Array.from(root.querySelectorAll(submitSel)); } catch { return null; }
        if (!cands.length) return null;
        const ready = cands.find(el => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
        return !!ready;
    }

    // Poll for BOTH the visible text to match AND the submit button to enable.
    // We only declare success once the button is enabled (editorState truth) —
    // unless there's no button to check, in which case we fall back to text-only.
    async function pollDraftReady(el, text, submitSel, scope, timeout = 1800) {
        const t = Date.now();
        let last = '';
        let lastBtn = null;
        while (Date.now() - t < timeout) {
            last = readDraft(el);
            const textOk = draftMatches(last, text);
            lastBtn = submitEnabled(submitSel, scope);
            // Success = text landed AND button is not still-disabled.
            if (textOk && lastBtn !== false) return { ok: true, observed: last, btn: lastBtn };
            await sleep(120);
        }
        return { ok: false, observed: last, btn: lastBtn };
    }

    // Place a COLLAPSED caret at the end of the editor's content and make sure
    // the editor is the active element. execCommand('insertText') only works
    // when (a) the contentEditable host is focused and (b) there's a live
    // selection inside it — otherwise the command silently no-ops and Draft's
    // editorState never updates (→ submit button stays disabled).
    function placeCaretAtEnd(el) {
        try {
            el.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            // CRITICAL for Draft.js (X): Draft only folds a *trusted* execCommand
            // insert into its editorState — the thing that enables X's Post button —
            // when the selection sits INSIDE its text leaf node. Collapsing onto the
            // contenteditable ROOT (the old selectNodeContents(el)) makes the browser
            // insert visible text while Draft ignores it, so the button stays
            // disabled and we wrongly treat the (actually successful) insert as a
            // miss. So descend to the deepest text-bearing node before collapsing.
            let target = el;
            const leaves = el.querySelectorAll && el.querySelectorAll('span[data-text="true"]');
            if (leaves && leaves.length) target = leaves[leaves.length - 1];
            while (target.lastChild) target = target.lastChild;
            if (target.nodeType === Node.TEXT_NODE) {
                range.setStart(target, target.textContent.length);
                range.collapse(true);
            } else {
                // Empty leaf (a <br> placeholder in an empty editor): collapse to end.
                range.selectNodeContents(target);
                range.collapse(false);
            }
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
        } catch { return false; }
    }

    // ── Trusted-input bridge to the background SW (Chrome DevTools Protocol) ──
    // The SW has attached CDP to this tab for comment/quote on X. These helpers
    // ask it to perform genuinely-trusted input that operates on the renderer's
    // REAL focus/caret — unlike synthetic dispatchEvent, which only fires React
    // handlers and can leave the actual caret elsewhere (→ text in wrong field).
    // Each resolves {success,...}; they never throw.
    function cdpRequest(type, extra) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type, ...(extra || {}) }, (resp) => {
                    if (chrome.runtime.lastError) { resolve({ success: false, error: chrome.runtime.lastError.message }); return; }
                    resolve(resp || { success: false, error: 'no response' });
                });
            } catch (e) { resolve({ success: false, error: String(e) }); }
        });
    }
    let _cdpAvailable = null; // cache per run
    async function cdpAvailable() {
        if (_cdpAvailable !== null) return _cdpAvailable;
        const r = await cdpRequest('CDP_PING');
        _cdpAvailable = !!(r && r.success && r.attached);
        return _cdpAvailable;
    }
    const requestCdpInsert = (text) => cdpRequest('CDP_INSERT_TEXT', { text });
    const requestCdpClick = (x, y) => cdpRequest('CDP_CLICK', { x, y });
    const requestCdpKeyEnter = (useMeta) => cdpRequest('CDP_KEY_ENTER', { useMeta });

    // Trusted click at an element's center via CDP. Moves the visible cursor
    // first (for realism), then issues the real renderer-level click so the
    // browser's actual input focus lands inside `el`.
    async function cdpClickEl(el) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width * (0.3 + Math.random() * 0.4);
        const y = r.top + r.height * (0.4 + Math.random() * 0.2);
        await moveTo(x, y);
        return await requestCdpClick(Math.round(x), Math.round(y));
    }

    // Is the browser's focus actually inside `el` (or its contenteditable child)?
    function isFocusInside(el) {
        const a = document.activeElement;
        if (!a || !el) return false;
        return a === el || el.contains(a) || (a.contains && a.contains(el));
    }

    // Make sure the editor is genuinely focused before we insert. Prefer a
    // trusted CDP click (sets the real caret); fall back to synthetic click +
    // .focus(). Verify document.activeElement landed inside the editor and retry.
    async function ensureEditorFocused(el, useCdp) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try { await scrollTo(el); } catch {}
            if (useCdp) {
                const r = await cdpClickEl(el);
                if (!r.success) { LOG('focus.cdpClick.fail', { err: r.error, attempt }); useCdp = false; }
            }
            if (!useCdp) { try { await click(el); } catch {} }
            try { el.focus(); } catch {}
            placeCaretAtEnd(el);
            const t = Date.now();
            while (Date.now() - t < 900) {
                if (isFocusInside(el)) { LOG('focus.confirmed', { attempt, viaCdp: useCdp }); return true; }
                await sleep(120);
            }
            LOG('focus.retry', { attempt, active: document.activeElement?.getAttribute?.('data-testid') || document.activeElement?.tagName });
        }
        return isFocusInside(el);
    }

    async function pasteIntoDraft(el, text, opts = {}) {
        const { submitSel = null, scope = null } = opts;
        // execCommand('insertText') only fires a trusted input chain when the
        // window/document actually has OS focus. The engagement window is now
        // opened focused for comments, but re-assert it here defensively in
        // case the window lost focus between open and insert.
        try { window.focus(); } catch {}
        el.focus();
        await sleep(g(400, 100));

        // VERIFY THE FOCUS THEORY AT RUNTIME. execCommand('insertText') silently
        // no-ops when document.hasFocus() is false — which is exactly why the
        // reply button can stay disabled ("empty reply bar") even though the
        // window was asked to focus. If this logs hasFocus:false, the OS did NOT
        // grant the shadow engagement window real keyboard focus, so METHOD 1
        // below will fail and we MUST rely on the focus-independent paste path.
        const hadFocus = document.hasFocus();
        LOG('draft.insert.preflight', { hasFocus: hadFocus, active: document.activeElement === el, submitScoped: !!scope });

        // The authoritative success signal is the submit button ENABLING, not a
        // visible-DOM text match — X keeps the button disabled until Draft's
        // editorState is non-empty. pollDraftReady waits for BOTH.
        const verify = (timeout) => pollDraftReady(el, text, submitSel, scope, timeout);

        let res = { ok: false, observed: '', btn: null };

        // METHOD 0 — CDP trusted insert (legacy, OPT-IN). The store build ships
        // WITHOUT the "debugger" permission, so this is normally unavailable and
        // we skip it entirely (no wasted round-trip). It only runs if a build
        // still grants the permission and the SW reports an attached session.
        // The primary path is now METHOD 1 (synthetic paste), which is
        // LIVE-VERIFIED to fold text into Draft's editorState.
        if (await cdpAvailable()) {
            if (readDraft(el).trim().length) await clearDraft(el);
            placeCaretAtEnd(el);
            const cdp = await requestCdpInsert(text);
            if (cdp && cdp.success) {
                LOG('draft.insert.cdp.injected', {});
                res = await verify(2200);
                if (res.ok) { LOG('draft.insert.cdp.OK', { len: res.observed.length, btn: res.btn }); return true; }
                LOG('draft.insert.cdp.miss', { observed: res.observed.slice(0, 60), len: res.observed.length, btn: res.btn });
            } else {
                LOG('draft.insert.cdp.unavailable', { err: cdp?.error });
            }
        } else {
            LOG('draft.insert.cdp.skipped', { reason: 'no debugger permission — using synthetic paste' });
        }

        // METHOD 1 — synthetic paste ClipboardEvent (PRIMARY). LIVE-VERIFIED as
        // the one insert Draft.js actually folds into editorState under our exact
        // runtime conditions: document.hasFocus()===false AND an empty editor with
        // zero text leaves. Draft's React onPaste handler reads
        // clipboardData.getData('text/plain') and commits it to editorState —
        // which creates a real text leaf (leafCount 0→1), clears the "Post your
        // reply" placeholder, and ENABLES the Reply button. This is exactly what
        // execCommand could NOT do: execCommand wrote visible DOM text that Draft
        // never saw, so the placeholder stayed and the button stayed disabled —
        // the user's "typing in the wrong place / empty box, button unavailable"
        // bug. So paste goes FIRST and execCommand is demoted to last-resort.
        //
        // CRITICAL: only clear when there's genuine stale text. Running
        // execCommand('delete') on an ALREADY-EMPTY Draft editor corrupts it —
        // the placeholder node is destroyed and the very NEXT synthetic paste
        // inserts nothing (live-confirmed). So guard the clear behind a non-empty
        // check; a freshly-activated reply box is already empty and must be left
        // untouched before the paste.
        if (readDraft(el).trim().length) { await clearDraft(el); await sleep(60); }
        placeCaretAtEnd(el);
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            const dispatched = el.dispatchEvent(new ClipboardEvent('paste', {
                bubbles: true, cancelable: true, clipboardData: dt
            }));
            LOG('draft.insert.paste.fired', { dispatched, hadFocus });
        } catch (e) { LOG('draft.insert.paste.throw', { err: String(e) }); }
        res = await verify(2000);
        if (res.ok) { LOG('draft.insert.paste.OK', { len: res.observed.length, btn: res.btn }); return true; }
        LOG('draft.insert.paste.miss', { observed: res.observed.slice(0, 60), len: res.observed.length, btn: res.btn });

        // METHOD 2 — beforeinput+input with insertFromPaste + dataTransfer.
        // Some Draft builds explicitly handle this event type. Only clear if the
        // failed paste left partial text behind.
        if (readDraft(el).trim().length) { await clearDraft(el); await sleep(60); }
        placeCaretAtEnd(el);
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            el.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true,
                inputType: 'insertFromPaste', data: text, dataTransfer: dt
            }));
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true, inputType: 'insertFromPaste', data: text
            }));
        } catch {}
        res = await verify(1600);
        if (res.ok) { LOG('draft.insert.beforeinput.OK', { len: res.observed.length, btn: res.btn }); return true; }
        LOG('draft.insert.beforeinput.miss', { observed: res.observed.slice(0, 60), len: res.observed.length, btn: res.btn });

        // METHOD 3 — single-shot execCommand insertText (LAST-RESORT FALLBACK).
        // This is the path that historically produced the editorState desync, so
        // it runs ONLY after paste + beforeinput both failed, and it is held to
        // the SAME success bar: return true ONLY when the Reply button actually
        // enables (verify.ok). We NEVER return true on "text visible but button
        // disabled" — that stale-editorState state is precisely the user's bug,
        // and the caller must not click submit on it. Requires OS focus.
        if (hadFocus) {
            if (readDraft(el).trim().length) { await clearDraft(el); await sleep(60); }
            placeCaretAtEnd(el);
            let execOk = false;
            try { execOk = document.execCommand('insertText', false, text); } catch (e) { LOG('draft.insert.execCommand.throw', { err: String(e) }); }
            LOG('draft.insert.execCommand.fired', { returned: execOk, active: document.activeElement === el });
            res = await verify(1800);
            if (res.ok) { LOG('draft.insert.execCommand.OK', { len: res.observed.length, btn: res.btn }); return true; }
            LOG('draft.insert.execCommand.miss', { observed: res.observed.slice(0, 60), len: res.observed.length, btn: res.btn });
        } else {
            LOG('draft.insert.execCommand.skipped', { reason: 'document.hasFocus()===false — execCommand would no-op' });
        }

        // FAIL — report which signal failed so the caller's logs make the cause
        // obvious. We return false so the caller never clicks submit on a
        // desynced draft.
        const visibleOk = draftMatches(readDraft(el), text);
        LOG('draft.insert.FAIL', {
            observed: res.observed.slice(0, 80), len: res.observed.length, intended: text.length,
            visibleTextLanded: visibleOk, submitButtonEnabled: res.btn,
            diagnosis: (visibleOk && res.btn === false)
                ? 'TEXT VISIBLE BUT editorState EMPTY — button stayed disabled (Draft did not accept any insert)'
                : (!visibleOk ? 'text never appeared in editor' : 'unknown'),
            hadFocus
        });
        if (readDraft(el).trim().length) await clearDraft(el);
        return false;
    }

    async function backspace(el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true }));
        if (el.isContentEditable) document.execCommand('delete', false, null);
        else {
            const p = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (p) { p.set.call(el, el.value.slice(0, -1)); el.dispatchEvent(new Event('input', { bubbles: true })); }
            else document.execCommand('delete', false, null);
        }
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', keyCode: 8, bubbles: true }));
    }

    async function type(el, text, opts = {}) {
        el.focus();
        await sleep(g(700, 180));

        // ── DRAFT.JS PATH (X / Twitter) — single-shot paste ──
        // Per-char typing on Draft.js produced corrupted output (Draft's
        // keyBindingFn + reconciliation cycle don't tolerate synthetic
        // keystrokes well). Real bots paste a single blob through Draft's
        // onPaste handler, which handles synthetic ClipboardEvents cleanly.
        // We still preserve some stealth via the slow "thinking" pause above
        // and the mouse pathing around it. opts carries the submit selector +
        // composer scope so the insert can verify against the button-enabled
        // signal (editorState truth), not just visible DOM text.
        if (isDraftEditor(el)) {
            LOG('type.draft.paste', { chars: text.length });
            const ok = await pasteIntoDraft(el, text, opts);
            if (!ok) {
                LOG('type.draft.paste.FAIL', { reason: 'paste fallback chain exhausted' });
            }
            await sleep(g(1400, 450)); // review before submit
            return;
        }

        // ── CONTENTEDITABLE (Quill / LinkedIn) — SINGLE-SHOT INSERT ──
        // THE LINKEDIN COMMENT BUG. The old code typed the comment PER CHARACTER
        // via execCommand('insertText') in a loop. On LinkedIn's Quill editor that
        // is fatal for two reasons, both live-proven on a real post:
        //   1. CORRUPTION — Quill's MutationObserver batches the rapid one-char
        //      inserts and drops/reorders characters, so the finished text does
        //      NOT match the intended comment. composeAndSubmit's content-
        //      correctness guard (draftMatches) then rejects it and ABORTS — the
        //      exact "the tab opens, scrolls, and nothing gets posted" symptom.
        //      (A 2-emoji comment slipped through only because 2 chars can't
        //      mangle; a real 200+ char sentence reliably does.)
        //   2. SPEED — each per-char execCommand drags Quill through a full
        //      reconciliation; a long comment took ~60-90s and even froze the tab.
        // A SINGLE execCommand('insertText', fullText) lands the whole comment
        // atomically in ~3ms, exact-match, and enables the "Commenter" submit
        // button (verified). It's also SAFER for newlines (no per-char Enter
        // keydown that could submit early) and emoji. We keep the human-feel
        // pauses around it. Per-char remains only as a last-ditch fallback.
        if (el.isContentEditable) {
            const landed = () => (el.innerText || el.textContent || '').replace(/[​﻿]/g, '').trim();
            placeCaretAtEnd(el);
            let ok = false;
            try { ok = document.execCommand('insertText', false, text); } catch (e) { LOG('type.ce.execCommand.throw', { err: String(e) }); }
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            LOG('type.ce.singleShot', { execOk: ok, landedLen: landed().length, intendedLen: text.length });
            // Fallback 1 — Range insertion if execCommand was a no-op.
            if (!landed()) {
                try {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount) { const r = sel.getRangeAt(0); r.insertNode(document.createTextNode(text)); r.collapse(false); }
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                    LOG('type.ce.rangeFallback', { landedLen: landed().length });
                } catch (e) { LOG('type.ce.rangeFallback.throw', { err: String(e) }); }
            }
            // Fallback 2 — original per-char keystrokes for any exotic editor that
            // genuinely needs synthetic key events (kept fast, no typo injection).
            if (!landed()) {
                LOG('type.ce.perCharFallback', { reason: 'single-shot + range both left editor empty' });
                for (const ch of text) { await typeChar(el, ch); await sleep(g(35, 10)); }
            }
            await sleep(g(1400, 450)); // review before submit
            return;
        }

        // ── PER-CHAR TYPING (plain input / textarea) ──
        // Real-feeling cadence: 4% typo chance with quick backspace correction.
        for (const ch of text) {
            if (Math.random() < 0.04 && NEARBY[ch.toLowerCase()]) {
                const typo = NEARBY[ch.toLowerCase()][Math.floor(Math.random() * NEARBY[ch.toLowerCase()].length)];
                await typeChar(el, typo);
                await sleep(g(320, 90));
                await backspace(el);
                await sleep(g(180, 50));
            }
            await typeChar(el, ch);
            let delay = g(270, 75);
            if ('.!?,\n'.includes(ch)) delay += g(320, 90);
            if (Math.random() < 0.05) delay += g(550, 140);
            await sleep(delay);
        }
        await sleep(g(1400, 450)); // review before submit
    }

    // Main message handler
    LOG('agent.ready', { url: location.href, host: location.hostname });
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
        if (msg.type === 'PERFORM_STEALTH_INTERACTION') {
            LOG('message.received', { actionType: msg.actionType, hasText: !!msg.payload?.text });
            run(msg.actionType, msg.payload)
                .then(r => {
                    // One-glance verdict so the SW console makes the outcome obvious
                    // without reading the whole trace: who am I, did it work, why not.
                    LOG('VERDICT', {
                        action: msg.actionType,
                        ok: !!r?.success,
                        hadOsFocus: document.hasFocus(),
                        error: r?.success ? null : (r?.error || 'unknown'),
                        url: location.href
                    });
                    LOG('message.respond', r);
                    respond(r);
                })
                .catch(e => { LOG('VERDICT', { action: msg.actionType, ok: false, hadOsFocus: document.hasFocus(), error: e.message, url: location.href }); LOG('message.respond.ERROR', { error: e.message }); respond({ success: false, error: e.message }); });
            return true;
        }
    });

    // ── DRY-RUN TEST HOOK ──
    // Fire from the page console (or any MAIN-world script) to exercise the REAL
    // comment pipeline on the current post WITHOUT publishing anything:
    //   window.dispatchEvent(new CustomEvent('answerly_dryrun_comment',
    //     { detail: { text: 'hello test', postUrl: location.href } }));
    // It runs resolve→find-composer→focus→type→locate-submit, logs a verdict
    // ([AUTO-COMMENT] compose.DRYRUN), wipes the typed text, and NEVER clicks
    // submit. The result is also echoed back as an `answerly_dryrun_result`
    // event so a harness can await it. This is the "test without commenting"
    // path — it proves whether the agent would post on this exact page.
    window.addEventListener('answerly_dryrun_comment', (ev) => {
        const detail = (ev && ev.detail) || {};
        const host = location.hostname.replace('www.', '');
        const P = PLATFORMS[host];
        const text = (detail.text && String(detail.text)) || 'answerly dry run — checking the comment pipeline';
        const postUrl = detail.postUrl || location.href;
        LOG('dryrun.trigger', { host, hasPlatform: !!P, textLen: text.length, postUrl });
        if (!P) {
            const r = { success: false, dryRun: true, error: 'Unsupported platform: ' + host };
            LOG('dryrun.result', r);
            window.dispatchEvent(new CustomEvent('answerly_dryrun_result', { detail: r }));
            return;
        }
        doComment(P, text, postUrl, { dryRun: true })
            .then(r => { LOG('dryrun.result', r); window.dispatchEvent(new CustomEvent('answerly_dryrun_result', { detail: r })); })
            .catch(e => {
                const r = { success: false, dryRun: true, error: e && e.message };
                LOG('dryrun.result', r);
                window.dispatchEvent(new CustomEvent('answerly_dryrun_result', { detail: r }));
            });
    });

    async function run(actionType, payload) {
        const host = location.hostname.replace('www.', '');
        const P = PLATFORMS[host];
        if (!P) return { success: false, error: 'Unsupported platform: ' + host };

        // Phase 1: Arrive — a brief, natural settle. We deliberately do NOT do a
        // gratuitous scroll-down-then-up here: unnecessary motion is itself a bot
        // tell, and the target is brought into view on demand by scrollTo() inside
        // each action only when it isn't already visible. Just a short read pause
        // and a small cursor drift, like a human orienting on a freshly opened tab.
        await sleep(g(2200, 700));
        await moveTo(g(window.innerWidth * 0.45, 120), g(window.innerHeight * 0.4, 90));
        await sleep(g(700, 220));

        if (actionType === 'dwell') return await doDwell(P);
        if (actionType === 'like') return await doLike(P);
        if (actionType === 'comment') return await doComment(P, payload.text, payload.postUrl, { viaIntent: !!payload.viaIntent, visual: !!payload.visual, dryRun: !!payload.dryRun });
        if (actionType === 'repost') return await doRepost(P, payload.postUrl);
        if (actionType === 'quote') return await doQuote(P, payload.text, payload.postUrl);
        return { success: false, error: 'Unknown action' };
    }

    // Human pre-visit: dwell on the post like a person reading it before they
    // reply. A few paced scrolls + cursor drift, no interaction with the post.
    // Called as its own action right before we navigate to the intent composer,
    // so X sees "read the tweet → compose" instead of a cold jump to a compose URL.
    async function doDwell(P) {
        try {
            LOG('dwell.start', { url: location.href });
            await sleep(g(1500, 500));
            const steps = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < steps; i++) {
                const dy = g(220, 90);
                try { window.scrollBy({ top: dy, behavior: 'smooth' }); } catch (_) { try { window.scrollBy(0, dy); } catch (__) {} }
                try { await moveTo(g(window.innerWidth * 0.5, 140), g(window.innerHeight * 0.5, 120)); } catch (_) {}
                await sleep(g(1100, 400));
            }
            try { window.scrollBy({ top: -g(160, 70), behavior: 'smooth' }); } catch (_) {}
            await sleep(g(900, 300));
            LOG('dwell.done');
            return { success: true, dwelled: true };
        } catch (e) {
            return { success: true, dwelled: false, error: e && e.message };
        }
    }

    async function doLike(P) {
        if (document.querySelector(P.alreadyLikedSelector))
            return { success: true, alreadyDone: true };

        const btn = await waitForElement(P.likeSelector);
        if (!btn) return { success: false, error: 'Like button not found after 15s' };

        await scrollTo(btn);
        await sleep(g(500, 130));
        await click(btn);
        await moveTo(cursor.x + g(80, 30), cursor.y - g(40, 20)); // move away
        await sleep(g(800, 200));
        return { success: true };
    }

    // Poll for an element to become *enabled* (not just present). Used for
    // submit buttons that initialise disabled and enable on input.
    async function waitForEnabled(sel, timeout = 5000, scope = null) {
        const root = scope || document;
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const candidates = Array.from(root.querySelectorAll(sel));
            const ready = candidates.find(el => isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (ready) return ready;
            await sleep(250);
        }
        // Fall back to the first visible match even if disabled, so caller can report cleanly
        const any = Array.from(root.querySelectorAll(sel)).find(isVisible);
        LOG('waitForEnabled TIMEOUT', { selector: sel, foundDisabled: !!any, scoped: !!scope });
        return any || null;
    }

    // ── VISIBLE-TEXT + GEOMETRY LOCATOR ──
    // Find a clickable control by its VISIBLE label (e.g. "Post", "Reply") and
    // on-screen geometry, the way a human spots a button — instead of brittle
    // data-testids that X reshuffles. Among matches it prefers enabled + visible,
    // then the most prominent by area with a bottom-right bias (X's primary CTA
    // lives bottom-right of the composer). Returns the element or null.
    // Decoy controls whose label CONTAINS a target word but are NOT the submit
    // button. The big one: X's reply-audience selector reads "Everyone can
    // reply" — it contains "reply", is always enabled, and sits prominently in
    // the composer, so a loose word-match grabs it instead of Post (this was the
    // real bug). We reject any control whose text contains one of these.
    const SUBMIT_DECOYS = ['can reply', 'can comment', 'who can reply', 'replies', 'share post', 'add post', 'drafts', 'schedule'];

    function findClickableByText(labels, opts = {}) {
        const scope = opts.scope || document;
        const want = labels.map(s => String(s).toLowerCase());
        const enabledOnly = opts.enabledOnly !== false; // default true
        const sel = 'div[role="button"], button, a[role="button"], [role="button"]';
        const candidates = Array.from(scope.querySelectorAll(sel));
        const scored = [];
        for (const el of candidates) {
            if (!isVisible(el)) continue;
            const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
            if (enabledOnly && disabled) continue;
            // Visible label: the button's own trimmed text, else its aria-label.
            const txt = ((el.innerText || el.textContent || '').trim() || el.getAttribute('aria-label') || '').toLowerCase();
            if (!txt) continue;
            // Reject known decoys (e.g. "everyone can reply" audience selector).
            if (SUBMIT_DECOYS.some(d => txt.includes(d))) continue;
            // STRICT match: the submit button's visible label is EXACTLY
            // "Post" / "Reply" / "Tweet" — never matched as a substring/word.
            // Loose word-matching is what grabbed "Everyone can reply".
            const hit = want.some(w => txt === w);
            if (!hit) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) continue;
            // Prominence: area + bottom-right bias.
            const score = (r.width * r.height) + r.bottom * 2 + r.right;
            scored.push({ el, score });
        }
        if (!scored.length) return null;
        scored.sort((a, b) => b.score - a.score);
        return scored[0].el;
    }

    // Poll until a visible-text match becomes clickable (enabled + visible).
    async function waitForClickableByText(labels, opts = {}, timeout = 12000) {
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const hit = findClickableByText(labels, opts);
            if (hit) return hit;
            await sleep(300);
        }
        return null;
    }

    // Find the smallest sensible container around the reply composer so we can
    // scope the submit-button search to it (instead of grabbing some other
    // disabled tweet button elsewhere on the page). Walk up from the editor to
    // the first ancestor that ALSO contains a submit button; fall back to a
    // dialog / known composer wrappers, then the whole document.
    function findComposerScope(box, submitSel) {
        let cur = box;
        for (let i = 0; cur && i < 8; i++, cur = cur.parentElement) {
            try { if (cur.querySelector && cur.querySelector(submitSel)) return cur; } catch {}
        }
        return box.closest('[role="dialog"], [data-testid="primaryColumn"], form') || document;
    }

    // Locate the composer editor that JUST opened. X opens the reply/quote box
    // either as a modal [role="dialog"] or inline; the page can ALSO contain a
    // stale/persistent composer (e.g. a top-of-timeline box) matching the same
    // selector. Prefer the one inside an open dialog so we never type into the
    // wrong editor; fall back to the first global match.
    async function findActiveComposer(selector, timeout = 8000) {
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).reverse().find(isVisible);
            if (dialog) {
                const inDlg = dialog.querySelector(selector);
                if (inDlg && isVisible(inDlg)) { LOG('composer.foundInDialog', {}); return inDlg; }
            }
            const any = Array.from(document.querySelectorAll(selector)).find(isVisible);
            if (any) { LOG('composer.foundGlobal', { hadDialog: !!dialog }); return any; }
            await sleep(350);
        }
        return null;
    }

    // Find a comment composer that is ALREADY present and ready to type into,
    // WITHOUT needing a trigger click. On a LinkedIn permalink (where we land to
    // comment) the Quill editor (.ql-editor[contenteditable]) is mounted on load
    // and fully functional — typing into it fires the input events that reveal
    // and enable the post button (live-verified). Prefers a composer inside/near
    // the focal post, then any visible match. Returns null if none is ready
    // within `timeout` (e.g. the new home-feed inline composer, which only
    // mounts after the "Comment" trigger is clicked — that path falls through to
    // the trigger hunt).
    async function findReadyComposer(selector, scopeEl, timeout = 1500) {
        const t = Date.now();
        for (;;) {
            if (scopeEl) {
                const inScope = Array.from(scopeEl.querySelectorAll(selector)).find(isVisible);
                if (inScope) { LOG('composer.readyInScope', {}); return inScope; }
            }
            const any = Array.from(document.querySelectorAll(selector)).find(isVisible);
            if (any) { LOG('composer.readyGlobal', { scoped: !!scopeEl }); return any; }
            if (Date.now() - t >= timeout) return null;
            await sleep(300);
        }
    }

    // Shared composer: given an already-open editor `box`, type `text`, run the
    // content-correctness guards, submit (click + Cmd/Ctrl+Enter fallback), and
    // verify. Reused by doComment (reply) and doQuote (quote tweet) so both get
    // the same robust submit/verify machinery.
    // Climb outward from the editor and return the nearest visible+enabled
    // button whose VISIBLE label matches `re`. Used for surfaces where the
    // submit control has NO stable selector and NO enclosing <form> — notably
    // LinkedIn's NEW home-feed inline comment composer, whose "Comment"/
    // "Commenter"/"Publier" button carries only obfuscated/hashed classes.
    // Starting at the editor and growing minimally biases toward the composer's
    // own submit button rather than another post's action-bar comment toggle.
    function findSubmitByText(startEl, re) {
        let cur = startEl;
        for (let i = 0; cur && i < 8; i++, cur = cur.parentElement) {
            const btns = Array.from(cur.querySelectorAll('button, [role="button"]'));
            const hit = btns.find(b => {
                if (!isVisible(b)) return false;
                if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
                const t = (b.innerText || b.textContent || '').trim();
                if (!t || t.length > 24) return false; // submit labels are short
                // Skip the action-bar comment TOGGLE (it expands; aria-label
                // usually starts with "Comment on"/"Comment …"); we want the
                // composer's send button, whose aria-label is absent or matches.
                const al = (b.getAttribute('aria-label') || '').toLowerCase();
                if (/comment on |add a comment|leave a comment/.test(al)) return false;
                return re.test(t);
            });
            if (hit) return hit;
        }
        return null;
    }

    async function composeAndSubmit(box, text, submitSelector, verifySelector, submitTextRe = null, dryRun = false) {
        // Descend to the actual contenteditable so we never focus/type a wrapper
        // (which leaves the placeholder up and the button disabled).
        const editable = resolveEditable(box);
        if (editable !== box) LOG('compose.resolvedEditable', { fromTag: box.tagName, fromTestid: box.getAttribute && box.getAttribute('data-testid'), toClass: editable.className ? String(editable.className).slice(0, 40) : '', toCE: editable.isContentEditable });
        box = editable;
        const useCdp = await cdpAvailable();
        // STEP 3a — FOCUS FIRST, VERIFIED. The old code clicked with synthetic
        // events (which don't move the browser's real caret) and inserted on a
        // timer, so text could land in the wrong field. Now we click with a
        // trusted CDP mouse event and confirm document.activeElement is actually
        // inside the editor BEFORE inserting a single character.
        await sleep(g(600, 160));
        const focused = await ensureEditorFocused(box, useCdp);
        if (!focused) {
            // NON-FATAL. The old code ABORTED here before typing a single
            // character — which is exactly the "app opens the post, scrolls, but
            // never pastes a comment" bug: a momentary loss of OS focus (the
            // engagement tab can be foreground yet not the focused window) made
            // the caret check fail, so doComment bailed silently. But LinkedIn's
            // Quill editor accepts execCommand('insertText') + InputEvent inserts
            // even when document.hasFocus() is false (live-verified), and X's
            // paste path re-asserts focus and verifies via the submit-enable
            // signal. So instead of bailing, we give one last gentle focus nudge
            // and PROCEED to type. The post-type length + content-correctness
            // guards below reject genuine "text didn't land" / "wrong field"
            // cases cleanly, so proceeding never posts garbage.
            LOG('compose.focus.soft', { reason: 'focus not confirmed — proceeding to type anyway', useCdp });
            try { box.focus(); placeCaretAtEnd(box); } catch {}
        }
        // Resolve the composer scope so the Draft insert can watch THIS composer's
        // submit button enable (the editorState-truth signal) rather than
        // declaring success on a visible-DOM text match alone.
        const typeScope = findComposerScope(box, submitSelector);
        LOG('compose.typing', { chars: text.length, scoped: typeScope !== document, useCdp });
        // STEP 3b — type the text
        await type(box, text, { submitSel: submitSelector, scope: typeScope });
        const observedValue = (box.isContentEditable ? (box.innerText || box.textContent) : box.value || '').trim();
        LOG('compose.typed', { observedLength: observedValue.length, observedPreview: observedValue.slice(0, 80) });
        if (observedValue.length < Math.min(10, text.length * 0.5)) {
            LOG('compose.FAIL', { reason: 'value not reflected in editor', expected: text.length, got: observedValue.length });
            return { success: false, error: 'Typed text not reflected in editor (controlled/Quill issue?). Check console logs.' };
        }
        // CONTENT-CORRECTNESS GUARD — right length but wrong characters check.
        if (!draftMatches(observedValue, text)) {
            LOG('compose.FAIL', { reason: 'observed text does not match intended (corruption)', observedPreview: observedValue.slice(0, 120), intendedPreview: text.slice(0, 120) });
            if (box.isContentEditable) { try { await clearDraft(box); } catch {} }
            return { success: false, error: 'Editor content did not match the intended text (corruption detected) — aborted to avoid posting garbage.' };
        }

        // STEP 4 — submit. Scope to the composer so we never grab a stray
        // (disabled) tweet button from elsewhere on the page. (Reuse the scope
        // we resolved before typing.)
        const composerScope = typeScope;
        LOG('compose.findSubmit', { selector: submitSelector, scoped: composerScope !== document });

        const editorEmptied = async (timeout) => {
            const t = Date.now();
            while (Date.now() - t < timeout) {
                const v = (box.isContentEditable ? (box.innerText || box.textContent) : box.value || '').trim();
                if (!v || v.length < Math.min(8, text.length * 0.4)) return true;
                await sleep(300);
            }
            return false;
        };

        // Robust Cmd/Ctrl+Enter submit — the reliable path on X once editorState
        // has text. Prefer a TRUSTED CDP key event (works regardless of OS focus);
        // fall back to synthetic KeyboardEvents on the editor + document.
        const keyboardSubmit = async () => {
            if (useCdp) {
                for (const useMeta of [false, true]) {
                    try { box.focus(); placeCaretAtEnd(box); } catch {}
                    const r = await requestCdpKeyEnter(useMeta);
                    LOG('compose.cdpKeyEnter', { useMeta, ok: r.success, err: r.error });
                    if (r.success && await editorEmptied(1300)) return true;
                }
            }
            const combos = [
                { ctrlKey: true, metaKey: false },
                { ctrlKey: false, metaKey: true },
                { ctrlKey: true, metaKey: true },
            ];
            for (const mod of combos) {
                const kopts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ...mod };
                try {
                    box.focus();
                    box.dispatchEvent(new KeyboardEvent('keydown', kopts));
                    box.dispatchEvent(new KeyboardEvent('keypress', kopts));
                    box.dispatchEvent(new KeyboardEvent('keyup', kopts));
                    document.dispatchEvent(new KeyboardEvent('keydown', kopts));
                } catch {}
                if (await editorEmptied(1200)) return true;
            }
            return false;
        };

        let submit = await waitForEnabled(submitSelector, 5000, composerScope);
        let submitDisabled = submit && (submit.disabled || submit.getAttribute('aria-disabled') === 'true');
        // Text-scan fallback — surfaces with no stable submit selector / no form
        // (LinkedIn NEW inline composer). Locate the send button by its label.
        if ((!submit || submitDisabled) && submitTextRe) {
            const byText = findSubmitByText(box, submitTextRe);
            if (byText) { submit = byText; submitDisabled = false; LOG('compose.submit.byText', { label: (byText.innerText || byText.textContent || '').trim().slice(0, 24) }); }
        }
        LOG('compose.submitState', { found: !!submit, disabled: !!submitDisabled, ariaDisabled: submit ? submit.getAttribute('aria-disabled') : null });

        // DRY-RUN STOP — test harness. Everything up to here is the real path
        // (resolve post → find composer → focus → type → locate submit button),
        // but we DELIBERATELY do NOT click submit. Report the full picture so we
        // can see whether the agent would have posted, then wipe the test text so
        // nothing is left in the box. Used by the `answerly_dryrun_comment`
        // window event to verify the pipeline WITHOUT publishing a comment.
        if (dryRun) {
            const observed = (box.isContentEditable ? (box.innerText || box.textContent) : box.value || '').trim();
            const wouldPost = !!(submit && !submitDisabled);
            LOG('compose.DRYRUN', {
                verdict: wouldPost ? 'WOULD POST ✓ (text landed + submit button ready)' : 'WOULD FAIL ✗',
                textLandedLen: observed.length,
                textPreview: observed.slice(0, 80),
                submitButtonFound: !!submit,
                submitButtonEnabled: wouldPost,
                hadOsFocus: document.hasFocus()
            });
            try { if (box.isContentEditable) await clearDraft(box); else if ('value' in box) { box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); } } catch {}
            return { success: wouldPost, dryRun: true, observedText: observed, submitFound: !!submit, submitEnabled: wouldPost };
        }

        if (submit && !submitDisabled) {
            LOG('compose.submit.OK', { submitTag: submit.tagName, viaCdp: useCdp });
            await scrollTo(submit);
            await sleep(g(400, 120));
            // Prefer a trusted CDP click on the enabled button; fall back to synthetic.
            let clicked = false;
            if (useCdp) { const r = await cdpClickEl(submit); clicked = r.success; if (!clicked) LOG('compose.submit.cdpClick.fail', { err: r.error }); }
            if (!clicked) await click(submit);
            LOG('compose.submit.clicked', { viaCdp: clicked });
        } else {
            LOG('compose.submit.buttonUnavailable', { found: !!submit, disabled: !!submitDisabled });
        }

        let submitted = await editorEmptied(2500);
        if (!submitted) {
            LOG('compose.keyboardSubmit', { reason: 'editor did not clear after click' });
            submitted = await keyboardSubmit();
        }
        if (!submitted) {
            let retrySubmit = await waitForEnabled(submitSelector, 2500, composerScope);
            if ((!retrySubmit || retrySubmit.disabled || retrySubmit.getAttribute('aria-disabled') === 'true') && submitTextRe) {
                const byText = findSubmitByText(box, submitTextRe);
                if (byText) retrySubmit = byText;
            }
            if (retrySubmit && !retrySubmit.disabled && retrySubmit.getAttribute('aria-disabled') !== 'true') {
                LOG('compose.retryClick');
                let rclicked = false;
                if (useCdp) { const r = await cdpClickEl(retrySubmit); rclicked = r.success; }
                if (!rclicked) await click(retrySubmit);
                submitted = await editorEmptied(2200);
            } else {
                LOG('compose.retryUnavailable', { found: !!retrySubmit });
            }
        }
        LOG('compose.submitResult', { submitted });

        // STEP 5 — verify
        await moveTo(cursor.x - g(100, 40), cursor.y - g(60, 20));
        await sleep(g(2200, 500));
        const verified = await verifyPosted(verifySelector, text);
        LOG('compose.verify', { posted: verified, editorEmptied: submitted });
        if (!verified && !submitted) {
            return { success: false, error: 'Submit did not post the text (button click + keyboard shortcut both failed, editor never cleared). May be rate-limited or the submit control changed.', soft: true };
        }
        LOG('compose.done.success', { via: verified ? 'verified-text' : 'editor-cleared' });
        return { success: true };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SESSION NETWORK REPLAY (X / Twitter)
    //
    // WHY: X's Post button is gated on Draft.js's internal editorState, which a
    // synthetic DOM insert can never update (proven: aria-disabled stays true).
    // Only a real keystroke or a renderer-level trusted insert (CDP) flips it —
    // and we want neither CDP nor the official API. So we bypass the editor
    // entirely: replay X's own CreateTweet GraphQL request using the live
    // session. The MAIN-world hook (x_net_hook.js) passively captures the EXACT
    // request the real client sends once the user posts anything, and forwards
    // it here via window.postMessage. We cache that "template" and replay it
    // with the reply text + target tweet swapped in.
    // ─────────────────────────────────────────────────────────────────────────
    const X_TEMPLATE_KEY = 'x_createtweet_template_v1';

    // Listen for the captured template from the MAIN-world hook and persist it.
    // We only trust same-window messages carrying our sentinel source.
    try {
        window.addEventListener('message', (ev) => {
            try {
                if (ev.source !== window) return;
                const d = ev.data;
                if (!d || d.source !== 'ANSWERLY_X_CAPTURE' || !d.template) return;
                const t = d.template;
                if (!t.url || !t.body) return;
                chrome.storage.local.set({ [X_TEMPLATE_KEY]: t }, () => {
                    void chrome.runtime.lastError;
                    LOG('replay.template.captured', { url: t.url, bodyLen: (t.body || '').length, at: t.capturedAt });
                });
            } catch (_) {}
        }, false);
    } catch (_) {}

    function getCookie(name) {
        try {
            const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
            return m ? decodeURIComponent(m[1]) : null;
        } catch (_) { return null; }
    }

    function tweetIdFromUrl(u) {
        try {
            const m = String(u || '').match(/status(?:es)?\/(\d+)/);
            return m ? m[1] : null;
        } catch (_) { return null; }
    }

    function loadXTemplate() {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get([X_TEMPLATE_KEY], (res) => {
                    void chrome.runtime.lastError;
                    resolve((res && res[X_TEMPLATE_KEY]) || null);
                });
            } catch (_) { resolve(null); }
        });
    }

    // Replay CreateTweet as a reply. Returns {success, error?, restId?, status?}.
    async function postReplyViaSession(tweetId, text) {
        const tpl = await loadXTemplate();
        if (!tpl || !tpl.url || !tpl.body) {
            return { success: false, error: 'no-template' };
        }

        // Parse the captured GraphQL body and swap in our text + reply target.
        let payload;
        try { payload = JSON.parse(tpl.body); }
        catch (_) { return { success: false, error: 'template-body-unparseable' }; }
        if (!payload || typeof payload !== 'object' || !payload.variables) {
            return { success: false, error: 'template-no-variables' };
        }

        const v = payload.variables;
        v.tweet_text = text;
        v.reply = { in_reply_to_tweet_id: String(tweetId), exclude_reply_user_ids: [] };
        v.dark_request = false;
        // Never carry over media/poll/card from the captured tweet.
        if ('media' in v) v.media = { media_entities: [], possibly_sensitive: false };
        delete v.card_uri;
        delete v.attachment_url;
        delete v.conversation_control;
        if ('semantic_annotation_ids' in v) v.semantic_annotation_ids = [];

        const body = JSON.stringify(payload);

        // Build headers: reuse the captured auth, but ALWAYS use a fresh csrf from
        // the current ct0 cookie (the captured one may be stale).
        const ct0 = getCookie('ct0');
        if (!ct0) return { success: false, error: 'no-ct0-cookie (not logged in?)' };

        const capHdr = tpl.headers || {};
        const headers = { 'content-type': 'application/json' };
        if (capHdr.authorization) headers['authorization'] = capHdr.authorization;
        headers['x-csrf-token'] = ct0;
        headers['x-twitter-active-user'] = 'yes';
        headers['x-twitter-auth-type'] = 'OAuth2Session';
        headers['x-twitter-client-language'] = capHdr['x-twitter-client-language'] || navigator.language || 'en';
        // Best-effort anti-automation headers (X often validates auth primarily,
        // but pass these through if we captured them).
        if (capHdr['x-client-transaction-id']) headers['x-client-transaction-id'] = capHdr['x-client-transaction-id'];
        if (capHdr['x-client-uuid']) headers['x-client-uuid'] = capHdr['x-client-uuid'];

        LOG('replay.request', { url: tpl.url, tweetId, textLen: text.length });
        let resp, json;
        try {
            resp = await fetch(tpl.url, {
                method: tpl.method || 'POST',
                headers,
                body,
                credentials: 'include',
                referrer: location.href
            });
        } catch (e) {
            return { success: false, error: 'network: ' + (e && e.message || e) };
        }

        try { json = await resp.json(); } catch (_) { json = null; }

        if (!resp.ok) {
            const errMsg = json && json.errors && json.errors[0] && json.errors[0].message;
            LOG('replay.http.fail', { status: resp.status, errMsg });
            return { success: false, error: 'http ' + resp.status + (errMsg ? ': ' + errMsg : ''), status: resp.status };
        }
        if (json && Array.isArray(json.errors) && json.errors.length) {
            LOG('replay.graphql.errors', { errors: json.errors.map(e => e.message) });
            return { success: false, error: 'graphql: ' + json.errors.map(e => e.message).join('; ') };
        }

        const restId = json && json.data && json.data.create_tweet &&
            json.data.create_tweet.tweet_results &&
            json.data.create_tweet.tweet_results.result &&
            json.data.create_tweet.tweet_results.result.rest_id;
        if (restId) {
            LOG('replay.success', { restId });
            return { success: true, restId, viaReplay: true };
        }
        LOG('replay.noRestId', { sample: JSON.stringify(json || {}).slice(0, 300) });
        return { success: false, error: 'replay-no-rest-id (response shape changed?)' };
    }

    // ── PRIMARY METHOD (X/Twitter): Web Intent ──
    // We are on x.com/intent/tweet?in_reply_to=…&text=… (opened by the SW). X's
    // own React hydration initialized the composer WITH our text already inside
    // and the Post button enabled by default — because X built the editorState
    // itself. We never touch Draft.js/Lexical: we just wait for the enabled
    // button and click it. This is resilient to X's editor framework churn.
    async function postViaIntent(P, text, opts = {}) {
        LOG('intent.start', { url: location.href, visual: !!opts.visual });

        // 1. Confirm the composer hydrated (its presence means X built the state).
        const box = await findActiveComposer(P.replyBoxSelector, 12000);
        if (box) {
            const have = (box.innerText || box.textContent || '').trim();
            LOG('intent.composerReady', { prefilledLen: have.length, matches: draftMatches ? draftMatches(have, text) : null });
        } else {
            LOG('intent.composerMissing', {});
        }

        // 2. Locate the SUBMIT button. The composer dialog also contains decoy
        //    controls whose label includes "reply" (X's "Everyone can reply"
        //    audience selector) — a loose visual match grabs that instead of
        //    Post. So we trust the submit button's data-testid FIRST
        //    (tweetButton / tweetButtonInline — stable on X for years, and X
        //    enables it on its own because IT seeded the text). Only if the
        //    testid is absent do we fall back to a STRICT visible-label match
        //    (exact "Post"/"Reply"/"Tweet", decoys excluded) + geometry.
        const scope = (box && (box.closest('[role="dialog"]') || findComposerScope(box, P.replyButtonSelector))) || document;
        let btn = await waitForEnabled(P.replyButtonSelector, 12000, scope);
        if (btn) {
            LOG('intent.btn.testid', { testid: btn.getAttribute('data-testid'), label: (btn.innerText || btn.textContent || '').trim().slice(0, 24) });
        } else {
            btn = await waitForClickableByText(['Post', 'Reply', 'Tweet'], { scope, enabledOnly: true }, 4000);
            if (btn) LOG('intent.btn.visualFallback', { label: (btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').trim().slice(0, 24) });
        }
        if (!btn) {
            LOG('intent.FAIL', { reason: 'post button never enabled' });
            return { success: false, error: 'Intent composer Post button never enabled (X intent layout may have changed)' };
        }

        // Remember the composer dialog so we can detect it closing (the
        // strongest success signal on the intent page).
        const dialogEl = (box && box.closest('[role="dialog"]')) || null;

        await sleep(g(800, 220));
        await scrollTo(btn);
        await click(btn);
        LOG('intent.clicked');

        // 3. Verify. On a successful intent post X closes the composer dialog and
        //    shows a "Your post was sent" toast, then navigates away from
        //    /intent. Poll for any strong success signal.
        const t = Date.now();
        while (Date.now() - t < 10000) {
            await sleep(400);
            const stillIntent = /\/intent\/(tweet|post)/.test(location.pathname) || /\/compose\//.test(location.pathname);
            const dialogGone = dialogEl && !document.contains(dialogEl);
            const toast = Array.from(document.querySelectorAll('[data-testid="toast"], [role="alert"]')).some(isVisible);
            const liveBtn = Array.from(document.querySelectorAll(P.replyButtonSelector)).find(isVisible);
            const btnGone = !liveBtn;
            const btnDisabled = liveBtn && (liveBtn.disabled || liveBtn.getAttribute('aria-disabled') === 'true');
            const editor = document.querySelector(P.replyBoxSelector);
            const editorEmpty = editor && !((editor.innerText || editor.textContent || '').trim());
            if (dialogGone || toast || !stillIntent || btnGone || btnDisabled || editorEmpty) {
                LOG('intent.result', { ok: true, dialogGone, toast, stillIntent, btnGone, btnDisabled, editorEmpty, url: location.href });
                return { success: true, viaIntent: true, verified: true };
            }
        }
        LOG('intent.result', { ok: false, reason: 'no post-submit signal', url: location.href });
        return { success: false, error: 'Clicked Post but saw no confirmation (post may have been rate-limited or blocked)' };
    }

    // Click the inline reply field on the post page to MOUNT/EXPAND the composer
    // — exactly what a human does before typing. On a status page the
    // "Post your reply" box is collapsed until clicked; clicking the contenteditable
    // (or its prompt) expands it and reveals the Reply button row. We verify the
    // click landed in the RIGHT field: document focus must be inside the editor
    // AND the composer scope must contain the Reply button — otherwise we'd be
    // typing into the wrong area. Returns the mounted editor element, or null.
    async function activateInlineReply(P, targetArticle, timeout = 6000) {
        const findEditor = () =>
            Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).find(isVisible) ||
            Array.from(document.querySelectorAll(P.replyBoxSelector)).find(isVisible);
        // The clickable "Post your reply" prompt that reveals the editor when the
        // contenteditable itself isn't mounted yet. EXCLUDE action buttons (the
        // reply icon in the action bar) — clicking those opens a MODAL, which is
        // not the inline behavior we want. We only want a textbox-like prompt.
        const findPrompt = () => Array.from(
            document.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"], div[aria-label]')
        ).find(e => {
            if (!isVisible(e)) return false;
            // Skip the reply action button and anything that's a clickable button.
            if (e.closest('[data-testid="reply"]')) return false;
            if (e.getAttribute('role') === 'button' || e.closest('[role="button"]')) return false;
            return /post your reply|reply|répondre|add another/i.test(
                (e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '').slice(0, 50)
            );
        });

        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const clickTarget = findEditor() || findPrompt();
            if (clickTarget) {
                const r = clickTarget.getBoundingClientRect();
                LOG('inline.clickReplyArea', {
                    testid: clickTarget.getAttribute('data-testid'),
                    aria: clickTarget.getAttribute('aria-label'),
                    tag: clickTarget.tagName,
                    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
                });
                await scrollTo(clickTarget);
                await sleep(g(450, 130));
                await click(clickTarget);            // real pointer+mouse click sequence
                await sleep(g(550, 150));            // let X expand the composer

                const editor = findEditor();
                if (editor) {
                    const scope = findComposerScope(editor, P.replyButtonSelector);
                    const hasReplyButton = !!(scope && scope.querySelector && scope.querySelector(P.replyButtonSelector));
                    const focused = isFocusInside(editor);
                    LOG('inline.replyAreaActive', { focused, hasReplyButton });
                    // Right area = editor present AND its composer has the Reply
                    // button (so it's the reply composer, not some other textbox).
                    if (hasReplyButton) return editor;
                    // Editor exists but no button row yet — give the click one more
                    // beat to expand, then accept the editor anyway (composeAndSubmit
                    // re-focuses + verifies the button before it ever submits).
                    await sleep(g(400, 120));
                    if (isFocusInside(editor)) return editor;
                }
            }
            await sleep(300);
        }
        return null;
    }

    async function doComment(P, text, postUrl, opts = {}) {
        const platform = location.hostname.replace(/^www\./, '');
        LOG('start', { platform, postUrl: postUrl || location.href, textPreview: (text || '').slice(0, 80), textLength: (text || '').length });

        if (!text || typeof text !== 'string' || !text.trim()) {
            LOG('abort.emptyText');
            return { success: false, error: 'No comment text provided' };
        }

        // ── PRIMARY PATH (X/Twitter): INLINE reply, exactly like a real user ──
        // The reply box is already on the post page. We type into it — and
        // because this runs in a FOREGROUND, FOCUSED tab, execCommand('insertText')
        // is trusted, so X's editorState updates and the Reply button enables
        // (proven on the live build). Then we click Reply. No intent URL, no
        // navigation, no URL change, no pre-scroll, no popup-hop.
        if (platform === 'x.com' || platform === 'twitter.com') {
            // Reply to the RIGHT tweet: bring the intended post into view.
            const targetArticle = await resolveTargetArticle(postUrl);
            if (targetArticle) { try { await scrollTo(targetArticle); await sleep(g(400, 120)); } catch {} }

            // DELIBERATE CLICK into the inline "Post your reply" box that's
            // already on the status page — exactly what a real user does: click
            // the reply field (not a button), confirm the caret landed inside
            // the editor AND the Reply button is now in scope, then type. No
            // modal, no URL change. activateInlineReply verifies it clicked the
            // RIGHT area before returning the editor.
            let box = await activateInlineReply(P, targetArticle, 6000);
            if (box) {
                LOG('inline.composer.activated', { boxTag: box.tagName });
            } else {
                // The inline box wasn't clickable/present — fall back to clicking
                // the reply control to reveal a composer (X opens it inline or as
                // a modal; both are handled), then re-verify the click landed.
                LOG('inline.composer.absent', { note: 'clicking reply trigger to reveal' });
                // SCOPE STRICTLY to the target tweet. A GLOBAL reply-button
                // lookup can grab a SUB-COMMENT's reply control — that's the
                // "it replied to a comment instead of the post" bug. We only
                // click the reply control that belongs to the focal/target tweet.
                let trigger = targetArticle ? await waitForElementIn(targetArticle, P.replyTrigger, 5000) : null;
                if (!trigger && !targetArticle) {
                    // Couldn't identify the target article — the focal tweet on a
                    // status page is the first one in the primary column. Use ITS
                    // reply button, never a random global match.
                    const col = document.querySelector('[data-testid="primaryColumn"]') || document;
                    const focal = col.querySelector('article[data-testid="tweet"]');
                    if (focal) trigger = focal.querySelector(P.replyTrigger);
                }
                if (!trigger) {
                    LOG('inline.trigger.FAIL', { selector: P.replyTrigger });
                    return { success: false, error: 'Reply control not found on the target post (avoided clicking a sub-comment).' };
                }
                await scrollTo(trigger);
                await sleep(g(500, 140));
                await click(trigger);
                // After revealing, click into the actual reply field and verify.
                box = await activateInlineReply(P, targetArticle, 8000);
                if (!box) box = await findActiveComposer(P.replyBoxSelector, 4000);
                if (!box) {
                    LOG('inline.box.FAIL', {});
                    return { success: false, error: 'Reply editor did not open after clicking reply.' };
                }
            }
            LOG('inline.composerReady', { boxTag: box.tagName, contentEditable: box.isContentEditable });

            // WRONG-TARGET GUARD — verify the composer is replying to the
            // intended author before we type/submit. X shows "Replying to
            // @handle" above the editor; if the expected author is ABSENT while
            // a different target IS present, we're on a sub-comment → abort
            // rather than post to the wrong place.
            const expectedHandle = extractXHandle(postUrl) || extractXHandle(location.href);
            if (expectedHandle) {
                const ctxHandles = xReplyContextHandles(box);
                if (ctxHandles.length && !ctxHandles.includes(expectedHandle)) {
                    LOG('inline.targetMismatch.ABORT', { expectedHandle, ctxHandles });
                    return { success: false, error: `Reply target mismatch: composer is replying to @${ctxHandles.join(', @')} but the intended post is by @${expectedHandle}. Aborted to avoid commenting on the wrong tweet.`, soft: true };
                }
                LOG('inline.targetVerified', { expectedHandle, ctxHandles });
            }
            return await composeAndSubmit(box, text, P.replyButtonSelector, P.commentVerifySelector);
        }

        // STEP 0 — resolve the SPECIFIC post we intend to comment on, so we
        // don't grab the first reply button on the page (wrong-post bug).
        const targetArticle = await resolveTargetArticle(postUrl);
        if (targetArticle) {
            try { await scrollTo(targetArticle); await sleep(g(500, 130)); } catch {}
        }

        // STEP 0.5 — COMPOSER-FIRST SHORT-CIRCUIT (the LinkedIn permalink fix).
        //
        // THE BUG: on a LinkedIn post permalink — exactly where the engagement
        // queue navigates to comment — the Quill comment editor is ALREADY
        // mounted and ready on load. But doComment ignored it and insisted on
        // first locating and clicking a social-bar "Commenter" trigger. That
        // synthetic click is frequently a no-op (LinkedIn ignores untrusted
        // clicks on that control) or, on the new feed, grabbed a decoy button;
        // then the focus check aborted BEFORE typing. Net effect the user saw:
        // "the app opens the post, scrolls, and does nothing — no click, no
        // paste." THE FIX: if a comment composer is already present and visible,
        // type into it directly and skip the trigger entirely. Live-verified
        // that typing into the pre-mounted .ql-editor reveals + enables the post
        // button, so no trigger click is needed on a permalink.
        {
            const ready = await findReadyComposer(P.replyBoxSelector, targetArticle, 1800);
            if (ready) {
                LOG('step0.composerAlreadyPresent', { boxTag: ready.tagName, scoped: !!targetArticle });
                try { await scrollTo(ready); await sleep(g(500, 140)); } catch {}
                return await composeAndSubmit(ready, text, P.replyButtonSelector, P.commentVerifySelector, P.replyButtonTextRe, opts.dryRun);
            }
            LOG('step0.noReadyComposer', { note: 'falling through to trigger hunt' });
        }

        // STEP 1 — find and click the reply/comment trigger, scoped to the
        // target article when we identified one.
        //
        // CRITICAL (LinkedIn new feed): P.replyTrigger's aria-label match
        // (*="comment" i) is GREEDY and matches DECOY buttons whose label merely
        // *mentions* a comment but does NOT open the composer — e.g. "Show more
        // comments" / "Afficher plus de commentaires", or "More options for
        // <name>'s comment" / "Voir plus d'options pour le commentaire de …".
        // The REAL compose button on the new feed has NO aria-label and only
        // hashed classes — its only stable signal is the visible label
        // "Comment"/"Commenter". The old code took the first selector hit (a
        // decoy) and so the text-scan fallback never ran → it clicked "show more
        // comments" and never opened the composer. THAT is why feed commenting
        // silently did nothing. We now VALIDATE every candidate and only accept a
        // genuine compose trigger.
        LOG('step1.findTrigger', { selector: P.replyTrigger, scoped: !!targetArticle });
        // Decoy labels that mention a comment but do something else (expand,
        // options menu, like, react, reply-to-a-comment, translate, paginate…).
        const _decoyRe = /(plus|more|moins|less|afficher|show|voir|option|menu|modifier|edit|supprim|delete|signal|report|react|réagir|aimer|\blike\b|repost|partag|share|envoy|send|répond|reply|load|charger|précédent|previous|suivant|next|traduire|translate)/i;
        const looksLikeComposeTrigger = (b) => {
            if (!b || !isVisible(b)) return false;
            const txt = (b.innerText || b.textContent || '').trim();
            // (a) New feed: visible label is EXACTLY the comment verb.
            if (P.replyTriggerTextRe && txt && txt.length < 20 && P.replyTriggerTextRe.test(txt)) return true;
            const aria = (b.getAttribute('aria-label') || '').trim();
            if (!aria) return false;
            // (b) Reject decoys whose label merely mentions a comment.
            if (_decoyRe.test(aria)) return false;
            // (c) Old feed: aria-label STARTS WITH a bare comment verb
            //     ("Comment", "Commenter le post de …").
            return /^(comment|commenter|kommentier|comentar|commenta|تعليق|علّق|علق)/i.test(aria);
        };
        const pickTrigger = (root) => {
            if (!root) return null;
            // Prefer a VALIDATED selector hit; else any validated button/role.
            const selHits = Array.from(root.querySelectorAll(P.replyTrigger)).filter(looksLikeComposeTrigger);
            if (selHits.length) return selHits[0];
            const all = Array.from(root.querySelectorAll('button, [role="button"]')).filter(looksLikeComposeTrigger);
            return all[0] || null;
        };
        let trigger = null;
        {
            const scanRoot0 = targetArticle || document;
            const t0 = Date.now();
            while (!trigger && Date.now() - t0 < 8000) {
                // Scoped to the target post first; widen to the document only if
                // scoping found nothing (permalink pages have one focal post).
                trigger = pickTrigger(scanRoot0) || (targetArticle ? pickTrigger(document) : null);
                if (!trigger) await sleep(400);
            }
        }
        if (!trigger) {
            LOG('step1.FAIL', { reason: 'compose trigger not found (only decoy buttons matched)' });
            return { success: false, error: 'Comment compose button not found — only decoy controls ("show more comments" / "more options") matched. LinkedIn feed DOM may have changed.' };
        }
        LOG('step1.OK', { triggerTag: trigger.tagName, ariaLabel: trigger.getAttribute('aria-label'), label: (trigger.innerText || '').trim().slice(0, 20), scoped: !!targetArticle });

        await scrollTo(trigger);
        await sleep(g(600, 150));
        await click(trigger);
        LOG('step1.clicked');

        // STEP 2 — wait for the reply input to appear (prefer the dialog composer
        // so we don't grab a stale/persistent editor elsewhere on the page).
        LOG('step2.findBox', { selector: P.replyBoxSelector });
        const box = await findActiveComposer(P.replyBoxSelector, 8000);
        if (!box) {
            LOG('step2.FAIL', { reason: 'reply box did not appear' });
            return { success: false, error: 'Reply box did not appear (clicked trigger but no editor opened)' };
        }
        LOG('step2.OK', { boxTag: box.tagName, contentEditable: box.isContentEditable });

        // STEP 3–5 — type, guard, submit and verify (shared with doQuote).
        return await composeAndSubmit(box, text, P.replyButtonSelector, P.commentVerifySelector, P.replyButtonTextRe, opts.dryRun);
    }

    // Find a dropdown menu item by its visible text (X's Repost menu shows
    // "Repost" and "Quote" as role=menuitem entries with no stable testid).
    async function findMenuItemByText(needle, timeout = 5000) {
        const want = needle.toLowerCase();
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] [role="menuitem"], div[role="menuitem"]'));
            const hit = items.find(el => isVisible(el) && (el.innerText || el.textContent || '').toLowerCase().includes(want));
            if (hit) return hit;
            await sleep(250);
        }
        return null;
    }

    // Repost (retweet) a post with no added text. Opens the retweet menu and
    // clicks the "Repost" confirmation.
    async function doRepost(P, postUrl) {
        const platform = location.hostname.replace(/^www\./, '');
        LOG('repost.start', { platform, postUrl: postUrl || location.href });
        if (!P.repostTrigger) return { success: false, error: 'Repost not supported on this platform' };

        const targetArticle = await resolveTargetArticle(postUrl);
        if (targetArticle) { try { await scrollTo(targetArticle); await sleep(g(500, 130)); } catch {} }

        // Already reposted?
        if (P.alreadyRepostedSelector) {
            const already = targetArticle ? targetArticle.querySelector(P.alreadyRepostedSelector) : document.querySelector(P.alreadyRepostedSelector);
            if (already) { LOG('repost.alreadyDone'); return { success: true, alreadyDone: true }; }
        }

        let trigger = targetArticle ? await waitForElementIn(targetArticle, P.repostTrigger, 6000) : null;
        if (!trigger) trigger = await waitForElement(P.repostTrigger);
        if (!trigger) return { success: false, error: 'Repost trigger not found' };
        await scrollTo(trigger);
        await sleep(g(600, 150));
        await click(trigger);
        LOG('repost.menuOpened');

        // Click the confirm item (testid first, then menu text fallback).
        let confirm = await waitForElement(P.repostConfirmSelector, 4000);
        if (!confirm) confirm = await findMenuItemByText('repost', 4000);
        if (!confirm) return { success: false, error: 'Repost confirm option not found' };
        await sleep(g(400, 120));
        await click(confirm);
        LOG('repost.confirmed');

        // Verify the button flipped to "unretweet" state.
        await sleep(g(1800, 400));
        let verified = false;
        if (P.alreadyRepostedSelector) {
            const t = Date.now();
            while (Date.now() - t < 4000) {
                const scope = targetArticle || document;
                if (scope.querySelector(P.alreadyRepostedSelector)) { verified = true; break; }
                await sleep(300);
            }
        }
        LOG('repost.result', { verified });
        return { success: true, verified };
    }

    // Quote-tweet a post with added text. Opens the retweet menu, clicks
    // "Quote", then reuses composeAndSubmit to type + submit + verify.
    async function doQuote(P, text, postUrl) {
        const platform = location.hostname.replace(/^www\./, '');
        LOG('quote.start', { platform, postUrl: postUrl || location.href, textLength: (text || '').length });
        if (!P.repostTrigger || !P.quoteComposerSelector) return { success: false, error: 'Quote not supported on this platform' };
        if (!text || typeof text !== 'string' || !text.trim()) {
            return { success: false, error: 'No quote text provided' };
        }

        const targetArticle = await resolveTargetArticle(postUrl);
        if (targetArticle) { try { await scrollTo(targetArticle); await sleep(g(500, 130)); } catch {} }

        let trigger = targetArticle ? await waitForElementIn(targetArticle, P.repostTrigger, 6000) : null;
        if (!trigger) trigger = await waitForElement(P.repostTrigger);
        if (!trigger) return { success: false, error: 'Repost/Quote trigger not found' };
        await scrollTo(trigger);
        await sleep(g(600, 150));
        await click(trigger);
        LOG('quote.menuOpened');

        // Pick the "Quote" menu item.
        const quoteItem = await findMenuItemByText('quote', 4000);
        if (!quoteItem) return { success: false, error: 'Quote option not found in repost menu' };
        await sleep(g(400, 120));
        await click(quoteItem);
        LOG('quote.composerRequested');

        // The quote composer is the same Draft editor as a new tweet — prefer the
        // dialog instance so we don't grab a stale editor elsewhere on the page.
        const box = await findActiveComposer(P.quoteComposerSelector, 8000);
        if (!box) return { success: false, error: 'Quote composer did not appear' };
        LOG('quote.composerReady');

        // STEP 3–5 — shared with doComment.
        return await composeAndSubmit(box, text, P.quoteButtonSelector || P.replyButtonSelector, P.commentVerifySelector);
    }

    async function verifyPosted(verifySelector, text, timeout = 4000) {
        if (!verifySelector) return true; // unknown platform — assume OK
        const needle = (text || '').trim().slice(0, 40).toLowerCase();
        if (needle.length < 8) return true; // too short to reliably match
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const nodes = document.querySelectorAll(verifySelector);
            for (const n of nodes) {
                const txt = (n.innerText || n.textContent || '').toLowerCase();
                if (txt.includes(needle)) return true;
            }
            await sleep(400);
        }
        return false;
    }
})();
