import React, { useState, useEffect, useMemo } from 'react';
import { 
  ExternalLink, Target, Trash2, Heart, Sparkles, Check, ArrowRight, Inbox, Clock, Zap
} from 'lucide-react';
import { generateSmartEngagementComment } from '../services/geminiService';
import { SmartComment, PipelineLead, LeadInteraction } from '../types';

const STAGE_CONFIG = {
  'new': {
    label: 'Tracked Leads',
    description: 'Vetted Targets',
    color: 'blue',
    icon: <Inbox size={18} />,
    gradient: 'from-blue-500 to-cyan-400',
    bg: 'bg-blue-50/50',
    border: 'border-blue-100',
    accent: 'bg-blue-600'
  },
  'engaging': {
    label: 'Warming Up',
    description: 'Active Engagement',
    color: 'purple',
    icon: <Heart size={18} />,
    gradient: 'from-purple-500 to-indigo-400',
    bg: 'bg-purple-50/50',
    border: 'border-purple-100',
    accent: 'bg-purple-600'
  }
};

export const ProspectPipeline: React.FC<{ appDesc?: string }> = ({ appDesc }) => {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [commentingLead, setCommentingLead] = useState<any | null>(null);
  const [smartComments, setSmartComments] = useState<SmartComment | null>(null);
  const [isGeneratingComment, setIsGeneratingComment] = useState(false);

  useEffect(() => {
    const sync = () => {
        try {
            const pipelineRaw = localStorage.getItem('pipeline_leads_unified');
            const pl = pipelineRaw ? JSON.parse(pipelineRaw) : [];
            
            // Also check for recon signals that haven't been tracked yet
            const histRaw = localStorage.getItem('social_radar_history');
            const hist = histRaw ? JSON.parse(histRaw) : [];
            const trackedUrls = new Set(pl.map((l: any) => l.url));
            
            const newReconLeads = hist.filter((item: any) => {
                const isRecon = item.isRecon || item.campaignId;
                return isRecon && !trackedUrls.has(item.url || item.uuid);
            }).map((item: any) => ({
                url: item.url,
                postUrl: item.postUrl || item.url,
                name: item.creator || item.name || item.url.split('/').pop(),
                why: item.why || item.reason || "Mission Hit",
                postText: item.text || item.body,
                relevance: item.relevance || 85,
                scannedAt: item.timestamp || new Date().toISOString(),
                status: 'new',
                interactions: [],
                tags: [item.platform, 'Recon'],
                campaignName: item.campaignName,
                intelligenceTier: item.intelligenceTier,
                intelligenceScore: item.intelligenceScore
            }));

            setLeads([...pl, ...newReconLeads].map((l: any) => ({ 
                ...l, 
                interactions: l.interactions || [], 
                status: l.status || 'new' 
            })));
        } catch(e) { }
    };
    sync();
    window.addEventListener('pipeline_leads_update', sync);
    window.addEventListener('storage', sync);
    return () => {
        window.removeEventListener('pipeline_leads_update', sync);
        window.removeEventListener('storage', sync);
    };
  }, []);

  const updateLeadStatus = (url: string, newStatus: PipelineLead['status']) => {
    const updated = leads.map(d => d.url === url ? { ...d, status: newStatus } : d);
    setLeads(updated);
    // Only save the ones that were actually in the pipeline (or save all if we want to auto-track)
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const removeLead = (url: string) => {
    const updated = leads.filter(l => l.url !== url);
    setLeads(updated);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const logInteraction = (url: string, type: string) => {
    const updated = leads.map(l => l.url === url ? { 
        ...l, 
        interactions: [...(l.interactions || []), { type, timestamp: new Date().toISOString() }],
        status: (type === 'like' && l.status === 'new') ? 'engaging' : l.status
    } : l);
    setLeads(updated as any);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const getPlatformIcon = (platformInput: any = 'X') => {
    const platform = String(platformInput || 'X').toLowerCase();
    if (platform.includes('twitter') || platform.includes('x')) return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    );
    if (platform.includes('linkedin')) return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-blue-600"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
    );
    return <Target size={14} className="text-gray-400" />;
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-fade-in pb-20">
        <div className="flex items-center justify-between bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                    <Target size={24} className="text-white" />
                </div>
                <div>
                    <h2 className="text-2xl font-display font-bold text-gray-900">Prospect <span className="text-blue-600">Pipeline</span></h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-0.5">High-Velocity Lead Management</p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <div className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                    {leads.length} Active Leads
                </div>
            </div>
        </div>

        {/* ── Kanban Board ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 min-h-[70vh]">
            {(Object.keys(STAGE_CONFIG) as Array<keyof typeof STAGE_CONFIG>).map((stageKey) => {
                const config = STAGE_CONFIG[stageKey];
                const stageLeads = leads.filter(l => l.status === stageKey);
                
                return (
                    <div key={stageKey} className={`flex flex-col rounded-[3rem] border ${config.border} ${config.bg} p-4 shadow-sm`}>
                        <div className="p-4 mb-4 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-${config.color}-500 border border-gray-100`}>
                                    {config.icon}
                                </div>
                                <div>
                                    <h3 className="font-display font-bold text-gray-900 leading-none">{config.label}</h3>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1">{config.description}</p>
                                </div>
                            </div>
                            <div className={`px-3 py-1 rounded-full ${config.accent} text-white text-[10px] font-black`}>
                                {stageLeads.length}
                            </div>
                        </div>

                        <div className="flex-1 space-y-4 overflow-y-auto max-h-[800px] pr-2 custom-scrollbar pb-10">
                            {stageLeads.map((lead) => (
                                <div key={lead.url} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-5 hover:shadow-xl transition-all space-y-3 relative group">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-100">
                                                {getPlatformIcon(lead.platform)}
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-900">@{lead.name}</h4>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">{lead.campaignName || 'Organic'}</span>
                                                    <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                                    <span className="text-[8px] font-bold text-gray-400">{new Date(lead.scannedAt || '').toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black ${lead.intelligenceScore >= 80 ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                            {lead.intelligenceScore || lead.relevance}%
                                        </div>
                                    </div>
                                    
                                    <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">"{lead.postText || lead.why}"</p>

                                    <div className="pt-3 border-t border-gray-50 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => logInteraction(lead.url, 'like')} className="p-2 bg-gray-50 text-rose-500 rounded-lg border border-gray-100">
                                                <Heart size={14} fill={lead.interactions?.some(i => i.type === 'like') ? 'currentColor' : 'none'} />
                                            </button>
                                            <button className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white rounded-lg text-[9px] font-black uppercase tracking-widest">
                                                <Sparkles size={12} className="text-blue-400" /> Reply
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {lead.status === 'new' && (
                                                <button onClick={() => updateLeadStatus(lead.url, 'engaging')} className="p-2 bg-purple-50 text-purple-600 rounded-lg border border-purple-100">
                                                    <ArrowRight size={14} />
                                                </button>
                                            )}
                                            <button onClick={() => removeLead(lead.url)} className="p-2 text-gray-300 hover:text-red-500">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
  );
};
