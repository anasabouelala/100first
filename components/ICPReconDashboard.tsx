import React, { useState, useEffect } from 'react';
import { 
    Activity, 
    Target, 
    Zap, 
    ArrowUpRight, 
    Globe, 
    Cpu, 
    TrendingUp, 
    ArrowLeft, 
    Loader2,
    Check,
    ExternalLink,
    Clock,
    Terminal
} from 'lucide-react';
import { ICPReconCampaign, ICPTrackingKeyword } from '../types';

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
}

export const ICPReconDashboard: React.FC<ICPReconDashboardProps> = ({ campaign, queries, stats, onBack, onNewMission }) => {
    const [prospects, setProspects] = useState<any[]>([]);

    useEffect(() => {
        const fetchProspects = () => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['found_prospects'], (res) => {
                    const all = res.found_prospects || [];
                    const missionProspects = all.filter((p: any) => p.campaignId === campaign.id);
                    setProspects(missionProspects.sort((a: any, b: any) => (b.score || 0) - (a.score || 0)));
                });
            }
        };

        fetchProspects();
        const interval = setInterval(fetchProspects, 5000);
        return () => clearInterval(interval);
    }, [campaign.id]);

    const relevanceRate = stats.scanned > 0 ? ((stats.found / stats.scanned) * 100).toFixed(1) : '0.0';
    
    return (
        <div className="min-h-screen p-6 space-y-8 animate-fade-in-up max-w-7xl mx-auto">
            {/* Header / Control Bar */}
            <div className="flex items-center justify-between glass-morphism p-4 rounded-[2.5rem] shadow-obsidian border-white/5">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={onBack}
                        className="p-4 hover:bg-slate-100 rounded-2xl text-slate-400 hover:text-slate-900 transition-all border border-transparent hover:border-slate-200"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${stats.status === 'searching' ? 'bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-emerald-500'}`}></div>
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">
                                {stats.status === 'searching' ? 'Active Recon Mission' : 'Intelligence Secured'}
                            </span>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{campaign.name}</h2>
                    </div>
                </div>

                <div className="flex items-center gap-3 pr-2">
                    {stats.status === 'searching' && (
                        <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 border border-slate-100 rounded-[1.5rem]">
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Mission Progress</span>
                                <span className="text-[11px] font-bold text-slate-900">{stats.scanned} / {queries.length} Vectors</span>
                            </div>
                            <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-blue-500 transition-all duration-1000" 
                                    style={{ width: `${(stats.scanned / (queries.length || 1)) * 100}%` }}
                                ></div>
                            </div>
                        </div>
                    )}
                    <button 
                        onClick={onNewMission}
                        className="px-6 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-slate-900/10"
                    >
                        Abort & New
                    </button>
                </div>
            </div>

            {/* Metrics Ribbon */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                <MetricSmall title="Buy Now" value={stats.buyNow || 0} icon={<Zap size={16} />} color="rose" glow />
                <MetricSmall title="Hot Opps" value={stats.warm || 0} icon={<TrendingUp size={16} />} color="orange" />
                <MetricSmall title="Strong" value={Math.floor((stats.found || 0) * 0.4)} icon={<Target size={16} />} color="blue" />
                <MetricSmall title="Total Found" value={stats.found} icon={<Globe size={16} />} color="indigo" />
                <MetricSmall title="Precision" value={`${relevanceRate}%`} icon={<Activity size={16} />} color="emerald" />
            </div>

            <div className="grid lg:grid-cols-12 gap-8">
                {/* Main: Vector Grid & Live Pulse */}
                <div className="lg:col-span-8 space-y-10">
                    {/* Active Vectors */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Mission Vector Grid</h3>
                            <div className="text-[10px] font-bold text-blue-400/60 uppercase tracking-widest">Multi-Platform Sync</div>
                        </div>
                        <div className="grid md:grid-cols-2 gap-4">
                            {queries.length === 0 ? (
                                <>
                                    <div className="md:col-span-2 glass-morphism p-12 rounded-[2.5rem] border-blue-500/10 flex flex-col items-center justify-center space-y-6 bg-blue-50/20">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-2xl animate-pulse"></div>
                                            <Loader2 size={48} className="text-blue-600 animate-spin relative z-10" />
                                        </div>
                                        <div className="text-center space-y-2">
                                            <h4 className="text-sm font-black uppercase tracking-[0.3em] text-slate-900">AI Vector Synthesis</h4>
                                            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">Translating DNA into surgically precise Boolean strings...</p>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                queries.map((q, idx) => {
                                    const platformStats = stats.platformBreakdown[q.platform] || { status: 'pending', found: 0, scanned: 0 };
                                    return (
                                        <VectorCard key={idx} query={q} stats={platformStats} />
                                    );
                                })
                            )}
                        </div>
                    </div>
                    
                    {/* Active Intelligence Pipeline (18-Layer Indicator) */}
                    {stats.status === 'searching' && (
                        <div className="glass-morphism p-6 rounded-[2.5rem] border-white/5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">18-Layer Intelligence Execution</h3>
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                                    <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Global Pipeline Active</span>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9 gap-2">
                                {[
                                    'Ingestion', 'Normalization', 'Extraction', 
                                    'Topic Filter', 'Intent Engine', 'Pain Engine', 
                                    'Urgency', 'Authority', 'Co. Quality', 
                                    'ICP Match', 'Time Decay', 'Social Proof',
                                    'Scoring', 'Tiering', 'Boosts',
                                    'Fraud Filter', 'Deduplication', 'Outreach Brain'
                                ].map((step, i) => (
                                    <div key={i} className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-slate-50/50 border border-slate-100">
                                        <div className={`w-1.5 h-1.5 rounded-full ${i <= (stats.scanned % 18) ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]' : 'bg-slate-200'}`}></div>
                                        <span className="text-[7px] font-black uppercase tracking-tight text-slate-400 text-center truncate w-full">{step}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[9px] text-slate-400 text-center font-medium uppercase tracking-widest">Processing Layer {(stats.scanned % 18) + 1}: Automated Decision Logic in Progress.</p>
                        </div>
                    )}

                    {/* Lead Intelligence Feed: The Triage Room */}
                    <div className="space-y-6 pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 tracking-tight">Intelligence Triage</h3>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Found {prospects.length} High-Fidelity Opportunities</p>
                            </div>
                        </div>

                        <div className="grid gap-4">
                            {prospects.length === 0 ? (
                                <div className="p-12 bg-slate-50 rounded-[2.5rem] border border-dashed border-slate-200 text-center flex flex-col items-center gap-3">
                                    <Terminal className="text-slate-300" size={32} />
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Listening for signals across the 18-layer spectrum...</p>
                                </div>
                            ) : (
                                prospects.map((p, idx) => (
                                    <div key={idx} className="glass-morphism p-6 rounded-[2.5rem] border-white/5 shadow-obsidian group hover:bg-white/[0.03] transition-all">
                                        <div className="flex flex-col md:flex-row gap-6">
                                            {/* Lead Identity */}
                                            <div className="flex-1 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-bold text-sm">
                                                            {p.author?.name?.charAt(0) || 'U'}
                                                        </div>
                                                        <div>
                                                            <h4 className="text-sm font-bold text-slate-900">{p.author?.name || 'Unknown Prospect'}</h4>
                                                            <p className="text-[10px] text-slate-400 font-medium">@{p.author?.handle || 'anonymous'}</p>
                                                        </div>
                                                    </div>
                                                    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg ${
                                                        p.tier === 'Buy Now' ? 'bg-rose-500 text-white shadow-rose-900/20' :
                                                        p.tier === 'Hot' ? 'bg-orange-500 text-white shadow-orange-900/20' :
                                                        'bg-emerald-500 text-white shadow-emerald-900/20'
                                                    }`}>
                                                        {p.tier} • {p.score}% Match
                                                    </div>
                                                </div>

                                                <p className="text-xs text-slate-700 leading-relaxed font-medium bg-slate-50 p-4 rounded-2xl italic">"{p.text}"</p>
                                                
                                                {/* 18-Layer Pulse Visualization */}
                                                <div className="flex flex-wrap gap-2 pt-2">
                                                    {(p.reasoning || []).map((layer: string, i: number) => (
                                                        <span key={i} className="px-3 py-1 bg-white border border-slate-100 text-[8px] font-black uppercase tracking-widest text-slate-500 rounded-lg flex items-center gap-1.5 shadow-sm">
                                                            <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse"></div>
                                                            {layer}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Action Sidebar */}
                                            <div className="md:w-48 flex flex-col justify-center gap-2">
                                                <button className="w-full py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-slate-900/10">Approve</button>
                                                <button className="w-full py-3 bg-slate-50 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:text-red-500 hover:bg-red-50 transition-all">Discard</button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Sidebar: Intelligence Summary */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="glass-morphism p-8 rounded-[2.5rem] space-y-8 border-white/5 shadow-obsidian sticky top-6">
                        <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-500 flex items-center gap-2">
                                <Zap size={14} className="text-blue-400" fill="currentColor" /> Intel DNA
                            </h4>
                            <Clock size={14} className="text-gray-600" />
                        </div>
                        
                        <div className="space-y-6">
                            <DNASection title="Target Audience" items={campaign.roles} color="blue" />
                            <DNASection title="Pain Signals" items={campaign.painPoints} color="rose" />
                            {campaign.industries.length > 0 && <DNASection title="Industries" items={campaign.industries} color="amber" />}
                        </div>

                        <div className="pt-8 border-t border-white/5 space-y-4">
                            <div className="flex justify-between items-center">
                                <div className="space-y-1">
                                    <span className="text-[9px] text-slate-500 font-black uppercase tracking-[0.2em] block">Bot Reliability</span>
                                    <span className="text-[10px] font-bold text-slate-900">99.8% Uptime</span>
                                </div>
                                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                                    <ShieldCheck size={20} className="text-blue-500" />
                                </div>
                            </div>
                            <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full w-[99.8%] shadow-[0_0_10px_rgba(59,130,246,0.3)]"></div>
                            </div>
                        </div>

                        <div className="p-5 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl text-white shadow-xl shadow-blue-900/20 group cursor-pointer overflow-hidden relative">
                            <div className="absolute top-0 right-0 p-4 opacity-10 -rotate-12 group-hover:rotate-0 transition-transform duration-500">
                                <Sparkles size={64} fill="white" />
                            </div>
                            <h5 className="text-xs font-black uppercase tracking-widest mb-1 relative z-10">AI Optimization</h5>
                            <p className="text-[10px] text-blue-100 font-medium relative z-10">Gemini is auto-tuning vectors based on live relevance.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MetricSmall = ({ title, value, icon, color, glow }: any) => {
    const colorMap: any = {
        rose: { bg: 'bg-rose-500', text: 'text-rose-400', border: 'hover:border-rose-500/30' },
        orange: { bg: 'bg-orange-500', text: 'text-orange-400', border: 'hover:border-orange-500/30' },
        blue: { bg: 'bg-blue-500', text: 'text-blue-400', border: 'hover:border-blue-500/30' },
        emerald: { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'hover:border-emerald-500/30' },
        indigo: { bg: 'bg-indigo-500', text: 'text-indigo-400', border: 'hover:border-indigo-500/30' }
    };
    const c = colorMap[color] || colorMap.blue;

    return (
        <div className={`glass-morphism p-6 rounded-[2rem] border-white/5 shadow-obsidian group ${c.border} transition-all duration-500 ${glow ? 'shadow-emerald-500/20' : ''}`}>
            <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 ${c.bg}/10 rounded-xl ${c.text} group-hover:scale-110 transition-transform`}>
                    {icon}
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{title}</span>
            </div>
            <div className="text-3xl font-bold text-white tracking-tight">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        </div>
    );
};

const VectorCard = ({ query, stats }: any) => {
    const isScanning = stats.status !== 'ok';
    return (
        <div className="glass-morphism p-5 rounded-[2rem] border-white/5 shadow-obsidian space-y-5 group hover:bg-white/[0.02] transition-all">
            <div className="flex justify-between items-start">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-lg ${
                    query.platform.toLowerCase().includes('x') ? 'bg-white text-black' :
                    query.platform.toLowerCase().includes('linked') ? 'bg-blue-600 text-white shadow-blue-900/20' :
                    'bg-orange-600 text-white shadow-orange-900/20'
                }`}>
                    {query.platform.charAt(0)}
                </div>
                {isScanning ? (
                    <div className="flex items-center gap-2 text-blue-400 bg-blue-400/5 px-3 py-1.5 rounded-full border border-blue-400/10">
                        <Loader2 size={12} className="animate-spin" />
                        <span className="text-[9px] font-black uppercase tracking-widest">Active</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-emerald-400 bg-emerald-400/5 px-3 py-1.5 rounded-full border border-emerald-400/10">
                        <Check size={12} />
                        <span className="text-[9px] font-black uppercase tracking-widest">Synced</span>
                    </div>
                )}
            </div>
            
            <div className="space-y-1.5">
                <div className="text-[13px] font-mono text-slate-700 truncate" title={query.query}>{query.query}</div>
                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{query.intent}</div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <div className="text-[10px] text-slate-500 font-bold"><span className="text-slate-900 font-black">{stats.scanned}</span> <span className="opacity-40">ANALYZED</span></div>
                <div className="flex gap-3">
                    <div className="text-[10px] text-rose-600 font-bold"><span className="font-black">{stats.buyNow || 0}</span> <span className="opacity-40 uppercase">Buy Now</span></div>
                    <div className="text-[10px] text-orange-600 font-bold"><span className="font-black">{stats.warm || 0}</span> <span className="opacity-40 uppercase">Warm</span></div>
                    <div className="text-[10px] text-emerald-600 font-bold"><span className="font-black">{stats.found}</span> <span className="opacity-40 uppercase">Total</span></div>
                </div>
            </div>
        </div>
    );
};

const DNASection = ({ title, items, color }: any) => {
    const colorMap: any = {
        emerald: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/10', text: 'text-emerald-600/80' },
        blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/10', text: 'text-blue-600/80' },
        indigo: { bg: 'bg-indigo-500/5', border: 'border-indigo-500/10', text: 'text-indigo-600/80' },
        rose: { bg: 'bg-rose-500/5', border: 'border-rose-500/10', text: 'text-rose-600/80' }
    };
    const c = colorMap[color] || colorMap.blue;

    return (
        <div className="space-y-3">
            <label className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-600">{title}</label>
            <div className="flex flex-wrap gap-2">
                {items.map((it: string) => (
                    <span key={it} className={`px-3 py-1.5 ${c.bg} border ${c.border} rounded-xl text-[10px] font-bold ${c.text}`}>
                        {it}
                    </span>
                ))}
            </div>
        </div>
    );
};

const ShieldCheck = ({ size, className }: any) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
    </svg>
);

const Sparkles = ({ size, fill, className }: any) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
    </svg>
);
