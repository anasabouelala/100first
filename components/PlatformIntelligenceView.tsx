import React, { useState, useEffect } from 'react';
import { getPlatformInsights } from '../services/geminiService';
import { PlatformInsights } from '../types';
import { 
    BarChart3, Clock, Zap, Target, ArrowRight, Loader2, 
    MessageSquare, Hash, Share2, MousePointer2, 
    Calendar, TrendingUp, Shield, ExternalLink, 
    Copy, Check, Sparkles, Flame, Info
} from 'lucide-react';

interface PlatformIntelligenceViewProps {
    appDesc: string;
    niche: string;
}

const platforms = [
    { id: 'Reddit', label: 'Reddit', icon: <Hash size={20} />, color: 'bg-orange-500', nicheSuffix: 'Subreddits' },
    { id: 'Twitter', label: 'X (Twitter)', icon: <Share2 size={20} />, color: 'bg-black', nicheSuffix: 'Topics' },
    { id: 'LinkedIn', label: 'LinkedIn', icon: <Target size={20} />, color: 'bg-blue-600', nicheSuffix: 'Industries' },
    { id: 'Product Hunt', label: 'Product Hunt', icon: <Flame size={20} />, color: 'bg-red-500', nicheSuffix: 'Categories' }
];

export const PlatformIntelligenceView: React.FC<PlatformIntelligenceViewProps> = ({ appDesc, niche }) => {
    const [selectedPlatform, setSelectedPlatform] = useState(platforms[0]);
    const [loading, setLoading] = useState(false);
    const [insights, setInsights] = useState<PlatformInsights | null>(null);
    const [copiedHook, setCopiedHook] = useState<number | null>(null);

    const handleGenerate = async () => {
        setLoading(true);
        try {
            const data = await getPlatformInsights(selectedPlatform.id, niche, appDesc);
            setInsights(data);
        } catch (error) {
            console.error(error);
            alert("Failed to fetch platform insights. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleCopyHook = (hook: string, index: number) => {
        navigator.clipboard.writeText(hook);
        setCopiedHook(index);
        setTimeout(() => setCopiedHook(null), 2000);
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-24">
            {/* Header */}
            <div className="border-b border-gray-100 pb-8">
                <h2 className="text-4xl font-display font-medium text-brand-primary tracking-tight flex items-center gap-3">
                    <Sparkles size={32} className="text-secondary" />
                    Viral Content <span className="text-secondary">Lab</span>
                </h2>
                <p className="text-brand-secondary mt-1 text-base">Deconstructing platform algorithms and niche timing for maximum reach.</p>
            </div>

            {/* Platform & Niche Selection */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-minimal">
                        <h3 className="font-bold text-xl text-brand-primary mb-6">Select Platform</h3>
                        <div className="grid grid-cols-1 gap-3">
                            {platforms.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => setSelectedPlatform(p)}
                                    className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-200 ${selectedPlatform.id === p.id ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-200'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`${p.color} text-white p-2 rounded-xl`}>{p.icon}</div>
                                        <span className="font-bold text-sm text-brand-primary">{p.label}</span>
                                    </div>
                                    {selectedPlatform.id === p.id && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                                </button>
                            ))}
                        </div>

                        <div className="mt-8 pt-8 border-t border-gray-100">
                            <div className="flex items-center gap-2 mb-4 text-xs font-black uppercase tracking-widest text-gray-400">
                                <Target size={12} /> Target Niche
                            </div>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 font-bold text-brand-primary text-sm">
                                {niche || 'Indie Hackers'}
                            </div>
                        </div>

                        <button
                            onClick={handleGenerate}
                            disabled={loading || !appDesc}
                            className="w-full mt-8 flex items-center justify-center gap-2 px-8 py-4 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 rounded-2xl font-bold text-sm shadow-md transition-all whitespace-nowrap"
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
                            {loading ? 'Analyzing niche...' : 'Run Content Audit'}
                        </button>
                    </div>

                    <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-6">
                        <div className="flex gap-3">
                            <div className="p-2 bg-white rounded-xl text-indigo-600 shadow-sm shrink-0 h-fit">
                                <Info size={20} />
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-bold text-sm text-indigo-900 leading-tight">AI Strategy Note</h4>
                                <p className="text-xs text-indigo-700 leading-relaxed">
                                    We use the Gemini search engine to pull real-time engagement data for 2024/2025. This ensures your timing and hook strategy is always fresh.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Insights Display */}
                <div className="lg:col-span-2">
                    {loading ? (
                        <div className="h-full min-h-[600px] flex flex-col items-center justify-center space-y-6 bg-white rounded-3xl border border-gray-100 shadow-minimal p-12 text-center">
                            <div className="relative">
                                <div className="w-20 h-20 border-4 border-gray-100 border-t-gray-900 rounded-full animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Sparkles className="text-gray-900 animate-pulse" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-display font-medium text-brand-primary tracking-tight">Scouring {selectedPlatform.id} for Trends</h3>
                                <p className="text-brand-secondary text-sm max-w-xs mx-auto">Analyzing recent viral posts, engagement patterns, and niche-specific algorithms...</p>
                            </div>
                        </div>
                    ) : insights ? (
                        <div className="space-y-8 animate-slide-up">
                            {/* Timing Heatmap Component */}
                            <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-minimal">
                                <div className="flex items-center justify-between mb-8">
                                    <div>
                                        <h3 className="font-bold text-xl text-brand-primary flex items-center gap-2">
                                            <Clock size={20} className="text-amber-500" />
                                            Optimal Timing Map
                                        </h3>
                                        <p className="text-xs text-brand-secondary mt-1">Best times to post for peak reach in {niche}.</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                            <div className="w-2 h-2 rounded-full bg-amber-500" /> Peak
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                            <div className="w-2 h-2 rounded-full bg-amber-200" /> High
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
                                    {insights.timingHeatmap.map((t, i) => (
                                        <div key={i} className={`p-4 rounded-2xl border ${t.engagementLevel === 'Peak' ? 'bg-amber-50 border-amber-200' : t.engagementLevel === 'High' ? 'bg-orange-50 border-orange-100' : 'bg-gray-50 border-gray-100'}`}>
                                            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{t.day}</div>
                                            <div className="space-y-1">
                                                {t.bestHours.map((h, hi) => (
                                                    <div key={hi} className={`text-xs font-bold ${t.engagementLevel === 'Peak' ? 'text-amber-900' : 'text-gray-700'}`}>
                                                        {h}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Content Formats */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-minimal">
                                    <h3 className="font-bold text-xl text-brand-primary mb-6 flex items-center gap-2">
                                        <BarChart3 size={20} className="text-indigo-500" />
                                        Content Formats
                                    </h3>
                                    <div className="space-y-6">
                                        {insights.contentFormats.map((f, i) => (
                                            <div key={i} className="space-y-2">
                                                <div className="flex justify-between items-end">
                                                    <span className="text-sm font-bold text-brand-primary">{f.format}</span>
                                                    <span className="text-xs font-black text-indigo-600">{f.successRate}% Success</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-indigo-600 rounded-full transition-all duration-1000" 
                                                        style={{ width: `${f.successRate}%` }} 
                                                    />
                                                </div>
                                                <p className="text-[11px] text-brand-secondary leading-relaxed">{f.whyItWorks}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-minimal flex flex-col">
                                    <h3 className="font-bold text-xl text-brand-primary mb-6 flex items-center gap-2">
                                        <Sparkles size={20} className="text-amber-500" />
                                        Sentiment & Vibe
                                    </h3>
                                    <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                                        <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500">
                                            <MessageSquare size={32} />
                                        </div>
                                        <p className="text-lg font-display font-medium text-brand-primary italic leading-relaxed">
                                            "{insights.sentimentVibe}"
                                        </p>
                                        <div className="pt-4 flex flex-wrap justify-center gap-2">
                                            {insights.algorithmicSecrets.slice(0, 2).map((s, i) => (
                                                <span key={i} className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                                    {s.tip.split(' ')[0]} Focus
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Hook Library */}
                            <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-minimal">
                                <h3 className="font-bold text-xl text-brand-primary mb-6 flex items-center gap-2">
                                    <PenTool size={20} className="text-gray-900" />
                                    The Hook Library
                                </h3>
                                <div className="grid grid-cols-1 gap-3">
                                    {insights.topHooks.map((hook, i) => (
                                        <div 
                                            key={i} 
                                            className="group relative bg-gray-50 border border-gray-100 p-5 rounded-2xl hover:border-gray-900 transition-all cursor-pointer overflow-hidden"
                                            onClick={() => handleCopyHook(hook, i)}
                                        >
                                            <div className="flex gap-4 items-start relative z-10">
                                                <div className="w-8 h-8 rounded-xl bg-gray-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                                                    {i + 1}
                                                </div>
                                                <p className="font-medium text-sm leading-relaxed text-gray-800 flex-1">
                                                    {hook}
                                                </p>
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {copiedHook === i ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} className="text-gray-400" />}
                                                </div>
                                            </div>
                                            {copiedHook === i && (
                                                <div className="absolute inset-0 bg-emerald-50/50 flex items-center justify-center animate-fade-in">
                                                    <span className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">Copied to Clipboard</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Reference Posts */}
                            <div className="bg-gray-900 rounded-3xl p-8 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-8 opacity-10">
                                    <TrendingUp size={120} className="text-white" />
                                </div>
                                <h3 className="font-bold text-xl text-white mb-6 flex items-center gap-2 relative z-10">
                                    <Target size={20} className="text-emerald-400" />
                                    Viral References
                                </h3>
                                <div className="space-y-4 relative z-10">
                                    {insights.referencePosts.map((post, i) => (
                                        <a 
                                            key={i} 
                                            href={post.url} 
                                            target="_blank" 
                                            rel="noreferrer"
                                            className="block bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-4 transition-all group"
                                        >
                                            <div className="flex justify-between items-center">
                                                <div className="flex-1 pr-4">
                                                    <h4 className="font-bold text-white text-sm group-hover:text-emerald-400 transition-colors line-clamp-1">{post.title}</h4>
                                                    <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-1">{post.engagement} Engagement</p>
                                                </div>
                                                <ExternalLink size={14} className="text-white/20 group-hover:text-white transition-colors" />
                                            </div>
                                        </a>
                                    ))}
                                </div>
                                <div className="mt-8 flex items-center gap-2 text-white/60 text-xs font-medium">
                                    <Shield size={14} className="text-emerald-400" />
                                    Verified links from latest niche audit.
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full min-h-[600px] flex flex-col items-center justify-center space-y-6 bg-white rounded-3xl border border-gray-100 shadow-minimal p-20 text-center">
                            <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center text-gray-200">
                                <TrendingUp size={48} />
                            </div>
                            <div className="space-y-2 max-w-sm">
                                <h3 className="text-2xl font-display font-medium text-brand-primary tracking-tight">Intelligence Ready</h3>
                                <p className="text-brand-secondary text-sm">Select a platform and click "Run Content Audit" to deconstruct the current meta for your niche.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const PenTool: React.FC<{ size?: number; className?: string }> = ({ size = 20, className = "" }) => (
    <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
    </svg>
);
