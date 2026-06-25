/**
 * Viraholic Companion · popup
 *
 * Intentionally minimal. The popup is just an entry point into the
 * dashboard — it does not duplicate the dashboard's stats. CWS reviewers
 * approve simple, single-purpose popups much faster than data-heavy ones.
 *
 * It does three things:
 *   1) Shows whether a dashboard tab is currently reachable on localhost.
 *   2) Opens (or focuses) the dashboard tab.
 *   3) Lets the user pause/resume background monitoring of tracked accounts.
 */

const DASHBOARD_PORTS = ['3000', '3001', '3002'];
const DASHBOARD_DEFAULT = 'https://viraholic.com/';
const HELP_URL = 'https://viraholic.com/'; // points to the in-app help page once auth is set up
const STORAGE_WATCH_KEY = 'lv_companion_watch_enabled';

document.addEventListener('DOMContentLoaded', () => {
  refreshStatus();
  setInterval(refreshStatus, 2000);

  document.getElementById('openApp').addEventListener('click', openDashboard);
  document.getElementById('watchToggle').addEventListener('click', toggleWatch);
  document.getElementById('watchToggle').addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleWatch(); }
  });
  document.getElementById('helpLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: HELP_URL });
    window.close();
  });

  loadWatchState();
});

// ── Connection status ───────────────────────────────────────────────
async function refreshStatus() {
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({}, (all) => resolve(all || []));
  });
  const dashboardTab = tabs.find(t =>
    t.url && (DASHBOARD_PORTS.some(p => t.url.startsWith(`http://localhost:${p}/`) || t.url.startsWith(`http://127.0.0.1:${p}/`)) || t.url.startsWith('https://viraholic.com/') || t.url.includes('.viraholic.com/'))
  );

  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const sub = document.getElementById('statusSub');

  if (dashboardTab) {
    dot.className = 'status-dot connected';
    text.textContent = 'Dashboard connected';
    sub.textContent = 'New replies will be drafted automatically.';
  } else {
    dot.className = 'status-dot idle';
    text.textContent = 'Dashboard not open';
    sub.textContent = 'Open the dashboard to start drafting replies.';
  }
}

// ── Open / focus the dashboard ──────────────────────────────────────
function openDashboard() {
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find(t =>
      t.url && (DASHBOARD_PORTS.some(p => t.url.startsWith(`http://localhost:${p}/`) || t.url.startsWith(`http://127.0.0.1:${p}/`)) || t.url.startsWith('https://viraholic.com/') || t.url.includes('.viraholic.com/'))
    );
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
      chrome.windows.update(existing.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: DASHBOARD_DEFAULT });
    }
    window.close();
  });
}

// ── Watch toggle ────────────────────────────────────────────────────
async function loadWatchState() {
  try {
    const r = await chrome.storage.local.get([STORAGE_WATCH_KEY]);
    const on = r[STORAGE_WATCH_KEY] !== false; // default to on
    paintToggle(on);
  } catch { paintToggle(true); }
}

async function toggleWatch() {
  const el = document.getElementById('watchToggle');
  const next = !el.classList.contains('on');
  paintToggle(next);
  try {
    await chrome.storage.local.set({ [STORAGE_WATCH_KEY]: next });
    // Notify the service worker so it actually pauses / resumes its alarms.
    chrome.runtime.sendMessage({ action: next ? 'COMPANION_RESUME' : 'COMPANION_PAUSE' }, () => void chrome.runtime.lastError);
  } catch (e) {
    console.warn('[Companion] toggle failed:', e);
  }
  // Update the status row to reflect the paused state.
  const dot = document.getElementById('statusDot');
  const sub = document.getElementById('statusSub');
  if (!next) {
    dot.className = 'status-dot paused';
    sub.textContent = 'Monitoring paused. Re-enable to resume drafting.';
  } else {
    refreshStatus();
  }
}

function paintToggle(on) {
  const el = document.getElementById('watchToggle');
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}
