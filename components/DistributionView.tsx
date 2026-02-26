import React, { useState } from 'react';
import { findDistributionChannels, generateChannelContent, analyzeChannel, findChannelOpportunities, generateOpportunityReply, getIndustryBenchmarks } from '../services/geminiService';
import { DistributionChannel, GeneratedContent, ChannelAnalysis, MarketOpportunity, ReplyDraft, IndustryBenchmark } from '../types';
import { Search, Globe, Loader2, Copy, Check, Zap, X, Users, Activity, DollarSign, Trophy, Clock, Shield, AlertTriangle, FileText, ChevronRight, PenTool, Radar, MessageCircle, Send, ExternalLink, TrendingUp, TrendingDown, Minus, Unlock, Key, Hash, BarChart3, ArrowRight, MousePointer2, Rocket } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export const DistributionView: React.FC = () => {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [appName, setAppName] = useState('');
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<DistributionChannel[]>([]);
  
  // Benchmark State
  const [loadingBenchmarks, setLoadingBenchmarks] = useState(false);
  const [benchmarks, setBenchmarks] = useState<IndustryBenchmark[]>([]);

  // Selection & Analysis State
  const [selectedChannel, setSelectedChannel] = useState<DistributionChannel | null>(null);
  const [viewMode, setViewMode] = useState<'INTEL' | 'DRAFT' | 'RADAR'>('INTEL');
  
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ChannelAnalysis | null>(null);
  
  const [generatingContent, setGeneratingContent] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Opportunity State
  const [scanningOpps, setScanningOpps] = useState(false);
  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([]);
  const [selectedOpp, setSelectedOpp] = useState<MarketOpportunity | null>(null);
  const [generatingReply, setGeneratingReply] = useState(false);
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);

  const handleScan = async () => {
    if (!description || !category) return;
    setLoading(true);
    setChannels([]);
    setSelectedChannel(null);
    setAnalysis(null);
    setGeneratedContent(null);
    setBenchmarks([]);
    
    // Launch parallel requests
    const benchmarksPromise = (async () => {
      setLoadingBenchmarks(true);
      try {
        const data = await getIndustryBenchmarks(category);
        setBenchmarks(data);
      } catch (e) { console.error(e); }
      finally { setLoadingBenchmarks(false); }
    })();

    const channelsPromise = (async () => {
      try {
        const results = await findDistributionChannels(description, category);
        setChannels(results.sort((a, b) => b.matchScore - a.matchScore));
      } catch (e) { console.error(e); }
    })();

    await Promise.all([benchmarksPromise, channelsPromise]);
    setLoading(false);
  };

  const handleChannelSelect = async (channel: DistributionChannel) => {
    setSelectedChannel(channel);
    setViewMode('INTEL');
    setAnalysis(null);
    setGeneratedContent(null);
    setOpportunities([]);
    setReplyDraft(null);
    setAnalyzing(true);
    
    // Auto-analyze on select
    try {
      const intel = await analyzeChannel(channel.name, channel.url, description);
      setAnalysis(intel);
    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateContent = async () => {
    if (!selectedChannel) return;
    setViewMode('DRAFT');
    if (!generatedContent) {
        setGeneratingContent(true);
        try {
          const content = await generateChannelContent(selectedChannel, appName || "My App", description);
          setGeneratedContent(content);
        } catch (e) {
          console.error(e);
        } finally {
          setGeneratingContent(false);
        }
    }
  };

  const handleScanOpportunities = async () => {
    if (!selectedChannel) return;
    setScanningOpps(true);
    setOpportunities([]);
    setSelectedOpp(null);
    setReplyDraft(null);
    try {
        const opps = await findChannelOpportunities(selectedChannel, description);
        setOpportunities(opps);
    } catch (e) {
        console.error(e);
    } finally {
        setScanningOpps(false);
    }
  };

  const handleGenerateReply = async (opp: MarketOpportunity) => {
    if (!selectedChannel || !analysis) return;
    setSelectedOpp(opp);
    setGeneratingReply(true);
    setReplyDraft(null);
    try {
        const draft = await generateOpportunityReply(opp, selectedChannel.name, description, analysis.rules);
        setReplyDraft(draft);
    } catch (e) {
        console.error(e);
    } finally {
        setGeneratingReply(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-20">
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-base-300 pb-4">
        <div>
           <h2 className="text-3xl font-display font-bold">Launch <span className="text-secondary">Distribution</span></h2>
           <p className="text-sm opacity-70 mt-1">Deep intelligence scanning for high-conversion channels.</p>
        </div>
      </div>

      {/* Input Section */}
      <div className="card bg-base-100 shadow-md">
         <div className="card-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-control">
                    <label className="label"><span className="label-text font-bold">App Name</span></label>
                    <input 
                        type="text"
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                        placeholder="e.g. CodeSnap"
                        className="input input-bordered w-full"
                    />
                </div>
                <div className="form-control">
                    <label className="label"><span className="label-text font-bold">Category</span></label>
                    <input 
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="e.g. Developer Tools"
                        className="input input-bordered w-full"
                    />
                </div>
            </div>
            <div className="form-control">
                <label className="label"><span className="label-text font-bold">Description</span></label>
                <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your app in detail..."
                    className="textarea textarea-bordered h-20"
                />
            </div>
            <div className="card-actions justify-end mt-2">
                <button 
                  onClick={handleScan}
                  disabled={loading || !description || !category}
                  className="btn btn-secondary w-full md:w-auto text-white"
                >
                  {loading ? <span className="loading loading-spinner"></span> : <Search size={18} />}
                  Find Top 10 Channels
                </button>
            </div>
         </div>
      </div>

      {/* Market Pulse Section */}
      {benchmarks.length > 0 && (
          <div className="card bg-base-100 shadow-md border border-base-200">
             <div className="card-body">
                 <h3 className="card-title text-primary flex items-center gap-2 mb-4">
                    <BarChart3 size={24}/> Market Pulse: {category}
                 </h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                     {benchmarks.map((bench, idx) => (
                         <div key={idx} className="stat bg-base-200 rounded-xl p-4">
                             <div className="stat-title text-xs font-bold uppercase opacity-60 h-8">{bench.metric}</div>
                             <div className="stat-value text-xl">{bench.avgValue}</div>
                             <div className="stat-desc text-success font-bold mt-1">Top 10%: {bench.top10Value}</div>
                         </div>
                     ))}
                 </div>
             </div>
          </div>
      )}

      {/* Grid Results */}
      {channels.length > 0 && (
          <div className="space-y-12">
             {/* Launchpads Section */}
             {channels.filter(c => c.type === 'Launchpad' || c.type === 'Directory').length > 0 && (
                 <div>
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Rocket className="text-primary"/> Launchpads & Directories</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {channels.filter(c => c.type === 'Launchpad' || c.type === 'Directory').map((channel, idx) => (
                            <div 
                            key={idx} 
                            onClick={() => handleChannelSelect(channel)}
                            className={`card bg-base-100 shadow-md hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer border ${selectedChannel?.name === channel.name ? 'border-primary ring-1 ring-primary' : 'border-base-200'}`}
                            >
                            <div className="card-body p-6">
                                <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h3 className="font-bold text-lg flex items-center gap-2">
                                                {channel.name} 
                                                <a href={channel.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="opacity-50 hover:opacity-100 text-primary"><ExternalLink size={14}/></a>
                                            </h3>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                <span className="badge badge-xs badge-primary badge-outline">{channel.type}</span>
                                                <span className={`badge badge-xs ${channel.cost === 'Free' ? 'badge-success text-white' : 'badge-neutral'}`}>{channel.cost}</span>
                                            </div>
                                        </div>
                                        <div className="radial-progress text-xs font-bold text-primary bg-base-100 border-4 border-base-100" style={{"--value":channel.matchScore, "--size": "3rem"} as any}>
                                            {channel.matchScore}
                                        </div>
                                </div>

                                <div className="stats stats-vertical lg:stats-horizontal shadow bg-base-200 my-4 w-full">
                                    <div className="stat p-2 place-items-center">
                                        <div className="stat-title text-[10px] uppercase">Traffic</div>
                                        <div className="stat-value text-sm">{channel.audienceSize}</div>
                                    </div>
                                    <div className="stat p-2 place-items-center">
                                        <div className="stat-title text-[10px] uppercase">Success</div>
                                        <div className="stat-value text-sm">{channel.successCase}</div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2 text-sm font-bold text-neutral mb-2">
                                    <Zap size={16} /> 
                                    <span>{channel.opportunityCount}+ Weekly Launches</span>
                                </div>

                                <div className="alert bg-base-200 py-2 px-3 text-xs">
                                    <Trophy size={14} className="text-warning" />
                                    <span>"{channel.reason}"</span>
                                </div>
                                
                                <div className="card-actions mt-2">
                                    <button className="btn btn-sm btn-block btn-outline btn-primary">Prepare Launch</button>
                                </div>
                            </div>
                            </div>
                        ))}
                    </div>
                 </div>
             )}

             {/* Organic Section */}
             <div>
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Users className="text-secondary"/> Organic Communities (Free)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {channels.filter(c => (c.category === 'Organic' || !c.category) && c.type !== 'Launchpad' && c.type !== 'Directory').map((channel, idx) => (
                        <div 
                        key={idx} 
                        onClick={() => handleChannelSelect(channel)}
                        className={`card bg-base-100 shadow-md hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer border ${selectedChannel?.name === channel.name ? 'border-secondary ring-1 ring-secondary' : 'border-base-200'}`}
                        >
                        <div className="card-body p-6">
                            <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-bold text-lg flex items-center gap-2">
                                            {channel.name} 
                                            <a href={channel.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="opacity-50 hover:opacity-100 text-secondary"><ExternalLink size={14}/></a>
                                        </h3>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            <span className="badge badge-xs badge-ghost">{channel.type}</span>
                                            <span className={`badge badge-xs ${channel.tier.includes('Tier 1') ? 'badge-primary text-white' : 'badge-neutral'}`}>{channel.tier}</span>
                                        </div>
                                    </div>
                                    <div className="radial-progress text-xs font-bold text-secondary bg-base-100 border-4 border-base-100" style={{"--value":channel.matchScore, "--size": "3rem"} as any}>
                                        {channel.matchScore}
                                    </div>
                            </div>

                            <div className="stats stats-vertical lg:stats-horizontal shadow bg-base-200 my-4 w-full">
                                <div className="stat p-2 place-items-center">
                                    <div className="stat-title text-[10px] uppercase">Audience</div>
                                    <div className="stat-value text-sm">{channel.audienceSize}</div>
                                </div>
                                <div className="stat p-2 place-items-center">
                                    <div className="stat-title text-[10px] uppercase">Engagement</div>
                                    <div className="stat-value text-sm">{channel.engagementLevel}</div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 text-sm font-bold text-accent mb-2">
                                <Zap size={16} /> 
                                <span>{channel.opportunityCount}+ Weekly Threads</span>
                            </div>

                            <div className="alert bg-base-200 py-2 px-3 text-xs">
                                <Trophy size={14} className="text-warning" />
                                <span>"{channel.successCase}"</span>
                            </div>
                            
                            <div className="card-actions mt-2">
                                <button className="btn btn-sm btn-block btn-outline">Inspect Channel</button>
                            </div>
                        </div>
                        </div>
                    ))}
                </div>
             </div>

             {/* Ads Section */}
             {channels.filter(c => c.category === 'Ads').length > 0 && (
                 <div>
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><DollarSign className="text-accent"/> Paid Ads & Sponsorships</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {channels.filter(c => c.category === 'Ads').map((channel, idx) => (
                            <div 
                            key={idx} 
                            onClick={() => handleChannelSelect(channel)}
                            className={`card bg-base-100 shadow-md hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer border ${selectedChannel?.name === channel.name ? 'border-accent ring-1 ring-accent' : 'border-base-200'}`}
                            >
                            <div className="card-body p-6">
                                <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h3 className="font-bold text-lg flex items-center gap-2">
                                                {channel.name} 
                                                <a href={channel.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="opacity-50 hover:opacity-100 text-accent"><ExternalLink size={14}/></a>
                                            </h3>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                <span className="badge badge-xs badge-accent badge-outline">{channel.type}</span>
                                                <span className="badge badge-xs badge-neutral">Paid Placement</span>
                                            </div>
                                        </div>
                                        <div className="radial-progress text-xs font-bold text-accent bg-base-100 border-4 border-base-100" style={{"--value":channel.matchScore, "--size": "3rem"} as any}>
                                            {channel.matchScore}
                                        </div>
                                </div>

                                <div className="stats stats-vertical lg:stats-horizontal shadow bg-base-200 my-4 w-full">
                                    <div className="stat p-2 place-items-center">
                                        <div className="stat-title text-[10px] uppercase">Min Budget</div>
                                        <div className="stat-value text-sm text-accent">{channel.minEntryCost || "N/A"}</div>
                                    </div>
                                    <div className="stat p-2 place-items-center">
                                        <div className="stat-title text-[10px] uppercase">Avg CPC</div>
                                        <div className="stat-value text-sm">{channel.avgCPC || "N/A"}</div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2 text-sm font-bold text-neutral mb-2">
                                    <Users size={16} /> 
                                    <span>Reach: {channel.audienceSize}</span>
                                </div>

                                <div className="alert bg-base-200 py-2 px-3 text-xs">
                                    <Trophy size={14} className="text-warning" />
                                    <span>"{channel.successCase}"</span>
                                </div>
                                
                                <div className="card-actions mt-2">
                                    <button className="btn btn-sm btn-block btn-outline btn-accent">View Ad Specs</button>
                                </div>
                            </div>
                            </div>
                        ))}
                    </div>
                 </div>
             )}
          </div>
      )}

      {/* Slide-over Panel */}
      {selectedChannel && (
          <div className="fixed inset-y-0 right-0 w-full md:w-[750px] bg-base-100 shadow-2xl z-50 transform transition-transform duration-300 animate-fade-in border-l border-base-200 flex flex-col">
              {/* Header */}
              <div className="p-4 border-b border-base-200 bg-base-100 flex justify-between items-center">
                  <div>
                      <h3 className="font-display font-bold text-xl">{selectedChannel.name}</h3>
                      <p className="text-xs opacity-60">{selectedChannel.url}</p>
                  </div>
                  <button onClick={() => setSelectedChannel(null)} className="btn btn-circle btn-ghost btn-sm"><X size={20} /></button>
              </div>

              {/* Tabs */}
              <div role="tablist" className="tabs tabs-bordered w-full bg-base-100">
                  <a role="tab" className={`tab ${viewMode === 'INTEL' ? 'tab-active' : ''}`} onClick={() => setViewMode('INTEL')}>
                      <Shield size={14} className="mr-2"/> Intel
                  </a>
                  <a role="tab" className={`tab ${viewMode === 'DRAFT' ? 'tab-active' : ''}`} onClick={() => setViewMode('DRAFT')}>
                      <PenTool size={14} className="mr-2"/> Drafter
                  </a>
                  <a role="tab" className={`tab ${viewMode === 'RADAR' ? 'tab-active' : ''}`} onClick={() => { setViewMode('RADAR'); if(opportunities.length === 0 && !scanningOpps) handleScanOpportunities(); }}>
                      <Radar size={14} className="mr-2"/> Active Radar
                  </a>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-base-100">
                  {viewMode === 'INTEL' && (
                     <>
                        {analyzing ? (
                           <div className="h-full flex flex-col items-center justify-center space-y-4">
                              <span className="loading loading-bars loading-lg text-secondary"></span>
                              <p className="opacity-60">Analyzing Channel Mechanics...</p>
                           </div>
                        ) : analysis ? (
                           <div className="space-y-8 animate-fade-in">
                              
                              {/* Verdict & Vibe */}
                              <div className="card bg-base-200 border-l-4 border-secondary shadow-sm">
                                 <div className="card-body p-4">
                                     <h3 className="font-bold flex items-center gap-2 uppercase text-xs tracking-wider opacity-60"><Activity size={14} /> Verdict</h3>
                                     <p className="text-lg font-display">"{analysis.verdict}"</p>
                                     <div className="flex gap-2 mt-2">
                                         <span className="badge badge-outline">{analysis.audienceVibe}</span>
                                         <span className={`badge ${analysis.moderationStrictness === 'Brutal' ? 'badge-error' : 'badge-success'} text-white`}>Mods: {analysis.moderationStrictness}</span>
                                     </div>
                                 </div>
                              </div>

                              {/* Platform Growth Benchmarks */}
                              {analysis.saasKpis && (
                                  <div>
                                      <h4 className="font-bold mb-4 flex items-center gap-2"><TrendingUp size={18} className="text-primary"/> Platform Benchmarks (Avg)</h4>
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                          {analysis.saasKpis.map((kpi, i) => (
                                              <div key={i} className="stat bg-white shadow border border-base-200 rounded-xl p-4">
                                                  <div className="stat-title text-xs font-bold opacity-70 whitespace-normal h-8">{kpi.label}</div>
                                                  <div className="stat-value text-xl md:text-2xl text-secondary my-1">{kpi.value}</div>
                                                  <div className="stat-desc flex items-center gap-1">
                                                      {kpi.trend === 'Up' ? <TrendingUp size={12} className="text-success"/> : kpi.trend === 'Down' ? <TrendingDown size={12} className="text-error"/> : <Minus size={12}/>}
                                                      {kpi.context}
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              )}

                              {/* Algorithm Secrets */}
                              {analysis.algorithmSecrets && (
                                  <div>
                                      <h4 className="font-bold mb-4 flex items-center gap-2"><Unlock size={18} className="text-accent"/> Algorithm Secrets</h4>
                                      <div className="space-y-3">
                                          {analysis.algorithmSecrets.map((secret, i) => (
                                              <div key={i} className="collapse collapse-arrow bg-base-200 border border-base-300">
                                                  <input type="radio" name="my-accordion-2" defaultChecked={i === 0} /> 
                                                  <div className="collapse-title text-sm font-medium flex items-center gap-2">
                                                      <Key size={14} className="text-warning"/> {secret.trigger}
                                                  </div>
                                                  <div className="collapse-content"> 
                                                      <p className="text-sm mb-2"><span className="font-bold">Tactic:</span> {secret.tactic}</p>
                                                      <div className="badge badge-accent badge-outline text-xs">Impact: {secret.impact}</div>
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              )}

                              {/* Content Hooks */}
                              {analysis.contentHooks && (
                                  <div className="card bg-white border border-base-200 shadow-sm">
                                      <div className="card-body p-4">
                                          <h4 className="font-bold mb-2 flex items-center gap-2"><Hash size={16}/> Viral Content Templates</h4>
                                          <ul className="steps steps-vertical">
                                              {analysis.contentHooks.map((hook, i) => (
                                                  <li key={i} className="step step-secondary">
                                                      <div className="text-left w-full pl-2">
                                                          <span className="font-mono text-sm block p-2 bg-base-200 rounded mt-1">"{hook}"</span>
                                                      </div>
                                                  </li>
                                              ))}
                                          </ul>
                                      </div>
                                  </div>
                              )}

                              <button onClick={handleGenerateContent} className="btn btn-secondary w-full text-white shadow-lg">Generate Optimized Post</button>
                           </div>
                        ) : null}
                     </>
                  )}

                  {viewMode === 'DRAFT' && (
                      <div className="h-full">
                         {generatingContent ? (
                            <div className="flex justify-center py-20"><span className="loading loading-dots loading-lg"></span></div>
                         ) : generatedContent ? (
                            <div className="space-y-4 animate-fade-in">
                               <div className="alert alert-warning text-xs">
                                   <Zap size={16}/>
                                   <div>
                                       <div className="font-bold">Tips</div>
                                       {generatedContent.postingTips?.map((tip, i) => <div key={i}>• {tip}</div>)}
                                   </div>
                               </div>
     
                               <div className="form-control">
                                   <label className="label cursor-pointer justify-between">
                                       <span className="label-text font-bold">Headline</span>
                                       <Copy size={14} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => copyToClipboard(generatedContent.subject, 'subject')}/>
                                   </label>
                                   <input readOnly value={generatedContent.subject} className="input input-bordered bg-base-100" />
                               </div>
     
                               <div className="form-control">
                                   <label className="label cursor-pointer justify-between">
                                       <span className="label-text font-bold">Body</span>
                                       <Copy size={14} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => copyToClipboard(generatedContent.body, 'body')}/>
                                   </label>
                                   <div className="p-4 bg-base-200 rounded-lg text-sm whitespace-pre-wrap font-mono">
                                       <ReactMarkdown>{generatedContent.body}</ReactMarkdown>
                                   </div>
                               </div>
                               
                               <a href={selectedChannel.url} target="_blank" rel="noreferrer" className="btn btn-neutral btn-block mt-4">Go to Channel <ChevronRight size={16} /></a>
                            </div>
                         ) : (
                            <div className="text-center py-20 opacity-50">
                               <FileText size={48} className="mx-auto mb-4"/>
                               <p>No content generated yet.</p>
                            </div>
                         )}
                      </div>
                  )}

                  {viewMode === 'RADAR' && (
                      <div className="h-full relative pb-20">
                          {scanningOpps ? (
                             <div className="flex justify-center py-20 flex-col items-center gap-4">
                                 <span className="loading loading-spinner loading-lg text-secondary"></span>
                                 <p className="text-sm opacity-60">Scanning for live opportunities...</p>
                             </div>
                          ) : (
                             <div className="space-y-4">
                                 <button onClick={handleScanOpportunities} className="btn btn-outline btn-secondary btn-sm w-full"><Radar size={14}/> Refresh Radar</button>

                                 {opportunities.map((opp, idx) => (
                                    <div key={idx} className="card bg-base-100 border border-base-200 shadow-sm">
                                        <div className="card-body p-4">
                                            <div className="flex justify-between items-start text-xs mb-2">
                                                <span className="badge badge-sm badge-success text-white">{opp.type}</span>
                                                <span className="text-xs opacity-50 font-mono">Score: {opp.relevanceScore}</span>
                                            </div>
                                            
                                            <h4 className="font-bold text-sm link link-hover" onClick={() => window.open(opp.url, '_blank')}>
                                                {opp.headline} <ExternalLink size={10} className="inline"/>
                                            </h4>
                                            
                                            <p className="text-xs opacity-70 line-clamp-3 my-2 italic">"{opp.context}"</p>
                                            
                                            <div className="card-actions justify-end items-center mt-2">
                                                <button onClick={() => handleGenerateReply(opp)} className="btn btn-xs btn-primary text-white">Reply Strategy</button>
                                            </div>
                                        </div>
                                    </div>
                                 ))}
                             </div>
                          )}

                          {/* Reply Generator Drawer */}
                          {generatingReply && (
                              <div className="absolute inset-0 bg-base-100/90 backdrop-blur z-10 flex items-center justify-center">
                                  <span className="loading loading-spinner loading-lg"></span>
                              </div>
                          )}

                          {replyDraft && (
                              <div className="absolute inset-0 bg-base-100 z-20 overflow-y-auto p-4 animate-fade-in shadow-xl">
                                  <div className="flex justify-between items-center mb-4">
                                      <h4 className="font-bold flex items-center gap-2"><Send size={16} className="text-success"/> Draft Reply</h4>
                                      <button onClick={() => setReplyDraft(null)} className="btn btn-ghost btn-sm btn-circle"><X size={16}/></button>
                                  </div>
                                  
                                  <div className="alert alert-success bg-success/10 text-xs mb-4">
                                      <Shield size={16}/> {replyDraft.safetyCheck}
                                  </div>

                                  <div className="form-control">
                                      <textarea readOnly value={replyDraft.text} className="textarea textarea-bordered h-40 text-sm mb-4"></textarea>
                                      <button onClick={() => copyToClipboard(replyDraft.text, 'reply')} className="btn btn-primary w-full text-white">Copy Reply</button>
                                  </div>
                                  
                                  <div className="bg-base-200 p-3 rounded mt-4 text-xs italic">
                                      <span className="font-bold block not-italic">Strategy:</span> {replyDraft.explanation}
                                  </div>
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      )}
      
      {selectedChannel && <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setSelectedChannel(null)}></div>}
    </div>
  );
};