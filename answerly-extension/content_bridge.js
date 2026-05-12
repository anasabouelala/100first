/**
 * Answerly Content Bridge
 * Runs on the SaaS domain to relay configuration changes to the extension.
 */

// Expose version marker so the web app can detect if the new bridge is loaded
window.__answerly_bridge_version__ = '1.4';
window.__answerly_bridge_loaded_at__ = Date.now();
window.__answerly_bridge__ = true;

console.log("[Answerly Bridge] Active. Version:", window.__answerly_bridge_version__);

// Handshake: announce presence to the web app
window.dispatchEvent(new CustomEvent('EXTENSION_BRIDGE_READY', {
    detail: { version: window.__answerly_bridge_version__, timestamp: Date.now() }
}));

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
        // Discovery engine state sync
        if (changes.discovery_mission_state) {
            window.dispatchEvent(new CustomEvent('discovery_mission_update', {
                detail: changes.discovery_mission_state.newValue
            }));
        }
        if (changes.discovery_mission_completed) {
            window.dispatchEvent(new CustomEvent('discovery_mission_complete', {
                detail: changes.discovery_mission_completed.newValue
            }));
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
    // Re-announce bridge for late-mounting React components
    window.dispatchEvent(new CustomEvent('EXTENSION_BRIDGE_READY', {
        detail: { version: '1.4', timestamp: Date.now() }
    }));
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

// 4.5.1 Stop Recon Mission Relay
window.addEventListener('answerly_recon_stop', () => {
    console.log("[Answerly Bridge] Stop signal detected! Relaying to Engine...");
    chrome.runtime.sendMessage({ action: 'STOP_RECON_MISSION' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("[Answerly Bridge] Stop relay failed:", chrome.runtime.lastError.message);
            return;
        }
        console.log("[Answerly Bridge] Engine confirmed mission halt.", response);
    });
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

// 4.7 Discovery Engine Bridge (Web App → Extension)
window.addEventListener('discovery_mission_start', (event) => {
    console.log("[Answerly Bridge] === DISCOVERY MISSION START EVENT RECEIVED ===");
    console.log("[Answerly Bridge] Mission:", event.detail);
    try {
        chrome.runtime.sendMessage({ action: 'DISCOVERY_START', mission: event.detail }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("[Answerly Bridge] ❌ Discovery start FAILED:", chrome.runtime.lastError.message);
                window.dispatchEvent(new CustomEvent('discovery_mission_update', {
                    detail: {
                        ...event.detail,
                        status: 'failed',
                        completedAt: new Date().toISOString(),
                        logs: [...(event.detail.logs || []), {
                            timestamp: new Date().toISOString(),
                            level: 'error',
                            message: `Bridge → Background failed: ${chrome.runtime.lastError.message}. Reload extension and refresh page.`
                        }]
                    }
                }));
                return;
            }
            console.log("[Answerly Bridge] ✓ Background acknowledged:", response);
            if (!response?.success) {
                console.error("[Answerly Bridge] ❌ Background reported failure:", response);
                window.dispatchEvent(new CustomEvent('discovery_mission_update', {
                    detail: {
                        ...event.detail,
                        status: 'failed',
                        completedAt: new Date().toISOString(),
                        logs: [...(event.detail.logs || []), {
                            timestamp: new Date().toISOString(),
                            level: 'error',
                            message: response?.error || 'Background returned failure without details'
                        }]
                    }
                }));
            }
        });
    } catch (e) {
        console.error("[Answerly Bridge] ❌ sendMessage threw:", e);
        window.dispatchEvent(new CustomEvent('discovery_mission_update', {
            detail: {
                ...event.detail,
                status: 'failed',
                completedAt: new Date().toISOString(),
                logs: [...(event.detail.logs || []), {
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    message: e.message?.includes('context invalidated')
                        ? 'Extension was reloaded. Please refresh this page (F5).'
                        : `Bridge crash: ${e.message}`
                }]
            }
        }));
    }
});

// Diagnostic ping — let the web app verify the engine is loaded in the SW
window.addEventListener('discovery_engine_ping', () => {
    try {
        chrome.runtime.sendMessage({ action: 'DISCOVERY_PING' }, (response) => {
            window.dispatchEvent(new CustomEvent('discovery_engine_pong', {
                detail: chrome.runtime.lastError
                    ? { ok: false, error: chrome.runtime.lastError.message }
                    : { ok: true, ...response }
            }));
        });
    } catch (e) {
        window.dispatchEvent(new CustomEvent('discovery_engine_pong', { detail: { ok: false, error: e.message } }));
    }
});

window.addEventListener('discovery_mission_pause', () => {
    chrome.runtime.sendMessage({ action: 'DISCOVERY_PAUSE' }, (r) => {
        console.log("[Answerly Bridge] Pause confirmed:", r);
    });
});

window.addEventListener('discovery_mission_resume', () => {
    chrome.runtime.sendMessage({ action: 'DISCOVERY_RESUME' }, (r) => {
        console.log("[Answerly Bridge] Resume confirmed:", r);
    });
});

window.addEventListener('discovery_mission_abort', () => {
    chrome.runtime.sendMessage({ action: 'DISCOVERY_ABORT' }, (r) => {
        console.log("[Answerly Bridge] Abort confirmed:", r);
    });
});

// ─── CAMPAIGN BRIDGE ───
window.addEventListener('discovery_campaign_start', (event) => {
    chrome.runtime.sendMessage({ action: 'CAMPAIGN_START', config: event.detail }, (r) => {
        console.log("[Answerly Bridge] Campaign start ack:", r);
    });
});
window.addEventListener('discovery_campaign_pause', (event) => {
    chrome.runtime.sendMessage({ action: 'CAMPAIGN_PAUSE', id: event.detail?.id });
});
window.addEventListener('discovery_campaign_resume', (event) => {
    chrome.runtime.sendMessage({ action: 'CAMPAIGN_RESUME', id: event.detail?.id });
});
window.addEventListener('discovery_campaign_abort', (event) => {
    chrome.runtime.sendMessage({ action: 'CAMPAIGN_ABORT', id: event.detail?.id });
});
window.addEventListener('discovery_campaign_delete', (event) => {
    chrome.runtime.sendMessage({ action: 'CAMPAIGN_DELETE', id: event.detail?.id });
});
window.addEventListener('discovery_campaign_run_now', (event) => {
    chrome.runtime.sendMessage({ action: 'CAMPAIGN_RUN_NOW', id: event.detail?.id });
});

// ─── TRACKING SETTINGS BRIDGE ───
window.addEventListener('tracking_settings_get', () => {
    chrome.runtime.sendMessage({ action: 'TRACKING_SETTINGS_GET' }, (r) => {
        window.dispatchEvent(new CustomEvent('tracking_settings_loaded', { detail: r?.settings || null }));
    });
});
window.addEventListener('tracking_settings_set', (event) => {
    chrome.runtime.sendMessage({ action: 'TRACKING_SETTINGS_SET', settings: event.detail }, (r) => {
        window.dispatchEvent(new CustomEvent('tracking_settings_loaded', { detail: r?.settings || null }));
    });
});
window.addEventListener('tracking_run_now', () => {
    chrome.runtime.sendMessage({ action: 'TRACKING_RUN_NOW' });
});

// Sync campaign storage changes to web app
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.discovery_campaigns) {
        window.dispatchEvent(new CustomEvent('discovery_campaigns_update', {
            detail: changes.discovery_campaigns.newValue
        }));
    }
});

// On load: push current campaign state
chrome.storage.local.get(['discovery_campaigns'], (r) => {
    if (r.discovery_campaigns) {
        window.dispatchEvent(new CustomEvent('discovery_campaigns_update', {
            detail: r.discovery_campaigns
        }));
    }
});

// On load: push current state to web app if a mission is running (resume after refresh)
chrome.storage.local.get(['discovery_mission_state'], (r) => {
    if (r.discovery_mission_state) {
        window.dispatchEvent(new CustomEvent('discovery_mission_update', {
            detail: r.discovery_mission_state
        }));
    }
});

// 5. Periodic Poll (Backup)
setInterval(syncToExtension, 10000);

function syncToExtension(providedData = null) {
    if (!chrome.runtime?.id) return;
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
