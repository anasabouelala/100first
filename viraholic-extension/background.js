/**
 * Viraholic Background Engine
 * Stealth profile monitoring for founders.
 * Polling Interval: Randomized (15-30m)
 */

importScripts('LeadIntelligenceEngine.js', 'discovery_engine.js');

const LOG_TAG = "[Answerly]";

// ── Web-app license link ── The extension only works while the Viraholic web
// app is open and the account is active (signed in + not trial-expired). The
// app broadcasts a short-TTL license (page bridge → SET_LICENSE) that we check
// before any agent work; if it goes stale, the agent is dormant.
let VIRAHOLIC_LICENSE = null;
try { chrome.storage.local.get('viraholic_license', (r) => { VIRAHOLIC_LICENSE = (r && r.viraholic_license) || null; }); } catch (e) {}
function isLicensed() {
  const L = VIRAHOLIC_LICENSE;
  return !!(L && L.active && typeof L.until === 'number' && Date.now() < L.until);
}

// Build marker — bump when shipping engine changes so a quick glance at the
// service-worker console confirms the latest code is actually loaded (i.e. the
// extension was reloaded after edits). If you don't see this line with the
// current value, Chrome is still running an old copy → reload the extension.
const ENGINE_BUILD = "2026-05-29.h — repost DOM capture + login-wall detection + platform-scoped channel KPIs";
console.log(LOG_TAG, `Engine build: ${ENGINE_BUILD}`);

// Global state for long-running processes
let currentReconTimeout = null;
let activeShadowWindowId = null;

// ─── Polling mutex ──────────────────────────────────────────────────
// Only ONE polling operation may run at a time — cycle, full sweep, and
// kick all share this lock. Without it the alarm tick can fire during a
// manual sweep, opening two shadow windows simultaneously. The mutex also
// protects the linear "one window after another" guarantee inside a sweep.
let pollingActive = false;
let pollingStartedAt = 0;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000; // 5 min — any poll longer than this is stuck

async function withPollingLock(label, fn) {
  // Auto-release if the lock has been held implausibly long. Without this,
  // a single crash or SW eviction mid-poll can pin pollingActive=true forever
  // and silently kill every subsequent chronic check.
  if (pollingActive && pollingStartedAt && (Date.now() - pollingStartedAt) > POLL_MAX_DURATION_MS) {
    console.warn(LOG_TAG, `[Tracking] Force-releasing stuck poll lock (was held by previous job for ${Math.round((Date.now() - pollingStartedAt) / 1000)}s)`);
    pollingActive = false;
    pollingStartedAt = 0;
    pollingLockLabel = null;
  }
  if (pollingActive) {
    console.log(LOG_TAG, `[Tracking] Skipping ${label} — ${pollingLockLabel || 'another poll'} is already running (started ${Math.round((Date.now() - pollingStartedAt)/1000)}s ago).`);
    return { skipped: 'busy', heldBy: pollingLockLabel };
  }
  pollingActive = true;
  pollingStartedAt = Date.now();
  pollingLockLabel = label;
  try {
    return await fn();
  } finally {
    pollingActive = false;
    pollingStartedAt = 0;
    pollingLockLabel = null;
  }
}
let pollingLockLabel = null;

// Cross-automation overlap guard used by the discovery mission entry. Returns
// true if either the tracker / feed-watcher polling lock is currently held,
// OR if a stale-but-not-yet-expired hold is present. Engine calls this before
// kicking off so we never have two stealth windows scraping at once (bot sign).
async function isAutomationBusy() {
  if (pollingActive && pollingStartedAt && (Date.now() - pollingStartedAt) < POLL_MAX_DURATION_MS) {
    return true;
  }
  return false;
}
self.withPollingLock = withPollingLock;
self.isAutomationBusy = isAutomationBusy;

// ─── Shadow-window registry ────────────────────────────────────────
// Every poller's popup ID is persisted to storage. Two reasons:
//   1. If the SW is evicted mid-poll, the popup stays alive but the
//      in-memory reference is lost. On next boot we read this registry
//      and close the orphans BEFORE opening anything new.
//   2. It also lets us defensively close any pre-existing shadow window
//      when opening a new one, so two never overlap even if the mutex
//      somehow misses a race.
const SHADOW_REGISTRY_KEY = 'answerly_active_shadow_windows';

async function registerShadowWindow(id) {
  try {
    const r = await chrome.storage.local.get([SHADOW_REGISTRY_KEY]);
    const set = new Set(r[SHADOW_REGISTRY_KEY] || []);
    set.add(id);
    await chrome.storage.local.set({ [SHADOW_REGISTRY_KEY]: Array.from(set) });
  } catch (e) { /* non-fatal */ }
}
async function deregisterShadowWindow(id) {
  try {
    const r = await chrome.storage.local.get([SHADOW_REGISTRY_KEY]);
    const next = (r[SHADOW_REGISTRY_KEY] || []).filter(x => x !== id);
    await chrome.storage.local.set({ [SHADOW_REGISTRY_KEY]: next });
  } catch (e) { /* non-fatal */ }
}
// Close any window IDs in the registry (called on SW boot to nuke orphans).
async function purgeOrphanShadowWindows() {
  try {
    const r = await chrome.storage.local.get([SHADOW_REGISTRY_KEY]);
    const ids = r[SHADOW_REGISTRY_KEY] || [];
    if (ids.length === 0) return;
    console.log(LOG_TAG, `[Tracking] Purging ${ids.length} orphan shadow window(s) from previous session`);
    for (const id of ids) {
      try { await chrome.windows.remove(id); } catch { /* already gone */ }
    }
    await chrome.storage.local.set({ [SHADOW_REGISTRY_KEY]: [] });
  } catch (e) {
    console.warn(LOG_TAG, '[Tracking] Orphan purge failed:', e);
  }
}

// Safely close a shadow window AND wait for the close to register. Without
// the await, `chrome.windows.create` for the next iteration can fire while
// the previous popup is still alive, producing a "flock of windows" effect.
async function closeShadowWindow(win) {
  if (!win) return;
  try {
    await chrome.windows.remove(win.id);
  } catch (e) {
    // Window may already be gone (user closed it, eviction race) — ignore.
  }
  await deregisterShadowWindow(win.id);
}

// Open a shadow window with explicit error surfacing. If Chrome refuses to
// open the popup (corp policies, missing permission, "no last focused window"
// quirks) we want the user to see WHY in the pulse, not have it fail silently.
async function openShadowWindow(opts, label) {
  // Defensive: nuke any registered shadow window before opening — covers the
  // case where a previous poll didn't reach its cleanup (crash, SW eviction).
  await purgeOrphanShadowWindows();
  try {
    const win = await chrome.windows.create(opts);
    if (!win) throw new Error('chrome.windows.create returned null');
    await registerShadowWindow(win.id);
    return win;
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(LOG_TAG, `[Tracking] Window open failed for ${label}:`, msg);
    await setPulse(`Couldn't open tracking window for ${label}: ${msg}`);
    throw e;
  }
}

// Dismiss in-page popups that block scraping (LinkedIn Premium upsell,
// LinkedIn auth-wall, X login bottom-sheet, Reddit "open in app" splash,
// cookie banners). Run inside the shadow tab via executeScript. Scoped to
// modal containers only so we never accidentally click something in the
// real content. Called BEFORE every scrape attempt and on a 2s timer
// during the scrape loop in case a popup re-appears.
async function dismissTrackingPopups(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        let dismissed = 0;
        try {
          // 1. Synthetic Escape — closes most well-behaved modals
          const esc = new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
            bubbles: true, cancelable: true
          });
          (document.activeElement || document.body || document).dispatchEvent(esc);
          document.dispatchEvent(esc);

          // 2. LinkedIn Premium upsell + auth-wall + any artdeco modal — the
          // close button is usually one of these. They're VERY common on
          // first-time profile visits in a stealth window where the user is
          // logged-in but LinkedIn hasn't shown the upsell yet for the session.
          const linkedinKillers = [
            '.artdeco-modal__dismiss',
            '.artdeco-modal button[aria-label="Dismiss" i]',
            '.artdeco-modal button[aria-label="Close" i]',
            'button[data-test-modal-close-btn]',
            '.contextual-sign-in-modal__modal-dismiss',
            '[data-tracking-control-name*="dismiss" i]',
            '[data-tracking-control-name*="close" i]',
            '[data-tracking-control-name*="upsell"] button[aria-label*="close" i]',
            '[data-test-id="modal-close"]',
            // Some Premium upsells use this generic icon-button pattern
            'div[role="dialog"] button.artdeco-button--circle',
            'div[role="dialog"] svg[data-test-icon="close-medium"]',
            // The exact upsell modal in the user's screenshot
            '.cuijbgrkkkfktsbktbtwt .artdeco-modal__dismiss', // hashed class
            '[aria-label*="Sales Navigator" i] button[aria-label="Dismiss" i]'
          ];
          // 3. X (Twitter) login wall + "Don't miss what's happening" sheet
          const xKillers = [
            '[data-testid="sheetDialog"] [aria-label*="Close" i]',
            '[data-testid="app-bar-close"]',
            '[data-testid="LoginForm_Footer_Container"] [aria-label*="Close" i]'
          ];
          // 4. Reddit "open in app" splash + signup drawer + cookie wall
          const redditKillers = [
            '.XPromoPopup__close',
            'button[aria-label*="Close the splash screen" i]',
            'button[aria-label*="Continue with the web app" i]',
            'shreddit-signup-drawer button[slot="close"]',
            'shreddit-signup-drawer button[aria-label*="Close" i]',
            'faceplate-dialog button[aria-label*="Close" i]'
          ];
          // 5. Generic — any close button inside any role=dialog / aria-modal
          const genericKillers = [
            '[role="dialog"] button[aria-label*="Close" i]',
            '[role="dialog"] button[aria-label*="Dismiss" i]',
            '[role="alertdialog"] button[aria-label*="Close" i]',
            '[aria-modal="true"] button[aria-label*="Close" i]',
            '[aria-modal="true"] button[aria-label*="Dismiss" i]'
          ];
          // 6. Cookie banners — accept is the path of least friction;
          // we're not consenting to anything we wouldn't have anyway.
          const cookieKillers = [
            '#onetrust-accept-btn-handler',
            'button[action-type="ACCEPT"]',
            'button[data-tracking-control-name*="cookie" i]',
            'button[aria-label*="Accept cookies" i]',
            '.cookie-prompt__btn'
          ];

          const allKillers = [...linkedinKillers, ...xKillers, ...redditKillers, ...genericKillers, ...cookieKillers];
          for (const sel of allKillers) {
            try {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                // Skip invisible/zero-sized elements
                const rect = el.getBoundingClientRect?.();
                if (rect && (rect.width === 0 || rect.height === 0)) continue;
                // Click the closest button if we hit an SVG/icon
                const target = (el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button')
                  ? el
                  : (el.closest?.('button, [role="button"]') || el);
                try { target.click(); dismissed++; } catch {}
              }
            } catch {}
          }

          // 7. Restore body scroll if a modal locked it (common LinkedIn pattern)
          if (document.body?.style.overflow === 'hidden') document.body.style.overflow = '';
          if (document.documentElement?.style.overflow === 'hidden') document.documentElement.style.overflow = '';

          return { dismissed };
        } catch (e) {
          return { dismissed, error: String(e) };
        }
      }
    });
  } catch (e) {
    // Tab might have navigated away, executeScript can fail; ignore.
  }
}

// Navigate an existing tab to a new URL and wait for it to finish loading.
// Used by the full-sweep path so we can scrape multiple accounts in a single
// reused window instead of opening N popups in sequence. The scraping code
// already has its own "wait for content" retry loop, so a soft 8-second
// load timeout is enough — beyond that we just hand off to the scraper.
async function navigateTabAndWait(tabId, url, timeoutMs = 8000) {
  await chrome.tabs.update(tabId, { url });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      // Tab may have been closed mid-navigation; let caller deal with it
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

// ═══════════════════════════════════════════════════════════
// TRACKING SETTINGS — user-configurable polling cadence
// ═══════════════════════════════════════════════════════════
const TRACKING_SETTINGS_KEY = 'tracking_settings';
// Defaults tuned for "I just installed and want to see it work" — short
// interval so the first sweep lands well inside the user's attention span.
// Every `intervalMinutes`, ALL tracked accounts are swept sequentially —
// there is no per-account cooldown. The interval IS the cadence per account.
const DEFAULT_TRACKING_SETTINGS = {
  intervalMinutes: 5,       // sweep ALL tracked accounts every N minutes (default low so users see activity fast)
  respectOffHours: true,    // skip polling between 23h and 8h local time
  jitterPercent: 0.25       // ±25% random jitter (unused with heartbeat; kept for backwards compat)
};

async function getTrackingSettings() {
  const r = await chrome.storage.local.get([TRACKING_SETTINGS_KEY]);
  const merged = { ...DEFAULT_TRACKING_SETTINGS, ...(r[TRACKING_SETTINGS_KEY] || {}) };
  // Strip legacy field that older builds persisted
  delete merged.cooldownMinutes;
  return merged;
}

// ─── HEARTBEAT-DRIVEN CHRONIC CHECK ────────────────────────────────
// Why this is a heartbeat instead of a variable-period alarm:
//
// MV3 service workers evict after ~30 s of inactivity. Every event that
// wakes the SW re-runs this entire module. The previous design used
// `chrome.alarms.create("stealthCheck", { periodInMinutes: N })` where N
// matched the user's interval setting. The problem: any call to
// `chrome.alarms.create` with the same name RESETS the timer. With SWs
// evicting and rebooting constantly, the alarm timer kept getting reset
// before it could expire, so the chronic check never actually fired —
// it only ran when the user manually reloaded the extension.
//
// The fix: a fixed 1-minute alarm ("trackingTick"). The alarm itself
// always fires (1-minute periods are rock-solid in MV3). Inside the
// handler, JS does the maths: "is it time for a chronic check based on
// the user's interval setting?". If yes, run executeCycle. If not, exit.
// The chronic-check cadence lives in JS storage, not in alarm scheduling.
const TICK_ALARM_NAME = 'trackingTick';
const TICK_PERIOD_MINUTES = 1; // Chrome's minimum reliable period in MV3.
const LAST_TICK_KEY = 'answerly_last_tick_at';

async function ensureTrackingAlarm() {
  // One-time cleanup: remove the legacy stealthCheck alarm that was
  // perpetually resetting and never firing. Once it's gone the SW relies
  // only on trackingTick.
  await chrome.alarms.clear('stealthCheck').catch(() => {});

  // Primary heartbeat
  const existing = await chrome.alarms.get(TICK_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(TICK_ALARM_NAME, { periodInMinutes: TICK_PERIOD_MINUTES });
    console.log(LOG_TAG, `[Tracking] Heartbeat created — ticks every ${TICK_PERIOD_MINUTES}min.`);
  }
  // Redundant watchdog alarm — also drives the heartbeat. Was previously
  // only created in onInstalled which doesn't fire on update or eviction.
  // If the user installs once, then later Chrome drops the alarm somehow,
  // the watchdog stays as a backup.
  const watch = await chrome.alarms.get('watchdog');
  if (!watch) {
    chrome.alarms.create('watchdog', { periodInMinutes: 1 });
    console.log(LOG_TAG, '[Tracking] Watchdog alarm (re)created.');
  }
}

// Called every 1 minute by the heartbeat alarm. Decides whether it's
// time for a chronic check based on the user's interval setting.
async function tickTracking() {
  if (!isLicensed()) return;  // dormant unless the web app says the account is active
  try {
    const { [LAST_TICK_KEY]: lastTickAt = 0, answerly_last_cycle_at = 0, answerly_creator_configs = [] } =
      await chrome.storage.local.get([LAST_TICK_KEY, 'answerly_last_cycle_at', 'answerly_creator_configs']);
    await chrome.storage.local.set({ [LAST_TICK_KEY]: Date.now() });

    if (answerly_creator_configs.length === 0) {
      // Nothing to track yet — surface that so the user knows the engine
      // is alive but waiting on them.
      const r = await chrome.storage.local.get(['answerly_engine_pulse']);
      const cur = r.answerly_engine_pulse?.msg || '';
      if (!cur || /^(idle|no accounts|tracking armed)/i.test(cur)) {
        await setPulse('Tracking armed — no accounts yet. Add some in Account Finder.');
      }
      return;
    }

    const settings = await getTrackingSettings();
    const intervalMs = Math.max(1, settings.intervalMinutes) * 60 * 1000;
    const sinceLastCycle = Date.now() - (answerly_last_cycle_at || 0);

    if (sinceLastCycle < intervalMs) {
      // Not time for a chronic check yet — surface countdown so the
      // dashboard shows the engine is alive.
      const minsLeft = Math.max(1, Math.ceil((intervalMs - sinceLastCycle) / 60000));
      const r = await chrome.storage.local.get(['answerly_engine_pulse']);
      const cur = r.answerly_engine_pulse?.msg || '';
      if (!cur || /^(idle|tracking armed|sweep completed|off-hours|no accounts)/i.test(cur)) {
        await setPulse(`Tracking armed — next sweep in ~${minsLeft} min.`);
      }
      return;
    }

    // It's time. Fire the cycle.
    console.log(LOG_TAG, `[Tracking] Heartbeat: chronic check due (${Math.round(sinceLastCycle/60000)}min since last cycle).`);
    await executeCycle();
  } catch (e) {
    console.error(LOG_TAG, '[Tracking] Tick failed:', e);
  }
}

// 1. Initialize Alarms
chrome.runtime.onInstalled.addListener(() => {
  console.log(LOG_TAG, "Engine Initialized.");
  ensureTrackingAlarm();
  chrome.alarms.create("queueProcessor", { periodInMinutes: 5 });
  chrome.alarms.create("resetEngagementCounter", { periodInMinutes: 60 });
  chrome.alarms.create("watchdog", { periodInMinutes: 1 });

  // Register content scripts programmatically (more reliable than manifest for localhost)
  chrome.scripting.registerContentScripts([{
    id: 'answerly-bridge',
    matches: ['https://viraholic.com/*', 'https://*.viraholic.com/*', 'http://localhost:*/*', 'http://127.0.0.1:*/*'],
    js: ['content_bridge.js'],
    runAt: 'document_start',
    persistAcrossSessions: true
  }]).catch(err => {
    if (!err.message?.includes('already registered')) {
      console.error(LOG_TAG, "Failed to register bridge script:", err);
    }
  });

  // Auto-reload tabs running the web app so the bridge reconnects
  chrome.tabs.query({ url: ["https://viraholic.com/*", "https://*.viraholic.com/*", "http://localhost:*/*", "http://127.0.0.1:*/*"] }, (tabs) => {
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
  if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://localhost') || tab.url.startsWith('http://127.0.0.1') || tab.url.startsWith('https://viraholic.com') || tab.url.includes('.viraholic.com'))) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_bridge.js']
    }).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    console.log(LOG_TAG, `[Alarm] fired: ${alarm.name} at ${new Date().toLocaleTimeString()}`);
    // Web-app license gate: do no agent work unless the account is active.
    // Allow only harmless housekeeping alarms through.
    if (!isLicensed() && alarm.name !== 'stealthCheck' && alarm.name !== 'resetEngagementCounter') return;
    // Legacy alarm name — drop. Heartbeat replaces it. Cleanup runs in ensureTrackingAlarm.
    if (alarm.name === 'stealthCheck') { chrome.alarms.clear('stealthCheck').catch(() => {}); }
    // Primary heartbeat
    if (alarm.name === TICK_ALARM_NAME) tickTracking();
    // Redundant heartbeat: watchdog ALSO fires tickTracking. If the primary
    // alarm fails for any reason (Chrome throttling, alarm registration bug,
    // power saver), the watchdog still drives the chronic check. Bulletproof.
    if (alarm.name === 'watchdog') {
        checkWatchdog();
        tickTracking();
    }
    if (alarm.name === 'queueProcessor') processNextReconKeyword();
  if (alarm.name === "resetEngagementCounter") {
    console.log(LOG_TAG, "Resetting hourly engagement counter.");
    chrome.storage.local.set({ answerly_engagements: 0 });
  }
  // Discovery campaign ticks
  if (alarm.name.startsWith('campaign_tick_') && self.handleCampaignAlarm) {
    self.handleCampaignAlarm(alarm.name).catch(e => console.error(LOG_TAG, 'Campaign alarm failed:', e));
  }
  // Discovery batch-cooldown auto-resume (anti-bot batching)
  if (alarm.name === 'discovery_batch_resume' && self.resumeFromBatchCooldown) {
    console.log(LOG_TAG, '[Discovery] Batch cooldown elapsed — auto-resuming mission');
    self.resumeFromBatchCooldown().catch(e => console.error(LOG_TAG, 'Batch resume failed:', e));
  }
  // Feed Watcher periodic sweep (Account Finder → Feed Watcher block)
  if (alarm.name === 'feed_watch_tick' && self.handleFeedWatchAlarm) {
    self.handleFeedWatchAlarm(alarm.name).catch(e => console.error(LOG_TAG, 'Feed watch alarm failed:', e));
  }
});

// React to user changing tracking settings. The heartbeat doesn't need
// rescheduling (it's always 1 min); the new interval is picked up by
// tickTracking() on the next heartbeat fire. Reset the last-cycle marker
// so the user immediately sees an "Tracking armed — next check in N min"
// pulse reflecting the new interval.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[TRACKING_SETTINGS_KEY]) {
    console.log(LOG_TAG, "[Tracking] Settings changed — heartbeat will adapt on next tick.");
    chrome.storage.local.set({ answerly_last_cycle_at: Date.now() });
  }
});

// On Chrome startup, alarms persist — only create one if it's missing.
chrome.runtime.onStartup?.addListener(() => {
  ensureTrackingAlarm();
  purgeOrphanShadowWindows();
});
// On every SW module load (including post-eviction reboots), make sure the
// 1-min heartbeat alarm exists. Idempotent — won't reset an existing alarm.
ensureTrackingAlarm().catch(() => {});
// Critical: nuke any shadow windows left over from a previous SW lifetime.
// Without this, reloading the extension during a poll spawns a new window
// alongside the old one and the user sees "two windows opening at once".
purgeOrphanShadowWindows().catch(() => {});

// On SW boot, run a tick immediately so the user doesn't wait up to a full
// minute for the first heartbeat. Idempotent — if it's not yet time for a
// chronic check, the tick just refreshes the pulse and returns. (No
// setTimeout: that's unreliable in MV3 because the SW may evict before the
// timeout fires.)
tickTracking().catch(e => console.warn(LOG_TAG, '[Tracking] Boot tick failed:', e));

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

// 1.7 Discovery-active mutex helper.
// Any code path that opens a stealth `chrome.windows.create` should call this
// FIRST and bail if true — otherwise we end up with 2 windows side by side,
// which is the exact symptom the user reported.
async function isDiscoveryActive() {
  try {
    const r = await chrome.storage.local.get(['discovery_mission_state']);
    const m = r.discovery_mission_state;
    if (!m) return false;
    // Only block tracking when discovery is actively in flight. Paused/cooldown
    // are either user-controlled (indefinite) or finite — they shouldn't shut
    // down tracking for the duration. Terminal states (completed/failed/aborted)
    // obviously don't block.
    if (!['scanning', 'preparing'].includes(m.status)) return false;
    // Stale-mission guard: if a mission has been "running" for more than 2h
    // it's almost certainly a dead state left over from a crash. Don't let it
    // block tracking forever.
    const startedAt = m.startedAt ? new Date(m.startedAt).getTime() : 0;
    if (startedAt && Date.now() - startedAt > 2 * 60 * 60 * 1000) {
      console.warn(LOG_TAG, '[Tracking] Discovery mission stale (>2h) — ignoring for tracking purposes');
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-COMMENT — generate + post comments automatically when a new
// tracked post arrives. Safety-first design:
//   • OFF by default. User must enable globally AND per-account.
//   • Hard rate limits (default 3/hour, 15/day) — well below platform
//     spam thresholds. User can dial up at their own risk.
//   • Match-score filter — only posts above the threshold qualify.
//   • Comment GENERATION happens in the web app (Gemini key lives
//     there) so the SW never needs the user's API key. Posting
//     happens via the existing engagement queue (same path as the
//     manual "Comment now" button — proven anti-detection).
//   • Full audit log — every queued/generated/posted/failed item is
//     written to auto_comment_history so the user can see exactly
//     what the bot did on their behalf.
// ═══════════════════════════════════════════════════════════════════
const AUTO_COMMENT_CONFIG_KEY = 'auto_comment_config';
// NOTE: there is NO global on/off switch any more. Auto-reply is controlled
// per-account (the `autoComment` flag on each tracked config). This config
// only holds the PARAMETERS used to generate the draft reply.
const DEFAULT_AUTO_COMMENT_CONFIG = {
  tone: 'casual',                 // casual | formal | funny
  goal: 'build_relationship',     // intent passed to the generator
  customInstruction: '',          // freeform extra guidance for the AI
  includeReposts: false,          // also draft replies for reposts (default: original posts only)
  minMatchScore: 0                // 0 = draft for every new post from opted-in accounts
  // NOTE: reply length is NOT configurable — it's adapted to the platform
  // automatically (short for X, longer for LinkedIn, medium for Reddit).
};
async function getAutoCommentConfig() {
  const r = await chrome.storage.local.get([AUTO_COMMENT_CONFIG_KEY]);
  return { ...DEFAULT_AUTO_COMMENT_CONFIG, ...(r[AUTO_COMMENT_CONFIG_KEY] || {}) };
}

// Human-in-the-loop: when a NEW post arrives for an account the user opted into
// auto-reply, we queue a generation job. The web app generates the draft and
// saves it (AUTO_COMMENT_SAVE_DRAFT) — it is NOT posted automatically. The user
// reviews the draft under the post and confirms (AUTO_COMMENT_CONFIRM) before it
// is published.
async function maybeQueueAutoComment(post) {
  try {
    // Per-account opt-in is the ONLY on/off.
    const { answerly_creator_configs = [] } = await chrome.storage.local.get(['answerly_creator_configs']);
    const target = answerly_creator_configs.find(c => c.url === post.url);
    if (!target?.autoComment) {
      console.log(LOG_TAG, `[AutoReply] skip ${post.creator}: account auto-reply is OFF (toggle it in the tracked-accounts list)`);
      return;
    }

    const cfg = await getAutoCommentConfig();

    // Reposts: only draft for them if the user opted in.
    if (post.isRepost && !cfg.includeReposts) {
      console.log(LOG_TAG, `[AutoReply] skip ${post.creator}: it's a repost (turn on "Include reposts" to draft these)`);
      return;
    }

    // Reply-restricted posts (e.g. X "who can reply" limits): can't reply.
    if (post.replyRestricted) {
      console.log(LOG_TAG, `[AutoReply] skip ${post.creator}: replies are restricted on this post`);
      await logAutoComment({ status: 'skipped', reason: 'replies restricted on this post', post });
      return;
    }

    // Optional match-score filter (default 0 = everything).
    const score = typeof post.relevance === 'number' ? post.relevance : 100;
    if (cfg.minMatchScore && score < cfg.minMatchScore) {
      return logAutoComment({ status: 'skipped', reason: `match ${score} < ${cfg.minMatchScore}`, post });
    }

    // Dedup: don't draft the same post twice (pending, existing draft, or posted).
    const { auto_comment_pending = [], auto_comment_drafts = [], comment_log = [] } =
      await chrome.storage.local.get(['auto_comment_pending', 'auto_comment_drafts', 'comment_log']);
    if (auto_comment_pending.some(j => j.postUrl === post.postUrl)) return;
    if (auto_comment_drafts.some(d => d.postUrl === post.postUrl)) return;
    if (comment_log.some(c => (c.postUrl || c.url) === post.postUrl)) return;

    const job = {
      id: 'ac_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      url: post.url,
      postUrl: post.postUrl,
      platform: post.platform,
      creator: post.creator,
      postText: (() => {
        const main = (post.text || '') + (post.body ? '\n\n' + post.body : '');
        // For reposts, append the ORIGINAL post so the AI replies relevantly to
        // what was actually being shared, not just the repost wrapper.
        if (post.isRepost && post.originalPost?.text) {
          const author = post.originalPost.author ? `@${post.originalPost.author}` : 'the original author';
          return (main + `\n\n[Reposted from ${author}]\n${post.originalPost.text}`).slice(0, 2400);
        }
        return main.slice(0, 1200);
      })(),
      tone: cfg.tone,
      goal: cfg.goal,
      customInstruction: cfg.customInstruction,
      queuedAt: Date.now()
    };
    auto_comment_pending.push(job);
    await chrome.storage.local.set({ auto_comment_pending });
    await logAutoComment({ status: 'queued', reason: 'drafting reply for review', post, jobId: job.id });
    console.log(LOG_TAG, `[AutoReply] Queued draft generation for ${post.creator} (${job.id})`);
  } catch (e) {
    console.error(LOG_TAG, '[AutoReply] maybeQueue failed:', e);
  }
}

// Append a row to the audit history. Capped at 100 rows so storage stays small.
async function logAutoComment(entry) {
  try {
    const { auto_comment_history = [] } = await chrome.storage.local.get(['auto_comment_history']);
    const row = {
      at: Date.now(),
      status: entry.status,
      reason: entry.reason || '',
      jobId: entry.jobId || null,
      platform: entry.post?.platform,
      creator: entry.post?.creator,
      postUrl: entry.post?.postUrl,
      preview: (entry.post?.text || '').slice(0, 80),
      commentPreview: (entry.comment || '').slice(0, 120)
    };
    const next = [row, ...auto_comment_history].slice(0, 100);
    await chrome.storage.local.set({ auto_comment_history: next });
  } catch {}
}

// ─── Chrome DevTools Protocol (trusted input) ───────────────────────────────
// Draft.js (X/Twitter) only updates its internal editorState — the thing that
// enables the reply/tweet button — from a *trusted* input event. The legacy
// document.execCommand('insertText') path is trusted but no-ops without real OS
// window focus, which the OS routinely withholds from our background popup. CDP
// Input.insertText injects a genuinely-trusted insert at the renderer level with
// NO OS-focus dependency (this is exactly how Puppeteer/Playwright type into
// Draft.js). We attach only for the duration of a comment/quote and detach right
// after, to keep the "extension is debugging" banner as brief as possible.
const CDP_PROTOCOL_VERSION = '1.3';
const cdpAttachedTabs = new Set();

function cdpSend(tabId, method, params) {
    return new Promise((resolve, reject) => {
        try {
            chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message)); else resolve(result);
            });
        } catch (e) { reject(e); }
    });
}

// Last attach diagnosis so the caller can surface an actionable status to the
// user (e.g. "re-accept the debugger permission"). One of:
// 'ok' | 'no-permission' | 'busy' | 'error'.
let lastCdpAttachReason = 'ok';

async function cdpAttach(tabId, retries = 2) {
    if (cdpAttachedTabs.has(tabId)) { lastCdpAttachReason = 'ok'; return true; }

    // HARD GUARD: if the debugger API itself is missing, the "debugger" manifest
    // permission was NOT granted. Adding it to manifest.json is not enough —
    // Chrome disables the extension pending a manual re-accept (toggle off/on or
    // remove + re-load unpacked). Until then chrome.debugger is undefined and
    // CDP can never attach, so every comment silently uses the old broken path.
    if (!chrome.debugger || typeof chrome.debugger.attach !== 'function') {
        lastCdpAttachReason = 'no-permission';
        console.error(LOG_TAG, '[CDP] chrome.debugger UNAVAILABLE — the "debugger" permission is not granted. ' +
            'Open chrome://extensions, toggle this extension OFF then ON (or Remove + Load unpacked) so Chrome ' +
            'shows the permission prompt. A plain reload does NOT grant a newly-added permission.');
        return false;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await new Promise((resolve, reject) => {
                chrome.debugger.attach({ tabId }, CDP_PROTOCOL_VERSION, () => {
                    const err = chrome.runtime.lastError;
                    if (err) reject(new Error(err.message)); else resolve();
                });
            });
            cdpAttachedTabs.add(tabId);
            lastCdpAttachReason = 'ok';
            console.log(LOG_TAG, '[CDP] attached to tab', tabId, attempt ? `(attempt ${attempt + 1})` : '');
            return true;
        } catch (e) {
            const msg = e?.message || String(e);
            // "Another debugger is already attached" → DevTools is open on the tab.
            lastCdpAttachReason = /already attached|devtools/i.test(msg) ? 'busy' : 'error';
            console.warn(LOG_TAG, `[CDP] attach failed (attempt ${attempt + 1}/${retries + 1}):`, msg);
            if (attempt < retries) await new Promise(r => setTimeout(r, 700));
        }
    }
    return false;
}

async function cdpDetach(tabId) {
    if (!cdpAttachedTabs.has(tabId)) return;
    try {
        await new Promise((resolve) => {
            chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; resolve(); });
        });
    } catch {}
    cdpAttachedTabs.delete(tabId);
}

// Insert text as a trusted IME-style insert into the renderer's focused element.
// The content agent must focus the editor + place a caret first.
async function cdpInsertText(tabId, text) {
    if (!cdpAttachedTabs.has(tabId)) throw new Error('CDP not attached');
    await cdpSend(tabId, 'Input.insertText', { text });
    return true;
}

// Trusted mouse click at viewport CSS coords (x,y). Unlike a synthetic
// dispatchEvent, this moves the renderer's REAL input focus + caret — so a
// subsequent Input.insertText lands in the element we actually clicked (fixes
// "text pasted in the wrong section"). Coords match getBoundingClientRect.
async function cdpClick(tabId, x, y) {
    if (!cdpAttachedTabs.has(tabId)) throw new Error('CDP not attached');
    const px = Math.round(x), py = Math.round(y);
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', buttons: 0 });
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', buttons: 1, clickCount: 1 });
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', buttons: 0, clickCount: 1 });
    return true;
}

// Trusted Enter with a modifier (Ctrl or Cmd) — the reliable "submit reply/tweet"
// shortcut on X. CDP modifiers bitfield: Alt=1, Ctrl=2, Meta=4, Shift=8.
async function cdpKeyEnter(tabId, useMeta) {
    if (!cdpAttachedTabs.has(tabId)) throw new Error('CDP not attached');
    const modifiers = useMeta ? 4 : 2;
    const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers };
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    return true;
}

// If a tab is dragged out from under us, drop it from the attached set.
try {
    chrome.debugger.onDetach.addListener((source) => {
        if (source && typeof source.tabId === 'number') cdpAttachedTabs.delete(source.tabId);
    });
} catch {}

// ─── Engagement Queue ────────────────────────────────────────────────────────
const engagementQueue = [];
let isEngaging = false;

// Which platform a post URL belongs to — drives the per-platform ban-safe caps
// and cooldowns below (LinkedIn is treated as the strictest).
function platformOfUrl(u) {
    u = u || '';
    if (/linkedin\.com/i.test(u)) return 'LinkedIn';
    if (/(?:^|\/\/)(?:[^/]*\.)?(?:x|twitter)\.com/i.test(u)) return 'X';
    if (/reddit\.com/i.test(u)) return 'Reddit';
    return 'other';
}

async function processEngagementQueue() {
    if (isEngaging) return;

    // Defer engagement work while a discovery mission is in flight — both open
    // shadow windows on the same domains and would race each other.
    if (await isDiscoveryActive()) {
        console.log(LOG_TAG, '[ENGAGE] Deferred — discovery mission active');
        setTimeout(() => processEngagementQueue(), 60000);
        return;
    }

    // Load queue and stats
    const result = await chrome.storage.local.get(['answerly_engagement_queue', 'answerly_engagements', 'answerly_engagements_daily']);
    const queue = result.answerly_engagement_queue || [];
    const engagementsThisHour = result.answerly_engagements || 0;

    // ── Ban-safe rate limits ──
    // Hourly is a global burst guard. DAILY is the real anti-ban ceiling, because
    // platforms — LinkedIn especially — flag accounts on daily automation VOLUME.
    // We enforce a global daily cap AND a per-platform daily cap with LinkedIn set
    // deliberately low, so commenting across "many posts" in one session can never
    // cross LinkedIn's threshold. Counters reset at local midnight. Dial these up
    // at your own risk.
    const MAX_PER_HOUR = 12;
    const MAX_PER_DAY = 20;
    const PLATFORM_DAILY = { LinkedIn: 10, X: 18, Reddit: 14, other: 12 };

    if (queue.length === 0) return;

    if (engagementsThisHour >= MAX_PER_HOUR) {
        console.warn(LOG_TAG, "[ENGAGE] Hourly limit reached. Waiting for reset.");
        await setPulse("Engagement Cap Reached (12/hr)");
        return;
    }

    // Roll the daily counter over at local midnight.
    const today = new Date().toISOString().slice(0, 10);
    let daily = result.answerly_engagements_daily || { date: today, total: 0, byPlatform: {} };
    if (daily.date !== today) daily = { date: today, total: 0, byPlatform: {} };

    if ((daily.total || 0) >= MAX_PER_DAY) {
        console.warn(LOG_TAG, `[ENGAGE] Daily limit reached (${MAX_PER_DAY}). Pausing to stay ban-safe.`);
        await setPulse(`Daily engagement cap reached (${MAX_PER_DAY}/day)`);
        return;
    }

    // Pick the FIRST queued action whose platform still has daily headroom — so a
    // LinkedIn-capped queue doesn't block an X action queued behind it (and vice
    // versa). If every queued item's platform is capped today, wait for reset.
    let leadIndex = -1;
    for (let i = 0; i < queue.length; i++) {
        const plat = platformOfUrl(queue[i].postUrl || queue[i].url);
        const used = daily.byPlatform[plat] || 0;
        const cap = PLATFORM_DAILY[plat] ?? MAX_PER_DAY;
        if (used < cap) { leadIndex = i; break; }
    }
    if (leadIndex === -1) {
        const caps = Object.keys(PLATFORM_DAILY).map(k => `${k} ${daily.byPlatform[k] || 0}/${PLATFORM_DAILY[k]}`).join(', ');
        console.warn(LOG_TAG, `[ENGAGE] All queued platforms at their daily cap (${caps}). Pausing to stay ban-safe.`);
        await setPulse('Per-platform daily cap reached — pausing to stay ban-safe');
        return;
    }

    isEngaging = true;
    await chrome.storage.local.set({ last_engagement_start: Date.now() });
    const lead = queue.splice(leadIndex, 1)[0];
    // Save updated queue immediately
    await chrome.storage.local.set({ answerly_engagement_queue: queue });

    let shadowWindowId = null;
    let foregroundTabId = null;
    let targetTabId = null;
    // Comments/quotes need TEXT inserted into a rich editor (Draft.js on X, Quill
    // on LinkedIn, Lexical on Reddit). Those editors only update their internal
    // editorState — which is what enables the submit button — from a *trusted*
    // input event, and document.execCommand('insertText') is only trusted when
    // document.hasFocus()===true. A background popup never reliably gets OS focus,
    // which is why the old code needed the Chrome DevTools Protocol (the yellow
    // "debugging" banner). The store-legal fix: do text actions in a REAL,
    // foreground, focused tab so execCommand is trusted — no debugger permission,
    // no banner. Likes/reposts insert no text, so they keep the silent popup.
    const isTextAction = (lead.actionType === 'comment' || lead.actionType === 'quote');

    // ── X/Twitter replies: INLINE, like a real user ──
    // We open the post itself in a focused tab and let the agent type into the
    // reply box that's already on the page, then click Reply — no intent URL, no
    // navigation away from the post, no URL change, no pre-scroll. The tab is
    // focused, so execCommand('insertText') is trusted and X's editorState
    // updates (the Reply button enables) exactly as when a human types. (The old
    // Web Intent detour was removed: jumping to /intent/* changed the URL and
    // looked suspicious to X.)

    // Reusable: wait for a tab to finish loading, then a platform-aware SPA
    // hydration pause. Used once per navigation (the human-nav intent flow
    // navigates twice: real tweet → intent composer).
    const waitForComplete = (tabId, ms = 12000) => new Promise((resolve) => {
        // THE "opens, scrolls, does nothing" BUG — ROOT CAUSE. A LinkedIn post
        // permalink keeps long-poll / streaming connections open, so the tab's
        // chrome.tabs status can stay 'loading' essentially forever and NEVER
        // report 'complete'. Both the onUpdated 'complete' event AND a status poll
        // therefore wait for a signal that never arrives; the old code then threw
        // "Page load timeout (45s)" and aborted the engagement BEFORE the agent
        // was ever sent the comment message — agent.ready fired (~3s) but
        // doComment never ran, the tab closed, cooldown started at 45.1s.
        //
        // FIX: never depend on (or reject on) 'complete'. The content script
        // injects at document_idle (~3s), so the DOM is interactive long before
        // any "complete" that may or may not come. Resolve on the FIRST of:
        //   (a) a real 'complete' (fast/cached loads), or
        //   (b) a bounded fallback timeout — then proceed to hydrationWait + send.
        // We NEVER reject, so a perpetually-'loading' SPA can't strand the run.
        // The resolve path is recorded for diagnostics (answerly_waitcomplete_how).
        let settled = false;
        const finish = (how) => {
            if (settled) return;
            settled = true;
            clearTimeout(loadTimeout);
            try { chrome.tabs.onUpdated.removeListener(loadFn); } catch (_) {}
            try { chrome.storage.local.set({ answerly_waitcomplete_how: how + '@' + Date.now() }, () => { void chrome.runtime.lastError; }); } catch (_) {}
            resolve();
        };
        const loadTimeout = setTimeout(() => finish('fallback-timeout'), ms);
        const loadFn = (id, info) => {
            if (id === tabId && info.status === 'complete') finish('event-complete');
        };
        chrome.tabs.onUpdated.addListener(loadFn);
        // Poll the live status too (closes the create→complete race for fast loads).
        const poll = () => {
            if (settled) return;
            try {
                chrome.tabs.get(tabId, (t) => {
                    // lastError = tab not ready yet; KEEP polling (the old code
                    // returned here and silently killed the poll loop).
                    if (chrome.runtime.lastError) { if (!settled) setTimeout(poll, 300); return; }
                    if (t && t.status === 'complete') finish('poll-complete');
                    else if (!settled) setTimeout(poll, 300);
                });
            } catch (_) { if (!settled) setTimeout(poll, 300); }
        };
        poll();
    });
    const hydrationWait = async (u) => {
        let extra = 4000;
        if ((u || '').includes('linkedin.com')) { extra = 7000; await setPulse("Hydrating LinkedIn SPA..."); }
        else if ((u || '').includes('x.com') || (u || '').includes('twitter.com')) { extra = 6000; await setPulse("Hydrating X.com SPA..."); }
        else if ((u || '').includes('reddit.com')) { extra = 5000; await setPulse("Hydrating Reddit SPA..."); }
        await new Promise(r => setTimeout(r, extra));
    };

    try {
        // Open the real post itself — the reply box lives right on the page.
        const targetUrl = lead.postUrl || lead.url;

        // GUARD — a comment/quote MUST target the post itself. The new LinkedIn
        // feed hides permalinks, so an unresolved card carries a profile /
        // recent-activity / search URL. Navigating there and "commenting" would
        // post under whatever happens to be on top of that list — the wrong
        // post. Refuse rather than comment in the wrong place. (Likes/reposts
        // performed on a profile are harmless, so they're exempt.)
        if (isTextAction) {
            const isDirectPostUrl =
                /(?:x|twitter)\.com\/[^/]+\/status\/\d+/.test(targetUrl || '') ||
                /\/feed\/update\/urn:li:activity:\d+/.test(targetUrl || '') ||
                /linkedin\.com\/posts\//.test(targetUrl || '') ||
                /reddit\.com\/r\/[^/]+\/comments\//.test(targetUrl || '');
            if (!isDirectPostUrl) {
                throw new Error('No direct post URL to comment on — the link points at a profile/activity list, not the post. Skipped to avoid commenting on the wrong post.');
            }
        }

        console.log(LOG_TAG, "[ENGAGE] Launching", isTextAction ? "foreground tab" : "stealth window", "for:", targetUrl);
        await setPulse(`Engaging: ${lead.actionType} on ${targetUrl.substring(0, 20)}...`);

        // Notifications removed per user request

        if (isTextAction) {
            // FOREGROUND ASSISTED INSERT — a focused tab guarantees
            // document.hasFocus()===true so the agent's trusted execCommand path
            // works on every platform. The user sees the post happen (consistent
            // with the queue-only, human-approves model) and the tab auto-closes
            // after the dwell below.
            const tab = await chrome.tabs.create({ url: targetUrl, active: true });
            foregroundTabId = tab.id;
            targetTabId = tab.id;
            try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
            if (!targetTabId) throw new Error("Could not create foreground comment tab.");
        } else {
            // Open unfocused so we don't steal the user's focus — no text to type.
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
        }

        await setPulse("Waiting for page load...");
        await waitForComplete(targetTabId);
        await hydrationWait(targetUrl);

        await setPulse(`Executing ${lead.actionType} via Biometric Agent...`);

        // Re-assert foreground focus right before we ask the agent to type. The
        // tab was created active, but the page load / SPA hydration above can take
        // seconds during which the user may have clicked elsewhere. Activating the
        // tab + focusing its window guarantees document.hasFocus()===true so the
        // agent's trusted execCommand('insertText') updates the editor's state and
        // enables the submit button — the whole point of the foreground approach.
        if (isTextAction && foregroundTabId) {
            try {
                await chrome.tabs.update(foregroundTabId, { active: true });
                const t = await chrome.tabs.get(foregroundTabId);
                await chrome.windows.update(t.windowId, { focused: true });
                await new Promise(r => setTimeout(r, 600));
                await setPulse('Inserting comment in focused tab…');
            } catch (e) {
                console.warn(LOG_TAG, 'Could not focus comment tab:', e?.message || e);
            }
        }

        // DIAGNOSTIC no-post mode. When answerly_force_dryrun is set, the agent
        // runs the ENTIRE real pipeline (resolve post → find composer → focus →
        // type → locate submit) but STOPS before clicking submit, so the real
        // app→bridge→background→tab→agent path can be traced without publishing a
        // comment. The app's normal comment button leaves this unset → real post.
        let forceDryRun = false;
        try { const f = await chrome.storage.local.get(['answerly_force_dryrun']); forceDryRun = !!f.answerly_force_dryrun; } catch (_) {}
        if (forceDryRun && lead.actionType === 'comment') {
            await setPulse('DRY-RUN mode: will type but NOT submit…');
        }

        // Robust Message Delivery (Retry up to 3 times)
        let response = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                response = await chrome.tabs.sendMessage(targetTabId, {
                    type: 'PERFORM_STEALTH_INTERACTION',
                    actionType: lead.actionType || 'like',
                    payload: { text: lead.commentText || '', postUrl: lead.postUrl || lead.url || '', dryRun: forceDryRun }
                });
                break; // Success
            } catch (err) {
                if (attempt === 2) throw err;
                console.warn(LOG_TAG, `Message attempt ${attempt + 1} failed, retrying...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log(LOG_TAG, "[ENGAGE] Agent response:", response);

        if (response?.dryRun) {
            // No-post diagnostic run — do NOT touch counters or comment_log.
            const verdict = response.success ? 'WOULD POST ✓ (text landed + submit ready)' : 'WOULD FAIL ✗';
            await setPulse(`DRY-RUN ${verdict} ${response.error ? '— ' + response.error.slice(0, 60) : ''}`.trim());
            console.log(LOG_TAG, '[ENGAGE][DRY-RUN]', verdict, response);
        } else if (response?.success) {
            const res = await chrome.storage.local.get(['answerly_engagements']);
            const count = (res.answerly_engagements || 0) + 1;
            await chrome.storage.local.set({ answerly_engagements: count });

            // Bump the DAILY (date-keyed, per-platform) counter the ban-safe caps
            // read. This is what keeps a long commenting session from crossing
            // LinkedIn's daily threshold.
            try {
                const today2 = new Date().toISOString().slice(0, 10);
                const r2 = await chrome.storage.local.get(['answerly_engagements_daily']);
                let d2 = r2.answerly_engagements_daily || { date: today2, total: 0, byPlatform: {} };
                if (d2.date !== today2) d2 = { date: today2, total: 0, byPlatform: {} };
                const plat = platformOfUrl(lead.postUrl || lead.url);
                d2.total = (d2.total || 0) + 1;
                d2.byPlatform[plat] = (d2.byPlatform[plat] || 0) + 1;
                await chrome.storage.local.set({ answerly_engagements_daily: d2 });
            } catch (e) { console.warn(LOG_TAG, '[ENGAGE] daily counter bump failed:', e); }

            // Record EVERY successful comment (manual + auto) in a unified log
            // so the radar can show a clear "✓ commented" badge per post no
            // matter which path the comment came through. Capped at 200 rows.
            if (lead.actionType === 'comment') {
                try {
                    const targetUrl = lead.postUrl || lead.url;
                    const log = await chrome.storage.local.get(['comment_log']);
                    const history = log.comment_log || [];
                    history.unshift({
                        at: Date.now(),
                        url: targetUrl,
                        source: lead._autoCommentJobId ? 'auto' : 'manual',
                        commentPreview: (lead.commentText || '').slice(0, 200),
                        creator: lead._autoCommentPost?.creator || null,
                        platform: lead._autoCommentPost?.platform || null
                    });
                    await chrome.storage.local.set({ comment_log: history.slice(0, 200) });
                } catch (e) { console.warn(LOG_TAG, '[ENGAGE] comment_log write failed:', e); }
            }

            await setPulse(`Success: ${lead.actionType} completed.`);
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
        // Tear down whatever we opened. The foreground comment tab is closed too
        // (after the success dwell above), returning the user to their previous
        // tab — no debugger, no banner, nothing left behind.
        if (shadowWindowId) {
            try { await chrome.windows.remove(shadowWindowId); } catch(_) {}
        }
        if (foregroundTabId) {
            try { await chrome.tabs.remove(foregroundTabId); } catch(_) {}
        }
        isEngaging = false;
        // Platform-aware cooldown. LinkedIn is the strictest on automation, so it
        // gets a longer, more randomised gap between actions (3–7 min) than X /
        // Reddit (1.5–3 min). Randomised so the cadence never looks mechanical.
        const _plat = platformOfUrl(lead?.postUrl || lead?.url);
        const cooldown = _plat === 'LinkedIn'
            ? (180000 + Math.random() * 240000)   // LinkedIn: 3–7 min
            : (90000 + Math.random() * 90000);     // others: 1.5–3 min
        await setPulse(`Cooling down (${Math.round(cooldown/1000)}s)`);
        console.log(LOG_TAG, `[ENGAGE] Next in ${Math.round(cooldown/1000)}s`);
        setTimeout(processEngagementQueue, cooldown);
    }
}

// 2. Main Message Listener Hub
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(LOG_TAG, "Message received:", request.action || request.type);

    // ── Web-app license ──
    if (request.action === 'SET_LICENSE') {
        VIRAHOLIC_LICENSE = request.license || null;
        try { chrome.storage.local.set({ viraholic_license: VIRAHOLIC_LICENSE }); } catch (e) {}
        sendResponse({ ok: true, licensed: isLicensed() });
        return true;
    }
    // Gate all agent work on a valid, current web-app license.
    if (['forceCheck','performReconSearch','DISCOVERY_START','DISCOVERY_RESUME','CAMPAIGN_START','CAMPAIGN_RESUME','CAMPAIGN_RUN_NOW','TRACKING_RUN_NOW','TRACKING_KICK','TRACKING_FORCE_TICK','AUTO_COMMENT_SUBMIT','STEAL_VOICE_FETCH_POSTS','ENRICH_ACCOUNT','DISCOVERY_SMOKE_TEST'].indexOf(request.action) !== -1 && !isLicensed()) {
        sendResponse({ ok: false, error: 'Viraholic: open the web app and make sure your account is active to use the agent.' });
        return true;
    }

    // ── Trusted insert (CDP) requested by the engagement agent ──
    // The agent has focused the Draft.js editor and placed a caret; we inject a
    // genuinely-trusted Input.insertText that updates editorState (enables the
    // submit button) regardless of OS window focus. tabId comes from the sender
    // so we always target the right (already-attached) tab.
    // ── Agent diagnostic trace (forwarded from the short-lived engagement popup)
    // so the full insert/submit trace survives in the persistent SW console.
    if (request.type === 'AGENT_LOG') {
        console.log(LOG_TAG, '[AGENT]', request.step, request.payload != null ? request.payload : '');
        // PERSIST the trace. The engagement tab is torn down the moment a run
        // ends (see processEngagementQueue's finally), and the SW console isn't
        // reachable from the app page — so an in-tab/console-only trace is
        // invisible for debugging. We keep an in-memory ring (race-free: the SW
        // is single-threaded and stays alive for the whole run) and write-through
        // to chrome.storage.local so the app page can dump exactly where the
        // agent stopped. A fresh 'start' step resets the buffer per run.
        try {
            if (!Array.isArray(self.__agentTrace)) self.__agentTrace = [];
            if (request.step === 'start' || request.step === 'agent.ready') self.__agentTrace = [];
            self.__agentTrace.push({ t: Date.now(), step: request.step, payload: request.payload != null ? request.payload : null });
            if (self.__agentTrace.length > 300) self.__agentTrace = self.__agentTrace.slice(-300);
            chrome.storage.local.set({ answerly_agent_trace: self.__agentTrace }, () => { void chrome.runtime.lastError; });
        } catch (_) { /* never let logging break the run */ }
        sendResponse({ success: true });
        return false;
    }
    if (request.type === 'CDP_PING') {
        const tabId = sender?.tab?.id;
        sendResponse({ success: true, attached: typeof tabId === 'number' && cdpAttachedTabs.has(tabId) });
        return false;
    }
    if (request.type === 'CDP_INSERT_TEXT') {
        const tabId = sender?.tab?.id;
        if (typeof tabId !== 'number') { sendResponse({ success: false, error: 'no tab id' }); return false; }
        if (!cdpAttachedTabs.has(tabId)) { sendResponse({ success: false, error: 'cdp-not-attached' }); return false; }
        cdpInsertText(tabId, String(request.text || ''))
            .then(() => sendResponse({ success: true }))
            .catch(e => sendResponse({ success: false, error: e?.message || String(e) }));
        return true;
    }
    if (request.type === 'CDP_CLICK') {
        const tabId = sender?.tab?.id;
        if (typeof tabId !== 'number') { sendResponse({ success: false, error: 'no tab id' }); return false; }
        if (!cdpAttachedTabs.has(tabId)) { sendResponse({ success: false, error: 'cdp-not-attached' }); return false; }
        cdpClick(tabId, Number(request.x), Number(request.y))
            .then(() => sendResponse({ success: true }))
            .catch(e => sendResponse({ success: false, error: e?.message || String(e) }));
        return true;
    }
    if (request.type === 'CDP_KEY_ENTER') {
        const tabId = sender?.tab?.id;
        if (typeof tabId !== 'number') { sendResponse({ success: false, error: 'no tab id' }); return false; }
        if (!cdpAttachedTabs.has(tabId)) { sendResponse({ success: false, error: 'cdp-not-attached' }); return false; }
        cdpKeyEnter(tabId, !!request.useMeta)
            .then(() => sendResponse({ success: true }))
            .catch(e => sendResponse({ success: false, error: e?.message || String(e) }));
        return true;
    }

    // ── Feed Watcher control surface (app → service worker) ──
    if (request.type === 'FEED_WATCH_SAVE_CONFIG' && self.saveFeedWatchConfig) {
        self.saveFeedWatchConfig(request.config)
            .then(() => sendResponse({ success: true }))
            .catch(e => sendResponse({ success: false, error: e?.message }));
        return true;
    }
    if (request.type === 'FEED_WATCH_SWEEP_NOW' && self.runFeedWatchSweep) {
        self.runFeedWatchSweep()
            .then(() => sendResponse({ success: true }))
            .catch(e => sendResponse({ success: false, error: e?.message }));
        return true;
    }
    if (request.type === 'FEED_WATCH_CONSUME') {
        const uuids = new Set(request.uuids || []);
        chrome.storage.local.get(['feed_watch_buffer'], r => {
            const buf = Array.isArray(r.feed_watch_buffer) ? r.feed_watch_buffer : [];
            const next = buf.filter(p => !uuids.has(p.uuid));
            chrome.storage.local.set({ feed_watch_buffer: next }, () => sendResponse({ success: true, remaining: next.length }));
        });
        return true;
    }

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
        // Reject the legacy recon mission while a discovery mission is alive —
        // otherwise both engines open competing windows for the same domains.
        isDiscoveryActive().then(active => {
            if (active) {
                console.warn(LOG_TAG, "Refusing recon — discovery mission in progress.");
                sendResponse({ success: false, error: 'Discovery mission in progress — wait for it to finish.' });
                return;
            }
            startLegacyRecon();
        });
        const keywords = request.keywords || [];
        const campaign = request.campaign || null;

        function startLegacyRecon() {
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
                    // Tracking is now driven by the trackingTick heartbeat — no
                    // need to create stealthCheck. Recon owns its own queueProcessor.
                    chrome.alarms.create("queueProcessor", { periodInMinutes: 5 });
                    console.log(LOG_TAG, "Mission initialized. Starting first keyword...");
                    processNextReconKeyword();
                    sendResponse({ success: true });
                });
            });
        }
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
        // Legacy: stealthCheck no longer exists, but clear for safety
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
            engineVersion: self.__DISC_ENGINE_VERSION__ || null,
            version: '1.2'
        });
        return false;
    }
    if (request.action === 'DISCOVERY_SET_GEMINI_KEY') {
        // Web app pushes the Gemini key here so the engine's vocabulary
        // bloom (hunter brain stage 0) can use it. Stored locally only.
        const k = request.key;
        if (typeof k === 'string' && k.length > 10) {
            chrome.storage.local.set({ gemini_api_key: k }, () => {
                sendResponse({ ok: true });
            });
        } else {
            sendResponse({ ok: false, error: 'Invalid key' });
        }
        return true;
    }
    if (request.action === 'DISCOVERY_SET_VOICE_PROFILE') {
        // Web app pushes the user's active voice profile here so the Feed
        // Watcher can draft engagement replies in their voice from the SW
        // (even with the app tab closed). Stored locally only.
        const vp = request.profile;
        if (vp && typeof vp === 'object') {
            chrome.storage.local.set({ answerly_voice_profile: vp }, () => {
                sendResponse({ ok: true });
            });
        } else {
            sendResponse({ ok: false, error: 'Invalid profile' });
        }
        return true;
    }
    if (request.action === 'DISCOVERY_SMOKE_TEST') {
        // Pipeline smoke test: writes a fake completed mission to chrome.storage.
        // If the UI shows 3 fake accounts after this, the storage→bridge→UI path
        // is healthy and the real bug is in scraping. If the UI shows nothing,
        // the bug is upstream of the engine.
        (async () => {
            try {
                const fakeMission = {
                    id: `smoke_${Date.now()}`,
                    name: 'Smoke Test',
                    status: 'completed',
                    mode: 'surgical',
                    filters: { platforms: ['X'], keywords: ['test'] },
                    startedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    progress: { matched: 3, rejected: 0, candidatesScanned: 3, profilesAnalyzed: 3 },
                    stealth: { humanizedBehaviorScore: 100 },
                    results: [
                        { id: 'smoke_1', platform: 'X', handle: 'smoketest_1', url: 'https://x.com/smoketest_1', displayName: 'Smoke Test #1', bio: 'Pipeline test account', followers: 12500, verified: true, finalScore: 88, tier: 'S', matchedSignals: ['Pipeline test'], discoveredAt: new Date().toISOString(), trackingStatus: 'untracked' },
                        { id: 'smoke_2', platform: 'X', handle: 'smoketest_2', url: 'https://x.com/smoketest_2', displayName: 'Smoke Test #2', bio: 'Pipeline test account', followers: 8400, verified: false, finalScore: 74, tier: 'A', matchedSignals: ['Pipeline test'], discoveredAt: new Date().toISOString(), trackingStatus: 'untracked' },
                        { id: 'smoke_3', platform: 'X', handle: 'smoketest_3', url: 'https://x.com/smoketest_3', displayName: 'Smoke Test #3', bio: 'Pipeline test account', followers: 3200, verified: false, finalScore: 58, tier: 'B', matchedSignals: ['Pipeline test'], discoveredAt: new Date().toISOString(), trackingStatus: 'untracked' }
                    ],
                    logs: [
                        { timestamp: new Date().toISOString(), level: 'info', message: '🧪 SMOKE TEST: this mission was injected directly into chrome.storage to verify the storage→bridge→UI pipeline.' },
                        { timestamp: new Date().toISOString(), level: 'success', message: '🧪 If you see 3 fake accounts in Found Accounts, the pipeline works. The real-search bug is in scraping (DOM, login wall, or filters).' }
                    ]
                };
                await chrome.storage.local.set({
                    discovery_mission_state: fakeMission,
                    discovery_mission_completed: { ...fakeMission, _completedAt: Date.now() }
                });
                console.log(LOG_TAG, '[Discovery] Smoke test fired — 3 fake accounts injected.');
            } catch (e) {
                console.error(LOG_TAG, '[Discovery] Smoke test failed:', e);
            }
        })();
        sendResponse({ success: true });
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
        // Enforce floor: 5 min minimum (Chrome MV3 alarm limit + heartbeat ratio)
        const safe = {
            intervalMinutes: Math.max(5, Number(incoming.intervalMinutes) || 15),
            respectOffHours: incoming.respectOffHours !== false,
            jitterPercent: Math.min(0.5, Math.max(0, Number(incoming.jitterPercent) || 0.25))
        };
        chrome.storage.local.set({ [TRACKING_SETTINGS_KEY]: safe }, () => {
            sendResponse({ success: true, settings: safe });
        });
        return true;
    }
    if (request.action === 'TRACKING_RUN_NOW') {
        // "Check now" — sweep every selected account, not just one. The cycle
        // version polls a single oldest creator, which is right for the
        // background alarm but wrong for a user-clicked button.
        executeFullSweep().catch(e => console.error(LOG_TAG, '[Tracking] Manual sweep failed:', e));
        sendResponse({ success: true });
        return false;
    }
    // Kick a poll for a specific creator (used when a new account is tracked
    // from the dashboard — gives an instant first signal instead of making the
    // user wait for the next alarm tick).
    if (request.action === 'TRACKING_KICK') {
        const urls = Array.isArray(request.urls) ? request.urls : [];
        kickPollForUrls(urls).catch(e => console.error(LOG_TAG, '[Tracking] Kick failed:', e));
        sendResponse({ success: true });
        return false;
    }
    // Enrich a single account (manual add): scrape public profile metrics so
    // the card shows real follower counts / verification instead of zeros.
    if (request.action === 'ENRICH_ACCOUNT') {
        withTimeout(enrichAccount(request.platform, request.url), 45000, `enrich:${request.url}`)
            .then(data => sendResponse({ success: true, data: data || {} }))
            .catch(e => sendResponse({ success: false, error: e.message }));
        return true; // async response
    }
    // Voice Studio "Steal a voice": open the X profile in a shadow window,
    // scrape the last 10–20 original posts so the React side can AI-calibrate
    // a brand-new voice profile from them.
    if (request.action === 'STEAL_VOICE_FETCH_POSTS') {
        withTimeout(stealVoiceFetchPosts(request.handle, request.target || 15), 75000, `stealVoice:${request.handle}`)
            .then(data => sendResponse({ success: true, ...data }))
            .catch(e => sendResponse({ success: false, error: e.message }));
        return true;
    }
    // Diagnostic: dump the full tracking state so the dashboard can verify
    // the heartbeat is alive and show the user what's happening internally.
    if (request.action === 'TRACKING_DEBUG') {
        (async () => {
            try {
                const alarms = await chrome.alarms.getAll();
                const storage = await chrome.storage.local.get([
                    'answerly_creator_configs', 'answerly_last_cycle_at',
                    LAST_TICK_KEY, 'tracking_last_sweep_summary',
                    'answerly_engine_pulse', 'answerly_backoff_until'
                ]);
                const settings = await getTrackingSettings();
                const now = Date.now();
                sendResponse({
                    success: true,
                    now,
                    pollingActive,
                    pollingHeldForMs: pollingActive ? now - pollingStartedAt : 0,
                    alarms: alarms.map(a => ({
                        name: a.name,
                        nextFireInMs: Math.round(a.scheduledTime - now),
                        periodInMinutes: a.periodInMinutes
                    })),
                    accounts: (storage.answerly_creator_configs || []).length,
                    settings,
                    lastTickAt: storage[LAST_TICK_KEY] || 0,
                    lastTickAgoMs: storage[LAST_TICK_KEY] ? now - storage[LAST_TICK_KEY] : null,
                    lastCycleAt: storage.answerly_last_cycle_at || 0,
                    lastCycleAgoMs: storage.answerly_last_cycle_at ? now - storage.answerly_last_cycle_at : null,
                    lastSweepSummary: storage.tracking_last_sweep_summary || null,
                    currentPulse: storage.answerly_engine_pulse?.msg || null,
                    backoffUntil: storage.answerly_backoff_until || 0
                });
            } catch (e) {
                sendResponse({ success: false, error: e?.message || String(e) });
            }
        })();
        return true; // async
    }
    // Force the heartbeat to run immediately — for debugging
    if (request.action === 'TRACKING_FORCE_TICK') {
        tickTracking().catch(e => console.error(LOG_TAG, '[Tracking] Force tick failed:', e));
        sendResponse({ success: true });
        return false;
    }

    // ─── AUTO-COMMENT ───────────────────────────────────────────────
    if (request.action === 'AUTO_COMMENT_CONFIG_GET') {
        Promise.all([
            getAutoCommentConfig(),
            chrome.storage.local.get(['auto_comment_history', 'auto_comment_pending'])
        ]).then(([cfg, storage]) => {
            const now = Date.now();
            const HOUR_MS = 3600_000, DAY_MS = 24 * HOUR_MS;
            const posted = (storage.auto_comment_history || []).filter(h => h.status === 'posted');
            sendResponse({
                success: true,
                config: cfg,
                pendingCount: (storage.auto_comment_pending || []).length,
                postedLastHour: posted.filter(h => now - h.at < HOUR_MS).length,
                postedLastDay: posted.filter(h => now - h.at < DAY_MS).length,
                history: (storage.auto_comment_history || []).slice(0, 20)
            });
        });
        return true; // async
    }
    if (request.action === 'AUTO_COMMENT_CONFIG_SET') {
        const incoming = request.config || {};
        // Answer PARAMETERS only — there is no global on/off (per-account flag drives it).
        const cfg = {
            tone: ['casual','formal','funny'].includes(incoming.tone) ? incoming.tone : 'casual',
            goal: ['build_relationship','ask_question','share_insight','get_noticed'].includes(incoming.goal) ? incoming.goal : 'build_relationship',
            customInstruction: String(incoming.customInstruction || '').slice(0, 400),
            includeReposts: !!incoming.includeReposts,
            minMatchScore: Math.max(0, Math.min(100, Number(incoming.minMatchScore) || 0))
        };
        chrome.storage.local.set({ [AUTO_COMMENT_CONFIG_KEY]: cfg }, () => sendResponse({ success: true, config: cfg }));
        return true;
    }
    // Toggle the `autoComment` flag on a specific tracked account
    if (request.action === 'TRACKING_TOGGLE_AUTO_COMMENT') {
        (async () => {
            const { answerly_creator_configs = [] } = await chrome.storage.local.get(['answerly_creator_configs']);
            const next = answerly_creator_configs.map(c => c.url === request.url ? { ...c, autoComment: !!request.enabled } : c);
            await chrome.storage.local.set({ answerly_creator_configs: next });
            sendResponse({ success: true });
        })();
        return true;
    }
    // Dashboard pulls the next pending job to generate a comment for
    if (request.action === 'AUTO_COMMENT_PENDING_GET') {
        chrome.storage.local.get(['auto_comment_pending'], r => {
            sendResponse({ success: true, jobs: r.auto_comment_pending || [] });
        });
        return true;
    }
    // Dashboard sends back the generated comment text — we queue it for posting
    if (request.action === 'AUTO_COMMENT_SUBMIT') {
        (async () => {
            try {
                const { jobId, comment } = request;
                if (!jobId || !comment) { sendResponse({ success: false, error: 'missing jobId or comment' }); return; }
                const { auto_comment_pending = [] } = await chrome.storage.local.get(['auto_comment_pending']);
                const job = auto_comment_pending.find(j => j.id === jobId);
                if (!job) { sendResponse({ success: false, error: 'job not found' }); return; }
                // Remove from pending so we don't re-submit
                const nextPending = auto_comment_pending.filter(j => j.id !== jobId);
                await chrome.storage.local.set({ auto_comment_pending: nextPending });
                // Queue for posting via the existing engagement queue
                const { answerly_engagement_queue = [] } = await chrome.storage.local.get(['answerly_engagement_queue']);
                answerly_engagement_queue.push({
                    url: job.url,
                    postUrl: job.postUrl,
                    actionType: 'comment',
                    commentText: comment,
                    _autoCommentJobId: jobId,
                    _autoCommentPost: { platform: job.platform, creator: job.creator, postUrl: job.postUrl, text: job.postText }
                });
                await chrome.storage.local.set({ answerly_engagement_queue });
                await logAutoComment({ status: 'posted', reason: 'sent to engagement queue', post: job, jobId, comment });
                processEngagementQueue();
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }
    // Unified comment log — every successful manual OR auto comment.
    // Used by the radar to show a "✓ commented" badge per post regardless
    // of which path the comment came through.
    if (request.action === 'COMMENT_LOG_GET') {
        chrome.storage.local.get(['comment_log'], r => {
            sendResponse({ success: true, log: r.comment_log || [] });
        });
        return true;
    }
    // Append a manual comment to the unified log so the radar badge flips to
    // "You replied" the moment the user fires a manual reply (Send Now / Open
    // Manual). Dedups by url so repeated clicks or the later auto-success
    // write don't create duplicate rows.
    if (request.action === 'COMMENT_LOG_ADD') {
        (async () => {
            try {
                const { comment_log = [] } = await chrome.storage.local.get(['comment_log']);
                const url = request.url || request.postUrl;
                if (!url) { sendResponse({ success: false, error: 'no url' }); return; }
                if (comment_log.some(c => (c.url || c.postUrl) === url)) {
                    sendResponse({ success: true, deduped: true });
                    return;
                }
                comment_log.unshift({
                    at: Date.now(),
                    url,
                    source: request.source || 'manual',
                    commentPreview: (request.comment || '').slice(0, 200),
                    creator: request.creator || null,
                    platform: request.platform || null
                });
                await chrome.storage.local.set({ comment_log: comment_log.slice(0, 200) });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }
    // Allow dashboard to clear a pending job (user dismisses)
    if (request.action === 'AUTO_COMMENT_DISMISS') {
        (async () => {
            const { auto_comment_pending = [] } = await chrome.storage.local.get(['auto_comment_pending']);
            const job = auto_comment_pending.find(j => j.id === request.jobId);
            const next = auto_comment_pending.filter(j => j.id !== request.jobId);
            await chrome.storage.local.set({ auto_comment_pending: next });
            if (job) await logAutoComment({ status: 'dismissed', reason: 'user dismissed', post: job, jobId: request.jobId });
            sendResponse({ success: true });
        })();
        return true;
    }

    // Human-in-the-loop: the dashboard generated a draft reply — store it for
    // user review (do NOT post). It shows under the post in the Posts Tracker.
    if (request.action === 'AUTO_COMMENT_SAVE_DRAFT') {
        (async () => {
            try {
                const { jobId, comment } = request;
                if (!jobId || !comment) { sendResponse({ success: false, error: 'missing jobId or comment' }); return; }
                const { auto_comment_pending = [], auto_comment_drafts = [] } = await chrome.storage.local.get(['auto_comment_pending', 'auto_comment_drafts']);
                const job = auto_comment_pending.find(j => j.id === jobId);
                if (!job) { sendResponse({ success: false, error: 'job not found' }); return; }
                const nextPending = auto_comment_pending.filter(j => j.id !== jobId);
                const draft = {
                    id: jobId,
                    url: job.url,
                    postUrl: job.postUrl,
                    platform: job.platform,
                    creator: job.creator,
                    postText: job.postText,
                    draft: comment,
                    status: 'pending',          // pending | posted
                    generatedAt: Date.now()
                };
                const nextDrafts = [draft, ...auto_comment_drafts.filter(d => d.postUrl !== job.postUrl)].slice(0, 100);
                await chrome.storage.local.set({ auto_comment_pending: nextPending, auto_comment_drafts: nextDrafts });
                await logAutoComment({ status: 'queued', reason: 'draft ready for review', post: job, jobId, comment });
                console.log(LOG_TAG, `[AutoReply] Draft ready for review: ${job.creator}`);
                sendResponse({ success: true });
            } catch (e) { sendResponse({ success: false, error: e?.message || String(e) }); }
        })();
        return true;
    }
    // Return all pending drafts for the dashboard to render under each post.
    if (request.action === 'AUTO_COMMENT_DRAFTS_GET') {
        chrome.storage.local.get(['auto_comment_drafts'], r => {
            sendResponse({ success: true, drafts: (r.auto_comment_drafts || []).filter(d => d.status === 'pending') });
        });
        return true;
    }
    // User confirmed a draft (possibly edited) — post it via the engagement queue.
    if (request.action === 'AUTO_COMMENT_CONFIRM') {
        (async () => {
            try {
                const { postUrl, comment } = request;
                if (!postUrl || !comment) { sendResponse({ success: false, error: 'missing postUrl or comment' }); return; }
                const { auto_comment_drafts = [], answerly_engagement_queue = [] } = await chrome.storage.local.get(['auto_comment_drafts', 'answerly_engagement_queue']);
                const draft = auto_comment_drafts.find(d => d.postUrl === postUrl);
                answerly_engagement_queue.push({
                    url: draft?.url || postUrl,
                    postUrl,
                    actionType: 'comment',
                    commentText: comment,
                    _autoCommentJobId: draft?.id || null,
                    _autoCommentPost: draft ? { platform: draft.platform, creator: draft.creator, postUrl: draft.postUrl, text: draft.postText } : null
                });
                const nextDrafts = auto_comment_drafts.filter(d => d.postUrl !== postUrl);
                await chrome.storage.local.set({ answerly_engagement_queue, auto_comment_drafts: nextDrafts });
                await logAutoComment({ status: 'posted', reason: 'user confirmed', post: draft || { postUrl }, jobId: draft?.id, comment });
                processEngagementQueue();
                sendResponse({ success: true });
            } catch (e) { sendResponse({ success: false, error: e?.message || String(e) }); }
        })();
        return true;
    }
    // User discarded a draft.
    if (request.action === 'AUTO_COMMENT_DISCARD') {
        (async () => {
            const { auto_comment_drafts = [] } = await chrome.storage.local.get(['auto_comment_drafts']);
            const draft = auto_comment_drafts.find(d => d.postUrl === request.postUrl);
            await chrome.storage.local.set({ auto_comment_drafts: auto_comment_drafts.filter(d => d.postUrl !== request.postUrl) });
            if (draft) await logAutoComment({ status: 'dismissed', reason: 'user discarded draft', post: draft });
            sendResponse({ success: true });
        })();
        return true;
    }
    // Posts Tracker management — clear all, or remove a single post.
    // Removed post URLs go on a deny-list so the recency-based surfacer doesn't
    // bring them back on the next sweep.
    if (request.action === 'POSTS_CLEAR') {
        (async () => {
            const { answerly_history = [], answerly_removed_posts = [] } = await chrome.storage.local.get(['answerly_history', 'answerly_removed_posts']);
            const urls = answerly_history.map(h => h.postUrl || h.url).filter(Boolean);
            const removed = Array.from(new Set([...answerly_removed_posts, ...urls])).slice(-1000);
            await chrome.storage.local.set({ answerly_history: [], answerly_removed_posts: removed });
            sendResponse({ success: true });
        })();
        return true;
    }
    if (request.action === 'POSTS_REMOVE') {
        (async () => {
            const { answerly_history = [], answerly_removed_posts = [] } = await chrome.storage.local.get(['answerly_history', 'answerly_removed_posts']);
            const removedUrl = request.postUrl;
            const next = answerly_history.filter(h => h.uuid !== request.uuid && (h.postUrl || h.url) !== removedUrl);
            const removed = removedUrl
                ? Array.from(new Set([...answerly_removed_posts, removedUrl])).slice(-1000)
                : answerly_removed_posts;
            await chrome.storage.local.set({ answerly_history: next, answerly_removed_posts: removed });
            sendResponse({ success: true });
        })();
        return true;
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

// 2.5 Full Sweep (For manual triggers) — protected by the polling mutex so
// only ONE creator's window is open at a time, in strict sequence.
async function executeFullSweep() {
  return withPollingLock('full-sweep', () => _executeFullSweepImpl());
}
async function _executeFullSweepImpl() {
  if (await isDiscoveryActive()) {
    await setPulse("Sweep skipped — discovery mission in progress.");
    return { count: 0, skipped: 'discovery_active' };
  }
  const result = await chrome.storage.local.get(['answerly_creator_configs']);
  const configs = result.answerly_creator_configs || [];

  if (configs.length === 0) {
    await setPulse("Sweep Skipped: No creators configured in Web App.");
    return { count: 0 };
  }

  await setPulse(`Starting sweep — ${configs.length} account${configs.length > 1 ? 's' : ''} in one window…`);

  // Open ONE shadow window upfront. Every poller will navigate this same
  // tab between accounts instead of opening its own popup. This is the only
  // way to guarantee "one window, checking accounts one after another" — any
  // sequence of open/close/open inevitably overlaps briefly during the
  // close → open transition and looks like two windows to the user.
  let sweepWindow = null;
  let sweepTabId = null;
  try {
    sweepWindow = await openShadowWindow({
      url: 'about:blank',
      type: 'popup',
      state: 'normal',
      focused: false,
      width: 500,
      height: 600,
      left: 50,
      top: 50,
    }, 'Tracking sweep');
    sweepTabId = sweepWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: sweepWindow.id }))[0]?.id;
    if (!sweepTabId) throw new Error('Could not get sweep tab id');

    for (const target of configs) {
      try {
        await setPulse(`Checking ${target.label} (${target.platform})…`);
        target.lastChecked = 0; // reset cooldown for manual sweep
        let found = 0;
        const SCRAPE_TIMEOUT = 30000;
        if (target.platform === 'X') {
          found = await withTimeout(pollXWithShadowTab(target, sweepTabId), SCRAPE_TIMEOUT, `X:${target.label}`);
        } else if (target.platform === 'LinkedIn') {
          found = await withTimeout(pollLinkedIn(target, sweepTabId), SCRAPE_TIMEOUT, `LinkedIn:${target.label}`);
        } else if (target.platform === 'Reddit') {
          found = await withTimeout(pollReddit(target, sweepTabId), SCRAPE_TIMEOUT, `Reddit:${target.label}`);
        } else if (target.platform === 'Product Hunt') {
          found = await withTimeout(pollProductHunt(target, sweepTabId), SCRAPE_TIMEOUT, `PH:${target.label}`);
        }
        target.lastChecked = Date.now();
        target.lastStatus = `Success: Found ${found}`;
        await chrome.storage.local.set({ answerly_creator_configs: configs });
      } catch (e) {
        target.lastStatus = `Error: ${e.message}`;
        target.lastChecked = Date.now();
        await chrome.storage.local.set({ answerly_creator_configs: configs });
        console.error(LOG_TAG, `Sweep failed for ${target.label}:`, e);
        await setPulse(`Failed ${target.label}: ${e.message}`);
      }
    }
    await setPulse("Sweep completed.");
    return { count: configs.length };
  } finally {
    if (sweepWindow) await closeShadowWindow(sweepWindow);
  }
}

// 2.6 Kick — poll a specific list of newly-tracked creators NOW (don't wait
// for the next alarm). Used when the dashboard adds an account so the user
// gets an immediate "yes, it's working" signal in the radar.
async function kickPollForUrls(urls) {
  return withPollingLock('kick', () => _kickPollForUrlsImpl(urls));
}
async function _kickPollForUrlsImpl(urls) {
  if (await isDiscoveryActive()) {
    await setPulse("Kick deferred — discovery mission in flight.");
    return { count: 0, skipped: 'discovery_active' };
  }
  const result = await chrome.storage.local.get(['answerly_creator_configs']);
  const configs = result.answerly_creator_configs || [];
  const wanted = new Set(urls || []);
  const targets = configs.filter(c => wanted.has(c.url) || !c.lastChecked);
  if (targets.length === 0) return { count: 0 };

  await setPulse(`Tracking ${targets.length} new account${targets.length > 1 ? 's' : ''} in one window…`);

  // Same shared-window pattern as the manual sweep — open one popup, navigate
  // it through every newly-tracked account.
  let kickWindow = null;
  let kickTabId = null;
  try {
    kickWindow = await openShadowWindow({
      url: 'about:blank', type: 'popup', state: 'normal', focused: false,
      width: 500, height: 600, left: 50, top: 50
    }, 'First-look sweep');
    kickTabId = kickWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: kickWindow.id }))[0]?.id;
    if (!kickTabId) throw new Error('Could not get kick tab id');

    for (const target of targets) {
      try {
        await setPulse(`First-look: ${target.label} (${target.platform})…`);
        let found = 0;
        const SCRAPE_TIMEOUT = 35000;
        if (target.platform === 'X')              found = await withTimeout(pollXWithShadowTab(target, kickTabId), SCRAPE_TIMEOUT, `X:${target.label}`);
        else if (target.platform === 'LinkedIn')  found = await withTimeout(pollLinkedIn(target, kickTabId), SCRAPE_TIMEOUT, `LinkedIn:${target.label}`);
        else if (target.platform === 'Reddit')    found = await withTimeout(pollReddit(target, kickTabId), SCRAPE_TIMEOUT, `Reddit:${target.label}`);
        else if (target.platform === 'Product Hunt') found = await withTimeout(pollProductHunt(target, kickTabId), SCRAPE_TIMEOUT, `PH:${target.label}`);

        target.lastChecked = Date.now();
        target.lastStatus = `Success: Found ${found}`;
        await chrome.storage.local.set({ answerly_creator_configs: configs });
      } catch (e) {
        target.lastStatus = `Error: ${e.message}`;
        target.lastChecked = Date.now();
        await chrome.storage.local.set({ answerly_creator_configs: configs });
        console.error(LOG_TAG, `Kick failed for ${target.label}:`, e);
      }
    }
  } finally {
    if (kickWindow) await closeShadowWindow(kickWindow);
  }
  await setPulse(`Tracking ready — ${targets.length} initial scan${targets.length > 1 ? 's' : ''} complete.`);
  return { count: targets.length };
}

// 3. Main Execution Cycle (Automated rotation)
async function executeCycle() {
  return withPollingLock('cycle', () => _executeCycleImpl());
}
async function _executeCycleImpl() {
  // Every path through this function records `answerly_last_cycle_at` so
  // the 1-min heartbeat respects the user's intervalMinutes — without it,
  // the heartbeat would re-invoke executeCycle every minute during a skip
  // (off-hours, cooldown, etc.) and spam the pulse.
  const markCycle = () => chrome.storage.local.set({ answerly_last_cycle_at: Date.now() });

  if (await isDiscoveryActive()) {
    console.log(LOG_TAG, '[Tracking] Skipping poll — discovery mission in progress');
    await setPulse('Tracking paused — discovery mission in progress.');
    await markCycle();
    return;
  }

  const result = await chrome.storage.local.get(['answerly_creator_configs', 'answerly_diagnostic', 'answerly_backoff_until']);
  const configs = result.answerly_creator_configs || [];
  const diagnostic = result.answerly_diagnostic || { lastRuns: [], errors: [] };
  const backoffUntil = result.answerly_backoff_until || 0;

  if (configs.length === 0) {
    await setPulse('Idle — no accounts tracked yet.');
    await markCycle();
    return;
  }

  const settings = await getTrackingSettings();

  // Off-hours guard — humans don't poll profiles at 3am
  if (settings.respectOffHours) {
    const h = new Date().getHours();
    if (h < 8 || h >= 23) {
      console.log(LOG_TAG, `[Tracking] Off-hours (${h}h) — skipping poll.`);
      await setPulse(`Off-hours (${h}:00) — paused until 8am. Turn off "Pause at night" to override.`);
      await markCycle();
      return;
    }
  }

  if (Date.now() < backoffUntil) {
    const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
    console.log(LOG_TAG, `[Tracking] In backoff for ${mins}min — skipping.`);
    await setPulse(`Rate-limit cooldown — ${mins} min remaining.`);
    await markCycle();
    return;
  }

  // Real sweep path — mark BEFORE so a crash doesn't retry instantly,
  // then iterate EVERY tracked account through a SINGLE shared window.
  await markCycle();

  const sweepStartedAt = Date.now();
  console.log(LOG_TAG, `[Tracking] ▶ Chronic sweep started — ${configs.length} account(s) at ${new Date(sweepStartedAt).toLocaleTimeString()}`);
  await setPulse(`Sweep: 0/${configs.length}`);

  let okCount = 0;
  let errCount = 0;
  let totalFound = 0;
  const SCRAPE_TIMEOUT = 35000;

  // One shared shadow window for the whole sweep — matches the manual
  // "Check now" UX and guarantees a single popup that navigates through
  // every account instead of opening one per account.
  //
  // Sizing/positioning is intentionally OBVIOUS during chronic sweeps so the
  // user can see tracking is alive: a tall, narrow popup parked near the
  // top-right corner. Without this it's easy to miss the 16-second window
  // popping up behind the main browser and assume the chronic check failed.
  let sweepWindow = null;
  let sweepTabId = null;
  try {
    sweepWindow = await openShadowWindow({
      url: 'about:blank', type: 'popup', state: 'normal', focused: false,
      width: 620, height: 760, left: 80, top: 60
    }, 'Chronic sweep');
    sweepTabId = sweepWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: sweepWindow.id }))[0]?.id;
    if (!sweepTabId) throw new Error('Could not get sweep tab id');

    for (let i = 0; i < configs.length; i++) {
      const target = configs[i];
      try {
        await setPulse(`Sweep: ${i + 1}/${configs.length} · ${target.label}`);
        let newPostsFound = 0;

        if (target.platform === 'X')              newPostsFound = await withTimeout(pollXWithShadowTab(target, sweepTabId), SCRAPE_TIMEOUT, `X:${target.label}`);
        else if (target.platform === 'LinkedIn')  newPostsFound = await withTimeout(pollLinkedIn(target, sweepTabId), SCRAPE_TIMEOUT, `LinkedIn:${target.label}`);
        else if (target.platform === 'Reddit')    newPostsFound = await withTimeout(pollReddit(target, sweepTabId), SCRAPE_TIMEOUT, `Reddit:${target.label}`);
        else if (target.platform === 'Product Hunt') newPostsFound = await withTimeout(pollProductHunt(target, sweepTabId), SCRAPE_TIMEOUT, `PH:${target.label}`);

        target.lastChecked = Date.now();
        target.lastStatus = `Success: Found ${newPostsFound}`;
        okCount++;
        totalFound += newPostsFound;

        diagnostic.lastRuns.unshift({ time: new Date().toISOString(), label: target.label, found: newPostsFound });
        diagnostic.lastRuns = diagnostic.lastRuns.slice(0, 20);

        await chrome.storage.local.set({
          answerly_creator_configs: configs,
          answerly_diagnostic: diagnostic
        });
      } catch (error) {
        console.error(LOG_TAG, `[Tracking] ${target.label} failed:`, error);
        target.lastStatus = `Error: ${error.message}`;
        target.lastChecked = Date.now();
        errCount++;

        if (error.message && error.message.includes('429')) {
          const TEN_MINS = 10 * 60 * 1000;
          await chrome.storage.local.set({ answerly_backoff_until: Date.now() + TEN_MINS });
          console.warn(LOG_TAG, `[Tracking] Rate-limited on ${target.label}; pausing tracking for 10min`);
        }

        diagnostic.errors.unshift({ time: new Date().toISOString(), label: target.label, error: error.message });
        diagnostic.errors = diagnostic.errors.slice(0, 10);
        await chrome.storage.local.set({
          answerly_creator_configs: configs,
          answerly_diagnostic: diagnostic
        });
      }
    }
  } finally {
    if (sweepWindow) await closeShadowWindow(sweepWindow);
  }

  const sweepEndedAt = Date.now();
  const summary = {
    total: configs.length, ok: okCount, errors: errCount, newPosts: totalFound,
    durationMs: sweepEndedAt - sweepStartedAt, finishedAt: sweepEndedAt
  };
  await chrome.storage.local.set({ tracking_last_sweep_summary: summary });
  console.log(LOG_TAG, `[Tracking] ✓ Sweep done — ${okCount}/${configs.length} ok, ${errCount} errors, ${totalFound} new, ${(summary.durationMs/1000).toFixed(1)}s`);
  await setPulse(`Sweep completed — ${okCount}/${configs.length} ok, ${totalFound} new post${totalFound === 1 ? '' : 's'}`);
  // Next sweep fires `intervalMinutes` from now (computed by tickTracking heartbeat).
}

// ─── Single-account enrichment ───────────────────────────────────────────────
// Opens a shadow window to a profile / subreddit and scrapes the public
// metrics (followers, verified, display name, bio, avatar) so a manually-added
// account shows real numbers instead of zeros. Wrapped by the polling lock at
// the call site so it never fights an in-flight tracking sweep for a window.
async function enrichAccountImpl(platform, url) {
  let shadowWindow = null;
  try {
    shadowWindow = await openShadowWindow({
      url,
      type: 'popup',
      // X needs a rendered (non-minimized) window to populate the profile DOM;
      // LinkedIn / Reddit render fine minimized and stay out of the way.
      state: platform === 'X' ? 'normal' : 'minimized',
      focused: false,
      width: 500, height: 640, left: 60, top: 60
    }, `Enrich ${url}`);
    const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
    if (!tabId) throw new Error('Enrichment tab init failed');

    let data = null;
    let loginWallSeen = false;
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 1500));
      if (i % 3 === 0) await dismissTrackingPopups(tabId);
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [platform],
        func: (platform) => {
          const parseCount = (str) => {
            if (!str) return 0;
            const s = String(str).replace(/[^\d.kKmMbB]/g, '');
            const n = parseFloat(s);
            if (isNaN(n)) return 0;
            if (/[kK]/.test(s)) return Math.round(n * 1e3);
            if (/[mM]/.test(s)) return Math.round(n * 1e6);
            if (/[bB]/.test(s)) return Math.round(n * 1e9);
            return Math.round(n);
          };
          try {
            if (platform === 'X') {
              // 1. GOLD SOURCE — window.__INITIAL_STATE__.entities.users has the
              //    real, unformatted counts. Find the user whose screen_name
              //    matches the URL handle.
              const handle = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
              try {
                const users = window.__INITIAL_STATE__?.entities?.users || window.__INITIAL_STATE__?.entities?.users?.entities;
                if (users && handle) {
                  const list = Array.isArray(users) ? users : Object.values(users);
                  const u = list.find(v => v && String(v.screen_name || v.username || '').toLowerCase() === handle);
                  if (u && (u.followers_count || u.normal_followers_count)) {
                    return {
                      displayName: u.name || handle,
                      bio: u.description || '',
                      avatar: u.profile_image_url_https || u.profile_image_url || null,
                      verified: !!(u.verified || u.is_blue_verified || u.verified_type),
                      followers: u.followers_count || u.normal_followers_count || 0,
                      following: u.friends_count || u.following_count || 0
                    };
                  }
                }
              } catch (_) {}

              // Detect a login wall so we can stop polling pointlessly.
              const bodyTxt = document.body?.innerText || '';
              const loginWall = /(Sign in to X|Log in|Don'?t miss what's happening|sign up to continue)/i.test(bodyTxt)
                && !document.querySelector('[data-testid="UserName"]');
              if (loginWall) return { __loginWall: true };

              const nameEl = document.querySelector('[data-testid="UserName"] [dir="ltr"] span, [data-testid="UserName"] span');
              const bioEl = document.querySelector('[data-testid="UserDescription"]');
              const avatar = document.querySelector('a[href$="/photo"] img, [data-testid="UserAvatar-Container-unknown"] img')?.src || null;
              const verified = !!document.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified"]');
              let followers = 0, following = 0;
              // Newer X structure: UserProfileHeader_Items wraps the follower links.
              document.querySelectorAll('[data-testid="UserProfileHeader_Items"] a, [data-testid="primaryColumn"] a[role="link"], a[href*="/verified_followers"], a[href*="/followers"], a[href*="/following"]').forEach(a => {
                const href = a.getAttribute('href') || '';
                const m = (a.textContent || '').trim().match(/([\d.,]+\s*[KkMmBb]?)/);
                if (!m) return;
                if (/\/(verified_followers|followers)$/.test(href) && !followers) followers = parseCount(m[1]);
                else if (/\/following$/.test(href) && !following) following = parseCount(m[1]);
              });
              // Some layouts wrap the count in a sibling <span>: look for any
              // element whose text ends with "Followers" or "Following".
              if (!followers || !following) {
                  document.querySelectorAll('span, a').forEach(el => {
                      const t = (el.textContent || '').trim();
                      if (!followers) {
                          const m = t.match(/^([\d.,]+\s*[KkMmBb]?)\s*Followers?$/i);
                          if (m) followers = parseCount(m[1]);
                      }
                      if (!following) {
                          const m = t.match(/^([\d.,]+\s*[KkMmBb]?)\s*Following$/i);
                          if (m) following = parseCount(m[1]);
                      }
                  });
              }
              // Fallback: scan body text for "<n> Followers".
              if (!followers) {
                const bm = (document.body.innerText || '').match(/([\d.,]+\s*[KkMmBb]?)\s*Followers/i);
                if (bm) followers = parseCount(bm[1]);
              }
              if (!nameEl && !followers) return null; // not loaded yet
              return { displayName: nameEl?.innerText || null, bio: bioEl?.innerText || '', avatar, verified, followers, following };
            }
            if (platform === 'LinkedIn') {
              const nameEl = document.querySelector('main h1, h1');
              const body = document.body.innerText || '';
              const m = body.match(/([\d.,]+\s*[KkMmBb]?)\s*followers/i)
                     || body.match(/([\d.,]+\s*[KkMmBb]?)\s*connections/i);
              const followers = m ? parseCount(m[1]) : 0;
              if (!nameEl && !followers) return null;
              return { displayName: nameEl?.innerText?.trim() || null, bio: '', avatar: null, verified: false, followers, following: 0 };
            }
            if (platform === 'Reddit') {
              const body = document.body.innerText || '';
              const m = body.match(/([\d.,]+\s*[KkMmBb]?)\s*members/i);
              const followers = m ? parseCount(m[1]) : 0;
              const nameEl = document.querySelector('h1');
              if (!followers && !nameEl) return null;
              return { displayName: nameEl?.innerText?.trim() || null, bio: '', avatar: null, verified: false, followers, following: 0 };
            }
          } catch (e) { return null; }
          return null;
        }
      });
      data = results?.[0]?.result || null;
      if (data && data.__loginWall) {
        if (!loginWallSeen) {
          console.warn(LOG_TAG, `[Enrich] ${platform} ${url} → login wall detected. Log in to x.com in this browser to get follower counts.`);
          loginWallSeen = true;
        }
        // No point retrying — the wall won't go away while we wait.
        data = null;
        break;
      }
      if (data && (data.followers || data.displayName)) break;
    }
    if (!data || (!data.followers && !data.displayName)) {
      console.warn(LOG_TAG, `[Enrich] ${platform} ${url} → no data extracted${loginWallSeen ? ' (login wall)' : ''}. Try logging in to the platform in this browser.`);
    } else {
      console.log(LOG_TAG, `[Enrich] ${platform} ${url} →`, data);
    }
    if (loginWallSeen) return { __loginWall: true };
    return data || {};
  } finally {
    if (shadowWindow) await closeShadowWindow(shadowWindow);
  }
}
async function enrichAccount(platform, url) {
  return withPollingLock('enrich', () => enrichAccountImpl(platform, url));
}

// ─── Voice Studio: Steal-a-voice profile fetch ───────────────────────────────
// Opens an X profile in a shadow window, scrolls the timeline to lazy-load
// posts, and extracts the most recent ORIGINAL posts authored by the target
// handle (no reposts, no replies). Used by the "Steal a voice" automation in
// ContentParametersView — the returned text feeds aiCalibrate().
async function stealVoiceFetchPostsImpl(handle, target) {
  const h = String(handle || '').trim().replace(/^@/, '');
  if (!h) throw new Error('Missing handle');
  const targetCount = Math.max(10, Math.min(30, Number(target) || 15));
  const url = `https://x.com/${encodeURIComponent(h)}`;
  let shadowWindow = null;
  try {
    shadowWindow = await openShadowWindow({
      url,
      type: 'popup',
      // X requires a rendered (non-minimized) window for the timeline to mount.
      state: 'normal',
      focused: false,
      width: 520, height: 760, left: 60, top: 60
    }, `StealVoice @${h}`);
    const tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
    if (!tabId) throw new Error('Steal-voice tab init failed');

    let posts = [];
    let loginWallSeen = false;
    // Up to ~60s of polling: 18 ticks × ~3s. Scroll every other tick so the
    // timeline lazy-loads more entries until we hit the target post count.
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 2500 : 2200));
      if (i % 3 === 0) await dismissTrackingPopups(tabId);
      // Scroll on most ticks to keep the timeline expanding.
      if (i > 0) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => { window.scrollBy(0, window.innerHeight * 2.5); }
          });
        } catch { /* tab may be closing */ }
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [h.toLowerCase()],
        func: (handleLc) => {
          try {
            const cleanText = (s) => String(s || '')
              .replace(/https?:\/\/t\.co\/\S+/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            // 1. GOLD SOURCE — window.__INITIAL_STATE__.entities.tweets has the
            //    full, untruncated text plus author + created_at + flags. Filter
            //    to tweets the target handle ACTUALLY authored (no RTs/replies).
            try {
              const state = window.__INITIAL_STATE__;
              const tweets = state?.entities?.tweets;
              const users  = state?.entities?.users;
              if (tweets) {
                const userList = users ? (Array.isArray(users) ? users : Object.values(users)) : [];
                const me = userList.find(u => u && String(u.screen_name || u.username || '').toLowerCase() === handleLc);
                const myId = me ? String(me.id_str || me.id || me.rest_id || '') : null;
                const list = Object.values(tweets)
                  .map(t => (t.legacy ? { ...t.legacy, ...t } : t))
                  .filter(tw => {
                    if (!tw) return false;
                    if (tw.retweeted_status_id_str || tw.retweeted_status_result || tw.retweeted === true) return false;
                    if (tw.in_reply_to_status_id_str || tw.in_reply_to_user_id_str) return false;
                    const authorId = String(tw.user_id_str || tw.user_id || tw.user?.id_str || '');
                    if (myId && authorId && authorId !== myId) return false;
                    const authorHandle = String(tw.user_screen_name || tw.screen_name || tw.user?.screen_name || '').toLowerCase();
                    if (authorHandle && authorHandle !== handleLc) return false;
                    const txt = tw.full_text || tw.text || '';
                    return txt && txt.length > 30;
                  })
                  .map(tw => ({
                    id: tw.id_str || tw.rest_id || null,
                    text: cleanText(tw.full_text || tw.text),
                    timestamp: tw.created_at ? new Date(tw.created_at).getTime() : null,
                    source: 'state'
                  }))
                  .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                if (list.length) return { posts: list };
              }
            } catch (_) {}

            // Detect login wall — abort polling early if visible.
            const bodyTxt = document.body?.innerText || '';
            const loginWall = /(Sign in to X|Log in|Don'?t miss what's happening|sign up to continue)/i.test(bodyTxt)
              && !document.querySelector('[data-testid="UserName"]');
            if (loginWall) return { __loginWall: true };

            // 2. DOM FALLBACK — scrape rendered articles. Filter to posts by the
            //    target handle, drop replies + reposts.
            const articles = document.querySelectorAll('[data-testid="tweet"], article[role="article"]');
            const out = [];
            articles.forEach(t => {
              // Skip native reposts (social context label above the tweet)
              const social = (t.querySelector('[data-testid="socialContext"]')?.innerText || '').toLowerCase();
              if (/repost|retweet/.test(social)) return;
              // Skip replies — the "Replying to @x" badge sits above the tweet text
              const replyBadge = t.querySelector('[data-testid="reply-to-link"]');
              const blockTxt = (t.innerText || '').slice(0, 200);
              if (replyBadge || /^Replying to/i.test(blockTxt)) return;
              // Author must match the target handle
              const userLink = t.querySelector('[data-testid="User-Name"] a[href^="/"]');
              const authorHandle = (userLink?.getAttribute('href') || '').replace(/^\//, '').split(/[/?#]/)[0].toLowerCase();
              if (authorHandle && authorHandle !== handleLc) return;
              const textEl = t.querySelector('[data-testid="tweetText"]');
              const text = cleanText(textEl?.innerText || '');
              if (!text || text.length < 30) return;
              const link = t.querySelector('a[href*="/status/"]');
              const href = link?.getAttribute('href') || '';
              const idMatch = href.match(/\/status\/(\d+)/);
              const timeEl = t.querySelector('time[datetime]');
              out.push({
                id: idMatch ? idMatch[1] : null,
                text,
                timestamp: timeEl ? new Date(timeEl.getAttribute('datetime')).getTime() : null,
                source: 'dom'
              });
            });
            // De-dup by id (or by first 80 chars when id missing)
            const seen = new Set();
            const deduped = [];
            out.forEach(p => {
              const k = p.id || p.text.slice(0, 80);
              if (seen.has(k)) return;
              seen.add(k);
              deduped.push(p);
            });
            return { posts: deduped };
          } catch (e) { return { error: e?.message || String(e) }; }
        }
      });
      const r = results?.[0]?.result || {};
      if (r.__loginWall) {
        if (!loginWallSeen) {
          console.warn(LOG_TAG, `[StealVoice] @${h} → login wall detected. Log in to x.com in this browser.`);
          loginWallSeen = true;
        }
        break;
      }
      if (Array.isArray(r.posts) && r.posts.length > posts.length) {
        posts = r.posts;
      }
      if (posts.length >= targetCount) break;
    }

    if (loginWallSeen && !posts.length) {
      return { __loginWall: true, posts: [], handle: h };
    }
    posts = posts.slice(0, targetCount);
    console.log(LOG_TAG, `[StealVoice] @${h} → extracted ${posts.length} original post(s)`);
    return { posts, handle: h };
  } finally {
    if (shadowWindow) await closeShadowWindow(shadowWindow);
  }
}
async function stealVoiceFetchPosts(handle, target) {
  return withPollingLock('stealVoice', () => stealVoiceFetchPostsImpl(handle, target));
}

// ─── Scrapers ────────────────────────────────────────────────────────────────

async function pollXWithShadowTab(target, sharedTabId = null) {
    let username = target.url.split('?')[0].split('/').filter(Boolean).pop();
    if (!username) throw new Error("Invalid X URL format.");

    console.log(LOG_TAG, `Launching Zero-Guessing Shadow Engine for @${username}...`);

    let shadowWindow = null;
    let tabId = sharedTabId;
    try {
        if (!tabId) {
            shadowWindow = await openShadowWindow({
                url: `https://x.com/${username}`,
                type: 'popup',
                state: 'normal',
                focused: false,
                width: 500,
                height: 600,
                left: 50,
                top: 50,
            }, `@${username} (X)`);
            tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        } else {
            // Reuse the sweep's shared window — navigate it instead of opening another popup
            await navigateTabAndWait(tabId, `https://x.com/${username}`);
        }
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        
        // Dismiss X's login bottom-sheet / "Don't miss what's happening"
        // banner before scraping — they cover the timeline on fresh sessions.
        await dismissTrackingPopups(tabId);

        // Smart loading: Poll for tweets every 1s for up to 15s
        let tweets = [];
        for (let i = 0; i < 15; i++) {
            await setPulse(`X-Ray: Waiting for @${username} (${i}s)...`);
            if (i > 0 && i % 3 === 0) await dismissTrackingPopups(tabId);
            
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN', // CRITICAL: Run in MAIN world to access window.__INITIAL_STATE__
                func: () => {
                    try {
                        // 1. Gold Source: window.__INITIAL_STATE__ has tweets with created_at
                        // Helper: resolve a tweet id to its entity across the
                        // many shapes the X state can take.
                        const resolveTweet = (allTweets, id) => {
                            if (!id || !allTweets) return null;
                            const direct = allTweets[id];
                            if (direct) return direct;
                            // Some shapes nest as .legacy or .result
                            for (const k of Object.keys(allTweets)) {
                                const v = allTweets[k];
                                if (v?.legacy?.id_str === id) return { ...v.legacy, ...v };
                                if (v?.id_str === id) return v;
                            }
                            return null;
                        };

                        const state = window.__INITIAL_STATE__;
                        if (state && state.entities?.tweets) {
                            const allTweets = state.entities.tweets;
                            return Object.values(allTweets).map(t => {
                                const tw = t.legacy ? { ...t.legacy, ...t } : t;
                                const rtId = tw.retweeted_status_id_str || tw.retweeted_status_id || tw.retweeted_status_result?.result?.rest_id;
                                const qtId = tw.quoted_status_id_str || tw.quoted_status_id;
                                const rt = rtId ? resolveTweet(allTweets, rtId) : (tw.retweeted_status_result?.result ? (tw.retweeted_status_result.result.legacy || tw.retweeted_status_result.result) : null);
                                const qt = qtId ? resolveTweet(allTweets, qtId) : null;
                                const isRepost = !!(rtId || tw.retweeted_status_result || tw.retweeted === true);
                                const isQuote  = !!(qtId || tw.is_quote_status);
                                let originalPost = null;
                                if (rt) {
                                    originalPost = {
                                        text: rt.full_text || rt.text || '',
                                        author: rt.user_screen_name || rt.screen_name || rt.user?.screen_name || null,
                                        timestamp: rt.created_at ? new Date(rt.created_at).getTime() : null
                                    };
                                } else if (qt) {
                                    originalPost = {
                                        text: qt.full_text || qt.text || '',
                                        author: qt.user_screen_name || qt.screen_name || qt.user?.screen_name || null,
                                        timestamp: qt.created_at ? new Date(qt.created_at).getTime() : null
                                    };
                                }
                                // MEDIA — from entities/extended_entities.
                                const mediaArr = (tw.extended_entities?.media || tw.entities?.media || []);
                                const mImgs = mediaArr.map(m => m.media_url_https || m.media_url).filter(Boolean).slice(0, 4);
                                const mHasVideo = mediaArr.some(m => m.type === 'video');
                                const mHasGif = mediaArr.some(m => m.type === 'animated_gif');
                                const media = (mImgs.length || mHasVideo || mHasGif)
                                    ? { images: mImgs, hasVideo: mHasVideo, hasGif: mHasGif, alt: [] } : null;
                                return {
                                    id_str: tw.id_str || t.rest_id,
                                    full_text: tw.full_text || tw.text,
                                    timestamp: tw.created_at ? new Date(tw.created_at).getTime() : null,
                                    isRepost: isRepost || isQuote,
                                    replyRestricted: !!(tw.limited_actions || (tw.conversation_control && tw.conversation_control.policy && String(tw.conversation_control.policy).toLowerCase() !== 'all')),
                                    originalPost,
                                    media
                                };
                            });
                        }

                        // 2. Fallback: DOM scrape — read the <time datetime> inside each tweet
                        const tweetElements = document.querySelectorAll('[data-testid="tweet"], [role="article"]');
                        if (tweetElements.length > 0) {
                            return Array.from(tweetElements).map(t => {
                                const link = t.querySelector('a[href*="/status/"]');
                                const text = t.querySelector('[data-testid="tweetText"]');
                                const timeEl = t.querySelector('time[datetime]');
                                if (!link) return null;
                                const href = link.getAttribute('href') || '';
                                // Canonical id + permalink. A bare /status/ href can be the
                                // analytics (/status/id/analytics) or photo link, so extract the
                                // numeric id from any matching anchor rather than trusting order.
                                const canon = href.match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/)
                                    || Array.from(t.querySelectorAll('a[href*="/status/"]'))
                                        .map(a => (a.getAttribute('href') || '').match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/))
                                        .find(Boolean);
                                const tid = canon ? canon[2] : (href.split('/status/')[1] || '').split(/[/?]/)[0];
                                const canonUrl = canon ? `https://x.com/${canon[1]}/status/${canon[2]}` : (href.startsWith('http') ? href : `https://x.com${href}`);
                                // Repost: the "<name> reposted" social-context label above the tweet.
                                const social = (t.querySelector('[data-testid="socialContext"]')?.innerText || '').toLowerCase();
                                const isRepost = /repost|retweet/.test(social);
                                // Reply restriction
                                const blockText = (t.innerText || '').toLowerCase();
                                const replyRestricted = /can reply\b/.test(blockText) && /(people .* follow|accounts .* mention|only)/.test(blockText);

                                const mainText = text ? text.innerText : '';

                                // MEDIA — images / video / GIF attached to the tweet.
                                const photoEls = Array.from(t.querySelectorAll('[data-testid="tweetPhoto"] img'));
                                const mediaImages = photoEls.map(img => img.getAttribute('src')).filter(Boolean).slice(0, 4);
                                const mediaAlts = photoEls.map(img => (img.getAttribute('alt') || '').trim())
                                    .filter(a => a && a.toLowerCase() !== 'image');
                                const mediaHasVideo = !!t.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
                                const mediaHasGif = !!t.querySelector('[data-testid="gifPlayer"]');
                                const media = (mediaImages.length || mediaHasVideo || mediaHasGif)
                                    ? { images: mediaImages, hasVideo: mediaHasVideo, hasGif: mediaHasGif, alt: mediaAlts.slice(0, 3) }
                                    : null;

                                // ORIGINAL POST capture:
                                //  - Native repost: the visible tweet IS the original.
                                //  - Quote tweet: an embedded card with another tweetText below the main text.
                                let originalPost = null;
                                if (isRepost) {
                                    // Pull author from the social-context handle if present.
                                    const socialHandle = t.querySelector('[data-testid="socialContext"] a[href^="/"]')?.getAttribute('href')?.replace(/^\//, '') || null;
                                    // For native reposts, the main author handle = original author
                                    // (the reposter is named in the social context line).
                                    const mainAuthor = t.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href')?.replace(/^\//, '') || null;
                                    originalPost = {
                                        text: mainText,
                                        author: mainAuthor || socialHandle,
                                        timestamp: timeEl ? new Date(timeEl.getAttribute('datetime')).getTime() : null
                                    };
                                } else {
                                    // Detect quote tweet: a nested embedded tweet card has its own tweetText.
                                    const innerTexts = t.querySelectorAll('[data-testid="tweetText"]');
                                    if (innerTexts.length >= 2) {
                                        const quoted = innerTexts[innerTexts.length - 1];
                                        const quotedHandle = t.querySelector('[role="link"] [data-testid="User-Name"] a[href^="/"]')?.getAttribute('href')?.replace(/^\//, '') || null;
                                        originalPost = {
                                            text: quoted.innerText || '',
                                            author: quotedHandle,
                                            timestamp: null
                                        };
                                    }
                                }

                                return {
                                    id_str: tid,
                                    full_text: (mainText || (media ? (mediaAlts.length ? `[Image] ${mediaAlts.join('. ')}` : '[Image post]') : "New post found")),
                                    post_url: canonUrl,
                                    interactionType: text ? 'Post' : 'Comment',
                                    timestamp: timeEl ? new Date(timeEl.getAttribute('datetime')).getTime() : null,
                                    isRepost: isRepost || !!originalPost,
                                    replyRestricted,
                                    originalPost,
                                    media
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

        // Capture the previous-check time BEFORE the caller updates it. Posts
        // older than this were either already surfaced earlier or existed at
        // first-track time; we never want to dump them into the radar now.
        const previousLastChecked = target.lastChecked || 0;
        let foundNew = 0;
        for (const tweet of tweets) {
            const surface = await shouldSurfacePost({
                dedupKey: `ans_x_${tweet.id_str}`,
                postTimestamp: tweet.timestamp,
                previousLastChecked
            });
            if (surface) {
                foundNew++;
                const postUrl = tweet.post_url || `https://x.com/${username}/status/${tweet.id_str}`;
                saveResult('X', tweet.full_text, `https://x.com/${username}`, target.label, '', postUrl, null, null, null, tweet.interactionType, {
                    isRepost: tweet.isRepost,
                    replyRestricted: tweet.replyRestricted,
                    postTimestamp: tweet.timestamp,
                    originalPost: tweet.originalPost,
                    media: tweet.media
                });
            }
        }
        return foundNew;

    } catch (error) {
        throw error;
    } finally {
        // Await the close so the next iteration in a sweep can't open a
        // second window while this one is still alive.
        if (shadowWindow) await closeShadowWindow(shadowWindow);
    }
}

/**
 * LinkedIn Scraper: Deep URN Fallback
 */
async function pollLinkedIn(target, sharedTabId = null) {
    let profileUrl = target.url.split('?')[0];
    if (!profileUrl.endsWith('/')) profileUrl += '/';
    const activityUrl = profileUrl + 'recent-activity/all/';

    await setPulse(`LinkedIn: Targeting Activity Page for @${target.label}...`);

    let shadowWindow = null;
    let tabId = sharedTabId;
    try {
        if (!tabId) {
            shadowWindow = await openShadowWindow({
                url: activityUrl,
                type: 'popup',
                state: 'normal',
                focused: false,
                width: 500,
                height: 600,
                left: 100,
                top: 100,
            }, `${target.label} (LinkedIn)`);
            tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        } else {
            await navigateTabAndWait(tabId, activityUrl);
        }
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        let posts = [];

        // Kill any LinkedIn upsell/auth modal BEFORE the scrape loop starts.
        // The Premium upsell is the most common blocker — without dismissing
        // it, the feed is hidden and scraping returns 0 posts.
        await dismissTrackingPopups(tabId);

        // Smart Scroll & Capture Loop (Polling for 15s)
        for (let i = 0; i < 15; i++) {
            await setPulse(`LinkedIn: Virtual Scroll @${i}s...`);

            // Re-dismiss every 3 iterations (~3s) — LinkedIn can re-show
            // the upsell after scrolling, especially on a fresh session.
            if (i > 0 && i % 3 === 0) await dismissTrackingPopups(tabId);

            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    window.scrollTo(0, 1000);
                    const elements = document.querySelectorAll('.feed-shared-update-v2, [data-urn*="urn:li:activity:"], [data-id*="urn:li:activity:"]');
                    return Array.from(elements).map(el => {
                        const urn = el.getAttribute('data-urn')
                            || el.getAttribute('data-id')
                            || (el.querySelector('[data-urn*="urn:li:activity:"]')?.getAttribute('data-urn'))
                            || '';
                        // Text: old markup classes first, then the new React
                        // feed's expandable-text-box, then inline show-more.
                        const textEl = el.querySelector(
                            '.update-components-text, .feed-shared-text, ' +
                            '[data-testid="expandable-text-box"], ' +
                            '.feed-shared-inline-show-more-text, ' +
                            '.feed-shared-update-v2__description'
                        );
                        if (!urn || !/urn:li:activity:/.test(urn)) return null;
                        // LinkedIn activity URNs are snowflake-like: high bits encode
                        // a millisecond timestamp starting at a fixed epoch (~2010).
                        // urn:li:activity:NNN where N >> 22 = millis-since-epoch.
                        const id = urn.split(':').pop();
                        let timestamp = null;
                        try {
                            // Use BigInt so we don't lose precision on 19-digit ids
                            const bn = BigInt(id);
                            const LINKEDIN_EPOCH_MS = 1288834974657n; // commonly-cited start of LinkedIn snowflake
                            timestamp = Number((bn >> 22n) + LINKEDIN_EPOCH_MS);
                            // Sanity: drop nonsense values (before 2010 or far in future)
                            if (timestamp < 1262304000000 || timestamp > Date.now() + 86400000) timestamp = null;
                        } catch { /* non-numeric URN — leave null */ }
                        // Fallback: any <time> element inside the post block
                        if (!timestamp) {
                            const t = el.querySelector('time[datetime]');
                            if (t) {
                                const parsed = Date.parse(t.getAttribute('datetime'));
                                if (Number.isFinite(parsed)) timestamp = parsed;
                            }
                        }
                        return {
                            id,
                            // Capture the WHOLE post, not a 200-char preview.
                            text: textEl ? textEl.innerText.substring(0, 3000) : "New LinkedIn Post",
                            url: `https://www.linkedin.com/feed/update/${urn}`,
                            interactionType: textEl?.innerText.length < 150 ? 'Comment' : 'Post',
                            timestamp
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

        const previousLastChecked = target.lastChecked || 0;
        let foundNew = 0;
        for (const post of posts) {
            const surface = await shouldSurfacePost({
                dedupKey: `ans_li_${post.id}`,
                postTimestamp: post.timestamp,
                previousLastChecked
            });
            if (surface) {
                foundNew++;
                saveResult('LinkedIn', post.text, profileUrl, target.label, '', post.url, null, null, null, post.interactionType, { postTimestamp: post.timestamp });
            }
        }
        return foundNew;

    } catch (error) {
        throw error;
    } finally {
        // Await the close so the next iteration in a sweep can't open a
        // second window while this one is still alive.
        if (shadowWindow) await closeShadowWindow(shadowWindow);
    }
}

/**
 * Reddit Scraper (Shadow Engine) — SUBREDDITS ONLY.
 *
 * We track communities (r/name), not individual users. The dashboard's
 * Account Finder enforces this on add, but old configs from before the
 * switch could still contain /user/ URLs. Treat those as a misconfigured
 * tracker and bail with a clear error so the user knows to delete & re-add.
 */
async function pollReddit(target, sharedTabId = null) {
    let rawUrl = target.url.split('?')[0];
    if (rawUrl.endsWith('/')) rawUrl = rawUrl.slice(0, -1);

    if (!rawUrl.includes('/r/')) {
        throw new Error(`Reddit tracking is subreddits-only. "${target.label}" is not a subreddit URL — delete it from the tracking list and re-add as r/name.`);
    }
    // Extract subreddit name for clean logging
    const subMatch = rawUrl.match(/\/r\/([^/?#\s]+)/i);
    const subName = subMatch ? subMatch[1] : target.label;

    // Always poll the /new/ feed — that's where chronologically-fresh
    // posts land. /hot or /top would surface algorithm-ranked content
    // and we want literal "what just got posted".
    const targetUrl = `https://www.reddit.com/r/${subName}/new/`;

    console.log(LOG_TAG, `Reddit X-Ray: Scanning subreddit r/${subName}...`);

    let shadowWindow = null;
    let tabId = sharedTabId;
    try {
        if (!tabId) {
            shadowWindow = await openShadowWindow({
                url: targetUrl,
                type: 'popup',
                state: 'minimized',
                focused: false,
            }, `${target.label} (Reddit)`);
            tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        } else {
            await navigateTabAndWait(tabId, targetUrl);
        }
        if (!tabId) throw new Error("Shadow tab initialization failed.");
        let posts = [];

        // Dismiss Reddit's "Continue in app" splash + signup drawer + cookie
        // wall before scraping. These cover the post list on first load.
        await dismissTrackingPopups(tabId);

        // Smart Scan Loop (15s)
        for (let i = 0; i < 15; i++) {
            await setPulse(`Reddit X-Ray: Loading ${target.label} (${i}s)...`);
            if (i > 0 && i % 3 === 0) await dismissTrackingPopups(tabId);

            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    // Helper: best-effort timestamp from a post element
                    const extractTs = (el) => {
                        // 1. shreddit-post has created-timestamp="<ISO>"
                        const direct = el.getAttribute?.('created-timestamp');
                        if (direct) {
                            const t = Date.parse(direct);
                            if (Number.isFinite(t)) return t;
                        }
                        // 2. Any nested <time datetime>
                        const t = el.querySelector?.('time[datetime]');
                        if (t) {
                            const parsed = Date.parse(t.getAttribute('datetime'));
                            if (Number.isFinite(parsed)) return parsed;
                        }
                        // 3. faceplate-timeago has the ts attribute
                        const fa = el.querySelector?.('faceplate-timeago');
                        if (fa) {
                            const tsAttr = fa.getAttribute('ts') || fa.getAttribute('datetime');
                            const parsed = tsAttr ? Date.parse(tsAttr) : NaN;
                            if (Number.isFinite(parsed)) return parsed;
                        }
                        return null;
                    };

                    const elements = document.querySelectorAll('shreddit-post');
                    if (elements.length === 0) {
                        const feedItems = document.querySelectorAll('[data-testid="post-container"], .Post');
                        return Array.from(feedItems).map(el => {
                            const link = el.querySelector('a[href*="/comments/"]');
                            const title = el.querySelector('h1, h2, [data-adclicklocation="title"]');
                            if (!link) return null;
                            return {
                                id: link.getAttribute('href').split('/comments/')[1]?.split('/')[0],
                                title: title ? title.innerText : "New Reddit Post",
                                url: link.href.startsWith('http') ? link.href : `https://www.reddit.com${link.getAttribute('href')}`,
                                interactionType: title?.innerText.length < 100 ? 'Comment' : 'Post',
                                timestamp: extractTs(el)
                            };
                        }).filter(Boolean);
                    }

                    return Array.from(elements).slice(0, 10).map(el => {
                        const permalink = el.getAttribute('permalink');
                        const id = el.getAttribute('id');
                        const title = el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.innerText;
                        const bodyEl = el.querySelector('[slot="text-body"], .md, [data-click-id="text"]');
                        const body = bodyEl ? bodyEl.innerText.trim() : '';
                        if (!permalink) return null;
                        return {
                            id: id || permalink.split('/comments/')[1]?.split('/')[0],
                            title: title || "New Reddit Post",
                            body,
                            url: `https://www.reddit.com${permalink}`,
                            interactionType: (title?.length + body?.length) < 150 ? 'Comment' : 'Post',
                            timestamp: extractTs(el)
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

        if (posts.length === 0) throw new Error(`No posts found in r/${subName}. Is the subreddit public?`);

        const previousLastChecked = target.lastChecked || 0;
        let foundNew = 0;
        for (const post of posts) {
            const surface = await shouldSurfacePost({
                dedupKey: `ans_rd_${post.id}`,
                postTimestamp: post.timestamp,
                previousLastChecked
            });
            if (surface) {
                foundNew++;
                // Subreddit tracking: every item is a community post. The
                // "creator" surfaced in the radar is the subreddit name
                // (target.label) since posters within a sub vary.
                saveResult('Reddit', post.title, targetUrl, target.label, post.body || '', post.url, null, null, null, 'Post', { postTimestamp: post.timestamp });
            }
        }
        return foundNew;

    } catch (error) {
        throw error;
    } finally {
        // Await the close so the next iteration in a sweep can't open a
        // second window while this one is still alive.
        if (shadowWindow) await closeShadowWindow(shadowWindow);
    }
}

// ─── Utils ──────────────────────────────────────────────────────────────────

/**
 * Product Hunt Scraper
 * Uses GraphQL inside a shadow tab to bypass advanced bot protection.
 */
async function pollProductHunt(target, sharedTabId = null) {
    await setPulse(`PH X-Ray: Scanning discussions...`);

    let shadowWindow = null;
    let tabId = sharedTabId;
    try {
        if (!tabId) {
            shadowWindow = await openShadowWindow({
                url: 'https://www.producthunt.com/discussions',
                type: 'popup',
                state: 'minimized',
                focused: false,
            }, 'Product Hunt');
            tabId = shadowWindow.tabs?.[0]?.id || (await chrome.tabs.query({ windowId: shadowWindow.id }))[0]?.id;
        } else {
            await navigateTabAndWait(tabId, 'https://www.producthunt.com/discussions');
        }
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
        // Await the close so the next iteration in a sweep can't open a
        // second window while this one is still alive.
        if (shadowWindow) await closeShadowWindow(shadowWindow);
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

// ─── Surface-filter for chronic tracking ────────────────────────────
// Decides whether a scraped post should appear in the radar.
//
// We deliberately DO NOT gate on the per-id "seen" store (isNewItem) for
// dated posts. That store was historically polluted: older builds recorded
// EVERY scraped post as "seen" even when they were never surfaced, which
// permanently suppressed real posts for already-tracked accounts. Instead we
// surface by recency and let saveResult() dedup by postUrl (idempotent), so
// running this every poll never creates duplicates but always shows recent
// activity — including for accounts tracked before this fix.
const SURFACE_RECENCY_MS = 2 * 24 * 60 * 60 * 1000; // surface posts from the last 2 days

async function shouldSurfacePost({ dedupKey, postTimestamp }) {
  // Dated post: surface if it was published within the recency window.
  if (Number.isFinite(postTimestamp)) {
    return postTimestamp > (Date.now() - SURFACE_RECENCY_MS);
  }
  // Undated post (timestamp couldn't be parsed): show it once, guarded by the
  // per-id store so a pinned/old undated post doesn't reappear every poll.
  return await isNewItem(dedupKey);
}

async function saveResult(platform, text, url, creator, body = '', postUrl = '', campaignId = null, campaignName = null, intent = null, interactionType = 'Post', meta = {}) {
    // NOTE: No "competitor"/conflict keyword filtering here. saveResult is the
    // tracked-account path — these are accounts the user EXPLICITLY chose to
    // watch, so every post must surface. (The old V4 triage filter discarded
    // any post whose creator/text contained common words like "solution",
    // "service", "partner", "group", "expert"… which silently swallowed most
    // tracked posts. Conflict triage belongs to the recon/lead path only.)
    const res = await chrome.storage.local.get(['answerly_history', 'answerly_removed_posts']);
    const history = res.answerly_history || [];
    const removed = res.answerly_removed_posts || [];

    const dedupeUrl = postUrl || url;
    // Idempotent: never surface the same post twice. The recency-based filter
    // re-evaluates posts on every poll, so dedup here by the post's unique URL.
    if (history.some(h => (h.postUrl || h.url) === dedupeUrl)) {
        return; // already in the radar
    }
    // Respect deletions: if the user removed this post, don't bring it back.
    if (removed.includes(dedupeUrl)) {
        return;
    }

    const isRepost = !!meta.isRepost;
    const replyRestricted = !!meta.replyRestricted;
    // Use the post's ACTUAL publish time if the scraper captured one, so the UI
    // shows "3h ago" rather than "Just now" for everything. Fall back to now.
    const publishTs = Number.isFinite(meta.postTimestamp) && meta.postTimestamp > 0
        ? new Date(meta.postTimestamp).toISOString()
        : new Date().toISOString();
    history.unshift({
        platform,
        text,
        body,
        url,
        creator,
        postUrl: postUrl || url,
        timestamp: publishTs,
        capturedAt: new Date().toISOString(),
        uuid: 'ans_' + Date.now() + Math.random(),
        campaignId,
        campaignName,
        intent,
        interactionType,
        isRepost,
        replyRestricted,
        // Original post (for reposts) — passed through from the scraper.
        originalPost: meta.originalPost || null,
        // Attached media (images / video) — passed through from the scraper.
        media: meta.media || null
    });
    // Limit to 100 items for better triage visibility
    await chrome.storage.local.set({ answerly_history: history.slice(0, 100) });
    console.log(LOG_TAG, `[Tracking] ✓ Surfaced new post → radar: ${creator} (${platform})${isRepost ? ' [repost]' : ''}${replyRestricted ? ' [replies restricted]' : ''} — "${(text || '').slice(0, 60)}"`);

    // Auto-reply hook — generates a DRAFT for review only if the user turned on
    // per-account auto-reply. Safe to call unconditionally; it exits silently
    // in all gating cases (not opted in, repost, restricted, dup).
    maybeQueueAutoComment({
      platform, text, body, url, creator, postUrl: postUrl || url,
      isRepost, replyRestricted,
      originalPost: meta.originalPost || null,
      relevance: undefined
    }).catch(e => console.warn(LOG_TAG, '[AutoReply] hook failed:', e));
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
                                    let postText = tweetTextEl ? tweetTextEl.innerText.slice(0, 2000) : "";

                                    // Build a CANONICAL post URL. A bare /status/ link can be
                                    // the analytics (/status/id/analytics), photo (/status/id/photo/1),
                                    // or quote link — opening those lands on the wrong page. Pull the
                                    // handle + numeric status id out of any matching href and rebuild
                                    // the clean permalink so the tracker link always opens the post.
                                    const allLinks = Array.from(t.querySelectorAll('a[href*="/status/"]'));
                                    let postUrl = `https://x.com/${username}`;
                                    for (const a of allLinks) {
                                        const href = a.getAttribute('href') || '';
                                        const m = href.match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
                                        if (m) { postUrl = `https://x.com/${m[1]}/status/${m[2]}`; break; }
                                    }

                                    // MEDIA — images / video / GIF so image posts aren't lost.
                                    const photoEls = Array.from(t.querySelectorAll('[data-testid="tweetPhoto"] img'));
                                    const images = photoEls.map(img => img.getAttribute('src')).filter(Boolean).slice(0, 4);
                                    const photoAlts = photoEls.map(img => (img.getAttribute('alt') || '').trim())
                                        .filter(a => a && a.toLowerCase() !== 'image');
                                    const hasVideo = !!t.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
                                    const hasGif = !!t.querySelector('[data-testid="gifPlayer"]');
                                    const media = (images.length || hasVideo || hasGif)
                                        ? { images, hasVideo, hasGif, alt: photoAlts.slice(0, 3) } : null;

                                    // REPOST / QUOTE — capture the original post for context.
                                    const social = (t.querySelector('[data-testid="socialContext"]')?.innerText || '').toLowerCase();
                                    const isRepost = /repost|retweet/.test(social);
                                    let originalPost = null;
                                    if (isRepost) {
                                        originalPost = { text: postText.slice(0, 1000), author: username, timestamp: null };
                                    } else {
                                        const innerTexts = t.querySelectorAll('[data-testid="tweetText"]');
                                        if (innerTexts.length >= 2) {
                                            const quoted = innerTexts[innerTexts.length - 1];
                                            const quotedHandle = t.querySelector('[role="link"] [data-testid="User-Name"] a[href^="/"]')
                                                ?.getAttribute('href')?.replace(/^\//, '') || null;
                                            originalPost = { text: (quoted.innerText || '').trim().slice(0, 1000), author: quotedHandle, timestamp: null };
                                        }
                                    }
                                    if (!postText && media) {
                                        postText = photoAlts.length ? `[Image] ${photoAlts.join('. ')}`.slice(0, 1000) : '[Image post]';
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
                                        platform: 'X',
                                        media,
                                        isRepost: isRepost || !!originalPost,
                                        originalPost
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
    // Mutex: legacy ICP-recon engine must yield to a running discovery mission.
    if (await isDiscoveryActive()) {
        console.log(LOG_TAG, 'Recon trickle deferred — discovery mission in progress');
        currentReconTimeout = setTimeout(() => processNextReconKeyword(), 60000);
        return;
    }

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
