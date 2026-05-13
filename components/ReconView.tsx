import React, { useState, useEffect } from 'react';
import { findCompetitors, analyzeCompetitorStrategy } from '../services/geminiService';
import { CompetitorData, CompetitorDeepDive } from '../types';
import { useProject } from '../contexts/ProjectContext';
import { Search, Globe, Loader2, Target, BarChart2, Zap, AlertTriangle, Users, TrendingUp, X, ExternalLink, Youtube, Quote, Code, DollarSign, PlayCircle, MessageCircle, Mic2, Brain, Edit2 } from 'lucide-react';

export const ReconView: React.FC = () => {
  const { project } = useProject();
  const [description, setDescription] = useState(project?.pitch || '');
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    if (project?.pitch) setDescription(project.pitch);
  }, [project?.pitch]);
  const [loading, setLoading] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorData[]>([]);
  
  // Deep Dive State
  const [selectedCompetitor, setSelectedCompetitor] = useState<CompetitorData | null>(null);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveData, setDeepDiveData] = useState<CompetitorDeepDive | null>(null);

  const handleScan = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setCompetitors([]);
    setSelectedCompetitor(null);
    try {
      const data = await findCompetitors(description);
      setCompetitors(data.sort((a, b) => b.similarityScore - a.similarityScore));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeepDive = async (competitor: CompetitorData) => {
    setSelectedCompetitor(competitor);
    setDeepDiveData(null);
    setDeepDiveLoading(true);
    try {
      const data = await analyzeCompetitorStrategy(competitor.name, competitor.url);
      setDeepDiveData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setDeepDiveLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-20">
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-base-300 pb-4">
        <div>
           <h2 className="text-3xl font-display font-bold">Competitor <span className="text-primary">Analysis</span></h2>
           <p className="text-sm opacity-70 mt-1">Identify competitors and reverse engineer their launch strategies.</p>
        </div>
      </div>

      {/* Pre-filled scan card (from project context) */}
      {!showEdit && project ? (
        <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <Target size={16} className="text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black tracking-widest uppercase text-emerald-600 mb-0.5">Pre-filled from project</div>
                <div className="text-sm text-gray-700 line-clamp-2 leading-snug">{description}</div>
              </div>
            </div>
            <button onClick={() => setShowEdit(true)} className="text-[10px] font-bold tracking-widest uppercase text-gray-400 hover:text-gray-700 flex-shrink-0 flex items-center gap-1">
              <Edit2 size={11} /> Override
            </button>
          </div>
          <button onClick={handleScan} disabled={loading || !description}
            className="btn btn-primary w-full text-white gap-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            {loading ? 'Scanning…' : 'Scan competitors'}
          </button>
        </div>
      ) : (
        <div className="card bg-base-100 shadow-md">
          <div className="card-body">
            <div className="form-control">
              <label className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1.5">Override description (this scan only)</label>
              <div className="join w-full">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your product..."
                  className="input input-bordered input-primary join-item w-full" />
                <button onClick={handleScan} disabled={loading || !description}
                  className="btn btn-primary join-item text-white">
                  {loading ? <span className="loading loading-spinner"></span> : <Search size={18} />}
                  Scan
                </button>
              </div>
              {project && (
                <button onClick={() => { setDescription(project.pitch); setShowEdit(false); }}
                  className="text-[10px] font-bold tracking-widest uppercase text-gray-400 hover:text-gray-700 mt-2 self-start">
                  ← Use project description
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Competitor Grid */}
      {competitors.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {competitors.map((comp, idx) => (
                <div 
                  key={idx} 
                  className={`card bg-base-100 shadow-md hover:shadow-xl transition-all cursor-pointer border ${selectedCompetitor?.name === comp.name ? 'border-primary ring-1 ring-primary' : 'border-base-200'}`}
                  onClick={() => handleDeepDive(comp)}
                >
                   <div className="card-body p-6">
                       <div className="flex justify-between items-start">
                          <div className={`badge ${
                              comp.threatLevel === 'High' ? 'badge-error' : 
                              comp.threatLevel === 'Medium' ? 'badge-warning' :
                              'badge-ghost'
                          } badge-outline font-bold`}>
                              {comp.threatLevel} Threat
                          </div>
                          <span className="text-xs font-mono opacity-50">{comp.similarityScore}% Match</span>
                       </div>

                       <h3 className="card-title text-xl mt-2">{comp.name}</h3>
                       <a href={comp.url} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer" className="link link-hover text-xs opacity-60 flex items-center gap-1">
                          {new URL(comp.url).hostname} <ExternalLink size={10} />
                       </a>

                       <p className="text-sm opacity-80 py-2 h-16">{comp.tagline}</p>

                       <progress className="progress progress-primary w-full" value={comp.similarityScore} max="100"></progress>

                       <div className="card-actions mt-4">
                           <button className="btn btn-sm btn-outline btn-primary w-full gap-2">
                               <Zap size={14} /> Analyze Strategy
                           </button>
                       </div>
                   </div>
                </div>
             ))}
          </div>
      )}

      {/* Deep Dive Panel (Drawer style overlay) */}
      {selectedCompetitor && (
          <div className="fixed inset-y-0 right-0 w-full md:w-[700px] bg-base-100 shadow-2xl z-50 transform transition-transform duration-300 animate-fade-in border-l border-base-200 flex flex-col">
              {/* Header */}
              <div className="p-6 border-b border-base-200 bg-base-100 flex justify-between items-start">
                  <div>
                      <div className="badge badge-primary badge-outline mb-2">Target Acquired</div>
                      <h3 className="text-3xl font-display font-bold flex items-center gap-2">
                        {selectedCompetitor.name}
                      </h3>
                      <p className="text-sm opacity-60 mt-1">Forensic Marketing Analysis</p>
                  </div>
                  <button onClick={() => setSelectedCompetitor(null)} className="btn btn-circle btn-ghost">
                     <X size={24} />
                  </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                 {deepDiveLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                       <span className="loading loading-ring loading-lg text-primary"></span>
                       <div>
                          <h4 className="text-lg font-bold">Decoding Strategy...</h4>
                          <p className="text-sm opacity-60">Extracting timelines, KPIs, and tech stack.</p>
                       </div>
                    </div>
                 ) : deepDiveData ? (
                    <div className="space-y-8">
                        
                        {/* Executive Summary */}
                        <div className="card bg-base-200 border-l-4 border-primary rounded-r-xl">
                           <div className="card-body p-5">
                               <h4 className="text-xs font-bold uppercase tracking-wider opacity-60 flex items-center gap-2">
                                   <Users size={14} /> Positioning
                               </h4>
                               <p className="text-lg leading-relaxed">"{deepDiveData.summary}"</p>
                               
                               <div className="mt-4 flex flex-wrap gap-2">
                                  {deepDiveData.marketingHooks.map((hook, i) => (
                                      <div key={i} className="badge badge-secondary badge-outline bg-white">{hook}</div>
                                  ))}
                               </div>
                           </div>
                        </div>

                        {/* Tech & Pricing */}
                        <div className="grid grid-cols-2 gap-4">
                           <div className="card bg-base-200 compact border border-base-300">
                               <div className="card-body">
                                   <h5 className="flex items-center gap-2 text-xs font-bold opacity-60 uppercase"><Code size={14}/> Stack</h5>
                                   <div className="flex flex-wrap gap-1">
                                       {deepDiveData.techStack?.length ? deepDiveData.techStack.map((tech, i) => (
                                          <span key={i} className="badge badge-ghost badge-sm bg-white">{tech}</span>
                                       )) : <span className="text-xs opacity-50">Unknown</span>}
                                   </div>
                               </div>
                           </div>
                           <div className="card bg-base-200 compact border border-base-300">
                               <div className="card-body">
                                   <h5 className="flex items-center gap-2 text-xs font-bold opacity-60 uppercase"><DollarSign size={14}/> Pricing</h5>
                                   <div className="font-bold text-sm">{deepDiveData.pricingModel || "Unknown"}</div>
                               </div>
                           </div>
                        </div>

                         {/* Behavioral Analysis */}
                         {deepDiveData.communityBehaviors?.length > 0 && (
                            <div>
                                <h4 className="font-bold text-lg mb-4 flex items-center gap-2"><Brain size={18} className="text-accent" /> Community Behavior</h4>
                                <div className="space-y-3">
                                    {deepDiveData.communityBehaviors.map((behavior, i) => (
                                        <div key={i} className="alert bg-base-100 border border-base-200 shadow-sm items-start">
                                            <div className="w-full">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="badge badge-neutral">{behavior.platform}</span>
                                                    <span className="text-xs font-bold text-accent uppercase flex items-center gap-1">
                                                        <Mic2 size={12} /> {behavior.persona}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-4 my-3 text-xs">
                                                    <div>
                                                        <span className="block opacity-50 font-bold">Frequency</span>
                                                        {behavior.actionFrequency}
                                                    </div>
                                                    <div>
                                                        <span className="block opacity-50 font-bold">KPIs</span>
                                                        {behavior.engagementMetrics}
                                                    </div>
                                                </div>
                                                <div className="text-xs italic bg-base-200 p-2 rounded">"{behavior.keyTactic}"</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}


                        {/* Timeline */}
                        <div>
                           <h4 className="font-bold text-lg mb-4 flex items-center gap-2"><TrendingUp size={18} className="text-warning" /> "First 100" Blueprint</h4>
                           <ul className="steps steps-vertical w-full">
                               {deepDiveData.first100UsersStrategy.map((event, i) => (
                                   <li key={i} className="step step-primary">
                                       <div className="text-left w-full pl-4 pb-6">
                                           <span className="text-xs font-mono opacity-50">{event.timeframe}</span>
                                           <h5 className="font-bold text-md text-slate-800">{event.action}</h5>
                                           <div className="bg-base-200 p-3 rounded-lg mt-2 text-sm border border-base-300">
                                                <div className="flex items-center gap-2 text-success font-bold mb-1">
                                                    <BarChart2 size={14} /> {event.result}
                                                </div>
                                                {event.details && <p className="opacity-80 text-xs leading-relaxed">{event.details}</p>}
                                           </div>
                                       </div>
                                   </li>
                               ))}
                           </ul>
                        </div>

                        {/* Traffic Sources Table */}
                        <div className="overflow-x-auto border border-base-200 rounded-xl">
                            <table className="table bg-white">
                                <thead className="bg-base-200">
                                    <tr>
                                        <th>Channel</th>
                                        <th>Metric</th>
                                        <th>Sentiment</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {deepDiveData.trafficSources.map((source, i) => (
                                        <tr key={i}>
                                            <td className="font-bold">{source.name}</td>
                                            <td className="text-primary font-mono text-xs">{source.kpi}</td>
                                            <td>
                                                <div className={`badge badge-sm ${source.sentiment === 'Positive' ? 'badge-success' : 'badge-ghost'}`}>
                                                    {source.sentiment}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Weakness */}
                        <div className="alert alert-error bg-error/10 text-error-content">
                           <AlertTriangle size={24} />
                           <div>
                               <h3 className="font-bold">Attack Vector</h3>
                               <div className="text-sm">User complaint: <span className="font-bold">"{deepDiveData.weakness}"</span>. Position against this.</div>
                           </div>
                        </div>

                    </div>
                 ) : null}
              </div>
          </div>
      )}

      {/* Backdrop */}
      {selectedCompetitor && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden" onClick={() => setSelectedCompetitor(null)}></div>
      )}

    </div>
  );
};