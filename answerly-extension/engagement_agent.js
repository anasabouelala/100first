/**
 * Answerly Engagement Agent v4.0
 * Injected into social platforms to perform stealth interactions.
 * Simulates human biometrics: Bezier mouse paths, gaussian delays,
 * typo simulation, wheel events, and realistic click sequences.
 */
(function() {
    // Platform-specific selectors
    const PLATFORMS = {
        'x.com': {
            likeSelector: '[data-testid="like"], [aria-label*="Like"]',
            alreadyLikedSelector: '[data-testid="unlike"], [aria-label*="Liked"]',
            replyTrigger: '[data-testid="reply"], [aria-label*="Reply"]',
            replyBoxSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content',
            replyButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
        },
        'twitter.com': {
            likeSelector: '[data-testid="like"], [aria-label*="Like"]',
            alreadyLikedSelector: '[data-testid="unlike"], [aria-label*="Liked"]',
            replyTrigger: '[data-testid="reply"], [aria-label*="Reply"]',
            replyBoxSelector: '[data-testid="tweetTextarea_0"], .public-DraftEditor-content',
            replyButtonSelector: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
        },
        'linkedin.com': {
            likeSelector: 'button[aria-label*="Like"], button.react-button__trigger, .reactions-react-button button',
            alreadyLikedSelector: 'button[aria-pressed="true"][aria-label*="Like"], button.react-button__trigger--active',
            replyTrigger: 'button[aria-label*="Comment"], button.comment-button, .artdeco-button--tertiary.comment-button',
            replyBoxSelector: '.ql-editor[contenteditable="true"], .comments-comment-box__content-editor',
            replyButtonSelector: 'button.comments-comment-box__submit-button, .comments-comment-box__dispatch-area button[type="submit"]',
        },
        'reddit.com': {
            likeSelector: 'button[aria-label="upvote"], [data-click-id="upvote"]',
            alreadyLikedSelector: 'button[aria-pressed="true"][aria-label="upvote"], .upvoted',
            replyTrigger: 'button[aria-label*="Reply"], [data-click-id="body"] .reply-button',
            replyBoxSelector: '.public-DraftEditor-content, shreddit-composer textarea, textarea[placeholder*="thoughts"]',
            replyButtonSelector: 'button[type="submit"], shreddit-composer [slot="submit-button"]',
        },
        'producthunt.com': {
            likeSelector: 'button[aria-label*="upvote"], button.vote-button',
            alreadyLikedSelector: 'button[aria-pressed="true"][aria-label*="upvote"]',
            replyTrigger: 'button:contains("Reply"), .reply-button',
            replyBoxSelector: 'textarea[placeholder*="comment"], .comment-box',
            replyButtonSelector: 'button[type="submit"]',
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

    async function waitForElement(sel, timeout = 15000) {
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
            await sleep(500);
        }
        return null;
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
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        await sleep(g(130, 35));
        el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0 }));
        await sleep(g(75, 20));
        el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
        el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        await sleep(g(250, 80));
    }

    // Typing with realistic speed variance and occasional typos
    const NEARBY = {a:'qwsz',s:'awedxz',d:'serfcx',f:'drtgvc',g:'ftyhbv',h:'gyujnb',j:'huikmn',
        k:'jiolm',l:'kop',q:'wa',w:'qeas',e:'wrsd',r:'etdf',t:'ryfg',y:'tugh',u:'yihj',
        i:'uojk',o:'ipkl',p:'ol',z:'asx',x:'zsdc',c:'xdfv',v:'cfgb',b:'vghn',n:'bhjm',m:'njk'};

    async function typeChar(el, ch) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        if (el.isContentEditable) {
            document.execCommand('insertText', false, ch);
        } else {
            const p = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (p) { p.set.call(el, el.value + ch); el.dispatchEvent(new Event('input', { bubbles: true })); }
            else document.execCommand('insertText', false, ch);
        }
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
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

    async function type(el, text) {
        el.focus();
        await sleep(g(700, 180));
        for (const ch of text) {
            // 4% typo chance
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
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
        if (msg.type === 'PERFORM_STEALTH_INTERACTION') {
            run(msg.actionType, msg.payload)
                .then(r => respond(r))
                .catch(e => respond({ success: false, error: e.message }));
            return true;
        }
    });

    async function run(actionType, payload) {
        const host = location.hostname.replace('www.', '');
        const P = PLATFORMS[host];
        if (!P) return { success: false, error: 'Unsupported platform: ' + host };

        // Phase 1: Arrive — pause and scroll like a human who just opened a link
        await sleep(g(3200, 900));
        const scrollDown = g(350, 80);
        window.scrollBy({ top: scrollDown, behavior: 'smooth' });
        await moveTo(g(window.innerWidth * 0.4, 100), g(window.innerHeight * 0.4, 80));
        await sleep(g(1400, 400));
        window.scrollBy({ top: -scrollDown * 0.35, behavior: 'smooth' });
        await sleep(g(800, 200));

        if (actionType === 'like') return await doLike(P);
        if (actionType === 'comment') return await doComment(P, payload.text);
        return { success: false, error: 'Unknown action' };
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

    async function doComment(P, text) {
        const trigger = await waitForElement(P.replyTrigger);
        if (!trigger) return { success: false, error: 'Reply trigger not found' };

        await scrollTo(trigger);
        await sleep(g(600, 150));
        await click(trigger);

        const box = await waitForElement(P.replyBoxSelector, 8000);
        if (!box) return { success: false, error: 'Reply box did not appear' };

        await sleep(g(700, 180));
        await click(box);
        await type(box, text);

        const submit = await waitForElement(P.replyButtonSelector, 5000);
        if (!submit || submit.disabled) return { success: false, error: 'Submit button not ready' };

        await scrollTo(submit);
        await sleep(g(400, 120));
        await click(submit);
        await moveTo(cursor.x - g(100, 40), cursor.y - g(60, 20));
        await sleep(g(1800, 400));
        return { success: true };
    }
})();
