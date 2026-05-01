import React, { useState, useEffect, useMemo } from 'react';
import { 
    Radar, 
    Zap, 
    ExternalLink, 
    ShieldCheck, 
    CheckCircle2, 
    AlertCircle, 
    MessageSquarePlus, 
    Users, 
    ChevronRight, 
    Activity, 
    Filter, 
    ArrowUpRight,
    TrendingUp,
    Clock,
    Target
} from 'lucide-react';

interface AnswerlyRadarViewProps {
    onRespond: (item: any) => void;
}

export const AnswerlyRadarView: React.FC<AnswerlyRadarViewProps> = ({ onRespond }) => {
    const [history, setHistory] = useState<any[]>([]);
    const [creators, setCreators] = useState<any[]>([]);
    const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
    const [extensionConnected, setExtensionConnected] = useState(false);
    const [trackedSignalUrls, setTrackedSignalUrls] = useState<Set<string>>(new Set());
    const [showToast, setShowToast] = useState(false);

    useEffect(() => {
        let answerlyExtHistory: any[] = [];

        const loadLocalData = () => {
            try {
                const histRaw = localStorage.getItem('social_radar_history');
                const creatorRaw = localStorage.getItem('answerly_creator_configs');
                const pipelineRaw = localStorage.getItem('pipeline_leads_unified');
                
                const hist = histRaw ? JSON.parse(histRaw) : [];
                const cr = creatorRaw ? JSON.parse(creatorRaw) : [];
                const pl = pipelineRaw ? JSON.parse(pipelineRaw) : [];
                
                setCreators(cr);
                setTrackedSignalUrls(new Set(pl.map((l: any) => l.url)));
                return hist;
            } catch(e) {
                return [];
            }
        };

        const updateCombinedHistory = () => {
            const localHist = loadLocalData();
            const combined = [...localHist, ...answerlyExtHistory];
            
            // Deduplicate
            const uniqueMap = new Map();
            combined.forEach(item => {
                uniqueMap.set(item.uuid || item.url, item);
            });
            
            const sorted = Array.from(uniqueMap.values()).sort((a: any, b: any) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            
            setHistory(sorted.slice(0, 100));
            if (localHist.length > 0) setExtensionConnected(true);
        };

        const handlePong = () => setExtensionConnected(true);
        const handleHistory = (e: any) => {
            answerlyExtHistory = e.detail || [];
            updateCombinedHistory();
        };

        const handleStorage = () => {
            updateCombinedHistory();
        };

        window.addEventListener('answerly_pong', handlePong);
        window.addEventListener('answerly_history_update', handleHistory);
        window.addEventListener('storage', handleStorage);
        
        updateCombinedHistory();
        
        const sync = () => {
            window.dispatchEvent(new CustomEvent('answerly_ping'));
            window.dispatchEvent(new CustomEvent('answerly_request_history'));
        };
        
        const interval = setInterval(sync, 10000);
        sync();

        return () => {
            window.removeEventListener('answerly_pong', handlePong);
            window.removeEventListener('answerly_history_update', handleHistory);
            window.removeEventListener('storage', handleStorage);
            clearInterval(interval);
        };
    }, []);

    const filteredHistory = useMemo(() => {
        if (!selectedCreator) return history;
        return history.filter(item => item.creator === selectedCreator);
    }, [history, selectedCreator]);

    const isSignalTracked = (url: string) => trackedSignalUrls.has(url);

    const getPlatformIcon = (platform: string) => {
        const lower = platform.toLowerCase();
        if (lower.includes('twitter') || lower.includes('x')) return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
        );
        if (lower.includes('linkedin')) return (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-blue-400">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
        );
        if (lower.includes('reddit')) return (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-orange-400">
                <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.05l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.057 1.597.047.222.069.447.069.675 0 2.212-2.39 4.012-5.338 4.012s-5.338-1.8-5.338-4.012c0-.218.021-.432.065-.644a1.745 1.745 0 0 1-1.025-1.586c0-.968.786-1.754 1.754-1.754.463 0 .875.18 1.179.473 1.17-.834 2.8-1.393 4.602-1.474l.522-2.462 3.03.64zm-7.422 7.871c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.281-.574 1.281-1.282 0-.708-.573-1.282-1.281-1.282zm4.825 0c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.282-.574 1.282-1.282 0-.708-.574-1.282-1.282-1.282zm-2.377 3.724c-.232 0-.46.015-.685.042-.254.031-.498.08-.733.146-.147.042-.273.106-.381.187a.327.327 0 0 0-.099.448.327.327 0 0 0 .448.099c.071-.054.17-.102.289-.138.169-.047.346-.083.53-.105.19-.023.389-.035.592-.035.204 0 .403.012.593.035.184.022.361.058.53.105.119.036.218.084.289.138a.327.327 0 0 0 .448-.099.327.327 0 0 0-.099-.448c-.108-.081-.234-.145-.381-.187a3.984 3.984 0 0 0-.733-.146c-.225-.027-.453-.042-.685-.042z"/>
            </svg>
        );
        return <ShieldCheck size={16} className="text-orange-500" />;
    };


    const handleTrackInPipeline = (item: any) => {
        const existing: any[] = JSON.parse(localStorage.getItem('pipeline_leads_unified') || '[]');
        if (existing.find(l => l.url === item.url)) return;

        const newLead = {
            url: item.url,
            postUrl: item.postUrl || item.url,
            name: item.creator || item.name || item.title || item.url.split('/').pop(),
            why: item.why || item.reason || "Detected via Inbound Radar",
            postText: item.text || item.body,
            relevance: 85,
            scannedAt: new Date().toISOString(),
            timestamp: item.timestamp || new Date().toISOString(),
            status: 'new',
            interactions: [],
            tags: [item.platform, 'Radar']
        };

        const updated = [newLead, ...existing];
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
        setTrackedSignalUrls(new Set(updated.map(l => l.url)));
        
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
        
        // Visual feedback
        window.dispatchEvent(new CustomEvent('pipeline_leads_update', { detail: updated }));
    };

    return (
        <div className="max-w-[1600px] mx-auto animate-fade-in pb-20 relative">
            {showToast && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 animate-slide-up border border-white/10 backdrop-blur-md">
                    <div className="bg-emerald-500 p-2 rounded-full">
                        <CheckCircle2 size={16} />
                    </div>
                    <div>
                        <p className="text-sm font-bold">Signal tracked successfully!</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Moved to Conversion Pipeline</p>
                    </div>
                </div>
            )}
            
            {/* ── Header Area ── */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12 border-b border-gray-100 pb-8">
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Radar size={28} className="text-blue-400 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">
                                Inbound <span className="text-blue-600">Radar</span>
                            </h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Live Pulse Monitor</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-8 bg-white px-6 py-3 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="text-right border-r border-gray-100 pr-8">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">Capture Rate</span>
                            <span className="text-sm font-bold text-gray-900">High Velocity</span>
                        </div>
                        <div className={`flex items-center gap-2 transition-all ${
                            extensionConnected ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                            {extensionConnected ? <Activity size={16} /> : <AlertCircle size={16} />}
                            <span className="text-xs font-black uppercase tracking-widest">
                                {extensionConnected ? 'Sync Active' : 'Waiting...'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* ── Sidebar: Tracked Influencers ── */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="bg-white rounded-[2.5rem] border border-gray-100 p-6 shadow-minimal overflow-hidden relative">
                        <div className="flex items-center justify-between mb-6 px-2">
                            <h3 className="font-bold text-gray-900 flex items-center gap-2">
                                <Users size={18} className="text-blue-600" />
                                Tracked Creators
                            </h3>
                            <Filter size={14} className="text-gray-300" />
                        </div>

                        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                            <button 
                                onClick={() => setSelectedCreator(null)}
                                className={`w-full text-left px-4 py-3 rounded-2xl transition-all flex items-center justify-between group ${
                                    selectedCreator === null 
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                                    : 'hover:bg-gray-50 text-gray-600'
                                }`}
                            >
                                <span className="text-sm font-bold">All Signal Sources</span>
                                <span className={`text-[10px] font-black ${selectedCreator === null ? 'text-white/70' : 'text-gray-300'}`}>
                                    {history.length}
                                </span>
                            </button>

                            <div className="h-px bg-gray-50 my-4"></div>

                            {creators.map((c) => (
                                <button 
                                    key={c.id}
                                    onClick={() => setSelectedCreator(c.label)}
                                    className={`w-full text-left px-4 py-3 rounded-2xl transition-all flex items-center justify-between group ${
                                        selectedCreator === c.label 
                                        ? 'bg-gray-900 text-white shadow-xl' 
                                        : 'hover:bg-gray-50 text-gray-600'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black ${
                                            selectedCreator === c.label ? 'bg-white/10' : 'bg-gray-100'
                                        }`}>
                                            {c.label.charAt(0)}
                                        </div>
                                        <div>
                                            <span className="text-sm font-bold block leading-none">{c.label}</span>
                                            <span className={`text-[9px] uppercase font-black tracking-widest mt-1 block opacity-50`}>{c.platform}</span>
                                        </div>
                                    </div>
                                    <ChevronRight size={14} className={`transition-transform ${selectedCreator === c.label ? 'translate-x-1' : 'opacity-0'}`} />
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
                        <TrendingUp size={120} className="absolute -bottom-8 -right-8 opacity-10 group-hover:scale-110 transition-transform" />
                        <h4 className="text-lg font-bold mb-2 relative z-10">Capture Strategy</h4>
                        <p className="text-xs text-blue-100 leading-relaxed relative z-10">
                            Radar detects influencers' latest posts. Move high-relevance signals to your pipeline to start engaging.
                        </p>
                    </div>
                </div>

                {/* ── Main Feed: Pulse Timeline ── */}
                <div className="lg:col-span-9 space-y-6">
                    {filteredHistory.length === 0 ? (
                        <div className="bg-white rounded-[3rem] border border-gray-100 p-24 text-center space-y-6">
                            <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto text-gray-200 border border-gray-100">
                                <Radar size={40} />
                            </div>
                            <div>
                                <h4 className="text-xl font-bold text-gray-900">No signals detected yet</h4>
                                <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
                                    {selectedCreator 
                                        ? `Still scanning for recent activity from ${selectedCreator}.` 
                                        : "Your stealth engine is monitoring sources in the background. Fresh posts will appear here."}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            {filteredHistory.map((item, idx) => {
                                const isTracked = isSignalTracked(item.url);
                                return (
                                    <div key={idx} className="bg-white rounded-[2.5rem] border border-gray-100 shadow-minimal hover:shadow-md transition-all group overflow-hidden flex flex-col md:flex-row">
                                        {/* Post Sidebar/Platform */}
                                        <div className="w-full md:w-20 bg-gray-900 flex flex-row md:flex-col items-center justify-center gap-4 py-4 md:py-8 border-r border-gray-100 shrink-0">
                                            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                                                {getPlatformIcon(item.platform)}
                                            </div>
                                            <div className="h-px w-8 bg-white/10 hidden md:block"></div>
                                            <Clock size={16} className="text-gray-500" />
                                        </div>

                                        {/* Post Content */}
                                        <div className="flex-1 p-8">
                                            <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <h3 className="text-lg font-bold text-gray-900">@{item.creator}</h3>
                                                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">
                                                            {item.platform}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-gray-400 font-medium flex items-center gap-1">
                                                        Captured {new Date(item.timestamp).toLocaleTimeString()} • {new Date(item.timestamp).toLocaleDateString()}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button 
                                                        onClick={() => onRespond(item)}
                                                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-95"
                                                    >
                                                        <Zap size={14} fill="currentColor" /> Draft Reply
                                                    </button>
                                                    
                                                    {isTracked ? (
                                                        <div className="flex items-center gap-2 px-5 py-2.5 bg-emerald-50 text-emerald-600 rounded-xl font-bold text-xs border border-emerald-100">
                                                            <CheckCircle2 size={14} /> Tracked
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            onClick={() => handleTrackInPipeline(item)}
                                                            className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 text-gray-900 rounded-xl font-bold text-xs border border-gray-100 hover:bg-gray-100 transition-all active:scale-95"
                                                        >
                                                            <Target size={14} /> Track Signal
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="relative">
                                                <div className="p-6 bg-gray-50/50 rounded-3xl border border-gray-100/50">
                                                    {item.platform === 'Reddit' && item.body ? (
                                                        <div className="space-y-3">
                                                            <p className="text-sm font-bold text-gray-900 leading-relaxed">{item.text}</p>
                                                            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                                                                {item.body}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <p className="text-sm text-gray-800 leading-relaxed font-medium">
                                                            {item.text}
                                                        </p>
                                                    )}
                                                </div>
                                                
                                                <a 
                                                    href={item.postUrl || item.url} 
                                                    target="_blank" 
                                                    rel="noreferrer" 
                                                    className="absolute -top-3 -right-3 p-3 bg-white rounded-2xl shadow-xl border border-gray-100 text-blue-600 hover:scale-110 transition-all"
                                                    title="View Original Post"
                                                >
                                                    <ArrowUpRight size={18} />
                                                </a>
                                            </div>

                                            <div className="mt-6 flex items-center gap-6">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Signal Strength: High</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Context: Growth</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
