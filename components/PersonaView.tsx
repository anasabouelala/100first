import React, { useState } from 'react';
import { generateBuyerPersonas } from '../services/geminiService';
import { BuyerPersonaAnalysis } from '../types';
import { Search, MapPin, Target, Users, Zap, Loader2, Quote, Activity, Coffee, MessageSquare } from 'lucide-react';

interface PersonaViewProps {
    appName: string;
    appDesc: string;
    category: string;
}

export const PersonaView: React.FC<PersonaViewProps> = ({ appName, appDesc, category }) => {
    const [loading, setLoading] = useState(false);
    const [analysis, setAnalysis] = useState<BuyerPersonaAnalysis | null>(() => {
        const saved = localStorage.getItem('buyer_personas');
        return saved ? JSON.parse(saved) : null;
    });

    const handleGenerate = async () => {
        if (!appName || !appDesc || !category) return;
        setLoading(true);
        try {
            const data = await generateBuyerPersonas(appName, appDesc, category);
            setAnalysis(data);
            localStorage.setItem('buyer_personas', JSON.stringify(data));
        } catch (e) {
            console.error("Failed to fetch personas", e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-20">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-base-300 pb-4">
                <div>
                    <h2 className="text-3xl font-display font-bold"><span className="text-primary">Buyer</span> Personas</h2>
                    <p className="text-sm opacity-70 mt-1">Deep market research to identify exactly who you are selling to.</p>
                </div>
            </div>

            <div className="card bg-white border border-gray-100 shadow-minimal">
                <div className="card-body p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                        <h3 className="font-bold text-lg text-brand-primary">Generate Core Personas</h3>
                        <p className="text-sm text-brand-secondary">We will use live Google Search data to build highly specific profiles, identify their exact pain points, and map out where they hang out.</p>
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={loading || !appName || !appDesc || !category}
                        className="btn btn-primary px-8 py-3 w-full sm:w-auto text-base whitespace-nowrap text-white shadow-lg hover:shadow-primary/30"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
                        {loading ? 'Researching Market...' : 'Generate Personas'}
                    </button>
                </div>
            </div>

            {(!appName || !appDesc || !category) && (
                <div className="alert bg-warning/20 text-warning-content">
                    <Activity size={18} />
                    <span>Please set up all Mission Control fields (Name, Pitch, Category) first!</span>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center p-20 space-y-4">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="text-brand-secondary font-medium">Analyzing market trends and generating profiles...</p>
                </div>
            ) : analysis ? (
                <div className="space-y-8 animate-fade-in">

                    {/* Market Overview */}
                    <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-6 rounded-2xl border border-primary/20">
                        <h3 className="font-bold text-primary flex items-center gap-2 mb-2"><Activity size={20} /> Market Overview</h3>
                        <p className="text-gray-700 leading-relaxed text-sm">{analysis.marketOverview}</p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {analysis.personas.map((persona, idx) => (
                            <div key={idx} className="card bg-white border border-gray-200 shadow-sm hover:shadow-lg transition-all h-full flex flex-col">
                                <div className="bg-base-200/50 p-6 border-b border-gray-100 relative">
                                    {/* Decorative Icon */}
                                    <div className="absolute top-4 right-4 text-primary opacity-20">
                                        <Target size={40} />
                                    </div>
                                    <h3 className="text-xl font-display font-bold text-brand-primary mb-1 pr-10">{persona.name}</h3>
                                    <p className="font-mono text-xs font-bold text-primary">{persona.role}</p>
                                </div>

                                <div className="card-body p-6 flex-grow">

                                    <div className="mb-6">
                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1"><Users size={12} /> Demographics</h4>
                                        <p className="text-sm text-gray-700">{persona.demographics}</p>
                                    </div>

                                    {persona.realWorldQuote && (
                                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 mb-6 italic text-sm text-gray-600 relative">
                                            <Quote className="absolute top-2 left-2 text-gray-200" size={20} />
                                            <div className="pl-6">"{persona.realWorldQuote}"</div>
                                        </div>
                                    )}

                                    <div className="space-y-6">
                                        <div>
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-error mb-2 flex items-center gap-1"><Zap size={12} /> Core Pain Points</h4>
                                            <ul className="space-y-1.5">
                                                {persona.painPoints.map((point, i) => (
                                                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                                        <span className="text-error mt-0.5">•</span> <span>{point}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <div>
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-success mb-2 flex items-center gap-1"><Target size={12} /> Goals & Desires</h4>
                                            <ul className="space-y-1.5">
                                                {persona.goals.map((goal, i) => (
                                                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                                        <span className="text-success mt-0.5">•</span> <span>{goal}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <div className="pt-4 border-t border-gray-100">
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-2 flex items-center gap-1"><MapPin size={12} /> Distribution Channels (Where they hang out)</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {persona.whereTheyHangOut.map((place, i) => (
                                                    <span key={i} className="badge badge-secondary badge-outline badge-sm text-xs py-2">{place}</span>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2 flex items-center gap-1"><Coffee size={12} /> Content Consumed</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {persona.contentTheyConsume.map((content, i) => (
                                                    <span key={i} className="badge bg-blue-50 text-blue-600 border border-blue-200 badge-sm text-[10px] py-1">{content}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            ) : null}
        </div>
    );
};
