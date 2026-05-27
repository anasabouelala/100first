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
                        <p className="text-sm font-bold">Post moved to pipeline</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Ready to engage</p>
                    </div>
                </div>
            )}
            
            {/* ── Header ── compact, matches app palette ──────────── */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                    {/* Radar icon with concentric pulse — real sweep, not just animate-pulse */}
                    <div className="relative w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center shadow-sm">
                        <Radar size={22} className="text-indigo-400" />
                        <span className="absolute inset-0 rounded-2xl ring-2 ring-indigo-400/50 animate-ping pointer-events-none"></span>
                    </div>
                    <div>
                        <h2 className="text-2xl md:text-3xl font-display font-bold text-gray-900 tracking-tight">
                            Inbound <span className="text-indigo-600">Radar</span>
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">New posts from accounts you track — surfaced the moment they go up.</p>
                    </div>
                </div>

                {/* Status pill — tone-of-voice matches the rest of the app */}
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${
                    extensionConnected
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                    {extensionConnected
                        ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        : <AlertCircle size={12} />
                    }
                    {extensionConnected ? 'Extension connected' : 'Waiting for extension'}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* ── Sidebar: Tracked Creators (rounded-2xl, matches app) ── */}
                <div className="lg:col-span-3 space-y-4">
                    <div className="bg-white rounded-2xl border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 flex items-center gap-2">
                                <Users size={14} className="text-indigo-600" />
                                Tracked creators
                            </h3>
                            <span className="text-[10px] font-bold text-gray-400">{creators.length}</span>
                        </div>

                        <div className="space-y-1 max-h-[560px] overflow-y-auto pr-1 custom-scrollbar">
                            <button
                                onClick={() => setSelectedCreator(null)}
                                className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between ${
                                    selectedCreator === null
                                    ? 'bg-gray-900 text-white'
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                            >
                                <span className="text-sm font-bold">All posts</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${selectedCreator === null ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                    {history.length}
                                </span>
                            </button>

                            {creators.length > 0 && <div className="h-px bg-gray-100 my-2"></div>}

                            {creators.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => setSelectedCreator(c.label)}
                                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between gap-2 ${
                                        selectedCreator === c.label
                                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                        : 'hover:bg-gray-50 text-gray-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0 ${
                                            selectedCreator === c.label ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
                                        }`}>
                                            {c.label.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold truncate">{c.label}</div>
                                            <div className="text-[9px] uppercase font-bold tracking-widest opacity-60">{c.platform}</div>
                                        </div>
                                    </div>
                                    <ChevronRight size={12} className={`flex-shrink-0 transition-opacity ${selectedCreator === c.label ? 'opacity-100' : 'opacity-0'}`} />
                                </button>
                            ))}

                            {creators.length === 0 && (
                                <div className="text-center py-6 text-xs text-gray-400">
                                    No tracked creators yet.<br />Track accounts from the <span className="font-bold text-gray-600">Account Finder</span>.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Compact tip card — replaces the heavy gradient block */}
                    <div className="bg-indigo-50/50 border border-indigo-100 p-5 rounded-2xl">
                        <div className="flex items-start gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
                                <TrendingUp size={14} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-gray-900">How the radar works</h4>
                                <p className="text-xs text-gray-600 leading-relaxed mt-1">
                                    Posts from your tracked creators land here in real time. Hit <b>Draft reply</b> for a voice-matched response, or <b>Track post</b> to move it into your pipeline.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Main Feed: Pulse Timeline ── */}
                <div className="lg:col-span-9 space-y-4">
                    {filteredHistory.length === 0 ? (
                        // Modernized empty state — softer, with a real CTA hint
                        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-16 text-center">
                            <div className="relative w-20 h-20 mx-auto mb-5">
                                <div className="absolute inset-0 rounded-full bg-indigo-50"></div>
                                <div className="absolute inset-3 rounded-full bg-indigo-100"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Radar size={32} className="text-indigo-600" />
                                </div>
                                <span className="absolute inset-0 rounded-full ring-2 ring-indigo-300/60 animate-ping pointer-events-none"></span>
                            </div>
                            <h4 className="text-base font-bold text-gray-900">No new posts yet</h4>
                            <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto leading-relaxed">
                                {selectedCreator
                                    ? `Still watching ${selectedCreator}. We'll surface their next post the moment it goes up.`
                                    : creators.length === 0
                                        ? 'Track some accounts first, then their new posts will land here.'
                                        : 'Watching your tracked accounts. New posts land here in real time.'}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {filteredHistory.map((item, idx) => {
                                const isTracked = isSignalTracked(item.url);
                                return (
                                    // Cleaner card: rounded-2xl matches AccountCard.
                                    // Hierarchy: identity → post content (primary) → actions (bottom).
                                    // Removed fake "Signal Strength: High" / "Context: Growth" placeholders.
                                    <div key={idx} className={`bg-white rounded-2xl border ${isTracked ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'} hover:border-gray-300 hover:shadow-md transition-all overflow-hidden`}>
                                        <div className="flex">
                                            {/* Platform stripe — thin, not a full sidebar */}
                                            <div className={`w-1.5 flex-shrink-0 ${
                                                item.platform?.toLowerCase().includes('linkedin') ? 'bg-blue-600' :
                                                item.platform?.toLowerCase().includes('reddit')   ? 'bg-orange-500' :
                                                'bg-gray-900'
                                            }`}></div>

                                            <div className="flex-1 p-5">
                                                {/* IDENTITY ROW */}
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                                            item.platform?.toLowerCase().includes('linkedin') ? 'bg-blue-600' :
                                                            item.platform?.toLowerCase().includes('reddit')   ? 'bg-orange-500' :
                                                            'bg-gray-900'
                                                        }`}>
                                                            {getPlatformIcon(item.platform)}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <h3 className="text-sm font-bold text-gray-900 truncate">@{item.creator}</h3>
                                                                <span className="text-[9px] uppercase font-bold tracking-widest text-gray-500 flex-shrink-0">{item.platform}</span>
                                                            </div>
                                                            <p className="text-[11px] text-gray-400">
                                                                <Clock size={9} className="inline -mt-0.5 mr-0.5" />
                                                                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(item.timestamp).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <a
                                                        href={item.postUrl || item.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors flex-shrink-0"
                                                        title="Open original post"
                                                    >
                                                        <ArrowUpRight size={16} />
                                                    </a>
                                                </div>

                                                {/* POST CONTENT — the most important thing on the card */}
                                                <div className="mb-4">
                                                    {item.platform === 'Reddit' && item.body ? (
                                                        <div className="space-y-2">
                                                            <p className="text-sm font-bold text-gray-900 leading-relaxed">{item.text}</p>
                                                            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-4">
                                                                {item.body}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <p className="text-sm text-gray-800 leading-relaxed line-clamp-4">
                                                            {item.text}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* ACTIONS — equal-weight buttons, primary first */}
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => onRespond(item)}
                                                        className="flex-1 h-9 px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                                                    >
                                                        <Zap size={13} /> Draft reply
                                                    </button>
                                                    {isTracked ? (
                                                        <div className="flex-1 h-9 px-3 bg-emerald-50 text-emerald-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border border-emerald-200">
                                                            <CheckCircle2 size={13} /> In pipeline
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleTrackInPipeline(item)}
                                                            className="flex-1 h-9 px-3 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                                                        >
                                                            <Target size={13} /> Track post
                                                        </button>
                                                    )}
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
