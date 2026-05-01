import React, { useState, useEffect } from 'react';
import { Search, Trash2, Globe, Twitter, Linkedin, MessageCircle, AlertCircle, CheckCircle2, ShieldCheck, Zap, Radar, Plus } from 'lucide-react';

interface AnswerlyConfig {
    id: string;
    platform: 'X' | 'LinkedIn' | 'Reddit';
    url: string;
    label: string;
    lastChecked?: string;
}

export const AnswerlyView: React.FC = () => {
    const [configs, setConfigs] = useState<AnswerlyConfig[]>([]);
    const [newUrl, setNewUrl] = useState('');
    const [newLabel, setNewLabel] = useState('');
    const [extensionConnected, setExtensionConnected] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'info' | 'error', msg: string } | null>(null);

    useEffect(() => {
        const saved = localStorage.getItem('answerly_creator_configs');
        if (saved) {
            try { setConfigs(JSON.parse(saved)); } catch (e) { console.error("Failed to parse Answerly configs"); }
        }

        const handlePong = () => setExtensionConnected(true);
        window.addEventListener('answerly_pong', handlePong);
        const sync = () => window.dispatchEvent(new CustomEvent('answerly_ping'));
        const interval = setInterval(sync, 10000);
        sync();

        return () => {
            window.removeEventListener('answerly_pong', handlePong);
            clearInterval(interval);
        };
    }, []);

    const saveToStorage = (updated: AnswerlyConfig[]) => {
        localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
    };

    const handleAdd = () => {
        if (!newUrl) return;
        
        let platform: 'X' | 'LinkedIn' | 'Reddit' = 'X';
        if (newUrl.includes('x.com') || newUrl.includes('twitter.com')) platform = 'X';
        else if (newUrl.includes('linkedin.com')) platform = 'LinkedIn';
        else if (newUrl.includes('reddit.com')) platform = 'Reddit';

        const newItem: AnswerlyConfig = {
            id: 'ans_' + Date.now(),
            platform,
            url: newUrl,
            label: newLabel || newUrl.split('/').pop() || 'Unnamed',
        };

        const updated = [...configs, newItem];
        setConfigs(updated);
        saveToStorage(updated);
        setNewUrl('');
        setNewLabel('');
        setStatus({ type: 'success', msg: `Deployed watcher for ${newItem.label}` });
        setTimeout(() => setStatus(null), 3000);
    };

    const handleRemove = (id: string) => {
        const updated = configs.filter(c => c.id !== id);
        setConfigs(updated);
        saveToStorage(updated);
    };

    const getPlatformIcon = (platform: string) => {
        switch (platform) {
            case 'X': return <Twitter size={18} />;
            case 'LinkedIn': return <Linkedin size={18} />;
            case 'Reddit': return <MessageCircle size={18} />;
            default: return <Globe size={18} />;
        }
    };

    return (
        <div className="space-y-8 animate-fade-in-up pb-10">
            {/* Header section */}
            <div className="flex flex-col md:flex-row justify-between items-start gap-6 border-b border-white/5 pb-8">
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                        <ShieldCheck className="text-blue-500" size={24} /> Stealth Engine
                    </h2>
                    <p className="text-sm text-gray-500 max-w-xl font-medium leading-relaxed">
                        Answerly monitors these vectors stealthily using your active session. 
                        New signals will manifest in your <span className="text-blue-400">Public Radar</span> automatically.
                    </p>
                </div>
                
                <div className={`flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all ${
                    extensionConnected ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-gray-800/50 border-white/5'
                }`}>
                    <div className={`w-2 h-2 rounded-full ${extensionConnected ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-600'}`}></div>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${extensionConnected ? 'text-emerald-400' : 'text-gray-500'}`}>
                        {extensionConnected ? 'Engine Active' : 'Extension Offline'}
                    </span>
                </div>
            </div>

            {/* Quick Add Section */}
            <div className="glass-morphism p-8 rounded-[2.5rem] shadow-obsidian border-white/5 group transition-all">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                        <input 
                            type="text" 
                            placeholder="Paste Profile or Subreddit URL..." 
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-white text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-gray-600 font-medium"
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                        />
                    </div>
                    <div className="md:w-48">
                        <input 
                            type="text" 
                            placeholder="Alias (Optional)" 
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-gray-600 font-medium"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                        />
                    </div>
                    <button 
                        onClick={handleAdd}
                        disabled={!newUrl}
                        className="px-8 py-4 bg-white text-black rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:grayscale flex items-center gap-2"
                    >
                        <Plus size={14} strokeWidth={3} /> Deploy Watcher
                    </button>
                </div>
                
                {status && (
                    <div className={`mt-6 flex items-center gap-3 px-5 py-3 rounded-xl text-xs font-bold animate-slide-up ${
                        status.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' : 
                        status.type === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/10' : 
                        'bg-blue-500/10 text-blue-400 border border-blue-500/10'
                    }`}>
                        {status.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                        {status.msg}
                    </div>
                )}
            </div>

            {/* Configs Grid */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-600">Active Surveillance Queue ({configs.length})</h3>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        <Radar size={12} className="text-blue-500" /> Rotating Polling (5m)
                    </div>
                </div>
                
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {configs.map((config) => (
                        <div key={config.id} className="glass-morphism p-5 rounded-[2rem] shadow-obsidian border-white/5 hover:border-white/10 transition-all group relative overflow-hidden">
                            <div className="flex items-start justify-between mb-4">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                    config.platform === 'X' ? 'bg-white text-black' :
                                    config.platform === 'LinkedIn' ? 'bg-blue-600 text-white' :
                                    'bg-orange-600 text-white'
                                }`}>
                                    {getPlatformIcon(config.platform)}
                                </div>
                                <button 
                                    onClick={() => handleRemove(config.id)}
                                    className="p-2 text-gray-600 hover:text-rose-500 transition-colors bg-white/5 rounded-xl"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            
                            <div className="space-y-1">
                                <h4 className="text-sm font-bold text-white truncate">{config.label}</h4>
                                <p className="text-[10px] font-mono text-gray-500 truncate opacity-60">{config.url}</p>
                            </div>

                            <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <Clock size={10} className="text-gray-600" />
                                    <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">
                                        {config.lastChecked ? new Date(config.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Standby'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 text-[9px] font-black text-blue-400 uppercase tracking-tighter bg-blue-500/10 px-2 py-0.5 rounded-md">
                                    <Zap size={10} /> Stealth
                                </div>
                            </div>
                        </div>
                    ))}

                    {configs.length === 0 && (
                        <div className="md:col-span-2 lg:col-span-3 py-20 text-center border-2 border-dashed border-white/5 rounded-[3rem] bg-white/2">
                            <Radar size={40} className="mx-auto mb-4 text-gray-800" />
                            <p className="text-sm text-gray-600 font-bold uppercase tracking-widest">No active watchers deployed.</p>
                            <p className="text-[10px] text-gray-700 mt-2">Paste a URL above to start monitoring influencers.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Clock = ({ size, className }: any) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
);
