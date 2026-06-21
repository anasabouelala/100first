/**
 * Viraholic Discovery Agent v1.0
 * ============================================
 * Content script injected on X / LinkedIn / Reddit for stealth account discovery.
 * Performs search result scraping and profile fingerprinting with full biometric simulation.
 *
 * Communicates with background.js via chrome.runtime.onMessage.
 *
 * Anti-bot defense:
 *  - Bezier mouse paths
 *  - Gaussian timing (Box-Muller)
 *  - Wheel events for natural scrolling
 *  - Realistic dwell times
 *  - Captcha / block detection sentinel
 *  - Visibility API respect (pauses if user switches tabs)
 */
(function() {
    'use strict';

    if (window.__answerly_discovery_agent_loaded__) return;
    window.__answerly_discovery_agent_loaded__ = true;

    const TAG = '[Discovery Agent]';
    const cursor = { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight };

    // ============================================================
    // CORE BIOMETRIC PRIMITIVES
    // ============================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function g(mean, std) {
        let u = 0, v = 0;
        while (!u) u = Math.random();
        while (!v) v = Math.random();
        return Math.max(0, (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) * std + mean);
    }

    async function waitForElement(sel, timeout = 12000) {
        const t = Date.now();
        while (Date.now() - t < timeout) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
            await sleep(g(450, 100));
        }
        return null;
    }

    async function waitForAny(selectors, timeout = 12000) {
        const t = Date.now();
        while (Date.now() - t < timeout) {
            for (const s of selectors) {
                const el = document.querySelector(s);
                if (el && el.offsetParent !== null) return { el, selector: s };
            }
            await sleep(g(450, 100));
        }
        return null;
    }

    function bezierPoint(t, p0, p1, p2, p3) {
        const u = 1 - t, tt = t * t, uu = u * u;
        return {
            x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
            y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y
        };
    }

    async function moveTo(tx, ty) {
        const sx = cursor.x, sy = cursor.y;
        const d = Math.hypot(tx - sx, ty - sy);
        if (d < 5) return;
        const overshoot = Math.random() < 0.12;
        const ex = overshoot ? tx + (Math.random() - 0.5) * 32 : tx;
        const ey = overshoot ? ty + (Math.random() - 0.5) * 32 : ty;
        const bias = (Math.random() - 0.5) * d * 0.4;
        const p1 = { x: sx + (ex - sx) * 0.3 + bias, y: sy + (ey - sy) * 0.3 - bias };
        const p2 = { x: sx + (ex - sx) * 0.7 - bias, y: sy + (ey - sy) * 0.7 + bias };
        const steps = Math.max(8, Math.floor(d / 12));
        const stepTime = g(420, 90) / steps;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            const pos = bezierPoint(ease, { x: sx, y: sy }, p1, p2, { x: ex, y: ey });
            cursor.x = pos.x; cursor.y = pos.y;
            document.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, clientX: cursor.x, clientY: cursor.y,
                screenX: cursor.x + window.screenX, screenY: cursor.y + window.screenY
            }));
            await sleep(stepTime);
        }
        if (overshoot) {
            await sleep(g(110, 30));
            await moveTo(tx, ty);
        } else {
            cursor.x = tx; cursor.y = ty;
        }
    }

    async function naturalScroll(targetY, opts = {}) {
        const startY = window.scrollY;
        const distance = targetY - startY;
        if (Math.abs(distance) < 50) return;

        const steps = Math.floor(g(opts.steps || 18, 4));
        for (let i = 0; i < steps; i++) {
            const p = i / steps;
            const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
            const delta = (distance / steps) * (1 + (ease - p) * 0.5);
            document.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, deltaY: delta, deltaX: 0,
                clientX: cursor.x, clientY: cursor.y
            }));
            window.scrollBy(0, delta);
            await sleep(g(45, 12));
        }
        await sleep(g(420, 100));
    }

    async function scrollToElement(el) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top >= 60 && r.bottom <= window.innerHeight - 60) return;
        const targetScrollY = window.scrollY + r.top - window.innerHeight / 2;
        await naturalScroll(targetScrollY);
    }

    /**
     * Deep scroll harvester — keeps scrolling and extracting until:
     *   - we hit `targetCount` candidates, OR
     *   - `maxDurationMs` elapsed, OR
     *   - `maxConsecutiveEmpty` empty scrolls in a row (true end of feed), OR
     *   - we hit `maxScrolls` (safety net)
     *
     * Handles SPA virtualization (X recycles DOM nodes) by extracting on EVERY scroll.
     * `extractFn(seen)` returns an array of new unique candidates.
     */
    async function deepScrollHarvest(extractFn, opts = {}) {
        const {
            targetCount = 200,
            maxDurationMs = 4 * 60 * 1000,
            maxScrolls = 200,
            maxConsecutiveEmpty = 8,
            scrollDistance = 1100,
            scrollVariance = 250,
            pauseBetween = 1700,
            pauseVariance = 500
        } = opts;

        const candidates = [];
        const seen = new Set();
        const startTime = Date.now();
        let scrolls = 0;
        let consecutiveEmpty = 0;
        let lastScrollY = -1;
        let stuckCount = 0;

        // Initial extract before scrolling
        const initial = extractFn(seen);
        for (const c of initial) {
            if (!c?.handle || seen.has(c.handle)) continue;
            seen.add(c.handle);
            candidates.push(c);
            if (candidates.length >= targetCount) return candidates;
        }

        while (
            candidates.length < targetCount &&
            scrolls < maxScrolls &&
            (Date.now() - startTime) < maxDurationMs
        ) {
            await waitUntilVisible();

            // Scroll down with random distance
            const targetY = window.scrollY + g(scrollDistance, scrollVariance);
            await naturalScroll(targetY);
            await sleep(g(pauseBetween, pauseVariance));

            // Detect "end of feed" — page didn't scroll, meaning we're at bottom
            if (window.scrollY === lastScrollY) {
                stuckCount++;
                if (stuckCount >= 3) {
                    // Try clicking "Show more" / "Load more" buttons
                    const moreBtn = document.querySelector(
                        'button[aria-label*="more" i], button[aria-label*="show" i], button.show-more-button, [data-testid="show-more"]'
                    );
                    if (moreBtn) {
                        try { moreBtn.click(); await sleep(g(2500, 600)); stuckCount = 0; }
                        catch {}
                    } else break; // genuinely done
                }
            } else {
                stuckCount = 0;
            }
            lastScrollY = window.scrollY;

            const before = candidates.length;
            const found = extractFn(seen);
            for (const c of found) {
                if (!c?.handle || seen.has(c.handle)) continue;
                seen.add(c.handle);
                candidates.push(c);
                if (candidates.length >= targetCount) break;
            }

            const newThisRound = candidates.length - before;
            if (newThisRound === 0) {
                consecutiveEmpty++;
                if (consecutiveEmpty >= maxConsecutiveEmpty) break;
            } else {
                consecutiveEmpty = 0;
            }
            scrolls++;
        }

        return candidates;
    }

    async function click(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const tx = r.left + r.width * (0.3 + Math.random() * 0.4);
        const ty = r.top + r.height * (0.3 + Math.random() * 0.4);
        await moveTo(tx, ty);
        const opts = {
            bubbles: true, cancelable: true, view: window,
            clientX: cursor.x, clientY: cursor.y,
            screenX: cursor.x + window.screenX, screenY: cursor.y + window.screenY
        };
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        await sleep(g(140, 35));
        el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0 }));
        await sleep(g(75, 20));
        el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
        el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        await sleep(g(280, 80));
        return true;
    }

    async function humanizedPageEnter() {
        // Mimic human arriving at a page: small initial pause, scroll a bit, glance around
        await sleep(g(2200, 700));
        await moveTo(g(window.innerWidth * 0.45, 80), g(window.innerHeight * 0.35, 70));
        await sleep(g(800, 200));
        await naturalScroll(window.scrollY + g(280, 80));
        await sleep(g(900, 250));
        // Sometimes scroll back up a bit
        if (Math.random() < 0.4) {
            await naturalScroll(window.scrollY - g(120, 40));
            await sleep(g(700, 180));
        }
    }

    // ============================================================
    // BLOCK / CAPTCHA / RATE LIMIT DETECTION
    // ============================================================
    function detectBlock() {
        const html = document.documentElement.innerHTML.slice(0, 50000).toLowerCase();
        const indicators = {
            captcha: ['captcha', 'are you human', 'verify you are', 'recaptcha', 'h-captcha', 'cf-challenge', 'security check'],
            rateLimit: ['rate limit', 'too many requests', '429', 'temporarily restricted', 'unusual activity'],
            // Login indicators must be specific enough to not false-positive on the
            // header "Log in" link that appears on every X/LinkedIn page.
            login: ['please log in to view', 'please sign in to view', 'sign up to view',
                    'create account to view', "you'll need to log in",
                    "don't miss what's happening", 'join linkedin to', 'sign up to follow'],
            block: ['account suspended', 'access denied', 'blocked', 'restricted access']
        };
        for (const [type, words] of Object.entries(indicators)) {
            for (const w of words) {
                if (html.includes(w)) {
                    const visibleCheck = document.body && document.body.innerText.toLowerCase().includes(w);
                    if (visibleCheck) {
                        return { blocked: true, type, indicator: w };
                    }
                }
            }
        }
        // Specific element checks — only a VISIBLE, RENDERED captcha iframe is a
        // real challenge. X embeds Google's INVISIBLE reCAPTCHA scoring frame
        // (recaptcha/api2/aframe, 0×0/display:none) on logged-in pages at all
        // times for bot-scoring; matching it falsely flagged every X scrape as
        // captcha-blocked. Exclude the invisible aframe + require real size.
        const captchaIframe = Array.from(document.querySelectorAll(
            'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]'
        )).find(f => {
            const src = f.getAttribute('src') || '';
            if (/recaptcha\/api2\/aframe/i.test(src)) return false;
            let r, cs;
            try { r = f.getBoundingClientRect(); cs = getComputedStyle(f); } catch { return false; }
            return r.width > 100 && r.height > 100
                && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        });
        if (captchaIframe) {
            return { blocked: true, type: 'captcha', indicator: 'iframe' };
        }
        if (document.querySelector('[data-testid="LoginForm_Login_Button"]') &&
            !window.location.pathname.includes('login')) {
            return { blocked: true, type: 'login', indicator: 'forced login wall' };
        }
        return { blocked: false };
    }

    function isVisible() {
        return document.visibilityState === 'visible';
    }

    async function waitUntilVisible() {
        while (!isVisible()) {
            await sleep(2000);
        }
    }

    // ============================================================
    // PLATFORM-SPECIFIC SCRAPERS
    // ============================================================
    const PLATFORM = (() => {
        const h = location.hostname.replace('www.', '');
        if (h.includes('x.com') || h.includes('twitter.com')) return 'X';
        if (h.includes('linkedin.com')) return 'LinkedIn';
        if (h.includes('reddit.com')) return 'Reddit';
        return null;
    })();

    // ──── X / Twitter ────
    // Reserved usernames that are NOT real users (paths)
    const X_RESERVED = new Set([
        'home','explore','notifications','messages','search','i','login','signup','tos','privacy',
        'about','settings','compose','intent','verified_followers','followers','following','status',
        'media','likes','with_replies','photo','header_photo','jobs','communities','bookmarks',
        'lists','topics','hashtag'
    ]);

    // Parse "1.2K", "5,432", "12.5M" → integer
    function parseFollowerCount(str) {
        if (!str) return null;
        const m = str.match(/([\d,.\s]+)\s*([kKmMbB])?\s*(followers?|abonnés|seguidores)?/i);
        if (!m) return null;
        const num = parseFloat(m[1].replace(/[,\s]/g, ''));
        if (isNaN(num)) return null;
        const mult = m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] : 1;
        return Math.round(num * mult);
    }

    // Look for follower count anywhere in a card's text
    function extractFollowersFromCard(card) {
        try {
            const text = card.innerText || '';
            // Pattern: "1.2K Followers" / "5,432 followers" / "1M abonnés"
            const m = text.match(/([\d,.\s]+[kKmMbB]?)\s*(followers?|abonnés|seguidores)/i);
            if (m) return parseFollowerCount(m[1]);
        } catch {}
        return null;
    }

    function extractXHandleFromHref(href) {
        if (!href) return null;
        const path = href.replace(/^https?:\/\/(?:www\.)?x\.com/, '').replace(/^https?:\/\/(?:www\.)?twitter\.com/, '');
        const segs = path.split('/').filter(Boolean);
        if (segs.length === 0) return null;
        const handle = segs[0].split('?')[0].split('#')[0];
        if (!handle || X_RESERVED.has(handle.toLowerCase())) return null;
        if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return null;
        return handle;
    }

    async function waitForXSearchHydration(maxMs = 18000) {
        const t0 = Date.now();
        while (Date.now() - t0 < maxMs) {
            // Check for any of: UserCell, primary column with content, or "no results" message
            const userCells = document.querySelectorAll('[data-testid="UserCell"]');
            if (userCells.length > 0) return { ready: true, cellCount: userCells.length };

            // Check fallback: any link to a profile in the timeline
            const profileLinks = document.querySelectorAll('[data-testid="primaryColumn"] a[role="link"][href^="/"]');
            const realHandleLinks = Array.from(profileLinks).filter(a => extractXHandleFromHref(a.getAttribute('href')));
            if (realHandleLinks.length >= 3) return { ready: true, fallbackLinkCount: realHandleLinks.length };

            // No-results state
            const txt = document.body?.innerText || '';
            if (/no results for|aucun résultat|try searching for/i.test(txt)) {
                return { ready: false, noResults: true };
            }
            await sleep(500);
        }
        return { ready: false, timeout: true };
    }

    async function scrapeXSearchResults(maxCandidates = 200) {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        const hydration = await waitForXSearchHydration();
        if (!hydration.ready) {
            return {
                candidates: [],
                diagnostic: {
                    hydration, url: location.href,
                    primaryColumnExists: !!document.querySelector('[data-testid="primaryColumn"]'),
                    bodyTextSample: (document.body?.innerText || '').slice(0, 400),
                    userCellCount: document.querySelectorAll('[data-testid="UserCell"]').length,
                    pageTitle: document.title
                }
            };
        }

        const collectCells = () => {
            const strategies = [
                '[data-testid="UserCell"]',
                '[data-testid="cellInnerDiv"] [data-testid="UserCell"]',
                'section[role="region"] [data-testid="cellInnerDiv"]',
                '[aria-label*="Timeline"] [data-testid="cellInnerDiv"]'
            ];
            for (const s of strategies) {
                const found = document.querySelectorAll(s);
                if (found.length > 0) return found;
            }
            return [];
        };

        const extract = (seen) => {
            const out = [];
            const cards = collectCells();
            for (const card of cards) {
                try {
                    const links = card.querySelectorAll('a[href^="/"]');
                    let handle = null;
                    for (const a of links) {
                        const h = extractXHandleFromHref(a.getAttribute('href'));
                        if (h) { handle = h; break; }
                    }
                    if (!handle || seen.has(handle)) continue;
                    const nameEl = card.querySelector('[data-testid="User-Name"] span, [dir="ltr"] span');
                    const bioEl = card.querySelector('[data-testid="UserDescription"]');
                    const verified = !!card.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified" i]');
                    const avatarEl = card.querySelector('img[src*="profile_images"], [data-testid*="UserAvatar"] img');
                    const followerHint = extractFollowersFromCard(card);
                    out.push({
                        handle,
                        url: `https://x.com/${handle}`,
                        displayName: nameEl?.innerText?.trim() || handle,
                        bio: bioEl?.innerText?.trim()?.slice(0, 280) || '',
                        verified,
                        avatar: avatarEl?.src,
                        followerHint,
                        platform: 'X'
                    });
                } catch {}
            }
            // Fallback: any profile link in primary column
            if (cards.length === 0) {
                const allLinks = document.querySelectorAll('[data-testid="primaryColumn"] a[href^="/"]');
                for (const a of allLinks) {
                    const h = extractXHandleFromHref(a.getAttribute('href'));
                    if (!h || seen.has(h)) continue;
                    out.push({
                        handle: h, url: `https://x.com/${h}`,
                        displayName: a.innerText?.trim() || h,
                        bio: '', verified: false, avatar: null, platform: 'X'
                    });
                }
            }
            return out;
        };

        const candidates = await deepScrollHarvest(extract, {
            targetCount: maxCandidates,
            maxDurationMs: 90 * 1000,
            scrollDistance: 1200,
            pauseBetween: 1700
        });

        return {
            candidates,
            diagnostic: candidates.length === 0 ? {
                url: location.href,
                userCellCount: document.querySelectorAll('[data-testid="UserCell"]').length,
                anyProfileLinks: document.querySelectorAll('a[href^="/"]').length,
                primaryColumn: !!document.querySelector('[data-testid="primaryColumn"]'),
                pageTitle: document.title,
                bodyTextSample: (document.body?.innerText || '').slice(0, 300)
            } : undefined
        };
    }

    async function scrapeXProfile() {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        // Wait for primary profile elements
        await waitForElement('[data-testid="UserName"], [data-testid="UserDescription"]', 10000);
        await sleep(g(1200, 400));

        const parseCount = (str) => {
            if (!str) return 0;
            const s = str.replace(/[^\d.kKmMbB]/g, '');
            const n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (/[kK]/.test(s)) return Math.round(n * 1000);
            if (/[mM]/.test(s)) return Math.round(n * 1e6);
            if (/[bB]/.test(s)) return Math.round(n * 1e9);
            return Math.round(n);
        };

        try {
            const handle = window.location.pathname.split('/').filter(Boolean)[0];
            const nameEl = document.querySelector('[data-testid="UserName"] [dir="ltr"] span');
            const bioEl = document.querySelector('[data-testid="UserDescription"]');
            const avatar = document.querySelector('a[href$="/photo"] img')?.src;
            const verified = !!document.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified"]');

            // Followers / Following — robust extraction.
            // X DOM rotates frequently. The follower/following counts can be:
            //   (a) inside an <a href$="/followers"> with the count as innerText
            //   (b) inside <a href*="/verified_followers"> for verified accounts
            //   (c) inside a nested <span> sibling that innerText doesn't catch
            //   (d) prefixed/suffixed with the word "Followers" / "Following"
            // We scan ALL anchors in the primary column and grab whichever matches.
            function extractCountFromAnchor(a) {
                if (!a) return 0;
                const txt = (a.textContent || '').trim();
                // First: try matching "1,234 Followers" or "1.2K Followers" pattern
                const m = txt.match(/([\d.,]+\s*[KkMmBb]?)\s*(?:Verified\s+)?Followers?/i)
                    || txt.match(/([\d.,]+\s*[KkMmBb]?)\s*Following/i);
                if (m) return parseCount(m[1]);
                // Fallback: just the first number group anywhere in the link
                const m2 = txt.match(/([\d.,]+\s*[KkMmBb]?)/);
                return m2 ? parseCount(m2[1]) : 0;
            }
            let followers = 0, following = 0;
            const allAnchors = document.querySelectorAll('[data-testid="primaryColumn"] a[role="link"], [data-testid="UserName"] ~ * a[role="link"]');
            for (const a of allAnchors) {
                const href = a.getAttribute('href') || '';
                if (/\/(verified_followers|followers)$/.test(href) && !followers) {
                    followers = extractCountFromAnchor(a);
                } else if (/\/following$/.test(href) && !following) {
                    following = extractCountFromAnchor(a);
                }
                if (followers && following) break;
            }
            // Last-resort: scan body text for "X Followers"
            if (!followers) {
                const bodyTxt = document.body?.innerText || '';
                const m = bodyTxt.match(/([\d.,]+\s*[KkMmBb]?)\s*(?:Verified\s+)?Followers/i);
                if (m) followers = parseCount(m[1]);
            }
            if (!following) {
                const bodyTxt = document.body?.innerText || '';
                const m = bodyTxt.match(/([\d.,]+\s*[KkMmBb]?)\s*Following/i);
                if (m) following = parseCount(m[1]);
            }

            // Recent tweets for engagement signal
            const tweets = document.querySelectorAll('[data-testid="tweet"]');
            const sampleHooks = [];
            const engagementSamples = [];
            for (let i = 0; i < Math.min(tweets.length, 5); i++) {
                const t = tweets[i];
                const text = t.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 200);
                if (text) sampleHooks.push(text);
                const likes = parseCount(t.querySelector('[data-testid="like"] span')?.innerText);
                const reposts = parseCount(t.querySelector('[data-testid="retweet"] span')?.innerText);
                const replies = parseCount(t.querySelector('[data-testid="reply"] span')?.innerText);
                if (likes || reposts || replies) {
                    engagementSamples.push({ likes, reposts, replies });
                }
            }

            const avgEngagement = engagementSamples.length
                ? engagementSamples.reduce((s, e) => s + e.likes + e.reposts + e.replies, 0) / engagementSamples.length
                : 0;
            const engagementRate = followers > 0 ? (avgEngagement / followers) * 100 : 0;

            // Last active heuristic
            const timeEl = document.querySelector('time');
            const lastActive = timeEl?.getAttribute('datetime') || null;

            return {
                profile: {
                    handle,
                    url: `https://x.com/${handle}`,
                    displayName: nameEl?.innerText?.trim() || handle,
                    bio: bioEl?.innerText?.trim() || '',
                    avatar,
                    verified,
                    followers,
                    following,
                    avgEngagement: Math.round(avgEngagement),
                    engagementRate: parseFloat(engagementRate.toFixed(2)),
                    sampleHooks,
                    lastActive,
                    platform: 'X'
                }
            };
        } catch (e) {
            return { error: 'Profile scrape failed: ' + e.message };
        }
    }

    // ──── LinkedIn ────
    async function scrapeLinkedInSearchResults(maxCandidates = 200) {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        const extract = (seen) => {
            const out = [];
            const cards = document.querySelectorAll('.reusable-search__result-container, [data-chameleon-result-urn], li.search-result, .entity-result');
            for (const card of cards) {
                try {
                    const link = card.querySelector('a[href*="/in/"]');
                    if (!link) continue;
                    const url = link.href.split('?')[0];
                    const handle = url.split('/in/')[1]?.replace(/\/$/, '');
                    if (!handle || seen.has(handle)) continue;
                    const nameEl = card.querySelector('.entity-result__title-text a span[aria-hidden="true"], .actor-name, [class*="actor-name"]');
                    const titleEl = card.querySelector('.entity-result__primary-subtitle, .subline-level-1');
                    const locEl = card.querySelector('.entity-result__secondary-subtitle, .subline-level-2');
                    const avatar = card.querySelector('img.presence-entity__image, img[class*="EntityPhoto"]')?.src;
                    const followerHint = extractFollowersFromCard(card);
                    out.push({
                        handle, url,
                        displayName: nameEl?.innerText?.trim() || handle,
                        bio: [titleEl?.innerText, locEl?.innerText].filter(Boolean).join(' · ').trim().slice(0, 280),
                        verified: false, avatar, followerHint, platform: 'LinkedIn'
                    });
                } catch {}
            }
            return out;
        };

        const candidates = await deepScrollHarvest(extract, {
            targetCount: maxCandidates,
            maxDurationMs: 90 * 1000,
            scrollDistance: 1000,
            pauseBetween: 1700
        });

        return { candidates };
    }

    async function scrapeLinkedInProfile() {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        await waitForElement('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .top-card-layout__title', 10000);
        await sleep(g(1200, 400));

        const parseCount = (str) => {
            if (!str) return 0;
            const s = str.replace(/[^\d.kKmMbB+]/g, '');
            const n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (/[kK]/.test(s)) return Math.round(n * 1000);
            if (/[mM]/.test(s)) return Math.round(n * 1e6);
            return Math.round(n);
        };

        try {
            const url = window.location.href.split('?')[0];
            const handle = url.split('/in/')[1]?.replace(/\/$/, '') || '';
            const nameEl = document.querySelector('h1.text-heading-xlarge, .pv-text-details__left-panel h1, .top-card-layout__title');
            const headlineEl = document.querySelector('.text-body-medium.break-words, .top-card-layout__headline, [data-test-id="hero-title"]');
            const locEl = document.querySelector('.text-body-small.inline.t-black--light.break-words, .top-card__subline-item');
            const avatar = document.querySelector('img.pv-top-card__photo, img.profile-photo-edit__preview, .top-card-layout__entity-image-container img')?.src;

            // Followers — robust extraction across LinkedIn DOM variants.
            let followers = 0;
            // Strategy 1: scan ALL elements for "X followers" pattern
            const allEls = document.querySelectorAll('span, p, div, li');
            for (const el of allEls) {
                const t = (el.innerText || '').toLowerCase();
                if (t.length > 200) continue; // skip giant blocks
                if (!/follower|abonnés|seguidores/i.test(t)) continue;
                if (/following/i.test(t)) continue;
                const m = t.match(/([\d.,]+\s*[kKmMbB]?)\s*(?:follower|abonnés|seguidores)/i);
                if (m) {
                    const num = parseCount(m[1]);
                    if (num > followers) followers = num;
                }
            }
            // Strategy 2: body text last-resort
            if (!followers) {
                const bodyTxt = document.body?.innerText || '';
                const m = bodyTxt.match(/([\d.,]+\s*[kKmMbB]?)\s*followers/i);
                if (m) followers = parseCount(m[1]);
            }
            // Connections fallback (LinkedIn shows connections instead of followers for many profiles)
            const connectionsEl = Array.from(document.querySelectorAll('span, li'))
                .find(el => /\d[\d,.]*\+?\s+(connection|relation)/i.test(el.innerText || ''));
            const connections = connectionsEl ? parseCount(connectionsEl.innerText) : 0;
            if (!followers && connections) followers = connections;

            // About section
            const aboutEl = document.querySelector('#about ~ * .display-flex .visually-hidden, [data-section="summary"] .pv-shared-text-with-see-more');
            const about = aboutEl?.innerText?.trim().slice(0, 500);

            return {
                profile: {
                    handle,
                    url,
                    displayName: nameEl?.innerText?.trim() || handle,
                    bio: headlineEl?.innerText?.trim() || '',
                    about: about || '',
                    location: locEl?.innerText?.trim() || '',
                    avatar,
                    verified: false,
                    followers,
                    following: connections,
                    avgEngagement: 0,
                    engagementRate: 0,
                    sampleHooks: [],
                    platform: 'LinkedIn'
                }
            };
        } catch (e) {
            return { error: 'Profile scrape failed: ' + e.message };
        }
    }

    // ──── Reddit ────
    async function scrapeRedditSearchResults(maxCandidates = 200) {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        const extract = (seen) => {
            const out = [];
            const cards = document.querySelectorAll(
                'a[href^="/user/"], faceplate-tracker[noun="user"] a[href^="/user/"], shreddit-profile-card, [data-testid="user-result"]'
            );
            for (const card of cards) {
                try {
                    const link = card.tagName === 'A' ? card : card.querySelector('a[href^="/user/"]');
                    if (!link) continue;
                    const username = link.href.split('/user/')[1]?.split('/')[0];
                    if (!username || seen.has(username)) continue;
                    if (username.length > 30) continue;
                    const container = card.closest('[role="article"], shreddit-profile-card, faceplate-tracker, .search-result');
                    const ctx = container || card;
                    const nameEl = ctx.querySelector('h6, h3, .username, [class*="title"]');
                    const bioEl = ctx.querySelector('p, [class*="description"], [class*="bio"]');
                    const avatar = ctx.querySelector('img[src*="redditstatic"], faceplate-img')?.src
                        || ctx.querySelector('img')?.src;
                    out.push({
                        handle: username,
                        url: `https://www.reddit.com/user/${username}/`,
                        displayName: nameEl?.innerText?.trim() || `u/${username}`,
                        bio: bioEl?.innerText?.trim()?.slice(0, 280) || '',
                        verified: false, avatar, platform: 'Reddit'
                    });
                } catch {}
            }
            return out;
        };

        const candidates = await deepScrollHarvest(extract, {
            targetCount: maxCandidates,
            maxDurationMs: 90 * 1000,
            scrollDistance: 900,
            pauseBetween: 1600
        });

        return { candidates };
    }

    async function scrapeRedditProfile() {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        await sleep(g(1500, 400));

        const parseCount = (str) => {
            if (!str) return 0;
            const s = str.replace(/[^\d.kKmMbB]/g, '');
            const n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (/[kK]/.test(s)) return Math.round(n * 1000);
            if (/[mM]/.test(s)) return Math.round(n * 1e6);
            return Math.round(n);
        };

        try {
            const username = window.location.pathname.split('/user/')[1]?.split('/')[0];
            const url = `https://www.reddit.com/user/${username}/`;

            // Karma extraction (multiple selectors)
            let karma = 0;
            const karmaSelectors = [
                '[id*="profile--id-card--highlight-tooltip--karma"]',
                'shreddit-profile-card [slot="karma"]',
                '[data-testid="profile-karma"]',
                '#profile--id-card--highlight-tooltip--karma'
            ];
            for (const sel of karmaSelectors) {
                const el = document.querySelector(sel);
                if (el?.innerText) {
                    karma = parseCount(el.innerText);
                    if (karma) break;
                }
            }
            // Fallback: scan page for karma text
            if (!karma) {
                const text = document.body.innerText;
                const m = text.match(/([\d.,]+[kKmM]?)\s+(karma|points)/i);
                if (m) karma = parseCount(m[1]);
            }

            const bioEl = document.querySelector('[data-testid="profile-description"], .profile-description, shreddit-profile-card [slot="description"]');
            const avatar = document.querySelector('faceplate-img[src*="profile"], img[alt*="avatar" i]')?.src;

            // Recent posts for sample hooks
            const posts = document.querySelectorAll('shreddit-post, [data-testid="post-container"]');
            const sampleHooks = [];
            for (let i = 0; i < Math.min(posts.length, 5); i++) {
                const titleEl = posts[i].querySelector('[slot="title"], h3, h2');
                if (titleEl) sampleHooks.push(titleEl.innerText.slice(0, 200));
            }

            return {
                profile: {
                    handle: username,
                    url,
                    displayName: `u/${username}`,
                    bio: bioEl?.innerText?.trim()?.slice(0, 280) || '',
                    avatar,
                    verified: false,
                    followers: karma, // Reddit uses karma as authority signal
                    following: 0,
                    avgEngagement: 0,
                    engagementRate: 0,
                    sampleHooks,
                    platform: 'Reddit'
                }
            };
        } catch (e) {
            return { error: 'Profile scrape failed: ' + e.message };
        }
    }

    // ============================================================
    // POST-AUTHOR SCRAPERS (extract unique authors from a post-search feed)
    // ============================================================
    async function scrapeXPostAuthors(maxCandidates = 200) {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        // Wait for tweets to hydrate
        const t0 = Date.now();
        let tweets = [];
        while (Date.now() - t0 < 18000) {
            tweets = document.querySelectorAll('article[data-testid="tweet"]');
            if (tweets.length > 0) break;
            const txt = document.body?.innerText || '';
            if (/no results for|aucun résultat/i.test(txt)) {
                return { candidates: [], diagnostic: { hydration: { noResults: true }, url: location.href, pageTitle: document.title } };
            }
            await sleep(500);
        }
        if (tweets.length === 0) {
            return {
                candidates: [],
                diagnostic: {
                    hydration: { timeout: true }, url: location.href,
                    bodyTextSample: (document.body?.innerText || '').slice(0, 300),
                    pageTitle: document.title
                }
            };
        }

        const extract = (seen) => {
            const out = [];
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            for (const article of articles) {
                try {
                    const userNameEl = article.querySelector('[data-testid="User-Name"]');
                    if (!userNameEl) continue;
                    const links = userNameEl.querySelectorAll('a[href^="/"]');
                    let handle = null;
                    for (const a of links) {
                        const h = extractXHandleFromHref(a.getAttribute('href'));
                        if (h) { handle = h; break; }
                    }
                    if (!handle || seen.has(handle)) continue;
                    const displayName = userNameEl.querySelector('span')?.innerText?.trim() || handle;
                    const verified = !!article.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified" i]');
                    const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
                    const samplePost = tweetTextEl?.innerText?.trim()?.slice(0, 240) || '';
                    out.push({
                        handle, url: `https://x.com/${handle}`,
                        displayName, bio: '', verified, samplePost,
                        platform: 'X', discoveredVia: 'post'
                    });
                } catch {}
            }
            return out;
        };

        const candidates = await deepScrollHarvest(extract, {
            targetCount: maxCandidates,
            maxDurationMs: 90 * 1000,
            scrollDistance: 1300,
            pauseBetween: 1800
        });

        return {
            candidates,
            diagnostic: candidates.length === 0 ? {
                url: location.href,
                tweetCount: document.querySelectorAll('article[data-testid="tweet"]').length,
                pageTitle: document.title,
                bodyTextSample: (document.body?.innerText || '').slice(0, 300)
            } : undefined
        };
    }

    async function scrapeLinkedInPostAuthors(maxCandidates = 200) {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        const t0 = Date.now();
        while (Date.now() - t0 < 18000) {
            const posts = document.querySelectorAll('div.feed-shared-update-v2, div.update-components-actor');
            if (posts.length > 0) break;
            await sleep(500);
        }

        const extract = (seen) => {
            const out = [];
            const posts = document.querySelectorAll('div.feed-shared-update-v2, li.reusable-search__result-container');
            for (const post of posts) {
                try {
                    const actor = post.querySelector('a.update-components-actor__meta-link, a[data-control-name="actor"], a[href*="/in/"]');
                    if (!actor) continue;
                    const href = actor.getAttribute('href') || '';
                    const m = href.match(/\/in\/([^/?#]+)/);
                    if (!m) continue;
                    const handle = m[1];
                    if (seen.has(handle)) continue;
                    const nameEl = post.querySelector('.update-components-actor__title, .actor-name');
                    const displayName = nameEl?.innerText?.trim().split('\n')[0] || handle;
                    const subtitle = post.querySelector('.update-components-actor__description')?.innerText?.trim()?.slice(0, 200) || '';
                    const postContent = post.querySelector('.feed-shared-update-v2__description, .update-components-text')?.innerText?.trim()?.slice(0, 240) || '';
                    out.push({
                        handle, url: `https://www.linkedin.com/in/${handle}/`,
                        displayName, bio: subtitle, samplePost: postContent,
                        verified: false, platform: 'LinkedIn', discoveredVia: 'post'
                    });
                } catch {}
            }
            return out;
        };

        const candidates = await deepScrollHarvest(extract, {
            targetCount: maxCandidates,
            maxDurationMs: 90 * 1000,
            scrollDistance: 1100,
            pauseBetween: 2000
        });

        return {
            candidates,
            diagnostic: candidates.length === 0 ? {
                url: location.href,
                postCount: document.querySelectorAll('div.feed-shared-update-v2').length,
                pageTitle: document.title,
                bodyTextSample: (document.body?.innerText || '').slice(0, 300)
            } : undefined
        };
    }

    async function scrapeRedditPostAuthors(maxCandidates = 200) {
        const block = detectBlock();
        if (block.blocked) return { error: `Blocked: ${block.type}`, blocked: block };

        const t0 = Date.now();
        while (Date.now() - t0 < 18000) {
            const posts = document.querySelectorAll('shreddit-post, [data-testid="search-post"], a[href*="/comments/"]');
            if (posts.length > 0) break;
            await sleep(500);
        }

        const extract = (seen) => {
            const out = [];
            const posts = document.querySelectorAll('shreddit-post, [data-testid="search-post"]');
            for (const post of posts) {
                try {
                    let handle = post.getAttribute?.('author');
                    if (!handle) {
                        const a = post.querySelector?.('a[href^="/user/"]');
                        if (a) {
                            const m = a.getAttribute('href').match(/\/user\/([^/?#]+)/);
                            if (m) handle = m[1];
                        }
                    }
                    if (!handle || handle === 'undefined' || handle === '[deleted]') continue;
                    if (seen.has(handle)) continue;
                    const titleEl = post.querySelector?.('[slot="title"], h3, [data-testid="post-title"]');
                    const samplePost = titleEl?.innerText?.trim()?.slice(0, 240) || '';
                    out.push({
                        handle, url: `https://www.reddit.com/user/${handle}/`,
                        displayName: handle, bio: '', samplePost,
                        verified: false, platform: 'Reddit', discoveredVia: 'post'
                    });
                } catch {}
            }
            return out;
        };

        const candidates = await deepScrollHarvest(extract, {
            targetCount: maxCandidates,
            maxDurationMs: 90 * 1000,
            scrollDistance: 1100,
            pauseBetween: 1900
        });

        return {
            candidates,
            diagnostic: candidates.length === 0 ? {
                url: location.href,
                postCount: document.querySelectorAll('shreddit-post, [data-testid="search-post"]').length,
                pageTitle: document.title,
                bodyTextSample: (document.body?.innerText || '').slice(0, 300)
            } : undefined
        };
    }

    // ============================================================
    // MESSAGE DISPATCHER
    // ============================================================
    chrome.runtime.onMessage.addListener((msg, sender, respond) => {
        if (!msg.type || !msg.type.startsWith('DISCOVERY_')) return;

        (async () => {
            try {
                if (msg.type === 'DISCOVERY_DETECT_BLOCK') {
                    return respond(detectBlock());
                }
                if (msg.type === 'DISCOVERY_HUMANIZE_ENTRY') {
                    await humanizedPageEnter();
                    return respond({ ok: true });
                }
                if (msg.type === 'DISCOVERY_SCRAPE_SEARCH') {
                    const max = msg.maxCandidates || 20;
                    let result;
                    if (PLATFORM === 'X') result = await scrapeXSearchResults(max);
                    else if (PLATFORM === 'LinkedIn') result = await scrapeLinkedInSearchResults(max);
                    else if (PLATFORM === 'Reddit') result = await scrapeRedditSearchResults(max);
                    else result = { error: 'Platform not supported: ' + location.hostname };
                    return respond(result);
                }
                if (msg.type === 'DISCOVERY_SCRAPE_POSTS') {
                    const max = msg.maxCandidates || 20;
                    let result;
                    if (PLATFORM === 'X') result = await scrapeXPostAuthors(max);
                    else if (PLATFORM === 'LinkedIn') result = await scrapeLinkedInPostAuthors(max);
                    else if (PLATFORM === 'Reddit') result = await scrapeRedditPostAuthors(max);
                    else result = { error: 'Platform not supported: ' + location.hostname };
                    return respond(result);
                }
                if (msg.type === 'DISCOVERY_SCRAPE_FALLBACK') {
                    // Last-resort: brute-force extract any profile link from the page.
                    // Engine calls this when normal scrape returns 0 candidates.
                    // Profile pages will be visited later to enrich follower count etc.
                    const out = [];
                    const seen = new Set();
                    if (PLATFORM === 'X') {
                        const allLinks = document.querySelectorAll('a[href^="/"]');
                        for (const a of allLinks) {
                            const h = extractXHandleFromHref(a.getAttribute('href'));
                            if (!h || seen.has(h)) continue;
                            seen.add(h);
                            out.push({
                                handle: h, url: `https://x.com/${h}`,
                                displayName: (a.innerText || '').trim().slice(0, 60) || h,
                                bio: '', verified: false, platform: 'X', discoveredVia: 'fallback'
                            });
                            if (out.length >= 50) break;
                        }
                    } else if (PLATFORM === 'LinkedIn') {
                        const allLinks = document.querySelectorAll('a[href*="/in/"]');
                        for (const a of allLinks) {
                            const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                            if (!m || seen.has(m[1])) continue;
                            seen.add(m[1]);
                            out.push({
                                handle: m[1], url: `https://www.linkedin.com/in/${m[1]}`,
                                displayName: (a.innerText || '').trim().slice(0, 60) || m[1],
                                bio: '', verified: false, platform: 'LinkedIn', discoveredVia: 'fallback'
                            });
                            if (out.length >= 50) break;
                        }
                    } else if (PLATFORM === 'Reddit') {
                        const allLinks = document.querySelectorAll('a[href*="/user/"], a[href*="/u/"]');
                        for (const a of allLinks) {
                            const m = (a.getAttribute('href') || '').match(/\/(?:user|u)\/([^/?#]+)/);
                            if (!m || seen.has(m[1])) continue;
                            seen.add(m[1]);
                            out.push({
                                handle: m[1], url: `https://www.reddit.com/user/${m[1]}`,
                                displayName: (a.innerText || '').trim().slice(0, 60) || m[1],
                                bio: '', verified: false, platform: 'Reddit', discoveredVia: 'fallback'
                            });
                            if (out.length >= 50) break;
                        }
                    }
                    return respond({ candidates: out, fallback: true });
                }
                if (msg.type === 'DISCOVERY_SCRAPE_PROFILE') {
                    let result;
                    if (PLATFORM === 'X') result = await scrapeXProfile();
                    else if (PLATFORM === 'LinkedIn') result = await scrapeLinkedInProfile();
                    else if (PLATFORM === 'Reddit') result = await scrapeRedditProfile();
                    else result = { error: 'Platform not supported' };
                    return respond(result);
                }
                if (msg.type === 'DISCOVERY_IDLE_BEHAVIOR') {
                    // Random idle activity to mimic a human pausing between actions
                    const action = Math.random();
                    if (action < 0.3) {
                        await naturalScroll(window.scrollY + g(150, 80));
                    } else if (action < 0.6) {
                        await moveTo(g(window.innerWidth * Math.random(), 50), g(window.innerHeight * 0.5, 100));
                    }
                    await sleep(g(msg.duration || 2000, 600));
                    return respond({ ok: true });
                }
                respond({ error: 'Unknown discovery message: ' + msg.type });
            } catch (e) {
                respond({ error: e.message });
            }
        })();
        return true; // async response
    });

    // Mark fully-ready state. If the probe sees __loaded__=true but __ready__=false,
    // the IIFE crashed between the early flag and this point — listener never bound.
    window.__answerly_discovery_agent_ready__ = true;
    window.__answerly_discovery_agent_platform__ = PLATFORM;

    // ─── DIRECT-CALL API (bypass chrome.tabs.sendMessage) ───
    // chrome.tabs.sendMessage on x.com has been observed to time out even with a
    // healthy listener bound. Expose every operation as a window-attached function
    // so the engine can call it via chrome.scripting.executeScript instead. Same
    // ISOLATED world → closures keep working.
    window.__answerly_agent_api__ = {
        async handle(msg) {
            try {
                if (!msg || !msg.type) return { error: 'No msg.type' };
                if (msg.type === 'DISCOVERY_DETECT_BLOCK') return detectBlock();
                if (msg.type === 'DISCOVERY_HUMANIZE_ENTRY') { await humanizedPageEnter(); return { ok: true }; }
                if (msg.type === 'DISCOVERY_SCRAPE_SEARCH') {
                    const max = msg.maxCandidates || 20;
                    if (PLATFORM === 'X') return await scrapeXSearchResults(max);
                    if (PLATFORM === 'LinkedIn') return await scrapeLinkedInSearchResults(max);
                    if (PLATFORM === 'Reddit') return await scrapeRedditSearchResults(max);
                    return { error: 'Platform not supported: ' + location.hostname };
                }
                if (msg.type === 'DISCOVERY_SCRAPE_POSTS') {
                    const max = msg.maxCandidates || 20;
                    if (PLATFORM === 'X') return await scrapeXPostAuthors(max);
                    if (PLATFORM === 'LinkedIn') return await scrapeLinkedInPostAuthors(max);
                    if (PLATFORM === 'Reddit') return await scrapeRedditPostAuthors(max);
                    return { error: 'Platform not supported' };
                }
                if (msg.type === 'DISCOVERY_SCRAPE_FALLBACK') {
                    const out = [];
                    const seen = new Set();
                    if (PLATFORM === 'X') {
                        for (const a of document.querySelectorAll('a[href^="/"]')) {
                            const h = extractXHandleFromHref(a.getAttribute('href'));
                            if (!h || seen.has(h)) continue;
                            seen.add(h);
                            out.push({ handle: h, url: `https://x.com/${h}`, displayName: (a.innerText || '').trim().slice(0, 60) || h, bio: '', verified: false, platform: 'X', discoveredVia: 'fallback' });
                            if (out.length >= 50) break;
                        }
                    } else if (PLATFORM === 'LinkedIn') {
                        for (const a of document.querySelectorAll('a[href*="/in/"]')) {
                            const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                            if (!m || seen.has(m[1])) continue;
                            seen.add(m[1]);
                            out.push({ handle: m[1], url: `https://www.linkedin.com/in/${m[1]}`, displayName: (a.innerText || '').trim().slice(0, 60) || m[1], bio: '', verified: false, platform: 'LinkedIn', discoveredVia: 'fallback' });
                            if (out.length >= 50) break;
                        }
                    } else if (PLATFORM === 'Reddit') {
                        for (const a of document.querySelectorAll('a[href*="/user/"], a[href*="/u/"]')) {
                            const m = (a.getAttribute('href') || '').match(/\/(?:user|u)\/([^/?#]+)/);
                            if (!m || seen.has(m[1])) continue;
                            seen.add(m[1]);
                            out.push({ handle: m[1], url: `https://www.reddit.com/user/${m[1]}`, displayName: (a.innerText || '').trim().slice(0, 60) || m[1], bio: '', verified: false, platform: 'Reddit', discoveredVia: 'fallback' });
                            if (out.length >= 50) break;
                        }
                    }
                    return { candidates: out, fallback: true };
                }
                if (msg.type === 'DISCOVERY_SCRAPE_PROFILE') {
                    if (PLATFORM === 'X') return await scrapeXProfile();
                    if (PLATFORM === 'LinkedIn') return await scrapeLinkedInProfile();
                    if (PLATFORM === 'Reddit') return await scrapeRedditProfile();
                    return { error: 'Platform not supported' };
                }
                if (msg.type === 'DISCOVERY_IDLE_BEHAVIOR') {
                    const action = Math.random();
                    if (action < 0.3) await naturalScroll(window.scrollY + g(150, 80));
                    else if (action < 0.6) await moveTo(g(window.innerWidth * Math.random(), 50), g(window.innerHeight * 0.5, 100));
                    await sleep(g(msg.duration || 2000, 600));
                    return { ok: true };
                }
                return { error: 'Unknown discovery op: ' + msg.type };
            } catch (e) {
                return { error: (e && e.message) ? e.message : String(e) };
            }
        }
    };

    console.log(TAG, `Loaded on ${PLATFORM || 'unknown'} platform. API exposed.`);
})();
