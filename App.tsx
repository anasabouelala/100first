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
import { ExtensionInstallBanner } from './components/ExtensionInstallBanner';
import { useI18n, useT } from './contexts/I18nContext';
import { PlaybookView } from './components/PlaybookView';
import {
  Zap, Menu, Home, ShieldCheck,
  Sparkles, Trash2, Plus, Crosshair, Settings2, Rss,
  LogOut, Loader2, ArrowUpRight, Clock, Languages, BookOpen
} from 'lucide-react';

// Unified section headers — i18n keys resolved at render so the header follows
// the active UI language.
const SECTION_META: Record<string, { titleKey: string; subtitleKey: string }> = {
  [AppMode.ANSWERLY_RADAR]:     { titleKey: 'section.postsTracker.title',  subtitleKey: 'section.postsTracker.subtitle' },
  [AppMode.ACCOUNT_FINDER]:     { titleKey: 'section.accountFinder.title', subtitleKey: 'section.accountFinder.subtitle' },
  [AppMode.FEED_WATCHER]:       { titleKey: 'section.feedWatcher.title',   subtitleKey: 'section.feedWatcher.subtitle' },
  [AppMode.CONTENT_ENGINE]:     { titleKey: 'section.contentEngine.title', subtitleKey: 'section.contentEngine.subtitle' },
  [AppMode.CONTENT_PARAMETERS]: { titleKey: 'section.voiceStudio.title',   subtitleKey: 'section.voiceStudio.subtitle' },
  [AppMode.PLAYBOOK]:           { titleKey: 'section.playbook.title',      subtitleKey: 'section.playbook.subtitle' },
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
  const t = useT();
  const [postsToday, setPostsToday] = useState(0);
  const [repliesToday, setRepliesToday] = useState(0);

  useEffect(() => {
    const load = () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const startMs = dayStart.getTime();

      // ── Posts added today ── counts every entry in social_radar_history
      // whose timestamp/discoveredAt is from today. That's the same store the
      // Tracked-posts feed reads, so the number stays in sync with what the
      // user is about to see.
      try {
        const hist = JSON.parse(localStorage.getItem('social_radar_history') || '[]');
        const count = Array.isArray(hist)
          ? hist.filter((p: any) => {
              const raw = p?.timestamp ?? p?.discoveredAt ?? p?.at;
              const t = typeof raw === 'number' ? raw : Date.parse(raw || '');
              return Number.isFinite(t) && t >= startMs;
            }).length
          : 0;
        setPostsToday(count);
      } catch { setPostsToday(0); }

      // ── Replies posted today ── same comment_log used everywhere else.
      try {
        const log = JSON.parse(localStorage.getItem('comment_log') || '[]');
        const count = Array.isArray(log)
          ? log.filter((e: any) => {
              const raw = e?.at ?? e?.timestamp;
              const t = typeof raw === 'number' ? raw : Date.parse(raw || '');
              return Number.isFinite(t) && t >= startMs;
            }).length
          : 0;
        setRepliesToday(count);
      } catch { setRepliesToday(0); }
    };
    load();
    const onSync     = () => load();
    const onCmtLoad  = () => load();
    const onHistory  = () => load();
    const onStorage  = (e: StorageEvent) => {
      if (e.key === 'social_radar_history' || e.key === 'comment_log') load();
    };
    window.addEventListener('answerly_sync', onSync);
    window.addEventListener('comment_log_loaded', onCmtLoad);
    window.addEventListener('answerly_history_update', onHistory);
    window.addEventListener('storage', onStorage);
    // Also rollover at midnight — refresh every 60s instead of 8s. With the
    // event listeners doing the heavy lifting we don't need a tight poll.
    const id = setInterval(load, 60000);
    return () => {
      window.removeEventListener('answerly_sync', onSync);
      window.removeEventListener('comment_log_loaded', onCmtLoad);
      window.removeEventListener('answerly_history_update', onHistory);
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={t('stats.aria', { posts: postsToday, replies: repliesToday })}
      className="w-full text-start rounded-2xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all p-3.5 group cursor-pointer"
      title={t('stats.tooltip', { posts: postsToday, replies: repliesToday })}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-500">{t('stats.today')}</span>
        <span className="flex items-center gap-1 text-[9px] font-bold text-gray-400 group-hover:text-gray-700 transition-colors">
          {t('stats.open')} <ArrowUpRight size={9} aria-hidden="true" />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 divide-x divide-gray-100 rtl:divide-x-reverse">
        <div className="pr-1 rtl:pr-0 rtl:pl-1">
          <div className="text-[20px] font-extrabold leading-none text-gray-900 tabular-nums">{postsToday}</div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-1.5 font-bold">{t('stats.newPosts')}</div>
        </div>
        <div className="pl-3 rtl:pl-0 rtl:pr-3">
          <div className="text-[20px] font-extrabold leading-none text-emerald-600 tabular-nums">{repliesToday}</div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-1.5 font-bold">{t('stats.replies')}</div>
        </div>
      </div>
    </button>
  );
};

// Single frosted-glass title bar shared by all sections.
const SectionGlassHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="glass-header px-4 py-3 sm:px-6 sm:py-4 mb-5 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
    <div className="bg-gray-900/90 text-white p-1.5 sm:p-2 rounded-lg sm:rounded-xl flex-shrink-0">
      <Zap size={16} className="sm:w-[18px] sm:h-[18px]" />
    </div>
    <div className="min-w-0">
      <h1 className="font-display text-lg sm:text-2xl font-bold text-gray-900 tracking-tight leading-tight sm:leading-none truncate">{title}</h1>
      <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1 truncate">{subtitle}</p>
    </div>
  </div>
);

function AppInner() {
  const { project, isComplete, clearProject } = useProject();
  const auth = useAuth();
  const { t, lang, toggle } = useI18n();
  const [mode, setMode] = useState<AppMode | 'DASHBOARD'>('DASHBOARD');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingProject, setEditingProject] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // ── 3-day trial ── Free access lasts 3 days from account creation. When it
  // elapses we show a message screen with a real Log out button (below); the
  // user logs out (session fully cleared) and lands on the marketing site,
  // where Sign in opens a fresh login for any account. Client-side gate for now.
  const TRIAL_DAYS = 3;
  // Admin emails get unlimited access (bypass the trial entirely).
  // Client-side for now — reinforce server-side (RLS) later if needed.
  const ADMIN_EMAILS = ['anasabouelala@gmail.com'];
  const isAdmin = !!auth.user?.email && ADMIN_EMAILS.includes(auth.user.email.trim().toLowerCase());
  const trialCreatedMs = auth.user?.created_at ? Date.parse(auth.user.created_at) : NaN;
  const trialEndsMs = Number.isFinite(trialCreatedMs) ? trialCreatedMs + TRIAL_DAYS * 86400000 : null;
  const trialExpired = !isAdmin && trialEndsMs !== null && Date.now() > trialEndsMs;

  // ── License heartbeat → Chrome extension ──
  // The extension checks `Date.now() < license.until` before every scheduled
  // sweep. If we hand it a 2-min TTL and only refresh while THIS tab is open,
  // closing the tab silently kills the Feed Watcher within ~2 min even though
  // Chrome keeps firing the alarm — that's the "doesn't run in the background"
  // bug. Instead, we mint a license bounded by the two things that SHOULD
  // dormant the agent (Supabase session expiry + trial deadline), capped at
  // 24h so a forgotten tab can't run indefinitely. Everything else the SW
  // needs (poll interval, Gemini key, voice profile) already persists in
  // chrome.storage.local and is re-armed by the extension's own
  // `bootstrapFeedWatch()` on every service-worker wake.
  useEffect(() => {
    const MAX_TTL_MS = 24 * 60 * 60 * 1000; // hard ceiling — a forgotten tab can't run past this
    const sessionExpSec = (auth.session as any)?.expires_at;
    const sessionExpMs = typeof sessionExpSec === 'number' ? sessionExpSec * 1000 : null;
    const active = !!auth.session && !trialExpired;
    const computeUntil = () => {
      const candidates: number[] = [Date.now() + MAX_TTL_MS];
      if (Number.isFinite(sessionExpMs as number)) candidates.push(sessionExpMs as number);
      // Admins have unlimited access, so we don't bound by trialEndsMs for them.
      if (!isAdmin && Number.isFinite(trialEndsMs as number)) candidates.push(trialEndsMs as number);
      return Math.min(...candidates);
    };
    const push = () => {
      try {
        window.dispatchEvent(new CustomEvent('viraholic_license', {
          detail: active
            ? { active: true, until: computeUntil(), email: auth.user?.email || null }
            : { active: false }
        }));
      } catch {}
    };
    push();
    window.addEventListener('EXTENSION_BRIDGE_READY', push);
    // Still refresh while the tab is open — a Supabase token refresh gives us a
    // fresher `expires_at` to push down. 5 min is plenty; the whole point of
    // the durable `until` is that background polling no longer depends on it.
    const id = active ? window.setInterval(push, 5 * 60 * 1000) : undefined;
    return () => { window.removeEventListener('EXTENSION_BRIDGE_READY', push); if (id) clearInterval(id); };
  }, [auth.session, trialExpired, auth.user?.email, trialEndsMs, isAdmin]);

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
          <span className="text-sm">{t('auth.checking')}</span>
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
        <div className="text-sm text-gray-600">{t('auth.redirecting')}</div>
      </div>
    );
  }

  // ── 3-day trial gate ──
  // Show the message and let the user log out manually. signOut() (above)
  // fully clears the session, so they land on the marketing site signed out —
  // and "Sign in" there opens a fresh login for any account (no loop).
  if (trialExpired) {
    const logOut = async () => {
      try { await auth.signOut(); } catch {}
      try { localStorage.removeItem('project_config_v1'); } catch {}
      if (typeof window !== 'undefined') window.location.replace('/landing-growth.html');
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-5">
            <Clock size={26} className="text-amber-500" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('trial.title')}</h1>
          <p className="text-gray-500 mt-3 leading-relaxed">{t('trial.body')}</p>
          <button
            type="button"
            onClick={logOut}
            className="mt-7 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-black transition-colors"
          >
            <LogOut size={18} aria-hidden="true" /> {t('trial.logout')}
          </button>
        </div>
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
      title: t('nav.group.missionControl'),
      items: [
        { id: 'DASHBOARD', label: t('nav.item.dashboard'), icon: <Home size={18} /> },
        { id: AppMode.ANSWERLY_RADAR, label: t('section.postsTracker.title'), icon: <ShieldCheck size={18} /> },
        { id: AppMode.PLAYBOOK, label: t('section.playbook.title'), icon: <BookOpen size={18} /> },
      ]
    },
    {
      title: t('nav.group.growthOps'),
      items: [
        { id: AppMode.ACCOUNT_FINDER, label: t('section.accountFinder.title'), icon: <Crosshair size={18} /> },
        { id: AppMode.FEED_WATCHER,   label: t('section.feedWatcher.title'),   icon: <Rss size={18} /> },
      ]
    },
    {
      title: t('nav.group.execution'),
      items: [
        { id: AppMode.CONTENT_ENGINE, label: t('section.contentEngine.title'), icon: <Sparkles size={18} /> },
        { id: AppMode.CONTENT_PARAMETERS, label: t('section.voiceStudio.title'), icon: <Settings2 size={18} /> },
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
      case AppMode.PLAYBOOK:        return <>{projectHeader}<PlaybookView /></>;

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
            <label htmlFor="my-drawer-2" className="btn btn-square btn-ghost min-h-[44px] min-w-[44px]" aria-label={t('sidebar.openMenu')}>
              <Menu aria-hidden="true" />
            </label>
          </div>
          <div className="flex-1 px-2 mx-2 font-display font-bold text-xl">Viraholic</div>
        </div>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 xl:p-10 overflow-x-hidden">
          <ExtensionInstallBanner />
          {SECTION_META[mode] && (
            <SectionGlassHeader title={t(SECTION_META[mode].titleKey)} subtitle={t(SECTION_META[mode].subtitleKey)} />
          )}
          {renderContent()}
        </main>
      </div>

      <div className="drawer-side z-50 shadow-xl lg:shadow-none">
        <label htmlFor="my-drawer-2" aria-label="close sidebar" className="drawer-overlay"></label>
        <ul className="menu p-4 w-80 min-h-full glass-sidebar text-gray-700 flex flex-col justify-between">
          <div>
            <div className="px-4 py-4 mb-3 flex items-center gap-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Zap className="text-primary" size={24} />
              </div>
              <div>
                <h1 className="font-display font-bold text-xl leading-none tracking-tight text-gray-900">Viraholic</h1>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label={t('lang.switch')}
                title={t('lang.switch')}
                className="ms-auto inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                <Languages size={13} aria-hidden="true" />
                {lang === 'ar' ? 'EN' : 'ع'}
              </button>
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
                          ? 'grad-btn'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
              <span>{t('sidebar.newProject')}</span>
            </button>

            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-all duration-200 ease-out">
              <Trash2 size={15} />
              <span>{t('sidebar.deleteProject')}</span>
            </button>

            {/* Account block — signed-in email + sign-out, separated from
                project actions so destroying the project never reads like
                destroying the account. */}
            <div className="pt-4 mt-2 border-t border-gray-100">
              {auth.user?.email && (
                <div className="px-3 mb-2">
                  <div className="text-[9px] uppercase tracking-widest text-gray-400 font-bold mb-0.5">{t('sidebar.signedInAs')}</div>
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
                <span>{t('sidebar.signOut')}</span>
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
              <h2 id="del-proj-title" className="text-lg font-bold text-gray-900">{t('delete.title')}</h2>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">{t('delete.body')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={performDeleteProject}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors flex items-center gap-2">
                <Trash2 size={14} /> {t('sidebar.deleteProject')}
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
