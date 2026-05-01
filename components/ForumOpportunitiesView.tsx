import React, { useState, useEffect } from 'react';
import { fetchProductHuntOpportunities } from '../services/productHuntService';
import { fetchHackerNewsOpportunities } from '../services/hackerNewsService';
import { fetchRedditOpportunities } from '../services/redditService';
import { PHAnalysisResult, PHLead, PHRawDiscussion, ForumFilters, CompetitorData, BuyerPersonaAnalysis } from '../types';
import { Search, Activity, Zap, Loader2, ArrowRight, TrendingUp, Target, MessageCircle, BarChart3, Quote, Users, Database, ExternalLink, ChevronDown, ChevronUp, Clock, User, Filter, Sparkles } from 'lucide-react';

interface ForumOpportunitiesViewProps {
    appDesc: string;
    category: string;
}

export const ForumOpportunitiesView: React.FC<ForumOpportunitiesViewProps> = ({ appDesc, category }) => {
    const [loading, setLoading] = useState(false);
    const [analysis, setAnalysis] = useState<PHAnalysisResult | null>(null);
    const [hasScanned, setHasScanned] = useState(false);
    const [leadsSource, setLeadsSource] = useState<Record<number, string>>({});
    const [expandedDiscussions, setExpandedDiscussions] = useState<Record<number, boolean>>({});

    // Filter states
    const [showFilters, setShowFilters] = useState(false);
    const [icp, setIcp] = useState('');
    const [competitors, setCompetitors] = useState('');
    const [relatedTopic, setRelatedTopic] = useState('');
    const [brandName, setBrandName] = useState('');
    const [keywords, setKeywords] = useState('');

    const [suggestedCompetitors, setSuggestedCompetitors] = useState<string[]>([]);
    const [suggestedPersonas, setSuggestedPersonas] = useState<string[]>([]);

    useEffect(() => {
        try {
            const reconData = localStorage.getItem('recon_competitors');
            if (reconData) {
                const parsed: CompetitorData[] = JSON.parse(reconData);
                setSuggestedCompetitors(parsed.map(c => c.name).slice(0, 5));
            }
            const personaData = localStorage.getItem('buyer_personas');
            if (personaData) {
                const parsed: BuyerPersonaAnalysis = JSON.parse(personaData);
                setSuggestedPersonas(parsed.personas.map(p => p.name));
            }
        } catch (e) {
            console.error("Failed to load suggestions from localStorage", e);
        }
    }, []);

    const toggleDiscussion = (idx: number) => {
        setExpandedDiscussions(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    const handleScan = async () => {
        if (!appDesc || !category) return;
        setLoading(true);
        setHasScanned(true);

        const filters: ForumFilters = {
            icp,
            competitors,
            relatedTopic,
            brandName,
            keywords
        };

        try {
            const [phData, hnData, redditData] = await Promise.all([
                fetchProductHuntOpportunities(appDesc, category, filters).catch((e) => {
                    console.error("PH Error", e);
                    return null;
                }),
                fetchHackerNewsOpportunities(appDesc, category, filters).catch((e) => {
                    console.error("HN Error", e);
                    return null;
                }),
                fetchRedditOpportunities(appDesc, category, filters).catch((e) => {
                    console.error("Reddit Error", e);
                    return null;
                })
            ]);

            const mergedLeads: PHLead[] = [];
            const sourceMap: Record<number, string> = {};
            let totalOps = 0;
            let totalIntent = 0;
            let sourceCount = 0;

            if (phData) {
                totalOps += phData.kpis.totalOpportunities;
                totalIntent += phData.kpis.buyIntentScore;
                sourceCount++;

                phData.leads.forEach(lead => {
                    sourceMap[mergedLeads.length] = 'Product Hunt';
                    mergedLeads.push(lead);
                });
            }

            if (hnData) {
                totalOps += hnData.kpis.totalOpportunities;
                totalIntent += hnData.kpis.buyIntentScore;
                sourceCount++;

                hnData.leads.forEach(lead => {
                    sourceMap[mergedLeads.length] = 'Hacker News';
                    mergedLeads.push(lead);
                });
            }

            if (redditData) {
                totalOps += redditData.kpis.totalOpportunities;
                totalIntent += redditData.kpis.buyIntentScore;
                sourceCount++;

                redditData.leads.forEach(lead => {
                    sourceMap[mergedLeads.length] = 'Reddit';
                    mergedLeads.push(lead);
                });
            }

            const avgIntent = sourceCount > 0 ? Math.round(totalIntent / sourceCount) : 0;

            const sortedLeadsWithIndex = mergedLeads.map((lead, idx) => ({ lead, source: sourceMap[idx] })).sort((a, b) => b.lead.relevanceScore - a.lead.relevanceScore);

            const sortedLeads = sortedLeadsWithIndex.map(item => item.lead);
            const newSourceMap: Record<number, string> = {};
            sortedLeadsWithIndex.forEach((item, idx) => newSourceMap[idx] = item.source);

            setLeadsSource(newSourceMap);

            setAnalysis({
                kpis: {
                    totalOpportunities: totalOps,
                    buyIntentScore: avgIntent,
                    topPersona: "Global Buyer",
                    marketSentiment: avgIntent > 70 ? 'Positive' : avgIntent > 40 ? 'Neutral' : 'Negative'
                },
                personas: [],
                leads: sortedLeads,
                rawDiscussions: phData?.rawDiscussions || []
            });

        } catch (e) {
            console.error("Failed to fetch forum analysis", e);
        } finally {
            setLoading(false);
        }

    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-20">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-base-300 pb-4">
                <div>
                    <h2 className="text-3xl font-display font-bold">Forum Intel & <span className="text-secondary">KPIs</span></h2>
                    <p className="text-sm opacity-70 mt-1">Extract highly targeted leads directly from live discussions on Hacker News and Product Hunt.</p>
                </div>
            </div>

            <div className="card bg-white border border-gray-100 shadow-minimal mb-4">
                <div className="card-body p-6 flex flex-col items-start gap-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 w-full border-b border-gray-100 pb-5">
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-gray-900">Scan Recent Discussions</h3>
                            <p className="text-sm text-gray-500 mt-1">Find exact users matching your Buyer Persona, Niche Demand, or Competitor Pain Points from aggregated forum data.</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto">
                            <button
                                onClick={() => setShowFilters(!showFilters)}
                                className={`flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 ${showFilters ? 'bg-gray-900 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-transparent'}`}
                                title="Toggle Advanced Filters"
                            >
                                <Filter size={20} />
                            </button>
                            <button
                                onClick={handleScan}
                                disabled={loading || !appDesc || !category}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-gray-900 text-white font-medium shadow-md hover:bg-gray-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? <Loader2 size={18} className="animate-spin shrink-0" /> : <Search size={18} className="shrink-0" />}
                                <span className="whitespace-nowrap">{loading ? 'Analyzing...' : 'Extract KPIs & Leads'}</span>
                            </button>
                        </div>
                    </div>

                    {showFilters && (
                        <div className="w-full bg-gradient-to-br from-white to-indigo-50/30 p-6 md:p-8 rounded-2xl border border-indigo-100 shadow-xl animate-fade-in mt-6">
                            <div className="pb-4 mb-6 border-b border-indigo-100/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div>
                                    <h4 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                        <Sparkles size={18} className="text-primary" /> Smart Filtering Criteria
                                    </h4>
                                    <p className="text-sm text-gray-600 mt-1">Select from your generated intelligence or specify manual criteria to find laser-targeted leads.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                <div className="form-control">
                                    <label className="label py-1"><span className="label-text text-xs font-bold text-gray-700 tracking-wider uppercase">Ideal Customer Profile</span></label>
                                    <input
                                        type="text"
                                        value={icp}
                                        onChange={(e) => setIcp(e.target.value)}
                                        placeholder="e.g. Solo-Dev Indie Hacker"
                                        className="input input-bordered focus:border-primary focus:ring-2 focus:ring-primary/20 w-full shadow-sm bg-white"
                                    />
                                    {suggestedPersonas.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {suggestedPersonas.map((p, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => setIcp(p)}
                                                    className={`badge cursor-pointer px-3 py-3 border transition-all ${icp === p ? 'bg-primary text-white border-primary shadow-md' : 'bg-blue-50/80 text-blue-700 hover:bg-blue-100 border-blue-200'}`}
                                                >
                                                    {icp === p ? '✓ ' : '+ '}{p}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="form-control">
                                    <label className="label py-1"><span className="label-text text-xs font-bold text-gray-700 tracking-wider uppercase">Competitors</span></label>
                                    <input
                                        type="text"
                                        value={competitors}
                                        onChange={(e) => setCompetitors(e.target.value)}
                                        placeholder="e.g. OpenAI, Anthropic"
                                        className="input input-bordered focus:border-primary focus:ring-2 focus:ring-primary/20 w-full shadow-sm bg-white"
                                    />
                                    {suggestedCompetitors.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {suggestedCompetitors.map((c, idx) => {
                                                const isActive = competitors.includes(c);
                                                return (
                                                    <button
                                                        key={idx}
                                                        onClick={() => {
                                                            if (isActive) {
                                                                setCompetitors(competitors.split(', ').filter(x => x !== c).join(', '));
                                                            } else {
                                                                setCompetitors(competitors ? `${competitors}, ${c}` : c);
                                                            }
                                                        }}
                                                        className={`badge cursor-pointer px-3 py-3 border transition-all ${isActive ? 'bg-error text-white border-error shadow-md' : 'bg-red-50/80 text-red-700 hover:bg-red-100 border-red-200'}`}
                                                    >
                                                        {isActive ? '✓ ' : '+ '}{c}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="form-control">
                                    <label className="label py-1"><span className="label-text text-xs font-bold text-gray-700 tracking-wider uppercase">Related Topic</span></label>
                                    <input
                                        type="text"
                                        value={relatedTopic}
                                        onChange={(e) => setRelatedTopic(e.target.value)}
                                        placeholder="e.g. AI Content Generation"
                                        className="input input-bordered focus:border-primary focus:ring-2 focus:ring-primary/20 w-full shadow-sm bg-white"
                                    />
                                    {category && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            <button
                                                onClick={() => setRelatedTopic(category)}
                                                className={`badge cursor-pointer px-3 py-3 border transition-all ${relatedTopic === category ? 'bg-secondary text-white border-secondary shadow-md' : 'bg-purple-50/80 text-purple-700 hover:bg-purple-100 border-purple-200'}`}
                                            >
                                                {relatedTopic === category ? '✓ ' : '+ '}{category}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="form-control">
                                    <label className="label py-1"><span className="label-text text-xs font-bold text-gray-700 tracking-wider uppercase">Brand Name</span></label>
                                    <input
                                        type="text"
                                        value={brandName}
                                        onChange={(e) => setBrandName(e.target.value)}
                                        placeholder="e.g. Apple, Google"
                                        className="input input-bordered focus:border-primary focus:ring-2 focus:ring-primary/20 w-full shadow-sm bg-white"
                                    />
                                </div>

                                <div className="form-control lg:col-span-2">
                                    <label className="label py-1"><span className="label-text text-xs font-bold text-gray-700 tracking-wider uppercase">Manual Keywords</span></label>
                                    <input
                                        type="text"
                                        value={keywords}
                                        onChange={(e) => setKeywords(e.target.value)}
                                        placeholder="e.g. hiring, looking for, tool, recommendation"
                                        className="input input-bordered focus:border-primary focus:ring-2 focus:ring-primary/20 w-full shadow-sm bg-white"
                                    />
                                    <p className="text-xs text-gray-400 mt-2 flex items-center gap-1"><Search size={12} /> AI will fuzzy-match these keywords across discussions.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {(!appDesc || !category) && (
                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 flex items-center gap-3 text-amber-800 shadow-sm mt-0 mb-6 w-full">
                    <Activity size={20} className="shrink-0 text-amber-600" />
                    <span className="font-medium text-sm">Please set up your Product Pitch and Category in Mission Control first!</span>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col items-center justify-center p-20 space-y-4">
                    <span className="loading loading-spinner loading-lg text-secondary"></span>
                    <p className="text-brand-secondary font-medium">Analyzing buying intent and parsing forum threads globally...</p>
                </div>
            ) : hasScanned && analysis ? (
                <div className="space-y-8 animate-fade-in">

                    {/* KPI Dashboard */}
                    <div className="card bg-base-100 shadow-md border border-base-200">
                        <div className="card-body">
                            <h3 className="card-title text-primary flex items-center gap-2 mb-2">
                                <BarChart3 size={24} /> Market KPIs: Identified Opportunities
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="stat bg-base-200 rounded-xl p-4 border border-base-300">
                                    <div className="stat-title text-xs font-bold uppercase opacity-60">Verified Leads</div>
                                    <div className="stat-value text-xl font-display mt-1">{analysis.kpis.totalOpportunities}</div>
                                </div>
                                <div className="stat bg-base-200 rounded-xl p-4 border border-base-300">
                                    <div className="stat-title text-xs font-bold uppercase opacity-60">Avg. Buy Intent</div>
                                    <div className="stat-value text-xl font-display text-success mt-1">{analysis.kpis.buyIntentScore}/100</div>
                                </div>
                                <div className="stat bg-base-200 rounded-xl p-4 border border-base-300">
                                    <div className="stat-title text-xs font-bold uppercase opacity-60">Top Persona</div>
                                    <div className="stat-value text-base mt-1 whitespace-normal break-words leading-tight text-primary font-medium">{analysis.kpis.topPersona}</div>
                                </div>
                                <div className="stat bg-base-200 rounded-xl p-4 border border-base-300">
                                    <div className="stat-title text-xs font-bold uppercase opacity-60">General Sentiment</div>
                                    <div className="stat-value text-lg mt-1 flex items-center gap-2">
                                        {analysis.kpis.marketSentiment === 'Positive' ? <TrendingUp size={20} className="text-success" /> : <Activity size={20} className="text-warning" />}
                                        {analysis.kpis.marketSentiment}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h3 className="text-xl font-bold flex items-center gap-2 border-b border-base-200 pb-2"><Target className="text-secondary" /> Hot Leads</h3>

                    {(!analysis.leads || analysis.leads.length === 0) ? (
                        <div className="p-10 text-center bg-base-200 rounded-xl border border-base-300">
                            <p className="opacity-70">No specific high-intent leads found in the latest scan. Try expanding your search category.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-6">
                            {analysis.leads.map((lead, idx) => {
                                const source = leadsSource[idx] || 'Forum';
                                let sourceColor = 'text-purple-500 bg-purple-50';
                                let sourceIconColor = 'text-purple-300';
                                let btnColor = 'btn-primary text-white';

                                if (source === 'Hacker News') {
                                    sourceColor = 'text-orange-500 bg-orange-50';
                                    sourceIconColor = 'text-orange-300';
                                    btnColor = 'bg-orange-500 hover:bg-orange-600 text-white border-none';
                                } else if (source === 'Reddit') {
                                    sourceColor = 'text-red-500 bg-red-50';
                                    sourceIconColor = 'text-red-300';
                                    btnColor = 'bg-red-500 hover:bg-red-600 text-white border-none';
                                }

                                return (
                                    <div key={idx} className="card bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="card-body p-6">
                                            <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`badge text-white font-medium ${lead.type === 'Competitor Pain Point' ? 'badge-error' :
                                                        lead.type === 'Niche Demand' ? 'badge-info' : 'badge-secondary'
                                                        }`}>
                                                        {lead.type}
                                                    </span>
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${sourceColor}`}>
                                                        {source}
                                                    </span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <span className="text-xs font-mono font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded">{lead.date}</span>
                                                    <span className="text-xs font-mono font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded">Score: {lead.relevanceScore}</span>
                                                </div>
                                            </div>

                                            <h3 className="text-lg font-bold text-brand-primary mb-4">{lead.headline}</h3>

                                            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 relative mb-4">
                                                <Quote className={`absolute opacity-50 ${sourceIconColor}`} size={24} />
                                                <p className="pl-8 text-sm text-gray-700 italic">"{lead.sourceText}"</p>
                                                <div className="pl-8 mt-2 text-xs text-gray-400 font-mono flex items-center gap-1">
                                                    <MessageCircle size={12} /> {source} Discussion Extract
                                                </div>
                                            </div>

                                            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 flex flex-col gap-2 text-sm text-blue-900 mt-4">
                                                <div className="flex items-center gap-2">
                                                    <Zap size={16} className="text-blue-500 shrink-0" />
                                                    <span className="font-bold text-blue-700">Outreach Strategy</span>
                                                </div>
                                                <div>
                                                    {lead.context}
                                                </div>
                                            </div>

                                            <div className="card-actions justify-end mt-4 pt-4 border-t border-gray-100">
                                                <a href={lead.url} target="_blank" rel="noreferrer" className={`btn btn-sm shadow-sm ${btnColor}`}>
                                                    Reply to Lead <ArrowRight size={14} />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {analysis.rawDiscussions && analysis.rawDiscussions.length > 0 && (
                        <div className="mt-12">
                            <h3 className="text-xl font-bold flex items-center gap-2 border-b border-base-200 pb-2 mb-6">
                                <Database className="text-primary" /> Latest Product Hunt Discussions
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                {analysis.rawDiscussions.map((disc, idx) => (
                                    <div key={idx} className="card bg-white border border-gray-200 shadow-sm transition-shadow hover:shadow-md">
                                        <div className="card-body p-6">
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="flex-1">
                                                    <a href={disc.url} target="_blank" rel="noreferrer" className="text-lg font-bold text-brand-primary hover:text-primary transition-colors">
                                                        {disc.title}
                                                    </a>
                                                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 font-medium">
                                                        <div className="flex items-center gap-1"><User size={14} /> {disc.creator || 'Unknown'}</div>
                                                        <div className="flex items-center gap-1"><Clock size={14} /> {disc.date || 'Recent'}</div>
                                                        <div className="flex items-center gap-1"><MessageCircle size={14} /> {disc.comments?.length || 0} comments</div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => toggleDiscussion(idx)}
                                                    className="btn btn-sm btn-ghost text-gray-500"
                                                >
                                                    {expandedDiscussions[idx] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                                </button>
                                            </div>

                                            {expandedDiscussions[idx] && disc.comments && disc.comments.length > 0 && (
                                                <div className="mt-6 space-y-4 pt-4 border-t border-gray-100">
                                                    {disc.comments.map((comment, cIdx) => (
                                                        <div key={cIdx} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                                                                    {(comment.author?.[0] || 'U').toUpperCase()}
                                                                </div>
                                                                <span className="font-bold text-sm text-gray-900">{comment.author || 'User'}</span>
                                                            </div>
                                                            <p className="text-sm text-gray-700 pl-8">{comment.text}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {expandedDiscussions[idx] && (!disc.comments || disc.comments.length === 0) && (
                                                <div className="mt-6 pt-4 border-t border-gray-100 text-sm text-gray-500 italic">
                                                    No comments found for this discussion yet.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            ) : null}
        </div>
    );
};
