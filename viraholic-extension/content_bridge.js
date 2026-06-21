/**
 * Viraholic Content Bridge
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
        if (changes.auto_comment_drafts) {
            window.dispatchEvent(new CustomEvent('auto_comment_drafts_update', { detail: changes.auto_comment_drafts.newValue || [] }));
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
        // Feed Watcher buffer (raw scraped feed posts awaiting AI scoring)
        if (changes.feed_watch_buffer) {
            window.dispatchEvent(new CustomEvent('feed_watch_buffer_update', {
                detail: changes.feed_watch_buffer.newValue || []
            }));
        }
        if (changes.feed_watch_config) {
            window.dispatchEvent(new CustomEvent('feed_watch_config_update', {
                detail: changes.feed_watch_config.newValue || null
            }));
        }
        // Per-sweep diagnostic — lets the panel show EXACTLY where a sweep
        // produced zero posts (no platform / scrape 0 / deduped / gated).
        if (changes.feed_watch_diag) {
            window.dispatchEvent(new CustomEvent('feed_watch_diag_update', {
                detail: changes.feed_watch_diag.newValue || null
            }));
        }
    }
});

// Feed Watcher: app → extension config save (one-way), and pull current state.
window.addEventListener('feed_watch_config_save', (event) => {
    const cfg = event?.detail;
    if (!cfg || !chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: 'FEED_WATCH_SAVE_CONFIG', config: cfg }).catch(() => {});
});
// Mark a processed-buffer subset (uuids) as consumed so the engine can
// drop them on the next sweep merge. Panel sends this after scoring.
window.addEventListener('feed_watch_buffer_consume', (event) => {
    const uuids = event?.detail?.uuids;
    if (!Array.isArray(uuids) || !chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: 'FEED_WATCH_CONSUME', uuids }).catch(() => {});
});
// Manual sweep ("Sweep now") button.
window.addEventListener('feed_watch_sweep_now', () => {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ type: 'FEED_WATCH_SWEEP_NOW' }).catch(() => {});
});
// Initial state pull on bridge load so the panel can hydrate.
(function pullInitialFeedWatchState() {
    if (!chrome.runtime?.id) return;
    try {
        chrome.storage.local.get(['feed_watch_config', 'feed_watch_buffer', 'feed_watch_diag'], (r) => {
            if (chrome.runtime.lastError) return;
            window.dispatchEvent(new CustomEvent('feed_watch_config_update', { detail: r.feed_watch_config || null }));
            window.dispatchEvent(new CustomEvent('feed_watch_buffer_update', { detail: r.feed_watch_buffer || [] }));
            window.dispatchEvent(new CustomEvent('feed_watch_diag_update', { detail: r.feed_watch_diag || null }));
        });
    } catch {}
})();

// 1. Sync on load — also seed the kick-on-add baseline
let __answerly_known_tracked_urls = new Set();
syncToExtension();
try {
    const raw = localStorage.getItem('answerly_creator_configs');
    if (raw) __answerly_known_tracked_urls = new Set(JSON.parse(raw).map(c => c.url).filter(Boolean));
} catch {}

// Push Gemini API key from the web app into chrome.storage (hunter brain
// vocabulary bloom reads it from there). Stored locally; never exfiltrated.
window.addEventListener('answerly_set_gemini_key', (event) => {
    const key = event?.detail?.key;
    if (!key || !chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ action: 'DISCOVERY_SET_GEMINI_KEY', key }, (r) => {
        if (chrome.runtime.lastError) {
            console.warn("[Answerly Bridge] Gemini key push failed:", chrome.runtime.lastError.message);
        } else if (r?.ok) {
            console.log("[Answerly Bridge] Gemini key pushed to extension — vocabulary bloom enabled");
        }
    });
});

// Push the user's active voice profile into chrome.storage so the Feed
// Watcher's engagement drafter (service-worker side) can write replies in
// the user's voice. Stored locally; queue-only — nothing posts automatically.
window.addEventListener('answerly_set_voice_profile', (event) => {
    const profile = event?.detail?.profile;
    if (!profile || !chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ action: 'DISCOVERY_SET_VOICE_PROFILE', profile }, (r) => {
        if (chrome.runtime.lastError) {
            console.warn("[Answerly Bridge] Voice profile push failed:", chrome.runtime.lastError.message);
        } else if (r?.ok) {
            console.log("[Answerly Bridge] Voice profile pushed to extension — feed engagement drafting enabled");
        }
    });
});

// 2. Listen for React events
window.addEventListener('answerly_sync', (event) => {
    console.log("[Answerly Bridge] Syncing new configuration...");
    syncToExtension(event.detail);

    // Detect newly-added URLs and kick a poll immediately so the user gets a
    // first signal without waiting for the next 15-min alarm tick.
    try {
        const current = (event.detail || []).map(c => c.url).filter(Boolean);
        const added = current.filter(u => !__answerly_known_tracked_urls.has(u));
        __answerly_known_tracked_urls = new Set(current);
        if (added.length > 0 && chrome.runtime?.id) {
            console.log("[Answerly Bridge] Kicking immediate poll for", added.length, "new account(s)");
            chrome.runtime.sendMessage({ action: 'TRACKING_KICK', urls: added }, (r) => {
                if (chrome.runtime.lastError) {
                    console.warn("[Answerly Bridge] Kick send failed:", chrome.runtime.lastError.message);
                } else {
                    console.log("[Answerly Bridge] Kick acknowledged:", r);
                }
            });
        }
    } catch (e) {
        console.warn("[Answerly Bridge] Kick detection failed:", e);
    }
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

// 3.5 Enrich a single account (manual add) — App -> Extension -> App.
// The app passes a requestId so it can match the async result back to the
// account it just added.
window.addEventListener('answerly_enrich_account', (event) => {
    const { platform, url, requestId } = event.detail || {};
    if (!platform || !url || !chrome.runtime?.id) return;
    chrome.runtime.sendMessage({ action: 'ENRICH_ACCOUNT', platform, url }, (resp) => {
        if (chrome.runtime.lastError) {
            window.dispatchEvent(new CustomEvent('answerly_enrich_result', {
                detail: { requestId, url, ok: false, error: chrome.runtime.lastError.message }
            }));
            return;
        }
        window.dispatchEvent(new CustomEvent('answerly_enrich_result', {
            detail: { requestId, url, ok: !!resp?.success, data: resp?.data || {}, error: resp?.error }
        }));
    });
});

// 3.6 Voice Studio "Steal a voice" — the React side asks the extension to open
// the X profile in a shadow window, scrape recent original posts, and return
// them so the page can AI-calibrate a brand-new voice profile.
window.addEventListener('answerly_steal_voice_fetch', (event) => {
    const { handle, target, requestId } = event.detail || {};
    if (!handle || !chrome.runtime?.id) {
        window.dispatchEvent(new CustomEvent('answerly_steal_voice_result', {
            detail: { requestId, ok: false, error: !handle ? 'Missing handle' : 'Extension unavailable' }
        }));
        return;
    }
    try {
        chrome.runtime.sendMessage({ action: 'STEAL_VOICE_FETCH_POSTS', handle, target }, (resp) => {
            if (chrome.runtime.lastError) {
                window.dispatchEvent(new CustomEvent('answerly_steal_voice_result', {
                    detail: { requestId, ok: false, error: chrome.runtime.lastError.message }
                }));
                return;
            }
            window.dispatchEvent(new CustomEvent('answerly_steal_voice_result', {
                detail: {
                    requestId,
                    ok: !!resp?.success && !resp?.__loginWall,
                    handle: resp?.handle || handle,
                    posts: resp?.posts || [],
                    loginWall: !!resp?.__loginWall,
                    error: resp?.error
                }
            }));
        });
    } catch (e) {
        window.dispatchEvent(new CustomEvent('answerly_steal_voice_result', {
            detail: { requestId, ok: false, error: e?.message || String(e) }
        }));
    }
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
            alert("Viraholic Extension was updated or reloaded. Please refresh this page (F5) to reconnect.");
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

window.addEventListener('pipeline_request_repost', (event) => {
    const { url } = event.detail;
    if (!url) return;
    relayEngagement({ url, actionType: 'repost' });
});

window.addEventListener('pipeline_request_quote', (event) => {
    const { url, comment } = event.detail;
    if (!url) return;
    relayEngagement({ url, actionType: 'quote', commentText: comment });
});

function relayEngagement(lead) {
    console.log("[Answerly Bridge] Engagement queued:", lead.url, lead.actionType);
    chrome.runtime.sendMessage({ action: 'QUEUE_FOR_ENGAGEMENT', lead }, (response) => {
        console.log("[Answerly Bridge] Background confirmed:", response);
    });
}

// 4.6.1 Comment-pipeline DIAGNOSTICS bridge.
// The engagement agent runs in a background tab that is destroyed the instant a
// run ends, and its trace only reaches the service-worker console — neither is
// readable from this page. background.js now persists the agent's step-by-step
// trace + final status to chrome.storage.local. These two events let the app
// page (and a MAIN-world debugger) (a) toggle no-post "dry-run" mode and (b)
// dump exactly where the real extension agent stopped — without Claude or anyone
// touching the LinkedIn DOM.
// Self-serve extension reload. MV3 has no hot-reload, so picking up an edited
// background.js normally needs a manual chrome://extensions reload. An UNPACKED
// extension can reload itself from disk via chrome.runtime.reload(); this bridge
// lets the app page trigger that (then the page is refreshed separately to pull
// the new content_bridge.js). Saves a manual step on every fix iteration.
window.addEventListener('answerly_reload_extension', () => {
    try {
        // Acknowledge BEFORE reloading — reload tears down this context instantly.
        window.dispatchEvent(new CustomEvent('answerly_reload_extension_ack', { detail: { ok: true, at: Date.now() } }));
        setTimeout(() => { try { chrome.runtime.reload(); } catch (_) {} }, 50);
    } catch (e) {
        window.dispatchEvent(new CustomEvent('answerly_reload_extension_ack', { detail: { ok: false, error: String(e) } }));
    }
});

window.addEventListener('answerly_set_force_dryrun', (event) => {
    const on = !!(event.detail && event.detail.on);
    try {
        chrome.storage.local.set({ answerly_force_dryrun: on }, () => {
            const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
            console.log("[Answerly Bridge] force_dryrun =", on, err || '');
            window.dispatchEvent(new CustomEvent('answerly_force_dryrun_set', { detail: { on, error: err } }));
        });
    } catch (e) {
        window.dispatchEvent(new CustomEvent('answerly_force_dryrun_set', { detail: { on, error: String(e) } }));
    }
});

window.addEventListener('answerly_dump_agent_trace', () => {
    try {
        chrome.storage.local.get(
            ['answerly_agent_trace', 'answerly_engine_pulse', 'answerly_force_dryrun', 'comment_log', 'answerly_waitcomplete_how'],
            (r) => {
                const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
                window.dispatchEvent(new CustomEvent('answerly_agent_trace_result', { detail: {
                    error: err,
                    forceDryRun: !!r.answerly_force_dryrun,
                    pulse: r.answerly_engine_pulse || null,
                    waitCompleteHow: r.answerly_waitcomplete_how || null,
                    trace: r.answerly_agent_trace || [],
                    lastComment: (r.comment_log || [])[0] || null
                }}));
            }
        );
    } catch (e) {
        window.dispatchEvent(new CustomEvent('answerly_agent_trace_result', { detail: { error: String(e), trace: [] } }));
    }
});

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
// Diagnostic: fetch full tracking state for the debug pane.
// Robust — every failure mode dispatches a response so the UI never hangs:
//   - bridge present but extension context invalidated (post-reload)
//   - bridge present but background SW killed mid-response
//   - bridge not loaded at all (catch via window.__answerly_bridge__)
window.addEventListener('tracking_debug_get', () => {
    try {
        if (!chrome?.runtime?.id) {
            window.dispatchEvent(new CustomEvent('tracking_debug_loaded', {
                detail: { success: false, error: 'context_invalidated', hint: 'Extension was reloaded — refresh this tab (F5).' }
            }));
            return;
        }
        chrome.runtime.sendMessage({ action: 'TRACKING_DEBUG' }, (r) => {
            if (chrome.runtime.lastError) {
                window.dispatchEvent(new CustomEvent('tracking_debug_loaded', {
                    detail: { success: false, error: chrome.runtime.lastError.message }
                }));
                return;
            }
            window.dispatchEvent(new CustomEvent('tracking_debug_loaded', {
                detail: r || { success: false, error: 'empty_response' }
            }));
        });
    } catch (e) {
        window.dispatchEvent(new CustomEvent('tracking_debug_loaded', {
            detail: { success: false, error: e?.message || String(e) }
        }));
    }
});
// Force the heartbeat to run NOW (for the "Force tick" debug button).
window.addEventListener('tracking_force_tick', () => {
    try {
        if (!chrome?.runtime?.id) return;
        chrome.runtime.sendMessage({ action: 'TRACKING_FORCE_TICK' });
    } catch {}
});

// ─── AUTO-COMMENT BRIDGE ───
// The web app drives auto-comment generation (it has the Gemini key);
// the SW does queueing + posting. These events are the glue.
const __safeSend = (msg, cb) => {
    try {
        if (!chrome?.runtime?.id) { cb?.({ success: false, error: 'context_invalidated' }); return; }
        chrome.runtime.sendMessage(msg, r => {
            if (chrome.runtime.lastError) cb?.({ success: false, error: chrome.runtime.lastError.message });
            else cb?.(r);
        });
    } catch (e) {
        cb?.({ success: false, error: e?.message || String(e) });
    }
};
window.addEventListener('auto_comment_config_get', () => {
    __safeSend({ action: 'AUTO_COMMENT_CONFIG_GET' }, r => {
        window.dispatchEvent(new CustomEvent('auto_comment_config_loaded', { detail: r || { success: false } }));
    });
});
window.addEventListener('auto_comment_config_set', (e) => {
    __safeSend({ action: 'AUTO_COMMENT_CONFIG_SET', config: e.detail || {} }, r => {
        window.dispatchEvent(new CustomEvent('auto_comment_config_loaded', { detail: r || { success: false } }));
    });
});
window.addEventListener('tracking_toggle_auto_comment', (e) => {
    __safeSend({ action: 'TRACKING_TOGGLE_AUTO_COMMENT', url: e.detail?.url, enabled: !!e.detail?.enabled });
});
window.addEventListener('auto_comment_pending_get', () => {
    __safeSend({ action: 'AUTO_COMMENT_PENDING_GET' }, r => {
        window.dispatchEvent(new CustomEvent('auto_comment_pending_loaded', { detail: r || { success: false, jobs: [] } }));
    });
});
window.addEventListener('auto_comment_submit', (e) => {
    __safeSend({ action: 'AUTO_COMMENT_SUBMIT', jobId: e.detail?.jobId, comment: e.detail?.comment }, r => {
        window.dispatchEvent(new CustomEvent('auto_comment_submitted', { detail: r || { success: false } }));
    });
});
window.addEventListener('auto_comment_dismiss', (e) => {
    __safeSend({ action: 'AUTO_COMMENT_DISMISS', jobId: e.detail?.jobId });
});
// Human-in-the-loop draft flow
window.addEventListener('auto_comment_save_draft', (e) => {
    __safeSend({ action: 'AUTO_COMMENT_SAVE_DRAFT', jobId: e.detail?.jobId, comment: e.detail?.comment });
});
window.addEventListener('auto_comment_drafts_get', () => {
    __safeSend({ action: 'AUTO_COMMENT_DRAFTS_GET' }, r => {
        window.dispatchEvent(new CustomEvent('auto_comment_drafts_loaded', { detail: r || { success: false, drafts: [] } }));
    });
});
window.addEventListener('auto_comment_confirm', (e) => {
    __safeSend({ action: 'AUTO_COMMENT_CONFIRM', postUrl: e.detail?.postUrl, comment: e.detail?.comment }, r => {
        window.dispatchEvent(new CustomEvent('auto_comment_confirmed', { detail: r || { success: false } }));
    });
});
window.addEventListener('auto_comment_discard', (e) => {
    __safeSend({ action: 'AUTO_COMMENT_DISCARD', postUrl: e.detail?.postUrl });
});
// Posts Tracker management
window.addEventListener('posts_clear', () => {
    __safeSend({ action: 'POSTS_CLEAR' }, () => {
        window.dispatchEvent(new CustomEvent('answerly_history_update', { detail: [] }));
    });
});
window.addEventListener('posts_remove', (e) => {
    __safeSend({ action: 'POSTS_REMOVE', uuid: e.detail?.uuid, postUrl: e.detail?.postUrl }, () => {
        window.dispatchEvent(new CustomEvent('answerly_request_history'));
    });
});
// Unified comment log — every manual + auto comment that successfully posted.
window.addEventListener('comment_log_get', () => {
    __safeSend({ action: 'COMMENT_LOG_GET' }, r => {
        window.dispatchEvent(new CustomEvent('comment_log_loaded', { detail: r || { success: false, log: [] } }));
    });
});
// Manual-reply marker — the web app fires this when the user sends a comment
// manually so the radar badge flips to "You replied" immediately.
window.addEventListener('comment_log_add', (e) => {
    __safeSend({ action: 'COMMENT_LOG_ADD', ...(e.detail || {}) }, () => {
        // Refresh the panel's view of the log right away.
        window.dispatchEvent(new CustomEvent('comment_log_get'));
    });
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
chrome.storage.local.get(['discovery_mission_state', 'answerly_engine_pulse'], (r) => {
    if (r.discovery_mission_state) {
        window.dispatchEvent(new CustomEvent('discovery_mission_update', {
            detail: r.discovery_mission_state
        }));
    }
    if (r.answerly_engine_pulse) {
        window.dispatchEvent(new CustomEvent('answerly_pulse_update', {
            detail: r.answerly_engine_pulse
        }));
    }
});

// Smoke test bridge — exposed on window so the user can fire it from DevTools:
//   window.answerlyDiscoverySmokeTest()
// This calls the engine's DISCOVERY_SMOKE_TEST handler which writes 3 fake
// accounts to chrome.storage. If the UI shows them, the pipeline works and
// the real-search bug is in scraping. If not, the bug is upstream.
window.answerlyDiscoverySmokeTest = function () {
    if (!chrome.runtime?.id) {
        console.error('[Answerly Bridge] Extension not connected — reload the page after installing.');
        return;
    }
    chrome.runtime.sendMessage({ action: 'DISCOVERY_SMOKE_TEST' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[Answerly Bridge] Smoke test failed:', chrome.runtime.lastError.message);
            return;
        }
        console.log('[Answerly Bridge] ✓ Smoke test fired. Watch the Found Accounts section — 3 fake accounts should appear within 1-2 seconds.');
    });
};

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
