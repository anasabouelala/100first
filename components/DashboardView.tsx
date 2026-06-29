import React, { useState, useEffect, useMemo } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { AppMode } from '../types';
import {
  Crosshair, Radar, Briefcase, TrendingUp, TrendingDown, ArrowUpRight,
  Sparkles, Rss, ArrowRight
} from 'lucide-react';

interface Props {
  setMode: (m: AppMode | 'DASHBOARD') => void;
  onEditProject: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────
const safeJSON = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};

// ─── Live data hook ─────────────────────────────────────────────────
const useDashboardData = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick(t => t + 1);
    // `storage` only fires for OTHER tabs; the in-app custom events cover same-tab
    // updates so the dashboard reflects new posts/replies without the 10s wait.
    window.addEventListener('storage', onChange);
    window.addEventListener('answerly_sync', onChange);
    window.addEventListener('answerly_history_update', onChange);
    window.addEventListener('comment_log_loaded', onChange);
    const i = setInterval(() => setTick(t => t + 1), 10000);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('answerly_sync', onChange);
      window.removeEventListener('answerly_history_update', onChange);
      window.removeEventListener('comment_log_loaded', onChange);
      clearInterval(i);
    };
  }, []);

  return useMemo(() => {
    const radarHistory: any[] = safeJSON('social_radar_history', []);
    const leads: any[] = safeJSON('pipeline_leads_unified', []);
    const trackedAccounts: any[] = safeJSON('answerly_creator_configs', []);
    const answeredLog: any[] = safeJSON('comment_log', []);

    // 14-day activity buckets
    const buckets14d = Array.from({ length: 14 }, (_, i) => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); dayStart.setDate(dayStart.getDate() - (13 - i));
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const count = radarHistory.filter(r => {
        const t = new Date(r.timestamp || r.discoveredAt || 0).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      }).length;
      return { date: dayStart, count };
    });

    const signals7d = buckets14d.slice(7).reduce((a, b) => a + b.count, 0);
    const signalsPrev7d = buckets14d.slice(0, 7).reduce((a, b) => a + b.count, 0);
    const signalsDelta = signalsPrev7d === 0 ? (signals7d > 0 ? 100 : 0)
      : Math.round(((signals7d - signalsPrev7d) / signalsPrev7d) * 100);

    return {
      buckets14d,
      signals7d, signalsPrev7d, signalsDelta,
      tracked: trackedAccounts.length,
      inPipeline: leads.length,
      answered: answeredLog.length
    };
  }, [tick]);
};

// ─── Minimal KPI ────────────────────────────────────────────────────
const KPI: React.FC<{
  label: string;
  value: string | number;
  delta?: number;
  hint?: string;
  icon: React.ReactNode;
  onClick?: () => void;
}> = ({ label, value, delta, hint, icon, onClick }) => {
  const trend = delta === undefined ? null : (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
  return (
    <button
      onClick={onClick}
      aria-label={onClick ? `${label}: ${value}. Open` : undefined}
      className={`group text-left bg-white border border-gray-100 hover:border-gray-300 hover:shadow-sm rounded-2xl p-5
                  transition-all duration-200 ease-out active:scale-[0.99]
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                  ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center justify-between mb-4 text-gray-500">
        <span className="flex items-center gap-2 text-xs font-medium text-gray-600">
          {icon}
          <span>{label}</span>
        </span>
        {onClick && <ArrowUpRight size={13} className="text-gray-400 group-hover:text-gray-800 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-gray-900 tabular-nums">{value}</span>
        {trend && trend !== 'flat' && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
            trend === 'up' ? 'text-emerald-600' : 'text-rose-600'
          }`}>
            {trend === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(delta!)}%
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </button>
  );
};

// ─── Activity Chart — minimal area chart ────────────────────────────
const ActivityChart: React.FC<{ buckets: Array<{ date: Date; count: number }>; total: number; avg: number }> = ({ buckets, total, avg }) => {
  const W = 800, H = 200, PAD = 24;
  const max = Math.max(...buckets.map(b => b.count), 4);

  const xFor = (i: number) => PAD + ((W - PAD * 2) * i) / (buckets.length - 1);
  const yFor = (v: number) => H - PAD - ((v / max) * (H - PAD * 2));

  const pathPoints = buckets.map((b, i) => `${xFor(i)},${yFor(b.count)}`).join(' L ');
  const areaPath = `M ${xFor(0)},${H - PAD} L ${pathPoints} L ${xFor(buckets.length - 1)},${H - PAD} Z`;
  const linePath = `M ${pathPoints}`;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900 tracking-tight">Posts Tracker activity</h3>
          <p className="text-[12px] text-gray-500 mt-0.5">Posts captured in the last 14 days.</p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-xl font-semibold text-gray-900 tabular-nums leading-none">{total}</div>
            <div className="text-[11px] text-gray-500 mt-1">Total signals</div>
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-900 tabular-nums leading-none">{avg.toFixed(1)}</div>
            <div className="text-[11px] text-gray-500 mt-1">Daily avg</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        {/* preserveAspectRatio="none" stretches X to fill width; vector-effect keeps
            the stroke a uniform 1.5px and we skip per-point dots (which would
            otherwise distort into ovals under the non-uniform scale). */}
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          role="img"
          aria-label={`Posts captured per day over the last 14 days. ${total} total, ${avg.toFixed(1)} per day on average.`}>
          <defs>
            <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#111827" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#111827" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.33, 0.66].map((p, i) => (
            <line key={i} x1={PAD} y1={H - PAD - (H - PAD * 2) * p} x2={W - PAD} y2={H - PAD - (H - PAD * 2) * p}
              stroke="#f3f4f6" vectorEffect="non-scaling-stroke" />
          ))}

          <path d={areaPath} fill="url(#actGrad)" />
          <path d={linePath} fill="none" stroke="#111827" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
            vectorEffect="non-scaling-stroke" />

          {[0, 6, 13].map(i => (
            <text key={i} x={xFor(i)} y={H - 6} fontSize={10} fill="#6b7280" textAnchor="middle">
              {i === 13 ? 'Today' : i === 0 ? '14d ago' : '7d ago'}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
};

// ─── Get started — first-run empty state ────────────────────────────
// A brand-new account lands here with all zeros and a flat chart. Instead of
// that dead end, point them at the three moves that produce their first wins.
const GetStarted: React.FC<{ setMode: (m: AppMode | 'DASHBOARD') => void }> = ({ setMode }) => {
  const steps: Array<{ icon: React.ReactNode; title: string; desc: string; cta: string; mode: AppMode }> = [
    { icon: <Crosshair size={18} />, title: 'Find accounts to track', desc: 'Pick creators in your niche — Viraholic watches their posts for you.', cta: 'Find accounts', mode: AppMode.ACCOUNT_FINDER },
    { icon: <Rss size={18} />, title: 'Watch your feed', desc: 'Auto-surface buying-intent posts from your own home feed.', cta: 'Set up Feed Watcher', mode: AppMode.FEED_WATCHER },
    { icon: <Sparkles size={18} />, title: 'Generate content', desc: 'Draft posts and replies in your voice that actually convert.', cta: 'Open Content Engine', mode: AppMode.CONTENT_ENGINE },
  ];
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900 tracking-tight">Get started</h3>
        <p className="text-[12px] text-gray-500 mt-0.5">Three quick moves to your first wins — pick any to begin.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <button
            key={s.title}
            onClick={() => setMode(s.mode)}
            className="group relative text-left bg-white border border-gray-100 hover:border-primary/40 hover:shadow-sm
                       rounded-2xl p-5 transition-all duration-200 ease-out active:scale-[0.99]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="absolute top-4 right-4 text-[11px] font-black tabular-nums text-gray-300 group-hover:text-primary/50 transition-colors">
              {i + 1}
            </span>
            <span className="inline-flex w-9 h-9 rounded-xl bg-primary/10 text-primary items-center justify-center mb-3">
              {s.icon}
            </span>
            <div className="text-sm font-semibold text-gray-900">{s.title}</div>
            <div className="text-[12px] text-gray-500 mt-1 leading-relaxed">{s.desc}</div>
            <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
              {s.cta}
              <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

// ─── MAIN DASHBOARD — minimalist, 3 KPIs + 1 graph ──────────────────
export const DashboardView: React.FC<Props> = ({ setMode, onEditProject }) => {
  const { project } = useProject();
  const data = useDashboardData();

  const total = data.buckets14d.reduce((a, b) => a + b.count, 0);
  const avg = total / data.buckets14d.length;

  // No activity yet → guide the user instead of showing a flat, empty chart.
  const isEmpty = data.tracked === 0 && data.answered === 0 && total === 0;
  // Onboarding now only requires a name, so pitch/audience are often blank —
  // which makes the AI generic. Nudge (don't force) the user to fill them.
  const profileIncomplete = !!project && (!project.pitch?.trim() || !project.targetAudience?.trim());

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in">

      {/* Discreet project badge */}
      {project && (
        <button
          onClick={onEditProject}
          className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:border-gray-400 transition-all"
          title="Edit project"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold text-gray-900">{project.productName}</span>
          {project.stage && <span className="text-[10px] text-gray-500">· {project.stage}</span>}
          <span className="text-[10px] text-gray-400 group-hover:text-gray-700 transition-colors">Edit</span>
        </button>
      )}

      {/* Header */}
      <header className="space-y-1">
        <h2 className="text-2xl font-display font-semibold text-gray-900 tracking-tight">Dashboard</h2>
        <p className="text-sm text-gray-600">A quick read on what's moving.</p>
      </header>

      {/* Profile-completion nudge — only when pitch/audience are missing */}
      {profileIncomplete && (
        <button
          onClick={onEditProject}
          className="w-full text-left flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 hover:bg-amber-50 px-4 py-3 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
          <span className="flex-shrink-0 w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Sparkles size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900">Sharpen your AI output</span>
            <span className="block text-xs text-gray-600">
              Add your pitch{!project?.targetAudience?.trim() ? ' and target audience' : ''} so content and replies sound on-brand instead of generic.
            </span>
          </span>
          <span className="flex-shrink-0 text-xs font-semibold text-amber-700 inline-flex items-center gap-1">
            Complete <ArrowRight size={13} />
          </span>
        </button>
      )}

      {/* 3 KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KPI
          label="Tracked accounts"
          value={data.tracked}
          icon={<Crosshair size={13} />}
          hint={data.tracked === 0 ? 'Tap to find your first' : 'Being watched 24/7'}
          onClick={() => setMode(AppMode.ACCOUNT_FINDER)}
        />
        <KPI
          label="Tracked posts · 7d"
          value={data.signals7d}
          delta={data.signals7d === 0 && data.signalsPrev7d === 0 ? undefined : data.signalsDelta}
          icon={<Radar size={13} />}
          hint={`${data.signalsPrev7d} previous week`}
          onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
        />
        <KPI
          label="Answered posts"
          value={data.answered}
          icon={<Briefcase size={13} />}
          hint={data.answered === 0 ? 'No replies posted yet' : 'Replies posted'}
          onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
        />
      </div>

      {/* Empty → guide; otherwise → activity graph */}
      {isEmpty
        ? <GetStarted setMode={setMode} />
        : <ActivityChart buckets={data.buckets14d} total={total} avg={avg} />}
    </div>
  );
};
