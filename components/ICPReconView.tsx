import React, { useState, useEffect } from 'react';
import { Target, Zap, Shield, Search, X, Plus, Terminal, Loader2, Bot, Filter, Users, MessageCircle, AlertTriangle, Send, History, Check, Trash2, Rocket, Sparkles, ChevronRight } from 'lucide-react';
import { generateICPReconQueries, parseReconBrief } from '../services/geminiService';
import { ICPReconCampaign, ICPTrackingKeyword } from '../types';
import { ICPReconDashboard } from './ICPReconDashboard';

export const ICPReconView: React.FC = () => {
    const [campaigns, setCampaigns] = useState<ICPReconCampaign[]>(() => {
        const saved = localStorage.getItem('icp_recon_campaigns');
        return saved ? JSON.parse(saved) : [];
    });
    
    const [brief, setBrief] = useState(() => localStorage.getItem('icp_recon_brief') || '');
    const [isParsing, setIsParsing] = useState(false);
    const [showBento, setShowBento] = useState(() => localStorage.getItem('icp_recon_show_bento') === 'true');
    
    const [activeCampaign, setActiveCampaign] = useState<ICPReconCampaign>(() => {
        try {
            const saved = localStorage.getItem('icp_recon_active_campaign');
            return saved ? JSON.parse(saved) : {
                id: Math.random().toString(36).substr(2, 9),
                name: '',
                roles: [],
                industries: [],
                painPoints: [],
                interests: [],
                negativeKeywords: [],
                platforms: ['X', 'LinkedIn', 'Reddit']
            };
        } catch (e) {
            return {
                id: Math.random().toString(36).substr(2, 9),
                name: '',
                roles: [],
                industries: [],
                painPoints: [],
                interests: [],
                negativeKeywords: [],
                platforms: ['X', 'LinkedIn', 'Reddit']
            };
        }
    });

    const [generating, setGenerating] = useState(false);
    const [queries, setQueries] = useState<ICPTrackingKeyword[]>(() => {
        try {
            const saved = localStorage.getItem('icp_recon_active_queries');
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });
    const [missionStatus, setMissionStatus] = useState<'idle' | 'generating' | 'launched' | 'complete'>(() => {
        const saved = localStorage.getItem('icp_recon_active_status');
        return (saved as any) || 'idle';
    });
    const [viewMode, setViewMode] = useState<'builder' | 'review' | 'dashboard'>(() => {
        const saved = localStorage.getItem('icp_recon_view_mode');
        return (saved as any) || 'builder';
    });
    const [missionStats, setMissionStats] = useState(() => {
        const saved = localStorage.getItem('icp_recon_active_stats');
        return saved ? JSON.parse(saved) : {
            scanned: 0,
            found: 0,
            status: 'searching' as 'searching' | 'complete',
            platformBreakdown: {} as Record<string, { status: string; found: number; scanned: number }>
        };
    });

    useEffect(() => {
        localStorage.setItem('icp_recon_campaigns', JSON.stringify(campaigns));
    }, [campaigns]);

    useEffect(() => {
        const cleanCampaign = (c: ICPReconCampaign) => {
            const cleanRoles = (c.roles || []).filter(r => r !== "New Persona" && r !== "Default Role");
            const cleanPains = (c.painPoints || []).filter(p => p !== "General Need" && p !== "Generic Pain");
            if (cleanRoles.length !== (c.roles || []).length || cleanPains.length !== (c.painPoints || []).length) {
                return { ...c, roles: cleanRoles, painPoints: cleanPains };
            }
            return null;
        };

        const cleaned = cleanCampaign(activeCampaign);
        if (cleaned) {
            setActiveCampaign(cleaned);
        }

        localStorage.setItem('icp_recon_active_campaign', JSON.stringify(activeCampaign));
        localStorage.setItem('icp_recon_active_queries', JSON.stringify(queries));
        localStorage.setItem('icp_recon_active_status', missionStatus);
        localStorage.setItem('icp_recon_view_mode', viewMode);
        localStorage.setItem('icp_recon_active_stats', JSON.stringify(missionStats));
        localStorage.setItem('icp_recon_brief', brief);
        localStorage.setItem('icp_recon_show_bento', showBento.toString());
    }, [activeCampaign, queries, missionStatus, viewMode, missionStats, brief, showBento]);

    useEffect(() => {
        const handleComplete = (e: any) => {
            setMissionStatus('complete');
            if (e.detail && e.detail.platformStatus) {
                const ps = e.detail.platformStatus;
                let totalScanned = 0;
                let totalFound = 0;
                let totalBuyNow = 0;
                let totalWarm = 0;
                let totalNurture = 0;
                Object.entries(ps.platforms || {}).forEach(([_, p]: [string, any]) => {
                    totalScanned += (p.scanned || 0);
                    totalFound += (p.found || 0);
                    totalBuyNow += (p.buyNow || 0);
                    totalWarm += (p.warm || 0);
                    totalNurture += (p.nurture || 0);
                });

                const finalStats = {
                    scanned: totalScanned,
                    found: totalFound,
                    buyNow: totalBuyNow,
                    warm: totalWarm,
                    nurture: totalNurture,
                    status: 'complete' as const,
                    platformBreakdown: ps.platforms || {}
                };
                setMissionStats(finalStats);
                if (e.detail.campaignId) {
                    setCampaigns(prev => prev.map(c => 
                        c.id === e.detail.campaignId ? { ...c, stats: finalStats } : c
                    ));
                }
            }
        };
        window.addEventListener('answerly_recon_complete', handleComplete);

        const handleSync = (e: any) => {
            const saved = localStorage.getItem('icp_recon_campaigns');
            if (saved) {
                const updatedCampaigns = JSON.parse(saved);
                setCampaigns(updatedCampaigns);
                if (e.detail?.campaignId) {
                    const fresh = updatedCampaigns.find((c: any) => c.id === e.detail.campaignId);
                    if (fresh) {
                        setActiveCampaign(fresh);
                    }
                }
            }
        };
        window.addEventListener('icp_campaign_updated', handleSync);

        const handlePulse = (e: any) => {
            if (e.detail && typeof e.detail.msg === 'string') {
                setMissionStats(prev => ({
                    ...prev,
                    pulse: { msg: e.detail.msg, time: Date.now() },
                    found: e.detail.found ?? prev.found,
                    scanned: e.detail.scanned ?? prev.scanned
                }));
            }
        };
        window.addEventListener('answerly_pulse_update', handlePulse);

        return () => {
            window.removeEventListener('answerly_recon_complete', handleComplete);
            window.removeEventListener('icp_campaign_updated', handleSync);
            window.removeEventListener('answerly_pulse_update', handlePulse);
        };
    }, []);

    const handleBriefSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!brief.trim()) return;

        setIsParsing(true);
        setShowBento(true);
        
        try {
            const dna = await parseReconBrief(brief);
            setActiveCampaign(prev => ({
                ...prev,
                name: dna.name,
                roles: dna.roles,
                painPoints: dna.painPoints,
                negativeKeywords: dna.negativeKeywords,
                platforms: dna.platforms as any,
                originalBrief: brief
            }));
        } catch (e) {
            console.error("Parsing failed", e);
        } finally {
            setIsParsing(false);
        }
    };

    const handleAnalyzeDNA = async () => {
        setGenerating(true);
        setMissionStatus('generating');
        try {
            const generatedQueries = await generateICPReconQueries(activeCampaign);
            const enriched = generatedQueries.map(q => ({
                ...q,
                campaignId: activeCampaign.id,
                campaignName: activeCampaign.name || 'Untitled Mission'
            }));
            setQueries(enriched);
            setViewMode('review');
            setMissionStatus('idle');
        } catch (e) {
            console.error(e);
            setMissionStatus('idle');
        } finally {
            setGenerating(false);
        }
    };

    const handleConfirmLaunch = () => {
        setViewMode('dashboard');
        const initialStats = { status: 'searching' as const, scanned: 0, found: 0, platformBreakdown: {} };
        setMissionStats(initialStats);
        
        window.dispatchEvent(new CustomEvent('answerly_recon_pulse', { 
            detail: { 
                keywords: queries, 
                platforms: activeCampaign.platforms,
                campaign: activeCampaign,
                timestamp: new Date().toISOString(), 
                campaignId: activeCampaign.id 
            } 
        }));

        setMissionStatus('launched');
        setCampaigns(prev => [
            { ...activeCampaign, lastRun: new Date().toISOString(), queries, stats: initialStats },
            ...prev.filter(c => c.id !== activeCampaign.id)
        ]);
    };

    const removeQuery = (idx: number) => {
        const newQueries = [...queries];
        newQueries.splice(idx, 1);
        setQueries(newQueries);
    };

    const handleReset = () => {
        setBrief('');
        setShowBento(false);
        setActiveCampaign({
            id: Math.random().toString(36).substr(2, 9),
            name: '',
            roles: [],
            industries: [],
            painPoints: [],
            interests: [],
            negativeKeywords: [],
            platforms: ['X', 'LinkedIn', 'Reddit']
        });
        setQueries([]);
        setMissionStatus('idle');
        setViewMode('builder');
    };

    if (viewMode === 'dashboard') {
        return (
            <ICPReconDashboard 
                campaign={activeCampaign}
                queries={queries}
                stats={missionStats}
                onBack={() => setViewMode('builder')}
                onNewMission={handleReset}
            />
        );
    }

    return (
        <div className="min-h-screen bg-[#FDFDFD] text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
            {viewMode === 'builder' ? (
                <div className="w-full max-w-7xl mx-auto space-y-10 animate-fade-in py-10 px-8">
                    <div className="flex items-end justify-between border-b border-slate-100 pb-10">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                                    <Zap size={16} className="text-white" fill="white" />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-600">New Operation</span>
                            </div>
                            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Campaign Builder</h1>
                            <p className="text-sm text-slate-500 font-medium max-w-lg">Transform your product vision into a surgically precise reconnaissance mission.</p>
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <button onClick={handleReset} className="px-6 py-5 bg-slate-50 text-slate-400 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] hover:text-red-500 hover:bg-red-50 transition-all flex items-center gap-2">
                                <Trash2 size={14} /> Reset
                            </button>
                            {showBento && !generating && (
                                <button onClick={handleAnalyzeDNA} className="px-10 py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] flex items-center gap-3 hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-slate-900/20">
                                    <Rocket size={16} /> Synthesize Mission Vectors
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                        <div className="lg:col-span-7 space-y-8">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Mission Brief</h3>
                                    <span className="text-[10px] font-bold text-slate-300">Plain English Only</span>
                                </div>
                                <div className="relative group">
                                    <textarea 
                                        autoFocus
                                        value={brief}
                                        onChange={(e) => setBrief(e.target.value)}
                                        placeholder="e.g. 'I'm looking for SaaS founders on X and Reddit who are complaining about high Stripe fees...'"
                                        className="w-full h-64 bg-white border border-slate-200 rounded-3xl p-8 text-lg font-medium text-slate-800 placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all outline-none resize-none shadow-sm relative z-10"
                                    />
                                    <div className="absolute bottom-6 right-6 z-20">
                                        <button 
                                            onClick={() => handleBriefSubmit()}
                                            disabled={!brief.trim() || isParsing}
                                            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-blue-500 transition-all shadow-lg shadow-blue-200 flex items-center gap-2"
                                        >
                                            {isParsing ? <Loader2 size={14} className="animate-spin" /> : <><Sparkles size={14} /> Analyze DNA</>}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {campaigns.length > 0 && !showBento && (
                                <div className="space-y-6 pt-10">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Mission History</h3>
                                        <div className="h-px flex-1 bg-slate-100 mx-6"></div>
                                    </div>
                                    <div className="grid md:grid-cols-2 gap-4">
                                        {campaigns.slice(0, 4).map(c => (
                                            <div key={c.id} className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:border-blue-500/30 transition-all flex items-center justify-between group cursor-pointer" onClick={() => { setActiveCampaign(c); setViewMode('dashboard'); }}>
                                                <div>
                                                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">{c.name || "Untitled Operation"}</h4>
                                                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">{c.stats?.found || 0} Leads Found</p>
                                                </div>
                                                <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-all" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="lg:col-span-5 space-y-8">
                            {!showBento ? (
                                <div className="h-full flex flex-col items-center justify-center p-12 bg-slate-50 rounded-[3rem] border border-dashed border-slate-200 text-center space-y-4">
                                    <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center shadow-xl shadow-slate-200 border border-slate-100">
                                        <Search size={24} className="text-slate-300" />
                                    </div>
                                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Intelligence Preview</h4>
                                    <p className="text-[10px] text-slate-400 font-bold max-w-[180px] leading-relaxed uppercase tracking-widest">Submit your brief to see the AI extract campaign DNA.</p>
                                </div>
                            ) : (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Campaign DNA</h3>
                                        <div className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[8px] font-black uppercase tracking-widest border border-emerald-100">Live Synthesis</div>
                                    </div>
                                    <div className="space-y-4">
                                        <BentoCard title="Target Roles" tags={activeCampaign.roles} onRemove={(tag:string) => setActiveCampaign(prev => ({...prev, roles: prev.roles.filter(r => r !== tag)}))} onAdd={(tag:string) => setActiveCampaign(prev => ({...prev, roles: [...new Set([...prev.roles, tag])]}))} loading={isParsing} color="blue" />
                                        <BentoCard title="Intent Signals" tags={activeCampaign.painPoints} onRemove={(tag:string) => setActiveCampaign(prev => ({...prev, painPoints: prev.painPoints.filter(p => p !== tag)}))} onAdd={(tag:string) => setActiveCampaign(prev => ({...prev, painPoints: [...new Set([...prev.painPoints, tag])]}))} loading={isParsing} color="emerald" />
                                        <BentoCard title="Vector Grid" tags={activeCampaign.platforms} onRemove={(tag:string) => setActiveCampaign(prev => ({...prev, platforms: prev.platforms.filter(p => p !== tag) as any}))} onAdd={(tag:string) => setActiveCampaign(prev => ({...prev, platforms: [...new Set([...prev.platforms, tag])] as any}))} loading={isParsing} color="indigo" />
                                        <BentoCard title="Negative DNA" tags={[...new Set([...(activeCampaign.negativeKeywords || []), ...(JSON.parse(localStorage.getItem('global_negative_keywords') || '[]'))])]} onRemove={(tag:string) => setActiveCampaign(prev => ({...prev, negativeKeywords: (prev.negativeKeywords||[]).filter(k => k !== tag)}))} onAdd={(tag:string) => setActiveCampaign(prev => ({...prev, negativeKeywords: [...new Set([...(prev.negativeKeywords || []), tag])]}))} loading={isParsing} color="rose" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : viewMode === 'review' ? (
                <div className="min-h-screen p-8 space-y-8 animate-fade-in-up max-w-4xl mx-auto">
                    <div className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-obsidian border border-slate-100">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Mission Vector Review</h2>
                            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest mt-1">Review {queries.length} AI-Synthesized Signals</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button onClick={() => setViewMode('builder')} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900">Back</button>
                            <button onClick={handleConfirmLaunch} className="px-8 py-4 bg-blue-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl shadow-blue-900/20 flex items-center gap-2">
                                <Rocket size={16} /> Launch Stealth Mission
                            </button>
                        </div>
                    </div>
                    <div className="grid gap-3 max-h-[70vh] overflow-y-auto pr-4 scrollbar-hide pb-20">
                        {queries.map((q, idx) => (
                            <div key={idx} className="glass-morphism p-5 rounded-[1.5rem] border-white/5 flex items-center justify-between group hover:bg-white/[0.03] transition-all">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-lg ${q.platform.toLowerCase().includes('x') ? 'bg-white text-black' : q.platform.toLowerCase().includes('linked') ? 'bg-blue-600 text-white shadow-blue-900/20' : 'bg-orange-600 text-white shadow-orange-900/20'}`}>
                                        {q.platform.charAt(0)}
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-[14px] font-mono text-slate-700">{q.query}</div>
                                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{q.intent}</div>
                                    </div>
                                </div>
                                <button onClick={() => removeQuery(idx)} className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const BentoCard = ({ title, tags, onRemove, onAdd, loading, color, placeholder = "+ Add" }: any) => {
    const [newTag, setNewTag] = useState('');
    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTag.trim()) {
            onAdd(newTag.trim());
            setNewTag('');
        }
    };
    const colorMap: any = {
        blue: { border: 'hover:border-blue-500/30', dot: 'bg-blue-500' },
        emerald: { border: 'hover:border-emerald-500/30', dot: 'bg-emerald-500' },
        indigo: { border: 'hover:border-indigo-500/30', dot: 'bg-indigo-500' },
        rose: { border: 'hover:border-rose-500/30', dot: 'bg-rose-500' }
    };
    const activeColor = colorMap[color] || colorMap.blue;
    return (
        <div className={`glass-morphism p-8 rounded-[2.5rem] space-y-4 shadow-obsidian group ${activeColor.border} transition-all duration-500`}>
            <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{title}</h3>
                <div className={`w-2 h-2 rounded-full ${activeColor.dot} ${loading ? 'animate-ping' : ''}`}></div>
            </div>
            <div className="min-h-[60px] flex flex-wrap gap-2">
                {loading ? (
                    <div className="flex gap-2 w-full">
                        <div className="h-6 w-20 bg-white/5 rounded-full animate-pulse"></div>
                        <div className="h-6 w-16 bg-white/5 rounded-full animate-pulse delay-75"></div>
                    </div>
                ) : (
                    <>
                        {(tags || []).map((tag: string) => (
                            <span key={tag} onClick={() => onRemove(tag)} className={`px-3 py-1.5 bg-slate-50 border border-slate-100 text-xs font-bold rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 cursor-pointer transition-all flex items-center gap-2 group/tag`}>
                                {tag} <X size={10} className="opacity-40 group-hover/tag:opacity-100 transition-opacity" />
                            </span>
                        ))}
                        <form onSubmit={handleAdd} className="inline-block">
                            <input type="text" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder={placeholder} className="px-3 py-1.5 bg-transparent border border-dashed border-slate-200 text-xs font-medium rounded-xl text-slate-400 focus:text-slate-900 focus:border-slate-900 focus:ring-0 outline-none w-20 focus:w-32 transition-all" />
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};
