import React, { useState, useEffect } from 'react';
import { 
    ShieldCheck, 
    Zap, 
    X, 
    Check, 
    Terminal, 
    ArrowUpRight, 
    Target, 
    Activity,
    Trash2,
    Search,
    Filter,
    Bot,
    ChevronRight
} from 'lucide-react';
import { PipelineLead } from '../types';

export const IntelligenceTriage: React.FC = () => {
    const [leads, setLeads] = useState<PipelineLead[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadLeads = () => {
            const saved = localStorage.getItem('pipeline_leads');
            if (saved) {
                const parsed = JSON.parse(saved) as PipelineLead[];
                // Filter only for pending verification
                setLeads(parsed.filter(l => l.status === 'pending_verification'));
            }
            setLoading(false);
        };

        loadLeads();
        window.addEventListener('pipeline_leads_update', loadLeads);
        return () => window.removeEventListener('pipeline_leads_update', loadLeads);
    }, []);

    const handleAction = (leadId: string, action: 'approve' | 'reject') => {
        const saved = localStorage.getItem('pipeline_leads');
        if (saved) {
            const parsed = JSON.parse(saved) as PipelineLead[];
            const updated = parsed.map(l => {
                if (l.id === leadId || (l.url === leadId)) {
                    return { ...l, status: action === 'approve' ? 'new' : 'converted' }; // Use 'converted' as a soft-delete/hidden state if we want to keep data, or just filter it out
                }
                return l;
            }).filter(l => action === 'reject' ? (l.id !== leadId && l.url !== leadId) : true);

            localStorage.setItem('pipeline_leads', JSON.stringify(updated));
            // Trigger storage event for other components
            window.dispatchEvent(new CustomEvent('pipeline_leads_update', { detail: updated }));
            setLeads(updated.filter(l => l.status === 'pending_verification'));
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-[60vh]">
            <Bot size={48} className="text-blue-500 animate-bounce" />
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-8 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-morphism p-8 rounded-[2.5rem] border-white/5 shadow-obsidian">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></span>
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Intelligence Triage</span>
                    </div>
                    <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Verify Prospects</h2>
                    <p className="text-sm text-slate-500 font-medium uppercase tracking-widest">Approve leads identified by the 18-layer reconnaissance engine.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="px-6 py-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                        <div className="text-right">
                            <div className="text-[9px] font-black uppercase text-slate-400">Queue Length</div>
                            <div className="text-xl font-black text-slate-900 leading-none">{leads.length}</div>
                        </div>
                        <ShieldCheck size={24} className="text-blue-500" />
                    </div>
                </div>
            </div>

            {leads.length === 0 ? (
                <div className="glass-morphism p-20 rounded-[2.5rem] text-center space-y-6 border-dashed border-2 border-slate-200 bg-slate-50/30">
                    <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center mx-auto border border-slate-100">
                        <Check size={32} className="text-emerald-500" />
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-xl font-bold text-slate-900">Inbox Zero Secured</h3>
                        <p className="text-sm text-slate-500 max-w-sm mx-auto">All identified intelligence has been verified. Launch a new Recon Mission to find more prospects.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6">
                    {leads.map((lead) => (
                        <div key={lead.url} className="group glass-morphism rounded-[2.5rem] border-white/5 shadow-obsidian hover:shadow-2xl transition-all duration-500 overflow-hidden bg-white">
                            <div className="flex flex-col lg:flex-row">
                                {/* Analysis Panel */}
                                <div className="lg:w-2/5 p-8 bg-slate-50/50 border-r border-slate-100">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center">
                                            <Target size={24} className="text-slate-900" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-900 text-lg">@{lead.name}</h4>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                                                    lead.intelligenceTier === 'Buy Now' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                                                    lead.intelligenceTier === 'Warm Opportunity' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                                    'bg-blue-50 text-blue-600 border-blue-100'
                                                }`}>
                                                    {lead.intelligenceTier || 'Analyzed'}
                                                </span>
                                                <span className="text-[9px] font-bold text-slate-400 uppercase">{lead.platform}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[9px] font-black uppercase text-slate-400">Match Confidence</span>
                                                <span className="text-[9px] font-black text-slate-900">{lead.intelligenceScore || lead.relevance}%</span>
                                            </div>
                                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full rounded-full transition-all duration-1000 ${
                                                        (lead.intelligenceScore || lead.relevance || 0) >= 70 ? 'bg-emerald-500' : 'bg-blue-500'
                                                    }`}
                                                    style={{ width: `${lead.intelligenceScore || lead.relevance}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t border-slate-100">
                                            <h5 className="text-[10px] font-black uppercase text-slate-400 mb-3">Decision Pipeline</h5>
                                            <div className="space-y-2.5">
                                                {lead.intelligencePipeline && lead.intelligencePipeline.length > 0 ? (
                                                    lead.intelligencePipeline.slice(0, 8).map((step, i) => (
                                                        <div key={i} className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                 <div className={`w-1.5 h-1.5 rounded-full ${
                                                                    step.status === 'pass' ? 'bg-emerald-400' : 'bg-rose-400'
                                                                }`} />
                                                                <span className="text-[10px] font-bold text-slate-700">{step.step}</span>
                                                            </div>
                                                            <span className="text-[9px] text-slate-400 font-medium truncate max-w-[120px] text-right">{step.detail}</span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="text-[9px] text-slate-300 italic">No reasoning data available</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Content & Actions Panel */}
                                <div className="lg:w-3/5 p-8 flex flex-col justify-between">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full border border-blue-100">
                                                <Terminal size={12} />
                                                <span className="text-[9px] font-black uppercase tracking-widest">Extracted Conversation</span>
                                            </div>
                                            <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-900 transition-colors">
                                                <ArrowUpRight size={18} />
                                            </a>
                                        </div>

                                        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 relative group/msg">
                                            <p className="text-sm text-slate-700 italic leading-relaxed">
                                                "{lead.postText || lead.why}"
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            {lead.intelligenceSignals?.map((s, i) => (
                                                <span key={i} className="px-3 py-1 bg-white border border-slate-100 rounded-lg text-[10px] font-bold text-slate-600 shadow-sm">
                                                    {s}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 mt-8 pt-6 border-t border-slate-50">
                                        <button 
                                            onClick={() => handleAction(lead.id || lead.url, 'reject')}
                                            className="flex-1 px-6 py-4 rounded-2xl border border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                                        >
                                            <X size={16} /> Discard Intel
                                        </button>
                                        <button 
                                            onClick={() => handleAction(lead.id || lead.url, 'approve')}
                                            className="flex-[2] px-6 py-4 rounded-2xl bg-slate-900 text-white font-bold text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-900/10 flex items-center justify-center gap-2"
                                        >
                                            <Check size={16} /> Promote to Pipeline
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
