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
  const [deepDiveError, setDeepDiveError] = useState<string | null>(null);

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
    setDeepDiveError(null);
    setDeepDiveLoading(true);
    try {
      const data = await analyzeCompetitorStrategy(competitor.name, competitor.url);
      setDeepDiveData(data);
    } catch (e: any) {
      console.error(e);
      setDeepDiveError(e?.message || 'Deep dive failed. Check the console for details.');
    } finally {
      setDeepDiveLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-20">
      {/* Page title is provided by the shared glass header in App. */}

      {/* Pre-filled scan card (from project context) — app-style, matches
           Account Finder + Posts Tracker. */}
      {!showEdit && project ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
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
          <button
            onClick={handleScan}
            disabled={loading || !description}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 transition-all duration-200 ease-out active:scale-[0.98]"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {loading ? 'Scanning…' : 'Scan competitors'}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <label className="text-[10px] font-black tracking-widest uppercase text-gray-500 block mb-2">Override description (this scan only)</label>
          <div className="flex gap-2">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your product…"
              className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 focus:border-gray-400 text-sm outline-none"
            />
            <button
              onClick={handleScan}
              disabled={loading || !description}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold disabled:bg-gray-200 disabled:text-gray-400 transition-all duration-200 ease-out active:scale-[0.98]"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Scan
            </button>
          </div>
          {project && (
            <button
              onClick={() => { setDescription(project.pitch); setShowEdit(false); }}
              className="text-[10px] font-bold tracking-widest uppercase text-gray-400 hover:text-gray-700 mt-3 flex items-center gap-1"
            >
              ← Use project description
            </button>
          )}
        </div>
      )}

      {/* Competitor Grid */}
      {competitors.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {competitors.map((comp, idx) => {
                const threatStyle =
                  comp.threatLevel === 'High'   ? 'text-rose-700 bg-rose-50 border-rose-200' :
                  comp.threatLevel === 'Medium' ? 'text-amber-700 bg-amber-50 border-amber-200' :
                                                  'text-gray-600 bg-gray-100 border-gray-200';
                const selected = selectedCompetitor?.name === comp.name;
                return (
                <div
                  key={idx}
                  onClick={() => handleDeepDive(comp)}
                  className={`bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col ${
                    selected ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${threatStyle}`}>
                      {comp.threatLevel} Threat
                    </span>
                    <span className="text-[11px] font-mono text-gray-400">{comp.similarityScore}% Match</span>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-gray-900 leading-tight">{comp.name}</h3>
                  <a href={comp.url} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer"
                     className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 mt-1">
                    {(() => { try { return new URL(comp.url).hostname; } catch { return comp.url; } })()}
                    <ExternalLink size={10} />
                  </a>
                  <p className="text-sm text-gray-600 mt-3 mb-4 line-clamp-3 leading-relaxed min-h-[3.75rem]">{comp.tagline}</p>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden mb-4">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, comp.similarityScore)}%` }} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeepDive(comp); }}
                    className="mt-auto w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-indigo-400 text-indigo-700 hover:text-indigo-800 text-xs font-bold transition-colors bg-white"
                  >
                    <Zap size={13} /> Analyze strategy
                  </button>
                </div>
                );
             })}
          </div>
      )}

      {/* Deep Dive Panel (Drawer style overlay) */}
      {selectedCompetitor && (
          <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedCompetitor(null)} />
          <div className="fixed inset-y-0 right-0 w-full md:w-[720px] glass-panel z-50 shadow-2xl transform transition-transform duration-300 animate-fade-in flex flex-col">
              {/* Header */}
              <div className="p-6 border-b border-gray-200/60 flex justify-between items-start">
                  <div>
                      <span className="inline-block text-[10px] font-black uppercase tracking-widest text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-md mb-2">Target Acquired</span>
                      <h3 className="text-3xl font-display font-bold text-gray-900 flex items-center gap-2">
                        {selectedCompetitor.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">Forensic Marketing Analysis</p>
                  </div>
                  <button onClick={() => setSelectedCompetitor(null)} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors" aria-label="Close">
                     <X size={20} />
                  </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                 {deepDiveLoading ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                       <Loader2 size={32} className="text-indigo-500 animate-spin" />
                       <div>
                          <h4 className="text-base font-semibold text-gray-900">Decoding strategy…</h4>
                          <p className="text-sm text-gray-500 mt-1">Extracting timelines, KPIs and tech stack.</p>
                       </div>
                    </div>
                 ) : deepDiveError ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-6">
                       <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center">
                          <AlertTriangle size={26} className="text-rose-500" />
                       </div>
                       <div>
                          <h4 className="text-base font-semibold text-gray-900">Deep dive failed</h4>
                          <p className="text-sm text-gray-500 mt-1 max-w-md">{deepDiveError}</p>
                          <p className="text-[12px] text-gray-400 mt-3">Most common cause: missing or invalid Gemini API key. Open the browser console for the full error.</p>
                       </div>
                       <button
                          onClick={() => handleDeepDive(selectedCompetitor)}
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-900 hover:bg-gray-800 text-white transition-colors">
                          Try again
                       </button>
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
          </>
      )}

    </div>
  );
};