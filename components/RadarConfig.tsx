import React, { useState, useEffect } from 'react';
import { 
    Zap, ShieldCheck, Search, Plus, Loader2, Sparkles, Target, 
    Filter, AlertCircle, CheckCircle, X as XIcon, Radar,
    Users, Globe, Hash, Wifi, WifiOff
} from 'lucide-react';
import { filterProfilesWithAI } from '../services/groqService';
import { ICPReconCampaign } from '../types';

const PLATFORMS = ['X', 'LinkedIn'];

const ACCOUNT_TYPES = [
    { id: 'all',        label: 'All Accounts',   desc: 'Any account type' },
    { id: 'verified',   label: 'Verified Only',  desc: 'Blue checkmark accounts' },
    { id: 'creators',   label: 'Creators',       desc: 'High post frequency' },
    { id: 'founders',   label: 'Founders',       desc: 'Startup & product builders' },
    { id: 'investors',  label: 'Investors',      desc: 'VCs, angels, advisors' },
];

const FOLLOWER_RANGES = [
    { id: 'any',    label: 'Any Size',      min: 0,       max: Infinity },
    { id: 'nano',   label: 'Nano (1K-10K)', min: 1000,    max: 10000 },
    { id: 'micro',  label: 'Micro (10K-100K)', min: 10000, max: 100000 },
    { id: 'macro',  label: 'Macro (100K+)',  min: 100000, max: Infinity },
];

const LANGUAGES = ['Any', 'English', 'French', 'Spanish', 'German', 'Arabic'];

type DiscoveryStatus = 'idle' | 'searching' | 'done' | 'error';

export const RadarConfig: React.FC = () => {
  // Discovery State
  const [searchQuery, setSearchQuery]     = useState('');
  const [platform, setPlatform]           = useState<'X' | 'LinkedIn'>('X');
  const [accountType, setAccountType]     = useState('all');
  const [followerRange, setFollowerRange] = useState('any');
  const [language, setLanguage]           = useState('Any');
  const [keywords, setKeywords]           = useState<string[]>([]);
  const [kwInput, setKwInput]             = useState('');
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('idle');
  const [discoveredAccounts, setDiscoveredAccounts] = useState<any[]>([]);
  const [errorMsg, setErrorMsg]           = useState('');
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [isAIFiltering, setIsAIFiltering] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<ICPReconCampaign | null>(null);
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set());
  const [trackedAccounts, setTrackedAccounts] = useState<any[]>([]);
  const [pulseMessage, setPulseMessage] = useState('Standby');
  const [sidebarPlatformFilter, setSidebarPlatformFilter] = useState<'All' | 'X' | 'LinkedIn' | 'Reddit'>('All');
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [newManualUrl, setNewManualUrl] = useState('');
  const [newManualLabel, setNewManualLabel] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 25;

  useEffect(() => {
    // Load active campaign for ICP context
    const saved = localStorage.getItem('icp_recon_active_campaign');
    if (saved) {
        try { setActiveCampaign(JSON.parse(saved)); } catch(e) {}
    }
  }, []);

  useEffect(() => {
    // Load tracked accounts from storage
    const loadTracked = () => {
        const raw = localStorage.getItem('answerly_creator_configs');
        if (raw) {
            try { setTrackedAccounts(JSON.parse(raw)); } catch(e) {}
        }
    };
    loadTracked();

    const handlePong = () => setExtensionConnected(true);
    const handleResults = (e: any) => {
        const { success, results, error, streaming } = e.detail || {};
        if (success && results?.length > 0) {
            setDiscoveredAccounts(results);
            if (!streaming) {
                setDiscoveryStatus('done');
            } else {
                setDiscoveryStatus('searching');
            }
        } else if (success && results?.length === 0) {
            if (!streaming) {
                setErrorMsg('No accounts found. Try different keywords or filters.');
                setDiscoveryStatus('error');
            }
        } else if (!streaming) {
            setErrorMsg(error || 'Search failed. Ensure the extension is connected.');
            setDiscoveryStatus('error');
        }
    };

    const handlePulse = (e: any) => {
        if (e.detail?.msg) setPulseMessage(e.detail.msg);
    };

    window.addEventListener('answerly_pong', handlePong);
    window.addEventListener('answerly_discover_results', handleResults);
    window.addEventListener('answerly_sync', loadTracked);
    window.addEventListener('answerly_pulse_update', handlePulse);
    window.dispatchEvent(new CustomEvent('answerly_ping'));

    return () => {
        window.removeEventListener('answerly_pong', handlePong);
        window.removeEventListener('answerly_discover_results', handleResults);
        window.removeEventListener('answerly_sync', loadTracked);
        window.removeEventListener('answerly_pulse_update', handlePulse);
    };
  }, []);

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (kw && !keywords.includes(kw)) setKeywords(prev => [...prev, kw]);
    setKwInput('');
  };

  const handleDiscover = () => {
    if (!searchQuery.trim()) return;
    if (!extensionConnected) {
        setErrorMsg('Extension not connected. Please open the dashboard with the Viraholic extension active.');
        setDiscoveryStatus('error');
        return;
    }
    setDiscoveryStatus('searching');
    setDiscoveredAccounts([]);
    setCurrentPage(1);
    setErrorMsg('');

    const filters = { accountType, followerRange, language, additionalKeywords: keywords };
    window.dispatchEvent(new CustomEvent('answerly_discover_accounts', { 
        detail: { query: searchQuery, platform, filters } 
    }));
  };

  const handleTrack = (account: any) => {
    try {
        const raw = localStorage.getItem('answerly_creator_configs');
        const configs = raw ? JSON.parse(raw) : [];
        const exists = configs.some((c: any) => c.url === account.url || c.handle === account.handle);
        if (!exists) {
            const newItem = {
                id: 'ans_' + Date.now(),
                label: account.name || account.handle,
                url: account.url,
                platform: account.platform,
                handle: account.handle,
                addedAt: new Date().toISOString()
            };
            configs.push(newItem);
            localStorage.setItem('answerly_creator_configs', JSON.stringify(configs));
            window.dispatchEvent(new CustomEvent('answerly_sync', { detail: configs }));
            setTrackedAccounts(configs);
        }
        setDiscoveredAccounts(prev => prev.map(a => 
            a.handle === account.handle ? { ...a, tracked: true } : a
        ));
    } catch(e) { console.error('Failed to track account', e); }
  };

  const handleUntrack = (id: string) => {
    const updated = trackedAccounts.filter(c => c.id !== id);
    localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
    setTrackedAccounts(updated);
    // Also sync back to discovered list if visible
    setDiscoveredAccounts(prev => prev.map(a => {
        const matchingTracked = updated.some(t => t.handle === a.handle);
        return { ...a, tracked: matchingTracked };
    }));
  };

  const handleManualAdd = () => {
    if (!newManualUrl) return;
    
    let platform: 'X' | 'LinkedIn' | 'Reddit' = 'X';
    if (newManualUrl.includes('x.com') || newManualUrl.includes('twitter.com')) platform = 'X';
    else if (newManualUrl.includes('linkedin.com')) platform = 'LinkedIn';
    else if (newManualUrl.includes('reddit.com')) platform = 'Reddit';

    const handle = newManualUrl.split('/').pop() || 'user';

    const newItem = {
        id: 'ans_' + Date.now(),
        label: newManualLabel || handle,
        url: newManualUrl,
        platform,
        handle,
        addedAt: new Date().toISOString()
    };

    const updated = [...trackedAccounts, newItem];
    setTrackedAccounts(updated);
    localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
    
    setNewManualUrl('');
    setNewManualLabel('');
    setShowManualAdd(false);
  };

  const handleStopMission = () => {
    window.dispatchEvent(new CustomEvent('answerly_recon_stop'));
    setDiscoveryStatus('done');
  };

  const handleTrackSelected = () => {
    if (selectedHandles.size === 0) return;
    const toTrack = discoveredAccounts.filter(a => selectedHandles.has(a.handle) && !a.tracked);
    toTrack.forEach(account => handleTrack(account));
    setSelectedHandles(new Set());
  };

  const toggleSelect = (handle: string) => {
    setSelectedHandles(prev => {
        const next = new Set(prev);
        if (next.has(handle)) next.delete(handle);
        else next.add(handle);
        return next;
    });
  };

  const selectHotLeads = () => {
    const hot = discoveredAccounts
        .filter(a => a.aiScore >= 75 && !a.tracked)
        .map(a => a.handle);
    setSelectedHandles(new Set(hot));
  };

  const handleAIAudit = async () => {
    if (discoveredAccounts.length === 0) return;
    
    // Fallback if no specific campaign is selected
    const effectiveCampaign = activeCampaign || {
        name: "General Founder Search",
        roles: ["Founder", "CEO", "Builder", "Maker", "Owner"],
        industries: ["SaaS", "Software", "Tech", "Startups"],
        painPoints: ["Growth", "Scaling", "Acquisition"],
        interests: ["Indie Hacking", "Building in Public"]
    };

    setIsAIFiltering(true);
    try {
        const { validProfiles } = await filterProfilesWithAI(discoveredAccounts, effectiveCampaign as any);
        
        // Merge AI results back into accounts
        setDiscoveredAccounts(prev => prev.map(account => {
            const audit = validProfiles?.find(p => p.handle === account.handle);
            if (audit) {
                return {
                    ...account,
                    aiValidated: true,
                    aiScore: audit.relevanceScore,
                    aiReasoning: audit.reasoning,
                    isTarget: audit.isTarget
                };
            }
            return account;
        }).sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0)));
        
    } catch (e) {
        console.error('AI Audit Failed', e);
        setErrorMsg('AI Audit failed. Please check your API key and connection.');
    } finally {
        setIsAIFiltering(false);
    }
  };

  const PlatformIcon = ({ p, size = 16 }: { p: string; size?: number }) => {
    if (p === 'X') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-blue-500"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-12 animate-fade-in pb-20">
        {/* Header */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-indigo-600 rounded-[2.5rem] flex items-center justify-center shadow-lg shadow-indigo-200">
                    <Zap size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-display font-bold text-gray-900">Radar <span className="text-indigo-600">Setup</span></h2>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-gray-400 mt-1">Configure tracking & discover accounts</p>
                </div>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${extensionConnected ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-500 border-rose-100 animate-pulse'}`}>
                {extensionConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
                {extensionConnected ? 'Extension Active' : 'Extension Offline'}
            </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
            {/* ── Discovery Section ── */}
            <div className="xl:col-span-8 space-y-6">
                <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden">
                    {/* Discovery Header */}
                    <div className="p-8 border-b border-gray-50">
                        <h3 className="text-xl font-display font-bold text-gray-900 flex items-center gap-3">
                            <Sparkles size={22} className="text-indigo-500" /> Account Discovery
                        </h3>
                        <p className="text-sm text-gray-400 mt-1.5">Search runs through the Chrome extension — a real browser window opens on {platform} to find accounts.</p>
                    </div>

                    <div className="p-8 space-y-8">
                        {/* Main Search + Platform */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Search Query</label>
                            <div className="flex gap-3">
                                {/* Platform Toggle */}
                                <div className="flex rounded-2xl bg-gray-50 border border-gray-100 p-1 shrink-0">
                                    {PLATFORMS.map(p => (
                                        <button
                                            key={p}
                                            onClick={() => setPlatform(p as any)}
                                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${platform === p ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-400 hover:text-gray-600'}`}
                                        >
                                            <PlatformIcon p={p} />
                                            {p}
                                        </button>
                                    ))}
                                </div>
                                {/* Search Input */}
                                <div className="relative flex-1">
                                    <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                                        <Search size={18} className="text-gray-400" />
                                    </div>
                                    <input 
                                        type="text"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleDiscover()}
                                        placeholder={`e.g. "AI SaaS founders", "growth hacking"`}
                                        className="w-full pl-14 pr-6 h-14 bg-gray-50 border border-gray-100 rounded-2xl text-sm focus:bg-white focus:ring-4 focus:ring-indigo-50 transition-all outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* ── Filter Grid ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            {/* Account Type */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                                    <Users size={12} /> Account Type
                                </label>
                                <div className="space-y-2">
                                    {ACCOUNT_TYPES.map(t => (
                                        <button key={t.id} onClick={() => setAccountType(t.id)}
                                            className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm ${accountType === t.id ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-indigo-100'}`}
                                        >
                                            <span className="font-bold block text-[11px]">{t.label}</span>
                                            <span className="text-[10px] opacity-60">{t.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Follower Range */}
                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                                    <Filter size={12} /> Audience Size
                                </label>
                                <div className="space-y-2">
                                    {FOLLOWER_RANGES.map(r => (
                                        <button key={r.id} onClick={() => setFollowerRange(r.id)}
                                            className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all text-sm font-bold ${followerRange === r.id ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-indigo-100'}`}
                                        >
                                            {r.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Language + Keyword Tags */}
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                                        <Globe size={12} /> Language
                                    </label>
                                    <select value={language} onChange={e => setLanguage(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm text-gray-700 font-bold focus:ring-4 focus:ring-indigo-50 outline-none"
                                    >
                                        {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                                    </select>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                                        <Hash size={12} /> Bio Must Include
                                    </label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text"
                                            value={kwInput}
                                            onChange={e => setKwInput(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && addKeyword()}
                                            placeholder="Add keyword..."
                                            className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-50"
                                        />
                                        <button onClick={addKeyword} className="px-3 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all">
                                            <Plus size={16} />
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2 min-h-[2rem]">
                                        {keywords.map(kw => (
                                            <span key={kw} className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[11px] font-bold">
                                                {kw}
                                                <button onClick={() => setKeywords(prev => prev.filter(k => k !== kw))}>
                                                    <XIcon size={10} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── Launch Button ── */}
                        <button 
                            onClick={handleDiscover}
                            disabled={discoveryStatus === 'searching' || !searchQuery.trim()}
                            className="w-full h-16 bg-indigo-600 text-white rounded-2xl text-[12px] font-black uppercase tracking-[0.2em] hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 disabled:opacity-50 flex items-center justify-center gap-3"
                        >
                            {discoveryStatus === 'searching' 
                                ? <><Loader2 size={20} className="animate-spin" /> Opening Chrome window & searching...</>
                                : <><Target size={20} /> Launch Discovery on {platform}</>
                            }
                        </button>
                        
                        {discoveryStatus === 'searching' && (
                            <button 
                                onClick={handleStopMission}
                                className="w-full h-12 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] border border-rose-100 hover:bg-rose-100 transition-all flex items-center justify-center gap-2"
                            >
                                <XIcon size={14} /> Stop Active Mission
                            </button>
                        )}

                        {/* Status Messages */}
                        {discoveryStatus === 'searching' && (
                            <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-2xl border border-indigo-100 text-sm text-indigo-600 font-medium">
                                <Loader2 size={16} className="animate-spin shrink-0" />
                                A Chrome window has opened on {platform}. Scanning people results... This may take up to 20 seconds.
                            </div>
                        )}
                        {discoveryStatus === 'error' && (
                            <div className="flex items-center gap-3 p-4 bg-rose-50 rounded-2xl border border-rose-100 text-sm text-rose-600 font-medium">
                                <AlertCircle size={16} className="shrink-0" />
                                {errorMsg}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Results ── */}
                {discoveredAccounts.length > 0 && (() => {
                    // Emoji likeliness: 0=cold, 1=low, 2=medium, 3=hot
                    const getEmojis = (score?: number, isPending?: boolean): string => {
                        if (isPending || score === undefined) return '';
                        if (score >= 75) return '🔥🔥🔥';
                        if (score >= 50) return '🔥🔥';
                        if (score >= 25) return '🔥';
                        return '❄️';
                    };
                    const getScoreLabel = (score?: number): string => {
                        if (score === undefined) return 'Pending';
                        if (score >= 75) return 'Hot Lead';
                        if (score >= 50) return 'Warm';
                        if (score >= 25) return 'Low';
                        return 'Cold';
                    };
                    const formatNum = (n?: number) => {
                        if (!n) return '—';
                        if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
                        if (n >= 1000) return (n/1000).toFixed(1)+'K';
                        return String(n);
                    };
                    const audited = discoveredAccounts.filter(a => a.aiValidated).length;
                    const pending = discoveredAccounts.filter(a => a.status === 'pending').length;
                    return (
                    <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-gray-50/30">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <CheckCircle size={16} className="text-emerald-500" />
                                    <span className="font-bold text-gray-900 text-sm">{discoveredAccounts.length} Found</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-lg font-bold">{audited} audited</span>
                                    {pending > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-600 rounded-lg font-bold animate-pulse">{pending} scanning...</span>}
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {selectedHandles.size > 0 && (
                                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4">
                                        <button 
                                            onClick={selectHotLeads}
                                            className="px-3 py-1.5 bg-amber-50 text-amber-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 transition-all border border-amber-100"
                                        >
                                            Select Hot (75%+)
                                        </button>
                                        <button 
                                            onClick={handleTrackSelected}
                                            className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                                        >
                                            <Zap size={11} fill="currentColor" /> Track {selectedHandles.size} Selected
                                        </button>
                                        <div className="w-px h-4 bg-gray-200 mx-1" />
                                    </div>
                                )}
                                <button 
                                    onClick={handleAIAudit}
                                    disabled={isAIFiltering || !activeCampaign}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-indigo-200 transition-all disabled:opacity-50"
                                >
                                    {isAIFiltering ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                    {isAIFiltering ? 'Auditing...' : 'AI Audit'}
                                </button>
                            </div>
                        </div>

                        {/* Legend */}
                        <div className="px-6 py-2 bg-gray-100/40 border-b border-gray-100 flex items-center gap-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                            <span className="w-6 shrink-0 flex items-center">
                                <input 
                                    type="checkbox"
                                    checked={discoveredAccounts.length > 0 && discoveredAccounts.filter(a => !a.tracked && a.status !== 'pending').every(a => selectedHandles.has(a.handle))}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            const all = discoveredAccounts.filter(a => !a.tracked && a.status !== 'pending').map(a => a.handle);
                                            setSelectedHandles(new Set(all));
                                        } else {
                                            setSelectedHandles(new Set());
                                        }
                                    }}
                                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                            </span>
                            <span className="w-44">Account</span>
                            <span className="w-24">Followers</span>
                            <span className="w-20">Avg Views</span>
                            <span className="w-16">Likes</span>
                            <span className="w-16">Replies</span>
                            <span className="flex-1 text-right">Likeliness</span>
                        </div>

                        {/* Rows */}
                        <div className="divide-y divide-gray-50">
                            {(() => {
                                const start = (currentPage - 1) * ITEMS_PER_PAGE;
                                const paginated = discoveredAccounts.slice(start, start + ITEMS_PER_PAGE);
                                const totalPages = Math.ceil(discoveredAccounts.length / ITEMS_PER_PAGE);

                                return (
                                <>
                                    {paginated.map((account, i) => {
                                        const isPending = account.status === 'pending';
                                        const emojis = getEmojis(account.aiScore, isPending);
                                        return (
                                        <div 
                                            key={account.handle || (start + i)} 
                                            className={`flex items-center gap-4 px-6 py-3 hover:bg-gray-50/80 transition-all group ${isPending ? 'opacity-60' : ''} ${selectedHandles.has(account.handle) ? 'bg-indigo-50/30' : ''}`}
                                        >
                                            {/* Checkbox */}
                                            <div className="w-6 shrink-0 flex items-center">
                                                {!isPending && !account.tracked && (
                                                    <input 
                                                        type="checkbox" 
                                                        checked={selectedHandles.has(account.handle)}
                                                        onChange={() => toggleSelect(account.handle)}
                                                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                    />
                                                )}
                                                {account.tracked && <CheckCircle size={14} className="text-emerald-500" />}
                                            </div>

                                            {/* Account identity */}
                                            <div className="w-44 flex items-center gap-2.5 min-w-0">
                                                <div className="w-8 h-8 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 text-[10px]">
                                                    <PlatformIcon p={account.platform} size={14} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[12px] font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                                                            {isPending ? account.handle : (account.name?.split('\n')[0] || `@${account.handle}`)}
                                                        </span>
                                                        {account.verified && <span title="Verified" className="text-blue-400 text-[10px]">✓</span>}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                                                        <span className="text-[10px] text-gray-400 font-mono truncate shrink-0">@{account.handle}</span>
                                                        {!isPending && account.bio && (
                                                            <span className="text-[10px] text-gray-300 truncate border-l border-gray-100 pl-1.5">{account.bio}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Followers */}
                                            <div className="w-24">
                                                {isPending ? (
                                                    <div className="h-3 bg-gray-100 rounded animate-pulse w-12" />
                                                ) : (
                                                    <span className="text-[11px] font-bold text-gray-600">
                                                        {account.followers ? formatNum(account.followers) : '—'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Avg Views */}
                                            <div className="w-20">
                                                {isPending ? (
                                                    <div className="h-3 bg-gray-100 rounded animate-pulse w-10" />
                                                ) : (
                                                    <span className="text-[11px] text-gray-500">
                                                        {account.kpis?.avgViews ? formatNum(account.kpis.avgViews) : '—'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Avg Likes */}
                                            <div className="w-16">
                                                {isPending ? (
                                                    <div className="h-3 bg-gray-100 rounded animate-pulse w-8" />
                                                ) : (
                                                    <span className="text-[11px] text-gray-500">
                                                        {account.kpis?.likes ? formatNum(account.kpis.likes) : '—'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Avg Replies */}
                                            <div className="w-16">
                                                {isPending ? (
                                                    <div className="h-3 bg-gray-100 rounded animate-pulse w-8" />
                                                ) : (
                                                    <span className="text-[11px] text-gray-500">
                                                        {account.kpis?.replies ? formatNum(account.kpis.replies) : '—'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Likeliness + Actions */}
                                            <div className="flex-1 flex items-center justify-end gap-6 shrink-0">
                                                <div className="flex items-center gap-2" title={account.aiReasoning || ''}>
                                                    <span className="text-sm leading-none">{emojis}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <a href={account.url} target="_blank" rel="noreferrer" 
                                                       className="px-2 py-1 bg-gray-50 border border-gray-200 text-gray-400 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all">
                                                        ↗
                                                    </a>
                                                    {!isPending && (account.tracked ? (
                                                        <span className="px-2 py-1 bg-emerald-50 text-emerald-500 rounded-lg text-[9px] font-black uppercase tracking-widest">✓</span>
                                                    ) : (
                                                        <button onClick={() => handleTrack(account)} 
                                                            className="px-2 py-1 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all">
                                                            +
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )})}

                                    {/* Pagination Footer */}
                                    {totalPages > 1 && (
                                        <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-50 flex items-center justify-between">
                                            <div className="text-[11px] text-gray-400 font-medium">
                                                Showing {start + 1} to {Math.min(start + ITEMS_PER_PAGE, discoveredAccounts.length)} of {discoveredAccounts.length} accounts
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button 
                                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                                    disabled={currentPage === 1}
                                                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 text-gray-400 transition-colors"
                                                >
                                                    ←
                                                </button>
                                                {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                                                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                                    .map((p, i, arr) => (
                                                        <React.Fragment key={p}>
                                                            {i > 0 && arr[i-1] !== p - 1 && <span className="text-gray-300 px-1 text-[10px]">...</span>}
                                                            <button 
                                                                onClick={() => setCurrentPage(p)}
                                                                className={`w-8 h-8 rounded-xl text-[11px] font-black transition-all ${
                                                                    currentPage === p 
                                                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' 
                                                                    : 'bg-white text-gray-400 hover:bg-gray-100 border border-gray-200'
                                                                }`}
                                                            >
                                                                {p}
                                                            </button>
                                                        </React.Fragment>
                                                    ))}
                                                <button 
                                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                                    disabled={currentPage === totalPages}
                                                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 text-gray-400 transition-colors"
                                                >
                                                    →
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                                );
                            })()}
                        </div>
                    </div>
                    );
                })()}
            </div>

            {/* ── Active Tracking Sidebar ── */}
            <div className="xl:col-span-4">
                <div className="bg-white p-8 rounded-[3rem] border border-gray-100 shadow-sm space-y-8 sticky top-8">
                    {/* Stealth Pulse Header */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-display font-bold text-gray-900 flex items-center gap-3">
                                <ShieldCheck size={22} className="text-indigo-500" /> Surveillance
                            </h3>
                            <div className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${extensionConnected ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                                {extensionConnected ? 'Live' : 'Offline'}
                            </div>
                        </div>

                        {/* Pulse Meter */}
                        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                            <div className="flex items-center gap-3 mb-2">
                                <div className={`w-2 h-2 rounded-full ${extensionConnected ? 'bg-indigo-500 animate-ping' : 'bg-gray-300'}`} />
                                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Mission Pulse</span>
                            </div>
                            <p className="text-[11px] text-gray-500 font-medium truncate font-mono bg-white px-3 py-1.5 rounded-lg border border-gray-100 shadow-sm">
                                {pulseMessage || 'Engine Standby...'}
                            </p>
                        </div>
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                            <span className="block text-[10px] font-black uppercase tracking-widest text-indigo-400">Tracked</span>
                            <span className="text-2xl font-display font-bold text-indigo-600">{trackedAccounts.length}</span>
                        </div>
                        <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100/50">
                            <span className="block text-[10px] font-black uppercase tracking-widest text-emerald-400">Audited</span>
                            <span className="text-2xl font-display font-bold text-emerald-600">{discoveredAccounts.filter(a => a.aiValidated).length}</span>
                        </div>
                    </div>

                    {/* Manual Add Trigger */}
                    <div className="space-y-3">
                        {!showManualAdd ? (
                            <button 
                                onClick={() => setShowManualAdd(true)}
                                className="w-full py-3 bg-gray-50 border border-dashed border-gray-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 hover:border-gray-300 transition-all flex items-center justify-center gap-2"
                            >
                                <Plus size={12} /> Add Manual Vector
                            </button>
                        ) : (
                            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-3 animate-in slide-in-from-top-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Manual Entry</span>
                                    <button onClick={() => setShowManualAdd(false)} className="text-gray-400 hover:text-gray-600"><XIcon size={12} /></button>
                                </div>
                                <input 
                                    type="text" 
                                    placeholder="Paste URL (X, LinkedIn, Reddit)" 
                                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-100"
                                    value={newManualUrl}
                                    onChange={e => setNewManualUrl(e.target.value)}
                                />
                                <input 
                                    type="text" 
                                    placeholder="Alias (Optional)" 
                                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-100"
                                    value={newManualLabel}
                                    onChange={e => setNewManualLabel(e.target.value)}
                                />
                                <button 
                                    onClick={handleManualAdd}
                                    className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                                >
                                    Deploy Watcher
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Tracked Accounts List */}
                    <div className="space-y-4">
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Active Surveillance List</h4>
                                <div className="flex items-center gap-1.5 text-[9px] font-bold text-gray-400">
                                    <Zap size={10} className="text-indigo-400" /> High Depth
                                </div>
                            </div>
                            {/* Platform Filter Tabs */}
                            <div className="flex gap-1 p-1 bg-gray-50 rounded-xl border border-gray-100">
                                {['All', 'X', 'LinkedIn', 'Reddit'].map(p => (
                                    <button 
                                        key={p}
                                        onClick={() => setSidebarPlatformFilter(p as any)}
                                        className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${sidebarPlatformFilter === p ? 'bg-white shadow-sm text-indigo-600 border border-gray-100' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {trackedAccounts
                                .filter(a => sidebarPlatformFilter === 'All' || a.platform === sidebarPlatformFilter)
                                .map((account) => (
                                <div key={account.id} className="group relative flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50 transition-all overflow-hidden">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                            account.platform === 'X' ? 'bg-gray-900 text-white' : 'bg-blue-600 text-white'
                                        }`}>
                                            <PlatformIcon p={account.platform} size={12} />
                                        </div>
                                        <div className="min-w-0">
                                            <h5 className="text-xs font-bold text-gray-900 truncate">{account.label}</h5>
                                            <span className="text-[9px] text-gray-400 font-mono truncate block">@{account.handle}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className="flex flex-col items-end">
                                            <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">Watching</span>
                                            <span className="text-[8px] text-gray-300 font-medium">
                                                {account.lastChecked ? new Date(account.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Standby'}
                                            </span>
                                        </div>
                                        <button 
                                            onClick={() => handleUntrack(account.id)}
                                            className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                        >
                                            <XIcon size={14} />
                                        </button>
                                    </div>
                                    {/* Animated Live Indicator */}
                                    <div className="absolute left-0 bottom-0 h-0.5 bg-indigo-500/20 w-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 w-1/3 animate-shimmer" />
                                    </div>
                                </div>
                            ))}

                            {trackedAccounts.length === 0 && (
                                <div className="py-12 text-center border-2 border-dashed border-gray-100 rounded-[2.5rem] bg-gray-50/50">
                                    <Radar size={32} className="mx-auto mb-4 text-gray-300" />
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">No active watchers</p>
                                    <p className="text-[9px] text-gray-300 mt-1">Discover leads to start tracking.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <p className="text-[10px] text-gray-400 leading-relaxed pt-4 border-t border-gray-50 italic">
                        Surveillance missions run in the background every 5-10 minutes.
                    </p>
                </div>
            </div>
        </div>
    </div>
  );
};
