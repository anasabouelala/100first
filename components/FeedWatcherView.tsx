import React, { useEffect, useState } from 'react';
import {
  Rss, Brain, Filter, Clock, Activity, RotateCw, CheckCircle2,
  Twitter, Linkedin, MessageCircle, Loader2, ShieldCheck, AlertTriangle, Check
} from 'lucide-react';
import { DiscoveryPlatform, FeedWatcherConfig } from '../types';

// ────────────────────────────────────────────────────────────────────
// FEED WATCHER — TOP-LEVEL SECTION
// Independent automation. Lives in its own route (AppMode.FEED_WATCHER),
// not embedded inside Account Finder. The extension service worker owns the
// scrape→score→promote pipeline; this view just configures it and renders
// status. Shares the in-extension polling lock with Account Finder + Posts
// Tracker so no two stealth windows ever scrape the same domain at once.
// ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'feed_watch_config_draft';

const DEFAULT_CONFIG: FeedWatcherConfig = {
  enabled: { X: false, LinkedIn: false, Reddit: false },
  prompt: '',
  minRelevancy: 60,
  pollIntervalMinutes: 15,
  maxPostsPerSweep: 50,
  engagement: { enabled: true, maxPerSweep: 3 }
};

const PLATFORMS: { id: DiscoveryPlatform; label: string; icon: React.ReactNode }[] = [
  { id: 'X',        label: 'X / Twitter', icon: <Twitter size={20} /> },
  { id: 'LinkedIn', label: 'LinkedIn',    icon: <Linkedin size={20} /> }
];

function loadConfig(): FeedWatcherConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      enabled: { ...DEFAULT_CONFIG.enabled, ...(parsed.enabled || {}) },
      engagement: { ...DEFAULT_CONFIG.engagement, ...(parsed.engagement || {}) }
    };
  } catch { return DEFAULT_CONFIG; }
}

export const FeedWatcherView: React.FC = () => {
  const [cfg, setCfg] = useState<FeedWatcherConfig>(() => loadConfig());
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [bufferCount, setBufferCount] = useState(0);
  const [status, setStatus] = useState<{
    scored: number;
    promoted: number;
    drafted: number;
    lastAt?: string;
    durationSec?: number;
    err?: string;
  }>({ scored: 0, promoted: 0, drafted: 0 });
  const [sweepingNow, setSweepingNow] = useState(false);
  const [diag, setDiag] = useState<any | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  const setPatch = (patch: Partial<FeedWatcherConfig>) => setCfg(c => ({ ...c, ...patch }));
  const togglePlatform = (p: DiscoveryPlatform) =>
    setCfg(c => ({ ...c, enabled: { ...c.enabled, [p]: !c.enabled[p] } }));

  // Persist + debounced push to the extension service worker.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    const id = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('feed_watch_config_save', { detail: cfg }));
    }, 600);
    return () => clearTimeout(id);
  }, [cfg]);

  // Bridge handshake + live status from the SW.
  useEffect(() => {
    const onReady = () => setExtensionConnected(true);
    const onPong = () => setExtensionConnected(true);
    const onBuf = (e: any) => setBufferCount(Array.isArray(e.detail) ? e.detail.length : 0);
    const onCfg = (e: any) => {
      const c = e?.detail;
      if (!c) return;
      setStatus({
        scored: c.lastSweepScored || 0,
        promoted: c.lastSweepPromoted || 0,
        drafted: c.lastSweepDrafted || 0,
        lastAt: c.lastSweepAt,
        durationSec: c.lastSweepDurationSec
      });
      // If a sweep just finished, stop the spinner.
      if (c.lastSweepAt) setSweepingNow(false);
    };
    const onDiag = (e: any) => {
      if (e?.detail) {
        setDiag(e.detail);
        if (e.detail.finishedAt || e.detail.lastSkip) setSweepingNow(false);
      }
    };
    window.addEventListener('EXTENSION_BRIDGE_READY', onReady);
    window.addEventListener('answerly_pong', onPong);
    window.addEventListener('feed_watch_buffer_update', onBuf);
    window.addEventListener('feed_watch_config_update', onCfg);
    window.addEventListener('feed_watch_diag_update', onDiag);
    window.dispatchEvent(new CustomEvent('answerly_ping'));
    const ping = setInterval(() => window.dispatchEvent(new CustomEvent('answerly_ping')), 10000);
    return () => {
      window.removeEventListener('EXTENSION_BRIDGE_READY', onReady);
      window.removeEventListener('answerly_pong', onPong);
      window.removeEventListener('feed_watch_buffer_update', onBuf);
      window.removeEventListener('feed_watch_config_update', onCfg);
      window.removeEventListener('feed_watch_diag_update', onDiag);
      clearInterval(ping);
    };
  }, []);

  const anyOn = cfg.enabled.X || cfg.enabled.LinkedIn || cfg.enabled.Reddit;

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Bridge status strip — same look as Account Finder */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck size={14} className="text-gray-500" />
          <span className="font-bold uppercase tracking-widest text-gray-700">Extension</span>
        </div>
        {extensionConnected ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-emerald-50 text-emerald-800 border border-emerald-200">
            <Check size={12} />
            <span className="font-bold">Connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle size={12} />
            <span className="font-bold">Bridge not detected — reload the extension</span>
          </div>
        )}
      </div>

      {/* Main card */}
      <div className="bg-gradient-to-br from-white to-emerald-50/30 border border-emerald-100 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-sm">
              <Rss size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Background automation</h2>
              <p className="text-[11px] text-gray-500">Runs in the extension — even when this tab is closed.</p>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${anyOn ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {anyOn ? 'Active' : 'Off'}
          </div>
        </div>

        <p className="text-[12px] text-gray-600 mt-3 mb-5 leading-relaxed">
          Toggle the platforms below. Every <span className="font-semibold">{cfg.pollIntervalMinutes} minutes</span>, the extension opens a stealth window and scrolls each enabled home feed — exactly like a human would — until it has scraped up to <span className="font-semibold">{cfg.maxPostsPerSweep ?? 50}</span> posts (your target below) or runs out of new ones. Gemini scores each new post against your brief; anything ≥ <span className="font-semibold">{cfg.minRelevancy}</span>/100 lands in the <span className="font-semibold">Posts Tracker</span>. The same post never gets scored twice. Author info is read straight from the feed card — no profile is ever opened.
        </p>

        {/* Per-platform toggles */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {PLATFORMS.map(p => {
            const on = !!cfg.enabled[p.id];
            return (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                className={`relative p-3 rounded-xl border-2 transition-all text-left ${on ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-400'}`}
              >
                <div className={`flex items-center gap-2 ${on ? 'text-emerald-700' : 'text-gray-600'}`}>
                  {p.icon}
                  <span className="text-xs font-bold">{p.label}</span>
                </div>
                <div className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider ${on ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {on ? 'Watching' : 'Off'}
                </div>
                {on && <CheckCircle2 size={14} className="absolute top-2 right-2 text-emerald-600" />}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Brief */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5">
              <Brain size={12} /> What I'm looking for <span className="text-gray-400 font-bold normal-case tracking-normal">· optional</span>
            </div>
            <textarea
              value={cfg.prompt}
              onChange={e => setPatch({ prompt: e.target.value })}
              placeholder={"Leave blank to auto-target from your product — or get specific, e.g. People complaining about cold-outreach tools, founders asking for marketing help, posts about hiring their first growth marketer."}
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-gray-900 focus:outline-none resize-y leading-relaxed bg-white"
            />
            {cfg.prompt.trim() ? (
              <div className="text-[10px] text-gray-400 mt-1.5 italic">
                Be specific — vague briefs surface vague matches.
              </div>
            ) : (
              <div className="text-[10px] text-emerald-700 mt-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-2 leading-relaxed">
                <span className="font-bold">Surfacing everything.</span> With no brief I send every post I scroll past to your Posts Tracker — ranked by fit to the <span className="font-semibold">product & audience</span> in your project when available. Type a brief above to filter strictly instead.
              </div>
            )}
          </div>

          <div className="space-y-4">
            {/* Max posts per sweep — the scrape-volume target. This is the knob
                that controls how many posts land in the dashboard each sweep. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 flex items-center gap-1.5">
                  <Rss size={12} /> Max posts per sweep
                </div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">{cfg.maxPostsPerSweep ?? 50}</div>
              </div>
              <input
                type="number"
                min={1}
                max={100}
                value={cfg.maxPostsPerSweep ?? 50}
                onChange={e => setPatch({ maxPostsPerSweep: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)) })}
                className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-gray-900 focus:outline-none tabular-nums bg-white"
              />
              <div className="text-[10px] text-gray-400 mt-1.5 italic">
                How many posts to pull into your Posts Tracker each sweep (1–100). Higher targets scroll the feed longer — a 100-post sweep can take several minutes of visible scrolling.
              </div>
            </div>

            {/* Min profile fit — the relevancy score IS the profile-fit %, so
                this is the same threshold the Posts Tracker filters on. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 flex items-center gap-1.5">
                  <Filter size={12} /> Minimum profile fit
                </div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">{cfg.minRelevancy}%</div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={cfg.minRelevancy}
                onChange={e => setPatch({ minRelevancy: parseInt(e.target.value, 10) })}
                className="w-full accent-emerald-600"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>0% — keep most</span>
                <span>100% — perfect fit only</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-1.5 italic">
                Only posts that fit your profile at or above this % reach the tracker — the same fit score shown on each card.
              </div>
            </div>

            {/* Timer */}
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5">
                <Clock size={12} /> Poll every
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={360}
                  value={cfg.pollIntervalMinutes}
                  onChange={e => setPatch({ pollIntervalMinutes: Math.max(2, Math.min(360, parseInt(e.target.value, 10) || 15)) })}
                  className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-gray-900 focus:outline-none tabular-nums bg-white"
                />
                <span className="text-xs text-gray-600">minutes</span>
                <button
                  onClick={() => {
                    setSweepingNow(true);
                    window.dispatchEvent(new CustomEvent('feed_watch_sweep_now'));
                    // Safety net — clear the spinner if no config update comes in.
                    setTimeout(() => setSweepingNow(false), 12 * 60 * 1000);
                  }}
                  disabled={!extensionConnected || !anyOn || sweepingNow}
                  className="ml-auto px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-bold hover:bg-gray-700 disabled:opacity-40 flex items-center gap-1.5"
                  title={!extensionConnected ? 'Extension not connected' : !anyOn ? 'Toggle at least one platform' : 'Run one sweep now'}
                >
                  {sweepingNow ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                  {sweepingNow ? 'Sweeping…' : 'Sweep now'}
                </button>
              </div>
              <div className="text-[10px] text-gray-400 mt-1.5 italic">
                Min 2 min, max 6 h. Each sweep scrolls every enabled feed until it hits your “Max posts per sweep” target or runs out of new posts.
              </div>
            </div>
          </div>
        </div>

        {/* Status strip */}
        <div className="mt-4 rounded-xl border border-emerald-100 bg-white px-3 py-2.5 text-[11px] text-gray-700 flex items-center gap-3 flex-wrap">
          <Activity size={12} className="text-emerald-600" />
          <span><span className="font-bold tabular-nums">{bufferCount}</span> in last scroll buffer</span>
          <span className="text-gray-400">·</span>
          <span><span className="font-bold tabular-nums">{status.scored}</span> scored</span>
          <span className="text-gray-400">·</span>
          <span><span className="font-bold tabular-nums text-emerald-700">{status.promoted}</span> promoted to tracker</span>
          {status.durationSec ? (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">{status.durationSec}s of scrolling</span>
            </>
          ) : null}
          {status.lastAt && (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">last sweep {new Date(status.lastAt).toLocaleTimeString()}</span>
            </>
          )}
          {status.err && (
            <span className="ml-auto text-red-600 truncate" title={status.err}>{status.err}</span>
          )}
          <button
            onClick={() => setShowDiag(s => !s)}
            className="ml-auto text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900 underline decoration-dotted"
          >
            {showDiag ? 'Hide diagnostics' : 'Why 0 posts? →'}
          </button>
        </div>

        {/* Diagnostic panel — pinpoints exactly where a sweep produced zero */}
        {showDiag && (
          <div className="mt-3 rounded-xl border border-gray-300 bg-gray-900 text-gray-100 p-4 text-[11px] font-mono leading-relaxed">
            {!diag ? (
              <div className="text-gray-400">No sweep diagnostic yet. Click <span className="font-bold text-white">Sweep now</span> and the exact result appears here.</div>
            ) : (
              <div className="space-y-2">
                {/* Headline conclusion */}
                <div className={`px-3 py-2 rounded-lg font-bold ${diag.promoted > 0 ? 'bg-emerald-900/60 text-emerald-200' : 'bg-rose-900/60 text-rose-200'}`}>
                  {diag.conclusion || diag.note || (diag.lastSkip ? `Skipped: ${diag.lastSkip}` : 'Sweep in progress…')}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-gray-300">
                  <div>enabled: <span className="text-white">{(diag.enabledPlatforms || []).join(', ') || '—'}</span></div>
                  <div>gemini key: <span className={diag.geminiKeyPresent ? 'text-emerald-300' : 'text-rose-300'}>{diag.geminiKeyPresent ? 'present' : 'MISSING'}</span></div>
                  <div>scrape mode: <span className="text-white">{diag.scoreMode || '—'}</span></div>
                  <div>tracker size: <span className="text-white">{diag.trackerSize ?? '—'}</span> / seen-mem {diag.seenMemory ?? '—'}</div>
                  <div>scraped (new): <span className="text-white">{diag.freshlyScraped ?? 0}</span></div>
                  <div>deduped: <span className="text-white">{diag.dedupSkipped ?? 0}</span></div>
                  <div>scored: <span className="text-white">{diag.scored ?? 0}</span></div>
                  <div>passing: <span className="text-white">{diag.passing ?? 0}</span> (min {diag.minScore ?? '—'})</div>
                  <div>promoted: <span className="text-emerald-300 font-bold">{diag.promoted ?? 0}</span></div>
                  <div>blocked at promote: <span className="text-white">{diag.promoteBlocked ?? 0}</span></div>
                </div>
                {/* Per-platform breakdown */}
                {diag.platforms && Object.keys(diag.platforms).length > 0 && (
                  <div className="mt-2 border-t border-gray-700 pt-2 space-y-1">
                    {Object.entries(diag.platforms).map(([plat, p]: [string, any]) => (
                      <div key={plat} className="flex flex-wrap gap-x-3 text-gray-300">
                        <span className="font-bold text-white w-20">{plat}</span>
                        <span>nav:{p.navOk ? '✓' : '✗'}</span>
                        <span>onPage:{p.rawSeenOnPage ?? 0}</span>
                        <span>new:{p.found ?? 0}</span>
                        <span>deduped:{p.dedupSkipped ?? 0}</span>
                        {p.blocked && <span className="text-rose-300">blocked:{p.blocked}</span>}
                        {p.error && <span className="text-amber-300 break-all">{p.error}</span>}
                        {p.lastScrapeDiag && <span className="text-gray-500">[{JSON.stringify(p.lastScrapeDiag)}]</span>}
                      </div>
                    ))}
                  </div>
                )}
                {diag.error && <div className="text-rose-300 break-all">error: {diag.error}</div>}
                {diag.updatedAt && <div className="text-gray-500">updated {new Date(diag.updatedAt).toLocaleTimeString()}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
