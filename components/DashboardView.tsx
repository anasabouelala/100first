import React, { useState, useEffect, useMemo } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { AppMode, BuyerPersonaAnalysis, StrategyPlan } from '../types';
import {
  Crosshair, Radar, Briefcase, TrendingUp, TrendingDown, ArrowUpRight
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
    window.addEventListener('storage', onChange);
    const i = setInterval(() => setTick(t => t + 1), 10000);
    return () => { window.removeEventListener('storage', onChange); clearInterval(i); };
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
      className={`group text-left bg-white border border-gray-100 hover:border-gray-300 hover:shadow-sm rounded-2xl p-5
                  transition-all duration-200 ease-out active:scale-[0.99]
                  ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center justify-between mb-4 text-gray-400">
        <span className="flex items-center gap-2 text-xs text-gray-500">
          {icon}
          <span>{label}</span>
        </span>
        {onClick && <ArrowUpRight size={13} className="text-gray-200 group-hover:text-gray-700 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200" />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-medium text-gray-900 tabular-nums">{value}</span>
        {trend && trend !== 'flat' && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
            trend === 'up' ? 'text-emerald-600' : 'text-rose-600'
          }`}>
            {trend === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(delta!)}%
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-gray-400 mt-1">{hint}</div>}
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
          <h3 className="text-[15px] font-medium text-gray-900 tracking-tight">Posts Tracker activity</h3>
          <p className="text-[12px] text-gray-400 mt-0.5">Posts captured in the last 14 days.</p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-xl font-medium text-gray-900 tabular-nums leading-none">{total}</div>
            <div className="text-[11px] text-gray-400 mt-1">Total signals</div>
          </div>
          <div>
            <div className="text-xl font-medium text-gray-900 tabular-nums leading-none">{avg.toFixed(1)}</div>
            <div className="text-[11px] text-gray-400 mt-1">Daily avg</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#111827" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#111827" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.33, 0.66].map((p, i) => (
            <line key={i} x1={PAD} y1={H - PAD - (H - PAD * 2) * p} x2={W - PAD} y2={H - PAD - (H - PAD * 2) * p}
              stroke="#f3f4f6" />
          ))}

          <path d={areaPath} fill="url(#actGrad)" />
          <path d={linePath} fill="none" stroke="#111827" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

          {buckets.map((b, i) => (
            <g key={i}>
              <circle cx={xFor(i)} cy={yFor(b.count)} r={2.5} fill="#111827" />
            </g>
          ))}

          {[0, 6, 13].map(i => (
            <text key={i} x={xFor(i)} y={H - 6} fontSize={10} fill="#9ca3af" textAnchor="middle">
              {i === 13 ? 'Today' : i === 0 ? '14d ago' : '7d ago'}
            </text>
          ))}
        </svg>
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

  return (
    <div className="max-w-5xl mx-auto space-y-10 animate-fade-in">

      {/* Discreet project badge */}
      {project && (
        <button
          onClick={onEditProject}
          className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:border-gray-400 transition-all"
          title="Edit project"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-xs font-medium text-gray-900">{project.productName}</span>
          {project.stage && <span className="text-[10px] text-gray-400">· {project.stage}</span>}
          <span className="text-[10px] text-gray-300 group-hover:text-gray-600 transition-colors">Edit</span>
        </button>
      )}

      {/* Header */}
      <header className="space-y-1">
        <h2 className="text-2xl font-display font-medium text-gray-900 tracking-tight">Dashboard</h2>
        <p className="text-sm text-gray-500">A quick read on what's moving.</p>
      </header>

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
          delta={data.signalsDelta}
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

      {/* 1 Graph */}
      <ActivityChart buckets={data.buckets14d} total={total} avg={avg} />
    </div>
  );
};
