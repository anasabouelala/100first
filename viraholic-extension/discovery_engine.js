/**
 * Viraholic Discovery Engine v1.0
 * ============================================
 * Mission orchestrator for stealth account discovery.
 * Imported into background.js as a service worker module.
 *
 * Responsibilities:
 *  - Mission lifecycle (start/pause/resume/abort)
 *  - Stealth window management
 *  - Platform-by-platform query execution
 *  - Rate limiting & cooldowns
 *  - Detection handling (captcha → abort/cooldown)
 *  - Result scoring & deduplication
 *  - Real-time state sync to web app via chrome.storage
 *
 * Communicates with discovery_agent.js (content script) via chrome.tabs.sendMessage.
 */

// ============================================================
// ENGAGEMENT THRESHOLDS  — single source of truth
// ============================================================
// The panel's engagementFloor preset ('any'|'some'|'real'|'viral') maps to
// per-platform numeric thresholds here. These numbers feed three places:
//   1) URL builders          → X's native min_faves / min_retweets operators
//   2) Card pre-filter       → drop candidates whose visible engagement is low
//   3) Subreddit aliveness   → drop dead subs whose median top-week post is below
// No magic numbers elsewhere — change a level here and it propagates.
const ENGAGEMENT_THRESHOLDS = {
    X: {
        any:   { min_faves: 0,   min_retweets: 0,   card_total: 0   },
        some:  { min_faves: 10,  min_retweets: 0,   card_total: 10  },
        real:  { min_faves: 50,  min_retweets: 5,   card_total: 50  },
        viral: { min_faves: 500, min_retweets: 50,  card_total: 500 }
    },
    LinkedIn: {
        // LinkedIn has no native engagement filter — all client-side off the card
        any:   { reactions: 0   },
        some:  { reactions: 20  },
        real:  { reactions: 100 },
        viral: { reactions: 500 }
    },
    Reddit: {
        // For POSTS tab: minimum upvotes on the post card.
        // For SUBREDDITS (the published "account" on Reddit): minimum median
        // (ups + num_comments) on top posts of the past week — fetched via
        // /r/<sub>/top.json. Same preset, different interpretations.
        any:   { post_upvotes: 0,   sub_weekly_median: 0   },
        some:  { post_upvotes: 10,  sub_weekly_median: 25  },
        real:  { post_upvotes: 50,  sub_weekly_median: 100 },
        viral: { post_upvotes: 250, sub_weekly_median: 500 }
    }
};

function engagementThresholds(platform, floor) {
    const lvl = floor || 'any';
    return (ENGAGEMENT_THRESHOLDS[platform] || {})[lvl] || ENGAGEMENT_THRESHOLDS[platform]?.any || {};
}

// ============================================================
// GLOBAL STATE
// ============================================================
const DISC_TAG = '[Discovery Engine]';
let activeMission = null;
let activeWindowId = null;
let missionAborted = false;
let missionPaused = false;
let stealthCooldownUntil = 0;
// Atomic single-instance lock. Set synchronously at the top of
// startDiscoveryMission and released in finally. Without this, two
// near-simultaneous DISCOVERY_START messages (React StrictMode double-dispatch,
// duplicate dashboard tabs, retry on bridge timeout) each open their own
// stealth window — the exact "2 windows" symptom.
let _missionLock = false;

// ─── BATCHED VERIFICATION (anti-bot-aware) ───────────────────────────
// One mission can run across multiple "batches". Each batch visits up to
// `batchCap` profiles, then triggers a cooldown via chrome.alarms. When the
// alarm fires, the engine reopens a stealth window and continues draining
// the persisted candidate queue. Stops when target matches reached, queue
// exhausted, or maxDeepeningRounds hit.
const BATCH_RESUME_ALARM = 'discovery_batch_resume';
let _sessionVisits = 0;  // visits in THIS execution; resets each run/resume

// Throwing this exits the mission cleanly without marking it 'completed'.
class BatchCapReached extends Error {
    constructor() { super('Batch cap reached — paused for cooldown'); this.name = 'BatchCapReached'; }
}

async function scheduleBatchResume() {
    if (!activeMission) return;
    const cooldownMs = activeMission.cooldownMs || (40 * 60 * 1000);
    const resumeAt = Date.now() + cooldownMs;
    activeMission.cooldownUntil = resumeAt;
    activeMission.status = 'cooldown';
    await persistMission();
    try {
        await chrome.alarms.create(BATCH_RESUME_ALARM, { when: resumeAt });
        const min = Math.round(cooldownMs / 60000);
        logMission('stealth', `🛌 Batch cap hit. Cooling for ${min}min — engine will auto-resume at ${new Date(resumeAt).toLocaleTimeString()}.`);
    } catch (e) {
        logMission('error', `Failed to schedule resume alarm: ${e.message}`);
    }
}

// Service-worker keepalive — MV3 kills idle SWs after ~30s. Long sleeps in a
// mission would otherwise terminate the engine mid-flight with no error.
let _keepAliveTimer = null;
function startKeepAlive() {
    if (_keepAliveTimer) return;
    _keepAliveTimer = setInterval(() => {
        chrome.storage.local.set({ _disc_ka: Date.now() }).catch(() => {});
    }, 20000);
}
function stopKeepAlive() {
    if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
    chrome.storage.local.remove(['_disc_ka']).catch(() => {});
}

// Watchdog — if no progress for 4 minutes, force-abort. Catches deadlocks
// in tab navigation, content-script messages, or sleeps that never resolve.
let _watchdogTimer = null;
let _lastProgressAt = 0;
function pingProgress() { _lastProgressAt = Date.now(); }
function startWatchdog() {
    _lastProgressAt = Date.now();
    _watchdogTimer = setInterval(() => {
        if (!activeMission || missionAborted) return;
        if (missionPaused) { _lastProgressAt = Date.now(); return; }
        const stalledMs = Date.now() - _lastProgressAt;
        if (stalledMs > 4 * 60 * 1000) {
            console.error(DISC_TAG, 'Watchdog: stalled', stalledMs, 'ms — aborting');
            missionAborted = true;
            if (activeMission) {
                activeMission.logs.push({
                    timestamp: nowIso(), level: 'error',
                    message: `Watchdog timeout — no progress for ${Math.round(stalledMs/1000)}s. Forcing abort.`
                });
            }
        }
    }, 30000);
}
function stopWatchdog() {
    if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
}


// ============================================================
// CORE UTILITIES
// ============================================================
function gauss(mean, std) {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.max(0, (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) * std + mean);
}

const dsleep = ms => new Promise(r => setTimeout(r, ms));

async function interruptibleSleep(ms) {
    const stepSize = 250;
    const steps = Math.ceil(ms / stepSize);
    for (let i = 0; i < steps; i++) {
        if (missionAborted) throw new Error('Mission aborted');
        while (missionPaused && !missionAborted) await dsleep(500);
        await dsleep(stepSize);
    }
}

function nowIso() { return new Date().toISOString(); }

// ============================================================
// MISSION STATE PERSISTENCE
// ============================================================
async function persistMission() {
    if (!activeMission) {
        await chrome.storage.local.remove(['discovery_mission_state']);
        return;
    }
    await chrome.storage.local.set({ discovery_mission_state: activeMission });
}

function logMission(level, message, platform) {
    if (!activeMission) return;
    activeMission.logs.push({
        timestamp: nowIso(),
        level,
        message,
        platform
    });
    // Keep last 200 logs
    if (activeMission.logs.length > 200) {
        activeMission.logs = activeMission.logs.slice(-200);
    }
    console.log(DISC_TAG, `[${level}]`, platform || '', message);
    pingProgress();
}

async function updateMission(patch) {
    if (!activeMission) return;
    Object.assign(activeMission, patch);
    await persistMission();
}

async function patchProgress(patch) {
    if (!activeMission) return;
    Object.assign(activeMission.progress, patch);
    await persistMission();
}

async function patchStealth(patch) {
    if (!activeMission) return;
    Object.assign(activeMission.stealth, patch);
    await persistMission();
}

// ============================================================
// RATE LIMITING & STEALTH GUARDS
// ============================================================
function getActionsThisMinute() {
    if (!activeMission) return 0;
    const now = Date.now();
    activeMission.stealth._actionTimes = (activeMission.stealth._actionTimes || []).filter(t => now - t < 60000);
    return activeMission.stealth._actionTimes.length;
}

async function recordAction() {
    if (!activeMission) return;
    activeMission.stealth._actionTimes = activeMission.stealth._actionTimes || [];
    activeMission.stealth._actionTimes.push(Date.now());
    activeMission.stealth.actionsThisMinute = getActionsThisMinute();
    activeMission.stealth.actionsThisSession = (activeMission.stealth.actionsThisSession || 0) + 1;
    await persistMission();
}

async function enforceRateLimit() {
    if (!activeMission) return;
    const limit = activeMission.stealth.rateLimit || 20;
    let count = getActionsThisMinute();
    while (count >= limit) {
        const waitMs = gauss(15000, 4000);
        logMission('stealth', `Rate cap reached (${count}/${limit}/min) — cooling ${Math.round(waitMs/1000)}s`);
        activeMission.stealth.cooldownUntil = Date.now() + waitMs;
        await persistMission();
        await interruptibleSleep(waitMs);
        count = getActionsThisMinute();
    }
    activeMission.stealth.cooldownUntil = undefined;
    await persistMission();
}

function checkTimeOfDay() {
    const h = new Date().getHours();
    if (h < 8 || h >= 23) {
        return { ok: false, reason: `Off-hours (${h}h local) — humans sleep` };
    }
    return { ok: true };
}

async function checkSessionDuration() {
    if (!activeMission) return { ok: true };
    const max = 30 * 60 * 1000;
    const elapsed = Date.now() - activeMission.stealth.sessionStartedAt;
    if (elapsed > max) {
        return { ok: false, reason: `Session > 30min — would look like bot` };
    }
    return { ok: true };
}

// ============================================================
// WINDOW MANAGEMENT
// ============================================================
async function openStealthWindow(url, opts = {}) {
    const win = await chrome.windows.create({
        url,
        type: 'popup',
        state: 'normal',
        // focused defaults to false (true stealth), but the Feed Watcher sweep
        // overrides it to true. See the long note in _runFeedWatchSweepInner:
        // X/LinkedIn FREEZE feed loading when their tab is hidden/occluded
        // (a non-focused popup that opens behind the main window IS occluded →
        // visibilityState 'hidden'). Proven live: a hidden tab loads only ~4-5
        // posts and refuses to fetch more no matter how far you scroll, and a
        // JS visibilityState spoof does NOT defeat it (the freeze is enforced
        // at the compositor level). The window must be genuinely visible.
        focused: opts.focused === true,
        width: 1100 + Math.floor(Math.random() * 200),
        height: 700 + Math.floor(Math.random() * 100),
        left: 50 + Math.floor(Math.random() * 200),
        top: 50 + Math.floor(Math.random() * 200)
    });
    activeWindowId = win.id;
    return win;
}

async function getTabFromWindow(win) {
    if (win.tabs?.length) return win.tabs[0].id;
    const tabs = await chrome.tabs.query({ windowId: win.id });
    return tabs[0]?.id;
}

// The stealth window opens with focused:false, so its tab is `hidden`. X (and
// LinkedIn) PAUSE timeline/feed fetching while `document.visibilityState ===
// 'hidden'` — confirmed live: hidden ⇒ X renders only ~8 tweets and never
// fetches more no matter how far we scroll (the "only 5 posts" bug). Spoofing
// visibility back to 'visible' makes X resume loading (verified: scrollHeight
// grew 9950→13389 once spoofed).
//
// CRITICAL: this MUST run in the MAIN world. The sweep's sendToAgent/
// executeScript path runs in the ISOLATED world, where overriding
// document.visibilityState does NOT affect what the page's own scripts read.
// So we inject the spoof directly with world:'MAIN'. It re-installs per
// navigation (each navigateTab loads a fresh document).
async function injectVisibilitySpoof(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                if (window.__answerly_vis_spoof__) {
                    try { document.dispatchEvent(new Event('visibilitychange')); } catch (_) {}
                    return;
                }
                window.__answerly_vis_spoof__ = true;
                try {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
                    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
                    Object.defineProperty(document, 'webkitVisibilityState', { configurable: true, get: () => 'visible' });
                    Object.defineProperty(document, 'webkitHidden', { configurable: true, get: () => false });
                } catch (_) {}
                try { document.hasFocus = () => true; } catch (_) {}
                // Swallow the page's own visibilitychange/blur handlers that pause
                // fetching, but keep firing a 'visible' visibilitychange so X
                // re-reads the (spoofed) visible state and resumes its timeline.
                try {
                    document.dispatchEvent(new Event('visibilitychange'));
                    window.dispatchEvent(new Event('focus'));
                } catch (_) {}
            }
        });
    } catch (e) {
        console.warn('[FEED] visibility spoof inject failed:', e?.message || e);
    }
}

async function navigateTab(tabId, url, opts = {}) {
    await chrome.tabs.update(tabId, { url });
    // opts.lenient → resolve as soon as the document is INTERACTIVE rather than
    // requiring a full 'load complete'. LinkedIn's feed streams content
    // indefinitely, so the tab can stay 'loading' and 'complete' may never fire
    // — the old strict wait then threw 'Tab load timeout' after 30s and the Feed
    // Watcher ABANDONED the platform (continue) before the API harvest could run.
    // That is the real "LinkedIn opens a window then adds 0 posts" bug: the
    // harvest only needs the document + the user's cookies, which exist at
    // 'interactive'. The discovery-mission caller passes no opts → unchanged.
    await waitForTabComplete(tabId, opts.timeoutMs || 30000, { acceptInteractive: !!opts.lenient });
    // Safety net: ensure discovery_agent is present even if the manifest content_script
    // match raced the page load. Idempotent — the agent guards itself with
    // window.__answerly_discovery_agent_loaded__.
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['discovery_agent.js']
        });
        // Deep diagnostic — return everything we'd need to debug why the agent's
        // listener might not be answering. If the flag is set but messages still
        // time out, it means the IIFE crashed AFTER setting the flag but BEFORE
        // registering the message listener. The lastError + bodyText narrow it down.
        const [probe] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({
                loaded: !!window.__answerly_discovery_agent_loaded__,
                ready: !!window.__answerly_discovery_agent_ready__,
                platform: window.__answerly_discovery_agent_platform__ || null,
                hasChromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime,
                runtimeId: (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.id : null,
                url: location.href,
                title: (document.title || '').slice(0, 100),
                bodyText: (document.body?.innerText || '').slice(0, 220).replace(/\s+/g, ' '),
                readyState: document.readyState
            })
        });
        const r = probe?.result || {};
        logMission?.('info', `🔍 Tab: loaded=${r.loaded} ready=${r.ready} platform=${r.platform} runtime=${r.hasChromeRuntime} title="${r.title}"`);
        if (r.loaded && !r.ready) {
            logMission?.('error', `discovery_agent CRASHED mid-init on ${url}. Listener never bound. Open the stealth window's devtools (right-click → Inspect) to see the JS error. Body sample: "${r.bodyText}"`);
        } else if (!r.loaded) {
            logMission?.('error', `discovery_agent did NOT load on ${url}. Page state: "${r.bodyText}". Likely a login wall — open ${url} in a normal tab, log in, then retry.`);
        }
    } catch (e) {
        logMission?.('error', `Agent injection failed on ${url}: ${e.message}`);
    }
}

function waitForTabComplete(tabId, timeoutMs = 30000, opts = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let poll = null;
        const cleanup = () => {
            chrome.tabs.onUpdated.removeListener(updateHandler);
            chrome.tabs.onRemoved.removeListener(removeHandler);
            clearTimeout(timer);
            if (poll) clearInterval(poll);
        };
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true; cleanup();
            reject(new Error('Tab load timeout'));
        }, timeoutMs);
        const updateHandler = (id, info) => {
            if (settled || id !== tabId) return;
            if (info.status === 'complete') {
                settled = true; cleanup();
                resolve();
            }
        };
        const removeHandler = (id) => {
            if (settled || id !== tabId) return;
            settled = true; cleanup();
            reject(new Error('Tab closed during navigation'));
        };
        chrome.tabs.onUpdated.addListener(updateHandler);
        chrome.tabs.onRemoved.addListener(removeHandler);
        // acceptInteractive: some feeds (LinkedIn most notably) stream content
        // forever, so the tab status can stay 'loading' and 'complete' may NEVER
        // fire — the bare listener above then hits the timeout and rejects, which
        // made the Feed Watcher skip LinkedIn entirely. Poll document.readyState
        // and resolve the moment it is 'interactive'/'complete' — all the
        // cookie-based API replay (and DOM scraping) actually needs.
        if (opts.acceptInteractive) {
            poll = setInterval(async () => {
                if (settled) return;
                try {
                    const [p] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.readyState });
                    const rs = p && p.result;
                    if (!settled && (rs === 'complete' || rs === 'interactive')) {
                        settled = true; cleanup();
                        resolve();
                    }
                } catch (_) { /* tab momentarily not scriptable mid-navigation — retry next tick */ }
            }, 1200);
        }
    });
}

async function closeStealthWindow() {
    if (activeWindowId) {
        try { await chrome.windows.remove(activeWindowId); } catch (e) { /* already closed */ }
        activeWindowId = null;
    }
}

// ============================================================
// SYNC AGENT — runs in the stealth tab via chrome.scripting.executeScript.
// Self-contained: no awaits, no Promises, no external dependencies. Reads the
// DOM once and returns. The engine waits for hydration before calling, so by
// the time this runs, the DOM has what we need.
// ============================================================
function SYNC_AGENT_FN(msg) {
    try {
        const host = (location.hostname || '').replace(/^www\./, '');
        const platform = (host.includes('x.com') || host.includes('twitter.com')) ? 'X'
            : host.includes('linkedin.com') ? 'LinkedIn'
            : host.includes('reddit.com') ? 'Reddit'
            : null;

        // ──── helpers ───────────────────────────────────────────
        function parseCount(str) {
            if (!str) return 0;
            const s = String(str).replace(/[^\d.kKmMbB]/g, '');
            const n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (/[kK]/.test(s)) return Math.round(n * 1000);
            if (/[mM]/.test(s)) return Math.round(n * 1e6);
            if (/[bB]/.test(s)) return Math.round(n * 1e9);
            return Math.round(n);
        }
        const X_RESERVED = new Set(['home','explore','notifications','messages','search','i','login','signup','tos','privacy','about','settings','compose','intent','jobs','communities','bookmarks','lists','topics','hashtag','followers','following','status','verified_followers','media','likes','with_replies','photo','header_photo']);
        function xHandle(href) {
            if (!href) return null;
            const path = href.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com/, '');
            const segs = path.split('/').filter(Boolean);
            if (!segs.length) return null;
            const h = segs[0].split('?')[0].split('#')[0];
            if (X_RESERVED.has(h.toLowerCase())) return null;
            if (!/^[a-zA-Z0-9_]{1,15}$/.test(h)) return null;
            return h;
        }

        // ──── DETECT BLOCK ──────────────────────────────────────
        // STRUCTURAL signals ONLY. Text-based phrase matching produces false
        // positives on every platform that surfaces arbitrary user-generated
        // content — Reddit posts and comments routinely contain literal
        // strings like "captcha", "are you a robot", "verify you are human",
        // "too many requests", etc. A single false positive trips the engine
        // into a 15-min cross-platform cooldown, so the trade-off favors
        // missing a CAPTCHA (the scrape will then just return 0 candidates
        // and surface a body-text sample to the user) over flagging one
        // that isn't there.
        function detectBlock() {
            // Real CAPTCHA: a VISIBLE, RENDERED challenge iframe (reCAPTCHA /
            // hCaptcha). CRITICAL: X embeds Google's INVISIBLE reCAPTCHA scoring
            // frame (recaptcha/api2/aframe — 0×0, display:none) on the logged-in
            // home feed AT ALL TIMES for background bot-scoring. That is NOT a
            // challenge. The old `querySelector('iframe[src*="recaptcha"]')`
            // matched that invisible frame and falsely flagged EVERY X sweep as
            // captcha-blocked → X scraped nothing ("nothing works for X").
            // Only flag when the iframe is actually shown to the user: the real
            // challenge is the api2/bframe modal, sized > 100px and visible.
            const captchaIframe = Array.from(document.querySelectorAll(
                'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]'
            )).find(f => {
                const src = f.getAttribute('src') || '';
                if (/recaptcha\/api2\/aframe/i.test(src)) return false; // invisible scoring frame — never a block
                let r, cs;
                try { r = f.getBoundingClientRect(); cs = getComputedStyle(f); } catch { return false; }
                return r.width > 100 && r.height > 100
                    && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
            });
            if (captchaIframe) {
                return { blocked: true, type: 'captcha', indicator: 'captcha-iframe' };
            }
            // Cloudflare interstitial — full-page challenge with a recognizable wrapper
            if (document.querySelector('#cf-wrapper, .cf-challenge-running, #challenge-form, .cf-im-under-attack')) {
                return { blocked: true, type: 'captcha', indicator: 'cloudflare' };
            }
            if (/^just a moment/i.test(document.title || '')) {
                return { blocked: true, type: 'captcha', indicator: 'cloudflare-title' };
            }
            // X forced-login modal (only when not already on a login route)
            if (document.querySelector('[data-testid="LoginForm_Login_Button"]') &&
                !(/\/login|\/i\/flow\/login/.test(location.pathname))) {
                return { blocked: true, type: 'login', indicator: 'x-login-wall' };
            }
            return { blocked: false };
        }

        // Read like/RT/reply counters off an X tweet card. X renders each
        // counter inside a button[data-testid="like|retweet|reply"]; the
        // displayed count text sits in a span inside the button. When the
        // count is 0 the span is often empty — treat that as 0, not "missing".
        function readXTweetCounts(cell) {
            const readBtn = (testId) => {
                const btn = cell.querySelector(`[data-testid="${testId}"], [data-testid="un${testId}"]`);
                if (!btn) return 0;
                const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
                if (!txt) return 0;
                const m = txt.match(/([\d.,]+\s*[kKmMbB]?)/);
                return m ? parseCount(m[1]) : 0;
            };
            const likes    = readBtn('like');
            const retweets = readBtn('retweet');
            const replies  = readBtn('reply');
            return { likes, retweets, replies, total: likes + retweets + replies };
        }

        // ──── SCRAPE X SEARCH/POSTS ─────────────────────────────
        function scrapeXSearch(max) {
            const seen = new Set();
            const out = [];
            const cells = document.querySelectorAll('[data-testid="UserCell"], [data-testid="cellInnerDiv"]');
            for (const cell of cells) {
                if (out.length >= max) break;
                try {
                    const links = cell.querySelectorAll('a[href^="/"]');
                    let handle = null;
                    for (const a of links) {
                        const h = xHandle(a.getAttribute('href'));
                        if (h) { handle = h; break; }
                    }
                    if (!handle || seen.has(handle)) continue;
                    seen.add(handle);
                    const nameEl = cell.querySelector('[data-testid="User-Name"] span, [dir="ltr"] span');
                    const bioEl = cell.querySelector('[data-testid="UserDescription"]');
                    const postEl = cell.querySelector('[data-testid="tweetText"]');
                    const verified = !!cell.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified" i]');
                    // Tweet cells expose engagement counters; UserCell cells don't.
                    const isTweet = !!postEl;
                    const cardEngagement = isTweet ? readXTweetCounts(cell) : undefined;
                    out.push({
                        handle,
                        url: `https://x.com/${handle}`,
                        displayName: (nameEl?.innerText || '').trim().slice(0, 80) || handle,
                        bio: (bioEl?.innerText || '').trim().slice(0, 280),
                        samplePost: (postEl?.innerText || '').trim().slice(0, 280),
                        verified,
                        platform: 'X',
                        discoveredVia: isTweet ? 'post' : 'search',
                        cardEngagement
                    });
                } catch {}
            }
            // Fallback path — any profile link in primary column
            if (out.length === 0) {
                const links = document.querySelectorAll('[data-testid="primaryColumn"] a[href^="/"], [role="region"] a[href^="/"]');
                for (const a of links) {
                    if (out.length >= max) break;
                    const h = xHandle(a.getAttribute('href'));
                    if (!h || seen.has(h)) continue;
                    seen.add(h);
                    out.push({ handle: h, url: `https://x.com/${h}`, displayName: (a.innerText || '').trim().slice(0, 80) || h, bio: '', verified: false, platform: 'X', discoveredVia: 'fallback' });
                }
            }
            return {
                candidates: out,
                diagnostic: out.length === 0 ? {
                    url: location.href,
                    userCellCount: document.querySelectorAll('[data-testid="UserCell"]').length,
                    primaryColumn: !!document.querySelector('[data-testid="primaryColumn"]'),
                    pageTitle: document.title,
                    bodyTextSample: (document.body?.innerText || '').slice(0, 300)
                } : undefined
            };
        }

        // ──── SCRAPE X PROFILE ──────────────────────────────────
        function scrapeXProfile() {
            const handle = (location.pathname || '').split('/').filter(Boolean)[0] || '';
            const nameEl = document.querySelector('[data-testid="UserName"]');
            const bioEl = document.querySelector('[data-testid="UserDescription"]');
            const verified = !!document.querySelector('[data-testid="UserVerifiedBadge"], svg[aria-label*="erified" i]');

            let followers = 0;
            const followLinks = document.querySelectorAll('a[href$="/verified_followers"], a[href$="/followers"]');
            for (const a of followLinks) {
                const num = a.querySelector('span span');
                if (num) {
                    const c = parseCount(num.innerText);
                    if (c > 0) { followers = c; break; }
                }
            }
            if (followers === 0) {
                // last-resort: scan the entire user description block for "X Followers"
                const blocks = document.querySelectorAll('[data-testid="UserProfileHeader_Items"], main');
                for (const b of blocks) {
                    const m = (b.innerText || '').match(/([\d.,]+\s*[kKmMbB]?)\s*Followers/);
                    if (m) { followers = parseCount(m[1]); if (followers > 0) break; }
                }
            }

            // ─── ENGAGEMENT RATE — read what's currently in the DOM ─────────
            // X renders each tweet card with like/retweet/reply counters. We sum
            // them across visible tweets, average, and normalize by followers.
            // Pure sync DOM read — no waits, fast enough to stay in our budget.
            const tweets = document.querySelectorAll('article[data-testid="tweet"], [data-testid="tweet"]');
            let posts = 0, totalLikes = 0, totalRTs = 0, totalReplies = 0;
            const sampleHooks = [];
            let samplePost = '';
            const readCount = (parent, testId) => {
                if (!parent) return 0;
                // Common patterns on X: count lives in a span inside an aria-described group
                const btn = parent.querySelector(`[data-testid="${testId}"]`);
                if (!btn) return 0;
                // The displayed count text is inside the button; "0" often renders as empty
                const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
                if (!txt) return 0;
                const m = txt.match(/([\d.,]+\s*[kKmMbB]?)/);
                return m ? parseCount(m[1]) : 0;
            };
            for (const tw of tweets) {
                if (posts >= 10) break;          // 10 most-recent tweets is enough signal
                posts++;
                totalLikes += readCount(tw, 'like') + readCount(tw, 'unlike');
                totalRTs += readCount(tw, 'retweet') + readCount(tw, 'unretweet');
                totalReplies += readCount(tw, 'reply');
                const txt = tw.querySelector('[data-testid="tweetText"]')?.innerText?.trim();
                if (txt) {
                    if (!samplePost) samplePost = txt.slice(0, 280);
                    if (sampleHooks.length < 5) sampleHooks.push(txt.slice(0, 120));
                }
            }
            // engagement_rate = avg (likes+RTs+replies) per post / followers * 100
            let engagementRate = 0;
            if (posts > 0 && followers > 0) {
                const avgEngagement = (totalLikes + totalRTs + totalReplies) / posts;
                engagementRate = +((avgEngagement / followers) * 100).toFixed(2);
                // Sanity cap — avoid runaway values from parsing glitches
                if (engagementRate > 100) engagementRate = 100;
            }
            // Last-active proxy: most recent tweet's time tag if present
            let lastActive = null;
            const firstTime = tweets[0]?.querySelector('time')?.getAttribute('datetime');
            if (firstTime) lastActive = firstTime;

            return {
                profile: {
                    handle,
                    displayName: ((nameEl?.innerText || '').split('\n')[0] || handle).trim().slice(0, 80),
                    bio: (bioEl?.innerText || '').trim().slice(0, 500),
                    followers,
                    verified,
                    engagementRate,
                    postsAnalyzed: posts,
                    samplePost,
                    sampleHooks,
                    lastActive,
                    platform: 'X'
                }
            };
        }

        // ──── SCRAPE LINKEDIN ────────────────────────────────────
        // Walk each result card (li.reusable-search__result-container or the
        // newer search-result__occluded-item), extract handle from /in/ link,
        // and try to read the visible headline + follower hint sitting under
        // the name. LinkedIn changes these classes regularly, so we fall
        // back to text-content heuristics when selectors miss.
        // ── CONTENT-PAGE AUTHOR ATTRIBUTION ──
        // On a content search / feed page each result is a POST, not a person.
        // We extract the post AUTHOR (the actor in the card header), read the
        // card's real reaction + comment counts, and attribute that engagement
        // to the author. This is how we find "people with high engagement on
        // their posts" WITHOUT ever visiting a profile (no "viewed your profile"
        // footprint). Commenters / sidebar chips are ignored here on purpose.
        function scrapeLinkedInContent(max) {
            const seen = new Set();
            const out = [];

            const readCount = (el) => {
                if (!el) return 0;
                const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
                const m = t.match(/([\d.,]+\s*[KMB]?)/i);
                return m ? parseCount(m[1]) : 0;
            };

            // Union of known post-card wrappers (old + new feed markup).
            const cardSelectors = [
                'div.feed-shared-update-v2',
                'div.update-components-actor', // some search results nest only the actor
                '[data-urn^="urn:li:activity"]',
                '[data-chameleon-result-urn^="urn:li:activity"]',
                'li.reusable-search__result-container',
                'div.search-results__cluster-content > div',
                'div.scaffold-finite-scroll__content > div',
            ];
            const cardSet = new Set();
            for (const sel of cardSelectors) {
                document.querySelectorAll(sel).forEach(el => cardSet.add(el));
            }
            const cards = Array.from(cardSet);

            let cardsWithEngagement = 0;
            for (const card of cards) {
                if (out.length >= max) break;
                // Author link lives in the actor header. Restrict to that block so
                // we don't pick up a commenter or "promoted by" link from the body.
                const actor = card.querySelector(
                    '.update-components-actor__container, .update-components-actor, ' +
                    '.feed-shared-actor, .update-components-actor__meta'
                ) || card;
                const link = actor.querySelector('a[href*="/in/"]');
                if (!link) continue; // company-authored or no resolvable person → skip
                const m = (link.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                if (!m) continue;
                const handle = m[1];

                // Engagement counts on THIS post card.
                const reactions = readCount(card.querySelector(
                    '.social-details-social-counts__reactions-count, ' +
                    '[data-test-id="social-counts-reactions"], ' +
                    '.social-details-social-counts__count-value, ' +
                    'span[aria-label*="reaction" i]'
                ));
                let comments = 0;
                const cEls = card.querySelectorAll(
                    '.social-details-social-counts__comments, ' +
                    '.social-details-social-counts li, [aria-label*="comment" i]'
                );
                for (const el of cEls) {
                    const tx = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
                    if (tx.includes('comment')) { comments = readCount(el); break; }
                }
                const total = reactions + comments;
                if (total > 0) cardsWithEngagement++;

                // Author display name + headline.
                const nameEl = actor.querySelector(
                    '.update-components-actor__title span[aria-hidden="true"], ' +
                    '.update-components-actor__name, .feed-shared-actor__name, ' +
                    'span.update-components-actor__title'
                );
                const displayName = (nameEl?.innerText || link.innerText || '')
                    .trim().split('\n').find(s => s.trim()) || handle;
                const descEl = actor.querySelector(
                    '.update-components-actor__description, .feed-shared-actor__description'
                );
                const headline = (descEl?.innerText || '').trim().slice(0, 200);
                const verified = !!actor.querySelector('[aria-label*="verified" i], [data-test-icon="verified-small"]');

                // Post permalink (for deep-mode commenter expansion).
                let postUrl = '';
                const urn = card.getAttribute('data-urn')
                    || card.getAttribute('data-chameleon-result-urn')
                    || (card.querySelector('[data-urn^="urn:li:activity"]')?.getAttribute('data-urn'));
                if (urn) postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
                if (!postUrl) {
                    const permalink = card.querySelector('a[href*="/feed/update/"]');
                    if (permalink) postUrl = permalink.href.split('?')[0];
                }

                // Emit ONE row per post (not per author) — aggregation happens
                // engine-side so a single author's multiple posts combine into a
                // median/consistency signal.
                out.push({
                    handle,
                    url: `https://www.linkedin.com/in/${handle}`,
                    displayName: displayName.slice(0, 80),
                    bio: headline,
                    verified,
                    platform: 'LinkedIn',
                    discoveredVia: 'post',
                    cardEngagement: total > 0 ? { reactions, comments, total } : undefined,
                    postUrl: postUrl || undefined
                });
                if (!seen.has(handle)) seen.add(handle);
            }

            return {
                candidates: out,
                diagnostic: {
                    mode: 'content-author-attribution',
                    cardsFound: cards.length,
                    postsWithEngagement: cardsWithEngagement,
                    uniqueAuthors: seen.size,
                    captured: out.length
                }
            };
        }

        function scrapeLinkedInSearch(max) {
            // Content / feed / hashtag pages → author-attribution path.
            if (/\/search\/results\/content\//.test(location.pathname) ||
                /\/feed\/(hashtag|update)\//.test(location.pathname)) {
                const res = scrapeLinkedInContent(max);
                // If the author path found nothing (DOM drift), fall through to the
                // generic /in/-link extraction below as a safety net.
                if (res.candidates.length > 0) return res;
            }
            const seen = new Set();
            const out = [];

            // Parse "1,234 followers" or "3.4K followers" out of arbitrary text
            const parseFollowerHint = (text) => {
                if (!text) return null;
                const m = text.match(/([\d,.]+)\s*([KMB]?)\s*followers?/i);
                if (!m) return null;
                let n = parseFloat(m[1].replace(/,/g, ''));
                if (!isFinite(n)) return null;
                const unit = (m[2] || '').toUpperCase();
                if (unit === 'K') n *= 1e3;
                else if (unit === 'M') n *= 1e6;
                else if (unit === 'B') n *= 1e9;
                return Math.round(n);
            };

            // ── ADDITIVE TWO-PASS EXTRACTION ──
            // Pass 1: structured cards (rich metadata — bio, followerHint, verified).
            // Pass 2: every remaining /in/ link on the page (catches cards whose
            // wrapper class we don't match yet). Dedup by handle so we never
            // double-count. Each handle dropped along the way is tracked in
            // `dropReasons` so the user can see exactly why a count is low.
            const dropReasons = {
                noLink: 0,           // card had no /in/ link visible
                duplicate: 0,        // handle already captured
                bareLinkAdded: 0,    // captured only via pass 2 (no rich card)
                maxedOut: 0,         // hit the maxCandidates ceiling
            };

            // Expanded selector list — covers old reusable-search markup AND
            // the newer search-results__cluster-content / data-test patterns.
            const cardSelectors = [
                'li.reusable-search__result-container',
                'div.reusable-search__result-container',
                '.search-results-container li',
                'li.search-result__wrapper',
                'div.search-result__wrapper',
                '[data-chameleon-result-urn]',
                '[data-test-search-result]',
                'div.entity-result',
                'li.entity-result',
                'div.search-results__cluster-item',
                'div.search-results__list > div',
                'ul.search-results__list > li',
            ];
            // Union of all matches (newer DOM nests differently than older).
            const cardSet = new Set();
            for (const sel of cardSelectors) {
                document.querySelectorAll(sel).forEach(el => cardSet.add(el));
            }
            const cards = Array.from(cardSet);

            for (const card of cards) {
                if (out.length >= max) { dropReasons.maxedOut++; continue; }
                const link = card.querySelector('a[href*="/in/"]');
                if (!link) { dropReasons.noLink++; continue; }
                const m = (link.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                if (!m) { dropReasons.noLink++; continue; }
                if (seen.has(m[1])) { dropReasons.duplicate++; continue; }
                seen.add(m[1]);

                const cardText = (card.innerText || '').trim();
                const displayName = (link.innerText || '').trim().split('\n').find(s => s.trim())
                    || cardText.split('\n').find(s => s.trim())
                    || m[1];

                const bioLines = cardText.split('\n').map(s => s.trim()).filter(Boolean);
                const bioCandidate = bioLines
                    .filter(l => l !== displayName.trim() && !/^view\s+.+'s profile/i.test(l) && !/^\d+(st|nd|rd|th)\b/i.test(l))
                    .slice(0, 3)
                    .join(' · ')
                    .slice(0, 300);

                const followerHint = parseFollowerHint(cardText);
                const verified = !!card.querySelector('[aria-label*="verified" i], [data-test-icon="verified-small"]');

                // Reaction count visible on the card (only present on
                // content/feed/hashtag-feed cards, not on people-search cards).
                let reactions = 0;
                let comments = 0;
                const rEl = card.querySelector(
                    '.social-details-social-counts__reactions-count, ' +
                    '[data-test-id="social-counts-reactions"], ' +
                    '.social-details-social-counts__count-value, ' +
                    'span[aria-label*="reaction" i]'
                );
                if (rEl) {
                    const m2 = (rEl.innerText || rEl.getAttribute('aria-label') || '').match(/([\d.,]+\s*[KMB]?)/i);
                    if (m2) reactions = parseCount(m2[1]);
                }
                const cEls = card.querySelectorAll('.social-details-social-counts li, [aria-label*="comment" i]');
                for (const el of cEls) {
                    const t = (el.innerText || '').toLowerCase();
                    if (t.includes('comment')) {
                        const m3 = t.match(/([\d.,]+\s*[KMB]?)/i);
                        if (m3) comments = parseCount(m3[1]);
                        break;
                    }
                }
                const cardEngagement = (reactions || comments)
                    ? { reactions, comments, total: reactions + comments }
                    : undefined;

                out.push({
                    handle: m[1],
                    url: `https://www.linkedin.com/in/${m[1]}`,
                    displayName: displayName.slice(0, 80),
                    bio: bioCandidate,
                    followerHint: followerHint || undefined,
                    verified,
                    platform: 'LinkedIn',
                    discoveredVia: cardEngagement ? 'post' : 'search',
                    cardEngagement
                });
            }

            // ── Pass 2 — raw /in/ links not already captured by a card ──
            // LinkedIn often renders profile chips in sidebar suggestions, "people
            // you may know" tiles, or in newer card wrappers we don't know yet.
            // Catch them here. Without this pass, "Accounts I see in LinkedIn
            // search are missing entirely" is the typical symptom.
            const allInLinks = document.querySelectorAll('a[href*="/in/"]');
            for (const a of allInLinks) {
                if (out.length >= max) { dropReasons.maxedOut++; break; }
                const m = (a.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                if (!m) continue;
                if (seen.has(m[1])) { dropReasons.duplicate++; continue; }
                seen.add(m[1]);
                // Best-effort display name from the link text or a nearby element
                let displayName = (a.innerText || '').trim().split('\n').find(s => s.trim()) || '';
                if (!displayName || displayName.length < 2) {
                    // Walk up to a parent that might have richer text
                    const parent = a.closest('div, li, article, section');
                    if (parent) {
                        const txt = (parent.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
                        displayName = txt.find(t => t.length > 2 && !/^view\s+/i.test(t)) || m[1];
                    } else {
                        displayName = m[1];
                    }
                }
                out.push({
                    handle: m[1],
                    url: `https://www.linkedin.com/in/${m[1]}`,
                    displayName: displayName.slice(0, 80),
                    bio: '',
                    verified: false,
                    platform: 'LinkedIn',
                    discoveredVia: 'search'
                });
                dropReasons.bareLinkAdded++;
            }

            // Diagnostic so the user can read WHY count is what it is.
            return {
                candidates: out,
                diagnostic: {
                    cardsFound: cards.length,
                    rawLinksFound: allInLinks.length,
                    captured: out.length,
                    dropReasons,
                }
            };
        }

        // ── SCRAPE COMMENTERS ON A LINKEDIN POST ──
        // Used by deep-mode commenter expansion. Reads the /in/ handles of people
        // who commented on the open post. Frequent commenters across multiple
        // high-engagement posts are themselves likely active creators — surfacing
        // them widens the net WITHOUT visiting anyone's profile.
        function scrapeLinkedInCommenters(max) {
            const seen = new Set();
            const out = [];
            const containers = document.querySelectorAll(
                '.comments-comment-item, article.comments-comment-entity, ' +
                '.comments-comments-list > *, .comments-comment-list__container > *'
            );
            const scope = containers.length ? Array.from(containers) : [document];
            for (const c of scope) {
                if (out.length >= max) break;
                const link = c.querySelector(
                    '.comments-post-meta__name-text a[href*="/in/"], ' +
                    '.comments-comment-item__post-meta a[href*="/in/"], ' +
                    'a.comments-post-meta__actor-link[href*="/in/"], ' +
                    'a[href*="/in/"]'
                );
                if (!link) continue;
                const m = (link.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                if (!m || seen.has(m[1])) continue;
                seen.add(m[1]);
                const nm = (link.innerText || '').trim().split('\n').find(s => s.trim()) || m[1];
                out.push({
                    handle: m[1],
                    url: `https://www.linkedin.com/in/${m[1]}`,
                    displayName: nm.slice(0, 80),
                    bio: '',
                    verified: false,
                    platform: 'LinkedIn',
                    discoveredVia: 'commenter'
                });
            }
            return { candidates: out, diagnostic: { commentersFound: out.length } };
        }

        // Read posts off the LinkedIn profile activity strip.
        // We need: post timestamps (to compute recency + which posts are "mature"),
        // and per-post reaction+comment counts (to compute mature-post median engagement).
        // LinkedIn renders timestamps as "2d", "1w", "3mo" — we parse those into days.
        function scrapeLinkedInProfile() {
            const nameEl = document.querySelector('h1');
            const bioEl = document.querySelector('.text-body-medium, [data-section="summary"]');
            const handle = (location.pathname.match(/\/in\/([^/?#]+)/) || [])[1] || '';

            // Verified badge (Premium / official-account)
            const verified = !!document.querySelector(
                '[aria-label*="verified" i], [data-test-icon="verified-small"], svg[data-test-icon="verified-small"]'
            );

            // Follower count — appears as "1,234 followers" near the top of the profile
            let followers = 0;
            const bodyText = document.body?.innerText || '';
            const followerMatch = bodyText.match(/([\d,.]+)\s*([KMB]?)\s*followers/i);
            if (followerMatch) {
                let n = parseFloat(followerMatch[1].replace(/,/g, ''));
                const unit = (followerMatch[2] || '').toUpperCase();
                if (unit === 'K') n *= 1e3;
                else if (unit === 'M') n *= 1e6;
                else if (unit === 'B') n *= 1e9;
                if (isFinite(n)) followers = Math.round(n);
            }

            // ── POST SIGNALS ──
            // Activity strip lives at .pv-recent-activity-section, or the standalone
            // /recent-activity/ feed embedded in the profile. We look for individual
            // update containers and pull (timestamp, reactions, comments) from each.
            const postSelectors = [
                'div.feed-shared-update-v2',
                'div.occludable-update',
                '.profile-creator-shared-feed-update__container',
                'article.feed-shared-update-v2'
            ];
            let postNodes = [];
            for (const sel of postSelectors) {
                postNodes = document.querySelectorAll(sel);
                if (postNodes.length > 0) break;
            }

            // Parse LinkedIn relative time → days. Returns null when unparseable.
            const parseRelTime = (txt) => {
                if (!txt) return null;
                // Common forms: "2d", "3 d", "1w", "2 weeks", "3mo", "1y", "now", "5h", "30m"
                const t = txt.trim().toLowerCase();
                if (/^(now|just now)/.test(t)) return 0;
                const m = t.match(/(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\b/);
                if (!m) return null;
                const n = parseInt(m[1], 10);
                const unit = m[2];
                if (/^s|sec|second/.test(unit)) return n / 86400;
                if (/^m$|^min|^minute/.test(unit)) return n / 1440;
                if (/^h|^hr|^hour/.test(unit)) return n / 24;
                if (/^d|^day/.test(unit)) return n;
                if (/^w|^wk|^week/.test(unit)) return n * 7;
                if (/^mo|^month/.test(unit)) return n * 30;
                if (/^y|^yr|^year/.test(unit)) return n * 365;
                return null;
            };

            // Parse "1,234", "3.4K", "12 reactions" → number
            const parseCount = (txt) => {
                if (!txt) return 0;
                const m = txt.match(/([\d,.]+)\s*([KMB]?)/i);
                if (!m) return 0;
                let n = parseFloat(m[1].replace(/,/g, ''));
                if (!isFinite(n)) return 0;
                const unit = (m[2] || '').toUpperCase();
                if (unit === 'K') n *= 1e3;
                else if (unit === 'M') n *= 1e6;
                else if (unit === 'B') n *= 1e9;
                return Math.round(n);
            };

            const posts = [];
            for (const node of postNodes) {
                if (posts.length >= 10) break;

                // Timestamp candidates: <time> tags, .feed-shared-actor__sub-description,
                // and any small grey text near the post header.
                const timeCandidates = [
                    node.querySelector('time')?.innerText,
                    node.querySelector('.feed-shared-actor__sub-description')?.innerText,
                    node.querySelector('.update-components-actor__sub-description')?.innerText,
                    node.querySelector('[class*="sub-description"]')?.innerText,
                ].filter(Boolean);
                let ageDays = null;
                for (const t of timeCandidates) {
                    ageDays = parseRelTime(t);
                    if (ageDays !== null) break;
                }

                // Reactions count — "social-details-social-counts__reactions-count"
                const reactionsTxt = node.querySelector(
                    '.social-details-social-counts__reactions-count, [data-test-id="social-counts-reactions"], .social-details-social-counts__count-value'
                )?.innerText;
                const reactions = parseCount(reactionsTxt);

                // Comments count — has the word "comment(s)"
                const allCountEls = node.querySelectorAll('.social-details-social-counts li, [aria-label*="comment" i]');
                let comments = 0;
                for (const el of allCountEls) {
                    const txt = (el.innerText || '').toLowerCase();
                    if (txt.includes('comment')) {
                        comments = parseCount(txt);
                        break;
                    }
                }

                if (ageDays !== null) {
                    posts.push({ ageDays, reactions, comments, engagement: reactions + comments });
                }
            }

            // Derived post metrics
            const RECENT_DAYS = 7;
            const MATURE_DAYS = 3;
            const recentPostCount = posts.filter(p => p.ageDays <= RECENT_DAYS).length;
            const maturePosts = posts.filter(p => p.ageDays >= MATURE_DAYS);
            let maturePostMedianEngagement = null;
            if (maturePosts.length > 0) {
                const sorted = maturePosts.map(p => p.engagement).sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                maturePostMedianEngagement = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
            }
            const daysSinceLastPost = posts.length > 0 ? Math.min(...posts.map(p => p.ageDays)) : null;
            const lastActive = daysSinceLastPost !== null
                ? new Date(Date.now() - daysSinceLastPost * 86400000).toISOString()
                : null;

            // Crude engagement rate: median mature engagement / followers * 100
            let engagementRate = 0;
            if (maturePostMedianEngagement !== null && followers > 0) {
                engagementRate = +((maturePostMedianEngagement / followers) * 100).toFixed(2);
                if (engagementRate > 100) engagementRate = 100;
            }

            return {
                profile: {
                    handle,
                    displayName: (nameEl?.innerText || '').trim().slice(0, 80),
                    bio: (bioEl?.innerText || '').trim().slice(0, 500),
                    followers,
                    verified,
                    engagementRate,
                    postsAnalyzed: posts.length,
                    recentPostCount,
                    maturePostMedianEngagement,
                    daysSinceLastPost,
                    lastActive,
                    platform: 'LinkedIn'
                }
            };
        }
        // Reddit search now extracts BOTH subreddits (/r/<name>) and users
        // (/u/<name>). On a community-search page the page is full of
        // subreddit links. We extract those and treat each subreddit as a
        // first-class account (most of our users want to engage with
        // communities, not individuals, on Reddit).
        //
        // Metrics enrichment: scraping subscriber count from the rendered
        // page is fragile (Reddit changes class names constantly). Instead
        // we fetch `/r/<sub>/about.json` from the page — same-origin so
        // cookies attach, no extra auth, and the JSON returns
        // `subscribers`, `accounts_active`, `public_description`,
        // `created_utc`, `over18`, `community_icon`, `title`. That's all
        // the metrics we need, served by Reddit itself.
        function scrapeRedditSearch(max) {
            const seenSr = new Set();
            const seenUser = new Set();
            const out = [];

            // ── Subreddits ────────────────────────────────────────
            // Anchor: any /r/<name> link, EXCLUDING /r/<name>/comments/...
            // because those are post links, not the subreddit itself.
            const srLinks = document.querySelectorAll('a[href*="/r/"]');
            for (const a of srLinks) {
                if (out.length >= max) break;
                const href = a.getAttribute('href') || '';
                const m = href.match(/^\/?r\/([A-Za-z0-9_]+)(?:\/?$|\/(?!comments|wiki|new|hot|top|rising))/);
                if (!m) {
                    // Fall back to a looser match — even /r/<sub>/comments/...
                    // tells us the subreddit exists, so we still want to add it.
                    const loose = href.match(/\/r\/([A-Za-z0-9_]+)/);
                    if (!loose) continue;
                    if (seenSr.has(loose[1].toLowerCase())) continue;
                    seenSr.add(loose[1].toLowerCase());
                    out.push({
                        handle: `r/${loose[1]}`,
                        accountType: 'subreddit',
                        url: `https://www.reddit.com/r/${loose[1]}/`,
                        displayName: `r/${loose[1]}`,
                        bio: '',
                        verified: false,
                        platform: 'Reddit',
                        discoveredVia: 'search'
                    });
                    continue;
                }
                if (seenSr.has(m[1].toLowerCase())) continue;
                seenSr.add(m[1].toLowerCase());
                // Try to pull a description from the same card so users
                // see context even before we enrich with about.json.
                const card = a.closest('div, article, li') || a;
                const cardText = (card.innerText || '').trim();
                const lines = cardText.split('\n').map(s => s.trim()).filter(Boolean);
                // First non-handle line that isn't a count is usually the description
                const bioGuess = lines.find(l =>
                    !/^r\/\w+$/i.test(l) &&
                    !/^\d[\d,.kKmM]*\s*(member|subscriber|online)/i.test(l) &&
                    l.length > 10
                ) || '';
                out.push({
                    handle: `r/${m[1]}`,
                    accountType: 'subreddit',
                    url: `https://www.reddit.com/r/${m[1]}/`,
                    displayName: `r/${m[1]}`,
                    bio: bioGuess.slice(0, 300),
                    verified: false,
                    platform: 'Reddit',
                    discoveredVia: 'search'
                });
            }

            // ── Users (kept for backwards compat) ─────────────────
            const userLinks = document.querySelectorAll('a[href*="/user/"], a[href*="/u/"]');
            for (const a of userLinks) {
                if (out.length >= max) break;
                const m = (a.getAttribute('href') || '').match(/\/(?:user|u)\/([^/?#]+)/);
                if (!m || seenUser.has(m[1].toLowerCase())) continue;
                seenUser.add(m[1].toLowerCase());
                out.push({
                    handle: m[1],
                    accountType: 'user',
                    url: `https://www.reddit.com/user/${m[1]}/`,
                    displayName: (a.innerText || '').trim().slice(0, 80) || m[1],
                    bio: '',
                    verified: false,
                    platform: 'Reddit',
                    discoveredVia: 'search'
                });
            }

            return { candidates: out };
        }

        // Synchronous Reddit profile scrape — used as a fallback when the
        // background hasn't been able to enrich with about.json. The real
        // metrics come from the background's fetch of `/r/<sub>/about.json`,
        // see `enrichRedditCandidate` below. Keeping this sync avoids the
        // async-in-executeScript problem documented in sendToAgent.
        function scrapeRedditProfile() {
            const path = location.pathname;
            const srMatch = path.match(/^\/r\/([A-Za-z0-9_]+)/);
            const userMatch = path.match(/^\/(?:user|u)\/([^/?#]+)/);
            if (srMatch) {
                return {
                    profile: {
                        handle: `r/${srMatch[1]}`,
                        accountType: 'subreddit',
                        displayName: `r/${srMatch[1]}`,
                        bio: '',
                        followers: 0,
                        verified: false,
                        platform: 'Reddit'
                    }
                };
            }
            if (userMatch) {
                const handle = userMatch[1];
                const bioEl = document.querySelector('[data-testid="profile-description"], .ProfileSidebar__description');
                return {
                    profile: {
                        handle,
                        accountType: 'user',
                        displayName: handle,
                        bio: (bioEl?.innerText || '').trim().slice(0, 500),
                        followers: 0,
                        verified: false,
                        platform: 'Reddit'
                    }
                };
            }
            return { error: 'Not on a recognized Reddit profile page' };
        }

        // ──── SCRAPE HOME FEED (Feed Watcher) ───────────────────
        // Scrapes the user's home feed for posts WITHOUT visiting any author's
        // profile. Returns FeedWatchPostRaw rows that the panel-side scorer
        // will run Gemini against to compute relevancyScore.
        function scrapeHomeFeed(max) {
            const out = [];
            const seen = new Set();
            const nowIso = new Date().toISOString();

            // Parse "Xh" / "Xd" / ISO datetime → epoch ms.
            const parseRelTime = (s) => {
                if (!s) return undefined;
                const dt = Date.parse(s);
                if (!isNaN(dt)) return dt;
                const m = String(s).match(/(\d+)\s*([smhdwMy])/);
                if (!m) return undefined;
                const n = parseInt(m[1], 10);
                const unit = m[2];
                const mult = unit === 's' ? 1000 : unit === 'm' ? 60000
                    : unit === 'h' ? 3.6e6 : unit === 'd' ? 86.4e6
                    : unit === 'w' ? 6.048e8 : unit === 'M' ? 2.592e9 : 3.1536e10;
                return Date.now() - n * mult;
            };

            if (platform === 'X') {
                // Each tweet is an <article data-testid="tweet">. The status link
                // gives us BOTH the author handle and the canonical post URL.
                const arts = document.querySelectorAll('article[data-testid="tweet"]');
                for (const art of arts) {
                    if (out.length >= max) break;
                    // Prefer the timestamp's permalink (clean /handle/status/id).
                    // A bare a[href*="/status/"] can match the ANALYTICS link
                    // (/handle/status/id/analytics) or the photo link
                    // (/status/id/photo/1) depending on DOM order, which is why
                    // opening a post landed on the "Views" analytics modal.
                    let statusLink = art.querySelector('a[href*="/status/"]:has(time)')
                        || (art.querySelector('time')?.closest('a'))
                        || art.querySelector('a[href*="/status/"]');
                    if (!statusLink) continue;
                    const href = statusLink.getAttribute('href') || '';
                    const m = href.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
                    if (!m) continue;
                    const handle = m[1], statusId = m[2];
                    if (seen.has(statusId)) continue;
                    seen.add(statusId);
                    const textEl = art.querySelector('[data-testid="tweetText"]');
                    let text = (textEl?.innerText || '').trim().slice(0, 2000);

                    // MEDIA — capture photos / video / GIF so image-only posts
                    // are no longer dropped and the card can surface them. Alt
                    // text doubles as scoring context for wordless posts.
                    const photoEls = Array.from(art.querySelectorAll('[data-testid="tweetPhoto"] img'));
                    const images = photoEls.map(img => img.getAttribute('src')).filter(Boolean).slice(0, 4);
                    const photoAlts = photoEls.map(img => (img.getAttribute('alt') || '').trim())
                        .filter(a => a && a.toLowerCase() !== 'image');
                    const hasVideo = !!art.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
                    const hasGif = !!art.querySelector('[data-testid="gifPlayer"]');
                    const media = (images.length || hasVideo || hasGif)
                        ? { images, hasVideo, hasGif, alt: photoAlts.slice(0, 3) }
                        : null;

                    // Drop only when there's NOTHING (no text AND no media) —
                    // those are ads / empty rows. Image-only posts flow through.
                    if (!text && !media) continue;

                    const nameEl = art.querySelector('[data-testid="User-Name"]');
                    const displayName = (nameEl?.innerText || '').trim().split('\n')[0] || handle;
                    const verified = !!art.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified" i]');
                    const timeEl = art.querySelector('time');
                    const postTimestamp = parseRelTime(timeEl?.getAttribute('datetime') || timeEl?.innerText);
                    const counts = readXTweetCounts(art);
                    const avatarEl = art.querySelector('img[src*="profile_images"]');

                    // REPOST / QUOTE — surface the ORIGINAL so the user (and the
                    // reply) see the real context. Native repost: the visible
                    // tweet IS the original. Quote: a nested tweetText below.
                    const social = (art.querySelector('[data-testid="socialContext"]')?.innerText || '').toLowerCase();
                    const isRepost = /repost|retweet/.test(social);
                    let originalPost = null;
                    if (isRepost) {
                        originalPost = { text: text.slice(0, 1000), author: handle, timestamp: postTimestamp || null };
                    } else {
                        const innerTexts = art.querySelectorAll('[data-testid="tweetText"]');
                        if (innerTexts.length >= 2) {
                            const quoted = innerTexts[innerTexts.length - 1];
                            const quotedHandle = art.querySelector('[role="link"] [data-testid="User-Name"] a[href^="/"]')
                                ?.getAttribute('href')?.replace(/^\//, '') || null;
                            originalPost = { text: (quoted.innerText || '').trim().slice(0, 1000), author: quotedHandle, timestamp: null };
                        }
                    }

                    // Wordless image post — synthesise light context so the
                    // relevancy scorer has something to work with.
                    if (!text && media) {
                        text = photoAlts.length ? `[Image] ${photoAlts.join('. ')}`.slice(0, 1000) : '[Image post]';
                    }

                    out.push({
                        uuid: `x_${statusId}`,
                        platform: 'X',
                        postUrl: `https://x.com/${handle}/status/${statusId}`,
                        text,
                        media,
                        isRepost: isRepost || !!originalPost,
                        originalPost,
                        scrapedAt: nowIso,
                        postTimestamp,
                        author: {
                            handle,
                            displayName: displayName.slice(0, 80),
                            profileUrl: `https://x.com/${handle}`,
                            verified,
                            avatarUrl: avatarEl?.getAttribute('src') || undefined
                        },
                        cardEngagement: counts
                    });
                }
                return { posts: out, diagnostic: { mode: 'x-home', articles: arts.length, captured: out.length } };
            }

            if (platform === 'LinkedIn') {
                // LinkedIn ships TWO home-feed markups in parallel:
                //   • OLD  — .feed-shared-update-v2 with a data-urn on the card
                //            (URN present, classic class names).
                //   • NEW  — a React rewrite with HASHED/obfuscated class names,
                //            posts live under [data-testid="mainFeed"], the body
                //            sits in [data-testid="expandable-text-box"], and
                //            there is NO data-urn anywhere in the DOM.
                // We support both: detect the surface per-card and fall back to a
                // content hash for the uuid when no URN is available.

                // Tiny stable string hash (djb2) for URN-less new-feed cards.
                const hashStr = (s) => {
                    let h = 5381;
                    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
                    return (h >>> 0).toString(36);
                };

                // Collect candidate cards. Dedup by element identity.
                const cardSet = [];
                const pushUnique = (el) => { if (el && !cardSet.includes(el)) cardSet.push(el); };
                const mainFeed = document.querySelector('[data-testid="mainFeed"]')
                    || document.querySelector('main#workspace')
                    || document.querySelector('main');

                // ── NEW FEED (2025-26) ──
                // LinkedIn dropped `feed-shared-update-v2`, the `data-urn` and
                // `data-finite-scroll-hotkey-item` hooks, and all stable class
                // names — every class is now an obfuscated hash. Each post is a
                // `div[componentkey="<opaque-id>"]` holding ONE author /in/ (or
                // /company/) link plus a post body / media. The whole feed list
                // is itself `componentkey="container-…"` — exclude it. We keep
                // only the OUTERMOST qualifying container so a quoted/reshared
                // inner post doesn't double-count. (The old expandable-text-box
                // ancestor-walk collapsed every post into the single feed
                // wrapper → 1 card total → the "scrapes only 1 / 4 / none" bug.)
                const ckCandidates = Array.from(document.querySelectorAll('div[componentkey]')).filter(d => {
                    const ck = d.getAttribute('componentkey') || '';
                    if (/^container-/.test(ck)) return false;                 // the feed list container
                    if (!d.querySelector('a[href*="/in/"], a[href*="/company/"]')) return false;
                    if (!d.querySelector('[data-testid="expandable-text-box"]') &&
                        !d.querySelector('img[src*="licdn"], video')) return false;
                    return true;
                });
                const ckSet = new Set(ckCandidates);
                for (const d of ckCandidates) {
                    let nested = false, n = d.parentElement;
                    while (n) { if (ckSet.has(n)) { nested = true; break; } n = n.parentElement; }
                    if (!nested) pushUnique(d);
                }

                // ── OLD FEED (fallback for older accounts / surfaces) ──
                if (!cardSet.length && mainFeed) {
                    const bodies = mainFeed.querySelectorAll('[data-testid="expandable-text-box"]');
                    for (const body of bodies) {
                        let node = body, card = null;
                        for (let i = 0; i < 12 && node && node !== mainFeed; i++) {
                            node = node.parentElement;
                            if (node && node.querySelector('a[href*="/in/"]')) { card = node; break; }
                        }
                        if (card) pushUnique(card);
                    }
                    document.querySelectorAll('div.feed-shared-update-v2, [data-urn^="urn:li:activity"]').forEach(pushUnique);
                }

                for (const card of cardSet) {
                    if (out.length >= max) break;

                    // ── URN (old feed only) or content-hash fallback (new feed) ──
                    let urn = card.getAttribute('data-urn')
                        || card.getAttribute('data-id')
                        || (card.querySelector('[data-urn^="urn:li:activity"]')?.getAttribute('data-urn'))
                        || (card.querySelector('[data-id^="urn:li:activity"]')?.getAttribute('data-id'))
                        || null;
                    if (urn && !/urn:li:activity/.test(urn)) urn = null;

                    // ── NEW FEED: the post id is buried in nested componentkey
                    //    strings (no data-urn anywhere). Read it straight from the
                    //    card so we can build the REAL post permalink WITHOUT ever
                    //    navigating off the feed. Forms seen in the live new feed:
                    //      ShareUrn(shareId=7466126091360030720)            → share
                    //      replaceableComment_urn:li:comment:(urn:li:activity:7467…  → parent activity
                    //      urn:li:activity:<id>  (direct, when present)
                    //    The activity id inside a comment urn IS this post's parent
                    //    activity, so a plain activity match is correct whether the
                    //    id is standalone or embedded in a comment urn. Activity is
                    //    canonical; share is a valid permalink that redirects to it.
                    if (!urn) {
                        const blob = card.outerHTML;
                        const actM = blob.match(/urn:li:activity:(\d{6,})/);
                        if (actM) {
                            urn = `urn:li:activity:${actM[1]}`;
                        } else {
                            const shareM = blob.match(/ShareUrn\(shareId=(\d{6,})\)/)
                                || blob.match(/urn:li:share:(\d{6,})/);
                            if (shareM) urn = `urn:li:share:${shareM[1]}`;
                        }
                    }

                    // ── AD FILTER (multi-language) ──
                    // LinkedIn marks sponsored cards with "Promoted"/"Sponsored"
                    // in the actor sub-description (and sometimes the small header
                    // text line). Skip ONLY those. Reaction-surfaced cards
                    // ("X likes this" / "X commented on this") from followed people
                    // are LEGITIMATE posts and must NOT be skipped — author
                    // attribution below already ignores /in/ links inside the
                    // context header, so the post is credited to its real author,
                    // not to the connection who reacted. (We previously skipped all
                    // reaction-surfaced cards, which wrongly dropped many real
                    // posts before they could reach the tracker.)
                    // ctxEl is still needed below to exclude the reactor's profile
                    // link from author detection.
                    const ctxEl = card.querySelector(
                        '.update-components-header__text-view, .update-components-header, ' +
                        '.feed-shared-header__text, .feed-shared-header, ' +
                        '.update-components-actor__supplementary-actor-info'
                    );
                    // Narrow promo detection to the specific elements LinkedIn uses
                    // for the "Promoted" tag — avoid matching post body / headline.
                    const promoEl = card.querySelector(
                        '.update-components-actor__sub-description, .feed-shared-actor__sub-description, ' +
                        '.update-components-header__text-view, .feed-shared-header__text'
                    );
                    const promoTxt = (promoEl?.innerText || '').toLowerCase();
                    const PROMO_RE = /\b(promoted|sponsored|sponsoris\w*|publicité|publicite|anzeige|gesponsert|patrocinad\w*)\b|ممول|إعلان|اعلان/;
                    if (PROMO_RE.test(promoTxt)) continue; // skip ads only

                    // ── AUTHOR — person link (skip company-authored / promoted) ──
                    // The composer row also has an /in/ link to the user's own
                    // profile; cards without a post body were excluded above so
                    // that's already handled, but guard the "Start a post" link.
                    // Also exclude any /in/ link that lives INSIDE the context
                    // header (e.g. the "Bob likes this" reactor) so we attribute
                    // the post to its real author, not the person who reacted.
                    const links = Array.from(card.querySelectorAll('a[href*="/in/"]'))
                        .filter(a => !/\/article\/new\//.test(a.getAttribute('href') || ''))
                        .filter(a => !ctxEl || !ctxEl.contains(a));
                    const link = links[0];
                    if (!link) continue;
                    const am = (link.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
                    if (!am) continue;
                    const handle = am[1];

                    // ── POST TEXT — new feed expandable-text-box, then old class ──
                    const textEl = card.querySelector(
                        '[data-testid="expandable-text-box"], ' +
                        '.feed-shared-update-v2__description, .update-components-text, ' +
                        '.feed-shared-inline-show-more-text'
                    );
                    let text = (textEl?.innerText || '').trim().slice(0, 2000);

                    // ── MEDIA — content images (exclude actor avatar) + video ──
                    const liImgs = [];
                    Array.from(card.querySelectorAll('img[src*="licdn"], img[src]'))
                        .forEach(img => {
                            const src = img.getAttribute('src') || '';
                            if (!src || /data:image/.test(src)) return;
                            // Avatars live inside the author link / sit ≤64px.
                            if (img.closest('a[href*="/in/"]')) return;
                            const w = img.getAttribute('width') || img.width || 0;
                            if (w && Number(w) > 0 && Number(w) <= 64) return;
                            if (/profile-displayphoto|profile-framedphoto|EntityPhoto/i.test(src)) return;
                            if (!liImgs.includes(src)) liImgs.push(src);
                        });
                    const liVideo = !!card.querySelector('video, .update-components-linkedin-video, .feed-shared-linkedin-video, [data-testid*="video" i]');
                    const media = (liImgs.length || liVideo)
                        ? { images: liImgs.slice(0, 4), hasVideo: liVideo, hasGif: false, alt: [] }
                        : null;

                    // Drop only when there is NOTHING (no text AND no media).
                    if (!text && !media) continue;

                    // Stable id: URN when present, else hash of author+text(+first
                    // media src) so the same post dedups across sweeps.
                    const idBasis = urn || `${handle}|${(text || '').slice(0, 180)}|${liImgs[0] || ''}`;
                    const uuidKey = urn ? urn : 'h:' + hashStr(idBasis);
                    if (seen.has(uuidKey)) continue;
                    seen.add(uuidKey);

                    // ── DISPLAY NAME — img alt ("View NAME's profile" / localized
                    //    "Voir le profil de NAME"), then actor title, then link. ──
                    let displayName = '';
                    const avatarEl = card.querySelector('a[href*="/in/"] img[alt], img[alt]');
                    const alt = (avatarEl?.getAttribute('alt') || '').trim();
                    let am2;
                    if ((am2 = alt.match(/^(?:View|Voir le profil de)\s+(.+?)(?:'s profile)?$/i))) {
                        displayName = am2[1].trim();
                    }
                    if (!displayName) {
                        const nameEl = card.querySelector(
                            '.update-components-actor__title span[aria-hidden="true"], ' +
                            '.update-components-actor__name, .feed-shared-actor__name'
                        );
                        displayName = (nameEl?.innerText || '').trim().split('\n')[0];
                    }
                    if (!displayName) displayName = (link.innerText || '').trim().split('\n')[0] || handle;

                    // ── BYLINE / SUBTITLE — headline under the name (old class,
                    //    else the actor sub line text minus the name). ──
                    const descEl = card.querySelector(
                        '.update-components-actor__description, .feed-shared-actor__description'
                    );
                    const bylineSubtitle = (descEl?.innerText || '').trim().slice(0, 200);
                    const verified = !!card.querySelector('[aria-label*="verified" i]');

                    // ── ENGAGEMENT — scan aria-labels for reaction/comment counts.
                    //    New feed exposes "N reactions" / "N comments" on the social
                    //    proof row; old feed uses .social-details-social-counts. ──
                    let reactions = 0, comments = 0;
                    const socialRoot = card.querySelector('.social-details-social-counts') || card;
                    const labeled = socialRoot.querySelectorAll('[aria-label]');
                    for (const el of labeled) {
                        const lab = (el.getAttribute('aria-label') || '').toLowerCase();
                        const num = parseCount((lab.match(/([\d.,]+\s*[kmb]?)/i)?.[1] || '0'));
                        if (!num) continue;
                        if (!reactions && /(reaction|like|réaction|j'aime|celebrat|support|love|insight|funny)/.test(lab)) reactions = num;
                        if (!comments && /(comment|commentaire)/.test(lab)) comments = num;
                    }
                    if (!reactions) {
                        const rEl = card.querySelector('.social-details-social-counts__reactions-count, [data-test-id="social-counts-reactions"]');
                        if (rEl) reactions = parseCount((rEl.innerText || '').match(/([\d.,]+\s*[KMB]?)/i)?.[1] || '0');
                    }

                    // ── TIMESTAMP — old <time>, else relative text in the sub line.
                    const timeEl = card.querySelector('time, .update-components-actor__sub-description span[aria-hidden="true"]');
                    let postTimestamp = parseRelTime(timeEl?.getAttribute('datetime') || timeEl?.innerText);
                    if (!postTimestamp) {
                        // New feed: hunt a small "2h • 1d • 3w" token near the actor.
                        const subTxt = (card.querySelector('a[href*="/in/"]')?.closest('div')?.parentElement?.innerText || '')
                            .match(/\b(\d+)\s*(s|m|h|d|w|mo|y)\b/i);
                        if (subTxt) postTimestamp = parseRelTime(subTxt[1] + subTxt[2][0]);
                    }

                    // ── RESHARE — original nested update (old + new wrappers). ──
                    const reshare = card.querySelector(
                        '.update-components-mini-update-v2, .feed-shared-reshared-update, ' +
                        '[data-testid*="reshare" i], [data-testid*="resharedUpdate" i]'
                    );
                    let isRepost = false, originalPost = null;
                    if (reshare) {
                        isRepost = true;
                        const origTextEl = reshare.querySelector('[data-testid="expandable-text-box"], .update-components-text, .feed-shared-text, .feed-shared-inline-show-more-text');
                        const origLink = reshare.querySelector('a[href*="/in/"], a[href*="/company/"]');
                        const origHandle = origLink ? ((origLink.getAttribute('href') || '').match(/\/(?:in|company)\/([^/?#]+)/)?.[1] || null) : null;
                        const origImg = reshare.querySelector('a[href*="/in/"] img[alt]');
                        const origAlt = (origImg?.getAttribute('alt') || '').match(/^(?:View|Voir le profil de)\s+(.+?)(?:'s profile)?$/i);
                        originalPost = {
                            text: (origTextEl?.innerText || '').trim().slice(0, 1000),
                            author: (origAlt?.[1] || origHandle || '').trim() || null,
                            timestamp: null
                        };
                    }

                    // Wordless media post — give the scorer light context.
                    if (!text && media) text = '[Image post]';

                    // ── POST URL — must point at the POST itself, never a list. ──
                    //    URN → canonical permalink. Else any /feed/update/ or
                    //    /posts/ href in the card. Otherwise leave it EMPTY: the
                    //    new feed exposes no permalink in the card, and we must
                    //    NOT fall back to the author's recent-activity/profile
                    //    page — that's a LIST, so the link would open the wrong
                    //    place and a comment would land on whatever post happens
                    //    to be on top. PHASE 2.4 resolves the true
                    //    /feed/update/<urn>/ from the author's recent-activity
                    //    page; posts that stay unresolved are surfaced for
                    //    visibility but are NOT commentable (guarded downstream).
                    let postUrl;
                    if (urn) {
                        postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
                    } else {
                        // ONLY accept a TRUE per-post permalink from the card:
                        //   /feed/update/urn:li:activity:<id>  OR
                        //   /posts/<slug>-activity-<id>-<hash>
                        // Reject list pages like /company/<x>/posts/ or
                        // /in/<x>/recent-activity/ — they carry "/posts/" but are
                        // NOT a single post, so commenting there would hit the
                        // wrong target. No match → leave EMPTY (surfaced, not
                        // commentable). We never navigate to recover it.
                        const PERMA_RE = /\/feed\/update\/urn:li:activity:\d+|\/posts\/[^/?#]*activity-\d{6,}/;
                        const permA = Array.from(card.querySelectorAll('a[href*="/feed/update/"], a[href*="/posts/"]'))
                            .map(a => a.getAttribute('href') || '')
                            .find(h => PERMA_RE.test(h));
                        postUrl = permA
                            ? (permA.startsWith('http') ? permA : `https://www.linkedin.com${permA}`)
                            : '';
                    }

                    out.push({
                        uuid: urn ? `li_${urn}` : `li_${uuidKey}`,
                        platform: 'LinkedIn',
                        postUrl,
                        needsPermalinkResolution: !urn && !/\/feed\/update\/urn:li:activity:\d+|\/posts\/[^/?#]*activity-\d{6,}/.test(postUrl),
                        text,
                        media,
                        isRepost,
                        originalPost,
                        scrapedAt: nowIso,
                        postTimestamp,
                        author: {
                            handle,
                            displayName: (displayName || handle).slice(0, 80),
                            profileUrl: `https://www.linkedin.com/in/${handle}`,
                            verified,
                            bylineSubtitle,
                            avatarUrl: avatarEl?.getAttribute('src') || undefined
                        },
                        cardEngagement: (reactions || comments) ? {
                            reactions, comments, total: reactions + comments
                        } : undefined
                    });
                }
                return { posts: out, diagnostic: { mode: 'linkedin-home', cards: cardSet.length, captured: out.length, hasMainFeed: !!mainFeed } };
            }

            if (platform === 'Reddit') {
                // Reddit's home/popular feed has gone through several DOM
                // generations. We collect candidate cards from EVERY known
                // shape and de-dupe by permalink so a single markup change
                // can't zero the whole sweep:
                //   • <shreddit-post>                    (shreddit, 2023-26)
                //   • <article> wrapping a shreddit-post (newest feed shell)
                //   • [data-testid="post-container"]     (legacy reactjs feed)
                //   • articles that merely contain a /comments/ permalink link
                const cardSet = new Set();
                document.querySelectorAll('shreddit-post').forEach(c => cardSet.add(c));
                document.querySelectorAll('[data-testid="post-container"]').forEach(c => cardSet.add(c));
                if (!cardSet.size) {
                    // Last-ditch: any article that links to a post permalink.
                    document.querySelectorAll('article, [role="article"]').forEach(a => {
                        if (a.querySelector('a[href*="/comments/"]')) cardSet.add(a);
                    });
                }
                const cards = Array.from(cardSet);
                let skippedNoLink = 0, skippedNoText = 0, skippedNoAuthor = 0, skippedDup = 0;
                for (const card of cards) {
                    if (out.length >= max) break;
                    // shreddit-post attrs live on the host element; if the card
                    // is an <article> wrapper, read them off the inner element.
                    const sp = (card.tagName && card.tagName.toLowerCase() === 'shreddit-post')
                        ? card
                        : card.querySelector('shreddit-post');
                    const attr = (name) => (sp?.getAttribute(name)) || card.getAttribute(name) || '';

                    let permalink = attr('permalink')
                        || attr('content-href')
                        || card.querySelector('a[slot="title"]')?.getAttribute('href')
                        || card.querySelector('a[data-click-id="body"]')?.getAttribute('href')
                        || card.querySelector('a[href*="/comments/"]')?.getAttribute('href')
                        || '';
                    if (permalink && !/^https?:/.test(permalink)) permalink = `https://www.reddit.com${permalink}`;
                    if (!permalink) { skippedNoLink++; continue; }
                    if (seen.has(permalink)) { skippedDup++; continue; }
                    seen.add(permalink);

                    const title = (attr('post-title') ||
                        card.querySelector('h1, h2, h3, a[slot="title"], [slot="title"]')?.innerText || '').trim();
                    const bodyEl = card.querySelector(
                        '[slot="text-body"], [slot="post-rtjson-content"], ' +
                        '.RichTextJSON-root, [data-click-id="text"], .md'
                    );
                    const body = (bodyEl?.innerText || '').trim().slice(0, 2000);
                    let text = (title + (body ? '\n\n' + body : '')).slice(0, 2200);
                    // Image/link posts may carry no text body and (rarely) no
                    // title attribute — fall back to the permalink slug so a
                    // visual post still reaches the tracker instead of vanishing.
                    if (!text.trim()) {
                        const slug = (permalink.match(/\/comments\/[^/]+\/([^/?#]+)/)?.[1] || '')
                            .replace(/_/g, ' ').trim();
                        if (slug) text = slug.slice(0, 200);
                    }
                    if (!text.trim()) { skippedNoText++; continue; }

                    let author = attr('author')
                        || (card.querySelector('a[href^="/user/"], a[href*="/user/"]')?.getAttribute('href') || '')
                            .replace(/.*\/user\//, '').replace(/\/.*$/, '');
                    // Don't drop a perfectly good post just because the author
                    // chip didn't render — attribute it to the subreddit feed.
                    if (!author) { author = ''; skippedNoAuthor++; }

                    const subreddit = attr('subreddit-prefixed-name')
                        || attr('subreddit-name')
                        || (card.querySelector('a[href^="/r/"], a[href*="/r/"]')?.getAttribute('href') || '')
                            .replace(/.*\/r\//, '').replace(/\/.*$/, '');
                    const upvotes = parseCount(attr('score') || '0');
                    const comments = parseCount(attr('comment-count') || '0');
                    const createdTs = attr('created-timestamp')
                        || card.querySelector('time, faceplate-timeago')?.getAttribute('ts')
                        || card.querySelector('time')?.getAttribute('datetime');
                    out.push({
                        uuid: `rd_${permalink}`,
                        platform: 'Reddit',
                        postUrl: permalink,
                        text,
                        scrapedAt: nowIso,
                        postTimestamp: parseRelTime(createdTs),
                        author: {
                            handle: author || (subreddit ? (subreddit.replace(/^r\//, '')) : 'reddit'),
                            displayName: author ? `u/${author}` : (subreddit ? (subreddit.startsWith('r/') ? subreddit : `r/${subreddit}`) : 'Reddit'),
                            profileUrl: author ? `https://www.reddit.com/user/${author}/` : (subreddit ? `https://www.reddit.com/${subreddit.startsWith('r/') ? subreddit : 'r/' + subreddit}/` : 'https://www.reddit.com/'),
                            bylineSubtitle: subreddit ? (subreddit.startsWith('r/') ? subreddit : `r/${subreddit}`) : undefined
                        },
                        cardEngagement: (upvotes || comments) ? { upvotes, comments, total: upvotes + comments } : undefined
                    });
                }
                return { posts: out, diagnostic: { mode: 'reddit-home', cards: cards.length, captured: out.length, skippedNoLink, skippedNoText, skippedNoAuthor, skippedDup } };
            }

            return { posts: [], diagnostic: { mode: 'unsupported-platform', platform } };
        }

        // ──── DISPATCH ──────────────────────────────────────────
        switch (msg && msg.type) {
            case 'DISCOVERY_DETECT_BLOCK':
                return detectBlock();
            case 'DISCOVERY_HUMANIZE_ENTRY':
            case 'DISCOVERY_IDLE_BEHAVIOR':
                return { ok: true };
            case 'DISCOVERY_SCRAPE_SEARCH':
            case 'DISCOVERY_SCRAPE_POSTS':
                if (platform === 'X') return scrapeXSearch(msg.maxCandidates || 25);
                if (platform === 'LinkedIn') return scrapeLinkedInSearch(msg.maxCandidates || 25);
                if (platform === 'Reddit') return scrapeRedditSearch(msg.maxCandidates || 25);
                return { error: 'Platform not supported: ' + host };
            case 'DISCOVERY_SCRAPE_COMMENTERS':
                if (platform === 'LinkedIn') return scrapeLinkedInCommenters(msg.maxCandidates || 30);
                return { candidates: [] };
            case 'DISCOVERY_SCRAPE_FEED':
                return scrapeHomeFeed(msg.maxCandidates || 30);
            case 'DISCOVERY_FEED_SCROLL_STEP': {
                // Human-style scroll step. CRITICAL: the new LinkedIn feed does
                // NOT scroll the window — the document's scrollingElement has
                // scrollHeight === clientHeight; the real scroller is an inner
                // overflow container (`main#workspace`). X/Reddit scroll the
                // window. So we pick whichever element is ACTUALLY scrollable
                // (largest scrollHeight − clientHeight) and scroll that. Without
                // this, window.scrollBy did nothing on LinkedIn → no new posts
                // ever hydrated → the sweep only ever saw the first viewport.
                const candidates = [
                    document.scrollingElement,
                    document.querySelector('main#workspace'),
                    document.querySelector('[data-testid="mainFeed"]'),
                    document.querySelector('main')
                ].filter(Boolean);
                let scroller = document.scrollingElement || document.documentElement;
                let bestGap = (scroller.scrollHeight - scroller.clientHeight) || 0;
                for (const el of candidates) {
                    const gap = el.scrollHeight - el.clientHeight;
                    if (gap > bestGap + 50) { bestGap = gap; scroller = el; }
                }
                const ch = scroller.clientHeight || window.innerHeight || 800;
                const px = Math.round(ch * (0.55 + Math.random() * 0.55));
                const beforeY = scroller.scrollTop;
                const beforeMax = (scroller.scrollHeight || 0) - ch;
                // scrollTop assignment fires scroll + IntersectionObserver, which
                // is what triggers LinkedIn's lazy pagination. Use INSTANT scroll
                // (not 'smooth'): a smooth scroll hasn't moved by the time we read
                // scroller.scrollTop below, so afterY came back == beforeY and the
                // sweep's stuck-scroll detector mis-fired. Instant jump updates
                // scrollTop synchronously and still triggers lazy load.
                try { scroller.scrollTo({ top: beforeY + px, left: 0, behavior: 'auto' }); }
                catch { scroller.scrollTop = beforeY + px; }
                // "At bottom" must require GENUINE scrollable content. On a feed
                // that has only rendered a card or two (LinkedIn hydrates its
                // virtualized list lazily, X's timeline renders ~15-20s late),
                // scrollHeight ≈ clientHeight so beforeMax ≈ 0 and the old
                // `(beforeY+ch) >= beforeMax-100` test was TRUE at scrollTop 0 —
                // the loop broke at steps:0 and never scrolled to load the rest of
                // the feed (live diag: LinkedIn cards:2, steps:0). Demand at least
                // ~1.3 viewports of scroll room before we'll believe we're at the
                // end, so an un-hydrated feed keeps scrolling to pull more posts.
                const realScrollable = beforeMax > ch * 1.3;
                return {
                    scrolled: px,
                    beforeY,
                    afterY: scroller.scrollTop,
                    scrollMax: beforeMax,
                    scrollerTag: (scroller.tagName || '') + (scroller.id ? '#' + scroller.id : ''),
                    atBottom: realScrollable && (beforeY + ch) >= beforeMax - 100
                };
            }
            case 'DISCOVERY_SCRAPE_FALLBACK':
                if (platform === 'X') return { candidates: scrapeXSearch(50).candidates, fallback: true };
                if (platform === 'LinkedIn') return { candidates: scrapeLinkedInSearch(50).candidates, fallback: true };
                if (platform === 'Reddit') return { candidates: scrapeRedditSearch(50).candidates, fallback: true };
                return { candidates: [], fallback: true };
            case 'DISCOVERY_SCRAPE_PROFILE':
                if (platform === 'X') return scrapeXProfile();
                if (platform === 'LinkedIn') return scrapeLinkedInProfile();
                if (platform === 'Reddit') return scrapeRedditProfile();
                return { error: 'Platform not supported: ' + host };
            default:
                return { error: 'Unknown op: ' + (msg && msg.type) };
        }
    } catch (e) {
        return { error: (e && e.message) ? e.message : String(e) };
    }
}

// ============================================================
// CONTENT SCRIPT BRIDGE
// ============================================================
async function sendToAgent(tabId, message, retries = 3, timeoutMs = 20000) {
    // ─── FULLY SYNCHRONOUS in-page execution ───
    // On x.com (and likely other heavy SPAs), neither async funcs nor microtasks
    // nor macrotasks scheduled from inside chrome.scripting.executeScript reliably
    // flush. So we do *everything* synchronously: a single short executeScript
    // call inlines all scraping/detection logic, reads the DOM once, returns.
    // The engine already waits for hydration before calling us, so the DOM is
    // ready by the time we read it. No polling, no Promise chains.
    for (let i = 0; i < retries; i++) {
        if (missionAborted) throw new Error('Mission aborted');
        try {
            try { await chrome.tabs.get(tabId); }
            catch { throw new Error('Stealth tab no longer exists'); }

            const exec = await Promise.race([
                chrome.scripting.executeScript({
                    target: { tabId },
                    func: SYNC_AGENT_FN,
                    args: [message]
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`executeScript timeout ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
            const result = exec?.[0]?.result;
            if (!result) throw new Error('executeScript returned no result');
            return result;
        } catch (e) {
            if (i === retries - 1) throw e;
            console.warn(DISC_TAG, `Agent attempt ${i + 1}/${retries} failed: ${e.message} — retry in 1.5s`);
            await dsleep(1500);
        }
    }
}

// ============================================================
// SEARCH URL CONSTRUCTION
// ============================================================
// Each builder consumes filters.engagementFloor + filters.postRecencyDays
// and folds them INTO THE PLATFORM'S OWN SEARCH SEMANTICS wherever possible:
//   X        → native min_faves / min_retweets / since: operators (server-side filter)
//   Reddit   → sort=top + time window (server-side ranking)
//   LinkedIn → deterministic content search (sortBy=relevance + datePosted),
//              then we read each post card's real reaction/comment counts and
//              attribute them to the post AUTHOR. (No native engagement operator
//              exists; the old /feed/hashtag/ redirect was personalized + noisy
//              and is gone.)
// When the platform offers no native engagement filter, the URL is unchanged
// and we rely on the in-DOM card pre-filter further down the pipeline.

// Map postRecencyDays → YYYY-MM-DD for X's `since:` operator.
function _isoDaysAgo(days) {
    if (!days) return null;
    const d = new Date(Date.now() - days * 86400000);
    return d.toISOString().slice(0, 10);
}

// X: tab = 'user' | 'live' | 'top'. We force 'top' whenever an engagement
// floor is set — `f=live` is chronological (no engagement ranking) and would
// undo the point of the filter.
function buildXSearchUrl(filters, query, tab = 'top') {
    const floor = filters?.engagementFloor || 'any';
    const th = engagementThresholds('X', floor);
    const parts = [query];
    if (th.min_faves > 0)    parts.push(`min_faves:${th.min_faves}`);
    if (th.min_retweets > 0) parts.push(`min_retweets:${th.min_retweets}`);
    const since = _isoDaysAgo(filters?.postRecencyDays);
    if (since) parts.push(`since:${since}`);
    // When an engagement filter is set, always use the Top tab.
    const effectiveTab = (floor !== 'any' && tab === 'live') ? 'top' : tab;
    const q = encodeURIComponent(parts.join(' '));
    const f = effectiveTab === 'user' ? 'user' : effectiveTab === 'live' ? 'live' : '';
    return `https://x.com/search?q=${q}&src=typed_query${f ? `&f=${f}` : ''}`;
}

// LinkedIn: tab = 'people' | 'content'.
//
// Content tab is the engagement path. LinkedIn has no "min reactions" search
// operator, so we use the deterministic keyword content search and bias it with
// the two levers it DOES expose:
//   • sortBy="relevance"  → "Top match" ordering (popular posts bubble up)
//                           instead of the chronological "Latest" firehose.
//   • datePosted          → recency window from filters.postRecencyDays.
// The real engagement filter happens after the fact: scrapeLinkedInSearch reads
// each post card's reaction + comment counts and attributes them to the author,
// and the engagement-floor pre-filter drops authors below the threshold. This
// is deterministic and author-centric, unlike the old /feed/hashtag/ feed which
// was personalized to the logged-in account and full of commenters/sidebar noise.
function buildLinkedInSearchUrl(filters, query, tab = 'people') {
    const floor = filters?.engagementFloor || 'any';
    const params = new URLSearchParams();
    params.set('keywords', query);
    params.set('origin', 'GLOBAL_SEARCH_HEADER');
    if (tab === 'content') {
        // Top-match ordering surfaces engaging posts first whenever a floor is set.
        if (floor !== 'any') params.set('sortBy', '"relevance"');
        // Bias content search toward recent posts when a recency window is set.
        if (filters?.postRecencyDays) {
            // LinkedIn's date-posted filter values: past-24h, past-week, past-month
            const d = filters.postRecencyDays;
            const code = d <= 1 ? 'past-24h' : d <= 7 ? 'past-week' : d <= 31 ? 'past-month' : '';
            if (code) params.set('datePosted', `"${code}"`);
        }
    }
    const path = tab === 'content' ? 'content' : 'people';
    return `https://www.linkedin.com/search/results/${path}/?${params.toString()}`;
}

// Reddit search URLs by tab:
//   'sr'      → search communities (subreddits). This is what we publish to
//               the accounts list as first-class entities.
//   'user'    → search users (less useful for our use case but we include it
//               so power users can still find creators)
//   'link'    → search posts. With an engagement floor set, switch to
//               `sort=top` + a time window so Reddit itself returns
//               engagement-ranked posts (instead of relevance-sorted noise).
function buildRedditSearchUrl(filters, query, tab = 'sr') {
    const params = new URLSearchParams();
    params.set('q', query);
    if (tab === 'sr')        params.set('type', 'sr');
    else if (tab === 'user') params.set('type', 'user');
    else                     params.set('type', 'link');

    const floor = filters?.engagementFloor || 'any';
    if (tab === 'link' && floor !== 'any') {
        params.set('sort', 'top');
        const d = filters?.postRecencyDays;
        const t = d == null ? 'all' : d <= 1 ? 'day' : d <= 7 ? 'week' : d <= 31 ? 'month' : 'year';
        params.set('t', t);
    } else {
        params.set('sort', 'relevance');
    }
    return `https://www.reddit.com/search/?${params.toString()}`;
}

// Returns a list of query objects: { type, value }
//   type='keyword' → run the standard search-tab flow (built URL + scrape feed)
//   type='seed'    → run the seed-expand flow (open the seed page, scrape its
//                    top posts by engagement, click into top N, scrape reactors/repliers)
//
// Modes interact with seeds:
//   surgical (Quick) → keyword only
//   volume   (Wide)  → keyword only (seed expansion is too slow for this mode)
//   deep             → seeds FIRST then keyword fallback (graph signal beats search)
function planQueries(filters, mode, deepeningRound = 0, platform = null) {
    const out = [];
    const keywords = filters.keywords || [];
    const hashtags = filters.hashtags || [];

    // ─── Seeds (Deep mode only, when platform supplied) ───
    if (mode === 'deep' && platform && filters.seeds && Array.isArray(filters.seeds[platform])) {
        for (const s of filters.seeds[platform]) {
            const v = (s || '').trim();
            if (v) out.push({ type: 'seed', value: v });
        }
    }

    // Strategy: combine keywords in different patterns to avoid repetitive queries.
    // Deepening rounds widen the net: more queries + more combinations.
    let queryCount = mode === 'volume' ? 8 : mode === 'deep' ? 5 : 3;
    if (deepeningRound > 0) queryCount += deepeningRound * 4; // +4 each round

    const kws = [];
    keywords.slice(0, queryCount).forEach(kw => kws.push(kw));
    hashtags.slice(0, Math.max(0, queryCount - keywords.length)).forEach(tag => kws.push(tag));

    if (keywords.length >= 2 && kws.length < queryCount) {
        for (let i = 0; i < keywords.length - 1 && kws.length < queryCount; i++) {
            for (let j = i + 1; j < keywords.length && kws.length < queryCount; j++) {
                kws.push(`${keywords[i]} ${keywords[j]}`);
            }
        }
    }
    if (deepeningRound > 0 && keywords.length && hashtags.length) {
        for (const kw of keywords) {
            for (const tag of hashtags) {
                if (kws.length >= queryCount) break;
                kws.push(`${kw} ${tag.replace('#', '')}`);
            }
        }
    }
    if (filters.industry && keywords.length && kws.length < queryCount) {
        kws.push(`${keywords[0]} ${filters.industry}`);
    }

    // Dedupe keyword queries + cap, then push as objects.
    [...new Set(kws)].slice(0, queryCount).forEach(v => out.push({ type: 'keyword', value: v }));
    return out;
}

// ============================================================
// SCORING
// ============================================================
// ── LINKEDIN SCORING ──
// LinkedIn uses a richer rubric than X/Reddit because we read post-level
// data (recency + mature-post engagement). Two entry points:
//   scoreLinkedInFromCard()  → preliminary score from search-card data alone.
//                              Runs at search time so accounts appear immediately.
//   scoreLinkedInVerified()  → full score after profile visit. Replaces the
//                              preliminary score in place.
// Weights (out of 100):
//   authority 25, niche 30, recency 15, mature-engagement 25, verified 5.
// If post data is missing post-verify (locked profile, DOM drift), the
// recency + engagement subscores fall back to a neutral midpoint so a
// scrape failure doesn't unfairly tank an account.
function _nicheMatch(haystackText, filters) {
    const haystack = (haystackText || '').toLowerCase();
    let kwHits = 0, totalKw = 0;
    (filters.keywords || []).forEach(kw => {
        if (typeof kw !== 'string' || !kw.trim()) return;
        totalKw++;
        if (haystack.includes(kw.trim().toLowerCase())) kwHits++;
    });
    (filters.hashtags || []).forEach(tag => {
        if (typeof tag !== 'string' || !tag.trim()) return;
        totalKw++;
        if (haystack.includes(tag.trim().toLowerCase().replace('#', ''))) kwHits++;
    });
    const match = totalKw > 0 ? Math.round((kwHits / totalKw) * 100) : 50;
    return { match, kwHits, totalKw };
}

function _authorityFromFollowers(f) {
    if (!f || f <= 0) return 0;
    return Math.min(100, Math.log10(f + 1) * 18);
}

function scoreLinkedInFromCard(card, filters) {
    const f = typeof card.followerHint === 'number' ? card.followerHint : 0;
    const authority = f === 0 ? 25 : _authorityFromFollowers(f); // neutral when unknown
    const { match: nicheMatch, kwHits, totalKw } = _nicheMatch(
        [card.bio, card.displayName, card.handle].filter(Boolean).join(' '),
        filters
    );

    // Card engagement (reactions + comments read off the feed card itself).
    // When present, it's REAL data — use it as the engagement sub-score
    // instead of a 50-neutral guess. log10-scaled so 100→100k spans 0..100.
    const cardTotal = card?.cardEngagement?.total || 0;
    let engagementScore = 50;
    if (cardTotal > 0) {
        engagementScore = Math.min(100, Math.round(Math.log10(cardTotal + 1) * (100 / 3)));
    }
    const recencyScore = 50; // no post-time signal until verification
    const verifiedBonus = card.verified ? 5 : 0;

    // New engagement-led weights — see scoreAccount for the rationale.
    const finalScore = Math.round(
        authority * 0.10 +
        nicheMatch * 0.25 +
        engagementScore * 0.40 +
        50 * 0.05 +                  // card score neutral (we already used it above)
        recencyScore * 0.15 +
        verifiedBonus
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (card.verified) matchedSignals.push('Verified');
    if (cardTotal > 0) matchedSignals.push(`Post: ${cardTotal} reactions+comments`);
    if (f > 0) {
        const fmt = f >= 1e6 ? (f / 1e6).toFixed(1) + 'M' : f >= 1e3 ? (f / 1e3).toFixed(1) + 'K' : `${f}`;
        matchedSignals.push(`${fmt} followers`);
    }
    matchedSignals.push('Preliminary — visiting profile');

    return {
        followers: f,
        authorityScore: Math.round(authority),
        nicheMatch,
        finalScore,
        matchedSignals,
        tier: finalScore >= 85 ? 'S' : finalScore >= 70 ? 'A' : finalScore >= 50 ? 'B' : 'C'
    };
}

// ── POST-AUTHOR AGGREGATION SCORING (X & LinkedIn) ──
// This is the profile-free scoring path. Instead of visiting a profile to read
// follower counts, we judge an author purely on the engagement their posts
// earned in the result set:
//   • engagement   = MEDIAN total (reactions+comments / likes+RTs+replies)
//                    across the author's posts → rewards CONSISTENT performers
//                    over one-hit wonders (validated with the user).
//   • consistency  = how many of their posts surfaced (and across how many
//                    distinct queries) → owning the niche ranks higher.
//   • niche match  = keyword/hashtag hits in name + headline + post text.
// On LinkedIn, comments are weighted heavier than reactions (harder to earn).
// No follower count is required, so authorityScore is derived from engagement.
function _median(nums) {
    const a = (nums || []).filter(n => typeof n === 'number' && isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function scorePostAuthor(platform, agg, filters) {
    // agg = { handle, displayName, bio, verified, posts:[{reactions,comments,total,text}],
    //         queries:Set<string>, followerHint? }
    const posts = agg.posts || [];
    // LinkedIn: weight comments 2× when computing each post's effective engagement.
    const effective = posts.map(p => {
        if (platform === 'LinkedIn') return (p.reactions || 0) + 2 * (p.comments || 0);
        return p.total || ((p.reactions || 0) + (p.comments || 0));
    });
    const medianEng = _median(effective);
    const maxEng = effective.length ? Math.max(...effective) : 0;
    const postsSeen = posts.length;
    const queriesHit = agg.queries ? agg.queries.size : 1;

    // Engagement sub-score: log-scaled median. 0→0, ~10→33, ~100→66, ~1000→100.
    const engagementScore = medianEng > 0
        ? Math.min(100, Math.round(Math.log10(medianEng + 1) * (100 / 3)))
        : 0;

    // Consistency sub-score: more posts + more distinct queries = stronger.
    const consistencyScore = Math.min(100,
        (postsSeen >= 5 ? 70 : postsSeen * 14) + (queriesHit > 1 ? Math.min(30, (queriesHit - 1) * 15) : 0)
    );

    const haystack = [agg.displayName, agg.bio, agg.handle, ...posts.map(p => p.text || '')]
        .filter(Boolean).join(' ');
    const { match: nicheMatch, kwHits, totalKw } = _nicheMatch(haystack, filters);

    // authorityScore stands in for "reach" — derived from peak engagement since
    // we deliberately don't read follower counts.
    const authorityScore = maxEng > 0
        ? Math.min(100, Math.round(Math.log10(maxEng + 1) * (100 / 3)))
        : 0;

    const verifiedBonus = agg.verified ? 5 : 0;

    // Engagement-led blend: engagement 45, consistency 20, niche 25, verified 5,
    // peak-reach 5.
    const finalScore = Math.round(
        engagementScore * 0.45 +
        consistencyScore * 0.20 +
        nicheMatch * 0.25 +
        authorityScore * 0.05 +
        verifiedBonus
    );

    const matchedSignals = [];
    if (medianEng > 0) matchedSignals.push(`median ${medianEng} eng/post over ${postsSeen} post${postsSeen !== 1 ? 's' : ''}`);
    if (maxEng > 0 && maxEng !== medianEng) matchedSignals.push(`peak ${maxEng}`);
    if (queriesHit > 1) matchedSignals.push(`matched ${queriesHit} queries`);
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords`);
    if (agg.verified) matchedSignals.push('Verified');

    return {
        followers: agg.followerHint || 0,
        authorityScore,
        nicheMatch,
        finalScore,
        matchedSignals,
        postsSeen,
        medianPostEngagement: medianEng,
        maxPostEngagement: maxEng,
        tier: finalScore >= 85 ? 'S' : finalScore >= 70 ? 'A' : finalScore >= 50 ? 'B' : 'C'
    };
}

// Merge freshly-scraped post rows into the mission's per-author aggregation map.
// Keyed by `${platform}:${handle}`. Returns the set of handles touched.
function aggregateAuthorRows(platform, rows, query) {
    if (!activeMission._authorAgg) activeMission._authorAgg = {};
    const map = activeMission._authorAgg;
    const touched = new Set();
    for (const r of rows) {
        if (!r || !r.handle) continue;
        const key = `${platform}:${r.handle}`;
        let agg = map[key];
        if (!agg) {
            agg = map[key] = {
                platform, handle: r.handle, displayName: r.displayName, bio: r.bio || '',
                verified: !!r.verified, followerHint: r.followerHint,
                posts: [], queries: new Set(), postUrls: []
            };
        }
        // Keep the richest metadata we've seen.
        if (r.displayName && r.displayName.length > (agg.displayName || '').length) agg.displayName = r.displayName;
        if (r.bio && r.bio.length > (agg.bio || '').length) agg.bio = r.bio;
        if (r.verified) agg.verified = true;
        if (typeof r.followerHint === 'number' && !agg.followerHint) agg.followerHint = r.followerHint;
        if (query) agg.queries.add(query);
        const ce = r.cardEngagement;
        if (ce && (ce.total || 0) > 0) {
            agg.posts.push({
                reactions: ce.reactions || 0,
                comments: ce.comments || 0,
                total: ce.total || 0,
                text: r.samplePost || ''
            });
        }
        if (r.postUrl && agg.postUrls.length < 25) agg.postUrls.push({ url: r.postUrl, eng: (ce?.total || 0) });
        touched.add(r.handle);
    }
    return touched;
}

// Publish (or refresh) every aggregated author for `platform` into mission
// results, scored via scorePostAuthor. Replaces any existing entry for the
// handle in place so re-scoring across queries doesn't create duplicates.
async function publishAggregatedAuthors(platform, filters) {
    const map = activeMission._authorAgg || {};
    let published = 0;
    for (const key of Object.keys(map)) {
        if (!key.startsWith(platform + ':')) continue;
        const agg = map[key];
        // Authors we only ever saw via post rows with zero engagement still get
        // published (floor='any' case) but score low; floor filtering happens
        // upstream so anything here already passed the floor.
        const scoring = scorePostAuthor(platform, agg, filters);
        const existingIdx = activeMission.results.findIndex(
            r => r.platform === platform && r.handle === agg.handle
        );
        const base = existingIdx >= 0 ? activeMission.results[existingIdx] : {
            id: `${platform}_${agg.handle}_${Date.now()}`,
            discoveredAt: nowIso(),
            trackingStatus: 'untracked'
        };
        const account = {
            ...base,
            platform,
            handle: agg.handle,
            url: platform === 'X' ? `https://x.com/${agg.handle}` : `https://www.linkedin.com/in/${agg.handle}`,
            displayName: agg.displayName || agg.handle,
            bio: agg.bio || '',
            followers: scoring.followers || 0,
            verified: !!agg.verified,
            authorityScore: scoring.authorityScore,
            nicheMatch: scoring.nicheMatch,
            finalScore: scoring.finalScore,
            matchedSignals: scoring.matchedSignals,
            tier: scoring.tier,
            postsSeen: scoring.postsSeen,
            maturePostMedianEngagement: scoring.medianPostEngagement,
            discoveredVia: 'post',
            enriched: false,
            verificationStatus: 'card-only'
        };
        if (existingIdx >= 0) activeMission.results[existingIdx] = account;
        else { activeMission.results.push(account); published++; }
    }
    activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
    await persistMission();
    return published;
}

// ── REDDIT SCORING ──
// For subreddits, our metric stack is:
//   subscribers           → community size (like followers)
//   weeklyMedianEngagement → MEDIAN (ups+comments) on top posts of past week
//                            → "is this community alive RIGHT NOW"
//   accountsActive        → people online (kept as a secondary signal)
//   ageDays               → maturity / trust signal
//   public_description    → niche-match keyword target
// Weights (engagement-led):
//   weekly engagement intensity   45  ← dominant aliveness signal
//   niche match                   25
//   authority (size)              10
//   age maturity                  10
//   verified bonus                 0 (subreddits don't carry it)
//   accounts_active ratio (online) 10
function scoreRedditSubreddit(profile, filters) {
    const subs = profile.followers || 0;
    const weekly = typeof profile.weeklyMedianEngagement === 'number' ? profile.weeklyMedianEngagement : 0;
    const active = profile.accountsActive || 0;

    // Weekly engagement intensity — the headline "is this sub alive" signal.
    // log10(1+x)·100/3 maps 1→0, 1000→~100, smooth in between.
    let weeklyEngagementScore = 0;
    if (weekly > 0) {
        weeklyEngagementScore = Math.min(100, Math.round(Math.log10(weekly + 1) * (100 / 3)));
    }

    // Authority: log scale on subscribers — now a minor signal.
    const authority = subs === 0 ? 0 : Math.min(100, Math.log10(subs + 1) * 18);

    // Niche match — bio + display name.
    const { match: nicheMatch, kwHits, totalKw } = _nicheMatch(
        [profile.bio, profile.displayName, profile.handle].filter(Boolean).join(' '),
        filters
    );

    // Accounts-active ratio kept as secondary input.
    let activityScore = 0;
    if (subs > 0 && active >= 0) {
        const pct = (active / subs) * 100;
        activityScore = Math.min(100, Math.log10(pct * 50 + 1) * 50);
    }

    // Age maturity.
    let ageScore = 50;
    if (typeof profile.ageDays === 'number') {
        ageScore = profile.ageDays >= 365 ? 100 : Math.round((profile.ageDays / 365) * 100);
    }

    const finalScore = Math.round(
        weeklyEngagementScore * 0.45 +
        nicheMatch * 0.25 +
        authority * 0.10 +
        ageScore * 0.10 +
        activityScore * 0.10
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (weekly > 0) matchedSignals.push(`~${weekly} engagement/top post (7d)`);
    if (subs > 0) {
        const fmt = subs >= 1e6 ? `${(subs/1e6).toFixed(1)}M` : subs >= 1e3 ? `${(subs/1e3).toFixed(1)}K` : `${subs}`;
        matchedSignals.push(`${fmt} subscribers`);
    }
    if (active > 0) matchedSignals.push(`${active} online now`);
    if (typeof profile.ageDays === 'number' && profile.ageDays >= 365) {
        matchedSignals.push(`Established (${Math.round(profile.ageDays / 365)}y)`);
    }

    return {
        authorityScore: Math.round(authority),
        nicheMatch,
        finalScore,
        matchedSignals,
        recentPostCount: null,
        maturePostMedianEngagement: weekly || null,
        daysSinceLastPost: null,
        tier: finalScore >= 85 ? 'S' : finalScore >= 70 ? 'A' : finalScore >= 50 ? 'B' : 'C',
        verificationStatus: 'verified'
    };
}

// Fetch /r/<sub>/top.json?t=week&limit=25 → median (ups + num_comments)
// across the past week's top posts. This is the "is this community alive
// RIGHT NOW" signal, far more predictive than subscriber count or
// accounts_active. Used both as the dominant scoring input and as the
// engagement-floor gate that drops dead subs entirely.
async function fetchSubredditWeeklyMedianEngagement(name) {
    try {
        const res = await fetch(
            `https://www.reddit.com/r/${encodeURIComponent(name)}/top.json?t=week&limit=25`,
            { headers: { 'Accept': 'application/json', 'User-Agent': 'ViraholicAccountFinder/1.0' } }
        );
        if (!res.ok) return null;
        const json = await res.json();
        const posts = json?.data?.children || [];
        if (!posts.length) return 0;
        const engagements = posts
            .map(p => (p?.data?.ups || 0) + (p?.data?.num_comments || 0))
            .filter(n => typeof n === 'number')
            .sort((a, b) => a - b);
        if (!engagements.length) return 0;
        const mid = Math.floor(engagements.length / 2);
        return engagements.length % 2
            ? engagements[mid]
            : Math.round((engagements[mid - 1] + engagements[mid]) / 2);
    } catch (e) {
        console.warn(DISC_TAG, `[reddit.top] r/${name} failed: ${e.message}`);
        return null;
    }
}

// Fetch /r/<sub>/about.json + /r/<sub>/top.json from the background. Both
// are public endpoints, work without auth, and are the safest way to get
// clean subreddit metrics without any DOM scraping. about.json gives
// structural facts (size, age, description); top.json gives REAL aliveness.
async function enrichSubredditMetrics(handle) {
    const name = handle.replace(/^r\//i, '').trim();
    if (!name) return null;
    try {
        const [aboutRes, weeklyMedian] = await Promise.all([
            fetch(`https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'ViraholicAccountFinder/1.0' }
            }),
            fetchSubredditWeeklyMedianEngagement(name)
        ]);
        if (!aboutRes.ok) {
            console.warn(DISC_TAG, `[reddit.enrich] r/${name} about returned ${aboutRes.status}`);
            return null;
        }
        const json = await aboutRes.json();
        const d = json?.data || {};
        const createdMs = d.created_utc ? d.created_utc * 1000 : null;
        const ageDays = createdMs ? Math.floor((Date.now() - createdMs) / 86400000) : null;
        return {
            displayName: d.display_name_prefixed || handle,
            bio: (d.public_description || d.description || '').slice(0, 500),
            followers: d.subscribers || 0,
            // Median weekly post engagement is the dominant aliveness signal.
            // We also keep accounts_active around (UI shows "X online now")
            // but it's a secondary fact, not the scoring input.
            weeklyMedianEngagement: weeklyMedian,
            accountsActive: typeof d.accounts_active === 'number' ? d.accounts_active : null,
            // For UI parity (we still surface the field name) but engagement
            // rate is now recomputed in scoreRedditSubreddit using the better
            // weekly-median signal.
            maturePostMedianEngagement: weeklyMedian,
            engagementRate: d.subscribers > 0 && typeof weeklyMedian === 'number'
                ? +((weeklyMedian / d.subscribers) * 100).toFixed(2)
                : 0,
            ageDays,
            avatar: d.community_icon?.split('?')[0] || d.icon_img?.split('?')[0] || '',
            isOver18: !!d.over18,
            verified: false
        };
    } catch (e) {
        console.warn(DISC_TAG, `[reddit.enrich] r/${name} failed: ${e.message}`);
        return null;
    }
}

function scoreLinkedInVerified(profile, filters, candidate) {
    const f = profile.followers || 0;
    const authority = _authorityFromFollowers(f);

    const haystack = [
        profile.bio, profile.about, profile.displayName,
        candidate?.bio, candidate?.samplePost
    ].filter(Boolean).join(' ');
    const { match: nicheMatch, kwHits, totalKw } = _nicheMatch(haystack, filters);

    // Recency: 100 if posted in last 24h, scaled linearly down to 0 at 14d.
    // Neutral 50 if no post data at all (could be a private/locked profile).
    let recencyScore;
    if (typeof profile.daysSinceLastPost !== 'number' || profile.daysSinceLastPost === null) {
        recencyScore = 50;
    } else if (profile.daysSinceLastPost <= 1) {
        recencyScore = 100;
    } else if (profile.daysSinceLastPost >= 14) {
        recencyScore = 0;
    } else {
        recencyScore = Math.round(100 - ((profile.daysSinceLastPost - 1) / 13) * 100);
    }

    // Mature-post engagement: median (reactions+comments) on posts ≥3d old.
    // Log-scaled so the gap from 10→100 matters as much as 100→1000.
    let engagementScore;
    if (profile.maturePostMedianEngagement === null || profile.maturePostMedianEngagement === undefined) {
        engagementScore = 50; // neutral midpoint when no mature posts to read
    } else if (profile.maturePostMedianEngagement <= 0) {
        engagementScore = 0;
    } else {
        // log10(1)=0 → log10(1000)=3. Map 0..3 onto 0..100.
        engagementScore = Math.min(100, Math.round(Math.log10(profile.maturePostMedianEngagement + 1) * (100 / 3)));
    }

    // Engagement RATE: mature-post engagement normalized by follower count.
    // This is the gold-standard influencer-marketing metric — far better
    // than raw engagement volume, which just rewards big accounts.
    let engagementRateScore = 50;
    if (typeof profile.maturePostMedianEngagement === 'number' && profile.maturePostMedianEngagement > 0 && f > 0) {
        const rate = (profile.maturePostMedianEngagement / f) * 100; // %
        // 0% → 0, 5%+ → 100, linear.
        engagementRateScore = Math.min(100, Math.round(rate * 20));
    } else if (profile.maturePostMedianEngagement === 0) {
        engagementRateScore = 0;
    }

    const verifiedBonus = profile.verified ? 5 : 0;

    // ── ENGAGEMENT-LED WEIGHTS ───────────────────────────────────────
    // Engagement rate is the strongest predictor of "audience pays
    // attention" → give it 40. Raw engagement-volume (logged) stays as
    // a smaller signal at 5 because it's still useful as a tiebreaker.
    const finalScore = Math.round(
        authority * 0.10 +
        nicheMatch * 0.25 +
        engagementRateScore * 0.40 +
        engagementScore * 0.05 +
        recencyScore * 0.15 +
        verifiedBonus
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (profile.verified) matchedSignals.push('Verified');
    if (typeof profile.maturePostMedianEngagement === 'number' && profile.maturePostMedianEngagement > 0 && f > 0) {
        const rate = (profile.maturePostMedianEngagement / f) * 100;
        if (rate >= 0.5) matchedSignals.push(`${rate.toFixed(2)}% engagement rate`);
    }
    if (f > 10000) matchedSignals.push(`${f >= 1e6 ? (f / 1e6).toFixed(1) + 'M' : (f / 1e3).toFixed(1) + 'K'} followers`);
    if (typeof profile.daysSinceLastPost === 'number') {
        if (profile.daysSinceLastPost < 1) matchedSignals.push('Posted today');
        else if (profile.daysSinceLastPost < 3) matchedSignals.push(`Active ${Math.round(profile.daysSinceLastPost)}d ago`);
        else if (profile.daysSinceLastPost < 14) matchedSignals.push(`Last post ${Math.round(profile.daysSinceLastPost)}d ago`);
        else matchedSignals.push(`Dormant (${Math.round(profile.daysSinceLastPost)}d)`);
    }
    if (typeof profile.maturePostMedianEngagement === 'number' && profile.maturePostMedianEngagement > 0) {
        matchedSignals.push(`~${profile.maturePostMedianEngagement} median engagement`);
    }

    const incomplete = (
        (profile.daysSinceLastPost === null || profile.daysSinceLastPost === undefined) &&
        (profile.maturePostMedianEngagement === null || profile.maturePostMedianEngagement === undefined)
    );

    return {
        authorityScore: Math.round(authority),
        nicheMatch,
        finalScore,
        matchedSignals,
        recentPostCount: profile.recentPostCount || 0,
        maturePostMedianEngagement: profile.maturePostMedianEngagement,
        daysSinceLastPost: profile.daysSinceLastPost,
        tier: finalScore >= 85 ? 'S' : finalScore >= 70 ? 'A' : finalScore >= 50 ? 'B' : 'C',
        verificationStatus: incomplete ? 'incomplete' : 'verified'
    };
}

// Filter check that does NOT gate inclusion — returns the list of reasons
// the account fails to match the user's filters. Used for LinkedIn so the
// user sees every found account along with why it's a weaker match.
function describeFilterMismatch(profile, filters) {
    const reasons = [];
    if (filters.minFollowers && profile.followers > 0 && profile.followers < filters.minFollowers) {
        reasons.push(`only ${profile.followers} followers (need ${filters.minFollowers}+)`);
    }
    if (filters.maxFollowers && profile.followers > 0 && profile.followers > filters.maxFollowers) {
        reasons.push(`${profile.followers} followers (over ${filters.maxFollowers} cap)`);
    }
    if (filters.verifiedOnly && !profile.verified) {
        reasons.push('not verified');
    }
    if (filters.minEngagementRate && (profile.engagementRate || 0) < filters.minEngagementRate) {
        reasons.push(`${(profile.engagementRate || 0).toFixed(1)}% engagement (need ${filters.minEngagementRate}%+)`);
    }
    if (profile.followers > 0) {
        const tierMap = {
            nano: [0, 5000], micro: [5000, 50000], mid: [50000, 250000],
            macro: [250000, 1000000], mega: [1000000, Infinity], all: [0, Infinity]
        };
        const [lo, hi] = tierMap[filters.authorityLevel] || tierMap.all;
        if (profile.followers < lo || profile.followers > hi) {
            reasons.push(`outside ${filters.authorityLevel} tier`);
        }
    }
    return reasons;
}

function classifyTier(account) {
    const score = account.finalScore;
    if (score >= 85) return 'S';
    if (score >= 70) return 'A';
    if (score >= 50) return 'B';
    return 'C';
}

function scoreAccount(profile, filters, candidate) {
    // ── NEW WEIGHTS (engagement-led) ─────────────────────────────────
    // Authority (followers) 10  ·  Niche match 25  ·  Engagement rate 40
    // Card engagement 5  ·  Recency 15  ·  Verified bonus 5
    //
    // The old rubric weighted authority+niche at 40+40 with engagement only
    // adding a small bonus. That made follower count the dominant signal
    // even though follower count is famously a vanity metric. The new
    // weights make engagement rate the lead — that's the actual predictor
    // of "this account's audience pays attention".

    const f = profile.followers || 0;
    const authority = f === 0 ? 0 : Math.min(100, Math.log10(f + 1) * 18);

    const haystack = [
        profile.bio, profile.about, profile.displayName,
        profile.samplePost, candidate?.samplePost,
        ...(profile.sampleHooks || [])
    ].filter(Boolean).join(' ').toLowerCase();
    let kwHits = 0;
    let totalKw = 0;
    (filters.keywords || []).forEach(kw => {
        if (typeof kw !== 'string' || !kw.trim()) return;
        totalKw++;
        if (haystack.includes(kw.trim().toLowerCase())) kwHits++;
    });
    (filters.hashtags || []).forEach(tag => {
        if (typeof tag !== 'string' || !tag.trim()) return;
        totalKw++;
        if (haystack.includes(tag.trim().toLowerCase().replace('#', ''))) kwHits++;
    });
    const nicheMatch = totalKw > 0 ? Math.round((kwHits / totalKw) * 100) : 50;

    // Engagement-rate sub-score: 0% → 0, 5%+ → 100. Linear in between.
    // Engagement rates above 5% are top-decile on any platform; cap at 100.
    const er = profile.engagementRate || 0;
    const engagementRateScore = Math.min(100, Math.round(er * 20));

    // Card-engagement sub-score: when the candidate was discovered from a
    // post (Posts tab / seed expansion), its cardEngagement.total tells us
    // EXACTLY how that post performed — a real signal that doesn't depend
    // on the profile's overall engagement rate. Neutral 50 when missing.
    const cardTotal = candidate?.cardEngagement?.total || 0;
    let cardScore = 50;
    if (cardTotal > 0) {
        // log10(1)=0, log10(1000)=3 → map 0..3 to 0..100
        cardScore = Math.min(100, Math.round(Math.log10(cardTotal + 1) * (100 / 3)));
    }

    // Recency sub-score: 0 days = 100, 14+ days = 0, linear in between.
    let recencyScore = 50;
    if (profile.lastActive) {
        const days = Math.max(0, (Date.now() - new Date(profile.lastActive).getTime()) / 86400000);
        recencyScore = days >= 14 ? 0 : Math.round(100 - (days / 14) * 100);
    }

    const verifiedBonus = profile.verified ? 5 : 0;

    const finalScore = Math.round(
        authority * 0.10 +
        nicheMatch * 0.25 +
        engagementRateScore * 0.40 +
        cardScore * 0.05 +
        recencyScore * 0.15 +
        verifiedBonus
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (profile.verified) matchedSignals.push('Verified');
    if (er > 2) matchedSignals.push(`${er.toFixed(1)}% engagement rate`);
    if (cardTotal > 0) matchedSignals.push(`Post: ${cardTotal} engagements`);
    if (f > 10000) matchedSignals.push(`${f >= 1e6 ? (f/1e6).toFixed(1)+'M' : (f/1e3).toFixed(1)+'K'} followers`);
    if (profile.lastActive) {
        const days = (Date.now() - new Date(profile.lastActive).getTime()) / 86400000;
        if (days < 3) matchedSignals.push('Active recently');
    }

    return {
        authorityScore: Math.round(authority),
        nicheMatch,
        finalScore,
        matchedSignals,
        tier: classifyTier({ finalScore })
    };
}

function passesFilters(profile, filters) {
    // Hard filters — only enforce if the user explicitly set them AND we have data
    if (filters.minFollowers && profile.followers > 0 && profile.followers < filters.minFollowers) return false;
    if (filters.maxFollowers && profile.followers > 0 && profile.followers > filters.maxFollowers) return false;
    if (filters.verifiedOnly && !profile.verified) return false;
    if (filters.minEngagementRate && (profile.engagementRate || 0) < filters.minEngagementRate) return false;

    // Authority tier check — IMPORTANT: only enforce when followers > 0.
    // If the scrape failed to read the count (DOM drift, X selector broke),
    // followers is 0. Silently rejecting all of those would zero out the
    // entire result set. Better to let them pass and let scoring penalize.
    if (profile.followers > 0) {
        const tierMap = {
            nano: [0, 5000],
            micro: [5000, 50000],
            mid: [50000, 250000],
            macro: [250000, 1000000],
            mega: [1000000, Infinity],
            all: [0, Infinity]
        };
        const [lo, hi] = tierMap[filters.authorityLevel] || tierMap.all;
        if (profile.followers < lo || profile.followers > hi) return false;
    }

    // Exclude keywords (user-configured exclusions, applied AFTER scraping)
    if (filters.excludeKeywords?.length) {
        const hay = [profile.bio, profile.about, profile.displayName, profile.samplePost].filter(Boolean).join(' ').toLowerCase();
        for (const ex of filters.excludeKeywords) {
            if (typeof ex !== 'string' || !ex.trim()) continue;
            if (hay.includes(ex.trim().toLowerCase())) return false;
        }
    }

    return true;
}

async function getTrackedUrls() {
    const r = await chrome.storage.local.get(['answerly_creator_configs']);
    const list = r.answerly_creator_configs || [];
    return new Set(list.map(c => c.url?.split('?')[0]?.replace(/\/$/, '')));
}

// ============================================================
// VISIBILITY SCORING from search-card data only (no profile visit)
// ============================================================
// This is the PRIMARY scoring path. Search cards already expose enough to rank
// accounts by their actual visibility in the niche — that's the entire job.
// Profile visits are reserved for the optional "deep" enrichment mode.
function scoreFromCard(card, filters) {
    const f = typeof card.followerHint === 'number' ? card.followerHint : 0;
    const authority = f === 0 ? 25 : Math.min(100, Math.log10(f + 1) * 18);

    const haystack = [
        card.bio, card.displayName, card.samplePost, card.handle
    ].filter(Boolean).join(' ').toLowerCase();

    let kwHits = 0, totalKw = 0;
    (filters.keywords || []).forEach(kw => {
        if (typeof kw !== 'string' || !kw.trim()) return;
        totalKw++;
        if (haystack.includes(kw.trim().toLowerCase())) kwHits++;
    });
    (filters.hashtags || []).forEach(tag => {
        if (typeof tag !== 'string' || !tag.trim()) return;
        totalKw++;
        if (haystack.includes(tag.trim().toLowerCase().replace('#', ''))) kwHits++;
    });
    const nicheMatch = totalKw > 0 ? Math.round((kwHits / totalKw) * 100) : 60;

    const verifiedBonus = card.verified ? 8 : 0;
    const postSignalBonus = card.discoveredVia === 'post' ? 6 : 0;
    const bioBonus = card.bio && card.bio.length > 30 ? 3 : 0;

    const finalScore = Math.round(
        authority * 0.45 +
        nicheMatch * 0.40 +
        verifiedBonus +
        postSignalBonus +
        bioBonus
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (card.verified) matchedSignals.push('Verified');
    if (f > 0) {
        const fmt = f >= 1e6 ? (f / 1e6).toFixed(1) + 'M' : f >= 1e3 ? (f / 1e3).toFixed(1) + 'K' : `${f}`;
        matchedSignals.push(`${fmt} followers`);
    }
    if (card.discoveredVia === 'post') matchedSignals.push('Active poster');

    return {
        followers: f,
        authorityScore: Math.round(authority),
        nicheMatch,
        finalScore,
        matchedSignals,
        tier: finalScore >= 85 ? 'S' : finalScore >= 70 ? 'A' : finalScore >= 50 ? 'B' : 'C'
    };
}

// Card-level pre-filter: drop candidates we can already reject without a profile visit.
function passesCardFilters(card, filters) {
    if (filters.verifiedOnly && !card.verified) return false;
    if (typeof card.followerHint === 'number') {
        if (filters.minFollowers && card.followerHint < filters.minFollowers) return false;
        if (filters.maxFollowers && card.followerHint > filters.maxFollowers) return false;
        const tierMap = {
            nano: [0, 5000], micro: [5000, 50000], mid: [50000, 250000],
            macro: [250000, 1000000], mega: [1000000, Infinity], all: [0, Infinity]
        };
        const [lo, hi] = tierMap[filters.authorityLevel] || tierMap.all;
        if (card.followerHint < lo || card.followerHint > hi) return false;
    }
    if (filters.excludeKeywords?.length) {
        const hay = [card.bio, card.displayName, card.samplePost].filter(Boolean).join(' ').toLowerCase();
        for (const ex of filters.excludeKeywords) {
            if (typeof ex !== 'string' || !ex.trim()) continue;
            if (hay.includes(ex.trim().toLowerCase())) return false;
        }
    }
    return true;
}

// ============================================================
// SEED EXPANSION
// ============================================================
// Take a user-supplied seed (@handle / list URL / hashtag / subreddit name)
// and surface the people engaging with it. Resolves to the platform's most
// engagement-rich page for that seed, scrapes it with the standard
// posts-tab scraper, and returns the resulting candidates after applying
// the same engagement-floor + tracked-url filters the keyword path uses.
//
// Note: seed expansion piggybacks on the existing DOM scrapers — modern
// social platforms use the same card markup on profile/feed/list/sub
// pages as they do on search results, so scrapeXSearch /
// scrapeLinkedInSearch / scrapeRedditSearch all "just work" on these
// pages with the cardEngagement counters they already read.
function buildSeedUrl(platform, seed) {
    const v = (seed || '').trim();
    if (!v) return null;
    if (platform === 'X') {
        if (/^https?:\/\//i.test(v)) return v; // list URL or full profile URL
        const h = v.replace(/^@/, '');
        if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
        return `https://x.com/${h}`;
    }
    if (platform === 'LinkedIn') {
        if (/^https?:\/\//i.test(v)) return v; // post URL, content-search URL, etc.
        // Bare keyword/hashtag → deterministic content search (Top match), so the
        // seed page is full of attributable post authors rather than a personalized feed.
        const kw = v.replace(/^#/, '');
        const params = new URLSearchParams();
        params.set('keywords', kw);
        params.set('origin', 'GLOBAL_SEARCH_HEADER');
        params.set('sortBy', '"relevance"');
        return `https://www.linkedin.com/search/results/content/?${params.toString()}`;
    }
    if (platform === 'Reddit') {
        const name = v.replace(/^\/?r\//i, '').replace(/\/$/, '');
        if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
        // Top-of-week is the most engagement-dense page on any subreddit.
        return `https://www.reddit.com/r/${encodeURIComponent(name)}/top/?t=week`;
    }
    return null;
}

async function expandFromSeed(platform, seed, tabId, trackedUrls, seenHandles) {
    const url = buildSeedUrl(platform, seed);
    if (!url) {
        logMission('warn', `Seed "${seed}" did not resolve to a valid URL — skipping`, platform);
        return [];
    }

    logMission('info', `Seed expand → ${seed} → ${url}`, platform);
    await patchProgress({ phase: `Seed expand: ${seed}`, currentPlatform: platform });

    try {
        await navigateTab(tabId, url);
    } catch (e) {
        logMission('error', `Seed navigation failed: ${e.message}`, platform);
        return [];
    }
    // Heavier hydration: seed pages tend to be feed-style and need a moment
    // for the recommendations/algorithm-feed to render in.
    await interruptibleSleep(gauss(6000, 1200));

    const block = await sendToAgent(tabId, { type: 'DISCOVERY_DETECT_BLOCK' });
    if (block?.blocked) {
        logMission('warn', `Seed page blocked: ${block.type} (${block.indicator})`, platform);
        return [];
    }
    await sendToAgent(tabId, { type: 'DISCOVERY_HUMANIZE_ENTRY' });
    await recordAction();

    // Re-use the posts-tab scrape path — same DOM patterns apply on profile
    // / hashtag-feed / subreddit pages as on search results.
    const result = await sendToAgent(tabId, {
        type: 'DISCOVERY_SCRAPE_POSTS',
        maxCandidates: 40
    });
    if (result?.error) {
        logMission('warn', `Seed scrape error: ${result.error}`, platform);
        return [];
    }
    let candidates = (result?.candidates || []).filter(c => !seenHandles.has(c.handle));
    candidates.forEach(c => seenHandles.add(c.handle));

    // Apply the same engagement floor used in the keyword path.
    const floor = activeMission.filters.engagementFloor || 'any';
    if (floor !== 'any') {
        const th = engagementThresholds(platform, floor);
        const minTotal = platform === 'X' ? th.card_total
                       : platform === 'LinkedIn' ? th.reactions
                       : platform === 'Reddit' ? th.post_upvotes
                       : 0;
        if (minTotal > 0) {
            const before = candidates.length;
            candidates = candidates.filter(c => {
                if (c.accountType === 'subreddit') return true;
                if (!c.cardEngagement) return true;
                return (c.cardEngagement.total || 0) >= minTotal;
            });
            const dropped = before - candidates.length;
            if (dropped > 0) {
                logMission('info', `[seed-expand engagement-floor] dropped ${dropped}/${before} below "${floor}" (need ≥${minTotal})`, platform);
            }
        }
    }

    // Already-tracked filter (same logic as keyword path).
    candidates = candidates.filter(c => {
        const cleanUrl = c.url.split('?')[0].replace(/\/$/, '');
        return !trackedUrls.has(cleanUrl);
    });

    // Tag provenance so the UI can attribute these to seed expansion.
    candidates.forEach(c => { c.discoveredVia = 'seed-expand'; });
    return candidates;
}

// ============================================================
// LINKEDIN COMMENTER EXPANSION (deep mode)
// ============================================================
// Take the highest-engagement posts we already collected (their permalinks were
// captured during content scraping), OPEN THE POSTS (never profiles), and read
// who commented. People who comment on multiple top posts in the niche are very
// likely active creators themselves — we publish them as a secondary, clearly
// labeled signal ranked below the verified post-authors.
async function expandLinkedInCommenters(tabId) {
    const map = activeMission._authorAgg || {};
    // Collect candidate post URLs across all LinkedIn authors, best engagement first.
    const posts = [];
    for (const key of Object.keys(map)) {
        if (!key.startsWith('LinkedIn:')) continue;
        for (const p of (map[key].postUrls || [])) {
            if (p && p.url) posts.push(p);
        }
    }
    const seenUrl = new Set();
    const topPosts = posts
        .filter(p => (seenUrl.has(p.url) ? false : (seenUrl.add(p.url), true)))
        .sort((a, b) => (b.eng || 0) - (a.eng || 0))
        .slice(0, 8);

    if (topPosts.length === 0) {
        logMission('info', 'Commenter expansion: no post permalinks captured — skipping', 'LinkedIn');
        return;
    }
    logMission('info', `Commenter expansion: scanning ${topPosts.length} top post${topPosts.length !== 1 ? 's' : ''} for active commenters`, 'LinkedIn');

    const freq = {}; // handle → { count, displayName }
    const alreadyAuthor = new Set(
        activeMission.results.filter(r => r.platform === 'LinkedIn').map(r => r.handle)
    );

    for (const p of topPosts) {
        if (missionAborted) break;
        await enforceRateLimit();
        try {
            await navigateTab(tabId, p.url);
        } catch (e) {
            logMission('warn', `Commenter scan nav failed: ${e.message}`, 'LinkedIn');
            continue;
        }
        await interruptibleSleep(gauss(4500, 1000));
        const block = await sendToAgent(tabId, { type: 'DISCOVERY_DETECT_BLOCK' });
        if (block?.blocked) {
            logMission('warn', `Commenter scan blocked (${block.type}) — stopping expansion`, 'LinkedIn');
            break;
        }
        await recordAction();
        const res = await sendToAgent(tabId, { type: 'DISCOVERY_SCRAPE_COMMENTERS', maxCandidates: 30 });
        for (const c of (res?.candidates || [])) {
            if (!c.handle || alreadyAuthor.has(c.handle)) continue; // don't shadow real authors
            const e = freq[c.handle] || (freq[c.handle] = { count: 0, displayName: c.displayName });
            e.count++;
            if (c.displayName && c.displayName.length > (e.displayName || '').length) e.displayName = c.displayName;
        }
        await interruptibleSleep(gauss(6000, 1500));
    }

    // Publish commenters that showed up on ≥2 distinct top posts (cross-post
    // presence = genuine niche participant, not a one-off).
    const filters = activeMission.filters;
    let added = 0;
    for (const handle of Object.keys(freq)) {
        const f = freq[handle];
        if (f.count < 2) continue;
        if (activeMission.results.some(r => r.platform === 'LinkedIn' && r.handle === handle)) continue;
        const { match: nicheMatch } = _nicheMatch([f.displayName, handle].filter(Boolean).join(' '), filters);
        // Modest score: frequency-driven, capped well below post-authors.
        const finalScore = Math.min(60, 25 + f.count * 8 + Math.round(nicheMatch * 0.15));
        activeMission.results.push({
            id: `LinkedIn_${handle}_${Date.now()}`,
            platform: 'LinkedIn',
            handle,
            url: `https://www.linkedin.com/in/${handle}`,
            displayName: f.displayName || handle,
            bio: '',
            followers: 0,
            verified: false,
            authorityScore: 0,
            nicheMatch,
            finalScore,
            matchedSignals: [`Active commenter on ${f.count} top posts`],
            tier: finalScore >= 50 ? 'B' : 'C',
            discoveredVia: 'commenter',
            enriched: false,
            verificationStatus: 'commenter-signal',
            discoveredAt: nowIso(),
            trackingStatus: 'untracked'
        });
        added++;
    }
    if (added > 0) {
        activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
        await persistMission();
        logMission('success', `Commenter expansion added ${added} active niche commenter${added !== 1 ? 's' : ''}`, 'LinkedIn');
    } else {
        logMission('info', 'Commenter expansion: no commenter appeared on ≥2 top posts', 'LinkedIn');
    }
}

// ============================================================
// PLATFORM EXECUTION
// ============================================================
async function executePlatform(platform, queries, tabId) {
    if (missionAborted) throw new Error('Aborted');

    const trackedUrls = activeMission.filters.excludeAlreadyTracked
        ? await getTrackedUrls()
        : new Set();

    const seenHandles = new Set();
    let allCandidates = [];
    const deepMode = activeMission.mode === 'deep';
    let queryIndex = 0; // counts queries within this platform — for first-query speedup

    // Which tabs to search per platform.
    //
    // X & LinkedIn are now POSTS-FIRST and profile-free: we judge authors by the
    // engagement their posts earn, never by visiting their profile. When an
    // engagement floor is set (the default), we search the Posts tab ONLY — the
    // People tab returns accounts with no engagement signal, which is exactly the
    // "1 keyword, few followers" noise the user complained about. People tab is
    // kept only as a fallback when floor='any'.
    const floorSet = (activeMission.filters.engagementFloor || 'any') !== 'any';
    const tabsToSearch = platform === 'X'
            ? (floorSet ? ['live'] : ['live', 'user'])
        : platform === 'LinkedIn'
            ? (floorSet ? ['content'] : ['content', 'people'])
        // Reddit: surface communities (subreddits) FIRST — that's what we
        // publish as accounts. Then look at posts so we can extract more
        // subreddits from active discussions.
        : ['sr', 'link'];

    for (const queryObj of queries) {
        if (missionAborted) break;

        // Back-compat: planQueries used to return strings. Normalize.
        const q = (typeof queryObj === 'string')
            ? { type: 'keyword', value: queryObj }
            : queryObj;
        const query = q.value;

        // ─── Seed queries take a completely different path ───
        // Open the seed page, scrape its top-engagement posts, click into the
        // top N, scrape reactors/repliers as candidates. Returns the raw
        // candidate list which we merge into allCandidates via the same
        // pre-filter + push path the keyword branch uses.
        if (q.type === 'seed') {
            try {
                const seedCandidates = await expandFromSeed(platform, query, tabId, trackedUrls, seenHandles);
                if (seedCandidates && seedCandidates.length) {
                    allCandidates.push(...seedCandidates);
                    logMission('success', `Seed "${query}" yielded ${seedCandidates.length} candidates`, platform);
                } else {
                    logMission('warn', `Seed "${query}" yielded 0 candidates — page may be inaccessible or empty`, platform);
                }
            } catch (e) {
                logMission('error', `Seed expansion failed for "${query}": ${e.message}`, platform);
            }
            queryIndex++;
            continue;
        }

        for (const searchTab of tabsToSearch) {
            if (missionAborted) break;
            while (missionPaused && !missionAborted) await dsleep(500);

            await enforceRateLimit();

            const session = await checkSessionDuration();
            if (!session.ok) {
                logMission('warn', session.reason, platform);
                break;
            }

            let url;
            if (platform === 'X') url = buildXSearchUrl(activeMission.filters, query, searchTab);
            else if (platform === 'LinkedIn') url = buildLinkedInSearchUrl(activeMission.filters, query, searchTab);
            else if (platform === 'Reddit') url = buildRedditSearchUrl(activeMission.filters, query, searchTab);

            const tabLabel = (searchTab === 'live' || searchTab === 'content' || searchTab === 'link') ? 'Posts' : 'People';
            await patchProgress({ phase: `Searching "${query}" (${tabLabel}) on ${platform}`, currentPlatform: platform });
            // Log the actual URL we're about to open — surfaces whether the
            // engagement-floor operators (min_faves, sort=top, etc.) actually
            // made it into the query. Truncate so the log line stays readable.
            const urlHint = (url || '').slice(0, 140) + ((url || '').length > 140 ? '…' : '');
            logMission('info', `Query → ${query} [${tabLabel}] · ${urlHint}`, platform);

            try {
                await navigateTab(tabId, url);
            } catch (e) {
                logMission('error', `Navigation failed: ${e.message}`, platform);
                continue;
            }

            // First query of each platform: shorter hydration so the user sees
            // results within ~10-15s. Subsequent queries use full stealth pacing.
            const isFirstQuery = queryIndex === 0;
            const hydrationMs = isFirstQuery
                ? gauss(3000, 600)
                : platform === 'X' ? gauss(8000, 1500)
                : platform === 'LinkedIn' ? gauss(6500, 1200)
                : gauss(4500, 1000);
            logMission('info', `Hydrating SPA (${Math.round(hydrationMs/1000)}s)${isFirstQuery ? ' — fast path' : ''}...`, platform);
            await interruptibleSleep(hydrationMs);

            const block = await sendToAgent(tabId, { type: 'DISCOVERY_DETECT_BLOCK' });
            if (block?.blocked) {
                logMission('error', `${block.type.toUpperCase()} detected on ${tabLabel} tab — skipping this tab, keeping ${allCandidates.length} candidates collected so far`, platform);
                await patchStealth({
                    detected: true,
                    detectionReason: `${block.type} on ${platform}: ${block.indicator}`,
                    humanizedBehaviorScore: 30,
                    patternsDetected: [...(activeMission.stealth.patternsDetected || []), `${platform} ${block.type}`]
                });
                // Only set the cross-platform cooldown if it's a HARD block (captcha,
                // rate limit, account block) — login-walls just mean this tab is gated
                // for anonymous users, not that we should pause discovery globally.
                if (block.type === 'captcha' || block.type === 'rateLimit' || block.type === 'block') {
                    stealthCooldownUntil = Date.now() + gauss(900000, 300000);
                }
                // Skip THIS tab but keep going to the next one (and other queries).
                // Previously `return []` here wiped all preceding candidates from
                // other tabs/queries on this platform.
                continue;
            }

            await sendToAgent(tabId, { type: 'DISCOVERY_HUMANIZE_ENTRY' });
            await recordAction();

            // Calibrated to human behavior: a real user scrolls 20-40 results before moving on.
            // Going higher is bot-like and triggers rate limits.
            // LinkedIn gets a higher cap — users complained "accounts I see are
            // missing entirely" because the page returns 50+ cards in a single
            // search. The bot-detection risk is per-action, not per-DOM-read.
            const baseMax = activeMission.mode === 'volume' ? 50
                : activeMission.mode === 'deep' ? 35
                : 25;
            const maxPerQuery = platform === 'LinkedIn'
                ? Math.round(baseMax * 2.4)  // 60 / 84 / 120
                : baseMax;
            const isPostsTab = (searchTab === 'live' || searchTab === 'content' || searchTab === 'link');
            const result = await sendToAgent(tabId, {
                type: isPostsTab ? 'DISCOVERY_SCRAPE_POSTS' : 'DISCOVERY_SCRAPE_SEARCH',
                maxCandidates: maxPerQuery
            });

            if (result?.error) {
                logMission('warn', `Scrape error: ${result.error}`, platform);
                continue;
            }

            // Empty scrape — surface the reason loudly to the UI, not just logs.
            // This is the #1 user-visible failure mode (login wall, dom drift,
            // no-results query) and was previously buried in stealth log lines.
            if (!result?.candidates || result.candidates.length === 0) {
                const d = result?.diagnostic || {};

                // Sniff for login walls that detectBlock might have missed
                const titleLower = (d.pageTitle || '').toLowerCase();
                const bodyLower = (d.bodyTextSample || '').toLowerCase();
                const looksLikeLogin =
                    titleLower.includes('sign in') || titleLower.includes('log in') ||
                    bodyLower.includes("don't miss what's happening") ||
                    bodyLower.includes('see what people are saying') ||
                    bodyLower.includes('sign up for') ||
                    bodyLower.includes('join linkedin') ||
                    bodyLower.includes('to continue, log in');

                let reason;
                let level = 'warn';
                if (looksLikeLogin) {
                    reason = `${platform} requires you to log in. Open ${platform} in a normal tab, log in, then retry. The stealth window inherits your cookies.`;
                    level = 'error';
                    // Mark as a soft block so the user sees a clear alert
                    activeMission.stealth.detected = true;
                    activeMission.stealth.detectionReason = `Login required on ${platform}`;
                } else if (d.hydration?.noResults) {
                    reason = `${platform} returned "no results" for "${query}" — try broader keywords or remove hashtags`;
                    level = 'info';
                } else if (d.hydration?.timeout) {
                    reason = `${platform} took too long to load. Body sample: "${(d.bodyTextSample || '').slice(0, 100)}"`;
                } else if (d.userCellCount === 0 && d.primaryColumn === false) {
                    reason = `${platform} page loaded but no result containers found — selectors may need updating (DOM may have changed)`;
                } else {
                    reason = `0 candidates on ${platform} for "${query}" [${tabLabel}]. DOM cells=${d.userCellCount ?? '?'} title="${(d.pageTitle || '').slice(0,40)}"`;
                }

                logMission(level, reason, platform);

                // If it's clearly a login wall, abort this platform — no point retrying queries
                if (looksLikeLogin) {
                    logMission('warn', `Skipping remaining ${platform} queries until you log in`, platform);
                    return [];
                }
            }

            let candidates = (result?.candidates || []).filter(c => !seenHandles.has(c.handle));

            // ─── FALLBACK SCRAPE ───
            // If the structured scrape returned 0, try the brute-force fallback
            // that grabs ANY profile link from the page. Catches DOM drift,
            // selector breakage, and pages that don't render expected containers.
            if (candidates.length === 0) {
                logMission('warn', `Structured scrape empty — trying brute-force link extraction`, platform);
                const fb = await sendToAgent(tabId, { type: 'DISCOVERY_SCRAPE_FALLBACK' });
                if (fb?.candidates?.length > 0) {
                    candidates = fb.candidates.filter(c => !seenHandles.has(c.handle));
                    logMission('success', `Fallback found ${candidates.length} profile links — verification will fill in details`, platform);
                }
            }

            candidates.forEach(c => seenHandles.add(c.handle));

            // ─── ENGAGEMENT FLOOR PRE-FILTER ───
            // Drop candidates whose card-level engagement is below the user's
            // floor. Skipped when:
            //   • floor='any'      (no filter requested)
            //   • candidate has no cardEngagement (people-search cells don't
            //     carry counters — score-time engagementRate handles them)
            //   • candidate is a subreddit (Reddit publishes communities, not
            //     authors; subreddit aliveness is gated separately via top.json)
            const floor = activeMission.filters.engagementFloor || 'any';
            let droppedBelowFloor = 0;
            if (floor !== 'any') {
                const th = engagementThresholds(platform, floor);
                const minTotal = platform === 'X' ? th.card_total
                               : platform === 'LinkedIn' ? th.reactions
                               : platform === 'Reddit' ? th.post_upvotes
                               : 0;
                if (minTotal > 0) {
                    const before = candidates.length;
                    candidates = candidates.filter(c => {
                        if (c.accountType === 'subreddit') return true; // gated later via top.json
                        if (!c.cardEngagement) return true;              // no counters → leave for verification
                        return (c.cardEngagement.total || 0) >= minTotal;
                    });
                    droppedBelowFloor = before - candidates.length;
                    if (droppedBelowFloor > 0) {
                        logMission('info', `[engagement-floor] dropped ${droppedBelowFloor}/${before} below "${floor}" (need ≥${minTotal})`, platform);
                    }
                }
            }

            const candidatesCountBeforeTrackedFilter = candidates.length;
            const fresh = candidates.filter(c => {
                const cleanUrl = c.url.split('?')[0].replace(/\/$/, '');
                return !trackedUrls.has(cleanUrl);
            });
            const droppedByTrackedFilter = candidatesCountBeforeTrackedFilter - fresh.length;

            // Surface the actual list so the user sees who was discovered
            if (fresh.length > 0) {
                const sample = fresh.slice(0, 5).map(c => `@${c.handle}`).join(', ');
                const more = fresh.length > 5 ? ` +${fresh.length - 5} more` : '';
                logMission('success', `[${tabLabel}] Found ${candidates.length} (${fresh.length} fresh): ${sample}${more}`, platform);
            } else {
                logMission('success', `[${tabLabel}] Found ${candidates.length} candidates (${fresh.length} fresh)`, platform);
            }

            // ── LinkedIn diagnostic ──
            // When users say "accounts I see are missing entirely", surfacing
            // the raw-vs-captured breakdown tells them exactly what happened:
            // how many cards LinkedIn rendered, how many bare /in/ links we
            // saw, how many were already tracked, etc.
            if (platform === 'LinkedIn' && result?.diagnostic) {
                const d = result.diagnostic;
                const dropParts = [];
                if (d.dropReasons?.maxedOut) dropParts.push(`${d.dropReasons.maxedOut} skipped (cap of ${maxPerQuery})`);
                if (d.dropReasons?.duplicate) dropParts.push(`${d.dropReasons.duplicate} duplicates`);
                if (d.dropReasons?.noLink) dropParts.push(`${d.dropReasons.noLink} cards w/o profile link`);
                if (droppedByTrackedFilter) dropParts.push(`${droppedByTrackedFilter} already tracked`);
                logMission('info',
                    `[diag] LinkedIn: ${d.cardsFound} card${d.cardsFound !== 1 ? 's' : ''} + ${d.rawLinksFound} raw /in/ link${d.rawLinksFound !== 1 ? 's' : ''} → ${d.captured} captured${dropParts.length ? ' · ' + dropParts.join(', ') : ''}`,
                    platform
                );
            }
            await patchProgress({
                candidatesScanned: activeMission.progress.candidatesScanned + candidates.length,
                queriesCompleted: activeMission.progress.queriesCompleted + 1
            });

            allCandidates.push(...fresh);

            // ─── X & LINKEDIN: AGGREGATE BY AUTHOR + PUBLISH NOW (profile-free) ───
            // Post rows are folded into the mission's per-author map (median
            // engagement + consistency across queries), then every author is
            // (re)published with a card-only score. We NEVER visit profiles for
            // these platforms — the posts-tab data is the whole signal. This
            // both kills the "viewed your profile" footprint on LinkedIn and
            // makes results appear immediately, refining as more queries land.
            if ((platform === 'X' || platform === 'LinkedIn') && fresh.length > 0) {
                aggregateAuthorRows(platform, fresh, query);
                const pub = await publishAggregatedAuthors(platform, activeMission.filters);
                const totalAuthors = Object.keys(activeMission._authorAgg || {})
                    .filter(k => k.startsWith(platform + ':')).length;
                await patchProgress({ matched: activeMission.results.filter(r => r.platform === platform).length });
                logMission('success', `[${platform}] ${totalAuthors} unique post-author${totalAuthors !== 1 ? 's' : ''} aggregated (${pub} new this query) — scored by median post engagement`, platform);
            }

            // ─── REDDIT: PUBLISH SUBREDDITS NOW (with about.json enrichment) ───
            // For Reddit, we don't go through the verification (profile-visit)
            // phase at all for subreddits — about.json gives us everything in
            // one fetch. Users in the search results still go through the
            // normal verification flow (they're rare in our queries anyway).
            if (platform === 'Reddit' && fresh.length > 0) {
                const subs = fresh.filter(c => c.accountType === 'subreddit');
                if (subs.length > 0) {
                    logMission('info', `Enriching ${subs.length} subreddit${subs.length > 1 ? 's' : ''} via about.json…`, platform);
                    // Enrich in small parallel batches to respect Reddit's rate limit (60/min anon).
                    const BATCH = 5;
                    for (let i = 0; i < subs.length; i += BATCH) {
                        const batch = subs.slice(i, i + BATCH);
                        const enriched = await Promise.all(batch.map(c => enrichSubredditMetrics(c.handle)));
                        for (let j = 0; j < batch.length; j++) {
                            const c = batch[j];
                            const meta = enriched[j];
                            // Already-published handle? skip (mission may have run twice)
                            if (activeMission.results.some(r => r.platform === 'Reddit' && r.handle.toLowerCase() === c.handle.toLowerCase())) continue;

                            // Build profile object — merge enriched data with the
                            // search-card fallback so we always have something to publish.
                            const profile = {
                                handle: c.handle,
                                accountType: 'subreddit',
                                displayName: meta?.displayName || c.displayName,
                                bio: meta?.bio || c.bio || '',
                                followers: meta?.followers ?? 0,
                                verified: false,
                                avatar: meta?.avatar || '',
                                engagementRate: meta?.engagementRate ?? 0,
                                maturePostMedianEngagement: meta?.maturePostMedianEngagement ?? null,
                                weeklyMedianEngagement: meta?.weeklyMedianEngagement ?? null,
                                accountsActive: meta?.accountsActive ?? null,
                                ageDays: meta?.ageDays ?? null,
                                isOver18: meta?.isOver18 ?? false,
                                platform: 'Reddit'
                            };

                            // ─── SUBREDDIT ENGAGEMENT-FLOOR GATE ───
                            // Drop dead subs whose median top-week post is
                            // below the user's engagement floor. This is the
                            // Reddit-specific interpretation of "is this
                            // community worth engaging with right now".
                            const floor = activeMission.filters.engagementFloor || 'any';
                            if (floor !== 'any' && meta && typeof meta.weeklyMedianEngagement === 'number') {
                                const min = engagementThresholds('Reddit', floor).sub_weekly_median || 0;
                                if (min > 0 && meta.weeklyMedianEngagement < min) {
                                    logMission('info', `[engagement-floor] dropping ${c.handle} — top-week median ${meta.weeklyMedianEngagement} < ${min} required for "${floor}"`, platform);
                                    continue;
                                }
                            }

                            const scoring = scoreRedditSubreddit(profile, activeMission.filters);
                            const account = {
                                id: `Reddit_${c.handle}_${Date.now()}`,
                                platform: 'Reddit',
                                ...profile,
                                ...scoring,
                                subredditWeeklyMedianEngagement: profile.weeklyMedianEngagement || undefined,
                                discoveredAt: nowIso(),
                                trackingStatus: 'untracked',
                                enriched: !!meta,
                                // If about.json succeeded we're verified; if not, mark incomplete
                                // so the user knows the metrics couldn't be fetched.
                                verificationStatus: meta ? 'verified' : 'incomplete',
                                url: c.url
                            };
                            activeMission.results.push(account);
                            await patchProgress({ matched: (activeMission.progress.matched || 0) + 1 });
                        }
                        // Tiny inter-batch pause so we don't burst-fire fetches
                        await dsleep(800);
                    }
                    activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
                    await persistMission();
                    const published = activeMission.results.filter(r => r.platform === 'Reddit' && r.accountType === 'subreddit').length;
                    logMission('success', `Published ${published} subreddit${published === 1 ? '' : 's'} (of ${subs.length} discovered) with engagement metrics`, platform);
                }
                // Reddit users still flow through normal verification queue below
                // (they're scraped from search but enriched by visiting the profile).
            }

            // ─── COLLECT FOR VERIFICATION ───
            // Candidates here are just usernames + bio snippets from search cards.
            // We collect them in allCandidates and visit each profile in the
            // verification phase below to read their REAL KPIs (follower count,
            // engagement, verified status). For X/Reddit, only profiles that
            // match the user's filters get published to activeMission.results.
            // For LinkedIn, results were already published above and verification
            // upgrades them in place.
            queryIndex++;

            // Inter-search pause: first query is short (~10s) so the user sees
            // results from the second query within ~30s. Later queries pace longer.
            const pauseMs = isFirstQuery ? gauss(10000, 2500) : gauss(35000, 12000);
            await sendToAgent(tabId, { type: 'DISCOVERY_IDLE_BEHAVIOR', duration: gauss(4000, 1000) });
            await recordAction();
            await interruptibleSleep(pauseMs);
        }
    }

    // ─── X & LINKEDIN: PROFILE-FREE — NO VERIFICATION PHASE ───
    // Authors were aggregated + published from post cards during the search
    // loop. We deliberately do NOT visit profiles (the Posts search is enough
    // for X, and on LinkedIn visiting profiles leaves a "viewed your profile"
    // footprint we want to avoid). In deep mode on LinkedIn we widen the net by
    // scraping COMMENTERS on the top posts (opening posts, not profiles), then
    // re-publish. Then we return.
    if (platform === 'X' || platform === 'LinkedIn') {
        if (platform === 'LinkedIn' && deepMode) {
            try {
                await expandLinkedInCommenters(tabId);
            } catch (e) {
                logMission('warn', `Commenter expansion skipped: ${e.message}`, platform);
            }
        }
        const finalCount = activeMission.results.filter(r => r.platform === platform).length;
        logMission('success', `${platform} complete — ${finalCount} post-author${finalCount !== 1 ? 's' : ''} published (profile-free, scored on post engagement)`, platform);
        await persistMission();
        return activeMission.results.filter(r => r.platform === platform);
    }

    // ─── VERIFICATION PHASE (Reddit users only) ───
    // For every candidate username collected from search, visit their profile,
    // read their REAL KPIs (follower count, engagement, verified, bio), then
    // check against the user's filters. Only profiles that pass are published
    // to activeMission.results. This is the core value of the extension.
    if (allCandidates.length === 0) {
        // Reddit can legitimately end here with zero (subreddit-only flow
        // already published everything via about.json). For other platforms,
        // an empty list is the broken-scrape symptom.
        if (platform === 'Reddit') {
            logMission('info', `${platform} search complete — subreddits published directly via about.json`, platform);
            return [];
        }
        logMission('error', `Found 0 usernames on ${platform}. Nothing to verify. Most likely: not logged in, narrow keywords, or DOM changed.`, platform);
        return [];
    }

    // Reddit subreddits were already enriched + published via about.json
    // during search — they don't need a profile-visit. Strip them out so we
    // don't waste a profile visit on them.
    if (platform === 'Reddit') {
        const before = allCandidates.length;
        allCandidates = allCandidates.filter(c => c.accountType !== 'subreddit');
        if (allCandidates.length < before) {
            logMission('info', `Skipping profile-visit for ${before - allCandidates.length} subreddit${before - allCandidates.length > 1 ? 's' : ''} — already enriched`, platform);
        }
    }
    if (allCandidates.length === 0) {
        // Reddit-subreddit-only run is the normal case for community search;
        // nothing more to do. Don't treat this as an error.
        logMission('info', `Verification queue empty for ${platform} — search published everything directly`, platform);
        return [];
    }

    // Surface the full candidate list to the user before verification runs
    const handleList = allCandidates.slice(0, 10).map(c => `@${c.handle}`).join(', ');
    const moreCount = allCandidates.length > 10 ? ` (+${allCandidates.length - 10} more)` : '';
    logMission('info', `Search done. Visiting ${allCandidates.length} profiles to read their KPIs: ${handleList}${moreCount}`, platform);

    // ─── PRE-FILTER ───
    // Reject candidates that we already KNOW won't pass filters (saves profile visits).
    // We use what's visible from the search card (followerHint, verified, bio, samplePost).
    const filters = activeMission.filters;
    const tierMap = {
        nano: [0, 5000], micro: [5000, 50000], mid: [50000, 250000],
        macro: [250000, 1000000], mega: [1000000, Infinity], all: [0, Infinity]
    };
    const [tierLo, tierHi] = tierMap[filters.authorityLevel] || tierMap.all;

    // LinkedIn: skip pre-filter entirely — every candidate appears in the UI
    // with a preliminary score, and the user decides which to track. We still
    // visit every profile to upgrade the score, just in best-match order.
    const preFiltered = platform === 'LinkedIn' ? allCandidates.slice() : allCandidates.filter(c => {
        // Verified-only gate (we already know this from search)
        if (filters.verifiedOnly && !c.verified) return false;
        // If we have a follower hint AND it's clearly outside the range, drop it
        if (typeof c.followerHint === 'number') {
            if (filters.minFollowers && c.followerHint < filters.minFollowers) return false;
            if (filters.maxFollowers && c.followerHint > filters.maxFollowers) return false;
            if (c.followerHint < tierLo || c.followerHint > tierHi) return false;
        }
        // Exclude keywords visible in card
        if (filters.excludeKeywords?.length) {
            const hay = [c.bio, c.displayName, c.samplePost].filter(Boolean).join(' ').toLowerCase();
            for (const ex of filters.excludeKeywords) {
                if (hay.includes(ex.toLowerCase())) return false;
            }
        }
        return true;
    });
    const preFilteredOut = allCandidates.length - preFiltered.length;
    if (preFilteredOut > 0) {
        logMission('info', `Pre-filter rejected ${preFilteredOut} candidates (saved that many profile visits)`, platform);
    }

    // ─── PRE-RANK ───
    // Rank by signal density before fingerprinting so we visit the most promising first.
    const keywords = [...(filters.keywords || []), ...(filters.hashtags || []).map(h => h.replace('#', ''))]
        .map(k => k.toLowerCase());
    function preRank(c) {
        const hay = [c.bio, c.displayName, c.samplePost].filter(Boolean).join(' ').toLowerCase();
        let score = 0;
        for (const kw of keywords) if (hay.includes(kw)) score += 10;
        if (c.verified) score += 5;
        if (c.discoveredVia === 'post') score += 3; // post-tab signals active engagement
        if (c.bio && c.bio.length > 30) score += 2;
        if (typeof c.followerHint === 'number' && c.followerHint >= tierLo && c.followerHint <= tierHi) score += 4;
        return score;
    }
    preFiltered.sort((a, b) => preRank(b) - preRank(a));

    // ─── PUSH ENTIRE PRE-FILTERED LIST INTO PERSISTED QUEUE ───
    // No artificial slice — every pre-filtered candidate gets visited eventually,
    // possibly across multiple cooldown-separated batches. We just enqueue them
    // and let the loop below drain as many as the batchCap allows per session.
    const newlyQueued = preFiltered.map(c => ({ platform, candidate: c }));
    activeMission.pendingProfileQueue.push(...newlyQueued);
    await persistMission();
    logMission('info', `Queued ${newlyQueued.length} candidates from ${platform} (queue total: ${activeMission.pendingProfileQueue.length})`, platform);

    const enriched = [];
    // Drain queue ENTRIES that match this platform first (so we don't switch platforms mid-run)
    while (true) {
        if (missionAborted) break;
        while (missionPaused && !missionAborted) await dsleep(500);

        // ── TARGET REACHED ── stop the entire mission early
        if (activeMission.progress.matched >= activeMission.targetMatches) {
            logMission('success', `🎯 Target ${activeMission.targetMatches} matches reached — stopping discovery`, platform);
            break;
        }

        // ── BATCH CAP HIT ── trigger cooldown + auto-resume
        if (_sessionVisits >= activeMission.batchCap) {
            logMission('stealth', `Batch limit ${_sessionVisits}/${activeMission.batchCap} reached — entering cooldown`, platform);
            await scheduleBatchResume();
            throw new BatchCapReached();
        }

        // Pop next candidate FOR THIS PLATFORM (skip cross-platform items, leave them for later)
        const idx = activeMission.pendingProfileQueue.findIndex(item => item.platform === platform);
        if (idx === -1) break; // no more for this platform — let outer loop move on
        const { candidate } = activeMission.pendingProfileQueue.splice(idx, 1)[0];

        await enforceRateLimit();

        const session = await checkSessionDuration();
        if (!session.ok) { logMission('warn', session.reason, platform); break; }

        const remaining = activeMission.pendingProfileQueue.length;
        const target = activeMission.targetMatches;
        const matched = activeMission.progress.matched;
        const progressMsg = `Visiting @${candidate.handle} — batch ${_sessionVisits + 1}/${activeMission.batchCap}, matches ${matched}/${target}, ${remaining} queued`;
        await patchProgress({
            phase: progressMsg,
            profilesAnalyzed: (activeMission.progress.profilesAnalyzed || 0) + 1,
            currentPlatform: platform
        });
        logMission('info', progressMsg, platform);

        try {
            await navigateTab(tabId, candidate.url);
            // Profile pages hydrate faster than search SPAs
            await interruptibleSleep(gauss(2500, 600));

            const block = await sendToAgent(tabId, { type: 'DISCOVERY_DETECT_BLOCK' });
            if (block?.blocked) {
                logMission('error', `Block during profile visit: ${block.type} — pausing platform`, platform);
                await patchStealth({
                    detected: true,
                    detectionReason: block.indicator,
                    humanizedBehaviorScore: Math.max(30, (activeMission.stealth.humanizedBehaviorScore || 100) - 30)
                });
                break;
            }

            await recordAction();

            const result = await sendToAgent(tabId, { type: 'DISCOVERY_SCRAPE_PROFILE' });
            if (result?.error) {
                logMission('warn', `Skip @${candidate.handle}: ${result.error}`, platform);
                await patchProgress({ rejected: activeMission.progress.rejected + 1 });
            } else if (platform === 'LinkedIn') {
                // ─── LINKEDIN: UPGRADE THE PRELIMINARY ENTRY IN PLACE ───
                // Verification never *removes* an account — it just replaces the
                // card-level score with one based on real KPIs + post signals.
                // Filter mismatches are surfaced as informational chips, not gates.
                const profile = result.profile;
                const merged = { ...candidate, ...profile };
                const scoring = scoreLinkedInVerified(merged, activeMission.filters, candidate);
                const mismatchReasons = describeFilterMismatch(merged, activeMission.filters);

                const existingIdx = activeMission.results.findIndex(
                    r => r.platform === 'LinkedIn' && r.handle === candidate.handle
                );
                const upgraded = {
                    // Start from existing entry (preserves id, discoveredAt, trackingStatus)
                    ...(existingIdx >= 0 ? activeMission.results[existingIdx] : {
                        id: `LinkedIn_${candidate.handle}_${Date.now()}`,
                        discoveredAt: nowIso(),
                        trackingStatus: 'untracked'
                    }),
                    platform: 'LinkedIn',
                    handle: candidate.handle,
                    url: candidate.url,
                    displayName: merged.displayName || candidate.displayName || candidate.handle,
                    bio: merged.bio || candidate.bio || '',
                    followers: merged.followers || 0,
                    verified: !!merged.verified,
                    engagementRate: merged.engagementRate || 0,
                    authorityScore: scoring.authorityScore,
                    nicheMatch: scoring.nicheMatch,
                    finalScore: scoring.finalScore,
                    matchedSignals: scoring.matchedSignals,
                    tier: scoring.tier,
                    recentPostCount: scoring.recentPostCount,
                    maturePostMedianEngagement: scoring.maturePostMedianEngagement,
                    daysSinceLastPost: scoring.daysSinceLastPost,
                    lastActive: merged.lastActive,
                    filterMismatchReasons: mismatchReasons,
                    verificationStatus: scoring.verificationStatus,
                    enriched: true
                };
                if (existingIdx >= 0) {
                    activeMission.results[existingIdx] = upgraded;
                } else {
                    activeMission.results.push(upgraded);
                }
                enriched.push(upgraded);
                activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
                await patchProgress({ matched: activeMission.progress.matched + 1 });
                await persistMission();
                const fmt = merged.followers >= 1000
                    ? merged.followers >= 1e6 ? `${(merged.followers/1e6).toFixed(1)}M` : `${(merged.followers/1e3).toFixed(1)}K`
                    : `${merged.followers || 0}`;
                const mismatch = mismatchReasons.length ? ` [${mismatchReasons.join(', ')}]` : '';
                logMission('success', `↻ ${scoring.tier}-tier @${candidate.handle} — ${fmt} followers (score ${scoring.finalScore})${mismatch}`, platform);
            } else {
                const profile = result.profile;
                const merged = { ...candidate, ...profile };

                if (!passesFilters(merged, activeMission.filters)) {
                    // Tell the user WHY this account didn't make the cut
                    const f = activeMission.filters;
                    const reasons = [];
                    if (f.minFollowers && merged.followers < f.minFollowers)
                        reasons.push(`only ${merged.followers || 0} followers (need ${f.minFollowers}+)`);
                    if (f.maxFollowers && merged.followers > f.maxFollowers)
                        reasons.push(`${merged.followers} followers (over ${f.maxFollowers} cap)`);
                    if (f.verifiedOnly && !merged.verified)
                        reasons.push('not verified');
                    if (f.minEngagementRate && (merged.engagementRate || 0) < f.minEngagementRate)
                        reasons.push(`${(merged.engagementRate || 0).toFixed(1)}% engagement (need ${f.minEngagementRate}%+)`);
                    const reasonStr = reasons.length ? reasons.join(', ') : 'filter mismatch';
                    logMission('info', `✗ @${candidate.handle} — ${reasonStr}`, platform);
                    await patchProgress({ rejected: activeMission.progress.rejected + 1 });
                } else {
                    const scoring = scoreAccount(merged, activeMission.filters, candidate);
                    const account = {
                        id: `${platform}_${candidate.handle}_${Date.now()}`,
                        ...merged,
                        ...scoring,
                        discoveredAt: nowIso(),
                        trackingStatus: 'untracked',
                        enriched: true,
                        verificationStatus: 'verified'
                    };
                    enriched.push(account);
                    activeMission.results.push(account);
                    activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
                    await patchProgress({ matched: activeMission.progress.matched + 1 });
                    await persistMission();
                    const fmt = merged.followers >= 1000
                        ? merged.followers >= 1e6 ? `${(merged.followers/1e6).toFixed(1)}M` : `${(merged.followers/1e3).toFixed(1)}K`
                        : `${merged.followers || 0}`;
                    logMission('success', `✓ ${scoring.tier}-tier @${candidate.handle} — ${fmt} followers (score ${scoring.finalScore})`, platform);
                }
            }

            // Inter-profile pause — short enough to not waste the user's time,
            // long enough to not look like a bot. Was 26s, now 9s avg.
            await interruptibleSleep(gauss(9000, 2500));

            // Behavior score boost periodically while stealth holds
            if (_sessionVisits > 0 && _sessionVisits % 5 === 0 && !activeMission.stealth.detected) {
                const score = Math.min(100, (activeMission.stealth.humanizedBehaviorScore || 100) + 1);
                await patchStealth({ humanizedBehaviorScore: score });
            }
        } catch (e) {
            logMission('error', `Profile visit failed for @${candidate.handle}: ${e.message}`, platform);
            await patchProgress({ rejected: activeMission.progress.rejected + 1 });
        }

        // Count this visit toward the batch cap. Persist queue state so
        // a SW death between visits doesn't lose the remaining work.
        _sessionVisits++;
        await persistMission();
    }

    logMission('success', `Verified ${enriched.length} matches passed filters on ${platform} this batch (${activeMission.pendingProfileQueue.length} candidates still queued)`, platform);
    return enriched;
}

// ============================================================
// CROSS-PLATFORM MATCHING
// ============================================================
function matchCrossPlatform(allAccounts) {
    const byName = new Map();
    for (const acc of allAccounts) {
        const key = (acc.displayName || acc.handle).toLowerCase().replace(/\s+/g, '');
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(acc);
    }
    for (const [key, group] of byName.entries()) {
        if (group.length > 1) {
            const platforms = new Set(group.map(a => a.platform));
            if (platforms.size > 1) {
                group.forEach(a => {
                    a.crossPlatform = true;
                    a.finalScore = Math.min(100, a.finalScore + 8);
                    a.matchedSignals = [...a.matchedSignals, `Found on ${platforms.size} platforms`];
                    a.tier = classifyTier(a);
                });
            }
        }
    }
}

// ============================================================
// MISSION LIFECYCLE
// ============================================================
async function startDiscoveryMission(missionConfig) {
    // ─── ATOMIC SINGLE-INSTANCE LOCK ───
    // Sync check — must run BEFORE the first await so concurrent calls bail out.
    if (_missionLock) {
        console.warn(DISC_TAG, '⚠ Duplicate DISCOVERY_START ignored — a mission is already starting/running');
        return;
    }
    if (activeMission && ['scanning', 'preparing', 'paused'].includes(activeMission.status)) {
        console.warn(DISC_TAG, `⚠ Duplicate DISCOVERY_START ignored — activeMission.status=${activeMission.status}`);
        return;
    }
    // Background-automation overlap guard. The posts-tracker poller + feed
    // watcher use `withPollingLock` in background.js — if any sweep is mid-
    // flight, refuse to start a discovery mission so we never have two
    // stealth windows scraping the same domain at the same time (bot signal).
    if (typeof self.isAutomationBusy === 'function' && await self.isAutomationBusy()) {
        console.warn(DISC_TAG, '⚠ DISCOVERY_START deferred — another extension automation is running. Try again in a minute.');
        try {
            await chrome.storage.local.set({
                discovery_start_error: {
                    at: new Date().toISOString(),
                    reason: 'Another extension automation (posts tracker or feed watcher) is running. Wait for it to finish — usually under a minute.'
                }
            });
        } catch {}
        return;
    }
    _missionLock = true;
    try {
        await _startDiscoveryMissionInner(missionConfig);
    } finally {
        _missionLock = false;
    }
}

async function _startDiscoveryMissionInner(missionConfig) {
    // ─── HARD RESET ON FRESH MISSION ───
    // Detect "fresh mission start" vs "resume from cooldown". Resume is
    // identified by: mission has results AND has pending queue items AND no
    // deepening rounds yet. Fresh missions clear ALL stale state including:
    //   - lingering 'cooldown' state from a previous run that never resumed
    //   - leftover pendingProfileQueue from a different search
    //   - pending batch resume alarm
    // Without this, a search that hit cooldown 4 hours ago + was abandoned
    // will silently take precedence over the new search the user just kicked off.
    const isResume = !!(missionConfig.pendingProfileQueue?.length
        && missionConfig.results?.length
        && !missionConfig.deepeningRound);
    if (!isResume) {
        try { await chrome.alarms.clear(BATCH_RESUME_ALARM); } catch {}
        // Wipe stale stored state so it doesn't leak into the new mission
        try { await chrome.storage.local.remove(['discovery_mission_state', 'discovery_mission_completed']); } catch {}
        // ─── KILL THE LEGACY RECON ENGINE ───
        // If an old ICP-recon mission left state behind, its queueProcessor alarm
        // will keep firing every 5min and open shadow windows in parallel with
        // ours. That's exactly the "2 windows for no reason" symptom. Clear it.
        try {
            await chrome.storage.local.set({
                recon_queue: [],
                active_campaign: null,
                stop_recon_mission: true
            });
            await chrome.alarms.clear('queueProcessor');
        } catch {}
        activeMission = null;
        missionAborted = false;
        missionPaused = false;
        _sessionVisits = 0;
        console.log(DISC_TAG, '🆕 Fresh mission — cleared stale cooldown state, alarms, recon queue, and storage');
    }

    if (activeMission && ['scanning', 'preparing', 'paused'].includes(activeMission.status)) {
        throw new Error('Another mission is already running');
    }

    // ─── TOP-LEVEL DIAGNOSTIC ───
    // Surface the actual mission config we received so failures can be diagnosed.
    const f = missionConfig.filters || {};
    console.log(DISC_TAG, '📋 Mission config:', {
        name: missionConfig.name,
        mode: missionConfig.mode,
        platforms: f.platforms,
        keywords: f.keywords,
        hashtags: f.hashtags,
        // ─── New engagement-led fields ───
        engagementFloor: f.engagementFloor,
        postRecencyDays: f.postRecencyDays,
        minEngagementRate: f.minEngagementRate,
        seeds: f.seeds,
        // ─── Audience refinement (now optional / demoted) ───
        authorityLevel: f.authorityLevel,
        verifiedOnly: f.verifiedOnly,
        minFollowers: f.minFollowers,
        targetMatches: missionConfig.targetMatches,
        batchCap: missionConfig.batchCap
    });
    // Engine-side default. If the panel sent us nothing (stale localStorage,
    // older mission JSON, campaign run started before the rework), default to
    // 'real' — same as the panel's new default — so we don't silently fall
    // back to the broken keyword-only behavior.
    if (typeof f.engagementFloor !== 'string') {
        f.engagementFloor = 'real';
        console.log(DISC_TAG, '🛡 engagementFloor missing — defaulting engine-side to "real"');
    }
    if (f.postRecencyDays === undefined) {
        f.postRecencyDays = 30;
    }
    if (!f.seeds || typeof f.seeds !== 'object') f.seeds = {};
    // Sanity gate — fail FAST if the mission can't possibly produce results
    if (!f.platforms?.length) {
        throw new Error('No platforms specified in filters.platforms');
    }
    if (!f.keywords?.length && !f.hashtags?.length) {
        throw new Error('No keywords or hashtags — searching for nothing will return nothing');
    }

    // Time-of-day check
    const tod = checkTimeOfDay();
    if (!tod.ok) {
        logMission('warn', tod.reason);
        // Don't hard-block; warn but allow
    }

    activeMission = missionConfig;
    activeMission.status = 'preparing';
    activeMission.startedAt = activeMission.startedAt || nowIso();
    activeMission.results = activeMission.results || [];
    activeMission.logs = activeMission.logs || [];

    // Batched-verification config (defaults if caller didn't set them)
    activeMission.targetMatches      = activeMission.targetMatches      || 25;
    activeMission.batchCap           = activeMission.batchCap           || 15;
    activeMission.cooldownMs         = activeMission.cooldownMs         || (40 * 60 * 1000);
    activeMission.deepeningRound     = activeMission.deepeningRound     || 0;
    activeMission.maxDeepeningRounds = activeMission.maxDeepeningRounds ?? 2;
    // Persisted queue of {platform, candidate} pending profile-visit & verification.
    // Populated during search phase; drained during verification. Survives cooldown.
    activeMission.pendingProfileQueue = activeMission.pendingProfileQueue || [];

    _sessionVisits = 0;
    activeMission.stealth = activeMission.stealth || {
        actionsThisMinute: 0,
        actionsThisSession: 0,
        rateLimit: 20,
        detected: false,
        nextActionInMs: 0,
        sessionStartedAt: Date.now(),
        humanizedBehaviorScore: 100,
        patternsDetected: []
    };
    activeMission.stealth.sessionStartedAt = Date.now();

    missionAborted = false;
    missionPaused = false;
    await persistMission();

    // Keep SW alive during long sleeps + start stall watchdog
    startKeepAlive();
    startWatchdog();

    logMission('info', `Mission "${activeMission.name}" started — mode ${activeMission.mode}`);

    let tabId = null;
    try {
        // Open one stealth window. Land on a generic platform page first so the
        // content script attaches before we navigate to the search URL — without
        // this, the agent can be missing when we try to scrape.
        const firstPlatform = activeMission.filters.platforms[0];
        const initialUrl = `https://${firstPlatform === 'X' ? 'x.com' : firstPlatform === 'LinkedIn' ? 'www.linkedin.com' : 'www.reddit.com'}`;
        const win = await openStealthWindow(initialUrl);
        tabId = await getTabFromWindow(win);
        if (!tabId) throw new Error('Could not acquire stealth tab');

        // Wait for tab to be ready & content script to load (shortened settle)
        await waitForTabComplete(tabId, 30000);
        // Inject the agent here too: the manifest match covers later loads, but the
        // initial landing tab may race with the content_script auto-load.
        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['discovery_agent.js'] });
        } catch (_) {}
        await dsleep(gauss(1500, 400));

        await updateMission({ status: 'scanning' });
        logMission('success', 'Stealth window deployed — searching now');

        // ─── RESUME PATH ───
        // If pendingProfileQueue already has items (we were resumed from
        // batch cooldown), skip the search phase entirely and drain the
        // queue directly. Search adds candidates; verify drains them.
        const isResume = activeMission.pendingProfileQueue.length > 0 && activeMission.deepeningRound === 0
            && activeMission.results.length > 0;
        if (isResume) {
            logMission('info', `↻ Resuming from cooldown — ${activeMission.pendingProfileQueue.length} candidates still queued. Skipping search.`);
            await drainQueueOnly(tabId);
        } else {
            // Normal flow: search each platform, verify in batches
            for (const platform of activeMission.filters.platforms) {
                if (missionAborted) break;
                if (activeMission.progress.matched >= activeMission.targetMatches) {
                    logMission('success', `🎯 Target reached before reaching ${platform}`);
                    break;
                }
                if (Date.now() < stealthCooldownUntil) {
                    const remaining = Math.ceil((stealthCooldownUntil - Date.now()) / 1000);
                    logMission('warn', `Stealth cooldown active (${remaining}s) — skipping ${platform}`);
                    continue;
                }

                const queries = planQueries(activeMission.filters, activeMission.mode, activeMission.deepeningRound, platform);
                // Recalibrate the UI's progress denominator to the actual work the
                // engine will do. Seed queries don't multiply by tabs (they have
                // their own expansion shape), so the math differs by query type.
                const keywordCount = queries.filter(q => q.type === 'keyword').length;
                const seedCount    = queries.filter(q => q.type === 'seed').length;
                const realPlanned = (keywordCount * 2 + seedCount) * activeMission.filters.platforms.length;
                if (realPlanned !== activeMission.progress.totalQueriesPlanned) {
                    await patchProgress({ totalQueriesPlanned: realPlanned });
                }
                logMission('info', `Planned ${keywordCount} keyword queries (×2 tabs) + ${seedCount} seed expansions (deepening round ${activeMission.deepeningRound})`, platform);
                await executePlatform(platform, queries, tabId);

                // Inter-platform pause (long, looks like switching context)
                if (activeMission.filters.platforms.indexOf(platform) < activeMission.filters.platforms.length - 1) {
                    const pauseMs = gauss(45000, 12000);
                    logMission('stealth', `Inter-platform cooldown ${Math.round(pauseMs/1000)}s`);
                    await patchStealth({ cooldownUntil: Date.now() + pauseMs });
                    await interruptibleSleep(pauseMs);
                }
            }
        }

        // ─── DEEPENING ───
        // Queue exhausted but target still unreached? Re-search with broader
        // queries up to maxDeepeningRounds times.
        while (
            !missionAborted
            && activeMission.pendingProfileQueue.length === 0
            && activeMission.progress.matched < activeMission.targetMatches
            && activeMission.deepeningRound < activeMission.maxDeepeningRounds
        ) {
            activeMission.deepeningRound++;
            logMission('info', `🔍 Pool exhausted under target (${activeMission.progress.matched}/${activeMission.targetMatches}). Deepening round ${activeMission.deepeningRound}/${activeMission.maxDeepeningRounds} with broader queries.`);
            await persistMission();
            for (const platform of activeMission.filters.platforms) {
                if (missionAborted) break;
                if (activeMission.progress.matched >= activeMission.targetMatches) break;
                const broaderQueries = planQueries(activeMission.filters, 'volume', activeMission.deepeningRound, platform);
                await executePlatform(platform, broaderQueries, tabId);
            }
        }

        // Cross-platform matching boost
        if (activeMission.filters.platforms.length > 1 && activeMission.results.length > 0) {
            matchCrossPlatform(activeMission.results);
            await persistMission();
            logMission('success', 'Cross-platform matching applied');
        }

        // Sort final results by score
        activeMission.results.sort((a, b) => b.finalScore - a.finalScore);

        // ─── ACTIONABLE END-OF-MISSION SUMMARY ───
        // If we found 0 accounts, the user needs to know exactly why so they can
        // fix it on the next run. Synthesise a clear error from the mission state.
        if (!missionAborted && activeMission.results.length === 0) {
            const scanned = activeMission.progress.candidatesScanned || 0;
            const rejected = activeMission.progress.rejected || 0;
            const detected = activeMission.stealth.detected;
            let reason;
            if (detected) {
                reason = `0 accounts: ${activeMission.stealth.detectionReason || 'platform blocked us'}. Log into the platform in a normal Chrome tab, wait 10 min, then retry.`;
            } else if (scanned === 0) {
                reason = `0 accounts: search returned no candidates on any platform. Likely causes: (1) you're not logged in to the search platform — check the stealth window, (2) your keywords are too narrow or specific, (3) the platform's DOM may have changed and the scraper needs an update. Try broader keywords like single common words.`;
            } else if (rejected > 0 && rejected === scanned) {
                reason = `0 accounts: scanned ${scanned} candidates but all ${rejected} were rejected by your filters. Loosen filters: lower min followers, drop "verified only", widen the authority tier.`;
            } else {
                reason = `0 accounts: scanned ${scanned} candidates, ${rejected} rejected. Some profile visits may have failed — check earlier logs.`;
            }
            logMission('error', reason);
        }

        await updateMission({
            status: missionAborted ? 'aborted' : 'completed',
            completedAt: nowIso()
        });
        logMission('success', `Mission ${missionAborted ? 'aborted' : 'completed'}: ${activeMission.results.length} accounts`);

        // Push completion event
        await chrome.storage.local.set({
            discovery_mission_completed: { ...activeMission, _completedAt: Date.now() }
        });
    } catch (e) {
        // BatchCapReached is a clean exit — mission is in cooldown, alarm
        // will resume it. Don't mark as failed/aborted/completed.
        if (e instanceof BatchCapReached) {
            await persistMission();  // status='cooldown' already set in scheduleBatchResume
            // Don't fire 'completed' event — the UI will see the cooldown state
        } else {
            // If the error came from the abort signal, preserve 'aborted' status.
            const isAbort = missionAborted || /aborted/i.test(e.message);
            if (isAbort) {
                logMission('warn', 'Mission terminated via abort signal');
                await updateMission({ status: 'aborted', completedAt: nowIso() });
            } else {
                logMission('error', `Fatal: ${e.message}`);
                await updateMission({ status: 'failed', completedAt: nowIso() });
            }
            await chrome.storage.local.set({
                discovery_mission_completed: { ...activeMission, _completedAt: Date.now() }
            });
        }
    } finally {
        stopWatchdog();
        stopKeepAlive();
        await closeStealthWindow();
    }
}

async function pauseDiscoveryMission() {
    if (!activeMission) return false;
    missionPaused = true;
    await updateMission({ status: 'paused' });
    logMission('info', 'Mission paused by user');
    return true;
}

async function resumeDiscoveryMission() {
    if (!activeMission) return false;
    missionPaused = false;
    await updateMission({ status: 'scanning' });
    logMission('info', 'Mission resumed');
    return true;
}

async function abortDiscoveryMission() {
    missionAborted = true;
    if (activeMission) {
        await updateMission({ status: 'aborted', completedAt: nowIso() });
        logMission('warn', 'Mission aborted by user');
    }
    await closeStealthWindow();
    return true;
}

function resetDiscoveryEngineState() {
    activeMission = null;
    activeWindowId = null;
    missionAborted = false;
    missionPaused = false;
    stealthCooldownUntil = 0;
}

// ============================================================
// QUEUE-ONLY DRAIN (used by deepening + resume paths)
// ============================================================
// Drain candidates already queued — no new search. Walks pendingProfileQueue
// in order, visits each, applies same target/batch checks as the main loop.
async function drainQueueOnly(tabId) {
    while (true) {
        if (missionAborted) break;
        if (activeMission.pendingProfileQueue.length === 0) break;

        if (activeMission.progress.matched >= activeMission.targetMatches) {
            logMission('success', `🎯 Target reached during drain — stopping`);
            break;
        }
        if (_sessionVisits >= activeMission.batchCap) {
            logMission('stealth', `Batch limit ${_sessionVisits}/${activeMission.batchCap} reached during drain — entering cooldown`);
            await scheduleBatchResume();
            throw new BatchCapReached();
        }

        const next = activeMission.pendingProfileQueue.shift();
        await persistMission();
        // Use executePlatform's per-candidate logic by re-queuing this one
        // and calling executePlatform with empty queries list. That's overkill;
        // simpler to just inline a minimal verify call here.
        await verifyOneCandidate(next.platform, next.candidate, tabId);
    }
}

// Visit one profile, check filters, push to results if pass. Used by both
// main flow and resume drain. Mirrors the inline logic in executePlatform.
async function verifyOneCandidate(platform, candidate, tabId) {
    await enforceRateLimit();
    const session = await checkSessionDuration();
    if (!session.ok) { logMission('warn', session.reason, platform); return; }

    const remaining = activeMission.pendingProfileQueue.length;
    const target = activeMission.targetMatches;
    const matched = activeMission.progress.matched;
    const progressMsg = `Visiting @${candidate.handle} — batch ${_sessionVisits + 1}/${activeMission.batchCap}, matches ${matched}/${target}, ${remaining} queued`;
    await patchProgress({
        phase: progressMsg,
        profilesAnalyzed: (activeMission.progress.profilesAnalyzed || 0) + 1,
        currentPlatform: platform
    });
    logMission('info', progressMsg, platform);

    try {
        await navigateTab(tabId, candidate.url);
        await interruptibleSleep(gauss(2500, 600));

        const block = await sendToAgent(tabId, { type: 'DISCOVERY_DETECT_BLOCK' });
        if (block?.blocked) {
            logMission('error', `Block during profile visit: ${block.type}`, platform);
            await patchStealth({
                detected: true,
                detectionReason: block.indicator,
                humanizedBehaviorScore: Math.max(30, (activeMission.stealth.humanizedBehaviorScore || 100) - 30)
            });
            return;
        }

        await recordAction();
        const result = await sendToAgent(tabId, { type: 'DISCOVERY_SCRAPE_PROFILE' });
        if (result?.error) {
            logMission('warn', `Skip @${candidate.handle}: ${result.error}`, platform);
            await patchProgress({ rejected: activeMission.progress.rejected + 1 });
        } else if (platform === 'LinkedIn') {
            // LinkedIn upgrade-in-place (mirrors executePlatform path)
            const profile = result.profile;
            const merged = { ...candidate, ...profile };
            const scoring = scoreLinkedInVerified(merged, activeMission.filters, candidate);
            const mismatchReasons = describeFilterMismatch(merged, activeMission.filters);

            const existingIdx = activeMission.results.findIndex(
                r => r.platform === 'LinkedIn' && r.handle === candidate.handle
            );
            const upgraded = {
                ...(existingIdx >= 0 ? activeMission.results[existingIdx] : {
                    id: `LinkedIn_${candidate.handle}_${Date.now()}`,
                    discoveredAt: nowIso(),
                    trackingStatus: 'untracked'
                }),
                platform: 'LinkedIn',
                handle: candidate.handle,
                url: candidate.url,
                displayName: merged.displayName || candidate.displayName || candidate.handle,
                bio: merged.bio || candidate.bio || '',
                followers: merged.followers || 0,
                verified: !!merged.verified,
                engagementRate: merged.engagementRate || 0,
                authorityScore: scoring.authorityScore,
                nicheMatch: scoring.nicheMatch,
                finalScore: scoring.finalScore,
                matchedSignals: scoring.matchedSignals,
                tier: scoring.tier,
                recentPostCount: scoring.recentPostCount,
                maturePostMedianEngagement: scoring.maturePostMedianEngagement,
                daysSinceLastPost: scoring.daysSinceLastPost,
                lastActive: merged.lastActive,
                filterMismatchReasons: mismatchReasons,
                verificationStatus: scoring.verificationStatus,
                enriched: true
            };
            if (existingIdx >= 0) activeMission.results[existingIdx] = upgraded;
            else activeMission.results.push(upgraded);
            activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
            await patchProgress({ matched: activeMission.progress.matched + 1 });
            await persistMission();
            const fmt = merged.followers >= 1000
                ? merged.followers >= 1e6 ? `${(merged.followers/1e6).toFixed(1)}M` : `${(merged.followers/1e3).toFixed(1)}K`
                : `${merged.followers || 0}`;
            const mismatch = mismatchReasons.length ? ` [${mismatchReasons.join(', ')}]` : '';
            logMission('success', `↻ ${scoring.tier}-tier @${candidate.handle} — ${fmt} followers (score ${scoring.finalScore})${mismatch}`, platform);
        } else {
            const profile = result.profile;
            const merged = { ...candidate, ...profile };
            if (!passesFilters(merged, activeMission.filters)) {
                const f = activeMission.filters;
                const reasons = [];
                if (f.minFollowers && merged.followers > 0 && merged.followers < f.minFollowers)
                    reasons.push(`only ${merged.followers} followers (need ${f.minFollowers}+)`);
                if (f.verifiedOnly && !merged.verified) reasons.push('not verified');
                logMission('info', `✗ @${candidate.handle} — ${reasons.join(', ') || 'filter mismatch'}`, platform);
                await patchProgress({ rejected: activeMission.progress.rejected + 1 });
            } else {
                const scoring = scoreAccount(merged, activeMission.filters, candidate);
                const account = {
                    id: `${platform}_${candidate.handle}_${Date.now()}`,
                    ...merged, ...scoring,
                    discoveredAt: nowIso(), trackingStatus: 'untracked', enriched: true,
                    verificationStatus: 'verified'
                };
                activeMission.results.push(account);
                activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
                await patchProgress({ matched: activeMission.progress.matched + 1 });
                await persistMission();
                const fmt = merged.followers >= 1000
                    ? merged.followers >= 1e6 ? `${(merged.followers/1e6).toFixed(1)}M` : `${(merged.followers/1e3).toFixed(1)}K`
                    : `${merged.followers || 0}`;
                logMission('success', `✓ ${scoring.tier}-tier @${candidate.handle} — ${fmt} followers (score ${scoring.finalScore})`, platform);
            }
        }
        await interruptibleSleep(gauss(9000, 2500));
    } catch (e) {
        logMission('error', `Profile visit failed for @${candidate.handle}: ${e.message}`, platform);
        await patchProgress({ rejected: activeMission.progress.rejected + 1 });
    }
    _sessionVisits++;
    await persistMission();
}

// ============================================================
// BATCH-COOLDOWN RESUME
// ============================================================
// Triggered by chrome.alarms when the cooldown expires. Reads persisted
// mission state, reopens stealth window, calls startDiscoveryMission which
// detects the resume scenario via pendingProfileQueue.length > 0.
async function resumeFromBatchCooldown() {
    const st = await chrome.storage.local.get(['discovery_mission_state']);
    const m = st.discovery_mission_state;
    if (!m) {
        console.warn(DISC_TAG, 'Resume alarm fired but no mission state in storage — ignoring');
        return;
    }
    if (m.status !== 'cooldown') {
        console.log(DISC_TAG, `Resume alarm fired but mission status is "${m.status}", not cooldown — ignoring`);
        return;
    }
    if (!m.pendingProfileQueue || m.pendingProfileQueue.length === 0) {
        console.log(DISC_TAG, 'Resume alarm fired but queue is empty — marking complete');
        m.status = 'completed';
        m.completedAt = nowIso();
        await chrome.storage.local.set({
            discovery_mission_state: m,
            discovery_mission_completed: { ...m, _completedAt: Date.now() }
        });
        return;
    }
    console.log(DISC_TAG, `↻ Resuming mission ${m.name || m.id} — ${m.pendingProfileQueue.length} candidates queued`);
    // Clear in-memory state so startDiscoveryMission re-init doesn't reject
    activeMission = null;
    await startDiscoveryMission(m);
}

// Expose to background.js (since this is importScripts'd into the SW)
self.startDiscoveryMission = startDiscoveryMission;
self.pauseDiscoveryMission = pauseDiscoveryMission;
self.resumeDiscoveryMission = resumeDiscoveryMission;
self.abortDiscoveryMission = abortDiscoveryMission;
self.resetDiscoveryEngineState = resetDiscoveryEngineState;
self.resumeFromBatchCooldown = resumeFromBatchCooldown;

// ============================================================
// CAMPAIGN ENGINE — long-running, recurring discovery
// ============================================================
const CAMPAIGN_TAG = '[Campaign Engine]';
const CAMPAIGN_KEY = 'discovery_campaigns';
const CAMPAIGN_ALARM = 'campaign_tick';

async function loadCampaigns() {
    const r = await chrome.storage.local.get([CAMPAIGN_KEY]);
    return r[CAMPAIGN_KEY] || {};
}

async function saveCampaigns(campaigns) {
    await chrome.storage.local.set({ [CAMPAIGN_KEY]: campaigns });
}

async function upsertCampaign(camp) {
    const all = await loadCampaigns();
    all[camp.id] = camp;
    await saveCampaigns(all);
}

function pickJitterMs(intervalHours, jitterHours) {
    const baseMs = intervalHours * 3600000;
    const jitterMs = (Math.random() * 2 - 1) * (jitterHours || 0) * 3600000;
    return Math.max(60000, baseMs + jitterMs);
}

async function scheduleNextTick(campaign) {
    const delayMs = pickJitterMs(campaign.intervalHours, campaign.intervalJitter);
    const next = Date.now() + delayMs;
    if (next > new Date(campaign.endsAt).getTime()) {
        // Past campaign end — mark completed
        campaign.status = 'completed';
        campaign.nextTickAt = undefined;
        await upsertCampaign(campaign);
        console.log(CAMPAIGN_TAG, `Campaign ${campaign.id} completed.`);
        return;
    }
    campaign.nextTickAt = new Date(next).toISOString();
    await upsertCampaign(campaign);
    chrome.alarms.create(`${CAMPAIGN_ALARM}_${campaign.id}`, { when: next });
    console.log(CAMPAIGN_TAG, `Next tick for ${campaign.id} at ${campaign.nextTickAt}`);
}

async function startDiscoveryCampaign(config) {
    const id = config.id || `camp_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + (config.durationDays || 7) * 86400000).toISOString();

    const campaign = {
        id,
        name: config.name || `Campaign ${id}`,
        mode: config.mode || 'deep',
        filters: config.filters,
        status: 'active',
        intervalHours: Math.max(1, config.intervalHours || 4),
        intervalJitter: config.intervalJitter ?? 1,
        durationDays: config.durationDays || 7,
        startedAt,
        endsAt,
        ticksCompleted: 0,
        ticksFailed: 0,
        results: [],
        totalCandidatesScanned: 0,
        knownHandles: [],
        recentLogs: []
    };

    await upsertCampaign(campaign);
    console.log(CAMPAIGN_TAG, `Started campaign ${id} for ${campaign.durationDays}d, every ~${campaign.intervalHours}h`);

    // Fire first tick immediately, then schedule next
    setTimeout(() => runCampaignTick(id).catch(e => console.error(CAMPAIGN_TAG, 'First tick failed:', e)), 2000);
    return campaign;
}

async function pauseDiscoveryCampaign(id) {
    const all = await loadCampaigns();
    if (!all[id]) return false;
    all[id].status = 'paused';
    await saveCampaigns(all);
    chrome.alarms.clear(`${CAMPAIGN_ALARM}_${id}`);
    return true;
}

async function resumeDiscoveryCampaign(id) {
    const all = await loadCampaigns();
    if (!all[id]) return false;
    all[id].status = 'active';
    await saveCampaigns(all);
    await scheduleNextTick(all[id]);
    return true;
}

async function abortDiscoveryCampaign(id) {
    const all = await loadCampaigns();
    if (!all[id]) return false;
    all[id].status = 'aborted';
    all[id].nextTickAt = undefined;
    await saveCampaigns(all);
    chrome.alarms.clear(`${CAMPAIGN_ALARM}_${id}`);
    if (activeMission?.campaignId === id) {
        await abortDiscoveryMission();
    }
    return true;
}

async function deleteDiscoveryCampaign(id) {
    const all = await loadCampaigns();
    delete all[id];
    await saveCampaigns(all);
    chrome.alarms.clear(`${CAMPAIGN_ALARM}_${id}`);
    return true;
}

async function runCampaignTick(campaignId) {
    const all = await loadCampaigns();
    const campaign = all[campaignId];
    if (!campaign) return;
    if (campaign.status !== 'active') return;
    if (Date.now() > new Date(campaign.endsAt).getTime()) {
        campaign.status = 'completed';
        await saveCampaigns(all);
        return;
    }
    if (activeMission && ['scanning', 'preparing', 'paused'].includes(activeMission.status)) {
        // Another mission is running — try again later
        console.log(CAMPAIGN_TAG, `Mission busy, deferring campaign ${campaignId}`);
        await scheduleNextTick(campaign);
        return;
    }

    console.log(CAMPAIGN_TAG, `Tick → ${campaignId}`);

    // Build mini-mission with rotated keyword subset (so each tick covers different angle)
    const allKeywords = campaign.filters.keywords || [];
    const slice = 2; // 2 keywords per tick to keep missions short
    const offset = (campaign.ticksCompleted * slice) % Math.max(1, allKeywords.length);
    const keywordsForTick = allKeywords.length > slice
        ? [...allKeywords.slice(offset), ...allKeywords.slice(0, offset)].slice(0, slice)
        : allKeywords;

    const mission = {
        id: `${campaignId}_t${campaign.ticksCompleted}_${Date.now()}`,
        name: `${campaign.name} — tick ${campaign.ticksCompleted + 1}`,
        status: 'preparing',
        mode: campaign.mode,
        campaignId,
        filters: { ...campaign.filters, keywords: keywordsForTick },
        progress: { phase: 'starting', candidatesScanned: 0, queriesCompleted: 0, matched: 0, rejected: 0 },
        stealth: {
            actionsThisMinute: 0, actionsThisSession: 0, rateLimit: 20,
            detected: false, sessionStartedAt: Date.now(),
            humanizedBehaviorScore: 100, patternsDetected: []
        },
        logs: [], results: []
    };

    try {
        await startDiscoveryMission(mission);
        // Merge results into campaign, dedupe by handle+platform
        const known = new Set(campaign.knownHandles);
        const fresh = [];
        for (const acc of mission.results || []) {
            const key = `${acc.platform}::${acc.handle}`;
            if (known.has(key)) continue;
            known.add(key);
            fresh.push(acc);
        }
        campaign.results = [...campaign.results, ...fresh];
        campaign.knownHandles = Array.from(known);
        campaign.totalCandidatesScanned += mission.progress?.candidatesScanned || 0;
        campaign.ticksCompleted++;
        campaign.lastTickAt = new Date().toISOString();
        campaign.recentLogs = [...(campaign.recentLogs || []), ...(mission.logs || [])].slice(-50);
        console.log(CAMPAIGN_TAG, `Tick done: +${fresh.length} new accounts (${campaign.results.length} total)`);
    } catch (e) {
        campaign.ticksFailed++;
        campaign.recentLogs = [...(campaign.recentLogs || []), {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `Tick failed: ${e.message}`
        }].slice(-50);
        console.error(CAMPAIGN_TAG, `Tick failed for ${campaignId}:`, e);
    }

    await upsertCampaign(campaign);
    if (campaign.status === 'active') {
        await scheduleNextTick(campaign);
    }
}

async function handleCampaignAlarm(name) {
    if (!name.startsWith(CAMPAIGN_ALARM + '_')) return false;
    const id = name.slice(CAMPAIGN_ALARM.length + 1);
    await runCampaignTick(id);
    return true;
}

// On engine load: re-schedule any active campaigns missed during SW sleep
(async function bootstrapCampaigns() {
    try {
        const all = await loadCampaigns();
        for (const id in all) {
            const c = all[id];
            if (c.status !== 'active') continue;
            if (Date.now() > new Date(c.endsAt).getTime()) {
                c.status = 'completed';
                await upsertCampaign(c);
                continue;
            }
            // Check if next tick is overdue or alarm is missing
            const alarm = await chrome.alarms.get(`${CAMPAIGN_ALARM}_${id}`);
            if (!alarm) {
                // Re-schedule
                await scheduleNextTick(c);
            }
        }
    } catch (e) {
        console.error(CAMPAIGN_TAG, 'Bootstrap failed:', e);
    }
})();

self.startDiscoveryCampaign = startDiscoveryCampaign;
self.pauseDiscoveryCampaign = pauseDiscoveryCampaign;
self.resumeDiscoveryCampaign = resumeDiscoveryCampaign;
self.abortDiscoveryCampaign = abortDiscoveryCampaign;
self.deleteDiscoveryCampaign = deleteDiscoveryCampaign;
self.runCampaignTick = runCampaignTick;
self.handleCampaignAlarm = handleCampaignAlarm;

// ============================================================
// FEED WATCHER — opt-in per platform from the Account Finder panel.
// Polls the user's HOME FEED on a user-defined timer, scrapes visible posts,
// stores them in `feed_watch_buffer` for the panel-side Gemini scorer to
// triage. No profile visits anywhere in this loop.
// ============================================================
const FEED_TAG = '[FeedWatch]';
const FEED_ALARM = 'feed_watch_tick';
const FEED_BUFFER_CAP = 200;

const FEED_HOME_URL = {
    X: 'https://x.com/home',
    LinkedIn: 'https://www.linkedin.com/feed/',
    Reddit: 'https://www.reddit.com/'
};
const FEED_GEMINI_MODEL = 'gemini-flash-latest';
const FEED_GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${FEED_GEMINI_MODEL}:generateContent`;

async function loadFeedWatchConfig() {
    const { feed_watch_config } = await chrome.storage.local.get(['feed_watch_config']);
    return feed_watch_config || null;
}

async function saveFeedWatchConfig(cfg) {
    await chrome.storage.local.set({ feed_watch_config: cfg });
    await scheduleFeedWatch(cfg);
}

// Reschedule the alarm whenever config changes. We use ONE alarm; the sweep
// hits every enabled platform in sequence within the same tab.
async function scheduleFeedWatch(cfg) {
    try { await chrome.alarms.clear(FEED_ALARM); } catch {}
    if (!cfg) return;
    const anyOn = cfg.enabled && (cfg.enabled.X || cfg.enabled.LinkedIn || cfg.enabled.Reddit);
    if (!anyOn) {
        console.log(FEED_TAG, 'No platforms enabled — alarm cleared.');
        return;
    }
    const minutes = Math.max(2, Math.min(360, Number(cfg.pollIntervalMinutes) || 15));
    await chrome.alarms.create(FEED_ALARM, {
        delayInMinutes: minutes,
        periodInMinutes: minutes
    });
    console.log(FEED_TAG, `Scheduled sweep every ${minutes} min for`,
        Object.entries(cfg.enabled).filter(([, v]) => v).map(([k]) => k).join(','));
}

// Call Gemini's REST API from inside the service worker to score a batch of
// freshly-scraped feed posts against the user's brief. The API key is the same
// VITE_GEMINI_API_KEY the panel uses, pushed to chrome.storage via the bridge.
// Build the scoring instructions. Two distinct rubrics so the attributed
// "profile fit" number actually measures what each mode claims:
//   • 'brief'   — strict opportunity-spotting against the user's typed brief.
//   • 'product' — neutral PRODUCT/AUDIENCE fit for RANKING (no "is this an
//                 opportunity / be strict >60" bias, which previously dragged
//                 product-fit scores down and conflated fit with opportunity).
function _buildFeedScoreInstructions(prompt, payload, mode) {
    if (mode === 'product') {
        return `You score how well each social post FITS a user's product and target audience, so we can RANK what they should pay attention to.

${(prompt || '').trim() || '(no product/audience context given)'}

For each post below, return:
- score: 0..100 fit. 100 = the author IS the target audience, or the post is squarely about a problem this product solves; 50 = adjacent/loosely related; 0 = unrelated to the product and audience. Judge FIT ONLY — do NOT require that it be an actionable "opportunity", and do not apply an extra strictness bar.
- reason: ONE short sentence explaining the score.

Echo back the SAME numeric "id" for each post exactly as given (copy the id field verbatim). Do not invent posts.

POSTS:
${JSON.stringify(payload)}`;
    }
    // 'brief' (default)
    return `You are an opportunity-spotter. The user is watching their social feeds for posts that match THIS BRIEF:

"${(prompt || '').trim() || '(no brief given — score everything 0)'}"

For each post below, return:
- score: 0..100 reflecting how well it matches the brief (0 = irrelevant noise, 100 = perfect match the user MUST see).
- reason: ONE short sentence explaining the score.

Echo back the SAME numeric "id" for each post exactly as given (copy the id field verbatim). Do not invent posts. Be strict — only > 60 should mean a genuine opportunity.

POSTS:
${JSON.stringify(payload)}`;
}

// Score a batch (≤25) of feed posts. Returns one result per input post:
//   { uuid, score, reason }                       — a real model judgement
//   { uuid, score:0, reason, failed:true }         — a HARD scorer failure
//                                                    (HTTP / parse / throw); NOT
//                                                    a 0-fit. Callers must not
//                                                    treat this as "bad fit".
//   { uuid, score:0, reason, failed:true, noKey }   — Gemini key not shared yet.
//   { uuid, score:0, reason, missing:true }         — model omitted it twice.
// `mode` selects the rubric ('brief' | 'product').
async function scoreFeedPostsInExt(prompt, posts, mode = 'brief') {
    if (!posts || posts.length === 0) return [];
    const { gemini_api_key } = await chrome.storage.local.get(['gemini_api_key']);
    if (!gemini_api_key) {
        console.warn(FEED_TAG, 'Gemini key missing — open the app once so it pushes the key to the extension. Returning failed (not 0-fit) scores.');
        return posts.map(p => ({ uuid: p.uuid, score: 0, reason: 'Gemini key not yet shared with extension — open the app once to enable.', failed: true, noKey: true }));
    }

    // CRITICAL: the model echoes back a key so we can match its judgement to the
    // right post. We must NOT use the real uuid for that round-trip — LinkedIn
    // (`li_urn:li:activity:7340…`) and Reddit (`rd_/r/sub/comments/…`) uuids are
    // long, opaque and colon/slash-laden, and the LLM does NOT reproduce them
    // verbatim. When the echoed key didn't match, EVERY such post fell through as
    // "omitted" → scored 0 → dropped by the minRelevancy gate. That's why
    // LinkedIn/Reddit posts never reached the tracker while X's short `x_<digits>`
    // mostly survived. Fix: hand the model a tiny stable integer `id` (0,1,2,…)
    // and map its answer back to the post by that id. The returned objects still
    // carry the real `uuid` so callers are unchanged.
    const idToPost = new Map();
    const postToId = new Map();
    posts.forEach((p, i) => { const id = String(i); idToPost.set(id, p); postToId.set(p, id); });

    const toPayload = (arr) => arr.slice(0, 25).map(p => ({
        id: postToId.get(p),
        platform: p.platform,
        author: [p.author?.displayName, p.author?.handle && '@' + p.author.handle, p.author?.bylineSubtitle]
            .filter(Boolean).join(' · ').slice(0, 200),
        text: (p.text || '').slice(0, 800)
    }));

    const RESPONSE_SCHEMA = {
        type: 'OBJECT',
        properties: {
            results: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        id:     { type: 'STRING' },
                        score:  { type: 'NUMBER' },
                        reason: { type: 'STRING' }
                    },
                    required: ['id', 'score', 'reason']
                }
            }
        },
        required: ['results']
    };

    // One Gemini round over a subset. Returns { ok, byId, status }. ok=false
    // means a hard transport/parse failure — distinct from a per-post 0.
    const callOnce = async (subset) => {
        const instructions = _buildFeedScoreInstructions(prompt, toPayload(subset), mode);
        const body = { contents: [{ parts: [{ text: instructions }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA } };
        try {
            const resp = await fetch(`${FEED_GEMINI_URL}?key=${encodeURIComponent(gemini_api_key)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            if (!resp.ok) {
                const err = await resp.text().catch(() => '');
                console.error(FEED_TAG, `Gemini call failed: ${resp.status} ${err.slice(0, 200)}`);
                return { ok: false, byId: new Map(), status: resp.status };
            }
            const json = await resp.json();
            const textOut = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            let parsed; try { parsed = JSON.parse(textOut); } catch { parsed = { results: [] }; }
            const results = Array.isArray(parsed?.results) ? parsed.results : [];
            // Key by the echoed id (coerced to string — the model may return it as a number).
            return { ok: true, byId: new Map(results.map(r => [String(r.id), r])), status: 200 };
        } catch (e) {
            console.error(FEED_TAG, 'Gemini call threw:', e);
            return { ok: false, byId: new Map(), status: 0, error: e };
        }
    };

    const first = await callOnce(posts);
    if (!first.ok) {
        // Hard failure — flag every post so the caller can tell this apart from a
        // genuine 0-fit and choose NOT to silently drop them.
        const why = first.status ? `Scorer HTTP ${first.status}` : `Scorer error${first.error?.message ? ': ' + String(first.error.message).slice(0, 120) : ''}`;
        return posts.map(p => ({ uuid: p.uuid, score: 0, reason: why, failed: true }));
    }

    const byId = first.byId;

    // Retry ONCE for any posts the model omitted — common when a 25-item batch
    // truncates its output. An omission is NOT a 0-fit, so without this retry
    // those posts would be wrongly dropped (brief mode) or defaulted (no-brief).
    const missing = posts.filter(p => !byId.has(postToId.get(p)));
    if (missing.length) {
        const retry = await callOnce(missing);
        if (retry.ok) for (const [k, v] of retry.byId) byId.set(k, v);
    }

    return posts.map(p => {
        const r = byId.get(postToId.get(p));
        if (!r) return { uuid: p.uuid, score: 0, reason: 'No AI response for this post (omitted twice)', missing: true };
        const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
        return { uuid: p.uuid, score, reason: String(r.reason || '').slice(0, 280) };
    });
}

// ────────────────────────────────────────────────────────────────────
// ENGAGEMENT DRAFTING (human-in-the-loop, queue-only)
// The Feed Watcher does NOT auto-post. For the highest-value posts it
// drafts a value-adding reply (and decides comment vs. repost) in the
// user's voice, then attaches it to the Posts Tracker entry as a QUEUED
// suggestion. Nothing is published until the user approves it.
// ────────────────────────────────────────────────────────────────────

// Turn the structured voice profile pushed from the app into a compact
// natural-language directive the SW prompt can use. Tolerant of a missing
// or partial profile (falls back to a neutral professional voice).
function _buildVoiceGuidance(vp) {
    if (!vp || typeof vp !== 'object') {
        return 'Voice: professional, warm, concise. Sound like a knowledgeable peer, never a marketer.';
    }
    const lines = [];
    const v = vp.voiceMix || {};
    const axis = (label, n, low, high) => {
        if (typeof n !== 'number') return null;
        if (n <= 33) return `${label}: ${low}`;
        if (n >= 67) return `${label}: ${high}`;
        return `${label}: balanced`;
    };
    const axes = [
        axis('Authority', v.authority, 'humble, curious', 'confident expert'),
        axis('Energy', v.energy, 'calm, measured', 'high-energy'),
        axis('Vulnerability', v.vulnerability, 'guarded', 'openly personal'),
        axis('Provocation', v.provocation, 'agreeable', 'takes a clear side'),
        axis('Specificity', v.specificity, 'big-picture', 'concrete numbers & specifics'),
        axis('Intimacy', v.intimacy, 'professional distance', 'warm, second-person')
    ].filter(Boolean);
    if (axes.length) lines.push('Voice mix — ' + axes.join('; ') + '.');
    if (v.rhythm) lines.push(`Rhythm: ${v.rhythm}.`);
    const p = vp.perspective || {};
    if (p.uniqueAngle)   lines.push(`Write from this angle/credential: "${String(p.uniqueAngle).slice(0, 200)}".`);
    if (p.contrarian)    lines.push(`Contrarian belief that can show through: "${String(p.contrarian).slice(0, 200)}".`);
    if (p.forbiddenTakes) lines.push(`NEVER say any of these: ${String(p.forbiddenTakes).slice(0, 200)}.`);
    if (vp.product)  lines.push(`The user builds/represents: ${String(vp.product).slice(0, 160)}.`);
    if (vp.audience) lines.push(`Their audience: ${String(vp.audience).slice(0, 160)}.`);
    return lines.join('\n') || 'Voice: professional, warm, concise.';
}

// Draft ONE engagement for a high-value post via Gemini. Returns
// { action: 'comment'|'repost'|'skip', comment, rationale }.
// The model is told to be SELECTIVE: if it can't add genuine value it must
// return action:'skip' so we never post filler. `comment` is empty for
// 'repost'/'skip'.
async function draftEngagementInExt(post, scoreResult, voiceProfile, brief) {
    const { gemini_api_key } = await chrome.storage.local.get(['gemini_api_key']);
    if (!gemini_api_key) return { action: 'skip', comment: '', rationale: 'No Gemini key shared with extension.' };

    const voice = _buildVoiceGuidance(voiceProfile);
    const authorLine = [post.author?.displayName, post.author?.handle && '@' + post.author.handle, post.author?.bylineSubtitle]
        .filter(Boolean).join(' · ').slice(0, 200);
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Comment spec set ONCE in Voice Studio (vp.commentSpec): tone / goal /
    // length / standing custom instruction. The in-app generator threads these
    // into every comment; the SW drafter MUST do the same or the user's chosen
    // tone (e.g. "funny") is silently ignored. Mirror generateSmartEngagementComment.
    const spec = (voiceProfile && voiceProfile.commentSpec) || {};
    const tone = String(spec.tone || 'casual').trim().toLowerCase();
    const goal = String(spec.goal || 'build_relationship').replace(/_/g, ' ');
    const customInstruction = String(spec.customInstruction || '').trim();
    const platform = String(post.platform || '').toLowerCase();
    const isX = platform.includes('x') || platform.includes('twitter');
    const platformCeil = isX ? 280 : platform.includes('linkedin') ? 400 : platform.includes('reddit') ? 600 : 400;
    const specMax = Number(spec.maxLength);
    const lengthBudget = Number.isFinite(specMax) && specMax > 0 ? Math.min(specMax, platformCeil) : platformCeil;
    // Translate the user's explicit tone choice into a concrete, strongly-worded
    // directive (mirrors generateSmartEngagementComment). A bare "Tone: funny"
    // line gets ignored — the model defaults to a neutral, earnest register. The
    // directive below makes the tone the dominant constraint on the reply.
    const _toneMap = {
        funny:  'TONE — FUNNY (non-negotiable): the reply must be genuinely, noticeably funny — real wit, a dry punchline, playful exaggeration, or an unexpected analogy, anchored to a SPECIFIC detail in the post. A reader should smile or laugh. A flat, earnest, or merely "nice" comment FAILS. Be funny without announcing the joke; avoid corny puns and forced gags.',
        casual: 'TONE — CASUAL: write like you are texting a smart friend — relaxed, contractions, plain words, zero corporate stiffness; warm and easy, never salesy.',
        formal: 'TONE — FORMAL: polished, professional, and precise — complete sentences, no slang, no emojis; measured and credible.',
    };
    const toneDirective = _toneMap[tone]
        || `TONE — ${tone.toUpperCase()}: the reply must read unmistakably in a ${tone} tone from the very first sentence.`;
    const specBlock = `\n\n${toneDirective}\n\nCOMMENT STYLE (set by the user in Voice Studio — honor it exactly):\nRelationship goal: ${goal}.${customInstruction ? ` Extra standing guidance: ${customInstruction}.` : ''}\nHard length budget: keep the reply under ${lengthBudget} characters. The tone directive above is the single most important constraint — make sure the comment clearly satisfies it.`;

    const instructions = `You help a real person grow their ${post.platform} presence by engaging AUTHENTICALLY and adding value. You are drafting a single interaction for the post below. A human will review it before anything is posted.

Today's date is ${today}. CRITICAL: do NOT reference specific years, dates, "this year", "recently", "the latest", current events, trends, tools, or "as of 20XX" claims UNLESS those exact details appear in the post below — your knowledge is not current and any year/recency claim you add from memory (e.g. treating 2024 or 2025 as "now") will be outdated and wrong. React to what they actually wrote; keep it timeless.

WRITER'S VOICE (match it precisely):
${voice}${specBlock}

THE BRIEF (what the user cares about):
"${(brief || '').trim() || '(general professional growth in their field)'}"

THE POST (by ${authorLine || 'unknown author'}):
"""${(post.text || '').slice(0, 1200)}"""
Why it surfaced: ${scoreResult?.reason || 'high relevance to the brief'}

Decide the BEST single action:
- "comment": write a reply that adds real value — a specific insight, a useful experience, a sharp question, or a respectful counterpoint. 1–3 sentences. It MUST quote or clearly reference a SPECIFIC detail from THIS post (a phrase, claim, or number they used) so it could only be posted under this exact post — never a template that fits any post. Lead with the substance, not a warm-up. Hard bans: generic praise ("Great post!", "So true!", "Couldn't agree more"), empty agreement, restating their post back to them, hashtags, links, and emojis unless the voice clearly uses them. Match the WRITER'S VOICE above precisely — the reply must read like THAT specific person, not an interchangeable commenter. Mentioning the user's product should stay natural: only bring it up if the post is genuinely about a problem it solves and it would actually help — briefly, conversationally, never as an ad. Otherwise just write a normal, valuable comment with no pitch.
- "repost": choose this only when the post is genuinely worth amplifying to the user's audience but you have nothing substantive to add in a reply.
- "skip": choose this if engaging would feel forced, low-value, off-brand, or spammy. BE WILLING TO SKIP — quality over quantity.

Return JSON: { action, comment, rationale }. "comment" is the reply text for action="comment" (empty otherwise). "rationale" is one short sentence on why this action.`;

    const body = {
        contents: [{ parts: [{ text: instructions }] }],
        generationConfig: {
            temperature: 0.8,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    action:    { type: 'STRING', enum: ['comment', 'repost', 'skip'] },
                    comment:   { type: 'STRING' },
                    rationale: { type: 'STRING' }
                },
                required: ['action', 'rationale']
            }
        }
    };
    try {
        const resp = await fetch(`${FEED_GEMINI_URL}?key=${encodeURIComponent(gemini_api_key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            const err = await resp.text().catch(() => '');
            console.warn(FEED_TAG, `Draft call failed: ${resp.status} ${err.slice(0, 160)}`);
            return { action: 'skip', comment: '', rationale: `Draft HTTP ${resp.status}` };
        }
        const json = await resp.json();
        const textOut = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        let parsed; try { parsed = JSON.parse(textOut); } catch { parsed = {}; }
        const action = ['comment', 'repost', 'skip'].includes(parsed.action) ? parsed.action : 'skip';
        let comment = String(parsed.comment || '').trim().slice(0, Math.max(lengthBudget, 280));
        if (action !== 'comment') comment = '';
        if (action === 'comment' && !comment) {
            return { action: 'skip', comment: '', rationale: 'Model returned comment action with empty text.' };
        }
        return { action, comment, rationale: String(parsed.rationale || '').slice(0, 240) };
    } catch (e) {
        console.warn(FEED_TAG, 'Draft threw:', e?.message || e);
        return { action: 'skip', comment: '', rationale: `Draft error: ${(e?.message || 'unknown').slice(0, 120)}` };
    }
}

// Promote a scored post above threshold into `answerly_history` (Posts Tracker
// canonical store). Idempotent — dedupes by postUrl against existing history
// and the user's deletion list, mirroring `saveResult` in background.js.
// `engagement` (optional) attaches a QUEUED suggestion the user can approve.
async function promoteFeedPostToTracker(post, scoreResult, engagement) {
    const { answerly_history = [], answerly_removed_posts = [] } = await chrome.storage.local.get([
        'answerly_history', 'answerly_removed_posts'
    ]);
    // Unresolved LinkedIn posts have an EMPTY postUrl now, so URL-based dedup
    // would collapse them all into one. Fall back to the (always-unique) uuid.
    const dedupeUrl = post.postUrl;
    const dedupeUuid = 'feed_' + post.uuid;
    if (answerly_history.some(h => h.uuid === dedupeUuid || (dedupeUrl && (h.postUrl || h.url) === dedupeUrl))) return false;
    if (dedupeUrl && answerly_removed_posts.includes(dedupeUrl)) return false;
    const publishTs = (post.postTimestamp && isFinite(post.postTimestamp) && post.postTimestamp > 0)
        ? new Date(post.postTimestamp).toISOString()
        : new Date().toISOString();
    answerly_history.unshift({
        uuid: 'feed_' + post.uuid,
        platform: post.platform,
        text: post.text,
        body: '',
        url: post.postUrl,
        postUrl: post.postUrl,
        creator: post.author?.displayName || post.author?.handle || 'unknown',
        creatorHandle: post.author?.handle,
        creatorProfileUrl: post.author?.profileUrl,
        creatorBylineSubtitle: post.author?.bylineSubtitle,
        creatorVerified: !!post.author?.verified,
        timestamp: publishTs,
        capturedAt: new Date().toISOString(),
        interactionType: 'FeedOpportunity',
        discoveredVia: 'feed',
        relevancyScore: scoreResult.score,
        relevancyReason: scoreResult.reason,
        cardEngagement: post.cardEngagement,
        // Media + repost/quote context captured by the scraper.
        media: post.media || null,
        isRepost: !!post.isRepost,
        originalPost: post.originalPost || null,
        // Queued engagement suggestion (human-in-the-loop). Present only when
        // the Feed Watcher chose to draft for this post. Nothing posts until
        // the user approves — engagementStatus stays 'queued' until then.
        suggestedAction:    engagement?.action || null,        // 'comment' | 'repost' | null
        suggestedComment:   engagement?.action === 'comment' ? engagement.comment : '',
        engagementRationale: engagement?.rationale || '',
        engagementStatus:   (engagement && engagement.action && engagement.action !== 'skip') ? 'queued' : null
    });
    // Keep a generous Tracker history so a big "Max posts per sweep" (up to 100)
    // doesn't immediately evict everything from earlier sweeps.
    await chrome.storage.local.set({ answerly_history: answerly_history.slice(0, 500) });
    return true;
}

// Per-platform time budget for the human scroll session. The floor is ~3 min,
// but a sweep targeting many posts (the user's "Max posts per sweep") needs
// longer to scroll a virtualized feed deep enough — so the real budget SCALES
// with the target (≈3.5s of scroll/dwell per post) up to FEED_PER_PLATFORM_MAX_MS.
// The whole sweep is still bounded by FEED_TOTAL_BUDGET so it never runs forever.
const FEED_PER_PLATFORM_MS = 3 * 60 * 1000;       // floor — ~3 min of human-paced scrolling
const FEED_PER_PLATFORM_MAX_MS = 8 * 60 * 1000;   // ceiling per platform when chasing a big target
const FEED_MS_PER_POST = 3500;                    // budget granted per targeted post
const FEED_TOTAL_BUDGET_MS = 12 * 60 * 1000;      // hard ceiling regardless of platforms
const FEED_SEEN_CAP = 2000;                   // cross-sweep dedup memory

// ── Engagement caps (keep the agent looking like a selective human) ──
// Defaults are overridable via feed_watch_config. The point: interact a LOT
// over a day, but never spray every post. Quality + spacing avoids flags.
const FEED_DEFAULT_MAX_PER_SWEEP = 3;   // at most N drafts per single sweep
// How many posts a sweep SURFACES (promotes to the Posts Tracker) is DELIBERATELY
// decoupled from the draft cap above: the user wants to SEE the whole feed they
// scrolled past — now user-configurable via "Max posts per sweep" (up to 100) —
// while only a thoughtful FEW get an auto-drafted comment. Conflating the two is
// what made the Tracker show only ~3-5 posts no matter how many were scraped.
// FEED_SURFACE_CAP is the absolute ceiling; the per-sweep target (FEED_TARGET)
// is read from config and clamped to it.
const FEED_SURFACE_CAP = 100;           // absolute hard ceiling on surfaced posts/sweep
// NOTE: there is intentionally NO max-per-day cap. It was removed per user
// request — it silently stopped drafting/surfacing even when there were great
// posts to engage. Pacing is governed by the per-sweep cap + poll interval.
const FEED_ENGAGE_LOG_CAP        = 500; // timestamps kept for stats/diagnostics only

// A URL is engageable only if it points at the POST ITSELF (so a comment lands
// on the right post, never on a profile / recent-activity / search list). X
// status, LinkedIn /feed/update/urn:li:activity or /posts/, Reddit comment URLs.
function _isCommentablePostUrl(u) {
    const s = String(u || '');
    return /(?:x|twitter)\.com\/[^/]+\/status\/\d+/.test(s)
        || /\/feed\/update\/urn:li:(?:activity|share):\d+/.test(s)
        || /linkedin\.com\/posts\/[^/?#]*activity-\d{6,}/.test(s)
        || /reddit\.com\/r\/[^/]+\/comments\//.test(s);
}

// Gaussian helper that's safe inside the SW (gauss() exists elsewhere in this
// file, but the feed module is self-contained so we inline it here).
function _feedGauss(mean, stdev) {
    const u = 1 - Math.random(), v = Math.random();
    return Math.max(50, Math.round(mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
}

// One full sweep across every enabled platform. Scrolls each home feed for
// FEED_PER_PLATFORM_MS at human-like pace, scrapes everything visible per
// step, dedups across the whole mission AND across sweeps, scores in batches,
// then promotes passing posts to the Posts Tracker.
//
// All three extension automations (Posts Tracker poll, Account Finder
// mission, Feed Watcher) share the in-memory `withPollingLock` mutex from
// background.js — so no two ever open competing stealth windows.
let _feedSweepInFlight = false;
// Persist a structured diagnostic of the most recent sweep so the UI can show
// EXACTLY where the pipeline produced zero (no platform / scrape 0 / all
// deduped / Gemini gated / promotion blocked). Survives SW restarts.
async function writeFeedDiag(patch) {
    try {
        const { feed_watch_diag = {} } = await chrome.storage.local.get(['feed_watch_diag']);
        const next = { ...feed_watch_diag, ...patch, updatedAt: new Date().toISOString() };
        await chrome.storage.local.set({ feed_watch_diag: next });
        return next;
    } catch { return null; }
}

// ============================================================
// LinkedIn permalink resolution
// ------------------------------------------------------------
// The NEW LinkedIn home feed exposes NO post URN anywhere we can reach during an
// unfocused stealth sweep: the card DOM carries no data-urn, the JSON responses
// we hooked carried none, and the overflow "Copy link" menu won't open without
// document focus (and clipboard reads are blocked unfocused). The author's
// recent-activity page, however, STILL renders the OLD markup with real
// `urn:li:activity:<id>` ids sitting next to the post text. So to turn a feed
// card into a true permalink we navigate to `${profile}/recent-activity/all/`,
// scroll a few screens to hydrate, scrape [{urn,text}], and text-match the post.
// Correctness-critical: the resolved permalink is BOTH the link the user clicks
// AND the target we comment on, so a wrong match would comment on the wrong post.
// Hence the match is confidence-gated and falls back to leaving postUrl untouched.

const FEED_LI_RESOLVE_AUTHOR_CAP = 12; // max distinct authors visited per sweep

function _liNormalizeText(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')         // strip URLs (truncation differs across views)
        .replace(/[…]/g, ' ')                     // "see more" ellipsis
        .replace(/[^\p{L}\p{N}]+/gu, ' ')         // keep letters/numbers across scripts
        .replace(/\s+/g, ' ')
        .trim();
}

// Confidence-gated match between one feed post's text and a list of
// {urn,text} activities scraped from the author's recent-activity page.
// Returns the best urn or null when nothing clears the bar.
function _liMatchActivity(feedText, activities) {
    const target = _liNormalizeText(feedText);
    if (target.length < 20) return null; // too short to match safely
    const targetPrefix = target.slice(0, 60);
    let best = null;
    for (const a of activities) {
        const cand = _liNormalizeText(a.text);
        if (cand.length < 12) continue;
        const candPrefix = cand.slice(0, 60);
        let score;
        if (cand === target) score = 1;
        else if (cand.startsWith(targetPrefix) || target.startsWith(candPrefix)) score = 0.92;
        else if (cand.includes(targetPrefix) || target.includes(candPrefix)) score = 0.85;
        else {
            // Jaccard token overlap as a softer signal.
            const ts = new Set(target.split(' '));
            const cs = new Set(cand.split(' '));
            let inter = 0;
            for (const t of ts) if (cs.has(t)) inter++;
            const union = ts.size + cs.size - inter;
            score = union ? inter / union : 0;
        }
        if (!best || score > best.score) best = { urn: a.urn, score };
    }
    return best && best.score >= 0.6 ? best.urn : null;
}

// Runs IN the recent-activity tab (serialized into executeScript — no closures).
// Scrapes every activity card's real urn + visible text.
function _LI_SCRAPE_ACTIVITY_FN() {
    const out = [];
    const seen = new Set();
    const cards = document.querySelectorAll(
        '[data-urn*="urn:li:activity:"], [data-id*="urn:li:activity:"], .feed-shared-update-v2'
    );
    for (const card of cards) {
        let urn = card.getAttribute('data-urn') || card.getAttribute('data-id') || '';
        if (!/urn:li:activity:\d+/.test(urn)) {
            const nested = card.querySelector('[data-urn*="urn:li:activity:"], [data-id*="urn:li:activity:"]');
            urn = nested ? (nested.getAttribute('data-urn') || nested.getAttribute('data-id') || '') : '';
        }
        const m = urn.match(/urn:li:activity:\d+/);
        if (!m) continue;
        const activityUrn = m[0];
        if (seen.has(activityUrn)) continue;
        const textEl = card.querySelector(
            '.update-components-text, .feed-shared-text, [data-testid="expandable-text-box"], .feed-shared-inline-show-more-text, .feed-shared-update-v2__description'
        );
        const text = textEl ? (textEl.innerText || '').trim() : '';
        seen.add(activityUrn);
        out.push({ urn: activityUrn, text });
    }
    return out;
}

// Visit one author's recent-activity page once and match ALL of their pending
// posts from a single scrape. Returns Map<post, urn>.
async function resolveLinkedInActivityForAuthor(tabId, posts, deadline) {
    const result = new Map();
    try {
        const sample = posts[0];
        const profileUrl = sample.author?.profileUrl || '';
        const handle = sample.author?.handle || '';
        let base = profileUrl || (handle ? `https://www.linkedin.com/in/${handle}/` : '');
        if (!base) return result;
        base = base.split('?')[0].replace(/\/+$/, '');
        const m = base.match(/\/in\/[^/]+/);
        if (!m) return result;
        const activityUrl = `https://www.linkedin.com${m[0]}/recent-activity/all/`;

        await navigateTab(tabId, activityUrl);
        await new Promise(r => setTimeout(r, _feedGauss(1500, 400)));
        // Scroll a few screens so older activity hydrates (recent-activity paginates).
        for (let i = 0; i < 4; i++) {
            if (Date.now() >= deadline) break;
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => window.scrollBy(0, Math.round(window.innerHeight * 1.4))
                });
            } catch { /* tab may be navigating; ignore */ }
            await new Promise(r => setTimeout(r, _feedGauss(1300, 300)));
        }

        const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: _LI_SCRAPE_ACTIVITY_FN });
        const activities = (res && res.result) || [];
        if (!activities.length) return result;
        for (const p of posts) {
            const urn = _liMatchActivity(p.text || '', activities);
            if (urn) result.set(p, urn);
        }
    } catch (e) {
        console.warn(FEED_TAG, 'resolveLinkedInActivityForAuthor failed:', e?.message || e);
    }
    return result;
}

// ============================================================
// X TIMELINE — API HARVEST (visibility-proof)
// ============================================================
// X freezes its virtualized home timeline whenever the tab is hidden or
// occluded: a background tab renders only ~6 tweets and NEVER paginates, no
// matter how far we scroll — proven live, and a document.visibilityState
// spoof does NOT defeat it (the freeze is enforced at the compositor /
// IntersectionObserver level, not the JS-readable flag). DOM scrolling
// therefore hard-caps every X sweep at 4-6 posts. So for X we do not scrape
// the DOM at all: we replay X's own HomeTimeline GraphQL query using the
// user's live session (cookies + ct0 + the public web bearer) and follow the
// pagination cursor, pulling a full page (~25 tweets) per fetch up to the
// target. Issuing the fetch ourselves sidesteps the freeze entirely. This is
// the SAME replay technique the extension already uses to POST replies (see
// x_net_hook.js / CreateTweet) — proven to work with the live session.
//
// The harvest runs in the page's MAIN world: it needs window.fetch on the
// x.com origin plus X's webpack-held queryId / bearer / feature switches.
// Because async work inside chrome.scripting.executeScript does not reliably
// flush on x.com (see the sendToAgent note), we KICK OFF the async harvest
// into a page global (window.__axh) and then POLL it synchronously until
// done — every executeScript call is a short synchronous read of that global.

// Injected (MAIN world): starts the paginated harvest into window.__axh.
const _X_API_HARVEST_FN = function (target, fallbackBearer) {
    try {
        if (window.__axh && window.__axh.running) return { started: true, already: true };
        window.__axh = { running: true, done: false, posts: [], error: null, pages: 0, mined: null };

        // Last-resort feature set if runtime mining fails (mined values preferred).
        var FALLBACK_SWITCHES = ["rweb_video_screen_enabled","rweb_cashtags_enabled","profile_label_improvements_pcf_label_in_post_enabled","responsive_web_profile_redirect_enabled","rweb_tipjar_consumption_enabled","verified_phone_label_enabled","creator_subscriptions_tweet_preview_api_enabled","responsive_web_graphql_timeline_navigation_enabled","responsive_web_graphql_skip_user_profile_image_extensions_enabled","premium_content_api_read_enabled","communities_web_enable_tweet_community_results_fetch","c9s_tweet_anatomy_moderator_badge_enabled","responsive_web_grok_analyze_button_fetch_trends_enabled","responsive_web_grok_analyze_post_followups_enabled","rweb_cashtags_composer_attachment_enabled","responsive_web_jetfuel_frame","responsive_web_grok_share_attachment_enabled","responsive_web_grok_annotations_enabled","articles_preview_enabled","responsive_web_edit_tweet_api_enabled","rweb_conversational_replies_downvote_enabled","graphql_is_translatable_rweb_tweet_is_translatable_enabled","view_counts_everywhere_api_enabled","longform_notetweets_consumption_enabled","responsive_web_twitter_article_tweet_consumption_enabled","content_disclosure_indicator_enabled","content_disclosure_ai_generated_indicator_enabled","responsive_web_grok_show_grok_translated_post","responsive_web_grok_analysis_button_from_backend","post_ctas_fetch_enabled","freedom_of_speech_not_reach_fetch_enabled","standardized_nudges_misinfo","tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled","longform_notetweets_rich_text_read_enabled","longform_notetweets_inline_media_enabled","responsive_web_grok_image_annotation_enabled","responsive_web_grok_imagine_annotation_enabled","responsive_web_grok_community_note_auto_translation_is_enabled","responsive_web_enhance_cards_enabled"];

        // Mine the live HomeTimeline queryId + feature switches + public bearer
        // from X's webpack modules so we stay correct across X's deploys.
        function mineMeta() {
            if (window.__answerlyXMeta) return window.__answerlyXMeta;
            var meta = { queryId: null, bearer: null, switches: null };
            try {
                var modules = {};
                window.webpackChunk_twitter_responsive_web.push([[Symbol('axh_probe')], {}, function (req) { for (var id in req.m) modules[id] = req.m[id]; }]);
                for (var id in modules) {
                    var src = Function.prototype.toString.call(modules[id]);
                    if (!meta.queryId && src.indexOf('"HomeTimeline"') !== -1) {
                        var qm = src.match(/queryId:\s*"([^"]+)"[\s\S]{0,80}?operationName:\s*"HomeTimeline"/);
                        if (qm) meta.queryId = qm[1];
                        var fsm = src.match(/featureSwitches:\[([^\]]*)\]/);
                        if (fsm) meta.switches = fsm[1].split(',').map(function (s) { return s.replace(/"/g, '').trim(); }).filter(Boolean);
                    }
                    if (!meta.bearer) { var bm = src.match(/AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{40,}/); if (bm) meta.bearer = bm[0]; }
                    if (meta.queryId && meta.bearer && meta.switches) break;
                }
            } catch (e) {}
            if (!meta.bearer) meta.bearer = fallbackBearer;
            if (!meta.queryId) meta.queryId = '-M5P8LkjBRfeMF2MRJfbqA';
            if (!meta.switches || !meta.switches.length) meta.switches = FALLBACK_SWITCHES;
            window.__answerlyXMeta = meta;
            return meta;
        }

        function unwrap(res) { return (res && res.__typename === 'TweetWithVisibilityResults') ? res.tweet : res; }

        // Map a GraphQL tweet_results.result → the SAME post shape scrapeHomeFeed
        // produces, so downstream dedup / scoring / promotion are unchanged.
        function mapTweet(res0) {
            var result = unwrap(res0);
            if (!result || !result.legacy) return null;
            var legacy = result.legacy;
            var statusId = result.rest_id || legacy.id_str;
            if (!statusId) return null;
            var userRes = (((result.core || {}).user_results) || {}).result || {};
            var ul = userRes.legacy || {};
            var handle = ul.screen_name || ((userRes.core || {}).screen_name) || '';
            if (!handle) return null;
            var displayName = ul.name || ((userRes.core || {}).name) || handle;
            var text = '';
            try { text = ((((result.note_tweet || {}).note_tweet_results) || {}).result || {}).text || ''; } catch (e) {}
            if (!text) text = legacy.full_text || '';
            text = text.replace(/\s+https:\/\/t\.co\/\w+$/, '').slice(0, 2000);
            var mediaArr = (legacy.extended_entities && legacy.extended_entities.media) || (legacy.entities && legacy.entities.media) || [];
            var images = [], hasVideo = false, hasGif = false, alt = [];
            for (var i = 0; i < mediaArr.length; i++) {
                var m = mediaArr[i];
                if (m.type === 'photo') { if (m.media_url_https) images.push(m.media_url_https); if (m.ext_alt_text) alt.push(m.ext_alt_text); }
                else if (m.type === 'video') hasVideo = true;
                else if (m.type === 'animated_gif') hasGif = true;
            }
            var media = (images.length || hasVideo || hasGif) ? { images: images.slice(0, 4), hasVideo: hasVideo, hasGif: hasGif, alt: alt.slice(0, 3) } : null;
            if (!text && media) text = alt.length ? ('[Image] ' + alt.join('. ')).slice(0, 1000) : '[Image post]';
            if (!text && !media) return null;
            var isRepost = false, originalPost = null;
            if (legacy.retweeted_status_result && legacy.retweeted_status_result.result) {
                isRepost = true;
                var rt = unwrap(legacy.retweeted_status_result.result);
                var rtl = (rt && rt.legacy) || {};
                var rtu = ((((rt || {}).core || {}).user_results) || {}).result || {};
                originalPost = { text: (rtl.full_text || '').slice(0, 1000), author: (rtu.legacy || {}).screen_name || handle, timestamp: rtl.created_at ? (Date.parse(rtl.created_at) || null) : null };
            } else if (result.quoted_status_result && result.quoted_status_result.result) {
                var q = unwrap(result.quoted_status_result.result);
                var ql = (q && q.legacy) || {};
                var qu = ((((q || {}).core || {}).user_results) || {}).result || {};
                originalPost = { text: (ql.full_text || '').slice(0, 1000), author: (qu.legacy || {}).screen_name || null, timestamp: ql.created_at ? (Date.parse(ql.created_at) || null) : null };
            }
            var likes = legacy.favorite_count || 0;
            var retweets = (legacy.retweet_count || 0) + (legacy.quote_count || 0);
            var replies = legacy.reply_count || 0;
            return {
                uuid: 'x_' + statusId,
                platform: 'X',
                postUrl: 'https://x.com/' + handle + '/status/' + statusId,
                text: text,
                media: media,
                isRepost: isRepost || !!originalPost,
                originalPost: originalPost,
                scrapedAt: new Date().toISOString(),
                postTimestamp: legacy.created_at ? (Date.parse(legacy.created_at) || undefined) : undefined,
                author: { handle: handle, displayName: String(displayName).slice(0, 80), profileUrl: 'https://x.com/' + handle, verified: !!(userRes.is_blue_verified || ul.verified), avatarUrl: ul.profile_image_url_https || undefined },
                cardEngagement: { likes: likes, retweets: retweets, replies: replies, total: likes + retweets + replies }
            };
        }

        // A timeline instruction's entries hold tweets, a bottom cursor, and
        // (for conversation modules) nested items that also carry tweets.
        function collectEntries(entries, seen, posts) {
            var added = 0, nextCursor = null;
            for (var b = 0; b < entries.length; b++) {
                var e = entries[b];
                if (!e || !e.entryId) continue;
                if (e.entryId.indexOf('tweet-') === 0) {
                    var res = ((((e.content || {}).itemContent || {}).tweet_results) || {}).result;
                    var post = mapTweet(res);
                    if (post && !seen.has(post.uuid)) { seen.add(post.uuid); posts.push(post); added++; }
                } else if (e.entryId.indexOf('cursor-bottom-') === 0) {
                    nextCursor = (e.content || {}).value || null;
                } else if (e.content && e.content.items) {
                    for (var c = 0; c < e.content.items.length; c++) {
                        var it = e.content.items[c];
                        var res2 = ((((it.item || {}).itemContent || {}).tweet_results) || {}).result;
                        var post2 = mapTweet(res2);
                        if (post2 && !seen.has(post2.uuid)) { seen.add(post2.uuid); posts.push(post2); added++; }
                    }
                }
            }
            return { added: added, nextCursor: nextCursor };
        }

        (async function () {
            try {
                var meta = mineMeta();
                window.__axh.mined = { queryId: meta.queryId, hasBearer: !!meta.bearer, switchCount: (meta.switches || []).length };
                var ct0 = (document.cookie.match(/ct0=([^;]+)/) || [])[1] || '';
                var features = {}; meta.switches.forEach(function (s) { features[s] = true; });
                var fieldToggles = { withArticlePlainText: false };
                var url = 'https://x.com/i/api/graphql/' + meta.queryId + '/HomeTimeline';
                var seen = new Set(), posts = [], cursor = null;
                for (var pg = 0; pg < 12 && posts.length < target; pg++) {
                    var variables = { count: 20, includePromotedContent: true, latestControlAvailable: true, requestContext: pg === 0 ? 'launch' : 'ptr', withCommunity: true, seenTweetIds: [] };
                    if (cursor) variables.cursor = cursor;
                    var resp;
                    try {
                        resp = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'authorization': 'Bearer ' + meta.bearer, 'x-csrf-token': ct0, 'content-type': 'application/json', 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-client-language': 'en' }, body: JSON.stringify({ variables: variables, features: features, fieldToggles: fieldToggles, queryId: meta.queryId }) });
                    } catch (fe) { window.__axh.error = 'fetch-failed: ' + String(fe && fe.message || fe); break; }
                    if (!resp.ok) { var t = ''; try { t = await resp.text(); } catch (e) {} window.__axh.error = 'http ' + resp.status + (pg === 0 ? (': ' + t.slice(0, 200)) : ''); break; }
                    var j; try { j = await resp.json(); } catch (je) { window.__axh.error = 'bad-json'; break; }
                    var instr = (((j.data || {}).home || {}).home_timeline_urt || {}).instructions || [];
                    var stepAdded = 0, nextCursor = null;
                    for (var a = 0; a < instr.length; a++) {
                        if (!instr[a] || !instr[a].entries) continue;
                        var r = collectEntries(instr[a].entries, seen, posts);
                        stepAdded += r.added;
                        if (r.nextCursor) nextCursor = r.nextCursor;
                    }
                    window.__axh.pages = pg + 1;
                    window.__axh.posts = posts.slice(0, target);
                    if (!nextCursor || stepAdded === 0) break;
                    cursor = nextCursor;
                    await new Promise(function (rs) { setTimeout(rs, 650 + Math.random() * 500); });
                }
                window.__axh.posts = posts.slice(0, target);
                window.__axh.done = true; window.__axh.running = false;
            } catch (e) {
                window.__axh.error = String(e && e.message || e);
                window.__axh.done = true; window.__axh.running = false;
            }
        })();

        return { started: true };
    } catch (e) {
        return { started: false, error: String(e && e.message || e) };
    }
};

// Injected (MAIN world): reads harvest progress/result from window.__axh.
const _X_API_POLL_FN = function () {
    var s = window.__axh;
    if (!s) return { missing: true };
    return { done: !!s.done, running: !!s.running, count: (s.posts || []).length, pages: s.pages || 0, error: s.error || null, mined: s.mined || null, posts: s.posts || [] };
};

// Service-worker side: drive the MAIN-world harvest and poll to completion.
// Returns up to `target` posts in scrapeHomeFeed's shape (or [] + error).
async function harvestXFeedViaApi(tabId, target) {
    // Public X web-app bearer — shipped in every x.com page, identical for all
    // users; NOT user auth (the session is the cookies + ct0). Used only when
    // runtime mining of the bearer fails.
    const PUBLIC_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
    try {
        const startExec = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _X_API_HARVEST_FN, args: [target, PUBLIC_BEARER] });
        const started = startExec?.[0]?.result;
        if (!started || started.started === false) {
            return { posts: [], pages: 0, error: 'start-failed: ' + (started && started.error || 'no result'), mined: null };
        }
        const deadline = Date.now() + 75000;
        let last = { count: 0, pages: 0, error: null, mined: null, posts: [] };
        while (Date.now() < deadline) {
            await dsleep(1200);
            let pollExec;
            try { pollExec = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _X_API_POLL_FN }); }
            catch (e) { continue; }
            const s = pollExec?.[0]?.result;
            if (!s || s.missing) continue;
            last = s;
            if (s.done) break;
        }
        return { posts: last.posts || [], pages: last.pages || 0, error: last.error || null, mined: last.mined || null, count: last.count || 0 };
    } catch (e) {
        return { posts: [], pages: 0, error: 'harvest-exc: ' + (e?.message || e), mined: null };
    }
}

// ============================================================
// LINKEDIN FEED — API HARVEST (visibility-proof)
// ============================================================
// LinkedIn freezes its virtualized home feed exactly like X: while the tab is
// hidden/occluded it renders only ~4 server-rendered cards, never imports its
// pagination chunk, never fires a feed fetch, and a document.visibilityState
// spoof does NOT defeat it (proven live with the Chrome devtools session —
// scrollHeight stays frozen at one viewport, zero /voyager calls even on an
// explicit "new posts" click). DOM scrolling therefore hard-caps every
// LinkedIn sweep at ~4-9 posts. So, mirroring the X fix, we replay LinkedIn's
// own feed endpoint with the user's live session and follow the pagination
// token, pulling ~20 updates per fetch up to the target. Issuing the fetch
// ourselves sidesteps the freeze. (Proven live: 2 fetches → 41 unique posts,
// 0 overlap, 100% with text+author, while the DOM stayed frozen.)
//
// The web app uses the Voyager REST feed endpoint /voyager/api/feed/updatesV2
// (the GraphQL feed query's queryId never loads while the tab is hidden, so it
// is unobtainable here; the REST endpoint still serves the same feed). It
// returns LinkedIn's "normalized" JSON: a flat `included[]` array of entities
// each keyed by `entityUrn`, plus `data.metadata.paginationToken` for the next
// page. CSRF = the JSESSIONID cookie value, echoed in the `csrf-token` header
// (the same scheme the extension already uses for Voyager reads); li_at rides
// along via credentials:include.
//
// Same MAIN-world start-then-poll pattern as X: async work inside
// chrome.scripting.executeScript does not reliably flush on these origins, so
// we kick the harvest into window.__alh and poll it synchronously.

// Injected (MAIN world): starts the paginated harvest into window.__alh.
const _LI_API_HARVEST_FN = function (target) {
    try {
        if (window.__alh && window.__alh.running) return { started: true, already: true };
        window.__alh = { running: true, done: false, posts: [], error: null, pages: 0, reqs: 0, rateLimited: false };

        // CSRF token for Voyager == the JSESSIONID cookie value (e.g. ajax:123…).
        function getCsrf() {
            var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
            return m ? m[1] : null;
        }

        // The normalized response is a flat list; entities reference each other
        // by urn. Index it so we can resolve socialDetail → activity counts.
        function makeIndex(included) {
            var ix = {};
            for (var i = 0; i < included.length; i++) {
                var e = included[i];
                if (e && e.entityUrn) ix[e.entityUrn] = e;
            }
            return ix;
        }

        // LinkedIn activity/share IDs encode their creation time in the top 41
        // bits of the 63-bit id (ms since epoch) → recover postTimestamp.
        function urnTime(idStr) {
            try { return Number(BigInt(idStr) >> 22n); } catch (e) { return undefined; }
        }

        // ── Real image-URL extraction (LIVE-VERIFIED against the feed) ──
        // LinkedIn images are `vectorImage` objects: { rootUrl, artifacts:[ {
        // width, height, fileIdentifyingUrlPathSegment } ] }. The full URL is
        // rootUrl + the widest artifact's path segment. We pick the WIDEST
        // artifact for best quality (the ladder is e.g. 1280/1024/800/480/160/20).
        function vectorImageUrl(vi) {
            try {
                if (!vi || !vi.rootUrl || !vi.artifacts || !vi.artifacts.length) return null;
                var best = null;
                for (var i = 0; i < vi.artifacts.length; i++) {
                    var a = vi.artifacts[i];
                    if (!a || !a.fileIdentifyingUrlPathSegment) continue;
                    if (!best || (a.width || 0) > (best.width || 0)) best = a;
                }
                return best ? (vi.rootUrl + best.fileIdentifyingUrlPathSegment) : null;
            } catch (e) { return null; }
        }

        // Shape-agnostic recursive collector. LinkedIn nests images differently
        // across ImageComponent / ArticleComponent / video thumbnails / external
        // shares, and a vectorImage may be inline OR a "*"-prefixed urn reference
        // into included[]. Rather than hard-code one path (brittle — LinkedIn
        // reshuffles these), we walk the content subtree, deref urn refs against
        // the index, and treat ANY { rootUrl, artifacts } object as an image.
        // Proven live: 20 updates → 16 images (incl. a 4-image post) + 3 videos,
        // every URL on media.licdn.com.
        function collectMedia(node, ix, out, seen, depth) {
            if (node == null || depth > 6 || out.images.length >= 8) return;
            if (typeof node === 'string') {
                // "*field" values hold urn refs into included[]; follow them once.
                if (node.indexOf('urn:li:') === 0 && ix[node] && !seen.has(node)) {
                    seen.add(node);
                    collectMedia(ix[node], ix, out, seen, depth + 1);
                }
                return;
            }
            if (Array.isArray(node)) {
                for (var i = 0; i < node.length && out.images.length < 8; i++) collectMedia(node[i], ix, out, seen, depth + 1);
                return;
            }
            if (typeof node !== 'object') return;
            if (node.rootUrl && node.artifacts) {        // a vectorImage
                var u = vectorImageUrl(node);
                if (u && out.images.indexOf(u) === -1) out.images.push(u);
                return;                                   // don't recurse into artifacts
            }
            if (typeof node.accessibilityText === 'string' && node.accessibilityText) out.alt.push(node.accessibilityText.slice(0, 200));
            else if (typeof node.altText === 'string' && node.altText) out.alt.push(node.altText.slice(0, 200));
            var t = node['$type'] || '';
            if (/LinkedInVideo|VideoPlayMetadata|\.Video/i.test(t)) out.hasVideo = true;
            for (var k in node) {
                if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                if (k === '$type' || k === 'entityUrn') continue;
                collectMedia(node[k], ix, out, seen, depth + 1);
                if (out.images.length >= 8) break;
            }
        }

        // Map one fs_updateV2 entity → the SAME post shape scrapeHomeFeed
        // produces for LinkedIn, so downstream dedup / scoring / promotion are
        // unchanged: uuid `li_<fullUrn>`, postUrl /feed/update/<fullUrn>/.
        function mapUpdate(u, ix) {
            if (!u) return null;
            var eUrn = u.entityUrn || u.dashEntityUrn || '';
            var am = eUrn.match(/urn:li:activity:\d+/);
            var sm = eUrn.match(/urn:li:(?:share|ugcPost):\d+/);
            var fullUrn = am ? am[0] : (sm ? sm[0] : null);
            if (!fullUrn) return null;                       // skip ads / promos / non-post modules
            var idDigits = (fullUrn.match(/:(\d+)$/) || [])[1] || '';

            // text — the post commentary.
            var text = '';
            try { text = (u.commentary && u.commentary.text && u.commentary.text.text) || ''; } catch (e) {}

            // author — name + profile/company permalink (drop tracking query).
            var actor = u.actor || {};
            var authorName = '';
            try { authorName = (actor.name && actor.name.text) || ''; } catch (e) {}
            var navTarget = '';
            try { navTarget = (actor.navigationContext && actor.navigationContext.actionTarget) || ''; } catch (e) {}
            var profileUrl = (navTarget || '').split('?')[0];
            var handle = '';
            var hm = profileUrl.match(/\/(?:in|company)\/([^/?#]+)/);
            if (hm) { try { handle = decodeURIComponent(hm[1]); } catch (e) { handle = hm[1]; } }

            // media — extract REAL image URLs (+ alt) so the Posts Tracker can
            // render them. Produces the SAME shape the X harvest does
            // ({ images, alt, hasVideo, hasGif }) which the tracker UI already
            // renders. content may be inline or a "*content" urn ref.
            var content = u.content;
            if (!content && u['*content']) content = ix[u['*content']];
            content = content || {};
            var mo = { images: [], alt: [], hasVideo: false, hasGif: false };
            try { collectMedia(content, ix, mo, new Set(), 0); } catch (e) {}
            // Reshare carrying no own media → surface the ORIGINAL post's image.
            if (!mo.images.length && !mo.hasVideo) {
                try {
                    var rsc = u.resharedUpdate && (u.resharedUpdate.content || (u.resharedUpdate['*content'] ? ix[u.resharedUpdate['*content']] : null));
                    if (rsc) collectMedia(rsc, ix, mo, new Set(), 0);
                } catch (e) {}
            }
            var cType = (content['$type'] || '').split('.').pop();
            if (/Video/i.test(cType)) mo.hasVideo = true;
            var media = (mo.images.length || mo.hasVideo || mo.hasGif)
                ? { images: mo.images.slice(0, 4), alt: mo.alt.slice(0, 3), hasVideo: !!mo.hasVideo, hasGif: !!mo.hasGif }
                : null;
            if (!text) {
                // wordless post — give the scorer some context.
                var artTitle = '';
                try { artTitle = (content.title && content.title.text) || ''; } catch (e) {}
                if (artTitle) text = artTitle.slice(0, 1000);
                else if (media) text = media.images.length ? '[Image post]' : '[Media post]';
            }
            text = (text || '').slice(0, 2000);

            // reshare — flag + best-effort original text/author.
            var isRepost = !!(u.resharedUpdate || u['*resharedUpdate']);
            var originalPost = null;
            try {
                var rs = u.resharedUpdate;
                if (rs) {
                    var rsText = (rs.commentary && rs.commentary.text && rs.commentary.text.text) || '';
                    var rsActor = (rs.actor && rs.actor.name && rs.actor.name.text) || '';
                    if (rsText || rsActor) originalPost = { text: rsText.slice(0, 1000), author: rsActor || null, timestamp: null };
                }
            } catch (e) {}

            if (!text && !media) return null;

            // engagement — resolve *socialDetail → *totalSocialActivityCounts.
            var reactions = 0, comments = 0, shares = 0;
            try {
                var sd = ix[u['*socialDetail']];
                var counts = sd ? ix[sd['*totalSocialActivityCounts']] : null;
                if (!counts && sd && sd.totalSocialActivityCounts) counts = sd.totalSocialActivityCounts;
                if (counts) {
                    reactions = counts.numLikes || 0;
                    comments = counts.numComments || 0;
                    shares = counts.numShares || 0;
                }
            } catch (e) {}

            return {
                uuid: 'li_' + fullUrn,
                platform: 'LinkedIn',
                postUrl: 'https://www.linkedin.com/feed/update/' + fullUrn + '/',
                needsPermalinkResolution: false,   // the API gives us the true permalink
                text: text,
                media: media,
                isRepost: isRepost,
                originalPost: originalPost,
                scrapedAt: new Date().toISOString(),
                postTimestamp: idDigits ? urnTime(idDigits) : undefined,
                author: {
                    handle: handle,
                    displayName: String(authorName || handle || 'LinkedIn member').slice(0, 80),
                    profileUrl: profileUrl || (handle ? ('https://www.linkedin.com/in/' + handle) : ''),
                    verified: false
                },
                cardEngagement: (reactions || comments || shares)
                    ? { reactions: reactions, comments: comments, shares: shares, total: reactions + comments + shares }
                    : undefined
            };
        }

        (async function () {
            try {
                var csrf = getCsrf();
                if (!csrf) { window.__alh.error = 'no-csrf (not logged in?)'; window.__alh.done = true; window.__alh.running = false; return; }
                var headers = {
                    'csrf-token': csrf,
                    'accept': 'application/vnd.linkedin.normalized+json+2.1',
                    'x-restli-protocol-version': '2.0.0',
                    'x-li-lang': 'en_US'
                };
                // ── Human-paced pagination (anti-ban) ──
                // A real person scrolling LinkedIn triggers a feed fetch every few
                // SECONDS, never sub-second and never in a perfectly even cadence.
                // So we (a) randomise the page size per request (15–25) so the
                // request signature varies, (b) wait a gaussian ~3.7s (2.2–6.5s)
                // between pages, (c) hard-cap pages/sweep low (≤6 → a small,
                // human-plausible burst), and (d) ABORT + flag on any rate-limit /
                // bot-block status so the caller can cool down for a long window
                // instead of hammering the endpoint (which is what flags accounts).
                function gjit(mean, std) {
                    var u = 0, v = 0;
                    while (!u) u = Math.random();
                    while (!v) v = Math.random();
                    var n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
                    return Math.max(0, mean + n * std);
                }
                var maxPages = Math.min(6, Math.max(2, Math.ceil(target / 16) + 1));
                var seen = new Set(), posts = [], start = 0, token = null, reqs = 0;
                for (var pg = 0; pg < maxPages && posts.length < target; pg++) {
                    var PAGE = 15 + Math.floor(Math.random() * 11);   // 15–25, varies per request
                    // chronFeed = chronological (least-filtered, broadest coverage).
                    // start + paginationToken together page cleanly (0 overlap, live-proven).
                    var url = '/voyager/api/feed/updatesV2?count=' + PAGE + '&q=chronFeed&start=' + start +
                              (token ? ('&paginationToken=' + encodeURIComponent(token)) : '');
                    var resp;
                    try { resp = await fetch(url, { method: 'GET', credentials: 'include', headers: headers }); }
                    catch (fe) { window.__alh.error = 'fetch-failed: ' + String(fe && fe.message || fe); break; }
                    reqs++;
                    // Rate-limit / bot-block → STOP immediately and signal backoff.
                    // 429 = too many requests, 999 = LinkedIn's "request denied" bot
                    // wall, 403 = forbidden. Pushing past these is exactly what gets
                    // an account flagged, so we bail and let the SW cool down long.
                    if (resp.status === 429 || resp.status === 999 || resp.status === 403) {
                        window.__alh.rateLimited = true;
                        window.__alh.error = 'rate-limited: http ' + resp.status;
                        break;
                    }
                    if (!resp.ok) {
                        var t = ''; try { t = await resp.text(); } catch (e) {}
                        window.__alh.error = 'http ' + resp.status + (pg === 0 ? (': ' + t.slice(0, 160)) : '');
                        break;
                    }
                    var j; try { j = await resp.json(); } catch (je) { window.__alh.error = 'bad-json'; break; }
                    var included = j.included || [];
                    var ix = makeIndex(included);
                    var updates = included.filter(function (e) { return /UpdateV2$/.test(e['$type'] || ''); });
                    var stepAdded = 0;
                    for (var k = 0; k < updates.length; k++) {
                        var post = mapUpdate(updates[k], ix);
                        if (post && !seen.has(post.uuid)) { seen.add(post.uuid); posts.push(post); stepAdded++; }
                    }
                    token = (j.data && j.data.metadata && j.data.metadata.paginationToken) || null;
                    start += updates.length || PAGE;
                    window.__alh.pages = pg + 1;
                    window.__alh.reqs = reqs;
                    window.__alh.posts = posts.slice(0, target);
                    if (!token || updates.length === 0) break;   // genuine end of feed
                    await new Promise(function (rs) { setTimeout(rs, Math.min(6500, Math.max(2200, gjit(3700, 1100)))); });
                }
                window.__alh.posts = posts.slice(0, target);
                window.__alh.done = true; window.__alh.running = false;
            } catch (e) {
                window.__alh.error = String(e && e.message || e);
                window.__alh.done = true; window.__alh.running = false;
            }
        })();

        return { started: true };
    } catch (e) {
        return { started: false, error: String(e && e.message || e) };
    }
};

// Injected (MAIN world): reads harvest progress/result from window.__alh.
const _LI_API_POLL_FN = function () {
    var s = window.__alh;
    if (!s) return { missing: true };
    return { done: !!s.done, running: !!s.running, count: (s.posts || []).length, pages: s.pages || 0, reqs: s.reqs || 0, rateLimited: !!s.rateLimited, error: s.error || null, posts: s.posts || [] };
};

// Service-worker side: drive the MAIN-world harvest and poll to completion.
// Returns up to `target` posts in scrapeHomeFeed's LinkedIn shape (or [] + error).
async function harvestLinkedInFeedViaApi(tabId, target) {
    try {
        const startExec = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _LI_API_HARVEST_FN, args: [target] });
        const started = startExec?.[0]?.result;
        if (!started || started.started === false) {
            return { posts: [], pages: 0, error: 'start-failed: ' + (started && started.error || 'no result') };
        }
        // Longer deadline: human-paced pagination (gaussian ~3.7s/page, ≤6 pages)
        // can legitimately take ~40s. We poll the whole time and keep whatever
        // accumulated if it runs long.
        const deadline = Date.now() + 75000;
        let last = { count: 0, pages: 0, reqs: 0, rateLimited: false, error: null, posts: [] };
        while (Date.now() < deadline) {
            await dsleep(1200);
            let pollExec;
            try { pollExec = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _LI_API_POLL_FN }); }
            catch (e) { continue; }
            const s = pollExec?.[0]?.result;
            if (!s || s.missing) continue;
            last = s;
            if (s.done) break;
        }
        return { posts: last.posts || [], pages: last.pages || 0, reqs: last.reqs || 0, rateLimited: !!last.rateLimited, error: last.error || null, count: last.count || 0 };
    } catch (e) {
        return { posts: [], pages: 0, reqs: 0, rateLimited: false, error: 'harvest-exc: ' + (e?.message || e) };
    }
}

async function runFeedWatchSweep() {
    if (_feedSweepInFlight) {
        console.log(FEED_TAG, 'Sweep already running — skipping overlap.');
        await writeFeedDiag({ lastSkip: 'in-flight', lastSkipAt: new Date().toISOString() });
        return { skipped: 'in-flight' };
    }
    // Overlap guard with the OTHER two automations. background.js owns the
    // shared lock; if it's busy we'll get a {skipped: 'busy'} reply and
    // gracefully wait for the next alarm tick. Without this, the feed sweep
    // could open a stealth window while the posts-tracker sweep is mid-cycle
    // → two windows hitting x.com at once → bot-grade fingerprint.
    if (typeof self.withPollingLock === 'function') {
        return self.withPollingLock('feed-watch', _runFeedWatchSweepInner);
    }
    return _runFeedWatchSweepInner();
}

async function _runFeedWatchSweepInner() {
    const cfg = await loadFeedWatchConfig();
    if (!cfg) {
        await writeFeedDiag({ lastSkip: 'no-config', lastSkipAt: new Date().toISOString(), note: 'No feed_watch_config saved. Toggle a platform in Feed Watcher so the config is pushed to the extension.' });
        return { skipped: 'no-config' };
    }
    const enabled = Object.entries(cfg.enabled || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
    if (enabled.length === 0) {
        await writeFeedDiag({ lastSkip: 'no-platform', lastSkipAt: new Date().toISOString(), note: 'No platform is toggled ON. Enable X / LinkedIn / Reddit in Feed Watcher.', enabledPlatforms: [] });
        return { skipped: 'no-platform' };
    }

    // Don't run while a Finder mission is alive (its own window will be open).
    if (activeMission && ['scanning', 'preparing', 'paused', 'cooldown'].includes(activeMission.status)) {
        console.log(FEED_TAG, 'Discovery mission active — deferring feed sweep.');
        await writeFeedDiag({ lastSkip: 'discovery_active', lastSkipAt: new Date().toISOString(), note: 'An Account Finder mission is running — the sweep deferred to avoid two stealth windows.' });
        return { skipped: 'discovery_active' };
    }

    _feedSweepInFlight = true;
    let win;
    let priorFocusedWindowId = null;
    const freshlyScraped = [];
    // How many posts this sweep should pull into the dashboard — the user's
    // "Max posts per sweep" (1–100, default 50). Drives the scroll loop's target,
    // the surfaced-set cap, and the scaled per-platform time budget.
    const FEED_TARGET = Math.max(1, Math.min(FEED_SURFACE_CAP, Number(cfg.maxPostsPerSweep) || 50));
    const sweepStart = Date.now();
    const sweepDeadline = sweepStart + FEED_TOTAL_BUDGET_MS;
    let promoted = 0;
    let scored = 0;

    // ── Live diagnostic accumulator (persisted at each phase) ──
    const { gemini_api_key: _diagKey } = await chrome.storage.local.get(['gemini_api_key']);
    const diag = {
        startedAt: new Date().toISOString(),
        lastSkip: null,
        enabledPlatforms: enabled,
        geminiKeyPresent: !!_diagKey,
        platforms: {},           // per-platform: { navOk, blocked, found, steps, scrapeDiag, error }
        dedupSkipped: 0,         // scraped but already seen / already in tracker
        freshlyScraped: 0,
        scoreMode: null,
        scored: 0,
        passing: 0,
        promoted: 0,
        drafted: 0,
        error: null
    };
    await writeFeedDiag(diag);

    try {
        // ── Build dedup sets ──
        // The user wants the WHOLE feed surfaced each sweep (≥ maxPerSweep), not
        // just the handful of posts that are new since the last sweep. So we do
        // NOT exclude a post merely because we scraped it in a previous sweep —
        // the old cross-sweep `feed_watch_seen_uuids` gate was starving the feed
        // (e.g. 227 seen → only ~4 ever surfaced). We exclude ONLY posts that are
        // ALREADY in the Tracker, by BOTH postUrl and the `feed_<uuid>` id (the
        // latter covers LinkedIn, whose posts have an empty postUrl). This keeps
        // the Tracker free of duplicates while letting every sweep re-pull the
        // full feed and top the Tracker up toward maxPerSweep. `seenThisSweep`
        // dedupes within a single sweep across scroll steps.
        const { answerly_history = [], feed_watch_seen_uuids = [] } =
            await chrome.storage.local.get(['answerly_history', 'feed_watch_seen_uuids']);
        const seenThisSweep = new Set();
        const alreadyPromotedUrls = new Set(answerly_history.map(h => h.postUrl || h.url).filter(Boolean));
        const alreadyPromotedUuids = new Set(
            answerly_history.map(h => h.uuid).filter(Boolean)
        );
        diag.seenMemory = (feed_watch_seen_uuids || []).length;
        diag.trackerSize = answerly_history.length;

        // Remember which window the user was looking at so we can hand focus
        // back when the scrape phase ends (see finally).
        try { priorFocusedWindowId = (await chrome.windows.getLastFocused())?.id ?? null; } catch {}

        // Open the sweep window FOCUSED. X/LinkedIn freeze feed loading while
        // their tab is hidden/occluded — a background popup loads only ~4-5
        // posts and never fetches more (proven live). The window must be
        // genuinely visible for the feed to keep loading toward the 20-post
        // target; a JS visibilityState spoof is not enough on its own.
        win = await openStealthWindow(FEED_HOME_URL[enabled[0]], { focused: true });
        // getTabFromWindow returns the tab ID (a number) — NOT a tab object.
        // The old code did `tab.id` on that number → undefined, and
        // chrome.tabs.update(undefined, …) redirects the user's CURRENTLY
        // ACTIVE tab instead of the stealth popup (the "it redirects me to X"
        // bug), while sendToAgent(undefined, …) messaged the wrong tab so
        // nothing ever scraped and the sweep stalled after a couple steps.
        const tabId = await getTabFromWindow(win);
        if (!tabId) throw new Error('Could not get feed-sweep tab id');

        // ── PHASE 1: per-platform human scroll session ──
        for (const platform of enabled) {
            const pdiag = { navOk: false, blocked: null, found: 0, steps: 0, rawSeenOnPage: 0, dedupSkipped: 0, lastScrapeDiag: null, error: null };
            diag.platforms[platform] = pdiag;
            await writeFeedDiag(diag);
            if (Date.now() >= sweepDeadline) { pdiag.error = 'global-deadline-before-start'; break; }
            const url = FEED_HOME_URL[platform];
            console.log(FEED_TAG, `Sweeping ${platform} → ${url}`);
            try {
                // navigateTab waits for the page to finish loading AND ensures
                // discovery_agent.js is injected — without that guarantee the
                // scrape/scroll messages had nothing to talk to.
                await navigateTab(tabId, url, { lenient: true });
                pdiag.navOk = true;
                // Keep the sweep window genuinely VISIBLE for this platform's
                // scrape. X/LinkedIn freeze feed loading when their tab is
                // hidden/occluded, so if the user clicked back to their own
                // window we re-raise the sweep window before scrolling. The
                // MAIN-world visibility spoof is kept as a secondary guard
                // (helps when the window is only partially occluded). Both are
                // required because the spoof alone does NOT defeat the
                // compositor-level freeze (proven live).
                try { if (win) await chrome.windows.update(win.id, { focused: true }); } catch {}
                await injectVisibilitySpoof(tabId);
            } catch (e) {
                console.warn(FEED_TAG, `${platform} nav failed:`, e?.message || e);
                pdiag.error = 'nav-failed: ' + (e?.message || e);
                await writeFeedDiag(diag);
                continue;
            }
            // Initial hydration — feeds need a moment before the first cards land.
            await new Promise(r => setTimeout(r, _feedGauss(7000, 1400)));

            const block = await sendToAgent(tabId, { type: 'DISCOVERY_DETECT_BLOCK' });
            if (block?.blocked) {
                console.warn(FEED_TAG, `${platform} blocked (${block.type}) — skipping.`);
                pdiag.blocked = block.type || 'blocked';
                pdiag.error = `blocked: ${block.type} (${block.indicator || ''}) — likely not logged in, or a login/captcha wall in the stealth window. Open ${url} in a normal tab and log in.`;
                await writeFeedDiag(diag);
                continue;
            }

            // ── X: harvest the timeline via its own GraphQL API ──
            // X freezes its virtualized home timeline whenever the tab is hidden
            // or occluded (enforced at the compositor level — a visibility spoof
            // does NOT defeat it), so DOM scrolling hard-caps every sweep at ~4-6
            // posts. Instead we replay X's own HomeTimeline GraphQL query with the
            // user's live session and follow the pagination cursor; issuing the
            // fetch ourselves sidesteps the freeze and pulls 25+ tweets/page up to
            // the target. (Proven live: 4 fetches → 129 unique tweets.) Falls back
            // to the DOM scroll loop below only if the replay yields nothing.
            if (platform === 'X') {
                const remaining = Math.max(0, FEED_TARGET - freshlyScraped.length);
                let apiAdded = 0;
                if (remaining > 0) {
                    let h = null;
                    try {
                        h = await harvestXFeedViaApi(tabId, remaining);
                    } catch (e) {
                        console.warn(FEED_TAG, 'X: API harvest threw:', e?.message || e);
                        pdiag.error = 'x-api-harvest: ' + (e?.message || e);
                    }
                    if (h) {
                        pdiag.apiHarvest = { pages: h.pages || 0, returned: (h.posts || []).length, error: h.error || null, mined: h.mined || null };
                        for (const p of (h.posts || [])) {
                            if (!p?.uuid) continue;
                            pdiag.rawSeenOnPage++;
                            if (seenThisSweep.has(p.uuid)) continue;
                            if (p.postUrl && alreadyPromotedUrls.has(p.postUrl)) { pdiag.dedupSkipped++; diag.dedupSkipped++; continue; }
                            if (alreadyPromotedUuids.has('feed_' + p.uuid)) { pdiag.dedupSkipped++; diag.dedupSkipped++; continue; }
                            seenThisSweep.add(p.uuid);
                            freshlyScraped.push(p);
                            apiAdded++;
                            if (freshlyScraped.length >= FEED_TARGET) break;
                        }
                        pdiag.found = apiAdded;
                        if (apiAdded > 0) {
                            try { await chrome.storage.local.set({ feed_watch_buffer: freshlyScraped.slice(-FEED_TARGET) }); } catch {}
                            diag.freshlyScraped = freshlyScraped.length;
                        }
                        console.log(FEED_TAG, `X: API harvest +${apiAdded} (pages ${pdiag.apiHarvest.pages}, returned ${pdiag.apiHarvest.returned}, err ${pdiag.apiHarvest.error || 'none'})`);
                        await writeFeedDiag(diag);
                    }
                }
                if (apiAdded > 0) continue; // done with X — skip the DOM scroll loop
                if (remaining > 0) console.warn(FEED_TAG, 'X: API harvest returned 0 — falling back to DOM scroll.');
            }

            // ── LinkedIn: harvest the feed via its own Voyager API ──
            // Same compositor-level freeze as X (proven live: a hidden tab
            // renders only ~4 SSR cards, never paginates, fires ZERO /voyager
            // calls — even on an explicit "new posts" click — and a visibility
            // spoof does not help), so DOM scrolling hard-caps the sweep at a
            // handful of posts. Instead we replay LinkedIn's own
            // /voyager/api/feed/updatesV2 endpoint with the user's live session
            // and follow the pagination token; issuing the fetch ourselves
            // sidesteps the freeze and pulls ~20 posts/page up to the target.
            // (Proven live: 2 fetches → 41 unique posts, 0 overlap, 100% with
            // text+author.) Falls back to the DOM scroll loop only if the replay
            // yields nothing.
            if (platform === 'LinkedIn') {
                // ── Rate-limit backoff gate (anti-ban) ──
                // If a PRIOR harvest hit LinkedIn's rate-limit / bot-block wall
                // (429 / 999 / 403), we recorded a cooldown timestamp. While it's
                // active we DON'T touch the Voyager endpoint at all — the safest
                // possible response to a flag is to go quiet for a long window.
                let _liBackoff = 0;
                try { _liBackoff = (await chrome.storage.local.get(['li_harvest_backoff_until'])).li_harvest_backoff_until || 0; } catch {}
                if (Date.now() < _liBackoff) {
                    const mins = Math.ceil((_liBackoff - Date.now()) / 60000);
                    pdiag.error = `li-backoff: rate-limit cooldown active (~${mins}min left) — skipping LinkedIn this sweep to protect the account`;
                    console.warn(FEED_TAG, `LinkedIn: in rate-limit backoff (~${mins}min left) — skipping harvest.`);
                    await writeFeedDiag(diag);
                    continue;
                }
                const remaining = Math.max(0, FEED_TARGET - freshlyScraped.length);
                let apiAdded = 0;
                if (remaining > 0) {
                    let h = null;
                    try {
                        h = await harvestLinkedInFeedViaApi(tabId, remaining);
                    } catch (e) {
                        console.warn(FEED_TAG, 'LinkedIn: API harvest threw:', e?.message || e);
                        pdiag.error = 'li-api-harvest: ' + (e?.message || e);
                    }
                    if (h) {
                        pdiag.apiHarvest = { pages: h.pages || 0, returned: (h.posts || []).length, reqs: h.reqs || 0, rateLimited: !!h.rateLimited, error: h.error || null };
                        // LinkedIn signalled rate-limiting → arm a long cooldown
                        // (45–75 min, randomised) so the next sweeps leave it alone.
                        if (h.rateLimited) {
                            const backoffMs = 45 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000);
                            try { await chrome.storage.local.set({ li_harvest_backoff_until: Date.now() + backoffMs }); } catch {}
                            pdiag.error = `li-rate-limited: ${h.error || 'http 429/999'} — backing off ${Math.round(backoffMs / 60000)}min to protect the account`;
                            console.warn(FEED_TAG, `LinkedIn: RATE-LIMITED — backing off ${Math.round(backoffMs / 60000)}min.`);
                        }
                        for (const p of (h.posts || [])) {
                            if (!p?.uuid) continue;
                            pdiag.rawSeenOnPage++;
                            if (seenThisSweep.has(p.uuid)) continue;
                            if (p.postUrl && alreadyPromotedUrls.has(p.postUrl)) { pdiag.dedupSkipped++; diag.dedupSkipped++; continue; }
                            if (alreadyPromotedUuids.has('feed_' + p.uuid)) { pdiag.dedupSkipped++; diag.dedupSkipped++; continue; }
                            seenThisSweep.add(p.uuid);
                            freshlyScraped.push(p);
                            apiAdded++;
                            if (freshlyScraped.length >= FEED_TARGET) break;
                        }
                        pdiag.found = apiAdded;
                        if (apiAdded > 0) {
                            try { await chrome.storage.local.set({ feed_watch_buffer: freshlyScraped.slice(-FEED_TARGET) }); } catch {}
                            diag.freshlyScraped = freshlyScraped.length;
                        }
                        console.log(FEED_TAG, `LinkedIn: API harvest +${apiAdded} (pages ${pdiag.apiHarvest.pages}, returned ${pdiag.apiHarvest.returned}, err ${pdiag.apiHarvest.error || 'none'})`);
                        await writeFeedDiag(diag);
                    }
                }
                if (apiAdded > 0) continue; // done with LinkedIn — skip the DOM scroll loop
                if (remaining > 0) console.warn(FEED_TAG, 'LinkedIn: API harvest returned 0 — falling back to DOM scroll.');
            }

            // Per-platform deadline + the global deadline take whichever is sooner.
            // Budget scales with the sweep target so a big "Max posts per sweep"
            // gets enough scroll time to reach the bottom of a virtualized feed.
            const perPlatformMs = Math.max(FEED_PER_PLATFORM_MS, Math.min(FEED_PER_PLATFORM_MAX_MS, FEED_TARGET * FEED_MS_PER_POST));
            const platformDeadline = Math.min(sweepDeadline, Date.now() + perPlatformMs);
            let consecutiveEmptySteps = 0;
            let lastScrollY = -1;
            let lastScrollMax = -1;     // last reported scrollable height — detects lazy-load growth
            let bottomStall = 0;        // consecutive at-bottom steps with NO growth and NO new posts
            let stepsTaken = 0;
            let foundThisPlatform = 0;

            // How patient to be at the CURRENTLY-rendered bottom before believing
            // the feed is genuinely exhausted. X/Reddit/LinkedIn virtualize and
            // lazy-load: reaching the rendered bottom is NOT the end — more posts
            // stream in if we wait there. (This is the root cause of the old
            // "only 4-6 posts" bug: the sweep treated the first rendered bottom as
            // exhaustion and bailed after one viewport.)
            const BOTTOM_STALL_CAP = 5;

            while (Date.now() < platformDeadline) {
                // Target reached — we have enough posts for this sweep.
                if (freshlyScraped.length >= FEED_TARGET) {
                    console.log(FEED_TAG, `${platform}: reached target ${FEED_TARGET} posts → stopping scroll.`);
                    break;
                }
                // 1. Scrape currently rendered posts.
                let added = 0;
                let rawThisStep = 0; // total cards the scraper returned this step (pre-dedup)
                try {
                    const res = await sendToAgent(tabId, { type: 'DISCOVERY_SCRAPE_FEED', maxCandidates: 60 });
                    if (res?.diagnostic) pdiag.lastScrapeDiag = res.diagnostic;
                    if (res?.error) pdiag.error = 'scrape-agent: ' + res.error;
                    for (const p of (res?.posts || [])) {
                        if (!p?.uuid) continue;
                        rawThisStep++;
                        pdiag.rawSeenOnPage++;
                        // Intra-sweep dedup (same card re-scraped across scroll steps).
                        if (seenThisSweep.has(p.uuid)) continue;
                        // Skip ONLY if it's already in the Tracker — by URL OR by the
                        // `feed_<uuid>` id (LinkedIn posts have an empty postUrl, so the
                        // uuid check is what dedupes them). Posts merely seen in a prior
                        // sweep are NOT skipped → the whole feed is re-surfaced.
                        if (p.postUrl && alreadyPromotedUrls.has(p.postUrl)) { pdiag.dedupSkipped++; diag.dedupSkipped++; continue; }
                        if (alreadyPromotedUuids.has('feed_' + p.uuid)) { pdiag.dedupSkipped++; diag.dedupSkipped++; continue; }
                        seenThisSweep.add(p.uuid);
                        freshlyScraped.push(p);
                        foundThisPlatform++;
                        added++;
                        if (freshlyScraped.length >= FEED_TARGET) break; // don't overshoot the target
                    }
                } catch (e) {
                    console.warn(FEED_TAG, `scrape step failed: ${e?.message || e}`);
                    pdiag.error = 'scrape-exec: ' + (e?.message || e);
                }
                // STREAM to the web app as we scroll — don't wait for the whole
                // sweep to finish. Each new post is pushed into feed_watch_buffer
                // immediately, so the panel reflects live progress and posts are
                // never lost if the sweep is interrupted before PHASE 3. (User
                // request: "send the posts to the web app, not once for all.")
                if (added > 0) {
                    try { await chrome.storage.local.set({ feed_watch_buffer: freshlyScraped.slice(-FEED_TARGET) }); } catch {}
                    diag.freshlyScraped = freshlyScraped.length;
                    await writeFeedDiag(diag);
                }
                // A step is "empty" ONLY when the scraper returned NO cards at all —
                // that signals the page genuinely isn't rendering anything. A step
                // that returned cards which were ALL already-seen is NOT exhaustion
                // (normal when re-sweeping a familiar feed). Real end-of-feed is
                // handled by the bottom-stall logic below.
                consecutiveEmptySteps = rawThisStep === 0 ? consecutiveEmptySteps + 1 : 0;

                // Has this platform EVER rendered a card this sweep? Until it
                // has, the page is still HYDRATING — not exhausted. X's home
                // timeline in particular takes ~15-20s to render its first
                // <article> even after readyState=complete (verified live). Give a
                // generous grace before any content appears; tighten to the real
                // exhaustion cap only once we've actually seen a post. The
                // platformDeadline still bounds a genuinely empty/blocked feed.
                const hasRenderedAny = pdiag.rawSeenOnPage > 0;
                const emptyCap = hasRenderedAny ? 6 : 14;

                // 2. Page genuinely not rendering any cards → give up on it.
                if (consecutiveEmptySteps >= emptyCap) {
                    console.log(FEED_TAG, `${platform}: ${consecutiveEmptySteps} empty scrolls (no cards rendered, hasRenderedAny=${hasRenderedAny}) → moving on.`);
                    break;
                }

                // 3. Human-paced scroll, then read where we landed.
                let atBottomReported = false;
                let scrollMax = -1;
                let scrollStuck = false;
                try {
                    const scrollRes = await sendToAgent(tabId, { type: 'DISCOVERY_FEED_SCROLL_STEP' });
                    atBottomReported = !!scrollRes?.atBottom;
                    scrollMax = Number(scrollRes?.scrollMax ?? -1);
                    const y = scrollRes?.afterY ?? 0;
                    if (y === lastScrollY) scrollStuck = true;
                    else lastScrollY = y;
                } catch (e) {
                    console.warn(FEED_TAG, `scroll step failed: ${e?.message || e}`);
                }

                // ── Infinite-feed bottom handling (the fix for "only 4-6 posts") ──
                // The scroll step's `atBottom` is measured against the CURRENTLY
                // rendered scrollHeight. On a virtualized timeline that's only the
                // bottom of what's painted so far — lingering there makes X stream
                // the next page in (scrollMax grows). So we do NOT treat reaching
                // it as exhaustion. We only conclude the feed is truly done after
                // BOTTOM_STALL_CAP consecutive steps where the scrollable height
                // did NOT grow AND no new posts were scraped. Until then, when
                // parked at the rendered bottom we WAIT (longer dwell) for the
                // lazy-load to fire and keep going.
                const grew = scrollMax > lastScrollMax + 40;
                if (grew) lastScrollMax = scrollMax;
                const atRenderedBottom = (atBottomReported || scrollStuck) && hasRenderedAny;
                let waitingForLazyLoad = false;
                if (atRenderedBottom && !grew && added === 0) {
                    bottomStall++;
                    waitingForLazyLoad = bottomStall < BOTTOM_STALL_CAP;
                    if (!waitingForLazyLoad) {
                        console.log(FEED_TAG, `${platform}: feed exhausted — ${bottomStall} stalls at the rendered bottom with no growth/new posts.`);
                        break;
                    }
                } else {
                    // Made progress this step (feed grew, new posts, or still
                    // scrolling through mid-feed) → reset the patience counter.
                    bottomStall = 0;
                }

                stepsTaken++;
                // 4. Human pace between steps. When parked at the rendered bottom
                //    waiting for X to stream the next page, dwell a touch longer so
                //    the fetch has time to land before we re-scrape. Otherwise skim,
                //    with the occasional longer "reading" pause.
                let dwell;
                if (waitingForLazyLoad) {
                    dwell = _feedGauss(4200, 900);
                } else {
                    const isReading = Math.random() < 0.18;
                    dwell = isReading ? _feedGauss(9000, 2200) : _feedGauss(3500, 1000);
                }
                await new Promise(r => setTimeout(r, dwell));
            }
            pdiag.found = foundThisPlatform;
            pdiag.steps = stepsTaken;
            await writeFeedDiag(diag);
            console.log(FEED_TAG, `${platform}: ${foundThisPlatform} new in ${stepsTaken} steps over ${Math.round((Date.now()-sweepStart)/1000)}s`);
        }
        diag.freshlyScraped = freshlyScraped.length;
        await writeFeedDiag(diag);

        // ── PHASE 2: score in batches of 25, collect everything above threshold ──
        // NOTE: use Number.isFinite, NOT `|| 60`. A real 0 ("Minimum profile
        // fit = 0%") is falsy, so `Number(0) || 60` silently became 60 — the
        // user set 0% to surface EVERYTHING but the gate quietly demanded 60%,
        // so X (and LinkedIn) yielded far fewer than "Max drafts per sweep".
        const _minRaw = Number(cfg.minRelevancy);
        const minScore = Math.max(0, Math.min(100, Number.isFinite(_minRaw) ? _minRaw : 60));
        // "Max drafts per sweep" is the DRAFT cap only (how many auto-replies to
        // queue in PHASE 2.5). It NO LONGER limits how many posts are surfaced —
        // that's FEED_TARGET ("Max posts per sweep"). Kept separate so a few
        // thoughtful drafts don't throttle the whole scraped feed.
        const maxSurface = Math.max(0, Math.min(20, Number(cfg.engagement?.maxPerSweep ?? FEED_DEFAULT_MAX_PER_SWEEP)));
        const passing = []; // { post, score: scoreResult }

        // Resolve scoring behavior. Two modes:
        //   • brief    — user typed a brief; score with Gemini and GATE by
        //                minRelevancy (strict — only matches reach the tracker).
        //   • no-brief — user left the brief empty. Per product spec, this means
        //                "surface EVERYTHING I scrolled past." We promote every
        //                scraped post UNCONDITIONALLY (never gated on Gemini or
        //                an API key — that was why the tracker stayed empty).
        //                If we have product/audience context AND a Gemini key,
        //                we additionally score for product-fit as a best-effort
        //                RANKING annotation, but a failed/absent score NEVER
        //                drops a post.
        const { answerly_voice_profile: _vpForBrief = null } =
            await chrome.storage.local.get(['answerly_voice_profile']);
        const prompt = (cfg.prompt || '').trim();

        if (prompt) {
            // ── BRIEF MODE — strict, Gemini-gated ──
            diag.scoreMode = 'brief';
            await writeFeedDiag(diag);
            console.log(FEED_TAG, 'Scoring mode: brief (strict, gated by minRelevancy).');
            for (let i = 0; i < freshlyScraped.length; i += 25) {
                if (Date.now() >= sweepDeadline + 60_000) break; // grace window for scoring
                const batch = freshlyScraped.slice(i, i + 25);
                const results = await scoreFeedPostsInExt(prompt, batch, 'brief');
                const byUuid = new Map(results.map(r => [r.uuid, r]));
                for (const p of batch) {
                    scored++;
                    const r = byUuid.get(p.uuid);
                    if (!r) continue;
                    // A HARD scorer failure (transient HTTP / parse) is NOT a
                    // 0-fit — surface the post instead of silently dropping it so
                    // a blip doesn't empty the tracker. A missing Gemini key
                    // (noKey) is a config problem we can't score around, so those
                    // still drop (the diagnostic tells the user to add the key).
                    if (r.failed) { if (!r.noKey) passing.push({ post: p, score: r }); continue; }
                    if (r.score < minScore) continue;
                    passing.push({ post: p, score: r });
                }
            }
        } else {
            // ── NO-BRIEF MODE — promote everything, scoring is annotation only ──
            const product  = (_vpForBrief?.product  || '').trim();
            const audience = (_vpForBrief?.audience || '').trim();
            const haveProductContext = !!(product || audience);
            diag.scoreMode = haveProductContext ? 'no-brief (product-ranked)' : 'no-brief (scrape-all)';
            await writeFeedDiag(diag);
            console.log(FEED_TAG, `Scoring mode: no-brief → promoting all ${freshlyScraped.length} scraped posts${haveProductContext ? ' (best-effort product-fit ranking)' : ''}.`);

            // Best-effort product-fit scores for ranking only. Wrapped so any
            // failure (missing key, HTTP error) leaves posts at the default 100.
            const scoreByUuid = new Map();
            if (haveProductContext) {
                const autoBrief = `PRODUCT: ${product || '(unspecified)'}
TARGET AUDIENCE: ${audience || '(unspecified)'}`;
                try {
                    for (let i = 0; i < freshlyScraped.length; i += 25) {
                        if (Date.now() >= sweepDeadline + 60_000) break;
                        const batch = freshlyScraped.slice(i, i + 25);
                        const results = await scoreFeedPostsInExt(autoBrief, batch, 'product');
                        for (const r of results) scoreByUuid.set(r.uuid, r);
                    }
                } catch (e) {
                    console.warn(FEED_TAG, 'Product-fit ranking failed (promoting unranked):', e?.message || e);
                }
            }

            // When we DO have product/audience context AND scoring produced
            // results, the "Minimum profile fit" % is a real gate — honor it
            // exactly like brief mode. A post whose fit is below the bar (or has
            // no finite score while others scored) is dropped. Only when scoring
            // produced nothing at all (no context, or a total API failure) do we
            // fall back to surfacing every post so the tracker isn't silently
            // emptied by a transient error.
            // A 0% threshold means "no filtering — surface everything I scrolled
            // past", so the gate is OFF at minScore 0 even when we have product
            // context (otherwise posts Gemini happened not to score would still
            // be dropped, yielding fewer than "Max drafts per sweep").
            // gateOnFit only counts results that ACTUALLY scored — a batch that
            // hard-failed (HTTP/parse/key) populates scoreByUuid with failed
            // flags but no real numbers, and must not turn the gate on.
            const realScores = [...scoreByUuid.values()].filter(r => r && !r.failed && Number.isFinite(r.score));
            const gateOnFit = haveProductContext && realScores.length > 0 && minScore > 0;
            for (const p of freshlyScraped) {
                scored++;
                const r = scoreByUuid.get(p.uuid);
                if (gateOnFit) {
                    // A hard scorer failure on this post is NOT a 0-fit — surface
                    // it rather than drop it under the gate.
                    if (r && r.failed) { passing.push({ post: p, score: r }); continue; }
                    if (!r || !Number.isFinite(r.score) || r.score < minScore) continue;
                    passing.push({ post: p, score: r });
                } else {
                    passing.push({
                        post: p,
                        score: (r && !r.failed && Number.isFinite(r.score))
                            ? r
                            : { uuid: p.uuid, score: 100, reason: 'No brief set — surfaced from your feed.' }
                    });
                }
            }
        }

        // ── Cap the SURFACED set (highest-fit first) ──
        // IMPORTANT: surfacing is DECOUPLED from the draft cap ("Max drafts per
        // sweep"). The user wants the whole feed they scrolled past to land in the
        // Posts Tracker — up to FEED_TARGET ("Max posts per sweep", default 50,
        // max 100) — while only a few get an auto-drafted comment (PHASE 2.5).
        // Previously this slice used the draft cap, so the Tracker showed only
        // ~3-5 posts no matter how many were scraped — the "still only 5 posts"
        // bug. We now surface up to the user's target, highest-fit first.
        const surfaceCap = Math.min(FEED_SURFACE_CAP, FEED_TARGET);
        if (passing.length > surfaceCap) {
            passing.sort((a, b) => (b.score.score || 0) - (a.score.score || 0));
            passing.length = surfaceCap;
        }
        diag.surfaceCap = surfaceCap;
        diag.draftCap = maxSurface;
        diag.passingAfterCap = passing.length;

        // ── PHASE 2.4: DISABLED — the sweep NEVER leaves the feed ──
        // Per product requirement, a sweep must not navigate anywhere off the feed:
        // it must NOT open an author's /recent-activity/ page (or any /posts/ page)
        // to resolve a permalink. We use ONLY what the feed card itself exposed:
        //   • cards that already carried a /feed/update/<urn>/ or /posts/ href in
        //     the feed keep it and stay commentable;
        //   • cards with no in-card permalink stay surfaced-for-visibility but are
        //     NOT commentable (guarded in PHASE 2.5 via _isCommentablePostUrl).
        // Nothing in this phase navigates — we only scrape what's present in the
        // feed. (The old recent-activity resolver lives below but is never called.)
        diag.liAuthorsVisited = 0;
        diag.liPermalinksResolved = 0;
        await writeFeedDiag(diag);

        // ── PHASE 2.5: selective engagement drafting (queue-only) ──
        // The agent behaves like a thoughtful human: it engages with only the
        // BEST handful per sweep, never twice with the same author, and never on
        // a post it has already engaged. (The old rolling-24h daily cap was
        // removed — it made no sense.) Drafts are attached to the promoted
        // entry; NOTHING is auto-posted.
        const engageByUuid = new Map();
        const engagementOn = cfg.engagement?.enabled !== false; // default ON
        if (engagementOn && passing.length) {
            try {
                const { answerly_voice_profile = null, comment_log = [], feed_watch_engagement_log = [] } =
                    await chrome.storage.local.get(['answerly_voice_profile', 'comment_log', 'feed_watch_engagement_log']);

                const maxPerSweep = maxSurface; // same cap that limited the surfaced set above
                // NOTE: the rolling-24h "max per day" cap was removed per user
                // request — it made no sense (it silently stopped drafting even
                // when there were great posts to engage). Only the per-sweep cap
                // and the "one post per author per sweep" rule still apply. We
                // keep a lightweight engagement log for stats/diagnostics only.
                const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

                // Already-engaged signals: posts we've commented on + authors we
                // engaged today (so we don't pile onto one person).
                const engagedUrls = new Set(comment_log.map(c => c.url || c.postUrl).filter(Boolean));
                const engagedHistoryUrls = new Set(
                    answerly_history.filter(h => h.engagementStatus).map(h => h.postUrl || h.url).filter(Boolean)
                );
                const authorsThisSweep = new Set();

                // Highest-relevance first.
                const ranked = passing.slice().sort((a, b) => (b.score.score || 0) - (a.score.score || 0));
                const newEngageTimestamps = [];

                for (const cand of ranked) {
                    if (newEngageTimestamps.length >= maxPerSweep) break;
                    const p = cand.post;
                    const authorKey = (p.author?.handle || p.author?.profileUrl || p.author?.displayName || '').toLowerCase();
                    // Only draft for posts we can actually act on. A LinkedIn post
                    // whose permalink never resolved (PHASE 2.4) has no usable URL
                    // here — drafting a comment for it would, at publish time,
                    // navigate to a profile/list and comment on the WRONG post.
                    // Surface it in the tracker, but don't queue an engagement.
                    if (!_isCommentablePostUrl(p.postUrl)) continue;
                    if (p.postUrl && (engagedUrls.has(p.postUrl) || engagedHistoryUrls.has(p.postUrl))) continue;
                    if (authorKey && authorsThisSweep.has(authorKey)) continue;

                    const draft = await draftEngagementInExt(p, cand.score, answerly_voice_profile, prompt);
                    if (draft && draft.action && draft.action !== 'skip') {
                        engageByUuid.set(p.uuid, draft);
                        if (authorKey) authorsThisSweep.add(authorKey);
                        newEngageTimestamps.push(Date.now());
                    }
                    // small human pause between drafting calls
                    await new Promise(r => setTimeout(r, _feedGauss(900, 250)));
                }

                if (newEngageTimestamps.length) {
                    const mergedLog = feed_watch_engagement_log
                        .filter(t => Number(t) >= dayAgo)
                        .concat(newEngageTimestamps)
                        .slice(-FEED_ENGAGE_LOG_CAP);
                    await chrome.storage.local.set({ feed_watch_engagement_log: mergedLog });
                }
                console.log(FEED_TAG, `Engagement: drafted ${newEngageTimestamps.length} (sweep cap ${maxPerSweep}; no daily cap).`);
            } catch (e) {
                console.warn(FEED_TAG, 'Engagement drafting failed:', e?.message || e);
            }
        }

        diag.scored = scored;
        diag.passing = passing.length;
        diag.minScore = minScore;
        await writeFeedDiag(diag);

        // ── PHASE 2.9: promote all passing posts, attaching any draft ──
        let drafted = 0;
        let promoteBlocked = 0; // passed scoring but dedup/deny-listed in promote
        for (const { post: p, score: r } of passing) {
            const eng = engageByUuid.get(p.uuid) || null;
            const ok = await promoteFeedPostToTracker(p, r, eng);
            if (ok) {
                promoted++;
                if (eng) drafted++;
            } else {
                promoteBlocked++;
            }
        }
        diag.promoted = promoted;
        diag.drafted = drafted;
        diag.promoteBlocked = promoteBlocked;

        // Build a human-readable conclusion so the UI can show the EXACT reason
        // for a zero without the user reading logs.
        if (promoted > 0) {
            diag.conclusion = `OK — ${promoted} post(s) promoted to the Posts Tracker.`;
        } else if (freshlyScraped.length === 0) {
            const anyBlocked = Object.values(diag.platforms).some(p => p.blocked);
            const anyRawSeen = Object.values(diag.platforms).some(p => p.rawSeenOnPage > 0);
            if (anyBlocked) diag.conclusion = 'ZERO scraped — a login/captcha wall blocked the stealth window. Open the platform in a normal tab and log in, then sweep again.';
            else if (diag.dedupSkipped > 0 && !anyRawSeen) diag.conclusion = `ZERO new — every post on the feed is already in your Posts Tracker (${diag.dedupSkipped} deduped). Scroll the Tracker to see them, or wait for new posts.`;
            else if (anyRawSeen) diag.conclusion = `ZERO new — ${diag.dedupSkipped} post(s) were on the page but all are already in your Posts Tracker.`;
            else diag.conclusion = 'ZERO scraped — the page rendered but no post cards matched the scraper selectors (logged out, empty feed, or markup changed). Check platform login.';
        } else if (passing.length === 0) {
            if (diag.scoreMode === 'brief') {
                diag.conclusion = `Scraped ${freshlyScraped.length} but NONE scored ≥ ${minScore}. ${diag.geminiKeyPresent ? 'Lower minimum relevancy or broaden the brief.' : 'Gemini key is NOT present in the extension — open the app once so it pushes the key, or clear the brief to surface everything.'}`;
            } else if (diag.scoreMode === 'no-brief (product-ranked)') {
                diag.conclusion = `Scraped ${freshlyScraped.length} but NONE met the ${minScore}% Minimum profile fit. Lower the fit threshold in Feed Watcher, or refine your product/audience.`;
            } else {
                diag.conclusion = `Scraped ${freshlyScraped.length} but 0 passing — unexpected in scrape-all mode. Check error field.`;
            }
        } else if (promoteBlocked > 0) {
            diag.conclusion = `Scored ${passing.length} passing but ${promoteBlocked} were blocked at promote (already in tracker or on the removed/deny list).`;
        } else {
            diag.conclusion = 'Nothing promoted for an unknown reason — check error field.';
        }

        // ── PHASE 3: persist sweep stats + seen-uuid record ──
        // feed_watch_seen_uuids is kept for diagnostics only now — it is NO
        // LONGER used to exclude posts from a sweep (that was starving the feed).
        // Tracker-membership (URL + feed_<uuid>) is the only surfacing dedup.
        const seenList = Array.from(new Set([...(feed_watch_seen_uuids || []), ...seenThisSweep])).slice(-FEED_SEEN_CAP);
        await chrome.storage.local.set({ feed_watch_seen_uuids: seenList });
        const next = {
            ...cfg,
            lastSweepAt: new Date().toISOString(),
            lastSweepScored: scored,
            lastSweepPromoted: promoted,
            lastSweepDrafted: drafted,
            lastSweepNew: freshlyScraped.length,
            lastSweepDurationSec: Math.round((Date.now() - sweepStart) / 1000)
        };
        await chrome.storage.local.set({ feed_watch_config: next });
        await chrome.storage.local.set({ feed_watch_buffer: freshlyScraped.slice(-FEED_SURFACE_CAP) });
        diag.finishedAt = new Date().toISOString();
        diag.durationSec = next.lastSweepDurationSec;
        await writeFeedDiag(diag);
        console.log(FEED_TAG, `Sweep done in ${next.lastSweepDurationSec}s. scraped=${freshlyScraped.length} scored=${scored} promoted=${promoted} drafted=${drafted} (threshold ${minScore}, dedup-mem ${seenList.length}) → ${diag.conclusion}`);
    } catch (e) {
        console.error(FEED_TAG, 'Sweep crashed:', e);
        diag.error = (e?.message || String(e));
        diag.conclusion = 'Sweep CRASHED: ' + diag.error;
        diag.finishedAt = new Date().toISOString();
        await writeFeedDiag(diag);
    } finally {
        _feedSweepInFlight = false;
        try { if (win) await chrome.windows.remove(win.id); } catch {}
        // Hand focus back to whatever window the user had before the sweep
        // raised its (focused) popup, so we don't leave them staring at a
        // closed-popup gap or steal their place.
        try { if (priorFocusedWindowId != null) await chrome.windows.update(priorFocusedWindowId, { focused: true }); } catch {}
    }
}

async function _loadFeedBuffer() {
    const { feed_watch_buffer } = await chrome.storage.local.get(['feed_watch_buffer']);
    return Array.isArray(feed_watch_buffer) ? feed_watch_buffer : [];
}

async function handleFeedWatchAlarm(name) {
    if (name !== FEED_ALARM) return false;
    await runFeedWatchSweep();
    return true;
}

// On engine load: re-arm the alarm if config exists. Service worker sleep can
// clear timers; bootstrap ensures the timer survives reloads.
(async function bootstrapFeedWatch() {
    try {
        const cfg = await loadFeedWatchConfig();
        if (cfg) await scheduleFeedWatch(cfg);
    } catch (e) { console.error(FEED_TAG, 'Bootstrap failed:', e); }
})();

self.loadFeedWatchConfig = loadFeedWatchConfig;
self.saveFeedWatchConfig = saveFeedWatchConfig;
self.runFeedWatchSweep = runFeedWatchSweep;
self.handleFeedWatchAlarm = handleFeedWatchAlarm;

console.log(DISC_TAG, 'Engine loaded.');
