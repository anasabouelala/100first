/**
 * Answerly Meta-Radar Popup Logic
 * Premium Dashboard Edition
 */

document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();

    // Sync button (Force Check)
    document.getElementById('syncNow').addEventListener('click', async () => {
        const btn = document.getElementById('syncNow');
        const originalText = btn.textContent;
        btn.textContent = 'Syncing...';
        btn.disabled = true;
        
        // 1. Force bridge to sync from app localStorage
        chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: 'FORCE_BRIDGE_SYNC' });
            });
        });

        // 2. Trigger scan after a short delay to let sync complete
        setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'forceCheck' }, (response) => {
                btn.textContent = originalText;
                btn.disabled = false;
                updateDashboard();
            });
        }, 1500);
    });

    // Show/Hide Diagnostics
    document.getElementById('showLogs').addEventListener('click', () => {
        const diag = document.getElementById('diagnostics');
        const isHidden = diag.style.display === 'none' || diag.style.display === '';
        diag.style.display = isHidden ? 'block' : 'none';
        if (isHidden) renderDiagnostics();
    });

    // Reset Engine
    document.getElementById('resetEngine').addEventListener('click', () => {
        if (confirm("Reset stealth engine state?")) {
            chrome.runtime.sendMessage({ action: 'resetEngine' }, (response) => {
                updateDashboard();
            });
        }
    });

    // Refresh loop
    setInterval(updateDashboard, 5000);
});

async function updateDashboard() {
    const res = await chrome.storage.local.get([
        'answerly_history',
        'pipeline_leads',
        'answerly_engagements',
        'answerly_creator_configs',
        'answerly_backoff_until',
        'answerly_engine_pulse',
        'answerly_diagnostic'
    ]);

    const history = res.answerly_history || [];
    const leads = res.pipeline_leads || [];
    const engagements = res.answerly_engagements || 0;
    const configs = res.answerly_creator_configs || [];
    const backoffUntil = res.answerly_backoff_until || 0;
    const pulse = res.answerly_engine_pulse || { msg: 'Idle' };

    // 1. Update KPIs
    const kpiLeads = document.getElementById('kpi-leads');
    const kpiSignals = document.getElementById('kpi-signals');
    const kpiEngagements = document.getElementById('kpi-engagements');
    const kpiHealth = document.getElementById('kpi-health');
    
    kpiLeads.textContent = leads.length;
    kpiSignals.textContent = history.length;
    kpiEngagements.textContent = engagements;
    
    // Health: Ratio of qualified leads to total scanned signals
    const healthPercent = history.length > 0 ? Math.min(100, Math.round((leads.length / history.length) * 100)) : 0;
    kpiHealth.textContent = healthPercent + "%";

    // 2. Engine Status & Pulse
    const statusEl = document.getElementById('engineStatus');
    const pulseEl = document.getElementById('enginePulse');
    const noticeEl = document.getElementById('backoffNotice');
    const timerEl = document.getElementById('backoffTimer');

    pulseEl.textContent = pulse.msg;

    if (Date.now() < backoffUntil) {
        statusEl.textContent = 'Engine Sleeping';
        statusEl.style.color = 'var(--warning)';
        noticeEl.style.display = 'block';
        const mins = Math.ceil((backoffUntil - Date.now()) / 60000);
        timerEl.textContent = mins;
    } else {
        statusEl.textContent = configs.length > 0 ? 'Engine Active' : 'Waiting for Config';
        statusEl.style.color = configs.length > 0 ? 'var(--accent)' : 'var(--text-muted)';
        noticeEl.style.display = 'none';
    }

    // 3. Update Intelligence Pulse (History)
    renderPulse(history);

    // 4. Update Engine Dots
    updateEngineDots(configs);

    // 5. Sync Time
    if (res.answerly_diagnostic?.lastRuns?.length > 0) {
        const lastRun = res.answerly_diagnostic.lastRuns[0];
        document.getElementById('check-time').textContent = `Synced ${formatRelativeTime(lastRun.time)}`;
    } else {
        document.getElementById('check-time').textContent = "Ready for scan";
    }
}

function renderPulse(history) {
    const list = document.getElementById('insight-list');
    if (history.length === 0) {
        list.innerHTML = '<div class="empty-state">No signals detected yet. Radar active...</div>';
        return;
    }

    // Convert history into strategic insights
    const insights = history.slice(0, 4).map(item => {
        let icon = '📡';
        if (item.platform === 'X') icon = '🐦';
        if (item.platform === 'LinkedIn') icon = '💼';
        if (item.platform === 'Reddit') icon = '🤖';

        return `
            <li class="insight-item" style="cursor: pointer;" onclick="window.open('${item.url}', '_blank')">
                <div class="insight-icon">${icon}</div>
                <div class="insight-content">
                    <div class="insight-text">${item.creator}: ${item.text.substring(0, 60)}...</div>
                    <div class="insight-meta">${item.platform} signal • ${formatRelativeTime(item.timestamp)}</div>
                </div>
            </li>
        `;
    });

    list.innerHTML = insights.join('');
}

function updateEngineDots(configs) {
    const activePlatforms = new Set(configs.map(c => c.platform));
    const dots = document.querySelectorAll('.engine-dot');
    
    dots.forEach(dot => {
        const label = dot.getAttribute('data-label');
        let plat = label;
        if (label === 'YT') plat = 'YouTube';
        if (label === 'PH') plat = 'Product Hunt';

        if (activePlatforms.has(plat)) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

async function renderDiagnostics() {
    const res = await chrome.storage.local.get(['answerly_diagnostic', 'answerly_creator_configs']);
    const diag = res.answerly_diagnostic || { lastRuns: [], errors: [] };
    const configs = res.answerly_creator_configs || [];
    
    const errList = document.getElementById('errorList');
    const confList = document.getElementById('configList');
    
    errList.innerHTML = diag.errors.length === 0 
        ? '<div style="color:var(--accent);">No active errors. System healthy.</div>'
        : diag.errors.map(e => `<div style="color:var(--error); margin-bottom:4px;">[${e.label}] ${e.error}</div>`).join('');

    confList.innerHTML = configs.length === 0 
        ? 'None' 
        : configs.map(c => `
            <div class="diag-item">
                <div style="font-weight:600;">${c.label} (${c.platform})</div>
                <div style="opacity:0.6; font-size:9px;">Last check: ${c.lastChecked ? new Date(c.lastChecked).toLocaleTimeString() : 'Never'}</div>
            </div>
        `).join('');
}

function formatRelativeTime(isoString) {
    const now = new Date();
    const then = new Date(isoString);
    const diff = Math.floor((now - then) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return then.toLocaleDateString();
}
