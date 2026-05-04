import React, { useState, useEffect } from 'react';
import { Target, Zap, Shield, Search, X, Plus, Terminal, Loader2, Bot, Filter, Users, MessageCircle, AlertTriangle, Send, History, Check, Trash2, Rocket, Sparkles, ChevronRight, Globe, Activity, ArrowLeft, TrendingUp } from 'lucide-react';
import { generateICPReconQueries, parseReconBrief } from '../services/geminiService';
import { ICPReconCampaign, ICPTrackingKeyword } from '../types';
import { ICPReconDashboard } from './ICPReconDashboard';

export const ICPReconView: React.FC = () => {
    const [campaigns, setCampaigns] = useState<ICPReconCampaign[]>(() => {
        try {
            const saved = localStorage.getItem('icp_recon_campaigns');
            const parsed = (saved && saved !== 'undefined' && saved !== 'null') ? JSON.parse(saved) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.error("Failed to parse campaigns", e);
            return [];
        }
    });
    
    const [brief, setBrief] = useState(() => localStorage.getItem('icp_recon_brief') || '');
    const [builderMode, setBuilderMode] = useState<'creative' | 'structured'>(() => (localStorage.getItem('icp_recon_builder_mode') as any) || 'creative');
    const [isParsing, setIsParsing] = useState(false);
    const [newPersona, setNewPersona] = useState('');
    const [newIndustry, setNewIndustry] = useState('');
    const [newInterest, setNewInterest] = useState('');
    const [newNegative, setNewNegative] = useState('');
    const [newPainPoint, setNewPainPoint] = useState('');
    const [newParam, setNewParam] = useState({ label: '', value: '' });
    const [showBento, setShowBento] = useState(() => localStorage.getItem('icp_recon_show_bento') === 'true');
    
    const [activeCampaign, setActiveCampaign] = useState<ICPReconCampaign>(() => {
        try {
            const saved = localStorage.getItem('icp_recon_active_campaign');
            const parsed = (saved && saved !== 'undefined' && saved !== 'null') ? JSON.parse(saved) : null;
            if (parsed && typeof parsed === 'object') return parsed;
            
            return {
                id: Math.random().toString(36).substr(2, 9),
                name: '',
                roles: [],
                industries: [],
                painPoints: [],
                interests: [],
                negativeKeywords: [],
                platforms: ['X', 'LinkedIn', 'Reddit'],
                customParameters: {},
                campaignType: 'intent',
                funnelStage: 'tofu',
                reconDepth: 'surface'
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
                platforms: ['X', 'LinkedIn', 'Reddit'],
                customParameters: {},
                campaignType: 'intent',
                funnelStage: 'tofu',
                reconDepth: 'surface'
            };
        }
    });

    const [viewMode, setViewMode] = useState<'builder' | 'review' | 'dashboard'>(() => (localStorage.getItem('icp_recon_view_mode') as any) || 'builder');
    const [queries, setQueries] = useState<ICPTrackingKeyword[]>(() => {
        try {
            const saved = localStorage.getItem('icp_recon_queries');
            const parsed = (saved && saved !== 'undefined' && saved !== 'null') ? JSON.parse(saved) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    });
    
    const [missionStats, setMissionStats] = useState<any>(() => {
        try {
            const saved = localStorage.getItem('icp_recon_stats');
            const parsed = (saved && saved !== 'undefined' && saved !== 'null') ? JSON.parse(saved) : null;
            return (parsed && typeof parsed === 'object') ? parsed : { status: 'idle', scanned: 0, found: 0, platformBreakdown: {} };
        } catch (e) {
            return { status: 'idle', scanned: 0, found: 0, platformBreakdown: {} };
        }
    });

    const [renderError, setRenderError] = useState<string | null>(null);

    // Safety Sync: If we are in dashboard mode but have no campaigns, force back to builder
    useEffect(() => {
        if (viewMode === 'dashboard' && campaigns.length === 0) {
            console.warn("Safety Check: No campaigns found for dashboard mode. Reverting to builder.");
            setViewMode('builder');
        }
    }, [viewMode, campaigns]);

    useEffect(() => {
        localStorage.setItem('icp_recon_campaigns', JSON.stringify(campaigns));
        localStorage.setItem('icp_recon_active_campaign', JSON.stringify(activeCampaign));
        localStorage.setItem('icp_recon_view_mode', viewMode);
        localStorage.setItem('icp_recon_queries', JSON.stringify(queries));
        localStorage.setItem('icp_recon_stats', JSON.stringify(missionStats));
        localStorage.setItem('icp_recon_brief', brief);
        localStorage.setItem('icp_recon_builder_mode', builderMode);
    }, [campaigns, activeCampaign, viewMode, queries, missionStats, brief, builderMode]);

    const handleGenerate = async () => {
        if (!brief) return;
        setIsParsing(true);
        try {
            const parsed = await parseReconBrief(brief);
            const campaign = {
                ...activeCampaign,
                ...parsed,
                originalBrief: brief
            };
            setActiveCampaign(campaign);
            const synthesizedQueries = await generateICPReconQueries(campaign);
            setQueries(synthesizedQueries);
            setViewMode('review');
        } catch (e) {
            console.error(e);
        } finally {
            setIsParsing(false);
        }
    };

    // Auto-regenerate keywords when campaign goal changes (only if already in review mode)
    const handleRegenerateKeywords = async (campaign?: ICPReconCampaign) => {
        const target = campaign || activeCampaign;
        setIsParsing(true);
        try {
            const synthesizedQueries = await generateICPReconQueries(target);
            setQueries(synthesizedQueries);
        } catch (e) {
            console.error(e);
        } finally {
            setIsParsing(false);
        }
    };

    const handleGenerateStructured = async () => {
        setIsParsing(true);
        try {
            const synthesizedBrief = `
                Targeting: ${activeCampaign.roles.join(', ')} 
                in Industries: ${activeCampaign.industries.join(', ')}. 
                Pain Points: ${activeCampaign.painPoints.join(', ')}. 
                Interests: ${activeCampaign.interests.join(', ')}.
                Negative Keywords: ${activeCampaign.negativeKeywords.join(', ')}.
                Platforms: ${activeCampaign.platforms.join(', ')}.
                Archetype: ${activeCampaign.campaignType}.
                Funnel: ${activeCampaign.funnelStage}.
                Custom Constraints: ${Object.entries(activeCampaign.customParameters || {}).map(([k,v]) => `${k}=${v}`).join('; ')}
            `;
            
            const campaign: ICPReconCampaign = {
                ...activeCampaign,
                name: activeCampaign.name || `CAMPAIGN_${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                originalBrief: synthesizedBrief,
                timestamp: new Date().toISOString()
            };

            setActiveCampaign(campaign);
            const synthesizedQueries = await generateICPReconQueries(campaign);
            setQueries(synthesizedQueries);
            setViewMode('review');
        } catch (e) {
            console.error(e);
        } finally {
            setIsParsing(false);
        }
    };

    const handleConfirmLaunch = () => {
        setViewMode('dashboard');
        const initialStats = { status: 'searching' as const, scanned: 0, found: 0, platformBreakdown: {} };
        setMissionStats(initialStats);
        
        window.dispatchEvent(new CustomEvent('answerly_recon_pulse', {
            detail: { 
                action: 'START_RECON', 
                keywords: queries, 
                platforms: activeCampaign.platforms,
                campaign: activeCampaign,
                timestamp: new Date().toISOString(), 
                campaignId: activeCampaign.id 
            } 
        }));

        setCampaigns(prev => [
            { ...activeCampaign, lastRun: new Date().toISOString(), queries, stats: initialStats },
            ...prev.filter(c => c.id !== activeCampaign.id)
        ]);
    };

    const addPersona = () => {
        if (newPersona.trim()) {
            setActiveCampaign(prev => ({ ...prev, roles: [...prev.roles, newPersona.trim()] }));
            setNewPersona('');
        }
    };

    const addIndustry = () => {
        if (newIndustry.trim()) {
            setActiveCampaign(prev => ({ ...prev, industries: [...prev.industries, newIndustry.trim()] }));
            setNewIndustry('');
        }
    };

    const addInterest = () => {
        if (newInterest.trim()) {
            setActiveCampaign(prev => ({ ...prev, interests: [...prev.interests, newInterest.trim()] }));
            setNewInterest('');
        }
    };

    const addNegative = () => {
        if (newNegative.trim()) {
            setActiveCampaign(prev => ({ ...prev, negativeKeywords: [...prev.negativeKeywords, newNegative.trim()] }));
            setNewNegative('');
        }
    };

    const addPainPoint = () => {
        if (newPainPoint.trim()) {
            setActiveCampaign(prev => ({ ...prev, painPoints: [...prev.painPoints, newPainPoint.trim()] }));
            setNewPainPoint('');
        }
    };

    const addCustomParam = () => {
        if (newParam.label.trim() && newParam.value.trim()) {
            setActiveCampaign(prev => ({ 
                ...prev, 
                customParameters: { ...(prev.customParameters || {}), [newParam.label.trim()]: newParam.value.trim() } 
            }));
            setNewParam({ label: '', value: '' });
        }
    };

    const removeQuery = (idx: number) => {
        const newQueries = [...queries];
        newQueries.splice(idx, 1);
        setQueries(newQueries);
    };

    const handleReset = () => {
        setBrief('');
        setNewPersona('');
        setNewPainPoint('');
        setNewParam({ label: '', value: '' });
        setShowBento(false);
        setActiveCampaign({
            id: Math.random().toString(36).substr(2, 9),
            name: '',
            roles: [],
            industries: [],
            painPoints: [],
            interests: [],
            negativeKeywords: [],
            platforms: ['X', 'LinkedIn', 'Reddit'],
            customParameters: {}
        });
        setQueries([]);
        setMissionStats({ status: 'idle', scanned: 0, found: 0, platformBreakdown: {} });
        setViewMode('builder');
    };

    const handleDeleteCampaign = () => {
        const updatedCampaigns = campaigns.filter(c => c.id !== activeCampaign.id);
        setCampaigns(updatedCampaigns);
        handleReset();
    };

    if (viewMode === 'dashboard') {
        return (
            <ICPReconDashboard 
                campaign={activeCampaign}
                queries={queries}
                stats={missionStats}
                onBack={() => setViewMode('builder')}
                onNewMission={handleReset}
                onDelete={handleDeleteCampaign}
            />
        );
    }

    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-slate-900 selection:text-white">
            {viewMode === 'builder' ? (
                <div className="max-w-6xl mx-auto px-8 py-20 space-y-24 animate-fade-in">
                    {/* Header: Minimalist & Bold */}
                    <header className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-2xl shadow-slate-900/20">
                                <Target size={24} />
                            </div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase">CAMPAIGNS <span className="text-slate-300">v6.0</span></h1>
                        </div>
                        <p className="text-sm text-slate-400 font-medium tracking-tight max-w-xl leading-relaxed">
                            Start automated lead generation across X, LinkedIn, and Reddit. 
                            Configure your campaign parameters below.
                        </p>
                    </header>

                    <div className="grid lg:grid-cols-1 gap-20 items-start">
                        <div className="space-y-20">
                            {/* Mission Strategy Selector */}
                            <section className="space-y-8">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">01. Campaign Goal</h3>
                                    <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-100">
                                        <button onClick={() => setBuilderMode('creative')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${builderMode === 'creative' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Simple</button>
                                        <button onClick={() => setBuilderMode('structured')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${builderMode === 'structured' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Pro</button>
                                    </div>
                                </div>
                            {/* Mission Archetype Selector */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    {[
                                        { id: 'intent', label: 'Find Buyers', desc: 'Looking to buy now', icon: <Zap size={16} />, defaultStage: 'bofu' },
                                        { id: 'pain', label: 'Find Angry Users', desc: 'Frustrated with current tools', icon: <Activity size={16} />, defaultStage: 'tofu' },
                                        { id: 'growth', label: 'Find Fast-Growers', desc: 'Hiring or just funded', icon: <Rocket size={16} />, defaultStage: 'tofu' },
                                        { id: 'engagement', label: 'Find Hot Threads', desc: 'Active viral discussions', icon: <MessageCircle size={16} />, defaultStage: 'tofu' },
                                        { id: 'competitor', label: 'Steal Competitors', desc: 'Leaving or asking about rivals', icon: <Shield size={16} />, defaultStage: 'mofu' }
                                    ].map(type => (
                                        <button 
                                            key={type.id}
                                            onClick={() => {
                                            const updated = { 
                                                ...activeCampaign, 
                                                campaignType: type.id as any,
                                                funnelStage: (type as any).defaultStage
                                            };
                                            setActiveCampaign(updated);
                                            // Auto-regenerate if already have keywords
                                            if (queries.length > 0 && viewMode === 'builder') {
                                                handleRegenerateKeywords(updated);
                                            }
                                        }}
                                            className={`p-6 rounded-[2.5rem] border transition-all text-left group ${activeCampaign.campaignType === type.id ? 'bg-slate-900 border-slate-900 text-white shadow-2xl shadow-slate-900/20' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                                        >
                                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-4 transition-all ${activeCampaign.campaignType === type.id ? 'bg-white/10 text-white' : 'bg-slate-50 text-slate-400'}`}>
                                                {type.icon}
                                            </div>
                                            <div className="text-[11px] font-black uppercase tracking-widest">{type.label}</div>
                                            <div className={`text-[9px] font-bold mt-1 uppercase ${activeCampaign.campaignType === type.id ? 'text-slate-400' : 'text-slate-400'}`}>{type.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {builderMode === 'creative' ? (
                                <section className="space-y-8">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">02. Simple Brief</h3>
                                    <div className="bg-slate-50 border border-slate-100 rounded-[3rem] p-12">
                                        <textarea 
                                            value={brief}
                                            onChange={(e) => setBrief(e.target.value)}
                                            placeholder="Describe your ideal target in plain English..."
                                            className="w-full h-48 bg-transparent text-lg font-medium text-slate-900 placeholder:text-slate-300 focus:ring-0 border-none transition-all leading-relaxed resize-none"
                                        />
                                    </div>
                                </section>
                            ) : (
                                <section className="space-y-12">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">02. Target Profile</h3>
                                        <input 
                                            type="text" 
                                            value={activeCampaign.name} 
                                            onChange={(e) => setActiveCampaign(prev => ({ ...prev, name: e.target.value }))}
                                            placeholder="Campaign Name..."
                                            className="bg-transparent border-b border-slate-200 text-sm font-black uppercase tracking-widest outline-none focus:border-slate-900 pb-2 text-right w-64"
                                        />
                                    </div>
                                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {/* Identity Module */}
                                        <div className="p-8 rounded-[2.5rem] bg-slate-50 border border-slate-100 space-y-6">
                                            <div className="flex items-center gap-3">
                                                <Users size={18} className="text-slate-900" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest">
                                        {activeCampaign.campaignType === 'competitor' ? 'Target Brands' : 
                                         activeCampaign.campaignType === 'engagement' ? 'Key People' : 'Job Titles'}
                                    </h4>
                                            </div>
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <input 
                                                        type="text" 
                                                        value={newPersona} 
                                                        onChange={(e) => setNewPersona(e.target.value)} 
                                                        onKeyDown={(e) => e.key === 'Enter' && addPersona()} 
                                                        placeholder={
                                                            activeCampaign.campaignType === 'competitor' ? "e.g., Google" :
                                                            activeCampaign.campaignType === 'engagement' ? "e.g., @elonmusk" : "e.g., Sales Manager"
                                                        } 
                                                        className="w-full bg-white border border-slate-100 rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:border-slate-900" 
                                                    />
                                                    <div className="flex flex-wrap gap-2">
                                                        {activeCampaign.roles.map((r, i) => (
                                                            <span key={i} className="px-3 py-1.5 bg-white border border-slate-100 text-[9px] font-black uppercase rounded-xl flex items-center gap-2 group">
                                                                {r} <X size={10} className="cursor-pointer opacity-30 hover:opacity-100" onClick={() => setActiveCampaign(prev => ({ ...prev, roles: prev.roles.filter((_, idx) => idx !== i) }))} />
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <input type="text" value={newIndustry} onChange={(e) => setNewIndustry(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addIndustry()} placeholder="Add Industry..." className="w-full bg-white border border-slate-100 rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:border-slate-900" />
                                                    <div className="flex flex-wrap gap-2">
                                                        {activeCampaign.industries.map((ind, i) => (
                                                            <span key={i} className="px-3 py-1.5 bg-white border border-slate-100 text-[9px] font-black uppercase rounded-xl flex items-center gap-2 group">
                                                                {ind} <X size={10} className="cursor-pointer opacity-30 hover:opacity-100" onClick={() => setActiveCampaign(prev => ({ ...prev, industries: prev.industries.filter((_, idx) => idx !== i) }))} />
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Signals Module */}
                                        <div className="p-8 rounded-[2.5rem] bg-slate-50 border border-slate-100 space-y-6">
                                            <div className="flex items-center gap-3">
                                                <Zap size={18} className="text-slate-900" />
                                                {activeCampaign.campaignType === 'intent' ? 'Buyer Keywords' :
                                                 activeCampaign.campaignType === 'pain' ? 'Pain Points' :
                                                 activeCampaign.campaignType === 'growth' ? 'Growth Keywords' :
                                                 activeCampaign.campaignType === 'competitor' ? 'Switch Triggers' : 'Keywords'}
                                            </div>
                                            <div className="space-y-4">
                                                <input 
                                                    type="text" 
                                                    value={newPainPoint} 
                                                    onChange={(e) => setNewPainPoint(e.target.value)} 
                                                    onKeyDown={(e) => e.key === 'Enter' && addPainPoint()} 
                                                    placeholder={
                                                        activeCampaign.campaignType === 'intent' ? "e.g., looking for, alternative to..." :
                                                        activeCampaign.campaignType === 'pain' ? "e.g., too slow, broken, expensive..." :
                                                        activeCampaign.campaignType === 'growth' ? "e.g., hiring, funding, scale..." :
                                                        activeCampaign.campaignType === 'competitor' ? "e.g., cancelling, moving from..." : "Add keywords..."
                                                    } 
                                                    className="w-full bg-white border border-slate-100 rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:border-slate-900" 
                                                />
                                                <div className="flex flex-wrap gap-2">
                                                    {activeCampaign.painPoints.map((p, i) => (
                                                        <span key={i} className="px-3 py-1.5 bg-white border border-slate-100 text-[9px] font-black uppercase rounded-xl flex items-center gap-2 group">
                                                            {p} <X size={10} className="cursor-pointer opacity-30 hover:opacity-100" onClick={() => setActiveCampaign(prev => ({ ...prev, painPoints: prev.painPoints.filter((_, idx) => idx !== i) }))} />
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="space-y-2">
                                                    <input type="text" value={newInterest} onChange={(e) => setNewInterest(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addInterest()} placeholder="Add Interest/Topic..." className="w-full bg-white border border-slate-100 rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:border-slate-900" />
                                                    <div className="flex flex-wrap gap-2">
                                                        {activeCampaign.interests.map((int, i) => (
                                                            <span key={i} className="px-3 py-1.5 bg-white border border-slate-100 text-[9px] font-black uppercase rounded-xl flex items-center gap-2 group">
                                                                {int} <X size={10} className="cursor-pointer opacity-30 hover:opacity-100" onClick={() => setActiveCampaign(prev => ({ ...prev, interests: prev.interests.filter((_, idx) => idx !== i) }))} />
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Ignore List Module */}
                                        <div className="p-8 rounded-[2.5rem] bg-slate-50 border border-slate-100 space-y-6">
                                            <div className="flex items-center gap-3">
                                                <Filter size={18} className="text-slate-900" />
                                                <h4 className="text-[10px] font-black uppercase tracking-widest">Exclude Keywords</h4>
                                            </div>
                                            <div className="space-y-4">
                                                <input type="text" value={newNegative} onChange={(e) => setNewNegative(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNegative()} placeholder="Filter out..." className="w-full bg-white border border-slate-100 rounded-2xl px-5 py-3 text-xs font-bold outline-none focus:border-slate-900" />
                                                <div className="flex flex-wrap gap-2">
                                                    {activeCampaign.negativeKeywords.map((p, i) => (
                                                        <span key={i} className="px-3 py-1.5 bg-slate-900 text-white text-[9px] font-black uppercase rounded-xl flex items-center gap-2 group">
                                                            {p} <X size={10} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => setActiveCampaign(prev => ({ ...prev, negativeKeywords: prev.negativeKeywords.filter((_, idx) => idx !== i) }))} />
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Global Mission Config (Platform + Depth) */}
                            <section className="space-y-12">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-12 border-t border-slate-100">
                                    <section className="space-y-6">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">03. Sources</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {['X', 'LinkedIn', 'Reddit'].map(p => (
                                                <button key={p} onClick={() => setActiveCampaign(prev => ({ ...prev, platforms: prev.platforms.includes(p) ? prev.platforms.filter(x => x !== p) : [...prev.platforms, p] }))}
                                                    className={`px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeCampaign.platforms.includes(p) ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/20' : 'bg-slate-50 text-slate-400'}`}
                                                >
                                                    {p}
                                                </button>
                                            ))}
                                        </div>
                                    </section>

                                    <section className="space-y-6">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">04. Search Depth</h4>
                                        <div className="flex flex-col md:flex-row gap-4">
                                            {[
                                                { id: 'surface', label: 'Posts', desc: 'Scan main feed & top-level posts', icon: <Search size={14} /> },
                                                { id: 'engagement', label: 'Comments & Reactions', desc: 'Scan all replies & thread engagement', icon: <MessageCircle size={14} /> }
                                            ].map(d => (
                                                <button key={d.id} onClick={() => setActiveCampaign(prev => ({ ...prev, reconDepth: d.id as any }))}
                                                    className={`flex-1 p-6 rounded-[2rem] border-2 transition-all flex flex-col gap-4 text-left ${activeCampaign.reconDepth === d.id ? 'bg-white border-slate-900 shadow-xl' : 'bg-slate-50 border-transparent text-slate-400'}`}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeCampaign.reconDepth === d.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-300'}`}>{d.icon}</div>
                                                        <div className="text-[11px] font-black uppercase tracking-widest">{d.label}</div>
                                                    </div>
                                                    <div className={`text-[9px] font-bold uppercase tracking-tight ${activeCampaign.reconDepth === d.id ? 'text-slate-500' : 'text-slate-400'}`}>
                                                        {d.desc}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </section>
                                </div>

                                <button 
                                    onClick={builderMode === 'creative' ? handleGenerate : handleGenerateStructured}
                                    disabled={builderMode === 'creative' ? (!brief || isParsing) : ((activeCampaign.roles.length === 0 && activeCampaign.painPoints.length === 0) || isParsing)}
                                    className="w-full py-8 bg-slate-900 text-white rounded-[2.5rem] font-black uppercase tracking-[0.4em] text-[12px] hover:scale-[1.01] transition-all shadow-2xl shadow-slate-900/40 mt-8 flex items-center justify-center gap-4"
                                >
                                    {isParsing ? <Loader2 size={20} className="animate-spin" /> : <Rocket size={20} />}
                                    <span>{isParsing ? "SYNTHESIZING..." : "LAUNCH CAMPAIGN"}</span>
                                </button>
                            </section>
                        </div>

                        {/* Sidebar: Recent Missions only */}
                        <aside className="space-y-12 pt-16">
                            {campaigns.length > 0 && (
                                <section className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recent Missions</h4>
                                        <button 
                                            onClick={() => {
                                                if (window.confirm("EMERGENCY RESET: This will STOP all running scans and DELETE all campaigns/leads to protect your account. Proceed?")) {
                                                    // 1. Stop background & Clear Chrome Storage
                                                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                                                        chrome.runtime.sendMessage({ action: 'STOP_RECON_MISSION' });
                                                        // Explicitly clear chrome storage if possible
                                                        if (chrome.storage?.local) {
                                                            chrome.storage.local.remove(['recon_queue', 'active_campaign', 'keyword_stats', 'pipeline_leads', 'stop_recon_mission']);
                                                        }
                                                    }
                                                    // 2. Clear Web App State
                                                    setCampaigns([]);
                                                    setQueries([]);
                                                    setMissionStats({ status: 'idle', scanned: 0, found: 0, platformBreakdown: {} });
                                                    
                                                    const defaultCampaign = {
                                                        id: Math.random().toString(36).substr(2, 9),
                                                        name: '',
                                                        roles: [],
                                                        industries: [],
                                                        painPoints: [],
                                                        interests: [],
                                                        negativeKeywords: [],
                                                        platforms: ['X', 'LinkedIn', 'Reddit'],
                                                        customParameters: {},
                                                        campaignType: 'intent',
                                                        funnelStage: 'tofu',
                                                        reconDepth: 'surface'
                                                    };
                                                    setActiveCampaign(defaultCampaign as any);

                                                    localStorage.removeItem('pipeline_leads');
                                                    localStorage.removeItem('keyword_stats');
                                                    localStorage.removeItem('icp_recon_campaigns');
                                                    localStorage.removeItem('icp_recon_active_campaign');
                                                    localStorage.removeItem('icp_recon_queries');
                                                    localStorage.removeItem('icp_recon_stats');
                                                    
                                                    setViewMode('builder');
                                                    alert("Emergency Halt Complete. All data cleared.");
                                                }
                                            }}
                                            className="text-[8px] font-black uppercase tracking-widest text-red-400 hover:text-red-600 transition-colors"
                                        >
                                            Force Reset All
                                        </button>
                                    </div>
                                    <div className="space-y-3">
                                        {campaigns.slice(0, 5).map(c => (
                                            <div key={c.id} className="p-5 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all cursor-pointer group" onClick={() => { setActiveCampaign(c); setViewMode('dashboard'); }}>
                                                <h5 className="text-[10px] font-black uppercase tracking-tight text-slate-900">{c.name || "UNNAMED_OP"}</h5>
                                                <div className="flex items-center justify-between mt-2">
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{c.stats?.found || 0} Leads</span>
                                                    <ChevronRight size={12} className="text-slate-300 group-hover:translate-x-1 transition-all" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </aside>
                    </div>
                </div>
            ) : viewMode === 'review' ? (
                <div className="max-w-4xl mx-auto px-8 py-20 space-y-16 animate-fade-in">
                    <header className="flex justify-between items-center">
                        <div>
                            <h2 className="text-3xl font-black tracking-tighter uppercase text-slate-900">
                                {activeCampaign.campaignType?.toUpperCase()} RESULTS
                            </h2>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mt-2">REVIEW {queries.length} TARGET SEARCHES</p>
                        </div>
                        <div className="flex items-center gap-6">
                            <button onClick={() => setViewMode('builder')} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors">Back</button>
                            <button 
                                onClick={() => handleRegenerateKeywords()}
                                disabled={isParsing}
                                className="px-8 py-4 bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-100 active:scale-[0.98] transition-all flex items-center gap-3 disabled:opacity-50"
                            >
                                {isParsing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                                Regenerate
                            </button>
                            <button onClick={handleConfirmLaunch} className="px-10 py-5 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-2xl shadow-slate-900/20 flex items-center gap-3">
                                <Rocket size={16} /> Start Scan
                            </button>
                        </div>
                    </header>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                            <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-900">MISSION VECTOR FEED</h3>
                            <button 
                                onClick={() => {
                                    const newQuery: ICPTrackingKeyword = {
                                        platform: activeCampaign.platforms[0] || 'X',
                                        query: 'New search term...',
                                        intent: 'Manual Entry'
                                    };
                                    setQueries([...queries, newQuery]);
                                }}
                                className="p-2 text-slate-400 hover:text-slate-900 transition-colors"
                            >
                                <Plus size={16} />
                            </button>
                        </div>

                        <div className="flex flex-col gap-2">
                            {queries.length === 0 ? (
                                <div className="p-8 border border-dashed border-slate-100 rounded-3xl text-center">
                                    <p className="text-[9px] text-slate-300 font-black uppercase tracking-widest">Zero vectors synthesized</p>
                                </div>
                            ) : (
                                queries.map((q, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-4 bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded-2xl transition-all group">
                                        <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center text-[8px] font-black text-slate-500 shrink-0">
                                            {q.platform.substring(0, 1).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <input 
                                                type="text" 
                                                value={q.query} 
                                                onChange={(e) => { 
                                                    const n = [...queries]; 
                                                    n[idx] = { ...q, query: e.target.value }; 
                                                    setQueries(n); 
                                                }} 
                                                className="w-full bg-transparent border-none p-0 text-xs font-bold text-slate-900 focus:ring-0 placeholder:text-slate-300 truncate" 
                                                placeholder="Vector..." 
                                            />
                                            <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 mt-0.5 truncate">{q.intent}</div>
                                        </div>
                                        <button onClick={() => removeQuery(idx)} className="p-1.5 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="max-w-6xl mx-auto px-8 py-20 animate-fade-in">
                    {/* Minimalist Dashboard View Placeholder */}
                    <div className="flex items-center justify-between mb-20">
                         <div className="flex items-center gap-6">
                            <button onClick={() => setViewMode('builder')} className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-all border border-slate-100">
                                <ArrowLeft size={20} />
                            </button>
                            <div>
                                <h2 className="text-3xl font-black tracking-tighter uppercase text-slate-900">{activeCampaign.name || "ACTIVE_CAMPAIGN"}</h2>
                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mt-2">Status: Scan Active</p>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Status Cards */}
                        <div className="p-10 bg-slate-900 rounded-[3rem] text-white space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Leads</div>
                            <div className="text-5xl font-black tracking-tighter">{activeCampaign.stats?.found || 0}</div>
                        </div>
                        <div className="p-10 bg-slate-50 border border-slate-100 rounded-[3rem] space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scan Depth</div>
                            <div className="text-2xl font-black tracking-tighter uppercase">{activeCampaign.reconDepth}</div>
                        </div>
                        <div className="p-10 bg-slate-50 border border-slate-100 rounded-[3rem] space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Intent Stage</div>
                            <div className="text-2xl font-black tracking-tighter uppercase">{activeCampaign.funnelStage}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
