import React, { useState, useEffect } from 'react';
import { AppMode } from './types';
import { ProjectProvider, useProject } from './contexts/ProjectContext';
import { useAuth } from './contexts/AuthContext';
import { ProjectSetup, ProjectSummaryCard } from './components/ProjectSetup';
import { AutoCommentProcessor } from './components/AutoCommentProcessor';
import { UnifiedCommandCenter } from './components/UnifiedCommandCenter';
import { ContentEngineView } from './components/ContentEngineView';
import { ContentParametersView } from './components/ContentParametersView';
import { AccountFinderView } from './components/AccountFinderView';
import { FeedWatcherView } from './components/FeedWatcherView';
import { DashboardView } from './components/DashboardView';
import {
  Zap, Menu, Home, ShieldCheck,
  Sparkles, Trash2, Plus, Crosshair, Settings2, Rss,
  LogOut, Loader2, ArrowUpRight
} from 'lucide-react';

// Unified section titles — one simple header for every section.
const SECTION_META: Record<string, { title: string; subtitle: string }> = {
  [AppMode.ANSWERLY_RADAR]:       { title: 'Posts Tracker',       subtitle: 'New posts from the accounts you follow' },
  [AppMode.ACCOUNT_FINDER]:       { title: 'Account Finder',      subtitle: 'Find and track creators in your niche' },
  [AppMode.FEED_WATCHER]:         { title: 'Feed Watcher',        subtitle: 'Mine your home feed for opportunities, automatically' },
  [AppMode.CONTENT_ENGINE]:       { title: 'Content Engine',      subtitle: 'Generate posts that convert' },
  [AppMode.CONTENT_PARAMETERS]:   { title: 'Voice Studio',        subtitle: 'Tune your voice once. Every post inherits it.' },
};

// ──────────────────────────────────────────────────────────────────
// SidebarQuickStats
// A tiny pulse panel in the sidebar showing the two numbers a user
// actually cares about at a glance: how many accounts they're watching,
// and how many replies they've posted today. Reads from localStorage —
// the same sources the rest of the app writes to — and refreshes when
// other tabs / event listeners update them. Click anywhere on the card
// to jump straight to the Posts Tracker.
// ──────────────────────────────────────────────────────────────────
const SidebarQuickStats: React.FC<{ onJump: () => void }> = ({ onJump }) => {
  const [tracked, setTracked] = useState(0);
  const [repliesToday, setRepliesToday] = useState(0);

  useEffect(() => {
    const load = () => {
      try {
        const cfg = JSON.parse(localStorage.getItem('answerly_creator_configs') || '[]');
        setTracked(Array.isArray(cfg) ? cfg.length : 0);
      } catch { setTracked(0); }
      try {
        const log = JSON.parse(localStorage.getItem('comment_log') || '[]');
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const startMs = dayStart.getTime();
        const count = Array.isArray(log)
          ? log.filter((e: any) => (typeof e?.at === 'number' ? e.at : Date.parse(e?.at || '')) >= startMs).length
          : 0;
        setRepliesToday(count);
      } catch { setRepliesToday(0); }
    };
    load();
    // Refresh on the events the rest of the app already dispatches when
    // these collections change.
    const onSync     = () => load();
    const onCmtLoad  = () => load();
    const onStorage  = (e: StorageEvent) => {
      if (e.key === 'answerly_creator_configs' || e.key === 'comment_log') load();
    };
    window.addEventListener('answerly_sync', onSync);
    window.addEventListener('comment_log_loaded', onCmtLoad);
    window.addEventListener('storage', onStorage);
    const id = setInterval(load, 8000);
    return () => {
      window.removeEventListener('answerly_sync', onSync);
      window.removeEventListener('comment_log_loaded', onCmtLoad);
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onJump}
      className="w-full text-left rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 hover:from-gray-50 hover:to-white hover:border-gray-300 transition-all p-3 group"
      title="Open Tracked posts"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500">Today</span>
        <span className="flex items-center gap-1 text-[9px] font-bold text-gray-400 group-hover:text-gray-700 transition-colors">
          Open <ArrowUpRight size={9} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[18px] font-extrabold leading-none text-gray-900 tabular-nums">{tracked}</div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-1 font-bold">Tracked</div>
        </div>
        <div>
          <div className="text-[18px] font-extrabold leading-none text-emerald-600 tabular-nums">{repliesToday}</div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-1 font-bold">Replies</div>
        </div>
      </div>
    </button>
  );
};

// Single frosted-glass title bar shared by all sections.
const SectionGlassHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="glass-header px-6 py-4 mb-6 flex items-center gap-3">
    <div className="bg-gray-900/90 text-white p-2 rounded-xl flex-shrink-0">
      <Zap size={18} />
    </div>
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-bold text-gray-900 tracking-tight leading-none truncate">{title}</h1>
      <p className="text-xs text-gray-500 mt-1 truncate">{subtitle}</p>
    </div>
  </div>
);

function AppInner() {
  const { project, isComplete, clearProject } = useProject();
  const auth = useAuth();
  const [mode, setMode] = useState<AppMode | 'DASHBOARD'>('DASHBOARD');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingProject, setEditingProject] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Hand the extension a copy of the Gemini API key once the bridge is ready,
  // so the Feed Watcher (and any other SW-side AI feature) can call Gemini
  // directly from the service worker — even when this tab is closed.
  useEffect(() => {
    const pushKey = () => {
      try {
        const key = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
        if (!key) return;
        window.dispatchEvent(new CustomEvent('answerly_set_gemini_key', { detail: { key } }));
      } catch {}
    };
    pushKey();
    window.addEventListener('EXTENSION_BRIDGE_READY', pushKey);
    return () => window.removeEventListener('EXTENSION_BRIDGE_READY', pushKey);
  }, []);

  // Hand the extension the user's active voice profile so the Feed Watcher can
  // DRAFT engagement replies in their voice from the service worker (queue-only
  // — nothing posts without approval). Re-pushed whenever the saved voice
  // profile changes (storage event) or the bridge re-announces itself.
  useEffect(() => {
    const pushVoice = () => {
      try {
        let voiceMix: any = null, rhythm: any = null, perspective: any = null, planCtx: any = null;
        try {
          const raw = localStorage.getItem('content_voice_profile_v2');
          if (raw) { const v = JSON.parse(raw); voiceMix = v?.voiceMix || null; rhythm = v?.rhythm || v?.voiceMix?.rhythm || null; }
        } catch {}
        try {
          const rawP = localStorage.getItem('content_perspective_v1');
          if (rawP) perspective = JSON.parse(rawP);
        } catch {}
        try {
          const rawPlan = localStorage.getItem('strategy_plan_v2');
          if (rawPlan) planCtx = JSON.parse(rawPlan);
        } catch {}
        // Comment spec (tone / goal / length / standing instruction) is set in
        // Voice Studio under its own key. The Feed Watcher SW drafter honors it,
        // so it MUST be threaded into the pushed profile — otherwise the chosen
        // tone (e.g. "funny") is silently dropped for auto-drafted comments.
        let commentSpec: any = null;
        try {
          const rawCs = localStorage.getItem('comment_spec_v1');
          if (rawCs) commentSpec = JSON.parse(rawCs);
        } catch {}
        const profile = {
          voiceMix,
          rhythm: rhythm || (voiceMix && voiceMix.rhythm) || null,
          perspective,
          commentSpec,
          product: (project as any)?.productName || planCtx?.productName || '',
          audience: (project as any)?.targetAudience || planCtx?.targetAudience || ''
        };
        window.dispatchEvent(new CustomEvent('answerly_set_voice_profile', { detail: { profile } }));
      } catch {}
    };
    pushVoice();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'content_voice_profile_v2' || e.key === 'content_perspective_v1' || e.key === 'comment_spec_v1') pushVoice();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('EXTENSION_BRIDGE_READY', pushVoice);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('EXTENSION_BRIDGE_READY', pushVoice);
    };
  }, [project]);

  // Wipe the project + all local state. Kept separate from window.confirm,
  // which silently returns false in sandboxed/embedded webviews (that was why
  // the Delete button appeared to do nothing).
  const performDeleteProject = () => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    clearProject();
    setConfirmingDelete(false);

    // IMPORTANT: chrome.storage.local.clear() is async. Previously we reloaded
    // immediately after calling it, so the reload often won the race and the
    // extension's data (tracked accounts, answerly_history → old posts in the
    // Posts Tracker) survived. Wait for the clear to finish, THEN reload.
    const done = () => window.location.reload();
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'STOP_RECON_MISSION' });
      }
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.clear(() => done());
        // Safety net in case the callback never fires.
        setTimeout(done, 1500);
      } else {
        done();
      }
    } catch (e) {
      console.warn('Extension clear failed', e);
      done();
    }
  };

  // ── AUTH GATE ──
  // The marketing site at /landing-growth.html is the gateway. If we're not
  // signed in we redirect there and the visitor uses the modal CTA to log in.
  // The initial getSession() call can be slow on a cold cache, so we show a
  // small spinner instead of flashing the dashboard frame.
  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200" role="status" aria-live="polite" aria-busy="true">
        <div className="flex items-center gap-2 text-gray-600">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          <span className="text-sm">Checking session…</span>
        </div>
      </div>
    );
  }
  if (!auth.session) {
    if (typeof window !== 'undefined') {
      window.location.replace('/landing-growth.html');
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200" role="status" aria-live="polite">
        <div className="text-sm text-gray-600">Redirecting to sign in…</div>
      </div>
    );
  }

  // ── First-time setup gate ──
  if (!isComplete) {
    return (
      <div className="min-h-screen bg-base-200">
        <ProjectSetup mode="first-time" />
      </div>
    );
  }

  const navGroups = [
    {
      title: 'Mission Control',
      items: [
        { id: 'DASHBOARD', label: 'Dashboard', icon: <Home size={18} /> },
        { id: AppMode.ANSWERLY_RADAR, label: 'Posts Tracker', icon: <ShieldCheck size={18} /> },
      ]
    },
    {
      title: 'Growth Ops',
      items: [
        { id: AppMode.ACCOUNT_FINDER, label: 'Account Finder', icon: <Crosshair size={18} /> },
        { id: AppMode.FEED_WATCHER,   label: 'Feed Watcher',   icon: <Rss size={18} /> },
      ]
    },
    {
      title: 'Execution',
      items: [
        { id: AppMode.CONTENT_ENGINE, label: 'Content Engine', icon: <Sparkles size={18} /> },
        { id: AppMode.CONTENT_PARAMETERS, label: 'Voice Studio', icon: <Settings2 size={18} /> },
      ]
    }
  ];

  const renderContent = () => {
    // Project summary appears at top of every section (except dashboard which has its own hero)
    const projectHeader = mode !== 'DASHBOARD' && project && (
      <ProjectSummaryCard onEdit={() => setEditingProject(true)} />
    );

    switch (mode) {
      case AppMode.ANSWERLY_RADAR:  return <UnifiedCommandCenter appDesc={project!.pitch} />;
      case AppMode.CONTENT_ENGINE:  return <>{projectHeader}<ContentEngineView onOpenParameters={() => setMode(AppMode.CONTENT_PARAMETERS)} /></>;
      case AppMode.CONTENT_PARAMETERS: return <>{projectHeader}<ContentParametersView /></>;
      case AppMode.ACCOUNT_FINDER:  return <AccountFinderView />;
      case AppMode.FEED_WATCHER:    return <>{projectHeader}<FeedWatcherView /></>;

      case 'DASHBOARD':
      default:
        return <DashboardView setMode={setMode} onEditProject={() => setEditingProject(true)} />;
    }
  };

  return (
    <div className="drawer lg:drawer-open">
      <input id="my-drawer-2" type="checkbox" className="drawer-toggle" checked={isSidebarOpen} onChange={() => setIsSidebarOpen(!isSidebarOpen)} />

      <div className="drawer-content flex flex-col bg-transparent min-h-screen">
        <div className="w-full navbar glass-morphism lg:hidden shadow-sm">
          <div className="flex-none">
            <label htmlFor="my-drawer-2" className="btn btn-square btn-ghost min-h-[44px] min-w-[44px]" aria-label="Open navigation menu">
              <Menu aria-hidden="true" />
            </label>
          </div>
          <div className="flex-1 px-2 mx-2 font-display font-bold text-xl">LaunchVelocity</div>
        </div>

        <main className="flex-1 p-4 lg:p-10 overflow-x-hidden">
          {SECTION_META[mode] && (
            <SectionGlassHeader title={SECTION_META[mode].title} subtitle={SECTION_META[mode].subtitle} />
          )}
          {renderContent()}
        </main>
      </div>

      <div className="drawer-side z-50 shadow-xl lg:shadow-none">
        <label htmlFor="my-drawer-2" aria-label="close sidebar" className="drawer-overlay"></label>
        <ul className="menu p-4 w-80 min-h-full glass-sidebar text-base-content flex flex-col justify-between">
          <div>
            <div className="px-4 py-4 mb-3 flex items-center gap-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Zap className="text-primary" size={24} />
              </div>
              <div>
                <h1 className="font-display font-bold text-xl leading-none tracking-tight">Launch<br/>Velocity</h1>
              </div>
            </div>

            {/* Active project pill in sidebar */}
            <div className="px-2 mb-4">
              <ProjectSummaryCard compact onEdit={() => setEditingProject(true)} />
            </div>

            {/* Quick stats — fills the visual gap between project pill and
                nav, and answers the two questions the user actually has when
                they look at the sidebar: "how many accounts am I watching?"
                and "how many replies went out today?" */}
            <div className="px-2 mb-2">
              <SidebarQuickStats onJump={() => setMode(AppMode.ANSWERLY_RADAR)} />
            </div>

            {navGroups.map((group) => (
              <React.Fragment key={group.title}>
                <li className="menu-title opacity-40 uppercase text-[10px] tracking-[0.2em] mt-6 mb-2 font-black">{group.title}</li>
                {group.items.map((item) => (
                  <li key={item.id} className="mb-0.5">
                    <button
                      onClick={() => { setMode(item.id as any); if(window.innerWidth < 1024) setIsSidebarOpen(false); }}
                      aria-current={mode === item.id ? 'page' : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ease-out cursor-pointer min-h-[40px]
                        ${mode === item.id
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                        }`}>
                      <span className={mode === item.id ? 'text-white' : 'text-gray-500'} aria-hidden="true">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  </li>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div className="mt-8 space-y-1">
            <button
              onClick={() => setNewProject(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-lg text-sm font-medium transition-all duration-200 ease-out">
              <Plus size={15} />
              <span>New project</span>
            </button>

            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-all duration-200 ease-out">
              <Trash2 size={15} />
              <span>Delete project</span>
            </button>

            {/* Account block — signed-in email + sign-out, separated from
                project actions so destroying the project never reads like
                destroying the account. */}
            <div className="pt-4 mt-2 border-t border-gray-100">
              {auth.user?.email && (
                <div className="px-3 mb-2">
                  <div className="text-[9px] uppercase tracking-widest text-gray-400 font-bold mb-0.5">Signed in as</div>
                  <div className="text-[11px] text-gray-700 font-medium truncate" title={auth.user.email}>{auth.user.email}</div>
                </div>
              )}
              <button
                onClick={async () => {
                  await auth.signOut();
                  // Belt-and-braces: the onAuthStateChange listener will fire
                  // and the gate above will redirect, but doing it explicitly
                  // here avoids one render flash of the (now empty) sidebar.
                  window.location.replace('/landing-growth.html');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-lg text-sm font-medium transition-all duration-200 ease-out">
                <LogOut size={15} />
                <span>Sign out</span>
              </button>
              <div className="pt-3 px-3 text-[10px] text-gray-400">
                v1.1
              </div>
            </div>
          </div>
        </ul>
      </div>

      {/* Edit Project Modal */}
      {editingProject && (
        <ProjectSetup mode="edit" onClose={() => setEditingProject(false)} />
      )}

      {/* New Project Modal */}
      {newProject && (
        <ProjectSetup mode="new" onClose={() => setNewProject(false)} />
      )}

      {/* Delete Project confirmation */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
             onClick={() => setConfirmingDelete(false)}
             role="dialog" aria-modal="true" aria-labelledby="del-proj-title">
          <div className="glass-panel rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-rose-100 text-rose-600 p-2 rounded-xl" aria-hidden="true"><Trash2 size={18} /></div>
              <h2 id="del-proj-title" className="text-lg font-bold text-gray-900">Delete this project?</h2>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">
              This erases the project and all its data — personas, strategy, leads, tracked posts and content settings.
              This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button
                onClick={performDeleteProject}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors flex items-center gap-2">
                <Trash2 size={14} /> Delete project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <AppInner />
      {/* Headless side-effect — polls the extension for pending auto-comment
          jobs, generates comments via Gemini, submits them back for posting.
          Mounting it at the root means auto-comment is active whenever the
          dashboard tab is open, on any view. */}
      <AutoCommentProcessor />
    </ProjectProvider>
  );
}
