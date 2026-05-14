/**
 * Answerly Background Engine
 * Stealth profile monitoring for founders.
 * Polling Interval: Randomized (15-30m)
 */

importScripts('LeadIntelligenceEngine.js', 'discovery_engine.js');

const LOG_TAG = "[Answerly]";

// Global state for long-running processes
let currentReconTimeout = null;
let activeShadowWindowId = null;

// ═══════════════════════════════════════════════════════════
// TRACKING SETTINGS — user-configurable polling cadence
// ═══════════════════════════════════════════════════════════
const TRACKING_SETTINGS_KEY = 'tracking_settings';
const DEFAULT_TRACKING_SETTINGS = {
  intervalMinutes: 15,      // how often to wake up and pick a creator to poll
  cooldownMinutes: 20,      // min time between two polls of the SAME creator
  respectOffHours: true,    // skip polling between 23h and 8h local time
  jitterPercent: 0.25       // ±25% random jitter on alarm timing
};

async function getTrackingSettings() {
  const r = await chrome.storage.local.get([TRACKING_SETTINGS_KEY]);
  return { ...DEFAULT_TRACKING_SETTINGS, ...(r[TRACKING_SETTINGS_KEY] || {}) };
}

async function rescheduleStealthCheck() {
  const s = await getTrackingSettings();
  const min = Math.max(5, s.intervalMinutes); // hard floor: 5 min
  const jitter = (Math.random() * 2 - 1) * (s.jitterPercent || 0) * min;
  const periodInMinutes = Math.max(5, Math.round((min + jitter) * 100) / 100);
  await chrome.alarms.clear("stealthCheck");
  chrome.alarms.create("stealthCheck", { periodInMinutes });
  console.log(LOG_TAG, `[Tracking] Next poll in ~${periodInMinutes.toFixed(1)}min (base ${min}min ± ${(s.jitterPercent*100)}%)`);
}

// 1. Initialize Alarms
chrome.runtime.onInstalled.addListener(() => {
  console.log(LOG_TAG, "Engine Initialized.");
  rescheduleStealthCheck();
  chrome.alarms.create("queueProcessor", { periodInMinutes: 5 });
  chrome.alarms.create("resetEngagementCounter", { periodInMinutes: 60 });
  chrome.alarms.create("watchdog", { periodInMinutes: 1 });

  // Register content scripts programmatically (more reliable than manifest for localhost)
  chrome.scripting.registerContentScripts([{
    id: 'answerly-bridge',
    matches: ['http://localhost:*/*', 'http://127.0.0.1:*/*'],
    js: ['content_bridge.js'],
    runAt: 'document_start',
    persistAcrossSessions: true
  }]).catch(err => {
    if (!err.message?.includes('already registered')) {
      console.error(LOG_TAG, "Failed to register bridge script:", err);
    }
  });

  // Auto-reload tabs running the web app so the bridge reconnects
  chrome.tabs.query({ url: ["http://localhost:*/*", "http://127.0.0.1:*/*"] }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.reload(tab.id);
    }
  });

  setTimeout(() => {
    executeCycle();
  }, 2000);
});

// Fallback: inject bridge on tab navigation for localhost (in case manifest matching fails)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://localhost') || tab.url.startsWith('http://127.0.0.1'))) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_bridge.js']
    }).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'stealthCheck') executeCycle();
    if (alarm.name === 'queueProcessor') processNextReconKeyword();
    if (alarm.name === 'watchdog') checkWatchdog();
  if (alarm.name === "resetEngagementCounter") {
    console.log(LOG_TAG, "Resetting hourly engagement counter.");
    chrome.storage.local.set({ answerly_engagements: 0 });
  }
  // Discovery campaign ticks
  if (alarm.name.startsWith('campaign_tick_') && self.handleCampaignAlarm) {
    self.handleCampaignAlarm(alarm.name).catch(e => console.error(LOG_TAG, 'Campaign alarm failed:', e));
  }
});

// React to user changing tracking settings → reschedule alarm immediately
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[TRACKING_SETTINGS_KEY]) {
    console.log(LOG_TAG, "[Tracking] Settings changed, rescheduling alarm.");
    rescheduleStealthCheck();
  }
});

// Reschedule on SW startup (alarms persist but jitter doesn't)
chrome.runtime.onStartup?.addListener(() => rescheduleStealthCheck());
// Also reschedule once at module load to recover from SW eviction
rescheduleStealthCheck().catch(() => {});

async function checkWatchdog() {
    // If isEngaging is true for more than 10 mins, something crashed
    const res = await chrome.storage.local.get(['last_engagement_start']);
    if (isEngaging && res.last_engagement_start && (Date.now() - res.last_engagement_start > 600000)) {
        console.warn(LOG_TAG, "Watchdog: Engagement stuck detected. Resetting.");
        isEngaging = false;
    }
}

// 1.5 Debug Pulse Helper
async function setPulse(msg, stats = {}) {
  console.log(LOG_TAG, "Pulse:", msg);
  await chrome.storage.local.set({ 
    answerly_engine_pulse: { 
        msg, 
        time: Date.now(),
        found: stats.found,
        scanned: stats.scanned
    } 
  });
}

// 1.6 Timeout Wrapper
function withTimeout(promise, ms, label) {
  let timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} took > ${ms/1000}s`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─── Engagement Queue ────────────────────────────────────────────────────────
const engagementQueue = [];
let isEngaging = false;

async function processEngagementQueue() {
    if (isEngaging) return;
    
    // Load queue and stats
    const result = await chrome.storage.local.get(['answerly_engagement_queue', 'answerly_engagements']);
    const queue = result.answerly_engagement_queue || [];
    const engagementsThisHour = result.answerly_engagements || 0;
    const MAX_PER_HOUR = 12;

    if (queue.length === 0) return;
    
    if (engagementsThisHour >= MAX_PER_HOUR) {
        console.warn(LOG_TAG, "[ENGAGE] Hourly limit reached. Waiting for reset.");
        await setPulse("Engagement Cap Reached (12/hr)");
        return;
    }
    
    isEngaging = true;
    await chrome.storage.local.set({ last_engagement_start: Date.now() });
    const lead = queue.shift();
    // Save updated queue immediately
    await chrome.storage.local.set({ answerly_engagement_queue: queue });

    let shadowWindowId = null;
    let targetTabId = null;
    try {
        const targetUrl = lead.postUrl || lead.url;
        console.log(LOG_TAG, "[ENGAGE] Launching Stealth Window for:", targetUrl);
        await setPulse(`Engaging: ${lead.actionType} on ${targetUrl.substring(0, 20)}...`);
        
        // Notifications removed per user request

        const win = await chrome.windows.create({ 
            url: targetUrl, 
            type: 'popup', 
            state: 'normal', 
            focused: false,
            width: 500,
            height: 600,
            left: 200,
            top: 200,
        });
        
        shadowWindowId = win.id;
        
        // Safely get tab ID
        if (win.tabs && win.tabs.length > 0) {
            targetTabId = win.tabs[0].id;
        } else {
            const tabs = await chrome.tabs.query({ windowId: win.id });
            if (tabs.length > 0) targetTabId = tabs[0].id;
        }

        if (!targetTabId) throw new Error("Could not identify target tab in shadow window.");

        await setPulse("Waiting for page load...");

        // Wait for DOM complete with timeout
        await new Promise((resolve, reject) => {
            const loadTimeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(loadFn);
                reject(new Error("Page load timeout (45s)"));
            }, 45000);

            const loadFn = (tabId, info) => {
                if (tabId === targetTabId && info.status === 'complete') {
                    clearTimeout(loadTimeout);
                    chrome.tabs.onUpdated.removeListener(loadFn);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(loadFn);
        });

        // Platform-aware SPA hydration wait
        const url = lead.url || '';
        let extra = 4000;
        if (url.includes('linkedin.com')) {
            extra = 7000;
            await setPulse("Hydrating LinkedIn SPA...");
        } else if (url.includes('x.com') || url.includes('twitter.com')) {
            extra = 6000;
            await setPulse("Hydrating X.com SPA...");
        } else if (url.includes('reddit.com')) {
            extra = 5000;
            await setPulse("Hydrating Reddit SPA...");
        }
        await new Promise(r => setTimeout(r, extra));

        await setPulse(`Executing ${lead.actionType} via Biometric Agent...`);

        // Robust Message Delivery (Retry up to 3 times)
        let response = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                response = await chrome.tabs.sendMessage(targetTabId, {
                    type: 'PERFORM_STEALTH_INTERACTION',
                    actionType: lead.actionType || 'like',
                    payload: { text: lead.commentText || '' }
                });
                break; // Success
            } catch (err) {
                if (attempt === 2) throw err;
                console.warn(LOG_TAG, `Message attempt ${attempt + 1} failed, retrying...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log(LOG_TAG, "[ENGAGE] Agent response:", response);

        if (response?.success) {
            const res = await chrome.storage.local.get(['answerly_engagements']);
            const count = (res.answerly_engagements || 0) + 1;
            await chrome.storage.local.set({ answerly_engagements: count });
            
            await setPulse(`Success: ${lead.actionType} completed.`);

            // Notifications removed per user request
        } else {
            const errMsg = response?.error || 'Unknown agent error';
            await setPulse(`Failed: ${errMsg}`);
            throw new Error(errMsg);
        }

        const dwell = 8000 + Math.random() * 8000;
        await setPulse(`Dwelling for ${Math.round(dwell/1000)}s...`);
        await new Promise(r => setTimeout(r, dwell));

    } catch (e) {
        console.error(LOG_TAG, "[ENGAGE] Failed:", e.message);
        await setPulse(`Error: ${e.message.substring(0, 30)}`);
        // Notifications removed per user request
    } finally {
        if (shadowWindowId) {
            try { await chrome.windows.remove(shadowWindowId); } catch(_) {}
        }
        isEngaging = false;
        const cooldown = 90000 + Math.random() * 90000;
        await setPulse(`Cooling down (${Math.round(cooldown/1000)}s)`);
        console.log(LOG_TAG, `[ENGAGE] Next in ${Math.round(cooldown/1000)}s`);
        setTimeout(processEngagementQueue, cooldown);
    }
}

// 2. Main Message Listener Hub
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(LOG_TAG, "Message received:", request.action);

    if (request.action === 'forceCheck') {
        executeFullSweep().then(result => {
            sendResponse({ success: true, count: result?.count || 0 });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; 
    }

    if (request.action === 'resetEngine') {
        chrome.storage.local.set({ answerly_backoff_until: 0, answerly_engine_pulse: null }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'performReconSearch') {
        console.log(LOG_TAG, "Received Recon Pulse! Queueing mission...", request.keywords?.length);
        const keywords = request.keywords || [];
        const campaign = request.campaign || null;
        
        chrome.storage.local.get(['keyword_stats'], (res) => {
            const stats = res.keyword_stats || {};
            keywords.forEach(kw => {
                const key = `${kw.platform}__${kw.query}`;
                stats[key] = { 
                    query: kw.query, 
                    platform: kw.platform, 
                    status: 'queued', 
                    found: 0, 
                    hot: 0, 
                    warm: 0 
                };
            });
            chrome.storage.local.set({ 
                keyword_stats: stats,
                recon_queue: keywords,
                active_campaign: campaign,
                stop_recon_mission: false
            }, () => {
                chrome.alarms.create("stealthCheck", { periodInMinutes: 15 });
                chrome.alarms.create("queueProcessor", { periodInMinutes: 5 });
                console.log(LOG_TAG, "Mission initialized. Starting first keyword...");
                processNextReconKeyword();
                sendResponse({ success: true });
            });
        });
        return true;
    }

    if (request.action === 'STOP_RECON_MISSION') {
        console.log(LOG_TAG, "Emergency Stop Signal Received!");
        if (currentReconTimeout) {
            clearTimeout(currentReconTimeout);
            currentReconTimeout = null;
        }
        if (activeShadowWindowId) {
            try { chrome.windows.remove(activeShadowWindowId); } catch(e) {}
            activeShadowWindowId = null;
        }
        chrome.alarms.clear("queueProcessor");
        chrome.alarms.clear("stealthCheck");

        chrome.storage.local.set({ 
            stop_recon_mission: true,
            recon_queue: [],
            active_campaign: null,
            answerly_engine_pulse: { msg: "Mission Halted Manually", time: Date.now() }
        }, () => {
            sendResponse({ success: true, message: "Mission halted" });
        });
        return true;
    }

    // ─── DISCOVERY ENGINE HANDLERS ───
    // CRITICAL: respond synchronously. Mission runs as fire-and-forget — Chrome
    // closes message channels after ~5min, but missions can run for 30min.
    if (request.action === 'DISCOVERY_START') {
        console.log(LOG_TAG, "[Discovery] Mission start request received.");
        if (typeof self.startDiscoveryMission !== 'function') {
            console.error(LOG_TAG, "[Discovery] Engine not loaded! discovery_engine.js failed to import.");
            sendResponse({ success: false, error: 'Discovery engine not loaded — check extension console' });
            return false;
        }
        // Fire-and-forget — mission updates state via chrome.storage which the bridge picks up
        self.startDiscoveryMission(request.mission).catch(async (e) => {
            console.error(LOG_TAG, "[Discovery] Mission crashed:", e);
            // CRITICAL: surface crash to the UI. Without this, mission_state.status
            // stays "scanning" forever and the user thinks the engine is hung.
            try {
                const st = await chrome.storage.local.get(['discovery_mission_state']);
                const m = st.discovery_mission_state;
                if (m && !['completed', 'aborted', 'failed'].includes(m.status)) {
                    m.status = 'failed';
                    m.completedAt = new Date().toISOString();
                    m.logs = m.logs || [];
                    m.logs.push({
                        timestamp: new Date().toISOString(),
                        level: 'error',
                        message: `Engine crashed: ${e?.message || e}`
                    });
                    await chrome.storage.local.set({
                        discovery_mission_state: m,
                        discovery_mission_completed: { ...m, _completedAt: Date.now() }
                    });
                }
            } catch (storageErr) {
                console.error(LOG_TAG, "[Discovery] Failed to surface crash to UI:", storageErr);
            }
        });
        sendResponse({ success: true, started: true });
        return false; // sync response, channel can close
    }
    if (request.action === 'DISCOVERY_PAUSE') {
        self.pauseDiscoveryMission?.().catch(e => console.error('[Discovery] Pause error:', e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'DISCOVERY_RESUME') {
        self.resumeDiscoveryMission?.().catch(e => console.error('[Discovery] Resume error:', e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'DISCOVERY_ABORT') {
        self.abortDiscoveryMission?.().catch(e => console.error('[Discovery] Abort error:', e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'DISCOVERY_PING') {
        // Diagnostic: lets the web app verify the engine is loaded
        sendResponse({
            engineLoaded: typeof self.startDiscoveryMission === 'function',
            campaignSupport: typeof self.startDiscoveryCampaign === 'function',
            version: '1.1'
        });
        return false;
    }

    // ─── CAMPAIGN HANDLERS ───
    if (request.action === 'CAMPAIGN_START') {
        if (typeof self.startDiscoveryCampaign !== 'function') {
            sendResponse({ success: false, error: 'Campaign engine not loaded' });
            return false;
        }
        self.startDiscoveryCampaign(request.config)
            .then(c => console.log(LOG_TAG, '[Campaign] Started:', c.id))
            .catch(e => console.error(LOG_TAG, '[Campaign] Start failed:', e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'CAMPAIGN_PAUSE') {
        self.pauseDiscoveryCampaign?.(request.id).catch(e => console.error(e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'CAMPAIGN_RESUME') {
        self.resumeDiscoveryCampaign?.(request.id).catch(e => console.error(e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'CAMPAIGN_ABORT') {
        self.abortDiscoveryCampaign?.(request.id).catch(e => console.error(e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'CAMPAIGN_DELETE') {
        self.deleteDiscoveryCampaign?.(request.id).catch(e => console.error(e));
        sendResponse({ success: true });
        return false;
    }
    if (request.action === 'CAMPAIGN_RUN_NOW') {
        self.runCampaignTick?.(request.id).catch(e => console.error(e));
        sendResponse({ success: true });
        return false;
    }

    // ─── TRACKING SETTINGS ───
    if (request.action === 'TRACKING_SETTINGS_GET') {
        getTrackingSettings().then(s => sendResponse({ success: true, settings: s }));
        return true; // async response
    }
    if (request.action === 'TRACKING_SETTINGS_SET') {
        const incoming = request.settings || {};
        // Enforce floor: 5 min minimum
        const safe = {
            intervalMinutes: Math.max(5, Number(incoming.intervalMinutes) || 15),
            cooldownMinutes: Math.max(5, Number(incoming.cooldownMinutes) || 20),
            respectOffHours: incoming.respectOffHours !== false,
            jitterPercent: Math.min(0.5, Math.max(0, Number(incoming.jitterPercent) || 0.25))
        };
        chrome.storage.local.set({ [TRACKING_SETTINGS_KEY]: safe }, () => {
            sendResponse({ success: true, settings: safe });
        });
        return true;
    }
    if (request.action === 'TRACKING_RUN_NOW') {
        executeCycle().catch(e => console.error(LOG_TAG, '[Tracking] Manual run failed:', e));
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'QUEUE_FOR_ENGAGEMENT') {
        console.log(LOG_TAG, "[ENGAGE] Queued:", request.lead?.url);
        chrome.storage.local.get(['answerly_engagement_queue'], (result) => {
            const queue = result.answerly_engagement_queue || [];
            queue.push(request.lead);
            chrome.storage.local.set({ answerly_engagement_queue: queue }, () => {
                processEngagementQueue();
            });
        });
        sendResponse({ queued: true });
        return true;
    }
});

// 2.5 Full Sweep (For manual triggers)
async function executeFullSweep() {
  const result = await chrome.storage.local.get(['answerly_creator_configs']);
  const configs = result.answerly_creator_configs || [];
  
  if (configs.length === 0) {
    await setPulse("Sweep Skipped: No creators configured in Web App.");
    return { count: 0 };
  }

  await setPulse(`Starting Full Sweep of ${configs.length} sources...`);
  
  for (const target of configs) {
    try {
      await setPulse(`Checking ${target.label} (${target.platform})...`);
      
      // RESET Cooldown for manual sweep
      target.lastChecked = 0; 
      
      let found = 0;
      const SCRAPE_TIMEOUT = 30000; // 30 seconds max per creator

      if (target.platform === 'X') {
          found = await withTimeout(pollXWithShadowTab(target), SCRAPE_TIMEOUT, `X:${target.label}`);
      } else if (target.platform === 'LinkedIn') {
          found = await withTimeout(pollLinkedIn(target), SCRAPE_TIMEOUT, `LinkedIn:${target.label}`);
      } else if (target.platform === 'Reddit') {
          found = await withTimeout(pollReddit(target), SCRAPE_TIMEOUT, `Reddit:${target.label}`);
      } else if (target.platform === 'Product Hunt') {
          found = await withTimeout(pollProductHunt(target), SCRAPE_TIMEOUT, `PH:${target.label}`);
      }
      
      target.lastChecked = Date.now();
      target.lastStatus = `Success: Found ${found}`;
      
      // GRANULAR SAVE: Update storage immediately after each creator
      await chrome.storage.local.set({ answerly_creator_configs: configs });
      
    } catch (e) {
      target.lastStatus = `Error: ${e.message}`;
      target.lastChecked = Date.now(); // Mark as checked even on error to prevent immediate retry
      await chrome.storage.local.set({ answerly_creator_configs: configs });
      console.error(LOG_TAG, `Sweep failed for ${target.label}:`, e);
      await setPulse(`Failed ${target.label}: ${e.message}`);
    }
  }
  await setPulse("Sweep Completed.");
  return { count: configs.length };
}

// 3. Main Execution Cycle (Automated rotation)
async function executeCycle() {
  const result = await chrome.storage.local.get(['answerly_creator_configs', 'answerly_diagnostic', 'answerly_backoff_until']);
  const configs = result.answerly_creator_configs || [];
  const diagnostic = result.answerly_diagnostic || { lastRuns: [], errors: [] };
  const backoffUntil = result.answerly_backoff_until || 0;

  if (configs.length === 0) {
    // Still reschedule with fresh jitter even if nothing to do
    await rescheduleStealthCheck();
    return;
  }

  const settings = await getTrackingSettings();

  // Off-hours guard — humans don't poll profiles at 3am
  if (settings.respectOffHours) {
    const h = new Date().getHours();
    if (h < 8 || h >= 23) {
      console.log(LOG_TAG, `[Tracking] Off-hours (${h}h) — skipping poll. Will retry on next alarm.`);
      await rescheduleStealthCheck();
      return;
    }
  }

  // 1. Safety Check: If we are in a backoff period, skip
  if (Date.now() < backoffUntil) {
    const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
    console.log(LOG_TAG, `[Tracking] In backoff for ${mins}min — skipping.`);
    await rescheduleStealthCheck();
    return;
  }

  // 2. Identify candidates (must have rested at least cooldownMinutes since last check)
  const COOLDOWN_MS = Math.max(5, settings.cooldownMinutes) * 60 * 1000;
  const candidates = configs.filter(c => (Date.now() - (c.lastChecked || 0)) > COOLDOWN_MS);

  if (candidates.length === 0) {
    await rescheduleStealthCheck();
    return;
  }

  // Pick the oldest from the rested candidates
  candidates.sort((a, b) => (a.lastChecked || 0) - (b.lastChecked || 0));
  const target = candidates[0];

  try {
    await setPulse(`Auto-Poll: ${target.label}...`);
    let newPostsFound = 0;
    const SCRAPE_TIMEOUT = 35000;

    if (target.platform === 'X') newPostsFound = await withTimeout(pollXWithShadowTab(target), SCRAPE_TIMEOUT, `X:${target.label}`);
    if (target.platform === 'LinkedIn') newPostsFound = await withTimeout(pollLinkedIn(target), SCRAPE_TIMEOUT, `LinkedIn:${target.label}`);
    if (target.platform === 'Reddit') newPostsFound = await withTimeout(pollReddit(target), SCRAPE_TIMEOUT, `Reddit:${target.label}`);
    if (target.platform === 'Product Hunt') newPostsFound = await withTimeout(pollProductHunt(target), SCRAPE_TIMEOUT, `PH:${target.label}`);

    target.lastChecked = Date.now();
    target.lastStatus = `Success: Found ${newPostsFound}`;
    await chrome.storage.local.set({ answerly_creator_configs: configs });

    diagnostic.lastRuns.unshift({ time: new Date().toISOString(), label: target.label, found: newPostsFound });
    diagnostic.lastRuns = diagnostic.lastRuns.slice(0, 20); 
    await chrome.storage.local.set({ answerly_diagnostic: diagnostic });
    await setPulse("Idle");

  } catch (error) {
    console.error(LOG_TAG, `Failure on ${target.label}:`, error);
    target.lastStatus = `Error: ${error.message}`;

    // Handle Rate Limiting (429) specifically
    if (error.message.includes('429')) {
      const TEN_MINS = 10 * 60 * 1000;
      await chrome.storage.local.set({ answerly_backoff_until: Date.now() + TEN_MINS });
      console.warn(LOG_TAG, "Rate limit detected. X polling paused for 10 minutes.");
    }

    diagnostic.errors.unshift({ time: new Date().toISOString(), label: target.label, error: error.message });
    diagnostic.errors = diagnostic.errors.slice(0, 10);
    await chrome.storage.local.set({ answerly_diagnostic: diagnostic });
  } finally {
    // Reschedule with fresh jitter so timing stays unpredictable
    await rescheduleStealthCheck();
  }
}

// ─── Scrapers ────────────────────────────────────────────────────────────────

async function pollXWithShadowTab(target) {
    let username = target.url.split('?')[0].split('/').filter(Boolean).pop();
    if (!username) throw new Error("Invalid X URL format.");

    console.log(LOG_TAG, `Launching Zero-Guessing Shadow Engine for @${username}...`);

    let shadowWindow = null;
    try {
        shadowWindow = await chrome.windows.create({
            url: `https://x.com/${username}`,
            type: 'popup',
            state: 'normal', 
            focused: false,
            width: 500,
            height: 600,
            left: 50,
            top: 50,
        });

        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        
        // Smart loading: Poll for tweets every 1s for up to 15s
        let tweets = [];
        for (let i = 0; i < 15; i++) {
            await setPulse(`X-Ray: Waiting for @${username} (${i}s)...`);
            
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN', // CRITICAL: Run in MAIN world to access window.__INITIAL_STATE__
                func: () => {
                    try {
                        // 1. Gold Source: Try extracting from window.__INITIAL_STATE__
                        const state = window.__INITIAL_STATE__;
                        if (state && state.entities?.tweets) {
                            return Object.values(state.entities.tweets).map(t => ({
                                id_str: t.id_str,
                                full_text: t.full_text || t.text
                            }));
                        }

                                // 2. Fallback: DOM Scrape if JSON state isn't ready
                                const tweetElements = document.querySelectorAll('[data-testid="tweet"], [role="article"]');
                                if (tweetElements.length > 0) {
                                    return Array.from(tweetElements).map(t => {
                                        // CRITICAL: Prioritize the status link to ensure direct post navigation
                                        const link = t.querySelector('a[href*="/status/"]');
                                        const text = t.querySelector('[data-testid="tweetText"]');
                                        if (!link) return null;
                                        
                                        const href = link.getAttribute('href');
                                        const tid = href.split('/status/')[1]?.split('?')[0];
                                        return { 
                                            id_str: tid, 
                                            full_text: text ? text.innerText : "New post found",
                                            post_url: href.startsWith('http') ? href : `https://x.com${href}`,
                                            interactionType: text ? 'Post' : 'Comment'
                                        };
                                    }).filter(Boolean);
                                }
                            } catch (e) { console.error("X-Ray Error:", e); }
                            return null;
                        }
            });

            tweets = results[0]?.result || [];
            if (tweets.length > 0) {
                await setPulse(`X-Ray: Found ${tweets.length} tweets for @${username}!`);
                break; 
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (tweets.length === 0) throw new Error("No tweets found. Profile might be private or loading failed.");

        let foundNew = 0;
        for (const tweet of tweets) {
            if (await isNewItem(`ans_x_${tweet.id_str}`)) {
                foundNew++;
                const postUrl = tweet.post_url || `https://x.com/${username}/status/${tweet.id_str}`;
                saveResult('X', tweet.full_text, `https://x.com/${username}`, target.label, '', postUrl, null, null, null, tweet.interactionType);
            }
        }
        return foundNew;

    } catch (error) {
        throw error;
    } finally {
        if (shadowWindow) try { chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
}

/**
 * LinkedIn Scraper: Deep URN Fallback
 */
async function pollLinkedIn(target) {
    let profileUrl = target.url.split('?')[0];
    if (!profileUrl.endsWith('/')) profileUrl += '/';
    const activityUrl = profileUrl + 'recent-activity/all/';

    await setPulse(`LinkedIn: Targeting Activity Page for @${target.label}...`);

    let shadowWindow = null;
    try {
        shadowWindow = await chrome.windows.create({
            url: activityUrl,
            type: 'popup',
            state: 'normal',
            focused: false,
            width: 500,
            height: 600,
            left: 100,
            top: 100,
        });

        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        let posts = [];

        // Smart Scroll & Capture Loop (Polling for 15s)
        for (let i = 0; i < 15; i++) {
            await setPulse(`LinkedIn: Virtual Scroll @${i}s...`);

            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    // Trigger Lazy Load
                    window.scrollTo(0, 1000);
                    
                    // Scrape visible posts
                    const elements = document.querySelectorAll('.feed-shared-update-v2, [data-urn*="urn:li:activity:"]');
                    return Array.from(elements).map(el => {
                        const urn = el.getAttribute('data-urn') || "";
                        const textEl = el.querySelector('.update-components-text, .feed-shared-text');
                        const linkEl = el.querySelector('.feed-shared-update-v2__control-menu, a[href*="/feed/update/"]');
                        
                        if (!urn) return null;
                        return {
                            id: urn.split(':').pop(),
                            text: textEl ? textEl.innerText.substring(0, 200) : "New LinkedIn Post",
                            url: `https://www.linkedin.com/feed/update/${urn}`,
                            interactionType: textEl?.innerText.length < 150 ? 'Comment' : 'Post'
                        };
                    }).filter(Boolean);
                }
            });

            posts = results[0]?.result || [];
            if (posts.length > 0) {
                await setPulse(`LinkedIn: Found ${posts.length} posts for @${target.label}!`);
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (posts.length === 0) throw new Error("No activity found. Profile might be private or loading failed.");

        let foundNew = 0;
        for (const post of posts) {
            if (await isNewItem(`ans_li_${post.id}`)) {
                foundNew++;
                saveResult('LinkedIn', post.text, profileUrl, target.label, '', post.url, null, null, null, post.interactionType);
            }
        }
        return foundNew;

    } catch (error) {
        throw error;
    } finally {
        if (shadowWindow) try { chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
}

/**
 * Reddit Scraper
 * Uses standard JSON feeds.
 */
/**
 * Reddit Scraper (Shadow Engine)
 * Handles Subreddits (/r/) and User Profiles (/u/)
 */
async function pollReddit(target) {
    let rawUrl = target.url.split('?')[0];
    if (rawUrl.endsWith('/')) rawUrl = rawUrl.slice(0, -1);
    
    let targetUrl = rawUrl;
    if (rawUrl.includes('/r/')) {
        targetUrl = rawUrl + '/new/';
    } else if (rawUrl.includes('/user/') || rawUrl.includes('/u/')) {
        targetUrl = rawUrl + '/submitted/';
    }

    console.log(LOG_TAG, `Reddit X-Ray: Scanning ${targetUrl}...`);

    let shadowWindow = null;
    try {
        shadowWindow = await chrome.windows.create({
            url: targetUrl,
            type: 'popup',
            state: 'minimized',
            focused: false,
        });

        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        let posts = [];

        // Smart Scan Loop (15s)
        for (let i = 0; i < 15; i++) {
            await setPulse(`Reddit X-Ray: Loading ${target.label} (${i}s)...`);

            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    // Target "Shreddit" posts (2026 format)
                    const elements = document.querySelectorAll('shreddit-post');
                    if (elements.length === 0) {
                        // Fallback for profile pages if shreddit-post isn't used
                        const feedItems = document.querySelectorAll('[data-testid="post-container"], .Post');
                        return Array.from(feedItems).map(el => {
                            const link = el.querySelector('a[href*="/comments/"]');
                            const title = el.querySelector('h1, h2, [data-adclicklocation="title"]');
                            if (!link) return null;
                            return {
                                id: link.getAttribute('href').split('/comments/')[1]?.split('/')[0],
                                title: title ? title.innerText : "New Reddit Post",
                                url: link.href.startsWith('http') ? link.href : `https://www.reddit.com${link.getAttribute('href')}`,
                                interactionType: title?.innerText.length < 100 ? 'Comment' : 'Post'
                            };
                        }).filter(Boolean);
                    }

                    return Array.from(elements).slice(0, 10).map(el => {
                        const permalink = el.getAttribute('permalink');
                        const id = el.getAttribute('id');
                        const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.innerText;
                        // Try to grab self-text body from the post element
                        const bodyEl = el.querySelector('[slot="text-body"], .md, [data-click-id="text"]');
                        const body = bodyEl ? bodyEl.innerText.trim() : '';
                        
                        if (!permalink) return null;
                        return {
                            id: id || permalink.split('/comments/')[1]?.split('/')[0],
                            title: title || "New Reddit Post",
                            body,
                            url: `https://www.reddit.com${permalink}`,
                            interactionType: (title?.length + body?.length) < 150 ? 'Comment' : 'Post'
                        };
                    }).filter(Boolean);
                }
            });

            posts = results[0]?.result || [];
            if (posts.length > 0) {
                await setPulse(`Reddit X-Ray: Found ${posts.length} posts for ${target.label}!`);
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (posts.length === 0) throw new Error("No posts found. Is the Reddit profile/sub public?");

        let foundNew = 0;
        for (const post of posts) {
            if (await isNewItem(`ans_rd_${post.id}`)) {
                foundNew++;
                // Store title as 'text' for extension popup, full body as 'body' for web app
                saveResult('Reddit', post.title, targetUrl, target.label, post.body || '', post.url, null, null, null, post.interactionType);
            }
        }
        return foundNew;

    } catch (error) {
        throw error;
    } finally {
        if (shadowWindow) try { chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
}

// ─── Utils ──────────────────────────────────────────────────────────────────

/**
 * Product Hunt Scraper
 * Uses GraphQL inside a shadow tab to bypass advanced bot protection.
 */
async function pollProductHunt(target) {
    await setPulse(`PH X-Ray: Scanning discussions...`);
    
    let shadowWindow = null;
    try {
        shadowWindow = await chrome.windows.create({
            url: 'https://www.producthunt.com/discussions',
            type: 'popup',
            state: 'minimized',
            focused: false,
        });

        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");

        const query = `
          query DiscussionsPage($cursor: String) {
            discussions(first: 10, after: $cursor) {
              edges {
                node {
                  id
                  title
                  url
                  createdAt
                  user { name }
                  commentsCount
                }
              }
            }
          }
        `;

        await new Promise(r => setTimeout(r, 5000)); // Wait for session setup

        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (gqlQuery) => {
                const res = await fetch("https://www.producthunt.com/frontend/graphql", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        operationName: "DiscussionsPage",
                        variables: { cursor: null },
                        query: gqlQuery
                    })
                });
                return await res.json();
            },
            args: [query]
        });

        const data = results[0]?.result?.data?.discussions?.edges || [];
        let foundNew = 0;
        for (const edge of data) {
            const node = edge.node;
            if (await isNewItem(`ans_ph_${node.id}`)) {
                foundNew++;
                const postUrl = `https://www.producthunt.com${node.url}`;
                saveResult('Product Hunt', node.title, 'https://www.producthunt.com/discussions', node.user?.name || "Community", '', postUrl);
            }
        }
        return foundNew;
    } finally {
        if (shadowWindow) try { chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
}

async function getCookie(url, name) {
  const cookie = await chrome.cookies.get({ url, name });
  if (!cookie) return null;
  // LinkedIn requires JSessionID without quotes
  return cookie.value.replace(/"/g, "");
}

async function isNewItem(id) {
  const res = await chrome.storage.local.get([id]);
  if (res[id]) return false;
  await chrome.storage.local.set({ [id]: Date.now() });
  return true;
}

async function saveResult(platform, text, url, creator, body = '', postUrl = '', campaignId = null, campaignName = null, intent = null, interactionType = 'Post') {
    // V4: Conflict Detection in Triage
    const conflictKeywords = ['agency', 'expert', 'consultant', 'freelancer', 'coach', 'guru', 'hire', 'service', 'solution', 'partner', 'specialist', 'advisor', 'mentor', 'trainer', 'firm', 'group'];
    const lowerText = (creator + ' ' + (text || '')).toLowerCase();
    const isCompetitor = conflictKeywords.some(k => lowerText.includes(k));

    if (isCompetitor) {
        console.log(LOG_TAG, `V4 Filter (Triage): Discarding ${creator} due to profile conflict.`);
        const resD = await chrome.storage.local.get(['disqualified_signals']);
        let disqualified = resD.disqualified_signals || [];
        if (!disqualified.includes(url)) {
            disqualified.push(url);
            await chrome.storage.local.set({ disqualified_signals: disqualified });
        }
        return;
    }

    const res = await chrome.storage.local.get(['answerly_history']);
    const history = res.answerly_history || [];
    history.unshift({
        platform,
        text,
        body,
        url,
        creator,
        postUrl: postUrl || url,
        timestamp: new Date().toISOString(),
        uuid: 'ans_' + Date.now() + Math.random(),
        campaignId,
        campaignName,
        intent,
        interactionType
    });
    // Limit to 100 items for better triage visibility
    await chrome.storage.local.set({ answerly_history: history.slice(0, 100) });
}

// ─── Recon Shadow Tab Engines ───────────────────────────────────────────────

async function executeReconSweep(request) {
    // Determine if we received a raw array (legacy) or a request object (new)
    const keywords = Array.isArray(request) ? request : (request.keywords || []);
    const enabledPlatforms = (request.platforms || []).map(p => p.toLowerCase());
    const campaign = request.campaign || null;

    await setPulse(`Starting Pipeline Recon for ${keywords.length} keywords...`);
    
    // Filter keywords BY SELECTIVE PLATFORM before execution
    const xKeywords = keywords.filter(k => {
        const p = k.platform.toLowerCase();
        return (p === 'x' || p === 'twitter') && (enabledPlatforms.length === 0 || enabledPlatforms.includes('x'));
    });
    const liKeywords = keywords.filter(k => {
        const p = k.platform.toLowerCase();
        return (p === 'linkedin') && (enabledPlatforms.length === 0 || enabledPlatforms.includes('linkedin'));
    });
    const rdKeywords = keywords.filter(k => {
        const p = k.platform.toLowerCase();
        return (p === 'reddit') && (enabledPlatforms.length === 0 || enabledPlatforms.includes('reddit'));
    });

    const stats = { 
        platforms: {},
        intelligence: {
            buyNow: 0,
            warm: 0,
            nurture: 0
        }
    };

    try {
        const depth = campaign?.reconDepth || 'surface';
        
        if (xKeywords.length > 0) {
            const xRes = await runPipelineSweepX(xKeywords, campaign);
            stats.platforms['X'] = xRes;
            stats.intelligence.buyNow += (xRes.buyNow || 0);
            stats.intelligence.warm += (xRes.warm || 0);
            stats.intelligence.nurture += (xRes.nurture || 0);
            
            if (depth !== 'surface' && xRes.postsToDeepScan?.length > 0) {
                await setPulse(`X Deep Scan: Analyzing ${xRes.postsToDeepScan.length} threads for relevant commenters...`);
                await performEngagementDeepScan('X', xRes.postsToDeepScan, campaign);
            }
        }
        
        if (liKeywords.length > 0) {
            const liRes = await runPipelineSweepLinkedIn(liKeywords, campaign);
            stats.platforms['LinkedIn'] = liRes;
            stats.intelligence.buyNow += (liRes.buyNow || 0);
            stats.intelligence.warm += (liRes.warm || 0);
            stats.intelligence.nurture += (liRes.nurture || 0);

            if (depth !== 'surface' && liRes.postsToDeepScan?.length > 0) {
                await setPulse(`LinkedIn Deep Scan: Analyzing ${liRes.postsToDeepScan.length} threads...`);
                await performEngagementDeepScan('LinkedIn', liRes.postsToDeepScan, campaign);
            }
        }
        
        if (rdKeywords.length > 0) {
            const rdRes = await runPipelineSweepReddit(rdKeywords, campaign);
            stats.platforms['Reddit'] = rdRes;
            stats.intelligence.buyNow += (rdRes.buyNow || 0);
            stats.intelligence.warm += (rdRes.warm || 0);
            stats.intelligence.nurture += (rdRes.nurture || 0);

            if (depth !== 'surface' && rdRes.postsToDeepScan?.length > 0) {
                await setPulse(`Reddit Deep Scan: Analyzing ${rdRes.postsToDeepScan.length} threads...`);
                await performEngagementDeepScan('Reddit', rdRes.postsToDeepScan, campaign);
            }
        }
    } catch (error) {
        console.error(LOG_TAG, "Sweep Error:", error);
    } finally {
        await setPulse("Pipeline Recon Completed.");
    }
    
    return stats;
}

async function savePipelineLead(platform, profileUrl, profileName, keyword, reason, postText = '', role = '', postUrl = '', campaign = null, interactionType = 'Post', options = {}) {
    try {
        // V5: Deterministic Intelligence Scoring (18-Layer Pipeline)
        const intel = typeof processLeadIntelligence === 'function' 
            ? processLeadIntelligence({ postText, text: postText, name: profileName, role }, campaign)
            : { score: 50, tier: 'Nurture', signals: [] };

        if (options.scoreOnly) {
            return { success: false, score: intel.score, tier: intel.tier, signals: intel.signals };
        }

        const res = await chrome.storage.local.get(['pipeline_leads', 'disqualified_signals']);
        let leads = res.pipeline_leads || [];
        if (!Array.isArray(leads)) leads = [];
        
        let disqualified = res.disqualified_signals || [];
        if (!Array.isArray(disqualified)) disqualified = [];

        // Layer 16-17: Competitor Detection
        if (intel.score < 10 && intel.signals.some(s => s.toLowerCase().includes('competitor'))) {
            console.log(LOG_TAG, `V5 Intelligence: Discarding competitor ${profileName}`);
            if (!disqualified.includes(profileUrl)) {
                disqualified.push(profileUrl);
                await chrome.storage.local.set({ disqualified_signals: disqualified });
            }
            return false;
        }

        // Ensure we NEVER fall back to profile URL if a post was intended
        const finalPostUrl = (postUrl && (postUrl.includes('/status/') || postUrl.includes('/update/') || postUrl.includes('/comments/'))) 
            ? postUrl 
            : (postUrl || profileUrl);

        // V5: Multi-Signal Deduplication (Per-Campaign)
        // A lead is a duplicate only if found in the SAME campaign with the SAME content
        const campaignId = campaign?.id || 'default';
        const exists = leads.some(l => l && 
            (l.postUrl === finalPostUrl || (l.url === profileUrl && l.interactionType === interactionType)) && 
            l.campaignId === campaignId
        );
        if (exists) return { success: false, reason: 'Duplicate' };

        leads.unshift({
            url: profileUrl,
            name: profileName || profileUrl.split('/').pop(),
            role: role || '',
            campaignId: campaignId,
            relevance: intel.score,
            intelligenceScore: intel.score,
            intelligenceTier: intel.tier,
            intelligenceSignals: intel.signals,
            intelligencePipeline: intel.pipeline, // PERSIST THE 12-STEP REASONING
            why: reason,
            postText: postText || '',
            postUrl: finalPostUrl,
            tags: [keyword, platform],
            status: 'pending_verification', // V5: Intelligence Triage Required
            scannedAt: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            interactionType
        });
        
        await chrome.storage.local.set({ pipeline_leads: leads.slice(0, 200) });
        return { success: true, tier: intel.tier };
    } catch (e) {
        console.error(LOG_TAG, "Error saving pipeline lead:", e);
        return { success: false };
    }
}

async function runPipelineSweepX(keywords, campaign = null) {
    console.log(LOG_TAG, `[X Sweep] reconDepth="${campaign?.reconDepth}", keywords=${keywords.length}`);
    let totalFound = 0;
    let buyNow = 0;
    let warm = 0;
    let nurture = 0;
    let shadowWindow = null;

    try {
        shadowWindow = await chrome.windows.create({ 
            url: 'https://x.com', 
            type: 'popup', 
            state: 'normal', 
            focused: false,
            // Biometric Jitter: Randomize window size and position
            width: 500 + Math.floor(Math.random() * 100),
            height: 600 + Math.floor(Math.random() * 100),
            left: 150 + Math.floor(Math.random() * 50),
            top: 150 + Math.floor(Math.random() * 50)
        });
        
        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        
        // Anti-block delay
        await new Promise(r => setTimeout(r, 4000));

        const sessionKeywords = keywords.slice(0, 15);
        let keywordIndex = 0;

        for (const kw of sessionKeywords) {
            keywordIndex++;
            console.log(LOG_TAG, `X Pipeline [${keywordIndex}/${sessionKeywords.length}]: Searching "${kw.query}"`);
            
            // Stats init
            const kwKey = `X__${kw.query}`;
            const statsRes = await chrome.storage.local.get(['keyword_stats']);
            const kwStats = statsRes.keyword_stats || {};
            kwStats[kwKey] = { query: kw.query, platform: 'X', status: 'running', startedAt: new Date().toISOString(), found: 0, hot: 0, warm: 0 };
            await chrome.storage.local.set({ keyword_stats: kwStats });

            const monthAgo = new Date();
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            const dateStr = monthAgo.toISOString().split('T')[0];
            const filteredQuery = kw.query + ` since:${dateStr}`;

            await chrome.tabs.update(tabId, { url: `https://x.com/search?q=${encodeURIComponent(filteredQuery)}&f=live` });
            
            let kwFound = 0;
            let kwHot = 0;
            let kwWarm = 0;
            let profiles = [];

            for (let i = 0; i < 15; i++) {
                await setPulse(`X Pipeline: "${kw.query}" (${i}s)...`, { found: totalFound, scanned: totalFound + (i * 1) });
                
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (query) => {
                        try {
                            // SAFETY: Only scrape if we are actually on a search result page
                            if (!window.location.href.includes('/search')) {
                                console.log("Answerly: Not on search page yet, skipping scrape...");
                                return [];
                            }

                            const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
                            if (tweetElements.length > 0) {
                                return Array.from(tweetElements).map(t => {
                                    const profileLink = t.querySelector('[data-testid="User-Name"] a[role="link"][href^="/"]');
                                    if (!profileLink) return null;
                                    
                                    const username = profileLink.getAttribute('href').replace('/', '');
                                    const displayNameEl = t.querySelector('[data-testid="User-Name"] span');
                                    const displayName = displayNameEl ? displayNameEl.innerText : username;
                                    const tweetTextEl = t.querySelector('[data-testid="tweetText"]');
                                    const postText = tweetTextEl ? tweetTextEl.innerText : "";

                                    const allLinks = Array.from(t.querySelectorAll('a[href*="/status/"]'));
                                    const statusLink = allLinks.find(a => {
                                        const href = a.getAttribute('href') || '';
                                        return href.includes('/status/') && !href.includes('/photo/') && !href.includes('/video/');
                                    });
                                    
                                    let postUrl = `https://x.com/${username}`;
                                    if (statusLink) {
                                        const href = statusLink.getAttribute('href');
                                        postUrl = href.startsWith('http') ? href : `https://x.com${href}`;
                                    }
                                    
                                    const timeEl = t.querySelector('time');
                                    const timestamp = timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString();
                                    
                                    return { 
                                        url: `https://x.com/${username}`, 
                                        name: username,
                                        role: displayName !== username ? displayName : '',
                                        reason: `Posted about "${query}"`,
                                        postText,
                                        postUrl,
                                        timestamp,
                                        platform: 'X'
                                    };
                                }).filter(Boolean);
                            }
                        } catch (e) {}
                        return [];
                    },
                    args: [kw.query]
                });

                profiles = results[0]?.result || [];
                if (profiles.length > 0) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (profiles.length > 0) {
                for (const p of profiles) {
                    const reconDepth = campaign?.reconDepth || 'surface';
                    let saved = { success: false };

                    // Only save the main Post as a Lead if we are in 'surface' mode
                    if (reconDepth === 'surface') {
                        saved = await savePipelineLead('X', p.url, p.name, kw.query, p.reason, p.postText, p.role, p.postUrl, campaign, 'Post');
                    } else {
                        // In deep modes, we still "process" it for stats/history but don't commit to Pipeline yet
                        // We will save commenters later in the Deep Scan phase
                        saved = { success: true, tier: 'Nurture' }; 
                    }

                    if (saved && saved.success) {
                        totalFound++;
                        kwFound++;
                        if (saved.tier === 'Buy Now') { buyNow++; kwHot++; }
                        else if (saved.tier === 'Warm Opportunity') { warm++; kwWarm++; }
                        else nurture++;
                        
                        // LIVE UPDATE: Persist stats immediately
                        const liveStatsRes = await chrome.storage.local.get(['keyword_stats']);
                        const liveStats = liveStatsRes.keyword_stats || {};
                        liveStats[kwKey] = { ...liveStats[kwKey], found: kwFound, hot: kwHot, warm: kwWarm };
                        await chrome.storage.local.set({ keyword_stats: liveStats });
                    }
                    
                    // Always save the result for history, but LEADS are selective
                    await saveResult('X', p.postText || p.reason, p.url, p.name, '', p.postUrl, kw.campaignId, kw.campaignName, kw.intent);
                }

                // Prepare for Deep Scan if enabled
                const reconDepth = campaign?.reconDepth || 'surface';
                if (reconDepth !== 'surface') {
                    const statusPosts = profiles.filter(p => p.postUrl && p.postUrl.includes('/status/'));
                    postsToDeepScan.push(...statusPosts.map(p => ({ url: p.postUrl, platform: 'X', text: p.postText })));
                }
            }
            // ──────────────────────────────────────────────────────────────

            // ─── PERSIST PER-KEYWORD STATS ───
            const finalStatsRes = await chrome.storage.local.get(['keyword_stats']);
            const finalStats = finalStatsRes.keyword_stats || {};
            finalStats[kwKey] = {
                ...finalStats[kwKey],
                status: 'done',
                completedAt: new Date().toISOString(),
                found: kwFound,
                hot: kwHot,
                warm: kwWarm
            };
            await chrome.storage.local.set({ keyword_stats: finalStats });

            // ─── ANTI-BLOCK: Human-like inter-keyword delay ───────────────────
            // Gaussian delay: avg 40s, std 15s — mimics human reading between searches
            const minDelay = 25000;
            const maxDelay = 75000;
            const gaussianDelay = Math.min(maxDelay, Math.max(minDelay,
                (Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random())) * 15000 + 40000
            ));
            await setPulse(`X: Cooling down (${Math.round(gaussianDelay / 1000)}s)...`);
            await new Promise(r => setTimeout(r, gaussianDelay));

            // Session cool-down every 8 keywords (mimics human break)
            if (keywordIndex % 8 === 0 && keywordIndex < sessionKeywords.length) {
                const cooldown = 120000 + Math.random() * 120000; // 2-4 min
                await setPulse(`X: Session break (${Math.round(cooldown / 60000)} min). Resuming shortly...`);
                await new Promise(r => setTimeout(r, cooldown));
            }
            // ─────────────────────────────────────────────────────────────────
        }
    } finally {
        if (shadowWindow) try { await chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
    return { found: totalFound, scanned: keywords.length * 10, status: 'complete', buyNow, warm, nurture };
}

async function runPipelineSweepLinkedIn(keywords, campaign = null) {
    let totalFound = 0;
    let buyNow = 0;
    let warm = 0;
    let nurture = 0;
    let shadowWindow = null;
    let postsToDeepScan = [];
    try {
        shadowWindow = await chrome.windows.create({ 
            url: 'https://www.linkedin.com', 
            type: 'popup', 
            state: 'normal', 
            focused: false,
            width: 500,
            height: 600,
            left: 100,
            top: 100
        });
        
        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");

        for (const kw of keywords) {
            console.log(LOG_TAG, `LinkedIn Pipeline: Searching "${kw.query}"`);
            // Add LinkedIn 1-Month Recency Constraint (f_TPR=r2592000 is past 30 days)
            await chrome.tabs.update(tabId, { url: `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(kw.query)}&f_TPR=r2592000` });
            
            let profiles = [];
            for (let i = 0; i < 15; i++) {
                await setPulse(`LinkedIn Pipeline: "${kw.query}" (${i}s)...`, { found: totalFound, scanned: totalFound + (i * 1) });
                
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (query) => {
                        // SAFETY: Only scrape if we are on a search result page
                        if (!window.location.href.includes('/search')) return [];
                        
                        window.scrollTo(0, 1000);
                        const elements = document.querySelectorAll('.feed-shared-update-v2, .search-result__wrapper, .entity-result');
                        return Array.from(elements).map(el => {
                            const actorLink = el.querySelector('a.app-aware-link[href*="/in/"], a.app-aware-link[href*="/company/"]');
                            if (!actorLink) return null;
                            
                            const nameEl = el.querySelector('.update-components-actor__name, .entity-result__title-text');
                            const name = nameEl ? nameEl.innerText.split('\n')[0].trim() : 'LinkedIn User';
                            
                            const roleEl = el.querySelector('.update-components-actor__description, .entity-result__primary-subtitle');
                            const role = roleEl ? roleEl.innerText.split('\n')[0].trim() : '';

                            const isLiked = el.innerText.includes('likes this') || el.innerText.includes('liked this');
                            const isCommented = el.innerText.includes('commented on');
                            
                            let reason = `Posted about "${query}"`;
                            if (isLiked) reason = `Liked a post about "${query}"`;
                            if (isCommented) reason = `Commented on a post about "${query}"`;
                            
                            const textNode = el.querySelector('.update-components-text, .feed-shared-text, .search-result__snippet, .entity-result__content-summary');
                            const postText = textNode ? textNode.innerText : '';
                            
                            const allLinks = Array.from(el.querySelectorAll('a'));
                            const postLink = allLinks.find(a => 
                                a.href.includes('/feed/update/urn:li:activity:') || 
                                a.href.includes('/activity/')
                            );
                            
                            // SIMULATED CLICK: Expand LinkedIn Comments in-place
                            const commentBtn = el.querySelector('button[aria-label*="comment"], .comment-button');
                            if (commentBtn) commentBtn.click();

                            return {
                                url: actorLink.href.split('?')[0],
                                name: name,
                                  role: role,
                                reason: reason,
                                postText: postText,
                                postUrl: postLink ? postLink.href : actorLink.href.split('?')[0]
                            };
                        }).filter(Boolean);
                    },
                    args: [kw.query]
                });

                profiles = results[0]?.result || [];
                if (profiles.length > 0) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (profiles.length > 0) {
                const depth = campaign?.reconDepth || 'surface';
                const isEngagementMode = depth === 'engagement';

                for (const p of profiles) {
                    const scoreRes = await savePipelineLead('LinkedIn', p.url, p.name, kw.query, p.reason, p.postText, p.role, p.postUrl, campaign, 'Post', { scoreOnly: isEngagementMode });
                    
                    let saved = scoreRes;
                    if (isEngagementMode && scoreRes.tier === 'Buy Now') {
                        saved = await savePipelineLead('LinkedIn', p.url, p.name, kw.query, p.reason, p.postText, p.role, p.postUrl, campaign, 'Post');
                    }

                    await saveResult('LinkedIn', p.postText || p.reason, p.url, p.name, '', p.postUrl, kw.campaignId, kw.campaignName, kw.intent);
                    
                    const canProceed = saved.success || (isEngagementMode && scoreRes.tier !== 'IGNORE');
                    if (canProceed) {
                        totalFound++;
                        kwFound++;
                        const shouldDeepScan = (scoreRes.tier === 'Buy Now') || (isEngagementMode && scoreRes.tier !== 'IGNORE');

                        if (shouldDeepScan) {
                            if (saved.tier === 'Buy Now') { buyNow++; kwHot++; } else { warm++; kwWarm++; }
                            postsToDeepScan.push({ url: p.postUrl, platform: 'LinkedIn' });
                        }
                        else if (saved.tier === 'Warm Opportunity') { warm++; kwWarm++; }
                        else nurture++;

                        // LIVE UPDATE: Persist stats immediately for dashboard
                        const liveStatsRes = await chrome.storage.local.get(['keyword_stats']);
                        const liveStats = liveStatsRes.keyword_stats || {};
                        const kwKey = `LinkedIn__${kw.query}`;
                        liveStats[kwKey] = { ...liveStats[kwKey], found: kwFound, hot: kwHot, warm: kwWarm };
                        await chrome.storage.local.set({ keyword_stats: liveStats });
                    }
                }
            }
        }
    } finally {
        if (shadowWindow) try { await chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
    return { found: totalFound, scanned: keywords.length * 10, status: 'complete', buyNow, warm, nurture, postsToDeepScan: postsToDeepScan.slice(0, 5) };
}

/**
 * Deep Engagement Agent
 * Click into threads to find commenters and reactors
 */
async function performEngagementDeepScan(platform, targets, campaign) {
    const depth = campaign.reconDepth || 'deep';
    let shadowWindow = null;
    try {
        shadowWindow = await chrome.windows.create({ 
            url: 'about:blank', 
            type: 'popup', 
            state: 'normal', 
            focused: false,
            width: 500,
            height: 600
        });
        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        
        for (const target of targets) {
            const reconDepth = campaign.reconDepth || 'deep';
            await setPulse(`Deep Recon: Entering ${platform} thread...`);
            await chrome.tabs.update(tabId, { url: target.url });
            
            // Jittered hydration delay (5-9s)
            await new Promise(r => setTimeout(r, 5000 + Math.random() * 4000)); 

            // 1. Comment Mining
            const commenters = await chrome.scripting.executeScript({
                target: { tabId },
                func: async (plt) => {
                    // AGGRESSIVE & RANDOMIZED HYDRATION
                    const scrolls = plt === 'X' ? 10 : 5;
                    for(let i=0; i < scrolls; i++) {
                        // Randomized scroll distance (1200-1800px)
                        const dist = 1200 + Math.random() * 600;
                        window.scrollBy(0, dist);
                        // Randomized pause (1-2s) mimics human reading
                        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                    }
                    
                    let items = [];
                    if (plt === 'X') {
                        // Better X selector: Skip the first tweet (main post)
                        const allTweets = Array.from(document.querySelectorAll('[data-testid="tweet"]'));
                        if (allTweets.length <= 1) return [];
                        
                        items = allTweets.slice(1).map(r => { 
                            const userLink = r.querySelector('[data-testid="User-Name"] a');
                            const tweetText = r.querySelector('[data-testid="tweetText"]');
                            const timeLink = r.querySelector('time')?.parentElement;
                            if (!userLink) return null;
                            
                            const nameBlock = userLink.innerText.split('\n');
                            const displayName = nameBlock[0].trim();
                            const handle = nameBlock[1]?.replace('@', '').trim() || '';
                            
                            return {
                                url: `https://x.com/${handle}`,
                                name: displayName,
                                text: tweetText ? tweetText.innerText : 'Active in conversation',
                                interactionType: 'Comment',
                                commentUrl: (timeLink && timeLink.href) ? timeLink.href : userLink.href 
                            };
                        });
                    } else if (plt === 'LinkedIn') {
                        const comments = document.querySelectorAll('.comments-comment-item');
                        items = Array.from(comments).map(c => {
                            const link = c.querySelector('.comments-post-meta__actor-link');
                            const text = c.querySelector('.comments-comment-item__main-content');
                            const headline = c.querySelector('.comments-post-meta__headline');
                            if (!link) return null;
                            return {
                                url: link.href.split('?')[0],
                                name: link.innerText.split('\n')[0].trim(),
                                role: headline ? headline.innerText.trim() : '',
                                text: text ? text.innerText.trim() : 'Commented on LinkedIn',
                                interactionType: 'Comment'
                            };
                        });
                    }
                    return items.filter(Boolean);
                },
                args: [platform]
            });

            for (const c of (commenters[0]?.result || [])) {
                // Fixed: Pass role/headline to intelligence engine so it can perform Identity-Pass
                const intel = typeof processLeadIntelligence === 'function' 
                    ? processLeadIntelligence({ postText: c.text, text: c.text, name: c.name, role: c.role }, campaign)
                    : { score: 50, tier: 'Warm Opportunity' };

                if (intel.tier !== 'IGNORE') {
                    const leadUrl = c.commentUrl || c.url;
                    await savePipelineLead(platform, leadUrl, c.name, 'Comment Engagement', 
                        `Commented on thread: "${(target.text || '').substring(0, 50)}..."`, 
                        c.text, c.role || '', target.url, campaign, 'Comment');
                }
            }

            // 2. Reactor Extraction (Atomic only)
            if (depth === 'atomic') {
                await setPulse(`Atomic Recon: Extracting reactors...`);
                // Note: Actual clicking into likes requires complex biometric sequences
                // For now, we capture visible reactors from the "Reactions" summary if possible
                // or use platform specific modals.
                // TODO: Full modal click-through in next version
            }
        }
    } finally {
        if (shadowWindow) try { await chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
}

async function runPipelineSweepReddit(keywords, campaign = null) {
    let totalFound = 0;
    let buyNow = 0;
    let warm = 0;
    let nurture = 0;
    let shadowWindow = null;
    try {
        shadowWindow = await chrome.windows.create({ 
            url: 'https://www.reddit.com', 
            type: 'popup', 
            state: 'normal', 
            focused: false,
            width: 500,
            height: 600,
            left: 200,
            top: 200
        });
        
        const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        if (!tabId) throw new Error("Shadow tab initialization failed.");

        for (const kw of keywords) {
            console.log(LOG_TAG, `Reddit Pipeline: Searching "${kw.query}"`);
            
            const kwKey = `Reddit__${kw.query}`;
            const statsRes = await chrome.storage.local.get(['keyword_stats']);
            const kwStats = statsRes.keyword_stats || {};
            kwStats[kwKey] = { query: kw.query, platform: 'Reddit', status: 'running', startedAt: new Date().toISOString(), found: 0, hot: 0, warm: 0 };
            await chrome.storage.local.set({ keyword_stats: kwStats });

            let kwFound = 0;
            let kwHot = 0;
            let kwWarm = 0;

            // Reddit 1-Month Recency Filter (t=month)
            await chrome.tabs.update(tabId, { url: `https://www.reddit.com/search/?q=${encodeURIComponent(kw.query)}&t=month&sort=new` });
            
            let profiles = [];
            for (let i = 0; i < 15; i++) {
                await setPulse(`Reddit Pipeline: "${kw.query}" (${i}s)...`, { found: totalFound, scanned: totalFound + (i * 1) });
                
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (query) => {
                        // SAFETY: Only scrape if we are actually on a search page
                        if (!window.location.href.includes('/search')) return [];

                        const elements = document.querySelectorAll('shreddit-post, .Post');
                        return Array.from(elements).map(el => {
                            const author = el.getAttribute('author') || el.querySelector('[data-testid="post_author_link"]')?.innerText?.replace('u/', '');
                            if (!author) return null;
                            
                            let subreddit = el.getAttribute('subreddit-prefixed') || el.querySelector('a[href^="/r/"]')?.innerText;
                            if (!subreddit && window.location.href.includes('/r/')) {
                                subreddit = 'r/' + window.location.href.split('/r/')[1].split('/')[0];
                            }
                            
                            const bodyEl = el.querySelector('[slot="text-body"], .md, [data-click-id="text"]');
                            const postText = bodyEl ? bodyEl.innerText.trim() : (el.getAttribute('post-title') || '');
                            const permalink = el.getAttribute('permalink');
                            const postUrl = permalink ? `https://www.reddit.com${permalink}` : `https://www.reddit.com/user/${author}`;

                            // V5: High-Fidelity Signal Extraction
                            const timestamp = el.getAttribute('created-at') || new Date().toISOString();
                            
                            return {
                                url: `https://www.reddit.com/user/${author}`,
                                name: author,
                                role: subreddit || 'Reddit',
                                reason: `Posted in ${subreddit || 'Reddit'} about "${query}"`,
                                postText: postText,
                                postUrl: postUrl,
                                timestamp: timestamp
                            };
                        }).filter(Boolean);
                    },
                    args: [kw.query]
                });

                profiles = results[0]?.result || [];
                if (profiles.length > 0) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (profiles.length > 0) {
                for (const p of profiles) {
                    const saved = await savePipelineLead('Reddit', p.url, p.name, kw.query, p.reason, p.postText, p.role, p.postUrl, campaign);
                    if (saved && saved.success) {
                        totalFound++;
                        kwFound++;
                        if (saved.tier === 'Buy Now') { buyNow++; kwHot++; }
                        else if (saved.tier === 'Warm Opportunity') { warm++; kwWarm++; }
                        else nurture++;

                        // LIVE UPDATE: Persist stats immediately for dashboard
                        const liveStatsRes = await chrome.storage.local.get(['keyword_stats']);
                        const liveStats = liveStatsRes.keyword_stats || {};
                        liveStats[kwKey] = { ...liveStats[kwKey], found: kwFound, hot: kwHot, warm: kwWarm };
                        await chrome.storage.local.set({ keyword_stats: liveStats });
                    }
                }
            }

            // Mark this keyword as done
            const finalStatsRes = await chrome.storage.local.get(['keyword_stats']);
            const finalStats = finalStatsRes.keyword_stats || {};
            finalStats[kwKey] = {
                ...finalStats[kwKey],
                status: 'done',
                completedAt: new Date().toISOString(),
                found: kwFound,
                hot: kwHot,
                warm: kwWarm
            };
            await chrome.storage.local.set({ keyword_stats: finalStats });

            await new Promise(r => setTimeout(r, 8000 + Math.random() * 4000));
        }
    } finally {
        if (shadowWindow) try { await chrome.windows.remove(shadowWindow.id); } catch(e) {}
    }
    return { found: totalFound, scanned: keywords.length * 10, status: 'complete', buyNow, warm, nurture };
}

// ─── Reconnaissance Loop ───────────────────────────────────────────────────

async function processNextReconKeyword() {
    const res = await chrome.storage.local.get(['recon_queue', 'active_campaign', 'stop_recon_mission']);
    
    // Safety: If stop flag is true OR active_campaign is missing, HALT EVERYTHING
    if (res.stop_recon_mission || !res.active_campaign) {
        console.log(LOG_TAG, "Mission stop flag detected or no active campaign. Halting trickle loop.");
        return;
    }

    let queue = res.recon_queue || [];
    if (queue.length === 0) {
        console.log(LOG_TAG, "Queue empty. Mission complete.");
        chrome.alarms.clear("queueProcessor");
        await setPulse("Recon Mission Complete. All keywords processed.");
        return;
    }

    // Pick a random keyword to simulate human unpredictability
    const randomIndex = Math.floor(Math.random() * queue.length);
    const nextKw = queue.splice(randomIndex, 1)[0];
    
    await chrome.storage.local.set({ recon_queue: queue });
    
    console.log(LOG_TAG, `Stealth Trickle: Searching "${nextKw.query}" (${queue.length} left in queue)`);

    // Mark keyword as 'running' in keyword_stats
    const kwStatsRes = await chrome.storage.local.get(['keyword_stats']);
    const kwStats = kwStatsRes.keyword_stats || {};
    const kwKey = `${nextKw.platform}__${nextKw.query}`;
    kwStats[kwKey] = { ...kwStats[kwKey], query: nextKw.query, platform: nextKw.platform, status: 'running', startedAt: new Date().toISOString(), found: 0, hot: 0, warm: 0 };
    await chrome.storage.local.set({ keyword_stats: kwStats });
    
    // Update stats for Dashboard visibility
    chrome.storage.local.get(['stealth_mission_stats'], (s) => {
        const stats = s.stealth_mission_stats || { scanned: 0, found: 0 };
        chrome.storage.local.set({ 
            stealth_mission_stats: { 
                ...stats, 
                scanned: (stats.scanned || 0) + 1,
                current_vector: nextKw.query 
            } 
        });
    });

    try {
        const result = await executeReconSweep({ 
            keywords: [nextKw],
            campaign: res.active_campaign 
        });

        // Save per-keyword results back to keyword_stats
        const kwStatsRes2 = await chrome.storage.local.get(['keyword_stats']);
        const kwStats2 = kwStatsRes2.keyword_stats || {};
        const platformResult = result?.platforms?.[nextKw.platform] || {};
        kwStats2[kwKey] = {
            ...kwStats2[kwKey],
            status: 'done',
            completedAt: new Date().toISOString(),
            found: (platformResult.found || 0),
            hot: (platformResult.buyNow || 0),
            warm: (platformResult.warm || 0),
        };
        await chrome.storage.local.set({ keyword_stats: kwStats2 });
    } catch (err) {
        console.error(LOG_TAG, "Stealth Trickle Error:", err);
    } finally {
        // RECURSION: Process next keyword after a brief 'human-like' delay
        const check = await chrome.storage.local.get(['stop_recon_mission']);
        if (!check.stop_recon_mission) {
            const nextDelay = 12000 + Math.random() * 5000; 
            currentReconTimeout = setTimeout(() => processNextReconKeyword(), nextDelay);
        } else {
            console.log(LOG_TAG, "Mission Halted. Recursion cancelled.");
        }
    }
}
