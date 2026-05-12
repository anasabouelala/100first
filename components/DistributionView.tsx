import React, { useState, useEffect, useMemo } from 'react';
import { findDistributionChannels, generateChannelContent, analyzeChannel, findChannelOpportunities, generateOpportunityReply, getIndustryBenchmarks, isGeminiConfigured } from '../services/geminiService';
import { DistributionChannel, GeneratedContent, ChannelAnalysis, MarketOpportunity, ReplyDraft, IndustryBenchmark } from '../types';
import {
  Search, Loader2, Copy, Check, Zap, X, Users, Activity, DollarSign, Trophy, Shield,
  FileText, PenTool, Radar, Send, ExternalLink, TrendingUp, TrendingDown, Minus, Unlock,
  Key, Rocket, Edit2, ArrowRight, ArrowUpRight, Sparkles, Filter, ChevronDown, Clock,
  CheckCircle2, Circle, Hourglass, XCircle, Globe2, Target, ListChecks, AlertTriangle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type ChannelStatus = 'untouched' | 'preparing' | 'submitted' | 'live' | 'rejected';
const STATUS_KEY = 'distribution_channel_status_v1';

const STATUS_META: Record<ChannelStatus, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  untouched:  { label: 'To do',     icon: <Circle size={12} />,        color: 'text-slate-400', bg: 'bg-slate-100' },
  preparing:  { label: 'Preparing', icon: <Hourglass size={12} />,     color: 'text-amber-600', bg: 'bg-amber-50' },
  submitted:  { label: 'Submitted', icon: <Clock size={12} />,         color: 'text-blue-600',  bg: 'bg-blue-50' },
  live:       { label: 'Live',      icon: <CheckCircle2 size={12} />,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
  rejected:   { label: 'Rejected',  icon: <XCircle size={12} />,       color: 'text-rose-600',  bg: 'bg-rose-50' },
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  Launchpad: <Rocket size={14} />,
  Directory: <Globe2 size={14} />,
  Subreddit: <Users size={14} />,
  Newsletter: <Send size={14} />,
  Discord: <Users size={14} />,
  Slack: <Users size={14} />,
  Forum: <Users size={14} />,
};

const FILTER_TABS = [
  { id: 'all',       label: 'All',         icon: <Sparkles size={14} /> },
  { id: 'launchpad', label: 'Launchpads',  icon: <Rocket size={14} /> },
  { id: 'organic',   label: 'Organic',     icon: <Users size={14} /> },
  { id: 'paid',      label: 'Paid',        icon: <DollarSign size={14} /> },
] as const;

type FilterTab = typeof FILTER_TABS[number]['id'];

export const DistributionView: React.FC = () => {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [appName, setAppName] = useState('');
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<DistributionChannel[]>([]);
  const [formCollapsed, setFormCollapsed] = useState(false);

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

  // Filter & Status
  const [filter, setFilter] = useState<FilterTab>('all');
  const [scanError, setScanError] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatus>>(() => {
    try { return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}'); }
    catch { return {}; }
  });
  const apiConfigured = isGeminiConfigured();

  useEffect(() => {
    localStorage.setItem(STATUS_KEY, JSON.stringify(statusMap));
  }, [statusMap]);

  const setChannelStatus = (channelName: string, status: ChannelStatus) => {
    setStatusMap(prev => ({ ...prev, [channelName]: status }));
  };
  const getStatus = (channelName: string): ChannelStatus => statusMap[channelName] || 'untouched';

  const handleScan = async () => {
    if (!description || !category) return;
    setLoading(true);
    setScanError(null);
    setChannels([]);
    setSelectedChannel(null);
    setAnalysis(null);
    setGeneratedContent(null);
    setBenchmarks([]);

    let channelsErr: any = null;

    const benchmarksPromise = (async () => {
      setLoadingBenchmarks(true);
      try { setBenchmarks(await getIndustryBenchmarks(category)); }
      catch (e) { console.error('Benchmarks failed:', e); }
      finally { setLoadingBenchmarks(false); }
    })();

    const channelsPromise = (async () => {
      try {
        const results = await findDistributionChannels(description, category);
        setChannels(results.sort((a, b) => b.matchScore - a.matchScore));
        setFormCollapsed(true);
      } catch (e: any) {
        console.error('Channels failed:', e);
        channelsErr = e;
      }
    })();

    await Promise.all([benchmarksPromise, channelsPromise]);
    if (channelsErr) {
      setScanError(channelsErr?.message || 'Could not fetch channels. Check the browser console.');
    }
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
    try { setAnalysis(await analyzeChannel(channel.name, channel.url, description)); }
    catch (e) { console.error(e); }
    finally { setAnalyzing(false); }
  };

  const handleGenerateContent = async () => {
    if (!selectedChannel) return;
    setViewMode('DRAFT');
    if (!generatedContent) {
      setGeneratingContent(true);
      try {
        const content = await generateChannelContent(selectedChannel, appName || "My App", description);
        setGeneratedContent(content);
      } catch (e) { console.error(e); }
      finally { setGeneratingContent(false); }
    }
  };

  const handleScanOpportunities = async () => {
    if (!selectedChannel) return;
    setScanningOpps(true);
    setOpportunities([]);
    setSelectedOpp(null);
    setReplyDraft(null);
    try { setOpportunities(await findChannelOpportunities(selectedChannel, description)); }
    catch (e) { console.error(e); }
    finally { setScanningOpps(false); }
  };

  const handleGenerateReply = async (opp: MarketOpportunity) => {
    if (!selectedChannel || !analysis) return;
    setSelectedOpp(opp);
    setGeneratingReply(true);
    setReplyDraft(null);
    try {
      const draft = await generateOpportunityReply(opp, selectedChannel.name, description, analysis.rules);
      setReplyDraft(draft);
    } catch (e) { console.error(e); }
    finally { setGeneratingReply(false); }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Derived state
  const heroChannel = channels[0];
  const restChannels = channels.slice(1);

  const filteredChannels = useMemo(() => {
    if (filter === 'all') return restChannels;
    return restChannels.filter(c => {
      if (filter === 'launchpad') return c.type === 'Launchpad' || c.type === 'Directory';
      if (filter === 'paid') return c.category === 'Ads';
      if (filter === 'organic') return c.category !== 'Ads' && c.type !== 'Launchpad' && c.type !== 'Directory';
      return true;
    });
  }, [restChannels, filter]);

  const tracked = Object.entries(statusMap).filter(([_, s]) => s !== 'untouched').length;

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in">
      {/* === HEADER === */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400 font-bold mb-2">Growth Ops</div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-slate-900">
            Distribution Lab
          </h1>
          <p className="text-sm text-slate-500 mt-2">Find, analyze, and execute on the highest-converting channels.</p>
        </div>
        {channels.length > 0 && (
          <div className="hidden md:flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-display font-bold text-slate-900">{channels.length}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Channels</div>
            </div>
            <div className="h-10 w-px bg-slate-200"></div>
            <div className="text-right">
              <div className="text-2xl font-display font-bold text-emerald-600">{tracked}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">In flight</div>
            </div>
          </div>
        )}
      </div>

      {/* === API KEY WARNING === */}
      {!apiConfigured && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold text-sm text-amber-900">Gemini API key not set</div>
            <div className="text-xs text-amber-800 mt-1 leading-relaxed">
              The channel finder uses Google's Gemini AI. Add <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-[11px]">VITE_GEMINI_API_KEY</code> to your <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-[11px]">.env</code> file (get one at{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline font-bold">aistudio.google.com/app/apikey</a>) and restart the dev server.
            </div>
          </div>
        </div>
      )}

      {/* === SCAN INPUT === */}
      <ScanCard
        appName={appName} setAppName={setAppName}
        category={category} setCategory={setCategory}
        description={description} setDescription={setDescription}
        loading={loading} onScan={handleScan}
        collapsed={formCollapsed} setCollapsed={setFormCollapsed}
        hasResults={channels.length > 0}
      />

      {/* === SCAN ERROR === */}
      {scanError && !loading && (
        <div className="mt-4 p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
          <X size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-rose-900">Search failed</div>
            <div className="text-xs text-rose-800 mt-1 leading-relaxed break-words">{scanError}</div>
          </div>
          <button onClick={() => setScanError(null)} className="text-rose-400 hover:text-rose-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* === LOADING STATE === */}
      {loading && channels.length === 0 && (
        <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map(i => <SkeletonCard key={i} large={i === 0} />)}
        </div>
      )}

      {/* === HERO RECOMMENDATION === */}
      {heroChannel && (
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-px bg-gradient-to-r from-indigo-500 to-transparent"></div>
            <span className="text-[11px] font-black tracking-[0.3em] uppercase text-indigo-600">Top Match</span>
          </div>
          <HeroCard
            channel={heroChannel}
            status={getStatus(heroChannel.name)}
            onSelect={() => handleChannelSelect(heroChannel)}
            onStatusChange={(s) => setChannelStatus(heroChannel.name, s)}
            isSelected={selectedChannel?.name === heroChannel.name}
          />
        </div>
      )}

      {/* === MARKET PULSE STRIP === */}
      {benchmarks.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-slate-400" />
            <span className="text-[11px] font-black tracking-[0.3em] uppercase text-slate-500">Market Pulse · {category}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-slate-200 rounded-2xl overflow-hidden border border-slate-200">
            {benchmarks.map((b, i) => (
              <div key={i} className="bg-white p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold leading-tight h-7">{b.metric}</div>
                <div className="text-xl font-display font-bold text-slate-900 mt-1">{b.avgValue}</div>
                <div className="text-[10px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
                  <TrendingUp size={10} /> Top 10%: {b.top10Value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === CHANNEL GRID === */}
      {restChannels.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6 sticky top-0 bg-base-200 z-20 py-3 -mx-2 px-2 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-[0.2em] uppercase text-slate-500">More Channels</span>
              <span className="text-xs text-slate-400">· {filteredChannels.length}</span>
            </div>
            <div className="flex gap-1 p-1 bg-white rounded-xl border border-slate-200">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    filter === tab.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredChannels.map((channel, idx) => (
              <ChannelCard
                key={channel.name + idx}
                channel={channel}
                status={getStatus(channel.name)}
                isSelected={selectedChannel?.name === channel.name}
                onSelect={() => handleChannelSelect(channel)}
                onStatusChange={(s) => setChannelStatus(channel.name, s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* === EMPTY STATE === */}
      {!loading && channels.length === 0 && (
        <div className="mt-16 text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-2xl flex items-center justify-center">
            <Target size={28} className="text-slate-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Ready when you are</h3>
          <p className="text-sm text-slate-500">Fill in your product details above to discover your best-fit channels.</p>
        </div>
      )}

      {/* === SLIDE-OVER PANEL === */}
      {selectedChannel && (
        <SlideOverPanel
          channel={selectedChannel}
          analyzing={analyzing}
          analysis={analysis}
          generatingContent={generatingContent}
          generatedContent={generatedContent}
          scanningOpps={scanningOpps}
          opportunities={opportunities}
          generatingReply={generatingReply}
          replyDraft={replyDraft}
          viewMode={viewMode}
          setViewMode={(m) => { setViewMode(m); if (m === 'RADAR' && opportunities.length === 0 && !scanningOpps) handleScanOpportunities(); }}
          onClose={() => setSelectedChannel(null)}
          onGenerateContent={handleGenerateContent}
          onScanOpps={handleScanOpportunities}
          onGenerateReply={handleGenerateReply}
          onCloseReply={() => setReplyDraft(null)}
          copiedField={copiedField}
          copyToClipboard={copyToClipboard}
          status={getStatus(selectedChannel.name)}
          onStatusChange={(s) => setChannelStatus(selectedChannel.name, s)}
        />
      )}

      {selectedChannel && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40" onClick={() => setSelectedChannel(null)}></div>
      )}
    </div>
  );
};

// ============================================================
// SCAN CARD (collapses after first scan)
// ============================================================
const ScanCard: React.FC<{
  appName: string; setAppName: (v: string) => void;
  category: string; setCategory: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  loading: boolean; onScan: () => void;
  collapsed: boolean; setCollapsed: (v: boolean) => void;
  hasResults: boolean;
}> = ({ appName, setAppName, category, setCategory, description, setDescription, loading, onScan, collapsed, setCollapsed, hasResults }) => {
  if (collapsed && hasResults) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-all flex items-center justify-between group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Edit2 size={14} className="text-slate-500" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">{appName || 'Refine search'}</div>
            <div className="text-xs text-slate-500 truncate">{category} · {description.slice(0, 60)}{description.length > 60 ? '…' : ''}</div>
          </div>
        </div>
        <ChevronDown size={16} className="text-slate-400 group-hover:text-slate-700 transition-colors flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Search size={14} className="text-indigo-600" />
          </div>
          <h3 className="font-bold text-slate-900">Discover channels</h3>
        </div>
        {hasResults && (
          <button onClick={() => setCollapsed(true)} className="text-xs text-slate-400 hover:text-slate-700">
            Collapse
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <Field label="Product name" placeholder="e.g. CodeSnap" value={appName} onChange={setAppName} />
        <Field label="Category" placeholder="e.g. Developer Tools" value={category} onChange={setCategory} />
      </div>
      <Field
        label="Description"
        placeholder="What does it do? Who is it for?"
        value={description}
        onChange={setDescription}
        textarea
      />

      <button
        onClick={onScan}
        disabled={loading || !description || !category}
        className="mt-4 w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Scanning the web…
          </>
        ) : (
          <>
            <Sparkles size={16} />
            Find my channels
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </div>
  );
};

const Field: React.FC<{
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; textarea?: boolean;
}> = ({ label, placeholder, value, onChange, textarea }) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 block mb-1.5">{label}</span>
    {textarea ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none h-20"
      />
    ) : (
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      />
    )}
  </label>
);

// ============================================================
// HERO CARD (#1 match)
// ============================================================
const HeroCard: React.FC<{
  channel: DistributionChannel;
  status: ChannelStatus;
  isSelected: boolean;
  onSelect: () => void;
  onStatusChange: (s: ChannelStatus) => void;
}> = ({ channel, status, isSelected, onSelect, onStatusChange }) => {
  const meta = STATUS_META[status];
  return (
    <div
      className={`group relative bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 rounded-3xl p-8 md:p-10 text-white shadow-2xl shadow-slate-900/20 cursor-pointer overflow-hidden transition-all hover:shadow-slate-900/40 ${
        isSelected ? 'ring-4 ring-indigo-500 ring-offset-4 ring-offset-base-200' : ''
      }`}
      onClick={onSelect}
    >
      {/* Decorative gradient blob */}
      <div className="absolute -top-20 -right-20 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl"></div>
      <div className="absolute -bottom-32 -left-20 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Channel info */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-white/10 rounded-full text-[10px] font-bold tracking-wider uppercase backdrop-blur">
              {channel.type}
            </span>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-[10px] font-bold tracking-wider uppercase">
              {channel.cost === 'Free' ? 'Free' : channel.cost}
            </span>
          </div>

          <h2 className="text-4xl md:text-5xl font-display font-bold tracking-tight mb-3 flex items-center gap-3 flex-wrap">
            {channel.name}
            <a href={channel.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="opacity-50 hover:opacity-100 transition-opacity">
              <ArrowUpRight size={28} />
            </a>
          </h2>

          <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-xl">
            "{channel.reason || channel.successCase}"
          </p>

          <div className="flex flex-wrap gap-6 mt-6 text-sm">
            <Stat label="Audience" value={channel.audienceSize} />
            <Stat label="Engagement" value={channel.engagementLevel || '—'} />
            <Stat label="Weekly opps" value={`${channel.opportunityCount}+`} />
          </div>
        </div>

        {/* Right: Score + CTA */}
        <div className="flex flex-col items-end justify-between gap-6">
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1">Match Score</div>
            <div className="text-7xl md:text-8xl font-display font-bold leading-none">
              {channel.matchScore}
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full">
            <StatusPill status={status} onChange={onStatusChange} dark />
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className="w-full bg-white text-slate-900 font-bold py-3 px-6 rounded-xl hover:bg-white/90 transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              Open intel <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-1">{label}</div>
    <div className="text-base font-display font-bold">{value}</div>
  </div>
);

// ============================================================
// CHANNEL CARD (compact)
// ============================================================
const ChannelCard: React.FC<{
  channel: DistributionChannel;
  status: ChannelStatus;
  isSelected: boolean;
  onSelect: () => void;
  onStatusChange: (s: ChannelStatus) => void;
}> = ({ channel, status, isSelected, onSelect, onStatusChange }) => {
  const isPaid = channel.category === 'Ads';
  const isLaunchpad = channel.type === 'Launchpad' || channel.type === 'Directory';

  return (
    <div
      onClick={onSelect}
      className={`group relative bg-white rounded-2xl p-5 cursor-pointer transition-all border ${
        isSelected ? 'border-slate-900 shadow-lg' : 'border-slate-200 hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-slate-400">{TYPE_ICON[channel.type] || <Globe2 size={14} />}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{channel.type}</span>
            {isPaid && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] font-black uppercase tracking-wider">Paid</span>}
            {isLaunchpad && !isPaid && <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[9px] font-black uppercase tracking-wider">Launch</span>}
          </div>
          <h3 className="font-display font-bold text-lg text-slate-900 leading-tight flex items-center gap-1.5 truncate">
            {channel.name}
            <a href={channel.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-slate-400 hover:text-slate-900 transition-colors flex-shrink-0">
              <ExternalLink size={12} />
            </a>
          </h3>
        </div>
        <div className="text-right flex-shrink-0 ml-3">
          <div className="text-3xl font-display font-bold text-slate-900 leading-none">
            {channel.matchScore}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">Score</div>
        </div>
      </div>

      {/* Reason */}
      <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 mb-4 min-h-[2rem]">
        {channel.reason || channel.successCase}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs mb-4 pb-4 border-b border-slate-100">
        <MiniStat icon={<Users size={11} />} value={channel.audienceSize} />
        {isPaid ? (
          <MiniStat icon={<DollarSign size={11} />} value={channel.minEntryCost || 'N/A'} />
        ) : (
          <MiniStat icon={<Zap size={11} />} value={`${channel.opportunityCount}+/wk`} />
        )}
      </div>

      {/* Footer: status pill */}
      <StatusPill status={status} onChange={onStatusChange} />

      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute top-3 right-3 w-2 h-2 bg-slate-900 rounded-full"></div>
      )}
    </div>
  );
};

const MiniStat: React.FC<{ icon: React.ReactNode; value: string }> = ({ icon, value }) => (
  <div className="flex items-center gap-1.5 text-slate-500">
    <span className="text-slate-400">{icon}</span>
    <span className="font-medium">{value}</span>
  </div>
);

// ============================================================
// STATUS PILL (interactive dropdown)
// ============================================================
const StatusPill: React.FC<{
  status: ChannelStatus;
  onChange: (s: ChannelStatus) => void;
  dark?: boolean;
}> = ({ status, onChange, dark }) => {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[status];

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
          dark
            ? 'bg-white/10 hover:bg-white/20 text-white backdrop-blur'
            : `${meta.bg} ${meta.color} hover:brightness-95`
        }`}
      >
        <span className="flex items-center gap-1.5">
          {meta.icon} {meta.label}
        </span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)}></div>
          <div className="absolute z-40 mt-1 w-full bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            {(Object.keys(STATUS_META) as ChannelStatus[]).map(s => {
              const m = STATUS_META[s];
              return (
                <button
                  key={s}
                  onClick={() => { onChange(s); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold transition-all hover:bg-slate-50 ${m.color}`}
                >
                  {m.icon} {m.label}
                  {status === s && <Check size={11} className="ml-auto text-slate-900" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================
// SKELETON
// ============================================================
const SkeletonCard: React.FC<{ large?: boolean }> = ({ large }) => (
  <div className={`bg-white border border-slate-200 rounded-2xl p-5 animate-pulse ${large ? 'lg:col-span-3' : ''}`}>
    <div className="flex justify-between items-start mb-4">
      <div className="space-y-2 flex-1">
        <div className="h-3 w-20 bg-slate-200 rounded"></div>
        <div className="h-5 w-32 bg-slate-200 rounded"></div>
      </div>
      <div className="h-10 w-12 bg-slate-200 rounded"></div>
    </div>
    <div className="space-y-2 mb-4">
      <div className="h-3 bg-slate-200 rounded"></div>
      <div className="h-3 w-3/4 bg-slate-200 rounded"></div>
    </div>
    <div className="h-8 bg-slate-100 rounded"></div>
  </div>
);

// ============================================================
// SLIDE-OVER PANEL
// ============================================================
const SlideOverPanel: React.FC<any> = ({
  channel, analyzing, analysis, generatingContent, generatedContent,
  scanningOpps, opportunities, generatingReply, replyDraft,
  viewMode, setViewMode, onClose, onGenerateContent, onScanOpps,
  onGenerateReply, onCloseReply, copiedField, copyToClipboard,
  status, onStatusChange
}) => (
  <div className="fixed inset-y-0 right-0 w-full md:w-[680px] bg-white z-50 shadow-2xl flex flex-col animate-slide-in border-l border-slate-200">
    {/* Header */}
    <div className="px-6 py-5 border-b border-slate-100">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{channel.type}</span>
            <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Score {channel.matchScore}</span>
          </div>
          <h2 className="text-2xl font-display font-bold text-slate-900 truncate">{channel.name}</h2>
          <a href={channel.url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1 mt-1">
            {channel.url} <ExternalLink size={10} />
          </a>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0">
          <X size={18} className="text-slate-500" />
        </button>
      </div>

      <div className="mt-4 max-w-[200px]">
        <StatusPill status={status} onChange={onStatusChange} />
      </div>
    </div>

    {/* Tabs */}
    <div className="px-6 border-b border-slate-100 flex">
      {[
        { id: 'INTEL',  label: 'Intel',    icon: <Shield size={14} /> },
        { id: 'DRAFT',  label: 'Drafter',  icon: <PenTool size={14} /> },
        { id: 'RADAR',  label: 'Radar',    icon: <Radar size={14} /> },
      ].map(tab => (
        <button
          key={tab.id}
          onClick={() => setViewMode(tab.id)}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-all ${
            viewMode === tab.id
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>

    {/* Content */}
    <div className="flex-1 overflow-y-auto">
      {viewMode === 'INTEL' && (
        <IntelTab
          analyzing={analyzing} analysis={analysis} channel={channel}
          onGenerateContent={onGenerateContent}
        />
      )}
      {viewMode === 'DRAFT' && (
        <DraftTab
          generatingContent={generatingContent} generatedContent={generatedContent}
          channel={channel} copiedField={copiedField} copyToClipboard={copyToClipboard}
        />
      )}
      {viewMode === 'RADAR' && (
        <RadarTab
          scanningOpps={scanningOpps} opportunities={opportunities}
          generatingReply={generatingReply} replyDraft={replyDraft}
          onScanOpps={onScanOpps} onGenerateReply={onGenerateReply}
          onCloseReply={onCloseReply} copyToClipboard={copyToClipboard}
        />
      )}
    </div>
  </div>
);

// ============================================================
// INTEL TAB
// ============================================================
const IntelTab: React.FC<any> = ({ analyzing, analysis, channel, onGenerateContent }) => {
  if (analyzing) {
    return (
      <div className="p-6 space-y-6">
        <div className="space-y-3">
          <div className="h-4 w-32 bg-slate-200 rounded animate-pulse"></div>
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse"></div>
        </div>
        <div className="space-y-3">
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse"></div>
          <div className="grid grid-cols-3 gap-3">
            {[0,1,2].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse"></div>)}
          </div>
        </div>
      </div>
    );
  }
  if (!analysis) return null;

  return (
    <div className="p-6 space-y-8 pb-32">
      {/* Verdict */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-2">Verdict</div>
        <p className="text-lg font-display leading-snug mb-3">"{analysis.verdict}"</p>
        <div className="flex flex-wrap gap-2">
          <span className="px-2 py-1 bg-white/10 rounded-md text-[10px] font-bold uppercase tracking-wider backdrop-blur">
            {analysis.audienceVibe}
          </span>
          <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
            analysis.moderationStrictness === 'Brutal' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
          }`}>
            Mods: {analysis.moderationStrictness}
          </span>
        </div>
      </div>

      {/* Benchmarks */}
      {analysis.saasKpis && (
        <Section title="Platform benchmarks" icon={<TrendingUp size={14} />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {analysis.saasKpis.map((kpi: any, i: number) => (
              <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-tight h-7">{kpi.label}</div>
                <div className="text-xl font-display font-bold text-slate-900 my-1">{kpi.value}</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1 font-bold">
                  {kpi.trend === 'Up' ? <TrendingUp size={10} className="text-emerald-600" /> :
                   kpi.trend === 'Down' ? <TrendingDown size={10} className="text-rose-600" /> :
                   <Minus size={10} />}
                  <span className="truncate">{kpi.context}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Algorithm Secrets */}
      {analysis.algorithmSecrets && (
        <Section title="Algorithm secrets" icon={<Unlock size={14} />}>
          <div className="space-y-2">
            {analysis.algorithmSecrets.map((s: any, i: number) => (
              <details key={i} className="group bg-slate-50 border border-slate-200 rounded-xl overflow-hidden" open={i === 0}>
                <summary className="flex items-center gap-2 p-3 cursor-pointer hover:bg-slate-100 transition-colors text-sm font-bold text-slate-900">
                  <Key size={12} className="text-amber-600 flex-shrink-0" />
                  <span className="flex-1">{s.trigger}</span>
                  <ChevronDown size={14} className="text-slate-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="px-3 pb-3 pt-1 text-xs text-slate-600 leading-relaxed">
                  <div className="mb-2"><span className="font-bold text-slate-900">Tactic:</span> {s.tactic}</div>
                  <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-bold uppercase tracking-wider">
                    Impact: {s.impact}
                  </span>
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}

      {/* Hooks */}
      {analysis.contentHooks && (
        <Section title="Viral content templates" icon={<ListChecks size={14} />}>
          <div className="space-y-2">
            {analysis.contentHooks.map((hook: string, i: number) => (
              <div key={i} className="flex gap-3 items-start bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <code className="text-xs text-slate-700 font-mono leading-relaxed">"{hook}"</code>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div>
    <div className="flex items-center gap-2 mb-3">
      <span className="text-slate-400">{icon}</span>
      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</h3>
    </div>
    {children}
  </div>
);

// ============================================================
// DRAFT TAB
// ============================================================
const DraftTab: React.FC<any> = ({ generatingContent, generatedContent, channel, copiedField, copyToClipboard }) => {
  if (generatingContent) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-20 bg-slate-100 rounded-xl animate-pulse"></div>
        <div className="h-8 bg-slate-100 rounded animate-pulse"></div>
        <div className="h-40 bg-slate-100 rounded-xl animate-pulse"></div>
      </div>
    );
  }
  if (!generatedContent) {
    return (
      <div className="p-12 text-center">
        <FileText size={32} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm text-slate-500">Open the Intel tab and click "Generate" to create a post.</p>
      </div>
    );
  }
  return (
    <div className="p-6 space-y-4 pb-32">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <Zap size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900">
            <div className="font-bold mb-1">Posting tips</div>
            {generatedContent.postingTips?.map((t: string, i: number) => (
              <div key={i} className="leading-relaxed">• {t}</div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Headline</span>
          <button onClick={() => copyToClipboard(generatedContent.subject, 'subject')} className="text-slate-400 hover:text-slate-900">
            {copiedField === 'subject' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          </button>
        </div>
        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900">
          {generatedContent.subject}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Body</span>
          <button onClick={() => copyToClipboard(generatedContent.body, 'body')} className="text-slate-400 hover:text-slate-900">
            {copiedField === 'body' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          </button>
        </div>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none">
          <ReactMarkdown>{generatedContent.body}</ReactMarkdown>
        </div>
      </div>

      <a
        href={channel.url}
        target="_blank"
        rel="noreferrer"
        className="block w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-xl text-center transition-all flex items-center justify-center gap-2"
      >
        Post on {channel.name} <ExternalLink size={14} />
      </a>
    </div>
  );
};

// ============================================================
// RADAR TAB
// ============================================================
const RadarTab: React.FC<any> = ({
  scanningOpps, opportunities, generatingReply, replyDraft,
  onScanOpps, onGenerateReply, onCloseReply, copyToClipboard
}) => (
  <div className="relative h-full">
    <div className="p-6 pb-32">
      <button
        onClick={onScanOpps}
        disabled={scanningOpps}
        className="w-full mb-4 px-4 py-2.5 border-2 border-dashed border-slate-300 hover:border-slate-900 hover:bg-slate-50 text-slate-700 hover:text-slate-900 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {scanningOpps ? <><Loader2 size={14} className="animate-spin" /> Scanning live threads…</> : <><Radar size={14} /> Refresh radar</>}
      </button>

      {!scanningOpps && opportunities.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          No opportunities yet — click refresh to scan.
        </div>
      )}

      <div className="space-y-3">
        {opportunities.map((opp: MarketOpportunity, idx: number) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between mb-2 text-[10px] font-bold uppercase tracking-wider">
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded">{opp.type}</span>
              <span className="text-slate-400">Score {opp.relevanceScore}</span>
            </div>
            <a href={opp.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-900 hover:text-indigo-600 leading-snug flex items-start gap-1.5 transition-colors">
              <span>{opp.headline}</span>
              <ExternalLink size={11} className="flex-shrink-0 mt-0.5 opacity-50" />
            </a>
            <p className="text-xs text-slate-500 italic line-clamp-2 my-2 leading-relaxed">"{opp.context}"</p>
            <button
              onClick={() => onGenerateReply(opp)}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              Draft a reply <ArrowRight size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>

    {generatingReply && (
      <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-30 flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={28} className="animate-spin text-slate-900 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Crafting your reply…</p>
        </div>
      </div>
    )}

    {replyDraft && (
      <div className="absolute inset-0 bg-white z-40 overflow-y-auto animate-fade-in">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Send size={14} className="text-emerald-600" /> Draft reply
            </h3>
            <button onClick={onCloseReply} className="p-1.5 hover:bg-slate-100 rounded-lg">
              <X size={14} className="text-slate-500" />
            </button>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 flex items-start gap-2">
            <Shield size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-900">{replyDraft.safetyCheck}</div>
          </div>
          <textarea
            readOnly
            value={replyDraft.text}
            className="w-full h-40 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm leading-relaxed font-mono mb-3 resize-none focus:outline-none"
          />
          <button
            onClick={() => copyToClipboard(replyDraft.text, 'reply')}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <Copy size={14} /> Copy reply
          </button>
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 leading-relaxed">
            <span className="font-bold text-slate-900 block mb-1">Strategy</span>
            {replyDraft.explanation}
          </div>
        </div>
      </div>
    )}
  </div>
);
