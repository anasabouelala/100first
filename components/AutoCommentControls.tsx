import React, { useState, useEffect } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';

// ────────────────────────────────────────────────────────────────────
// AUTO-COMMENT — settings card + per-post status hook.
// Lives in the Radar section so the controls sit next to the posts
// they affect. Was previously in AccountFinder but the posts (and
// per-post badges) are in the Radar — keeping them co-located is
// the right model.
// ────────────────────────────────────────────────────────────────────
export type AutoCommentConfig = {
  tone: 'casual' | 'formal' | 'funny';
  goal: string;
  customInstruction: string;
  includeReposts: boolean;
};
const DEFAULT_AC: AutoCommentConfig = {
  tone: 'casual', goal: 'build_relationship',
  customInstruction: '', includeReposts: false
};

// History entries persisted in extension storage. Each represents one
// decision point in the auto-comment pipeline.
type AcHistoryEntry = {
  at: number;
  status: 'queued' | 'posted' | 'skipped' | 'dismissed';
  reason?: string;
  jobId?: string | null;
  platform?: string;
  creator?: string;
  postUrl?: string;
  preview?: string;
  commentPreview?: string;
};

// Unified comment status for a given post URL. Possible values:
//   'posted-manual' — user manually replied (via the radar's Comment button)
//   'posted-auto'   — auto-comment pipeline replied successfully
//   'queued'        — auto-comment was queued; awaiting AI generation
//   'skipped'       — auto-comment filter rejected (low match, rate limit…)
//   undefined       — nothing happened, this post hasn't been touched
//
// Hook merges TWO data sources:
//   • auto_comment_history (from auto-pipeline gates + posts)
//   • comment_log (every successful comment, manual OR auto)
// Posted state always wins over queued/skipped.
export type CommentStatus = 'posted-manual' | 'posted-auto' | 'queued' | 'skipped';

export function useAutoCommentStatusMap(): Map<string, CommentStatus> {
  const [map, setMap] = useState<Map<string, CommentStatus>>(new Map());

  useEffect(() => {
    let acHistory: AcHistoryEntry[] = [];
    let commentLog: Array<{ url: string; source: 'auto' | 'manual'; at: number }> = [];

    const rebuild = () => {
      const next = new Map<string, CommentStatus>();
      // Pass 1: walk the unified comment_log newest-first. Any URL that
      // appears here was SUCCESSFULLY posted — this is the strongest signal.
      for (const c of commentLog) {
        if (!c.url) continue;
        if (next.has(c.url)) continue;
        next.set(c.url, c.source === 'auto' ? 'posted-auto' : 'posted-manual');
      }
      // Pass 2: auto pipeline statuses. Only set if not already marked as
      // posted (which is terminal). Older 'posted' rows in this log map to
      // posted-auto since this list only contains auto-pipeline events.
      for (const h of acHistory) {
        if (!h.postUrl) continue;
        if (next.has(h.postUrl)) continue;
        if (h.status === 'posted') next.set(h.postUrl, 'posted-auto');
        else if (h.status === 'queued') next.set(h.postUrl, 'queued');
        else if (h.status === 'skipped') next.set(h.postUrl, 'skipped');
      }
      setMap(next);
    };

    const acHandler = (e: any) => {
      if (e.detail?.success) { acHistory = e.detail.history || []; rebuild(); }
    };
    const logHandler = (e: any) => {
      if (e.detail?.success) {
        commentLog = e.detail.log || [];
        // Mirror to localStorage so the Dashboard's "Answered posts" KPI can
        // read it synchronously (the extension keeps it in chrome.storage).
        try { localStorage.setItem('comment_log', JSON.stringify(commentLog)); } catch {}
        rebuild();
      }
    };
    window.addEventListener('auto_comment_config_loaded', acHandler);
    window.addEventListener('comment_log_loaded', logHandler);

    const ping = () => {
      window.dispatchEvent(new CustomEvent('auto_comment_config_get'));
      window.dispatchEvent(new CustomEvent('comment_log_get'));
    };
    ping();
    const id = setInterval(ping, 3000);
    return () => {
      clearInterval(id);
      window.removeEventListener('auto_comment_config_loaded', acHandler);
      window.removeEventListener('comment_log_loaded', logHandler);
    };
  }, []);

  return map;
}

// The settings card — collapsible, sits at the top of the radar feed.
export const AutoCommentSettingsCard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<AutoCommentConfig>(DEFAULT_AC);
  const [stats, setStats] = useState<{ pendingCount: number; postedLastHour: number; postedLastDay: number; history: AcHistoryEntry[] }>({
    pendingCount: 0, postedLastHour: 0, postedLastDay: 0, history: []
  });

  useEffect(() => {
    const handler = (e: any) => {
      const d = e.detail;
      if (!d?.success) return;
      if (d.config) setCfg({ ...DEFAULT_AC, ...d.config });
      setStats({
        pendingCount: d.pendingCount || 0,
        postedLastHour: d.postedLastHour || 0,
        postedLastDay: d.postedLastDay || 0,
        history: d.history || []
      });
    };
    window.addEventListener('auto_comment_config_loaded', handler);
    const ping = () => window.dispatchEvent(new CustomEvent('auto_comment_config_get'));
    ping();
    const id = setInterval(ping, 5000);
    return () => { clearInterval(id); window.removeEventListener('auto_comment_config_loaded', handler); };
  }, []);

  const update = (patch: Partial<AutoCommentConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    window.dispatchEvent(new CustomEvent('auto_comment_config_set', { detail: next }));
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl flex-shrink-0 bg-violet-100">
            <Sparkles size={16} className="text-violet-700" />
          </div>
          <div className="text-left min-w-0">
            <div className="text-sm font-medium text-gray-900">Reply settings</div>
            <div className="text-[10px] text-gray-500">
              How auto-reply drafts are written{stats.pendingCount > 0 ? ` · ${stats.pendingCount} generating` : ''}
            </div>
          </div>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 leading-relaxed">
            <div className="font-semibold mb-1">How it works</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Turn on <b>Auto-reply</b> for an account in the tracked-accounts list (Account Finder).</li>
              <li>When that account posts, a reply is <b>drafted and shown under the post</b> — nothing is posted until <b>you confirm</b>.</li>
              <li>Drafting runs while this dashboard tab is open (the Gemini key lives here).</li>
            </ul>
          </div>

          {/* Tone */}
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-600 block mb-2">Tone</span>
            <div className="flex gap-2">
              {(['casual', 'formal', 'funny'] as const).map(t => (
                <button key={t} onClick={() => update({ tone: t })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    cfg.tone === t
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-gray-400 -mt-1">
            Reply length & style are adapted to each platform automatically (short for X, longer for LinkedIn, conversational for Reddit).
          </div>

          {/* Custom instruction */}
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-600 block mb-1.5">Custom instruction (optional)</span>
            <textarea
              value={cfg.customInstruction}
              onChange={e => update({ customInstruction: e.target.value })}
              placeholder="e.g. Always ask a follow-up question. Never pitch the product directly."
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:border-gray-400 resize-none"
            />
          </div>

          {/* Include reposts */}
          <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={cfg.includeReposts}
              onChange={e => update({ includeReposts: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-violet-600"
            />
            <div>
              <div className="text-xs font-semibold text-gray-900">Include reposts</div>
              <div className="text-[10px] text-gray-500 mt-0.5">Also draft replies for reposts (a reply targets the original post). Off = original posts only.</div>
            </div>
          </label>

        </div>
      )}
    </div>
  );
};
