/**
 * Answerly Discovery Engine v1.0
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
async function openStealthWindow(url) {
    const win = await chrome.windows.create({
        url,
        type: 'popup',
        state: 'normal',
        focused: false,
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

async function navigateTab(tabId, url) {
    await chrome.tabs.update(tabId, { url });
    await waitForTabComplete(tabId, 30000);
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

function waitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            chrome.tabs.onUpdated.removeListener(updateHandler);
            chrome.tabs.onRemoved.removeListener(removeHandler);
            clearTimeout(timer);
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
        function detectBlock() {
            const html = (document.documentElement?.innerHTML || '').slice(0, 50000).toLowerCase();
            const bodyText = (document.body?.innerText || '').toLowerCase();
            const indicators = {
                captcha: ['captcha', 'are you human', 'verify you are', 'recaptcha', 'h-captcha', 'cf-challenge'],
                rateLimit: ['rate limit', 'too many requests', 'temporarily restricted', 'unusual activity'],
                login: ["please log in to view", "please sign in to view", "sign up to view", "create account to view", "you'll need to log in", "don't miss what's happening", "join linkedin to", "sign up to follow"],
                block: ['account suspended', 'access denied', 'restricted access']
            };
            for (const [type, words] of Object.entries(indicators)) {
                for (const w of words) {
                    if (html.includes(w) && bodyText.includes(w)) return { blocked: true, type, indicator: w };
                }
            }
            if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')) {
                return { blocked: true, type: 'captcha', indicator: 'iframe' };
            }
            return { blocked: false };
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
                    out.push({
                        handle,
                        url: `https://x.com/${handle}`,
                        displayName: (nameEl?.innerText || '').trim().slice(0, 80) || handle,
                        bio: (bioEl?.innerText || '').trim().slice(0, 280),
                        samplePost: (postEl?.innerText || '').trim().slice(0, 280),
                        verified,
                        platform: 'X',
                        discoveredVia: postEl ? 'post' : 'search'
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
        function scrapeLinkedInSearch(max) {
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

                out.push({
                    handle: m[1],
                    url: `https://www.linkedin.com/in/${m[1]}`,
                    displayName: displayName.slice(0, 80),
                    bio: bioCandidate,
                    followerHint: followerHint || undefined,
                    verified,
                    platform: 'LinkedIn',
                    discoveredVia: 'search'
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
// X: build search URL for a specific tab. tab = 'user' | 'live' | 'top'
// No pre-filtering — keep the search broad. Filtering happens after, on results.
function buildXSearchUrl(filters, query, tab = 'top') {
    const q = encodeURIComponent(query);
    const f = tab === 'user' ? 'user' : tab === 'live' ? 'live' : '';
    return `https://x.com/search?q=${q}&src=typed_query${f ? `&f=${f}` : ''}`;
}

// LinkedIn: search both people and posts. tab = 'people' | 'content'
function buildLinkedInSearchUrl(filters, query, tab = 'people') {
    const params = new URLSearchParams();
    params.set('keywords', query);
    params.set('origin', 'GLOBAL_SEARCH_HEADER');
    const path = tab === 'content' ? 'content' : 'people';
    return `https://www.linkedin.com/search/results/${path}/?${params.toString()}`;
}

// Reddit search URLs by tab:
//   'sr'      → search communities (subreddits). This is what we publish to
//               the accounts list as first-class entities.
//   'user'    → search users (less useful for our use case but we include it
//               so power users can still find creators)
//   'link'    → search posts. Used to surface active subreddits indirectly,
//               since a post result lets us discover the subreddit it lives in.
function buildRedditSearchUrl(filters, query, tab = 'sr') {
    const params = new URLSearchParams();
    params.set('q', query);
    if (tab === 'sr')        params.set('type', 'sr');
    else if (tab === 'user') params.set('type', 'user');
    else                     params.set('type', 'link');
    params.set('sort', 'relevance');
    return `https://www.reddit.com/search/?${params.toString()}`;
}

function planQueries(filters, mode, deepeningRound = 0) {
    const queries = [];
    const keywords = filters.keywords || [];
    const hashtags = filters.hashtags || [];

    // Strategy: combine keywords in different patterns to avoid repetitive queries.
    // Deepening rounds widen the net: more queries + more combinations.
    let queryCount = mode === 'volume' ? 8 : mode === 'deep' ? 5 : 3;
    if (deepeningRound > 0) queryCount += deepeningRound * 4; // +4 each round

    // Single keywords (broadest)
    keywords.slice(0, queryCount).forEach(kw => queries.push(kw));

    // Hashtags (specific)
    hashtags.slice(0, Math.max(0, queryCount - keywords.length)).forEach(tag => queries.push(tag));

    // Pairwise combinations
    if (keywords.length >= 2 && queries.length < queryCount) {
        for (let i = 0; i < keywords.length - 1 && queries.length < queryCount; i++) {
            for (let j = i + 1; j < keywords.length && queries.length < queryCount; j++) {
                queries.push(`${keywords[i]} ${keywords[j]}`);
            }
        }
    }

    // On deepening: keyword × hashtag combos for fresh angles
    if (deepeningRound > 0 && keywords.length && hashtags.length) {
        for (const kw of keywords) {
            for (const tag of hashtags) {
                if (queries.length >= queryCount) break;
                queries.push(`${kw} ${tag.replace('#', '')}`);
            }
        }
    }

    // Industry combo
    if (filters.industry && keywords.length && queries.length < queryCount) {
        queries.push(`${keywords[0]} ${filters.industry}`);
    }

    // Dedupe + cap
    return [...new Set(queries)].slice(0, queryCount);
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
    // No post data yet → neutral midpoints for recency + engagement
    const recencyScore = 50;
    const engagementScore = 50;
    const verifiedBonus = card.verified ? 5 : 0;

    const finalScore = Math.round(
        authority * 0.25 +
        nicheMatch * 0.30 +
        recencyScore * 0.15 +
        engagementScore * 0.25 +
        verifiedBonus
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (card.verified) matchedSignals.push('Verified');
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

// ── REDDIT SCORING ──
// For subreddits, our metric stack is:
//   subscribers       → community size (like followers)
//   accounts_active   → people currently online (immediate engagement signal)
//   ageDays           → maturity / trust signal
//   public_description→ niche-match keyword target
// Weights:
//   authority (size)   25
//   niche match        35  (heavier than LinkedIn — subreddit description IS the signal)
//   activity ratio     25  (accounts_active / subscribers)
//   age maturity       10
//   verified bonus      5
function scoreRedditSubreddit(profile, filters) {
    const subs = profile.followers || 0;
    const active = profile.maturePostMedianEngagement || 0; // accounts_active reused for this slot

    // Authority: log scale on subscribers.
    const authority = subs === 0 ? 0 : Math.min(100, Math.log10(subs + 1) * 18);

    // Niche match — bio + display name.
    const { match: nicheMatch, kwHits, totalKw } = _nicheMatch(
        [profile.bio, profile.displayName, profile.handle].filter(Boolean).join(' '),
        filters
    );

    // Activity ratio: % of subscribers online right now. 0.5%+ is excellent
    // for a large sub. We boost smaller subs by scaling log-style.
    let activityScore = 0;
    if (subs > 0 && active >= 0) {
        const ratio = active / subs;       // e.g. 0.005 = 0.5% online
        const pct = ratio * 100;
        // 0% → 0, 2%+ → 100, log-style for the curve in between
        activityScore = Math.min(100, Math.log10(pct * 50 + 1) * 50);
    }

    // Age maturity: bias toward subs that have been around. 0d → 0, 365d+ → 100.
    let ageScore = 50;
    if (typeof profile.ageDays === 'number') {
        ageScore = profile.ageDays >= 365 ? 100 : Math.round((profile.ageDays / 365) * 100);
    }

    const verifiedBonus = 0; // subreddits don't carry verification

    const finalScore = Math.round(
        authority * 0.25 +
        nicheMatch * 0.35 +
        activityScore * 0.25 +
        ageScore * 0.10 +
        verifiedBonus * 0.05
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
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
        maturePostMedianEngagement: active || null,
        daysSinceLastPost: null,
        tier: finalScore >= 85 ? 'S' : finalScore >= 70 ? 'A' : finalScore >= 50 ? 'B' : 'C',
        verificationStatus: 'verified'
    };
}

// Fetch /r/<sub>/about.json from the background. This is a public endpoint,
// works without auth, and is the safest way to get clean subreddit metrics
// without any DOM scraping or bot-detection exposure. The background SW
// is allowed cross-origin fetches without site cookies — fine for us since
// about.json is public.
async function enrichSubredditMetrics(handle) {
    // handle is "r/SaaS" — strip the "r/" prefix for the URL
    const name = handle.replace(/^r\//i, '').trim();
    if (!name) return null;
    try {
        const res = await fetch(`https://www.reddit.com/r/${encodeURIComponent(name)}/about.json`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'AnswerlyAccountFinder/1.0' }
        });
        if (!res.ok) {
            console.warn(DISC_TAG, `[reddit.enrich] r/${name} returned ${res.status}`);
            return null;
        }
        const json = await res.json();
        const d = json?.data || {};
        const createdMs = d.created_utc ? d.created_utc * 1000 : null;
        const ageDays = createdMs ? Math.floor((Date.now() - createdMs) / 86400000) : null;
        return {
            displayName: d.display_name_prefixed || handle,
            bio: (d.public_description || d.description || '').slice(0, 500),
            followers: d.subscribers || 0,
            // For UI parity with LinkedIn — accounts_active fills the
            // "median engagement" slot for subreddits (number online right now).
            maturePostMedianEngagement: typeof d.accounts_active === 'number' ? d.accounts_active : null,
            engagementRate: d.subscribers > 0 && d.accounts_active >= 0
                ? +((d.accounts_active / d.subscribers) * 100).toFixed(2)
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

    const verifiedBonus = profile.verified ? 5 : 0;

    const finalScore = Math.round(
        authority * 0.25 +
        nicheMatch * 0.30 +
        recencyScore * 0.15 +
        engagementScore * 0.25 +
        verifiedBonus
    );

    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (profile.verified) matchedSignals.push('Verified');
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
    // Authority score (followers, normalized log scale)
    const f = profile.followers || 0;
    const authority = f === 0 ? 0 : Math.min(100, Math.log10(f + 1) * 18);

    // Niche match: count keyword hits in bio + sample hooks + sample post (from posts tab)
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

    // Engagement bonus
    const engagementBonus = Math.min(20, (profile.engagementRate || 0) * 4);

    // Verified bonus
    const verifiedBonus = profile.verified ? 5 : 0;

    // Final score (weighted)
    const finalScore = Math.round(
        authority * 0.4 +
        nicheMatch * 0.4 +
        engagementBonus +
        verifiedBonus
    );

    // Matched signals (human-readable reasons)
    const matchedSignals = [];
    if (kwHits > 0) matchedSignals.push(`${kwHits}/${totalKw} keywords matched`);
    if (profile.verified) matchedSignals.push('Verified');
    if (profile.engagementRate > 2) matchedSignals.push(`${profile.engagementRate.toFixed(1)}% engagement`);
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

    // For each query, search BOTH the people/users tab AND the posts/content tab
    // Posts tab discovers active authors writing about the topic (much higher signal than People search)
    const tabsToSearch = platform === 'X' ? ['live', 'user']
        : platform === 'LinkedIn' ? ['content', 'people']
        // Reddit: surface communities (subreddits) FIRST — that's what we
        // publish as accounts. Then look at posts so we can extract more
        // subreddits from active discussions.
        : ['sr', 'link'];

    for (const query of queries) {
        if (missionAborted) break;

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
            logMission('info', `Query → ${query} [${tabLabel}]`, platform);

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

            // ─── LINKEDIN: PUBLISH PRELIMINARY RESULTS NOW ───
            // For LinkedIn, every discovered candidate appears in the account
            // section immediately with a card-level score. Verification will
            // upgrade each entry in place once we visit the profile. This
            // lets the user pick accounts to track without waiting for the
            // (rate-limited, slow) full verification pass to finish.
            if (platform === 'LinkedIn' && fresh.length > 0) {
                for (const c of fresh) {
                    // Skip if we already published this handle in an earlier query
                    if (activeMission.results.some(r => r.platform === 'LinkedIn' && r.handle === c.handle)) continue;
                    const scoring = scoreLinkedInFromCard(c, activeMission.filters);
                    const account = {
                        id: `LinkedIn_${c.handle}_${Date.now()}`,
                        platform: 'LinkedIn',
                        handle: c.handle,
                        url: c.url,
                        displayName: c.displayName || c.handle,
                        bio: c.bio || '',
                        followers: scoring.followers || 0,
                        verified: !!c.verified,
                        authorityScore: scoring.authorityScore,
                        nicheMatch: scoring.nicheMatch,
                        finalScore: scoring.finalScore,
                        matchedSignals: scoring.matchedSignals,
                        tier: scoring.tier,
                        discoveredAt: nowIso(),
                        trackingStatus: 'untracked',
                        enriched: false,
                        verificationStatus: 'preliminary'
                    };
                    activeMission.results.push(account);
                }
                activeMission.results.sort((a, b) => b.finalScore - a.finalScore);
                await persistMission();
                logMission('info', `Published ${fresh.length} LinkedIn candidates with preliminary scores — will refine after profile visits`, platform);
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
                                ageDays: meta?.ageDays ?? null,
                                isOver18: meta?.isOver18 ?? false,
                                platform: 'Reddit'
                            };
                            const scoring = scoreRedditSubreddit(profile, activeMission.filters);
                            const account = {
                                id: `Reddit_${c.handle}_${Date.now()}`,
                                platform: 'Reddit',
                                ...profile,
                                ...scoring,
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
                    logMission('success', `Published ${subs.length} subreddit${subs.length > 1 ? 's' : ''} with full metrics`, platform);
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

    // ─── VERIFICATION PHASE ───
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
        authorityLevel: f.authorityLevel,
        verifiedOnly: f.verifiedOnly,
        minFollowers: f.minFollowers,
        targetMatches: missionConfig.targetMatches,
        batchCap: missionConfig.batchCap
    });
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

                const queries = planQueries(activeMission.filters, activeMission.mode, activeMission.deepeningRound);
                // Recalibrate the UI's progress denominator to the actual work the
                // engine will do (queries × 2 tabs each — Posts/Live + People/User).
                // Without this, the UI's predicted total (based on keywords-or-mode
                // assumption) diverges from reality and the bar gets stuck partial.
                const realPlanned = queries.length * 2 * activeMission.filters.platforms.length;
                if (realPlanned !== activeMission.progress.totalQueriesPlanned) {
                    await patchProgress({ totalQueriesPlanned: realPlanned });
                }
                logMission('info', `Planned ${queries.length} queries × 2 tabs = ${queries.length * 2} searches (deepening round ${activeMission.deepeningRound})`, platform);
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
                const broaderQueries = planQueries(activeMission.filters, 'volume', activeMission.deepeningRound);
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

console.log(DISC_TAG, 'Engine loaded.');
