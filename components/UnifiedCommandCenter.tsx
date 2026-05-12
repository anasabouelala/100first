import React, { useState, useEffect, useMemo } from 'react';
import { 
    Radar, ExternalLink, RefreshCw, Target, Trash2, Send, Inbox, 
    ShieldCheck, Heart, Sparkles, Check, X, ArrowRight, ArrowUpRight, Flame, MessageSquarePlus, Users,
    Activity, Clock
} from 'lucide-react';
import { generateSmartEngagementComment } from '../services/geminiService';
import { SmartComment, PipelineLead, LeadInteraction } from '../types';
import { AnswerlyView } from './AnswerlyView';

const STAGE_CONFIG = {
  'radar_help': {
    label: 'Help Requests',
    description: 'Needs Answers',
    color: 'orange',
    icon: <MessageSquarePlus size={18} />,
    gradient: 'from-orange-500 to-amber-400',
    bg: 'bg-orange-50/50',
    border: 'border-orange-200',
    accent: 'bg-orange-600',
    isRadar: true,
    radarType: 'help'
  },
  'radar_recon': {
    label: 'Signal Recon',
    description: 'ICP Matches',
    color: 'gray',
    icon: <Radar size={18} />,
    gradient: 'from-gray-700 to-gray-500',
    bg: 'bg-gray-50/50',
    border: 'border-gray-200',
    accent: 'bg-gray-800',
    isRadar: true,
    radarType: 'recon'
  },
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

export const UnifiedCommandCenter: React.FC<{ appDesc?: string }> = ({ appDesc }) => {
  const [radarHistory, setRadarHistory] = useState<any[]>([]);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [activeMainTab, setActiveMainTab] = useState<'radar' | 'leads'>('radar');
  const [commentingLead, setCommentingLead] = useState<any | null>(null);
  const [commentMode, setCommentMode] = useState<'lead' | 'visibility'>('lead');
  const [smartComments, setSmartComments] = useState<SmartComment | null>(null);
  const [isGeneratingComment, setIsGeneratingComment] = useState(false);
  const [commentOptions, setCommentOptions] = useState({ tone: 'casual', goal: 'build_relationship', maxLength: 250, customInstruction: '' });
  const [notingLead, setNotingLead] = useState<any | null>(null);
  const [noteText, setNoteText] = useState('');

  const trackedUrls = useMemo(() => new Set(leads.map(l => l.url)), [leads]);
  
  // 1. PUBLIC RADAR: Influencer tracking hits, excluding any recon or identified leads
  const influencerSignals = useMemo(() => {
    return radarHistory.filter(item => {
      if (trackedUrls.has(item.url || item.uuid)) return false;
      const isRecon = item.isRecon || 
                      item.text?.includes('[RECON]') || 
                      item.platform?.toLowerCase().includes('recon') ||
                      item.campaignId;
      return !isRecon;
    });
  }, [radarHistory, trackedUrls]);

  // 2. RECON SIGNALS: Hits from automated missions that aren't in the pipeline yet
  const newReconSignals = useMemo(() => {
    let disqualified = new Set();
    try {
        const raw = localStorage.getItem('disqualified_signals');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) disqualified = new Set(parsed);
        }
    } catch(e) { console.error("Triage parse error:", e); }
    
    return radarHistory.filter(item => {
      const id = item.url || item.uuid;
      if (trackedUrls.has(id) || disqualified.has(id as any)) return false;
      const isRecon = item.isRecon || 
                      item.text?.includes('[RECON]') || 
                      item.platform?.toLowerCase().includes('recon') ||
                      item.campaignId;
      return isRecon;
    });
  }, [radarHistory, trackedUrls]);

  useEffect(() => {
    let answerlyExtHistory: any[] = [];
    const loadLocalData = () => {
        try {
            const histRaw = localStorage.getItem('social_radar_history');
            const pipelineRaw = localStorage.getItem('pipeline_leads_unified');
            const hist = histRaw ? JSON.parse(histRaw) : [];
            const pl = pipelineRaw ? JSON.parse(pipelineRaw) : [];
            setLeads(pl.map((l: any) => ({ ...l, interactions: l.interactions || [], status: l.status || 'new' })));
            return hist;
        } catch(e) { return []; }
    };
    const updateCombinedHistory = () => {
        const localHist = loadLocalData();
        const combined = [...localHist, ...answerlyExtHistory];
        const uniqueMap = new Map();
        combined.forEach(item => { uniqueMap.set(item.uuid || item.url, item); });
        const sorted = Array.from(uniqueMap.values()).sort((a: any, b: any) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setRadarHistory(sorted.slice(0, 100));
        if (localHist.length > 0) setExtensionConnected(true);
    };
    const handlePong = () => setExtensionConnected(true);
    const handleHistory = (e: any) => {
        answerlyExtHistory = e.detail || [];
        updateCombinedHistory();
    };
    const handleStorage = () => updateCombinedHistory();
    const handleSync = (e: any) => {
        if (e.detail && Array.isArray(e.detail)) {
            const extLeads = e.detail;
            setLeads(extLeads.map((l: any) => ({ ...l, interactions: l.interactions || [], status: l.status || 'new' })));
            localStorage.setItem('pipeline_leads_unified', JSON.stringify(extLeads));
        }
        updateCombinedHistory();
    };
    window.addEventListener('answerly_pong', handlePong);
    window.addEventListener('answerly_history_update', handleHistory);
    window.addEventListener('pipeline_leads_update', handleSync);
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
        window.removeEventListener('pipeline_leads_update', handleSync);
        window.removeEventListener('storage', handleStorage);
        clearInterval(interval);
    };
  }, []);

  const handleTrackInPipeline = (item: any) => {
    if (trackedUrls.has(item.url)) return;
    const newLead = {
        url: item.url,
        postUrl: item.postUrl || item.url,
        name: item.creator || item.name || item.title || item.url.split('/').pop(),
        why: item.why || item.reason || "Detected via Inbound Radar",
        postText: item.text || item.body,
        relevance: Math.floor(Math.random() * 20) + 80,
        scannedAt: new Date().toISOString(),
        status: 'new',
        interactions: [],
        timestamp: item.timestamp || new Date().toISOString(), // Use original discovery time
        tags: [item.platform, 'Radar'],
        campaignId: item.campaignId,
        campaignName: item.campaignName,
        intent: item.intent
    };
    const updated = [newLead, ...leads];
    setLeads(updated as any);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const updateLeadStatus = (url: string, newStatus: PipelineLead['status']) => {
    const updated = leads.map(d => d.url === url ? { ...d, status: newStatus } : d);
    setLeads(updated);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const removeLead = (url: string) => {
    setLeads(prev => {
        const updated = prev.filter(l => l.url !== url);
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
        return updated;
    });
    setSelectedLeads(prev => { const next = new Set(prev); next.delete(url); return next; });
  };

  const logInteraction = (leadOrUrl: any, type: LeadInteraction['type']) => {
    const url = typeof leadOrUrl === 'string' ? leadOrUrl : (leadOrUrl.url || leadOrUrl.uuid);
    let existing = leads.find(l => l.url === url);
    let currentLeads = [...leads];
    
    if (!existing && typeof leadOrUrl !== 'string') {
        existing = {
            url: url,
            postUrl: leadOrUrl.postUrl || leadOrUrl.url || leadOrUrl.uuid,
            name: leadOrUrl.creator || leadOrUrl.name || leadOrUrl.title,
            why: leadOrUrl.why || leadOrUrl.reason || "Detected via Inbound Radar",
            postText: leadOrUrl.text || leadOrUrl.body || leadOrUrl.postText,
            relevance: leadOrUrl.relevance || Math.floor(Math.random() * 20) + 80,
            scannedAt: new Date().toISOString(),
            status: 'new',
            interactions: [],
            timestamp: new Date().toISOString(),
            tags: [leadOrUrl.platform, 'Radar'],
            campaignId: leadOrUrl.campaignId,
            campaignName: leadOrUrl.campaignName,
            intent: leadOrUrl.intent
        };
        currentLeads = [existing, ...currentLeads];
    }

    if (!existing && typeof leadOrUrl === 'string') return;

    const updatedLeads = currentLeads.map(l => l.url === url ? { 
        ...l, 
        interactions: [...(l.interactions || []), { type, timestamp: new Date().toISOString() }],
        status: (type === 'like' && l.status === 'new') ? 'engaging' : l.status
    } : l);
    
    setLeads(updatedLeads as any);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updatedLeads));
  };

  const getWarmupScore = (lead: any) => {
      let score = lead.relevance ? Math.floor(lead.relevance / 2) : 20; // Base: 0-50
      (lead.interactions || []).forEach((i: any) => {
          if (i.type === 'like') score += 15;
          if (i.type === 'reply' || i.type === 'comment') score += 30;
      });
      return Math.min(100, score);
  };

  const toggleSelectLead = (url: string) => {
    const next = new Set(selectedLeads);
    if (next.has(url)) next.delete(url); else next.add(url);
    setSelectedLeads(next);
  };

  const handleDiscardSignal = (signal: any) => {
    // 1. Internal State Update
    const id = signal.url || signal.uuid;
    const currentDisqualified = JSON.parse(localStorage.getItem('disqualified_signals') || '[]');
    if (!currentDisqualified.includes(id)) {
        localStorage.setItem('disqualified_signals', JSON.stringify([...currentDisqualified, id]));
    }
    
    // 2. Adaptive Learning Feedback Loop
    if (signal.campaignId) {
        const campaignsRaw = localStorage.getItem('icp_recon_campaigns');
        if (campaignsRaw) {
            try {
                let campaigns = JSON.parse(campaignsRaw);
                const idx = campaigns.findIndex((c: any) => c.id === signal.campaignId);
                
                if (idx !== -1) {
                    const campaign = campaigns[idx];
                    // Analyze profile for negative keywords to exclude
                    const roleText = (signal.role || signal.creator || "").toLowerCase();
                    const commonNoise = ['specialist', 'agency', 'expert', 'consultant', 'freelancer', 'coach', 'guru', 'service', 'solutions', 'partner'];
                    const foundNoise = commonNoise.filter(k => roleText.includes(k));
                    
                    if (foundNoise.length > 0) {
                        const existingNegs = campaign.negativeKeywords || [];
                        const updatedNegs = [...new Set([...existingNegs, ...foundNoise])];
                        
                        campaigns[idx] = { ...campaign, negativeKeywords: updatedNegs };
                        localStorage.setItem('icp_recon_campaigns', JSON.stringify(campaigns));
                        
                        // V4.2: Update Global Intel
                        const globalRaw = localStorage.getItem('global_negative_keywords');
                        const globals = globalRaw ? JSON.parse(globalRaw) : [];
                        const updatedGlobals = [...new Set([...globals, ...foundNoise])];
                        localStorage.setItem('global_negative_keywords', JSON.stringify(updatedGlobals));

                        // Update active campaign if it matches (for live UI update)
                        const activeRaw = localStorage.getItem('icp_recon_active_campaign');
                        if (activeRaw) {
                            const active = JSON.parse(activeRaw);
                            if (active.id === signal.campaignId) {
                                active.negativeKeywords = updatedNegs;
                                localStorage.setItem('icp_recon_active_campaign', JSON.stringify(active));
                            }
                        }

                        console.log(`[Adaptive Learning] Added exclusions for ${signal.campaignName}:`, foundNoise);
                        
                        // Notify ICP dashboard to refresh mission DNA if needed
                        window.dispatchEvent(new CustomEvent('icp_campaign_updated', { detail: { campaignId: signal.campaignId } }));
                    }
                }
            } catch(e) { console.error("Learning loop failed:", e); }
        }
    }

    setRadarHistory(prev => prev.filter(h => (h.url || h.uuid) !== id));
  };



  const saveNote = (lead: any, note: string) => {
    const url = lead.url || lead.uuid;
    const updatedLeads = leads.map(l => l.url === url ? { ...l, note } : l);
    // If lead is from recon and not tracked yet, add to pipeline with note
    if (!leads.find(l => l.url === url)) {
        const newLead = {
            url, 
            postUrl: lead.postUrl || lead.url || url,
            name: lead.creator || lead.title || lead.name, 
            why: note || "Detected via Radar",
            postText: lead.text || lead.body, 
            relevance: 80, 
            scannedAt: new Date().toISOString(),
            status: 'new' as const, 
            interactions: [], 
            tags: [lead.platform], 
            note
        };
        const updated = [newLead, ...leads];
        setLeads(updated as any);
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
    } else {
        setLeads(updatedLeads as any);
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updatedLeads));
    }
    setNotingLead(null);
    setNoteText('');
  };

  const qualifyLead = (url: string, qualified: boolean) => {
    setLeads(prev => {
        const updated = prev.map(l => l.url === url 
            ? { ...l, qualified, status: qualified ? 'engaging' as const : 'new' as const } 
            : l
        );
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
        return updated;
    });
  };

  async function handleOpenSmartReply(lead: any, isRadarSignal = false) {
    let targetLead = lead;
    const mode = isRadarSignal ? 'visibility' : 'lead';
    if (isRadarSignal) {
        handleTrackInPipeline(lead);
        targetLead = {
            url: lead.url, 
            postUrl: lead.postUrl || lead.url,
            title: lead.creator, 
            why: "Detected via Inbound Radar", 
            postText: lead.text || lead.body, 
            tags: [lead.platform],
            campaignId: lead.campaignId,
            campaignName: lead.campaignName,
            intent: lead.intent
        };
    }
    setCommentingLead(targetLead);
    setCommentMode(mode);
    setSmartComments(null);
    setIsGeneratingComment(false); // Don't auto-generate; let user set options first
  }

  async function generateComments() {
    if (!commentingLead) return;
    setSmartComments(null);
    setIsGeneratingComment(true);
    try {
        const result = await generateSmartEngagementComment(
            commentingLead.postText || commentingLead.why || '',
            appDesc || 'A growth platform',
            commentingLead.title || commentingLead.creator || '',
            { ...commentOptions, mode: commentMode }
        );
        setSmartComments(result);
    } catch (e) { console.error(e); }
    finally { setIsGeneratingComment(false); }
  }

  const getPlatformIcon = (platformInput: any = 'X', isDark = false) => {
    const platform = String(platformInput || 'X').toLowerCase();
    const xColor = isDark ? "text-white" : "text-gray-900";
    if (platform.includes('twitter') || platform.includes('x')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={xColor}>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
    );
    if (platform.includes('linkedin')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-blue-500">
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

  return (
    <div className="min-h-screen bg-gray-50/30">
      {/* ── Browser-Style Tab Bar ── */}
      <div className="flex items-end px-12 border-b border-gray-200 bg-white pt-6">
          <button 
              onClick={() => setActiveMainTab('radar')}
              className={`flex items-center gap-2 px-10 py-4 rounded-t-[2.5rem] text-xs font-black uppercase tracking-widest transition-all relative z-10 ${
                  activeMainTab === 'radar' 
                  ? 'bg-white text-amber-600 border-x border-t border-gray-200 -mb-[1px] shadow-[0_-15px_35px_rgba(0,0,0,0.08)]' 
                  : 'text-gray-400 hover:text-gray-600 pb-3'
              }`}
          >
              <div className={`p-1.5 rounded-xl ${activeMainTab === 'radar' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                  <MessageSquarePlus size={16} />
              </div>
              Public Radar
          </button>
          
          <div className="flex-1"></div>
          
          <div className="pb-4 pr-4">
              {!extensionConnected ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-500 rounded-2xl text-[10px] font-black uppercase tracking-tighter border border-rose-100 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      Disconnected
                  </div>
              ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-500 rounded-2xl text-[10px] font-black uppercase tracking-tighter border border-emerald-100">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Active
                  </div>
              )}
          </div>
      </div>

      <div className="p-12 animate-fade-in max-w-[1600px] mx-auto">
        {/* Batch actions shown inline above list, no floating bar needed */}

        <div className="flex items-center justify-between mb-16">
            <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-amber-500 rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-amber-200/50">
                    <Radar size={40} className="text-white" />
                </div>
                <div>
                    <h2 className="text-5xl font-display font-medium tracking-tight text-gray-900">Public <span className="text-amber-600 font-bold">Radar</span></h2>
                    <p className="text-sm font-black uppercase tracking-[0.3em] text-gray-300 mt-2">Tracked account activity — be first to engage</p>
                </div>
            </div>
            
            <div className="flex items-center gap-6">
                <div className="text-right">
                    <div className="px-5 py-2 bg-amber-100 text-amber-600 rounded-[1.25rem] text-[10px] font-black uppercase tracking-widest inline-block mb-3 shadow-sm border border-amber-200">Influencer Tracking</div>
                    <p className="text-sm text-gray-400 font-medium max-w-[240px]">Be the first to engage with big accounts to get noticed.</p>
                </div>
            </div>
        </div>

        {/* Radar feed */}
        <div className="space-y-3 max-w-5xl">
                <div className="space-y-4">
                    {influencerSignals.length === 0 ? (
                        <div className="py-32 text-center bg-gray-50 rounded-[3rem] border border-dashed border-gray-200">
                            <Radar size={48} className="mx-auto mb-4 text-gray-300" />
                            <h3 className="text-lg font-bold text-gray-400 uppercase tracking-widest">Radar Quiet</h3>
                            <p className="text-sm text-gray-400 mt-2">No followed posts detected. Check your extension settings.</p>
                        </div>
                    ) : (
                        influencerSignals.map((item: any) => (
                            <div key={item.uuid || item.url} className="group flex items-start gap-6 p-6 rounded-[2rem] border bg-amber-50/20 border-amber-100 hover:border-amber-300 transition-all shadow-sm">
                                <a href={item.postUrl || item.url} target="_blank" rel="noreferrer" className="w-12 h-12 rounded-2xl flex items-center justify-center border bg-white border-amber-200 text-amber-500 shadow-sm hover:border-blue-300 hover:bg-blue-50 transition-all">
                                    {getPlatformIcon(item.platform)}
                                </a>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <a href={item.postUrl || item.url} target="_blank" rel="noreferrer" className="font-bold text-gray-900 leading-none hover:text-blue-600 transition-colors">@{item.creator}</a>
                                        <div className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border bg-amber-500 text-white border-amber-500">New Post</div>
                                        <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                                            <Clock size={10} />
                                            {item.timestamp ? 
                                                new Date(item.timestamp).toLocaleDateString() + ' ' + 
                                                new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) 
                                                : 'Recently'}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed mb-4">
                                        {item.text || item.body}
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <button onClick={() => handleOpenSmartReply(item, true)} className="flex items-center gap-2 px-6 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all shadow-lg shadow-gray-900/10">
                                            <Sparkles size={14} className="text-amber-400" /> Comment Now
                                        </button>
                                        <a href={item.postUrl || item.url} target="_blank" rel="noreferrer" className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-xl shadow-sm transition-all">
                                            <ExternalLink size={16} />
                                        </a>
                                        <div className="flex-1"></div>
                                        <div className="text-[10px] font-black text-amber-500/50 uppercase tracking-tighter">Followed Influencer</div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    
                    {/* Stealth Configuration / Account Addition Section */}
                    <div className="mt-12 pt-8 border-t border-gray-100">
                        <AnswerlyView />
                    </div>
                </div>
            {false && (
                <div className="space-y-6">
                    {/* ── MISSION INTELLIGENCE TRIAGE ── */}
                    {newReconSignals.length > 0 && (
                        <div className="mb-10 space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-500 flex items-center gap-2">
                                    <Activity size={14} className="text-blue-500" /> Incoming Mission Signals 
                                    <span className="ml-1 px-2 py-0.5 bg-blue-500 text-white rounded-full text-[9px] font-black">{newReconSignals.length}</span>
                                </h3>
                                <button 
                                    onClick={() => {
                                        // Discard all signals
                                        const allUrls = newReconSignals.map(s => s.url);
                                        const disqualifiedLeads = newReconSignals.map(s => ({
                                            url: s.url,
                                            postUrl: s.postUrl || s.url,
                                            title: s.creator,
                                            why: "Mass Discarded from Triage",
                                            postText: s.text || s.body,
                                            relevance: 0,
                                            scannedAt: new Date().toISOString(),
                                            status: 'new',
                                            qualified: false,
                                            interactions: [],
                                            timestamp: new Date().toISOString(),
                                            tags: [s.platform, 'Radar'],
                                            campaignId: s.campaignId,
                                            campaignName: s.campaignName,
                                            intent: s.intent
                                        } as any));
                                        
                                        setLeads(prev => {
                                            const updated = [...disqualifiedLeads, ...prev];
                                            localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                            return updated;
                                        });
                                    }}
                                    className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 transition-all"
                                >
                                    Clear All Signals
                                </button>
                            </div>
                            
                            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-1">
                                {newReconSignals.map((signal) => (
                                    <div key={signal.url || signal.uuid} className="flex-shrink-0 w-80 bg-white border border-gray-100 rounded-[2rem] shadow-sm hover:shadow-xl hover:border-blue-200 transition-all p-6 space-y-4 group/card relative">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-100">
                                                    {getPlatformIcon(signal.platform || signal.url)}
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-bold text-gray-900 leading-tight">@{signal.creator}</h4>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{signal.platform}</p>
                                                </div>
                                            </div>
                                            <a href={signal.postUrl || signal.url} target="_blank" rel="noreferrer" className="p-2 text-gray-300 hover:text-blue-500 transition-colors">
                                                <ExternalLink size={16} />
                                            </a>
                                        </div>
                                        
                                        <div className="space-y-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest rounded-full border border-blue-100">
                                                    {signal.campaignName || "General Recon"}
                                                </span>
                                                {signal.intent && (
                                                    <span className="px-2 py-0.5 bg-purple-50 text-purple-600 text-[9px] font-bold rounded-full border border-purple-100 italic">
                                                        "{signal.intent}"
                                                    </span>
                                                )}
                                            </div>
                                            
                                            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 space-y-2 relative overflow-hidden group/card hover:bg-white transition-all">
                                                {/* Heat Ribbon */}
                                                <div className={`absolute top-0 left-0 w-1 h-full ${signal.relevance >= 85 ? 'bg-red-500' : signal.relevance >= 60 ? 'bg-orange-500' : 'bg-slate-300'}`}></div>
                                                
                                                <div className="flex justify-between items-center pl-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest flex items-center gap-1 ${signal.relevance >= 85 ? 'bg-red-500 text-white' : signal.relevance >= 60 ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                                            {signal.relevance >= 85 ? '🔥 HOT' : signal.relevance >= 60 ? '⚡ WARM' : '❄️ COLD'}
                                                        </span>
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 opacity-60">
                                                            {signal.interactionType === 'Comment' ? '💬 COMMENT' : '📣 POST'}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-emerald-600">{signal.relevance || 88}% Match</span>
                                                </div>
                                                <p className="text-[11px] text-gray-600 leading-relaxed italic line-clamp-3 pl-3">
                                                    "{signal.text || signal.body}"
                                                </p>
                                                <div className="pt-1 flex items-center gap-1.5 pl-3">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-40"></div>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600/70">Found via: {signal.intent || 'Keyword Match'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-2 pt-2">
                                            <button 
                                                onClick={() => handleTrackInPipeline(signal)}
                                                className="py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/10 active:scale-95 flex items-center justify-center gap-2"
                                            >
                                                <Check size={12} /> Approve
                                            </button>
                                            <button 
                                                onClick={() => handleDiscardSignal(signal)}
                                                className="py-2.5 bg-white border border-gray-200 text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                                            >
                                                <Trash2 size={12} /> Discard
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {(() => {
                        const allLeads = leads.filter(l => (l as any).why !== "Discarded from Triage" && (l as any).why !== "Mass Discarded from Triage");

                        if (allLeads.length === 0) return (
                            <div className="py-32 text-center bg-gray-50/50 rounded-[3rem] border border-dashed border-gray-200">
                                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-gray-100 mx-auto mb-6">
                                    <Target size={32} className="text-gray-300" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-400 uppercase tracking-widest">Pipeline Pristine</h3>
                                <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">Vette signals from the Mission Intelligence deck above to populate your active pipeline.</p>
                            </div>
                        );

                        return allLeads.map((lead: any) => {
                            const isSelected = selectedLeads.has(lead.url || lead.uuid);
                            const interactionCount = (lead.interactions || []).length;
                            const hasCommented = (lead.interactions || []).some((i: any) => i.type === 'reply' || i.type === 'comment');
                            const isRecon = lead.status === 'recon' || lead.isReconSignal;
                            const isQualified = (lead as any).qualified === true;
                            const isDisqualified = (lead as any).qualified === false;
                            const hasNote = !!(lead as any).note;

                            // Stage label reflects real sales progress
                            let stageLabel = 'Spotted';
                            let stageBg = 'bg-gray-100 text-gray-500';
                            if (hasCommented) { stageLabel = 'Commented'; stageBg = 'bg-blue-100 text-blue-700'; }
                            if (isQualified) { stageLabel = 'Qualified'; stageBg = 'bg-green-100 text-green-700'; }
                            if (isDisqualified) { stageLabel = 'Not a fit'; stageBg = 'bg-red-100 text-red-500'; }
                            if (isRecon) { stageLabel = 'New Signal'; stageBg = 'bg-amber-100 text-amber-700'; }

                            return (
                                <div key={lead.url || lead.uuid} className={`group flex items-start gap-4 p-5 rounded-2xl border bg-white transition-all ${
                                    isSelected ? 'border-blue-400 shadow-md ring-1 ring-blue-300' : 'border-gray-100 hover:border-gray-200 shadow-sm'
                                }`}>
                                    {/* Checkbox */}
                                    <button
                                        onClick={() => toggleSelectLead(lead.url || lead.uuid)}
                                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 hover:border-blue-400'
                                        }`}
                                    >
                                        {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                                    </button>

                                    {/* Platform icon */}
                                    <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-50 border border-gray-100 flex-shrink-0 hover:border-blue-300 hover:bg-blue-50 transition-all">
                                        {getPlatformIcon(lead.tags?.[0] || lead.platform || lead.url)}
                                    </a>

                                    {/* Main content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 text-sm hover:text-blue-600 transition-colors">@{lead.name || lead.title || lead.creator}</a>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${stageBg}`}>{stageLabel}</span>
                                            <span className="text-[10px] text-gray-500 font-bold bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100 flex items-center gap-1.5 shadow-sm">
                                                <Clock size={10} className="text-blue-500" />
                                                {(lead.timestamp || lead.scannedAt) ? 
                                                    new Date(lead.timestamp || lead.scannedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + 
                                                    new Date(lead.timestamp || lead.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) 
                                                    : 'Just now'}
                                            </span>
                                            
                                            {lead.campaignName && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1">
                                                    <Target size={10} /> {lead.campaignName}
                                                </span>
                                            )}
                                            
                                            {lead.intent && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100 italic">
                                                    "{lead.intent}"
                                                </span>
                                            )}

                                            {interactionCount > 0 && (
                                                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md flex items-center gap-1.5 border border-blue-100">
                                                    🤝 {interactionCount} Interactions
                                                </span>
                                            )}

                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest flex items-center gap-1 ${lead.relevance >= 85 ? 'bg-red-500 text-white shadow-sm' : lead.relevance >= 60 ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>
                                                {lead.relevance >= 85 ? '🔥 HOT' : lead.relevance >= 60 ? '⚡ WARM' : '❄️ COLD'}
                                            </span>
                                            
                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 uppercase tracking-widest border border-slate-200">
                                                {lead.interactionType === 'Comment' ? '💬 COMMENT' : '📣 POST'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                                            {lead.postText || lead.text || lead.why}
                                        </p>

                                        {/* Actions row */}
                                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                                            {isRecon ? (
                                                <button
                                                    onClick={() => handleTrackInPipeline(lead)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-all shadow-sm"
                                                >
                                                    <Check size={13} /> Track this prospect
                                                </button>
                                            ) : (
                                                <>
                                                    {/* Primary CTA: Write a comment — the #1 conversion action */}
                                                    <button
                                                        onClick={() => handleOpenSmartReply(lead)}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                            hasCommented
                                                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                            : 'bg-gray-900 text-white border-gray-900 hover:bg-blue-700 hover:border-blue-700'
                                                        }`}
                                                    >
                                                        <Sparkles size={13} />
                                                        {hasCommented ? 'Commented' : 'Write Comment'}
                                                    </button>

                                                    {/* NEW: Automated Like Button */}
                                                    <button
                                                        onClick={() => {
                                                            const event = new CustomEvent('pipeline_queue_engagement', { 
                                                                detail: { 
                                                                    lead: { ...lead, actionType: 'like' }
                                                                } 
                                                            });
                                                            window.dispatchEvent(event);
                                                            logInteraction(lead, 'like');
                                                        }}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-rose-600 border border-rose-100 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-all"
                                                        title="Automated Like via Extension"
                                                    >
                                                        <Heart size={13} fill={(lead.interactions || []).some((i: any) => i.type === 'like') ? 'currentColor' : 'none'} />
                                                        {(lead.interactions || []).some((i: any) => i.type === 'like') ? 'Liked' : 'Like'}
                                                    </button>

                                                    {/* Add a private note about pitch angle */}
                                                    <button
                                                        onClick={() => { setNotingLead(lead); setNoteText((lead as any).note || ''); }}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                            hasNote ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-700'
                                                        }`}
                                                    >
                                                        {hasNote ? '📝 Note' : '📝 +'}
                                                    </button>

                                                    {/* Qualify / Disqualify */}
                                                    {!isQualified && !isDisqualified && (
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => qualifyLead(lead.url, true)}
                                                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-all"
                                                                title="Qualify"
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => qualifyLead(lead.url, false)}
                                                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                                                                title="Not a fit"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            <a
                                                href={lead.postUrl || lead.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center gap-1.5 px-4 py-1.5 bg-white text-blue-600 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm group/btn"
                                            >
                                                <ExternalLink size={13} className="group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" /> 
                                                Direct Link
                                            </a>
                                            {!isRecon && (
                                                <button
                                                    onClick={() => removeLead(lead.url)}
                                                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-gray-300 hover:text-red-500 text-xs font-semibold rounded-lg hover:bg-red-50 transition-all"
                                                >
                                                    <Trash2 size={13} /> Remove
                                                </button>
                                            )}
                                        </div>

                                        {/* Note preview */}
                                        {hasNote && (
                                            <div className="mt-2 flex items-start gap-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                                                <span className="text-amber-500 text-xs mt-0.5">📝</span>
                                                <p className="text-xs text-amber-700 italic">{(lead as any).note}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </div>
            )}
        </div>

        {/* Floating Batch Actions Hub — reserved for future use */}
        {false && selectedLeads.size > 0 && activeMainTab === 'leads' && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[90] animate-in fade-in slide-in-from-bottom-6 duration-300">
                <div className="bg-gray-950/90 backdrop-blur-xl text-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.4)] px-8 py-5 flex items-center gap-8 border border-white/10 ring-1 ring-white/5">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 mb-0.5">Pipeline Pulse</span>
                        <span className="text-sm font-bold tracking-tight">{selectedLeads.size} leads selected</span>
                    </div>
                    
                    <div className="h-10 w-[1px] bg-white/10"></div>
                      <div className="flex items-center gap-4">
                        <button 
                            onClick={() => {
                                const urls = Array.from(selectedLeads);
                                // 1. Identify which recon signals need to be promoted/tracked
                                const signalsToTrack = newReconSignals.filter(s => urls.includes(s.url || s.uuid));
                                
                                setLeads(prev => {
                                    // Start with existing leads updated
                                    let updated = prev.map(l => urls.includes(l.url) 
                                        ? { ...l, qualified: true, status: 'engaging' as const } 
                                        : l
                                    );
                                    
                                    // Add new signals that were selected
                                    signalsToTrack.forEach(s => {
                                        if (!updated.find(l => l.url === s.url)) {
                                            updated.unshift({
                                                url: s.url,
                                                postUrl: s.postUrl || s.url,
                                                title: s.creator,
                                                why: "Batch Qualified via Pipeline",
                                                postText: s.text || s.body,
                                                relevance: 90,
                                                scannedAt: new Date().toISOString(),
                                                status: 'engaging',
                                                qualified: true,
                                                interactions: [],
                                                timestamp: new Date().toISOString(),
                                                tags: [s.platform, 'Radar'],
                                                campaignId: s.campaignId,
                                                campaignName: s.campaignName,
                                                intent: s.intent
                                            } as any);
                                        }
                                    });

                                    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                    return updated;
                                });
                                setSelectedLeads(new Set());
                            }}
                            className="flex items-center gap-2.5 px-6 py-3 bg-blue-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-95"
                        >
                            <Check size={14} /> Qualify All
                        </button>
                        
                        <button 
                            onClick={() => {
                                const urls = Array.from(selectedLeads);
                                // 1. Identify which recon signals need to be promoted/disqualified
                                const signalsToTrack = newReconSignals.filter(s => urls.includes(s.url || s.uuid));

                                setLeads(prev => {
                                    let updated = prev.map(l => urls.includes(l.url) 
                                        ? { ...l, qualified: false, status: 'new' as const } 
                                        : l
                                    );

                                    // Add new signals that were selected as disqualified
                                    signalsToTrack.forEach(s => {
                                        if (!updated.find(l => l.url === s.url)) {
                                            updated.unshift({
                                                url: s.url,
                                                postUrl: s.postUrl || s.url,
                                                title: s.creator,
                                                why: "Batch Disqualified via Pipeline",
                                                postText: s.text || s.body,
                                                relevance: 0,
                                                scannedAt: new Date().toISOString(),
                                                status: 'new',
                                                qualified: false,
                                                interactions: [],
                                                timestamp: new Date().toISOString(),
                                                tags: [s.platform, 'Radar'],
                                                campaignId: s.campaignId,
                                                campaignName: s.campaignName,
                                                intent: s.intent
                                            } as any);
                                        }
                                    });

                                    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                    return updated;
                                });
                                setSelectedLeads(new Set());
                            }}
                            className="flex items-center gap-2.5 px-6 py-3 bg-white/10 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-all active:scale-95 border border-white/10"
                        >
                            <X size={14} /> Not a Fit
                        </button>

                        <button 
                            onClick={() => {
                                const urls = Array.from(selectedLeads);
                                setLeads(prev => {
                                    const updated = prev.filter(l => !urls.includes(l.url));
                                    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                    return updated;
                                });
                                setSelectedLeads(new Set());
                            }}
                            className="flex items-center gap-2.5 px-6 py-3 bg-red-500/10 text-red-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all active:scale-95 border border-red-500/20"
                        >
                            <Trash2 size={14} /> Remove
                        </button>

                        <div className="w-[1px] h-6 bg-white/10 mx-2"></div>
                        
                        <button 
                            onClick={() => setSelectedLeads(new Set())}
                            className="p-3 text-gray-500 hover:text-white hover:bg-white/5 rounded-full transition-all"
                            title="Clear Selection"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* ── Comment Writing Modal ── */}
        {commentingLead && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/60 backdrop-blur-md">
                <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="p-6 border-b border-gray-100 flex justify-between items-start">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                                {commentMode === 'visibility' ? 'Brand Visibility Comment' : 'Sales Prospect Comment'}
                            </p>
                            <h3 className="text-lg font-bold text-gray-900">Write a comment for @{commentingLead.title || commentingLead.creator}</h3>
                            {commentingLead.postText && (
                                <p className="text-xs text-gray-400 mt-1 line-clamp-1 italic">"{commentingLead.postText}"</p>
                            )}
                        </div>
                        <button onClick={() => { setCommentingLead(null); setSmartComments(null); }} className="p-2 hover:bg-gray-100 rounded-xl transition-colors ml-4 flex-shrink-0">
                            <Trash2 size={18} className="text-gray-400" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {/* Customization Panel */}
                        <div className="p-6 border-b border-gray-50 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                {/* Tone */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-2">Tone</label>
                                    <div className="flex gap-2">
                                        {[['casual', 'Casual'], ['formal', 'Formal'], ['funny', 'Witty']].map(([val, label]) => (
                                            <button key={val} onClick={() => setCommentOptions(o => ({ ...o, tone: val }))}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                    commentOptions.tone === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                                }`}>{label}</button>
                                        ))}
                                    </div>
                                </div>
                                {/* Goal */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-2">What do you want to achieve?</label>
                                    <select
                                        value={commentOptions.goal}
                                        onChange={e => setCommentOptions(o => ({ ...o, goal: e.target.value }))}
                                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white"
                                    >
                                        <option value="build_relationship">Start a real conversation</option>
                                        <option value="ask_question">Ask an interesting question</option>
                                        <option value="share_insight">Share a useful insight</option>
                                        <option value="get_noticed">Stand out from the crowd</option>
                                    </select>
                                </div>
                            </div>
                            {/* Length */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-2">
                                    Max comment length: <span className="text-gray-900">{commentOptions.maxLength} characters</span>
                                </label>
                                <input type="range" min={80} max={500} step={20}
                                    value={commentOptions.maxLength}
                                    onChange={e => setCommentOptions(o => ({ ...o, maxLength: Number(e.target.value) }))}
                                    className="w-full accent-gray-900"
                                />
                                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                                    <span>Short (80)</span><span>Tweet-length (250)</span><span>Long (500)</span>
                                </div>
                            </div>
                            {/* Custom Instruction */}
                            <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-2">Any specific angle? <span className="font-normal text-gray-400">(optional)</span></label>
                                <input type="text"
                                    value={commentOptions.customInstruction}
                                    onChange={e => setCommentOptions(o => ({ ...o, customInstruction: e.target.value }))}
                                    placeholder='e.g. "Mention the difficulty of scaling teams" or "Be empathetic"'
                                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                                />
                            </div>
                            {/* Generate Button */}
                            <button
                                onClick={generateComments}
                                disabled={isGeneratingComment}
                                className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isGeneratingComment ? <><RefreshCw size={15} className="animate-spin" /> Generating...</> : <><Sparkles size={15} /> Generate comments</>}
                            </button>
                        </div>

                        {/* Results */}
                        {smartComments && (
                            <div className="p-6 space-y-3">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-semibold text-gray-500">Pick a comment to use — click to open the post and copy it</p>
                                    <button onClick={generateComments} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                        <RefreshCw size={12} /> Regenerate
                                    </button>
                                </div>
                                {smartComments.options.map((opt, i) => (
                                    <div
                                        key={i}
                                        className="group relative bg-white border border-gray-100 p-5 rounded-2xl hover:border-blue-200 transition-all text-left shadow-sm hover:shadow-md"
                                    >
                                        <div className="flex items-start justify-between gap-6">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 px-3 py-1 bg-blue-50 rounded-full">
                                                        {opt.type === 'agreement' ? 'Agree & build' : opt.type === 'insight' ? 'Share insight' : 'Ask a question'}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-800 leading-relaxed font-medium">{opt.body}</p>
                                                <p className="text-[10px] text-gray-400 mt-2 italic">{opt.why}</p>
                                            </div>
                                            
                                            <div className="flex flex-col gap-2 min-w-[140px]">
                                                <button
                                                    onClick={() => {
                                                        const event = new CustomEvent('pipeline_queue_engagement', { 
                                                            detail: { 
                                                                lead: {
                                                                    ...commentingLead,
                                                                    actionType: 'comment',
                                                                    commentText: opt.body
                                                                }
                                                            } 
                                                        });
                                                        window.dispatchEvent(event);
                                                        logInteraction(commentingLead, 'reply');
                                                        setCommentingLead(null);
                                                        setSmartComments(null);
                                                    }}
                                                    className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                                                >
                                                    <Sparkles size={14} /> Send Now
                                                </button>
                                                
                                                <button
                                                    onClick={() => {
                                                        const targetUrl = commentingLead.postUrl || commentingLead.url || commentingLead.uuid;
                                                        localStorage.setItem('answerly_comment_buffer', JSON.stringify({ url: targetUrl, text: opt.body }));
                                                        logInteraction(commentingLead, 'reply');
                                                        window.open(targetUrl, '_blank');
                                                        setCommentingLead(null);
                                                        setSmartComments(null);
                                                    }}
                                                    className="px-4 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 flex items-center justify-center gap-2 transition-all"
                                                >
                                                    <ExternalLink size={14} /> Open Manual
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
        {/* ── Note Modal ── */}
        {notingLead && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/50 backdrop-blur-sm">
                <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-50">
                        <h3 className="text-base font-bold text-gray-900">Note for @{notingLead.name || notingLead.title || notingLead.creator}</h3>
                        <p className="text-xs text-gray-400 mt-1">Private. Write your pitch angle, context, or follow-up plan.</p>
                    </div>
                    <div className="p-6">
                        <textarea
                            autoFocus
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="e.g. They're complaining about slow dev cycles — our tool directly solves this. Lead with the time-to-market angle."
                            rows={4}
                            className="w-full text-sm text-gray-800 border border-gray-200 rounded-2xl p-4 resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                        />
                        <div className="flex items-center justify-end gap-3 mt-4">
                            <button onClick={() => { setNotingLead(null); setNoteText(''); }} className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2">Cancel</button>
                            <button
                                onClick={() => saveNote(notingLead, noteText)}
                                disabled={!noteText.trim()}
                                className="px-6 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-all disabled:opacity-40"
                            >
                                Save note
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
