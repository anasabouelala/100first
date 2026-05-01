/**
 * Answerly Content Bridge
 * Runs on the SaaS domain to relay configuration changes to the extension.
 */

console.log("[Answerly Bridge] Active.");

// 0. Listen for Extension -> App pushes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.pipeline_leads) {
            console.log("[Answerly Bridge] Leads updated in storage, pushing to app...");
            window.dispatchEvent(new CustomEvent('pipeline_leads_update', { detail: changes.pipeline_leads.newValue }));
        }
        if (changes.answerly_history) {
            window.dispatchEvent(new CustomEvent('answerly_history_update', { detail: changes.answerly_history.newValue }));
        }
        if (changes.answerly_engine_pulse) {
            window.dispatchEvent(new CustomEvent('answerly_pulse_update', { detail: changes.answerly_engine_pulse.newValue }));
        }
    }
});

// 1. Sync on load
syncToExtension();

// 2. Listen for React events
window.addEventListener('answerly_sync', (event) => {
    console.log("[Answerly Bridge] Syncing new configuration...");
    syncToExtension(event.detail);
});

// Listen for forced sync from extension popup
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'FORCE_BRIDGE_SYNC') {
        console.log("[Answerly Bridge] Forced sync requested from Popup.");
        syncToExtension();
    }
});

// 3. Heartbeat for UI
window.addEventListener('answerly_ping', () => {
    window.dispatchEvent(new CustomEvent('answerly_pong'));
});

// 4. History Request (From App to Extension)
window.addEventListener('answerly_request_history', () => {
    chrome.storage.local.get(['answerly_history', 'pipeline_leads'], (result) => {
        const history = result.answerly_history || [];
        const leads = result.pipeline_leads || [];
        window.dispatchEvent(new CustomEvent('answerly_history_update', { detail: history }));
        window.dispatchEvent(new CustomEvent('pipeline_leads_update', { detail: leads }));
    });
});

// 4.5 ICP Recon Pulse (From App to Extension)
window.addEventListener('answerly_recon_pulse', (event) => {
    console.log("[Answerly Bridge] Recon pulse detected! Relaying to Engine...");
    try {
        chrome.runtime.sendMessage({ 
            action: 'performReconSearch', 
            keywords: event.detail.keywords,
            platforms: event.detail.platforms,
            campaign: event.detail.campaign // Pass full campaign for intelligence scoring
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Answerly Bridge] Extension connection failed:", chrome.runtime.lastError.message);
                return;
            }
            if (!response?.success) {
                console.error("[Answerly Bridge] Extension Engine Error:", response?.error, response?.stack);
            } else {
                console.log("[Answerly Bridge] Engine confirmed recon mission.", response);
            }
            if (response) response.campaignId = event.detail.campaignId;
            window.dispatchEvent(new CustomEvent('answerly_recon_complete', { detail: response }));
        });
    } catch (e) {
        if (e.message.includes('Extension context invalidated')) {
            console.error("[Answerly Bridge] Extension reloaded. Please refresh the dashboard page!");
            alert("Answerly Extension was updated or reloaded. Please refresh this page (F5) to reconnect.");
            window.dispatchEvent(new CustomEvent('answerly_recon_complete', { detail: { success: false, error: 'Context invalidated' } }));
        } else {
            console.error("[Answerly Bridge] Unexpected error:", e);
        }
    }
});

// 4.6 Stealth Engagement Bridge (Like / Comment buttons in the pipeline)
window.addEventListener('pipeline_queue_engagement', (event) => {
    const lead = event.detail?.lead;
    if (!lead || !lead.url) return;
    relayEngagement(lead);
});

// Bridge specific request types from PipelineView.tsx
window.addEventListener('pipeline_request_like', (event) => {
    const { url } = event.detail;
    if (!url) return;
    relayEngagement({ url, actionType: 'like' });
});

window.addEventListener('pipeline_request_comment', (event) => {
    const { url, comment } = event.detail;
    if (!url) return;
    relayEngagement({ url, actionType: 'comment', commentText: comment });
});

function relayEngagement(lead) {
    console.log("[Answerly Bridge] Engagement queued:", lead.url, lead.actionType);
    chrome.runtime.sendMessage({ action: 'QUEUE_FOR_ENGAGEMENT', lead }, (response) => {
        console.log("[Answerly Bridge] Background confirmed:", response);
    });
}

// 5. Periodic Poll (Backup)
setInterval(syncToExtension, 10000);

function syncToExtension(providedData = null) {
    let dataToSync = providedData;
    
    if (!dataToSync) {
        const raw = localStorage.getItem('answerly_creator_configs');
        if (raw) {
            try {
                dataToSync = JSON.parse(raw);
            } catch (e) {
                console.warn("[Answerly Bridge] Failed to parse local config.");
            }
        }
    }

    if (dataToSync) {
        chrome.storage.local.set({ answerly_creator_configs: dataToSync }, () => {
            if (chrome.runtime.lastError) {
                console.error("[Answerly Bridge] Storage sync failed:", chrome.runtime.lastError);
            }
        });
    }
}
