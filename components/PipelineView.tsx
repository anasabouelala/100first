import React, { useState, useEffect, useMemo } from 'react';
import { 
  ExternalLink, 
  RefreshCw, 
  Target, 
  Trash2, 
  Send, 
  Inbox, 
  ShieldCheck, 
  Heart, 
  MessageSquare, 
  Zap, 
  ChevronRight,
  TrendingUp,
  Award,
  Sparkles,
  Check,
  MoreVertical,
  ArrowRight
} from 'lucide-react';
import { generateSmartEngagementComment } from '../services/geminiService';
import { SmartComment, PipelineLead, LeadInteraction } from '../types';

const STAGE_CONFIG = {
  'new': {
    label: 'Tracked Leads',
    description: 'Vetted from Radar',
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
  },
  'closing': {
    label: 'Closing Room',
    description: 'Direct Conversion',
    color: 'emerald',
    icon: <Send size={18} />,
    gradient: 'from-emerald-500 to-teal-400',
    bg: 'bg-emerald-50/50',
    border: 'border-emerald-100',
    accent: 'bg-emerald-600'
  }
};

export const PipelineView: React.FC<{ appDesc?: string, audience?: string }> = ({ appDesc, audience }) => {
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [autoPilot, setAutoPilot] = useState<boolean>(() => {
    return localStorage.getItem('pipeline_autopilot') === 'true';
  });

  const [commentingLead, setCommentingLead] = useState<PipelineLead | null>(null);
  const [smartComments, setSmartComments] = useState<SmartComment | null>(null);
  const [isGeneratingComment, setIsGeneratingComment] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());

  const logInteraction = (url: string, type: LeadInteraction['type']) => {
    const lead = leads.find(l => l.url === url);
    if (!lead) return;
    const newInteraction: LeadInteraction = { type, timestamp: new Date().toISOString() };
    const updatedLeads = leads.map(l => l.url === url ? { 
        ...l, 
        interactions: [...(l.interactions || []), newInteraction],
        status: (type === 'like' && l.status === 'new') ? 'engaging' : l.status
    } : l);
    setLeads(updatedLeads);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updatedLeads));
  };

  const toggleSelectLead = (url: string) => {
    const next = new Set(selectedLeads);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelectedLeads(next);
  };

  const handleBatchLike = () => {
    const selected = leads.filter(l => selectedLeads.has(l.url));
    selected.forEach(lead => {
        const targetUrl = lead.postUrl || lead.url;
        logInteraction(lead.url, 'like');
        window.dispatchEvent(new CustomEvent('pipeline_request_like', { detail: { url: targetUrl, platform: lead.tags?.[0] } }));
    });
    setSelectedLeads(new Set());
  };

  const getPlatformIcon = (platformInput: any = 'X') => {
    const platform = String(platformInput || 'X').toLowerCase();
    if (platform.includes('twitter') || platform.includes('x')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-gray-900">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
    );
    if (platform.includes('linkedin')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-blue-600">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
    );
    if (platform.includes('reddit')) return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-orange-500">
            <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.05l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.057 1.597.047.222.069.447.069.675 0 2.212-2.39 4.012-5.338 4.012s-5.338-1.8-5.338-4.012c0-.218.021-.432.065-.644a1.745 1.745 0 0 1-1.025-1.586c0-.968.786-1.754 1.754-1.754.463 0 .875.18 1.179.473 1.17-.834 2.8-1.393 4.602-1.474l.522-2.462 3.03.64zm-7.422 7.871c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.281-.574 1.281-1.282 0-.708-.573-1.282-1.281-1.282zm4.825 0c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.282-.574 1.282-1.282 0-.708-.574-1.282-1.282-1.282zm-2.377 3.724c-.232 0-.46.015-.685.042-.254.031-.498.08-.733.146-.147.042-.273.106-.381.187a.327.327 0 0 0-.099.448.327.327 0 0 0 .448.099c.071-.054.17-.102.289-.138.169-.047.346-.083.53-.105.19-.023.389-.035.592-.035.204 0 .403.012.593.035.184.022.361.058.53.105.119.036.218.084.289.138a.327.327 0 0 0 .448-.099.327.327 0 0 0-.099-.448c-.108-.081-.234-.145-.381-.187a3.984 3.984 0 0 0-.733-.146c-.225-.027-.453-.042-.685-.042z"/>
        </svg>
    );
    return <ShieldCheck size={20} className="text-gray-400" />;
  };



  useEffect(() => {
    loadLeads();
    
    // Request fresh history from extension on mount
    window.dispatchEvent(new CustomEvent('answerly_request_history'));

    const handleSync = (e: any) => {
        if (e.detail && Array.isArray(e.detail)) {
            const extLeads = e.detail;
            localStorage.setItem('pipeline_leads_unified', JSON.stringify(extLeads));
        }
        loadLeads();
    };
    window.addEventListener('pipeline_leads_update', handleSync);
    window.addEventListener('pipeline_remote_sync', handleSync);
    
    return () => {
        window.removeEventListener('pipeline_leads_update', handleSync);
        window.removeEventListener('pipeline_remote_sync', handleSync);
    };
  }, []);

  function loadLeads() {
    try {
      const raw = localStorage.getItem('pipeline_leads_unified');
      if (raw) {
        const parsed = JSON.parse(raw);
        setLeads(parsed.map((l: any) => ({
          ...l,
          interactions: l.interactions || [],
          status: l.status || 'new',
          timestamp: l.timestamp || l.scannedAt
        })));
      }
    } catch { setLeads([]); }
  }

  function updateLeadStatus(url: string, newStatus: PipelineLead['status']) {
    const updated = leads.map(d => d.url === url ? { ...d, status: newStatus } : d);
    setLeads(updated);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  }

  function removeLead(url: string) {
    const updated = leads.filter(d => d.url !== url);
    setLeads(updated);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  }

  const toggleAutoPilot = () => {
    const newVal = !autoPilot;
    setAutoPilot(newVal);
    localStorage.setItem('pipeline_autopilot', String(newVal));
  };

  async function handleOpenSmartReply(lead: PipelineLead) {
    setCommentingLead(lead);
    setSmartComments(null);
    setIsGeneratingComment(true);
    try {
        const result = await generateSmartEngagementComment(
            lead.postText || lead.why,
            appDesc || "A growth platform",
            lead.name || lead.title
        );
        setSmartComments(result);
    } catch (e) { console.error(e); } 
    finally { setIsGeneratingComment(false); }
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-fade-in pb-20">
      {/* ── Top Control Bar ── */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-6 bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-minimal relative overflow-hidden">
        {selectedLeads.size > 0 ? (
            <div className="absolute inset-0 bg-gray-900 z-20 flex items-center justify-between px-8 animate-slide-up">
                <div className="flex items-center gap-4">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white text-xs font-black">
                        {selectedLeads.size}
                    </span>
                    <h3 className="text-white font-bold">Signals Selected</h3>
                </div>
                <div className="flex items-center gap-4">
                    <button 
                        onClick={handleBatchLike}
                        className="flex items-center gap-2 px-6 py-2 bg-rose-500 text-white rounded-xl font-bold text-xs hover:bg-rose-600 transition-all active:scale-95 shadow-lg shadow-rose-500/20"
                    >
                        <Heart size={14} fill="currentColor" /> Send Batch Likes
                    </button>
                    <button 
                        onClick={() => {
                            const updated = leads.map(l => selectedLeads.has(l.url) ? { ...l, status: 'engaging' as const } : l);
                            setLeads(updated);
                            localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                            setSelectedLeads(new Set());
                        }}
                        className="flex items-center gap-2 px-6 py-2 bg-white/10 text-white rounded-xl font-bold text-xs hover:bg-white/20 transition-all"
                    >
                        Promote All
                    </button>
                    <div className="w-px h-6 bg-white/10 mx-2"></div>
                    <button 
                        onClick={() => setSelectedLeads(new Set())}
                        className="text-xs font-bold text-gray-400 hover:text-white"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        ) : null}
        
        <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200/50">
                <Target size={24} className="text-white" />
            </div>
            <div>
                <h2 className="text-2xl font-display font-bold text-gray-900">Conversion <span className="text-blue-600">Pipeline</span></h2>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-0.5">High-Velocity Lead Management</p>
            </div>
        </div>

        <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100">
                <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-none">Auto-Pilot</span>
                    <span className={`text-[8px] font-bold uppercase mt-1 ${autoPilot ? 'text-emerald-500' : 'text-gray-400'}`}>
                        {autoPilot ? 'Stealth Active' : 'Offline'}
                    </span>
                </div>
                <button 
                    onClick={toggleAutoPilot}
                    className={`w-10 h-5 rounded-full transition-all relative ${autoPilot ? 'bg-emerald-500 shadow-sm shadow-emerald-200' : 'bg-gray-200'}`}
                >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${autoPilot ? 'right-1' : 'left-1'}`}></div>
                </button>
            </div>
            <button onClick={loadLeads} className="btn btn-ghost btn-sm text-gray-400 hover:text-blue-600 gap-2 font-bold uppercase text-[10px] tracking-widest">
                <RefreshCw size={14} /> Refresh
            </button>
        </div>
      </div>

      {/* ── Kanban Board ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-[70vh]">
        {(Object.keys(STAGE_CONFIG) as Array<keyof typeof STAGE_CONFIG>).map((stageKey) => {
            const config = STAGE_CONFIG[stageKey];
            const stageLeads = leads.filter(l => l.status === stageKey);
            
            return (
                <div key={stageKey} className={`flex flex-col rounded-[3rem] border ${config.border} ${config.bg} p-4 shadow-sm relative overflow-hidden`}>
                    {/* Column Header */}
                    <div className="p-4 mb-4 flex justify-between items-center relative z-10">
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

                    {/* Column Content */}
                    <div className="flex-1 space-y-4 overflow-y-auto max-h-[800px] pr-2 custom-scrollbar pb-10">
                        {stageLeads.length === 0 ? (
                            <div className="py-20 text-center opacity-40">
                                <ShieldCheck size={48} className="mx-auto mb-4 text-gray-300" />
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Stage Clear</p>
                            </div>
                        ) : (
                            stageLeads.map((lead) => (
                                <CompactLeadCard 
                                    key={lead.url} 
                                    lead={lead} 
                                    config={config} 
                                    isSelected={selectedLeads.has(lead.url)}
                                    onSelect={() => toggleSelectLead(lead.url)}
                                    platformIcon={getPlatformIcon(lead.tags?.[0] || lead.platform || (lead.url.includes('reddit') ? 'Reddit' : lead.url.includes('linkedin') ? 'LinkedIn' : 'X'))}
                                    onUpdateStatus={(s) => updateLeadStatus(lead.url, s)}
                                    onRemove={() => removeLead(lead.url)}
                                    onSmartReply={() => handleOpenSmartReply(lead)}
                                    onLike={() => logInteraction(lead.url, 'like')}
                                />
                            ))
                        )}
                    </div>
                </div>
            );
        })}
      </div>

      {/* ── Smart Reply Modal (Shared) ── */}
      {commentingLead && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/60 backdrop-blur-md animate-fade-in">
              <div className="bg-white rounded-[3.5rem] w-full max-w-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                      <div>
                          <h3 className="text-xl font-bold text-gray-900">Reply for @{commentingLead.title}</h3>
                          <p className="text-[10px] text-gray-400 mt-1 uppercase font-black tracking-widest">AI Relationship Builder</p>
                      </div>
                      <button onClick={() => setCommentingLead(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                          <Trash2 size={20} className="text-gray-400" />
                      </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 space-y-6 text-center">
                    {/* Reuse Modal content from previous version or keep minimal */}
                    {isGeneratingComment ? (
                        <div className="py-12 flex flex-col items-center gap-4">
                            <RefreshCw className="animate-spin text-blue-600" size={32} />
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Drafting Replies...</p>
                        </div>
                    ) : smartComments ? (
                        <div className="space-y-4">
                            {smartComments.options.map((opt, i) => (
                                <button 
                                    key={i}
                                    onClick={() => {
                                        const targetUrl = commentingLead.postUrl || commentingLead.url;
                                        localStorage.setItem('answerly_comment_buffer', JSON.stringify({ url: targetUrl, text: opt.body }));
                                        window.open(targetUrl, '_blank');
                                        setCommentingLead(null);
                                    }}
                                    className="w-full text-left p-6 bg-white border border-gray-100 rounded-3xl hover:border-blue-600 hover:shadow-lg transition-all group"
                                >
                                    <p className="text-sm text-gray-800 font-bold leading-relaxed">{opt.body}</p>
                                    <p className="text-[10px] text-gray-400 mt-3 italic">{opt.why}</p>
                                </button>
                            ))}
                        </div>
                    ) : <p className="text-gray-400">Error generating replies.</p>}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const CompactLeadCard = ({ lead, config, isSelected, onSelect, platformIcon, onUpdateStatus, onRemove, onSmartReply, onLike }: { 
    lead: PipelineLead, 
    config: any, 
    isSelected: boolean,
    onSelect: () => void,
    platformIcon: React.ReactNode,
    onUpdateStatus: (status: PipelineLead['status']) => void,
    onRemove: () => void,
    onSmartReply: () => void,
    onLike: () => void
}) => {
    return (
        <div className={`bg-white rounded-3xl border transition-all group relative overflow-hidden ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/10' : 'border-gray-100'}`}>
            {/* Selection Checkbox */}
            <div 
                onClick={onSelect}
                className={`absolute top-4 left-4 z-10 w-5 h-5 rounded-lg border cursor-pointer flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-200 opacity-0 group-hover:opacity-100'}`}
            >
                {isSelected && <Check size={12} className="text-white" />}
            </div>

            <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3 pl-8">
                        <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-all">
                            {platformIcon}
                        </a>
                        <div>
                            <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="font-bold text-slate-900 truncate hover:text-blue-600 transition-colors">@{lead.name}</a>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                {lead.intelligenceTier && (
                                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border flex items-center gap-1 shadow-sm ${
                                        lead.intelligenceTier === 'Buy Now' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                        lead.intelligenceTier === 'Warm Opportunity' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                        'bg-slate-50 text-slate-500 border-slate-100'
                                    }`}>
                                        <Zap size={10} fill={lead.intelligenceTier === 'Buy Now' ? 'currentColor' : 'none'} /> {lead.intelligenceTier}
                                    </span>
                                )}
                                
                                <span className="text-[9px] text-gray-400 font-mono font-bold uppercase tracking-widest">
                                    {lead.timestamp ? new Date(lead.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Recently'}
                                </span>
                                
                                {lead.campaignName && (
                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1">
                                        <Target size={10} /> {lead.campaignName}
                                    </span>
                                )}
                            </div>
                            
                            {lead.intelligenceSignals && lead.intelligenceSignals.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {lead.intelligenceSignals.map((s, idx) => (
                                        <span key={idx} className="text-[8px] font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-md border border-gray-100">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                        <div className={`px-2 py-0.5 rounded-full text-[9px] font-black shadow-sm ${
                            (lead.intelligenceScore || lead.relevance) >= 70 ? 'bg-emerald-500 text-white' :
                            (lead.intelligenceScore || lead.relevance) >= 40 ? 'bg-orange-400 text-white' :
                            'bg-gray-100 text-gray-500'
                        }`}>
                            {lead.intelligenceScore || lead.relevance}% Match
                        </div>
                    </div>
                </div>

                <p className="text-xs text-gray-500 line-clamp-2 italic mb-4 leading-relaxed">
                    "{lead.postText || lead.why}"
                </p>

                {/* V5: Intelligence Decision Pipeline (Expandable) */}
                {lead.intelligencePipeline && (
                    <div className="mb-4">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                const el = document.getElementById(`intel-pipeline-${lead.id}`);
                                if (el) el.classList.toggle('hidden');
                            }}
                            className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors"
                        >
                            <Terminal size={10} /> View Decision Pipeline
                        </button>
                        <div id={`intel-pipeline-${lead.id}`} className="hidden mt-3 space-y-2 p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-in slide-in-from-top-1">
                            <div className="grid grid-cols-1 gap-2">
                                {lead.intelligencePipeline.map((step, idx) => (
                                    <div key={idx} className="flex items-center gap-3">
                                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            step.status === 'pass' ? 'bg-emerald-400' :
                                            step.status === 'fail' ? 'bg-rose-400' :
                                            step.status === 'blocked' ? 'bg-slate-900' :
                                            'bg-slate-300'
                                        }`} />
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black uppercase tracking-tight text-slate-900">{step.step}</span>
                                            <span className="text-[8px] text-slate-500">{step.detail}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-gray-50 p-5">
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={() => {
                                const targetUrl = lead.postUrl || lead.url;
                                onLike();
                                window.dispatchEvent(new CustomEvent('pipeline_request_like', { detail: { url: targetUrl } }));
                            }} 
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                lead.interactions?.find(i => i.type === 'like')
                                    ? 'bg-rose-50 text-rose-600 border-rose-200'
                                    : 'bg-white text-gray-500 border-gray-200 hover:text-rose-500 hover:border-rose-300'
                            }`}
                            title="Send Like"
                        >
                            <Heart size={13} fill={lead.interactions?.find(i => i.type === 'like') ? 'currentColor' : 'none'} />
                            {lead.interactions?.find(i => i.type === 'like') ? 'Liked' : 'Like'}
                        </button>
                        <button onClick={onSmartReply} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                            <Sparkles size={14} />
                        </button>
                        <button onClick={onRemove} className="p-2 text-gray-300 hover:text-red-500 rounded-lg transition-colors">
                            <Trash2 size={14} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {lead.status === 'new' && (
                            <button 
                                onClick={() => onUpdateStatus('engaging')}
                                className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white rounded-xl text-[10px] font-bold shadow-sm shadow-purple-200 hover:scale-105 transition-all"
                            >
                                Promote <ArrowRight size={10} />
                            </button>
                        )}
                        {lead.status === 'engaging' && (
                            <button 
                                onClick={() => onUpdateStatus('closing')}
                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[10px] font-bold shadow-sm shadow-emerald-200 hover:scale-105 transition-all"
                            >
                                Close Lead <ArrowRight size={10} />
                            </button>
                        )}
                        <a 
                            href={lead.postUrl || lead.url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all ${
                                lead.postUrl?.includes('/status/') || lead.postUrl?.includes('/update/') || lead.postUrl?.includes('/comments/')
                                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                                    : 'bg-gray-100 text-gray-400 grayscale opacity-60 hover:grayscale-0 hover:opacity-100'
                            }`}
                            title={lead.postUrl?.includes('/status/') ? "Open Direct Post" : "Open Profile"}
                        >
                            <span>{lead.postUrl?.includes('/status/') || lead.postUrl?.includes('/update/') || lead.postUrl?.includes('/comments/') ? "Direct Link" : "Profile Link"}</span>
                            <ExternalLink size={12} />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};




