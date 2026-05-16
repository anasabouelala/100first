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
// CONTENT SCRIPT BRIDGE
// ============================================================
async function sendToAgent(tabId, message, retries = 3, timeoutMs = 15000) {
    for (let i = 0; i < retries; i++) {
        if (missionAborted) throw new Error('Mission aborted');
        try {
            // Verify tab still exists before sending — fails fast on closed tabs
            // rather than waiting on Chrome's internal sendMessage timeout.
            try { await chrome.tabs.get(tabId); }
            catch { throw new Error('Stealth tab no longer exists'); }

            const response = await Promise.race([
                chrome.tabs.sendMessage(tabId, message),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Agent timeout after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
            return response;
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

// Reddit: search both users and posts. tab = 'user' | 'link' (posts) | 'comment'
function buildRedditSearchUrl(filters, query, tab = 'link') {
    const params = new URLSearchParams();
    params.set('q', query);
    if (tab === 'user') params.set('type', 'user');
    else params.set('type', 'link');
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
    const allCandidates = [];
    const deepMode = activeMission.mode === 'deep';
    let queryIndex = 0; // counts queries within this platform — for first-query speedup

    // For each query, search BOTH the people/users tab AND the posts/content tab
    // Posts tab discovers active authors writing about the topic (much higher signal than People search)
    const tabsToSearch = platform === 'X' ? ['live', 'user']
        : platform === 'LinkedIn' ? ['content', 'people']
        : ['link', 'user'];

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
            const maxPerQuery = activeMission.mode === 'volume' ? 50
                : activeMission.mode === 'deep' ? 35
                : 25;
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

            const fresh = candidates.filter(c => {
                const cleanUrl = c.url.split('?')[0].replace(/\/$/, '');
                return !trackedUrls.has(cleanUrl);
            });

            // Surface the actual list so the user sees who was discovered
            if (fresh.length > 0) {
                const sample = fresh.slice(0, 5).map(c => `@${c.handle}`).join(', ');
                const more = fresh.length > 5 ? ` +${fresh.length - 5} more` : '';
                logMission('success', `[${tabLabel}] Found ${candidates.length} (${fresh.length} fresh): ${sample}${more}`, platform);
            } else {
                logMission('success', `[${tabLabel}] Found ${candidates.length} candidates (${fresh.length} fresh)`, platform);
            }
            await patchProgress({
                candidatesScanned: activeMission.progress.candidatesScanned + candidates.length,
                queriesCompleted: activeMission.progress.queriesCompleted + 1
            });

            allCandidates.push(...fresh);

            // ─── COLLECT, DON'T PUBLISH YET ───
            // Candidates here are just usernames + bio snippets from search cards.
            // We collect them in allCandidates and visit each profile in the
            // verification phase below to read their REAL KPIs (follower count,
            // engagement, verified status). Only profiles that match the
            // user's filters get published to activeMission.results.
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
        logMission('error', `Found 0 usernames on ${platform}. Nothing to verify. Most likely: not logged in, narrow keywords, or DOM changed.`, platform);
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

    const preFiltered = allCandidates.filter(c => {
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
                        enriched: true
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
    if (activeMission && ['scanning', 'preparing', 'paused'].includes(activeMission.status)) {
        throw new Error('Another mission is already running');
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
                logMission('info', `Planned ${queries.length} queries (deepening round ${activeMission.deepeningRound})`, platform);
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
                    discoveredAt: nowIso(), trackingStatus: 'untracked', enriched: true
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
