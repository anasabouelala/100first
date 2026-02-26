import React, { useState } from 'react';
import { generateColdOutreach, generateLeadDorks } from '../services/geminiService';
import { OutreachResponse, SearchDork } from '../types';
import { Mail, UserPlus, Send, Copy, Check, Sparkles, User, Loader2, Search, ExternalLink } from 'lucide-react';

export const OutreachView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'WRITER' | 'HUNTER'>('WRITER');
  
  // Writer State
  const [prospectInfo, setProspectInfo] = useState('');
  const [appContext, setAppContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OutreachResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Hunter State
  const [targetPersona, setTargetPersona] = useState('');
  const [platform, setPlatform] = useState('linkedin.com');
  const [dorks, setDorks] = useState<SearchDork[]>([]);
  const [loadingDorks, setLoadingDorks] = useState(false);

  const handleGenerate = async () => {
    if (!prospectInfo || !appContext) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await generateColdOutreach(prospectInfo, appContext);
      setResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateDorks = async () => {
      if (!targetPersona) return;
      setLoadingDorks(true);
      try {
          const data = await generateLeadDorks(targetPersona, platform);
          setDorks(data);
      } catch(e) { console.error(e); }
      finally { setLoadingDorks(false); }
  }

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-20">
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-base-300 pb-4">
        <div>
           <h2 className="text-3xl font-display font-bold">Direct <span className="text-primary">Outreach</span></h2>
           <p className="text-sm opacity-70 mt-1">Generate hyper-personalized icebreakers for high-value prospects.</p>
        </div>
        <div className="tabs tabs-boxed bg-base-100">
            <a className={`tab ${activeTab === 'WRITER' ? 'tab-active' : ''}`} onClick={() => setActiveTab('WRITER')}>Message Writer</a>
            <a className={`tab ${activeTab === 'HUNTER' ? 'tab-active' : ''}`} onClick={() => setActiveTab('HUNTER')}>Lead Hunter</a>
        </div>
      </div>

      {activeTab === 'WRITER' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
            {/* Input Column */}
            <div className="lg:col-span-1 space-y-6">
            <div className="card bg-base-100 shadow-md">
                <div className="card-body">
                    <h3 className="card-title text-base flex items-center gap-2">
                        <User size={18} className="text-primary" /> Prospect Intel
                    </h3>
                    
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text text-xs uppercase font-bold opacity-60">Paste Bio / Tweet</span></label>
                        <textarea 
                        value={prospectInfo}
                        onChange={(e) => setProspectInfo(e.target.value)}
                        placeholder="e.g. 'SaaS Founder | Building in public'"
                        className="textarea textarea-bordered h-32 text-sm"
                        />
                    </div>
                    
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text text-xs uppercase font-bold opacity-60">Your Pitch</span></label>
                        <textarea 
                        value={appContext}
                        onChange={(e) => setAppContext(e.target.value)}
                        placeholder="e.g. A task manager for founders."
                        className="textarea textarea-bordered h-24 text-sm"
                        />
                    </div>

                    <button 
                    onClick={handleGenerate}
                    disabled={loading || !prospectInfo || !appContext}
                    className="btn btn-primary w-full mt-2 text-white"
                    >
                    {loading ? <span className="loading loading-spinner"></span> : <Sparkles size={18} />}
                    Generate
                    </button>
                </div>
            </div>

            {result && (
                <div className="card bg-base-100 border border-base-200">
                    <div className="card-body p-4">
                        <h4 className="text-xs font-bold opacity-60 uppercase mb-2">Analysis</h4>
                        <p className="text-sm italic opacity-80">"{result.prospectAnalysis}"</p>
                    </div>
                </div>
            )}
            </div>

            {/* Output Column */}
            <div className="lg:col-span-2 space-y-6">
            {!result && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30 border-2 border-dashed border-base-300 rounded-xl p-12 min-h-[400px]">
                    <Mail size={64} className="mb-4" />
                    <h3 className="text-xl font-bold">No Messages Generated</h3>
                    <p>Input prospect data to craft the perfect DM.</p>
                </div>
            )}

            {loading && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 min-h-[400px]">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="opacity-60 animate-pulse">Analyzing prospect psychology...</p>
                </div>
            )}

            {result && (
                <div className="grid gap-6">
                    {result.messages.map((msg, idx) => (
                        <div key={idx} className="card bg-base-100 shadow-md border border-base-200">
                        <div className="card-body p-6">
                            <div className="flex justify-between items-start mb-4">
                                <div className="badge badge-primary badge-outline">{msg.angle}</div>
                                <button 
                                    onClick={() => copyToClipboard(msg.body, idx)}
                                    className="btn btn-ghost btn-sm btn-square"
                                >
                                    {copiedIndex === idx ? <Check size={18} className="text-success" /> : <Copy size={18} />}
                                </button>
                            </div>

                            {msg.subject && (
                                <div className="mb-3 pb-3 border-b border-base-200">
                                    <span className="text-xs uppercase font-bold opacity-50 block mb-1">Subject</span>
                                    <p className="font-bold text-sm text-slate-800">{msg.subject}</p>
                                </div>
                            )}

                            <div className="bg-base-200 p-4 rounded-lg mb-4">
                                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{msg.body}</pre>
                            </div>

                            <div className="flex gap-2 items-center text-xs opacity-70 bg-base-200/50 p-2 rounded">
                                <Sparkles size={12} className="text-warning" />
                                <span>{msg.whyItWorks}</span>
                            </div>
                        </div>
                        </div>
                    ))}
                </div>
            )}
            </div>
        </div>
      )}

      {activeTab === 'HUNTER' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in">
              <div className="card bg-base-100 shadow-md">
                  <div className="card-body">
                      <div className="flex items-center gap-2 mb-4">
                          <Search size={24} className="text-secondary"/>
                          <h3 className="card-title">Search String Generator</h3>
                      </div>
                      <p className="text-sm opacity-70 mb-4">Don't have 100 prospects yet? Use "Google Dorks" (Boolean Search) to find them instantly on specific platforms.</p>

                      <div className="form-control">
                          <label className="label"><span className="label-text font-bold">Who are you looking for?</span></label>
                          <input 
                            value={targetPersona}
                            onChange={(e) => setTargetPersona(e.target.value)}
                            placeholder="e.g. Marketing Agency Owners complaining about ads"
                            className="input input-bordered"
                          />
                      </div>
                      
                      <div className="form-control">
                          <label className="label"><span className="label-text font-bold">Platform</span></label>
                          <select className="select select-bordered" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                              <option value="linkedin.com">LinkedIn</option>
                              <option value="twitter.com">Twitter / X</option>
                              <option value="reddit.com">Reddit</option>
                              <option value="facebook.com">Facebook Groups</option>
                          </select>
                      </div>

                      <div className="card-actions justify-end mt-4">
                          <button 
                            onClick={handleGenerateDorks} 
                            disabled={loadingDorks || !targetPersona}
                            className="btn btn-secondary text-white w-full"
                          >
                              {loadingDorks ? <span className="loading loading-spinner"></span> : <Search size={18}/>}
                              Generate Search Dorks
                          </button>
                      </div>
                  </div>
              </div>

              <div className="space-y-4">
                  {dorks.length > 0 ? (
                      dorks.map((dork, idx) => (
                          <div key={idx} className="card bg-white border border-base-200 shadow-sm hover:border-secondary transition-colors">
                              <div className="card-body p-4">
                                  <div className="badge badge-outline badge-sm mb-2">{dork.label}</div>
                                  <div className="bg-base-200 p-3 rounded font-mono text-xs break-all border border-base-300">
                                      {dork.query}
                                  </div>
                                  <p className="text-xs opacity-60 mt-2 italic">{dork.explanation}</p>
                                  <div className="card-actions justify-end mt-2">
                                      <a 
                                        href={`https://www.google.com/search?q=${encodeURIComponent(dork.query)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="btn btn-sm btn-primary text-white"
                                      >
                                          Execute Search <ExternalLink size={12}/>
                                      </a>
                                  </div>
                              </div>
                          </div>
                      ))
                  ) : (
                      <div className="h-full flex items-center justify-center opacity-30 border-2 border-dashed border-base-300 rounded-xl">
                          <div className="text-center">
                              <Search size={48} className="mx-auto mb-2"/>
                              <p>Search strings will appear here</p>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
};