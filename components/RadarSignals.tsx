import React, { useState, useEffect } from 'react';
import { 
    Radar, Clock, Sparkles, Zap, ShieldCheck
} from 'lucide-react';

export const RadarSignals: React.FC = () => {
  const [radarHistory, setRadarHistory] = useState<any[]>([]);
  const [extensionConnected, setExtensionConnected] = useState(false);

  useEffect(() => {
    const sync = () => {
        try {
            const histRaw = localStorage.getItem('social_radar_history');
            const hist = histRaw ? JSON.parse(histRaw) : [];
            const influencerSignals = hist.filter((item: any) => {
                const isRecon = item.isRecon || item.campaignId;
                return !isRecon;
            });
            setRadarHistory(influencerSignals);
            window.dispatchEvent(new CustomEvent('answerly_ping'));
        } catch(e) { }
    };
    
    const handlePong = () => setExtensionConnected(true);
    const handleHistory = (e: any) => {
        const hist = e.detail || [];
        const influencerSignals = hist.filter((item: any) => {
            const isRecon = item.isRecon || item.campaignId;
            return !isRecon;
        });
        setRadarHistory(prev => {
            const combined = [...influencerSignals, ...prev];
            const unique = new Map();
            combined.forEach(i => unique.set(i.uuid || i.url, i));
            return Array.from(unique.values()).sort((a: any, b: any) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            ).slice(0, 100);
        });
        setExtensionConnected(true);
    };

    window.addEventListener('answerly_pong', handlePong);
    window.addEventListener('answerly_history_update', handleHistory);
    sync();
    const interval = setInterval(sync, 15000);
    return () => {
        window.removeEventListener('answerly_pong', handlePong);
        window.removeEventListener('answerly_history_update', handleHistory);
        clearInterval(interval);
    };
  }, []);

  const getPlatformIcon = (platformInput: any = 'X') => {
    const platform = String(platformInput || 'X').toLowerCase();
    if (platform.includes('twitter') || platform.includes('x')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-gray-900">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
    );
    if (platform.includes('linkedin')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-blue-500">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
    );
    return <Radar size={20} className="text-gray-400" />;
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-12 animate-fade-in pb-20">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-amber-500 rounded-[2.5rem] flex items-center justify-center shadow-lg shadow-amber-200">
                    <Radar size={32} className="text-white" />
                </div>
                <div>
                    <h2 className="text-4xl font-display font-bold text-gray-900">Radar <span className="text-amber-500">Signals</span></h2>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-gray-400 mt-1">Real-time influencer activity</p>
                </div>
            </div>
            {!extensionConnected ? (
                <div className="px-4 py-2 bg-rose-50 text-rose-500 rounded-xl text-[10px] font-black uppercase tracking-widest border border-rose-100 animate-pulse flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                    Offline
                </div>
            ) : (
                <div className="px-4 py-2 bg-emerald-50 text-emerald-500 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    Tracking Active
                </div>
            )}
        </div>

        <div className="grid grid-cols-1 gap-6">
            {radarHistory.length === 0 ? (
                <div className="py-32 text-center bg-gray-50 rounded-[3rem] border border-dashed border-gray-200">
                    <Radar size={48} className="mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-bold text-gray-400 uppercase tracking-widest">Radar Quiet</h3>
                    <p className="text-sm text-gray-400 mt-2">No followed signals detected. Add accounts in Radar Setup.</p>
                </div>
            ) : (
                radarHistory.map((item: any) => (
                    <div key={item.uuid || item.url} className="group flex items-start gap-8 p-8 rounded-[3rem] border bg-white border-gray-100 hover:border-amber-300 transition-all shadow-sm">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center border bg-gray-50 border-gray-100 text-gray-400">
                            {getPlatformIcon(item.platform)}
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3">
                                <span className="text-lg font-bold text-gray-900">@{item.creator}</span>
                                <span className="text-[11px] text-gray-400 font-mono flex items-center gap-1.5 ml-auto">
                                    <Clock size={12} />
                                    {item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                                </span>
                            </div>
                            <p className="text-base text-gray-600 leading-relaxed mb-6 italic">"{item.text || item.body}"</p>

                            {/* Feed Watcher queued a value-adding reply in the user's
                                voice. Queue-only — nothing is posted until the user
                                copies/sends it from the post. */}
                            {item.engagementStatus === 'queued' && item.suggestedComment && (
                                <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">✍️ Drafted reply — awaiting your approval</span>
                                    </div>
                                    <p className="text-sm text-gray-800 leading-relaxed">{item.suggestedComment}</p>
                                    <button
                                        onClick={() => { try { navigator.clipboard.writeText(item.suggestedComment); } catch {} }}
                                        className="mt-3 text-[11px] font-bold text-emerald-700 hover:underline"
                                    >
                                        Copy reply
                                    </button>
                                </div>
                            )}
                            {item.engagementStatus === 'queued' && item.suggestedAction === 'repost' && (
                                <div className="mb-6 p-4 rounded-2xl bg-violet-50 border border-violet-100">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-violet-600">♻️ Suggested: repost to your audience</span>
                                    {item.engagementRationale && <p className="text-sm text-gray-700 mt-1.5">{item.engagementRationale}</p>}
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <a href={item.postUrl || item.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-8 py-3 bg-gray-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-amber-500 transition-all shadow-lg shadow-gray-900/10">
                                    <Sparkles size={16} className="text-amber-400" /> View & Engage
                                </a>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    </div>
  );
};
