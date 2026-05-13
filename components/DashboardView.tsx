import React, { useState, useEffect, useMemo } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { AppMode, BuyerPersonaAnalysis, StrategyPlan } from '../types';
import {
  Activity, Users, Crosshair, Radar, ShieldCheck, Globe, Sparkles, Target,
  TrendingUp, TrendingDown, Clock, ArrowRight, ArrowUpRight, Zap, CheckCircle2, Circle,
  Rocket, MessageSquarePlus, BarChart3, Briefcase, Building2, Layers
} from 'lucide-react';

interface Props {
  setMode: (m: AppMode | 'DASHBOARD') => void;
  onEditProject: () => void;
}

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════
const parseFirstNumber = (s: string | undefined): number => {
  if (!s) return 0;
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmKMbB])?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2]) {
    const u = m[2].toLowerCase();
    if (u === 'k') n *= 1000;
    else if (u === 'm') n *= 1_000_000;
    else if (u === 'b') n *= 1_000_000_000;
  }
  return n;
};
const formatBigNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
};
const timeAgo = (iso: string): string => {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch { return ''; }
};
const safeJSON = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};

// ═════════════════════════════════════════════════════════════════════
// Live data hook — pulls everything from localStorage with refresh
// ═════════════════════════════════════════════════════════════════════
const useDashboardData = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick(t => t + 1);
    window.addEventListener('storage', onChange);
    const i = setInterval(() => setTick(t => t + 1), 10000); // poll every 10s
    return () => { window.removeEventListener('storage', onChange); clearInterval(i); };
  }, []);

  return useMemo(() => {
    const personas: BuyerPersonaAnalysis | null = safeJSON('buyer_personas', null);
    const plan: StrategyPlan | null = safeJSON('strategy_plan_v2', null);
    const radarHistory: any[] = safeJSON('social_radar_history', []);
    const leads: any[] = safeJSON('pipeline_leads_unified', []);
    const trackedAccounts: any[] = safeJSON('answerly_creator_configs', []);
    const distributionStatus: Record<string, string> = safeJSON('distribution_status', {});

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

    // Total TAM from personas
    const totalTAM = personas?.personas?.reduce(
      (acc, p) => acc + parseFirstNumber(p.companyProfile?.estimatedTAM), 0
    ) || 0;

    // Pipeline funnel
    const tracked = trackedAccounts.length;
    const radar = radarHistory.length;
    const engaged = leads.filter(l => l.status === 'engaging' || l.status === 'qualified' || l.status === 'converted').length;
    const inPipeline = leads.length;

    // Distribution channels submitted+live
    const distActive = Object.values(distributionStatus)
      .filter(s => s === 'submitted' || s === 'live').length;
    const distLive = Object.values(distributionStatus).filter(s => s === 'live').length;

    return {
      personas, plan, radarHistory, leads, trackedAccounts, distributionStatus,
      buckets14d,
      signals7d, signalsPrev7d, signalsDelta,
      totalTAM,
      tracked, radar, engaged, inPipeline,
      distActive, distLive
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
};

// ═════════════════════════════════════════════════════════════════════
// KPI Card
// ═════════════════════════════════════════════════════════════════════
const KPICard: React.FC<{
  label: string;
  value: string | number;
  delta?: number;
  hint?: string;
  icon: React.ReactNode;
  accent: string;       // tailwind text color e.g. text-emerald-500
  bg: string;           // tailwind bg color e.g. bg-emerald-50
  spark?: number[];     // optional sparkline data
  onClick?: () => void;
}> = ({ label, value, delta, hint, icon, accent, bg, spark, onClick }) => {
  const trend = delta === undefined ? null : (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border border-gray-100 hover:border-gray-200 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all group ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-2xl ${bg} flex items-center justify-center ${accent}`}>
          {icon}
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-[10px] font-black tracking-widest uppercase px-2 py-1 rounded-md ${
            trend === 'up' ? 'bg-emerald-50 text-emerald-700' : trend === 'down' ? 'bg-rose-50 text-rose-700' : 'bg-gray-50 text-gray-500'
          }`}>
            {trend === 'up' && <TrendingUp size={10} />}
            {trend === 'down' && <TrendingDown size={10} />}
            {Math.abs(delta!)}%
          </div>
        )}
      </div>
      <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-1">{label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-black text-gray-900 font-mono tabular-nums">{value}</span>
        {onClick && <ArrowUpRight size={14} className="text-gray-300 group-hover:text-gray-700 transition-colors" />}
      </div>
      {hint && <div className="text-[11px] text-gray-400 mt-1 font-medium">{hint}</div>}
      {spark && spark.length > 0 && (
        <div className="mt-3 flex items-end gap-0.5 h-8">
          {spark.map((v, i) => {
            const max = Math.max(...spark, 1);
            const h = (v / max) * 100;
            return (
              <div key={i} className="flex-1 rounded-sm transition-all"
                style={{ height: `${Math.max(8, h)}%`, background: i === spark.length - 1 ? 'currentColor' : `${'currentColor'}` , opacity: i === spark.length - 1 ? 1 : 0.25 }} />
            );
          })}
        </div>
      )}
    </button>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Activity Chart (14-day area chart)
// ═════════════════════════════════════════════════════════════════════
const ActivityChart: React.FC<{ buckets: Array<{ date: Date; count: number }> }> = ({ buckets }) => {
  const W = 800, H = 180, PAD = 30;
  const max = Math.max(...buckets.map(b => b.count), 4);
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const avg = total / buckets.length;

  const xFor = (i: number) => PAD + ((W - PAD * 2) * i) / (buckets.length - 1);
  const yFor = (v: number) => H - PAD - ((v / max) * (H - PAD * 2));

  const pathPoints = buckets.map((b, i) => `${xFor(i)},${yFor(b.count)}`).join(' L ');
  const areaPath = `M ${xFor(0)},${H - PAD} L ${pathPoints} L ${xFor(buckets.length - 1)},${H - PAD} Z`;
  const linePath = `M ${pathPoints}`;

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-1">Radar Activity</div>
          <h3 className="text-lg font-bold text-gray-900">Last 14 days</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-black text-gray-900 font-mono tabular-nums leading-none">{total}</div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mt-1">total signals</div>
          </div>
          <div className="text-right border-l border-gray-100 pl-4">
            <div className="text-2xl font-black text-emerald-600 font-mono tabular-nums leading-none">{avg.toFixed(1)}</div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mt-1">daily avg</div>
          </div>
        </div>
      </div>

      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y grid lines */}
        {[0.25, 0.5, 0.75].map((p, i) => (
          <line key={i} x1={PAD} y1={H - PAD - (H - PAD * 2) * p} x2={W - PAD} y2={H - PAD - (H - PAD * 2) * p}
            stroke="#f3f4f6" strokeDasharray="2,3" />
        ))}

        {/* Area */}
        <path d={areaPath} fill="url(#actGrad)" />
        {/* Line */}
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots */}
        {buckets.map((b, i) => (
          <g key={i}>
            <circle cx={xFor(i)} cy={yFor(b.count)} r={3.5} fill="white" stroke="#10b981" strokeWidth={2} />
            {b.count > 0 && (
              <text x={xFor(i)} y={yFor(b.count) - 10} fontSize={10} fontWeight={700} fill="#10b981" textAnchor="middle">
                {b.count}
              </text>
            )}
          </g>
        ))}

        {/* X axis labels */}
        {[0, 6, 13].map(i => (
          <text key={i} x={xFor(i)} y={H - 8} fontSize={9} fontWeight={700} fill="#9ca3af" textAnchor="middle" className="uppercase tracking-widest">
            {i === 13 ? 'Today' : i === 0 ? '14d ago' : '7d ago'}
          </text>
        ))}
      </svg>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Pipeline Funnel
// ═════════════════════════════════════════════════════════════════════
const Funnel: React.FC<{
  tracked: number;
  radar: number;
  engaged: number;
  inPipeline: number;
}> = ({ tracked, radar, engaged, inPipeline }) => {
  const stages = [
    { label: 'Tracked',   value: tracked,    color: 'bg-sky-500',     text: 'text-sky-700',     bg: 'bg-sky-50' },
    { label: 'Radar hits', value: radar,     color: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
    { label: 'In pipeline', value: inPipeline, color: 'bg-violet-500', text: 'text-violet-700',  bg: 'bg-violet-50' },
    { label: 'Engaged',   value: engaged,    color: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50' }
  ];
  const max = Math.max(...stages.map(s => s.value), 1);

  const conv = (a: number, b: number) => a === 0 ? 0 : Math.round((b / a) * 100);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-1">Engagement Funnel</div>
          <h3 className="text-lg font-bold text-gray-900">Pipeline conversion</h3>
        </div>
        <BarChart3 size={20} className="text-gray-200" />
      </div>
      <div className="space-y-3">
        {stages.map((s, i) => {
          const pct = (s.value / max) * 100;
          const next = stages[i + 1];
          const convPct = next ? conv(s.value, next.value) : null;
          return (
            <div key={s.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-black tracking-widest uppercase text-gray-500">{s.label}</span>
                <span className={`text-lg font-black font-mono tabular-nums ${s.text}`}>{s.value}</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${s.color} rounded-full transition-all duration-700`}
                  style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
              {convPct !== null && (
                <div className="flex items-center justify-end mt-1">
                  <span className="text-[9px] font-bold tracking-widest uppercase text-gray-400">
                    {convPct}% → {next!.label.toLowerCase()}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Recent Activity Feed
// ═════════════════════════════════════════════════════════════════════
const ActivityFeed: React.FC<{ radar: any[]; setMode: Props['setMode'] }> = ({ radar, setMode }) => {
  const items = radar
    .slice()
    .sort((a, b) => new Date(b.timestamp || b.discoveredAt || 0).getTime() - new Date(a.timestamp || a.discoveredAt || 0).getTime())
    .slice(0, 6);

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 h-full">
        <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-1">Live activity</div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Nothing yet</h3>
        <div className="py-8 text-center">
          <Radar size={28} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400 mb-3">Track accounts to see real-time signal activity</p>
          <button onClick={() => setMode(AppMode.ACCOUNT_FINDER)}
            className="inline-flex items-center gap-1.5 text-xs font-black tracking-widest uppercase text-primary hover:underline">
            Find accounts <ArrowRight size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-0.5">Live activity</div>
          <h3 className="text-lg font-bold text-gray-900">Recent radar hits</h3>
        </div>
        <button onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
          className="text-[10px] font-black tracking-widest uppercase text-primary hover:underline flex items-center gap-1">
          View all <ArrowRight size={11} />
        </button>
      </div>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 group">
            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 flex-shrink-0 ring-4 ring-emerald-100" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-sm font-bold text-gray-900 truncate">@{item.creator || item.author || 'unknown'}</span>
                <span className="text-[10px] text-gray-400 font-mono tabular-nums flex-shrink-0 flex items-center gap-1">
                  <Clock size={9} /> {timeAgo(item.timestamp || item.discoveredAt || '')}
                </span>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 leading-snug">{item.text || item.body || item.title || 'New activity detected'}</p>
              {item.platform && (
                <span className="inline-block mt-1 text-[9px] font-black tracking-widest uppercase text-gray-400">
                  {item.platform}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Project Health (radial completion + checklist)
// ═════════════════════════════════════════════════════════════════════
const ProjectHealth: React.FC<{
  hasProject: boolean;
  hasPersonas: boolean;
  hasStrategy: boolean;
  hasTracked: boolean;
  hasRadar: boolean;
  hasDistribution: boolean;
  setMode: Props['setMode'];
}> = ({ hasProject, hasPersonas, hasStrategy, hasTracked, hasRadar, hasDistribution, setMode }) => {
  const items = [
    { done: hasProject,      label: 'Project configured',  action: undefined,                 sub: 'Required' },
    { done: hasPersonas,     label: 'Buyer personas',      action: () => setMode(AppMode.PERSONA),         sub: 'AI-generated' },
    { done: hasStrategy,     label: 'Launch strategy',     action: () => setMode(AppMode.STRATEGY),        sub: '100-user roadmap' },
    { done: hasTracked,      label: 'Tracked accounts',    action: () => setMode(AppMode.ACCOUNT_FINDER),  sub: 'Find your ICP' },
    { done: hasRadar,        label: 'Radar signals',       action: () => setMode(AppMode.ANSWERLY_RADAR),  sub: 'Live intent data' },
    { done: hasDistribution, label: 'Distribution channels', action: () => setMode(AppMode.DISTRIBUTION),  sub: 'Submission tracker' }
  ];
  const done = items.filter(i => i.done).length;
  const pct = Math.round((done / items.length) * 100);

  // Circle math
  const r = 36, c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-1">Project health</div>
          <h3 className="text-lg font-bold text-gray-900">Setup score</h3>
        </div>
        <svg width={90} height={90} viewBox="0 0 90 90">
          <circle cx={45} cy={45} r={r} stroke="#f3f4f6" strokeWidth={8} fill="none" />
          <circle cx={45} cy={45} r={r}
            stroke={pct < 50 ? '#f59e0b' : pct < 80 ? '#3b82f6' : '#10b981'}
            strokeWidth={8} fill="none"
            strokeDasharray={c} strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 45 45)"
            style={{ transition: 'stroke-dashoffset 800ms ease-out' }} />
          <text x={45} y={48} fontSize={20} fontWeight={900} fill="#111827" textAnchor="middle" dominantBaseline="middle" className="tabular-nums">
            {pct}<tspan fontSize={10} fill="#9ca3af">%</tspan>
          </text>
        </svg>
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i}>
            <button onClick={it.action} disabled={!it.action}
              className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left transition-colors ${it.action ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}>
              {it.done ? (
                <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
              ) : (
                <Circle size={16} className="text-gray-300 flex-shrink-0" />
              )}
              <span className={`text-sm font-medium flex-1 truncate ${it.done ? 'text-gray-700' : 'text-gray-500'}`}>{it.label}</span>
              <span className="text-[9px] font-bold tracking-widest uppercase text-gray-300 flex-shrink-0">{it.sub}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Top Personas mini-card
// ═════════════════════════════════════════════════════════════════════
const TopPersonas: React.FC<{ personas: BuyerPersonaAnalysis | null; setMode: Props['setMode'] }> = ({ personas, setMode }) => {
  if (!personas || !personas.personas?.length) {
    return (
      <div className="bg-gradient-to-br from-violet-500 to-indigo-600 rounded-3xl shadow-xl p-6 text-white relative overflow-hidden">
        <Users size={120} className="absolute -bottom-8 -right-4 opacity-10" />
        <div className="relative">
          <div className="text-[10px] font-black tracking-widest uppercase text-white/60 mb-2">Buyer intel</div>
          <h3 className="text-2xl font-display font-bold mb-1">Map your buyers</h3>
          <p className="text-sm text-white/70 leading-relaxed mb-5">Generate 3 ICP-grade personas with TAM, watering holes, and outreach playbook.</p>
          <button onClick={() => setMode(AppMode.PERSONA)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-violet-700 text-xs font-black tracking-widest uppercase rounded-xl hover:bg-violet-50 transition-colors">
            Generate <ArrowRight size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-0.5">Active personas</div>
          <h3 className="text-lg font-bold text-gray-900">Top ICPs</h3>
        </div>
        <button onClick={() => setMode(AppMode.PERSONA)}
          className="text-[10px] font-black tracking-widest uppercase text-primary hover:underline flex items-center gap-1">
          Open dashboard <ArrowRight size={11} />
        </button>
      </div>
      <div className="space-y-3">
        {personas.personas.slice(0, 3).map((p, idx) => {
          const colors = ['#0ea5e9', '#f59e0b', '#8b5cf6'];
          const color = colors[idx % colors.length];
          const tam = parseFirstNumber(p.companyProfile?.estimatedTAM);
          return (
            <div key={idx} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
              <div className="w-9 h-9 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 0 2px white, 0 0 0 4px ${color}30` }}>
                <img src={`https://api.dicebear.com/7.x/avataaars-neutral/svg?seed=${encodeURIComponent(p.avatarSeed || p.name)}&backgroundColor=transparent&radius=50`}
                  alt={p.name} className="w-full h-full rounded-full" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-gray-900 truncate">{p.name}</div>
                <div className="text-[11px] text-gray-500 truncate">{p.role}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-black text-gray-900 font-mono tabular-nums">
                  {tam > 0 ? `~${formatBigNumber(tam)}` : '—'}
                </div>
                <div className="text-[9px] font-bold tracking-widest uppercase text-gray-400">TAM</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════
export const DashboardView: React.FC<Props> = ({ setMode, onEditProject }) => {
  const { project } = useProject();
  const data = useDashboardData();

  // Build sparkline from 14d activity (last 7 values)
  const radarSpark = data.buckets14d.slice(7).map(b => b.count);

  // Project completion calculations
  const hasProject     = !!project;
  const hasPersonas    = !!(data.personas && data.personas.personas?.length);
  const hasStrategy    = !!data.plan;
  const hasTracked     = data.trackedAccounts.length > 0;
  const hasRadar       = data.radarHistory.length > 0;
  const hasDistribution = Object.keys(data.distributionStatus).length > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ═════════ HEADER ═════════ */}
      <div className="bg-gray-900 rounded-3xl p-8 lg:p-10 text-white relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 opacity-[0.03] rotate-12">
          <Zap size={320} />
        </div>
        <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3 text-[10px] font-black tracking-[0.3em] uppercase">
              <span className="flex items-center gap-1.5 text-primary">
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                Active project
              </span>
              <button onClick={onEditProject} className="text-white/40 hover:text-white transition-colors">Edit ›</button>
            </div>
            <h1 className="text-4xl lg:text-5xl font-display font-bold tracking-tight mb-2 truncate">{project!.productName}</h1>
            <p className="text-white/50 text-base max-w-2xl line-clamp-2 leading-relaxed">{project!.pitch}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 bg-white/5 rounded-full border border-white/10">{project!.category}</span>
              <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 bg-white/5 rounded-full border border-white/10">{project!.targetAudience}</span>
              {project!.stage && (
                <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 bg-primary/20 text-primary rounded-full border border-primary/30">{project!.stage}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setMode(AppMode.ACCOUNT_FINDER)}
              className="inline-flex items-center gap-2 px-6 h-12 bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-xl shadow-primary/20 transition-all hover:scale-[1.02]">
              <Crosshair size={18} /> Find Accounts
            </button>
            <button onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
              className="inline-flex items-center gap-2 px-6 h-12 bg-white/10 hover:bg-white/20 border border-white/10 text-white font-bold rounded-2xl backdrop-blur-md transition-all">
              <ShieldCheck size={18} /> View Radar
            </button>
          </div>
        </div>
      </div>

      {/* ═════════ KPI STRIP ═════════ */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPICard
          label="Tracked accounts"
          value={data.tracked}
          hint={data.tracked === 0 ? 'Tap to find your first' : `${data.tracked} on stealth radar`}
          icon={<Crosshair size={18} />}
          accent="text-sky-600" bg="bg-sky-50"
          onClick={() => setMode(AppMode.ACCOUNT_FINDER)}
        />
        <KPICard
          label="Radar signals 7d"
          value={data.signals7d}
          delta={data.signalsDelta}
          hint={`${data.signalsPrev7d} previous week`}
          icon={<Radar size={18} />}
          accent="text-emerald-600" bg="bg-emerald-50"
          spark={radarSpark}
          onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
        />
        <KPICard
          label="Personas mapped"
          value={data.personas?.personas?.length || 0}
          hint={hasPersonas ? `~${formatBigNumber(data.totalTAM)} total TAM` : 'Generate ICPs'}
          icon={<Users size={18} />}
          accent="text-violet-600" bg="bg-violet-50"
          onClick={() => setMode(AppMode.PERSONA)}
        />
        <KPICard
          label="In pipeline"
          value={data.inPipeline}
          hint={data.engaged > 0 ? `${data.engaged} engaged` : 'No leads yet'}
          icon={<Briefcase size={18} />}
          accent="text-amber-600" bg="bg-amber-50"
          onClick={() => setMode(AppMode.ANSWERLY_RADAR)}
        />
        <KPICard
          label="Distribution"
          value={data.distActive}
          hint={data.distLive > 0 ? `${data.distLive} live` : 'Find channels'}
          icon={<Globe size={18} />}
          accent="text-pink-600" bg="bg-pink-50"
          onClick={() => setMode(AppMode.DISTRIBUTION)}
        />
        <KPICard
          label="Strategy"
          value={hasStrategy ? '✓' : '—'}
          hint={hasStrategy ? `${data.plan!.phases?.length || 0} phases planned` : 'Roadmap pending'}
          icon={<Target size={18} />}
          accent="text-indigo-600" bg="bg-indigo-50"
          onClick={() => setMode(AppMode.STRATEGY)}
        />
      </div>

      {/* ═════════ MAIN GRID ═════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ActivityChart buckets={data.buckets14d} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Funnel
              tracked={data.tracked}
              radar={data.radar}
              engaged={data.engaged}
              inPipeline={data.inPipeline}
            />
            <TopPersonas personas={data.personas} setMode={setMode} />
          </div>
        </div>

        <div className="space-y-6">
          <ProjectHealth
            hasProject={hasProject}
            hasPersonas={hasPersonas}
            hasStrategy={hasStrategy}
            hasTracked={hasTracked}
            hasRadar={hasRadar}
            hasDistribution={hasDistribution}
            setMode={setMode}
          />
          <ActivityFeed radar={data.radarHistory} setMode={setMode} />
        </div>
      </div>

      {/* ═════════ QUICK ACTIONS ═════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction
          onClick={() => setMode(AppMode.CONTENT_ENGINE)}
          icon={<Sparkles size={20} />}
          title="Generate content"
          desc="Voice-matched posts in your tone"
          gradient="from-purple-500 to-pink-500"
        />
        <QuickAction
          onClick={() => setMode(AppMode.DISTRIBUTION)}
          icon={<Globe size={20} />}
          title="Find channels"
          desc="Best places to launch & post"
          gradient="from-amber-500 to-orange-500"
        />
        <QuickAction
          onClick={() => setMode(AppMode.RECON)}
          icon={<Layers size={20} />}
          title="Competitor recon"
          desc="Reverse-engineer who's winning"
          gradient="from-rose-500 to-red-500"
        />
        <QuickAction
          onClick={() => setMode(AppMode.STRATEGY)}
          icon={<Rocket size={20} />}
          title="Launch plan"
          desc="100-user battle plan"
          gradient="from-indigo-500 to-blue-600"
        />
      </div>
    </div>
  );
};

const QuickAction: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  gradient: string;
}> = ({ onClick, icon, title, desc, gradient }) => (
  <button onClick={onClick}
    className={`group relative overflow-hidden bg-gradient-to-br ${gradient} rounded-3xl p-5 text-left text-white shadow-lg hover:shadow-2xl transition-all hover:scale-[1.02] active:scale-100`}>
    <div className="absolute -top-4 -right-4 opacity-10 rotate-12 group-hover:scale-110 group-hover:rotate-0 transition-transform duration-500">
      {React.cloneElement(icon as any, { size: 80 })}
    </div>
    <div className="relative">
      <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-md mb-3">
        {icon}
      </div>
      <div className="text-base font-black mb-1">{title}</div>
      <div className="text-xs text-white/70 leading-snug mb-3">{desc}</div>
      <div className="flex items-center gap-1 text-[10px] font-black tracking-widest uppercase text-white/90">
        Launch <ArrowRight size={11} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  </button>
);
