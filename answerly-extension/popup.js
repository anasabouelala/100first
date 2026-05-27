/**
 * Answerly · Account Finder popup
 *
 * Reads `discovery_mission_state` (the live mission written by
 * discovery_engine.js) and renders a console of: status, progress,
 * stats, tier breakdown, per-platform health, and a live activity feed.
 *
 * Polls every 2s while open. Cheap — storage.local reads are local.
 */

const POLL_MS = 2000;

document.addEventListener('DOMContentLoaded', () => {
    render();

    document.getElementById('openApp').addEventListener('click', () => {
        // Open the full app in a new tab. We prefer an already-open localhost
        // tab; otherwise we open a fresh one. Falls back to chrome://newtab.
        chrome.tabs.query({ url: ['http://localhost/*', 'http://127.0.0.1/*'] }, (tabs) => {
            const existing = tabs.find(t => t.url && /localhost|127\.0\.0\.1/.test(t.url));
            if (existing) {
                chrome.tabs.update(existing.id, { active: true });
                chrome.windows.update(existing.windowId, { focused: true });
            } else {
                chrome.tabs.create({ url: 'http://localhost:3000/' });
            }
            window.close();
        });
    });

    document.getElementById('scanNow').addEventListener('click', async () => {
        const btn = document.getElementById('scanNow');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Triggering…';
        // Force a bridge sync (so the extension picks up the latest mission
        // config from the app) then nudge the legacy "forceCheck" so the
        // engagement engine also ticks.
        chrome.tabs.query({ url: ['http://localhost/*', 'http://127.0.0.1/*'] }, (tabs) => {
            tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'FORCE_BRIDGE_SYNC' }, () => void chrome.runtime.lastError));
        });
        setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'forceCheck' }, () => {
                btn.disabled = false;
                btn.textContent = original;
                render();
            });
        }, 1200);
    });

    document.getElementById('pauseResume').addEventListener('click', async () => {
        const m = await readMission();
        if (!m) return;
        const action = (m.status === 'paused') ? 'DISCOVERY_RESUME' : 'DISCOVERY_PAUSE';
        chrome.runtime.sendMessage({ action }, () => render());
    });

    document.getElementById('showLogs').addEventListener('click', () => {
        const d = document.getElementById('diagnostics');
        const isHidden = d.style.display === 'none' || d.style.display === '';
        d.style.display = isHidden ? 'block' : 'none';
        if (isHidden) renderDiagnostics();
    });

    document.getElementById('resetEngine').addEventListener('click', () => {
        if (!confirm('Reset stealth engine state? This clears the cooldown timer and rate-limit counters.')) return;
        chrome.runtime.sendMessage({ action: 'resetEngine' }, () => render());
    });

    setInterval(render, POLL_MS);
});

async function readMission() {
    const r = await chrome.storage.local.get(['discovery_mission_state']);
    return r.discovery_mission_state || null;
}

async function render() {
    const r = await chrome.storage.local.get([
        'discovery_mission_state',
        'answerly_backoff_until',
        'answerly_creator_configs',
        'answerly_diagnostic'
    ]);
    const m = r.discovery_mission_state;
    const backoffUntil = r.answerly_backoff_until || 0;

    renderStatus(m, backoffUntil);
    renderMissionCard(m);
    renderStats(m);
    renderTiers(m);
    renderPlatforms(m, r.answerly_creator_configs || []);
    renderFooter(m, r.answerly_diagnostic);
}

// ── STATUS PILL ───────────────────────────────────────────────────
function renderStatus(m, backoffUntil) {
    const pill = document.getElementById('missionStatus');
    const text = document.getElementById('missionStatusText');
    const cooldown = document.getElementById('cooldownNotice');
    const cooldownTimer = document.getElementById('cooldownTimer');

    // Reset classes
    pill.className = 'status-pill idle';
    cooldown.style.display = 'none';

    if (Date.now() < backoffUntil) {
        pill.className = 'status-pill cooldown';
        text.textContent = 'Cooldown';
        cooldown.style.display = 'block';
        const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
        cooldownTimer.textContent = `${mins} min`;
        return;
    }

    if (!m) {
        text.textContent = 'Idle';
        return;
    }

    const status = m.status || 'idle';
    if (['scanning', 'preparing'].includes(status)) {
        pill.className = 'status-pill active';
        text.textContent = status === 'preparing' ? 'Preparing' : 'Scanning';
    } else if (status === 'cooldown') {
        pill.className = 'status-pill cooldown';
        text.textContent = 'Cooldown';
    } else if (status === 'paused') {
        pill.className = 'status-pill cooldown';
        text.textContent = 'Paused';
    } else if (status === 'failed' || status === 'aborted') {
        pill.className = 'status-pill failed';
        text.textContent = status === 'failed' ? 'Failed' : 'Stopped';
    } else if (status === 'completed') {
        pill.className = 'status-pill active';
        text.textContent = 'Completed';
    } else {
        text.textContent = 'Idle';
    }
}

// ── MISSION CARD ──────────────────────────────────────────────────
function renderMissionCard(m) {
    const name = document.getElementById('missionName');
    const platform = document.getElementById('missionPlatform');
    const phase = document.getElementById('missionPhase');
    const fill = document.getElementById('missionProgressFill');
    const progressText = document.getElementById('missionProgressText');
    const pauseBtn = document.getElementById('pauseResume');

    if (!m) {
        name.textContent = 'No active mission';
        platform.textContent = '';
        phase.textContent = 'Open the app to start a mission.';
        fill.style.width = '0%';
        progressText.textContent = '0 / 0 matches';
        pauseBtn.disabled = true;
        return;
    }

    name.textContent = m.name || 'Discovery mission';
    platform.textContent = m.progress?.currentPlatform || '';
    phase.textContent = m.progress?.phase || (m.status === 'idle' ? '—' : 'Running…');

    const matched = m.progress?.matched || 0;
    const target = m.targetMatches || 0;
    const pct = target > 0 ? Math.min(100, Math.round((matched / target) * 100)) : 0;
    fill.style.width = pct + '%';
    progressText.textContent = target > 0 ? `${matched} / ${target} matches (${pct}%)` : `${matched} matches`;

    pauseBtn.disabled = !['scanning', 'preparing', 'paused', 'cooldown'].includes(m.status);
    pauseBtn.textContent = m.status === 'paused' ? 'Resume' : 'Pause';
}

// ── STATS GRID ────────────────────────────────────────────────────
function renderStats(m) {
    const scanned = document.getElementById('statScanned');
    const verified = document.getElementById('statVerified');
    const queueSub = document.getElementById('statQueueSub');

    if (!m) {
        scanned.textContent = '0';
        verified.textContent = '0';
        queueSub.textContent = '0 in queue';
        return;
    }

    scanned.textContent = (m.progress?.candidatesScanned || 0).toString();
    // "Verified" = entries that finished a profile visit (verificationStatus: verified|incomplete).
    // We count by what's actually in results so the popup mirrors what the
    // user sees in the app's account list — not just `matched` which is
    // incremented before the result is finalized.
    const results = m.results || [];
    const verifiedCount = results.filter(r => r.verificationStatus === 'verified' || r.verificationStatus === 'incomplete' || (r.verificationStatus === undefined && r.enriched)).length;
    verified.textContent = verifiedCount.toString();
    const queueLen = (m.pendingProfileQueue || []).length;
    queueSub.textContent = queueLen === 1 ? '1 in queue' : `${queueLen} in queue`;
}

// ── TIER BREAKDOWN ────────────────────────────────────────────────
function renderTiers(m) {
    const counts = { S: 0, A: 0, B: 0, C: 0 };
    (m?.results || []).forEach(r => { if (counts[r.tier] !== undefined) counts[r.tier]++; });
    document.getElementById('tierS').textContent = counts.S;
    document.getElementById('tierA').textContent = counts.A;
    document.getElementById('tierB').textContent = counts.B;
    document.getElementById('tierC').textContent = counts.C;
}

// ── PLATFORM HEALTH ───────────────────────────────────────────────
// State per platform comes from two sources:
//   - mission.stealth.detected + last logs (for blocked / login-wall)
//   - mission.progress.currentPlatform (for "active")
//   - presence in tracked configs (for "tracking" baseline)
function renderPlatforms(m, configs) {
    const platforms = ['X', 'LinkedIn', 'Reddit'];
    const trackedPlatforms = new Set(configs.map(c => c.platform));
    const active = m?.progress?.currentPlatform;

    // Walk recent logs once, pick out per-platform "blocked"/"login" hints
    const recentLogs = (m?.logs || []).slice(-50);
    const blocked = new Set();
    for (const l of recentLogs) {
        if (l.platform && (l.level === 'error') && /login required|blocked|captcha|suspended/i.test(l.message || '')) {
            blocked.add(l.platform);
        }
    }

    platforms.forEach(p => {
        const chip = document.querySelector(`.platform-chip[data-platform="${p}"]`);
        if (!chip) return;
        const stateEl = chip.querySelector('.platform-state');
        chip.classList.remove('ok', 'idle', 'blocked');

        if (blocked.has(p)) {
            chip.classList.add('blocked');
            stateEl.textContent = 'Blocked';
        } else if (active === p) {
            chip.classList.add('ok');
            stateEl.textContent = 'Active';
        } else if (trackedPlatforms.has(p)) {
            chip.classList.add('ok');
            stateEl.textContent = 'Ready';
        } else {
            chip.classList.add('idle');
            stateEl.textContent = 'Idle';
        }
    });
}


// ── DIAGNOSTICS DRAWER ────────────────────────────────────────────
async function renderDiagnostics() {
    const r = await chrome.storage.local.get(['answerly_diagnostic', 'answerly_creator_configs']);
    const diag = r.answerly_diagnostic || { lastRuns: [], errors: [] };
    const configs = r.answerly_creator_configs || [];

    const errList = document.getElementById('errorList');
    const confList = document.getElementById('configList');

    errList.innerHTML = (diag.errors || []).length === 0
        ? '<div style="color: var(--success); font-weight: 700;">No active errors</div>'
        : (diag.errors || []).slice(0, 5).map(e => `<div class="diag-item" style="color: var(--error);">[${escapeHtml(e.label || '?')}] ${escapeHtml(e.error || '')}</div>`).join('');

    confList.innerHTML = configs.length === 0
        ? '<div style="color: var(--text-mute);">None tracked yet — track accounts from the app.</div>'
        : configs.slice(0, 8).map(c => `
            <div class="diag-item">
              <div style="font-weight: 700; color: var(--text);">${escapeHtml(c.label || c.handle || '?')} <span style="color: var(--text-mute); font-weight: 600;">(${escapeHtml(c.platform || '?')})</span></div>
              <div style="color: var(--text-mute);">Last check: ${c.lastChecked ? new Date(c.lastChecked).toLocaleTimeString() : 'Never'}</div>
            </div>
        `).join('');
}

// ── FOOTER ────────────────────────────────────────────────────────
function renderFooter(m, diagnostic) {
    const last = document.getElementById('lastSync');
    if (diagnostic?.lastRuns?.length > 0) {
        last.textContent = `Last scan ${formatRel(diagnostic.lastRuns[0].time)}`;
    } else if (m?.status === 'idle' || !m) {
        last.textContent = 'Ready';
    } else {
        last.textContent = m.status;
    }
}

// ── UTILS ─────────────────────────────────────────────────────────
function formatRel(isoOrMs) {
    if (!isoOrMs) return '';
    const t = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
    if (!isFinite(t)) return '';
    const diff = Math.floor((Date.now() - t) / 1000);
    if (diff < 5)     return 'now';
    if (diff < 60)    return `${diff}s`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return new Date(t).toLocaleDateString();
}

function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
