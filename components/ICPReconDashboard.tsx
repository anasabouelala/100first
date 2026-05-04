import React, { useState, useEffect } from 'react';
import { 
    ArrowLeft, ArrowUpRight, Loader2, Play, Clock, CheckCircle2, 
    AlertCircle, Search, Zap, Flame, TrendingUp, Users, Target,
    BarChart2, RefreshCw, ExternalLink, Trash2
} from 'lucide-react';
import { ICPReconCampaign, ICPTrackingKeyword } from '../types';

interface KeywordStat {
    query: string;
    platform: string;
    status: 'queued' | 'running' | 'done' | 'error';
    found: number;
    hot: number;
    warm: number;
    startedAt?: string;
    completedAt?: string;
}

interface ICPReconDashboardProps {
    campaign: ICPReconCampaign;
    queries: ICPTrackingKeyword[];
    stats: {
        scanned: number;
        found: number;
        status: 'searching' | 'complete';
        pulse?: { msg: string; time: number };
        buyNow?: number;
        warm?: number;
        platformBreakdown: Record<string, { status: string; found: number; scanned: number; buyNow?: number; warm?: number }>;
    };
    onBack: () => void;
    onNewMission: () => void;
    onDelete?: () => void;
}

const platformColor: Record<string, string> = {
    X: 'bg-black text-white',
    LinkedIn: 'bg-blue-600 text-white',
    Reddit: 'bg-orange-500 text-white',
};

const platformBg: Record<string, string> = {
    X: 'bg-black/5 text-black',
    LinkedIn: 'bg-blue-50 text-blue-700',
    Reddit: 'bg-orange-50 text-orange-700',
};

const statusConfig = {
    queued:  { icon: <Clock size={12} />,        label: 'Queued',  color: 'text-slate-400',  bg: 'bg-slate-50'  },
    running: { icon: <Loader2 size={12} className="animate-spin" />, label: 'Running', color: 'text-blue-600', bg: 'bg-blue-50' },
    done:    { icon: <CheckCircle2 size={12} />,  label: 'Done',    color: 'text-emerald-600', bg: 'bg-emerald-50' },
    error:   { icon: <AlertCircle size={12} />,   label: 'Error',   color: 'text-red-500',    bg: 'bg-red-50'    },
};

export const ICPReconDashboard: React.FC<ICPReconDashboardProps> = ({ campaign, queries, stats, onBack, onNewMission, onDelete }) => {
    const [prospects, setProspects] = useState<any[]>([]);
    const [kwStats, setKwStats] = useState<Record<string, KeywordStat>>({});
    const [queueLen, setQueueLen] = useState(0);
    const [activeTab, setActiveTab] = useState<'keywords' | 'prospects'>('keywords');

    useEffect(() => {
        const fetchAll = () => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
            chrome.storage.local.get(['pipeline_leads', 'keyword_stats', 'recon_queue'], (res) => {
                // Leads
                const all: any[] = res.pipeline_leads || [];
                const missionLeads = all.filter((p: any) => p.tags?.includes(campaign.id) || true); // show all for now
                setProspects(missionLeads.slice(0, 50));

                // Keyword stats
                setKwStats(res.keyword_stats || {});

                // Queue length
                setQueueLen((res.recon_queue || []).length);
            });
        };

        fetchAll();
        const iv = setInterval(fetchAll, 3000);
        return () => clearInterval(iv);
    }, [campaign.id]);

    // Build keyword rows: merge queries with their live stats
    const keywordRows = queries.map((q) => {
        const key = `${q.platform}__${q.query}`;
        const liveStats = kwStats[key];
        const status: KeywordStat['status'] = liveStats?.status || 'queued';
        return {
            query: q.query,
            platform: q.platform,
            intent: q.intent,
            status,
            found: liveStats?.found || 0,
            hot: liveStats?.hot || 0,
            warm: liveStats?.warm || 0,
            startedAt: liveStats?.startedAt,
            completedAt: liveStats?.completedAt,
        };
    });

    const totalFound = keywordRows.reduce((s, r) => s + r.found, 0);
    const totalHot = keywordRows.reduce((s, r) => s + r.hot, 0);
    const totalWarm = keywordRows.reduce((s, r) => s + r.warm, 0);
    const done = keywordRows.filter(r => r.status === 'done').length;
    const queuedCount = keywordRows.filter(r => r.status === 'queued').length;
    const progress = queries.length > 0 ? Math.round((done / queries.length) * 100) : 0;

    return (
        <div className="min-h-screen bg-[#f5f5f7] text-slate-900 font-sans">
            {/* Top Nav */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-all">
                            <ArrowLeft size={16} />
                        </button>
                        <div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-black uppercase tracking-tight text-slate-900">{campaign.name || 'Campaign'}</span>
                                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 ${stats.status === 'searching' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                    {stats.status === 'searching' ? <><Loader2 size={8} className="animate-spin" />Running</> : <><CheckCircle2 size={8} />Complete</>}
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-medium">{queuedCount} keywords queued · {done}/{queries.length} scanned</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{campaign.platforms.join(' · ')}</div>
                        
                        {stats.status === 'searching' && (
                            <button 
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent('answerly_recon_stop'));
                                }}
                                title="Stop Mission"
                                className="px-5 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all"
                            >
                                Stop
                            </button>
                        )}

                        {onDelete && (
                            <button 
                                onClick={() => {
                                    if (window.confirm("Are you sure you want to delete this campaign? This will remove all leads and stats.")) {
                                        onDelete();
                                    }
                                }}
                                title="Delete Campaign"
                                className="p-2.5 bg-slate-50 text-slate-400 border border-slate-100 rounded-xl hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}

                        <button onClick={onNewMission} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-all">
                            New Campaign
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
                {/* KPI Row — real data */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[
                        { label: 'Total Leads', value: totalFound, icon: <Users size={16} />, accent: 'text-slate-900' },
                        { label: 'Hot 🔥', value: totalHot, icon: <Flame size={16} />, accent: 'text-red-500' },
                        { label: 'Warm ⚡', value: totalWarm, icon: <Zap size={16} />, accent: 'text-orange-500' },
                        { label: 'Keywords Done', value: `${done}/${queries.length}`, icon: <CheckCircle2 size={16} />, accent: 'text-emerald-600' },
                        { label: 'Queued', value: queuedCount, icon: <Clock size={16} />, accent: 'text-blue-500' },
                    ].map((kpi, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{kpi.label}</span>
                                <span className={`${kpi.accent}`}>{kpi.icon}</span>
                            </div>
                            <div className={`text-3xl font-black tracking-tight ${kpi.accent}`}>{kpi.value}</div>
                        </div>
                    ))}
                </div>

                {/* Progress Bar */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Campaign Progress</span>
                        <span className="text-[10px] font-black text-slate-900">{progress}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-slate-900 rounded-full transition-all duration-700"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    {stats.pulse?.msg && (
                        <p className="mt-2 text-[9px] text-slate-400 font-medium flex items-center gap-1.5">
                            <Loader2 size={9} className="animate-spin" />
                            {stats.pulse.msg}
                        </p>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
                    {(['keywords', 'prospects'] as const).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)}
                            className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-700'}`}>
                            {tab === 'keywords' ? `Keywords (${queries.length})` : `Prospects (${prospects.length})`}
                        </button>
                    ))}
                </div>

                {activeTab === 'keywords' ? (
                    /* ── KEYWORD TABLE (Meta-style) ── */
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="text-left px-5 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 w-8">#</th>
                                    <th className="text-left px-5 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Keyword</th>
                                    <th className="text-left px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Platform</th>
                                    <th className="text-left px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Status</th>
                                    <th className="text-right px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Leads</th>
                                    <th className="text-right px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Hot 🔥</th>
                                    <th className="text-right px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Warm ⚡</th>
                                    <th className="text-right px-5 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Scanned At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keywordRows.map((row, i) => {
                                    const sc = statusConfig[row.status];
                                    return (
                                        <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/80 transition-colors ${row.status === 'running' ? 'bg-blue-50/30' : ''}`}>
                                            <td className="px-5 py-3.5 text-[10px] font-bold text-slate-300">{i + 1}</td>
                                            <td className="px-5 py-3.5">
                                                <div className="flex items-center gap-2">
                                                    {row.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
                                                    <span className="text-[12px] font-bold text-slate-900 truncate max-w-xs">{row.query}</span>
                                                </div>
                                                {row.intent && <div className="text-[9px] text-slate-400 font-medium truncate max-w-xs mt-0.5">{row.intent}</div>}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${platformBg[row.platform] || 'bg-slate-50 text-slate-500'}`}>
                                                    {row.platform}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${sc.bg} ${sc.color}`}>
                                                    {sc.icon} {sc.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <span className="text-[13px] font-black text-slate-900">{row.found}</span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <span className="text-[13px] font-black text-red-500">{row.hot || '—'}</span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <span className="text-[13px] font-black text-orange-500">{row.warm || '—'}</span>
                                            </td>
                                            <td className="px-5 py-3.5 text-right text-[10px] text-slate-400 font-medium">
                                                {row.completedAt ? new Date(row.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : row.startedAt ? <span className="text-blue-500">Running...</span> : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    /* ── PROSPECTS LIST ── */
                    <div className="space-y-3">
                        {prospects.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-16 text-center">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Awaiting signals...</p>
                            </div>
                        ) : prospects.map((p, idx) => {
                            const temp = (p.intelligenceScore || p.relevance || 0) >= 75 ? 'hot' : (p.intelligenceScore || p.relevance || 0) >= 45 ? 'warm' : 'cold';
                            const tempBadge = { hot: '🔥 HOT', warm: '⚡ WARM', cold: '❄️ COLD' }[temp];
                            const tempColor = { hot: 'text-red-500 bg-red-50', warm: 'text-orange-500 bg-orange-50', cold: 'text-slate-400 bg-slate-50' }[temp];
                            return (
                                <div key={idx} className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 transition-all p-5 flex items-start gap-4">
                                    <div className={`w-10 h-10 rounded-xl ${platformColor[p.tags?.[1]] || 'bg-slate-900'} flex items-center justify-center text-sm font-black shrink-0`}>
                                        {(p.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-black text-slate-900">{p.name || 'Unknown'}</span>
                                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${tempColor}`}>{tempBadge}</span>
                                            <span className="px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-slate-50 text-slate-500">
                                                {p.interactionType === 'Comment' ? '💬 Comment' : '📣 Post'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 font-medium mt-1 line-clamp-2">{p.postText || p.why}</p>
                                        {p.tags?.[0] && <p className="text-[9px] text-slate-300 font-bold uppercase tracking-widest mt-1">Keyword: {p.tags[0]}</p>}
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-[11px] font-black text-slate-900">{p.intelligenceScore || p.relevance || 0}%</span>
                                        <a href={p.postUrl || p.url} target="_blank" rel="noopener noreferrer"
                                            className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-900 hover:text-white transition-all">
                                            <ArrowUpRight size={14} />
                                        </a>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
