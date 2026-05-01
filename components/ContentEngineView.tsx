import React, { useState, useEffect } from 'react';
import { MessageSquarePlus, RefreshCw, Github, Sparkles, Twitter, Linkedin, MessageCircle, Hash, Loader2, Copy, Check, ChevronRight, ChevronLeft, Zap, ExternalLink, BookOpen, Flame, Link, Wand2, AlertCircle } from 'lucide-react';
import { generateContentEnginePost, ContentEngineParams, ContentEngineDraft } from '../services/geminiService';
import { fetchRepoPulse, parseGitHubUrl } from '../services/githubService';

type OriginType = 'answer' | 'rephrase' | 'build_in_public' | 'fresh';

const ORIGINS: { id: OriginType; icon: React.ReactNode; label: string; desc: string; color: string }[] = [
    { id: 'answer',           icon: <MessageSquarePlus size={28} />, label: 'Answer a Post',     desc: 'Craft a contextual reply to a social post',          color: 'blue' },
    { id: 'rephrase',         icon: <RefreshCw size={28} />,         label: 'Rephrase a Post',   desc: 'Rewrite any post in your unique brand voice',         color: 'purple' },
    { id: 'build_in_public',  icon: <Github size={28} />,            label: 'Build in Public',   desc: 'Turn GitHub commits into viral storytelling',          color: 'gray' },
    { id: 'fresh',            icon: <Sparkles size={28} />,          label: 'Fresh Post',        desc: 'Start from a topic or keyword — pure creation',       color: 'amber' },
];

const PLATFORM_COLORS: Record<string, string> = {
    'X':        'bg-gray-900 text-white border-gray-900',
    'LinkedIn': 'bg-blue-600 text-white border-blue-600',
    'Reddit':   'bg-orange-500 text-white border-orange-500',
    'Threads':  'bg-purple-600 text-white border-purple-600',
};

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
    'X':        <Twitter size={14} />,
    'LinkedIn': <Linkedin size={14} />,
    'Reddit':   <MessageCircle size={14} />,
    'Threads':  <Hash size={14} />,
};

export const ContentEngineView: React.FC = () => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [origin, setOrigin] = useState<OriginType>('fresh');
    const [sourceContent, setSourceContent] = useState('');
    const [sourceUrl, setSourceUrl] = useState('');
    const [sourceCreator, setSourceCreator] = useState('');
    const [sourcePlatform, setSourcePlatform] = useState('');
    // Build In Public specific
    const [repoUrl, setRepoUrl] = useState('');
    const [repoToken, setRepoToken] = useState('');
    const [repoLoading, setRepoLoading] = useState(false);
    const [repoError, setRepoError] = useState('');
    const [sinceDate, setSinceDate] = useState('');
    const [untilDate, setUntilDate] = useState('');
    // Params
    const [targetPlatforms, setTargetPlatforms] = useState<string[]>(['X', 'LinkedIn']);
    const [format, setFormat] = useState<ContentEngineParams['format']>('single');
    const [tone, setTone] = useState('Authentic & Direct');
    const [hookStyle, setHookStyle] = useState('myth_buster');
    const [ctaType, setCtaType] = useState<ContentEngineParams['cta']>('soft');
    // Output
    const [drafts, setDrafts] = useState<ContentEngineDraft[]>([]);
    const [generating, setGenerating] = useState(false);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    // DNA
    const [dnaString, setDnaString] = useState('');
    const [bannedWords, setBannedWords] = useState<string[]>([]);
    // Style Inspiration
    const [styleInspiration, setStyleInspiration] = useState('');
    const [styleUrl, setStyleUrl] = useState('');
    const [styleUrlLoading, setStyleUrlLoading] = useState(false);
    const [styleUrlError, setStyleUrlError] = useState('');

    // Load Content DNA and check for Radar context on mount
    useEffect(() => {
        const dnaRaw = localStorage.getItem('content_dna_config');
        if (dnaRaw) {
            try {
                const dna = JSON.parse(dnaRaw);
                const parts: string[] = [];
                if (dna.bannedWords?.length) {
                    setBannedWords(dna.bannedWords);
                }
                Object.entries(dna.platforms || {}).forEach(([p, val]: any) => {
                    if (val.rules) parts.push(`${p.toUpperCase()} rules: ${val.rules}`);
                    if (val.extractedCreatorDNA) parts.push(`${p.toUpperCase()} voice: ${val.extractedCreatorDNA}`);
                });
                if (parts.length) setDnaString(parts.join('\n'));
            } catch(e) {}
        }

        const ctx = localStorage.getItem('answerly_respond_context');
        if (ctx) {
            try {
                const item = JSON.parse(ctx);
                setOrigin('answer');
                setSourceContent(item.body || item.text || '');
                setSourceUrl(item.url || '');
                setSourceCreator(item.creator || '');
                setSourcePlatform(item.platform || '');
                localStorage.removeItem('answerly_respond_context');
                setStep(2);
            } catch(e) {}
        }
    }, []);

    const togglePlatform = (p: string) => {
        setTargetPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const fetchStyleFromUrl = async () => {
        if (!styleUrl.trim()) return;
        setStyleUrlLoading(true);
        setStyleUrlError('');
        try {
            const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(styleUrl)}`);
            if (!res.ok) throw new Error('Could not fetch URL');
            const data = await res.json();
            const text = (data.contents || '')
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 3000);
            if (text.length < 50) throw new Error('Could not extract readable content. Paste the content manually.');
            setStyleInspiration(prev => prev ? prev + '\n\n' + text : text);
        } catch (e: any) {
            setStyleUrlError(e.message || 'Fetch failed. Paste the content manually instead.');
        } finally {
            setStyleUrlLoading(false);
        }
    };

    const handleRepoSync = async () => {
        setRepoError('');
        const parsed = parseGitHubUrl(repoUrl);
        if (!parsed) { setRepoError('Invalid GitHub URL'); return; }
        setRepoLoading(true);
        try {
            const since = sinceDate ? new Date(sinceDate).toISOString() : undefined;
            const until = untilDate ? new Date(untilDate).toISOString() : undefined;
            
            const pulse = await fetchRepoPulse(parsed.owner, parsed.repo, repoToken, since, until);
            const summary = [
                `Repo: ${pulse.name} — ${pulse.description}`,
                `Stars: ${pulse.stars} | Forks: ${pulse.forks} | Contributors: ${pulse.contributorCount}`,
                `Languages: ${pulse.allLanguages.join(', ')}`,
                `Activity Period: ${sinceDate || 'Start'} to ${untilDate || 'Now'}`,
                `Recent commits:\n${pulse.recentCommitMessages.slice(0, 10).map(m => `- ${m}`).join('\n')}`,
                `Last ship: ${new Date(pulse.lastUpdate).toLocaleDateString()}`
            ].join('\n');
            setSourceContent(summary);
        } catch(e: any) {
            setRepoError(e.message || 'Failed to sync repository');
        } finally {
            setRepoLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!sourceContent || targetPlatforms.length === 0) return;
        setGenerating(true);
        setDrafts([]);
        try {
            const result = await generateContentEnginePost({
                origin,
                sourceContent,
                sourceUrl,
                sourceCreator,
                sourcePlatform,
                targetPlatforms,
                format,
                tone,
                length: 'medium',
                hookStyle: hookStyle as ContentEngineParams['hookStyle'],
                cta: ctaType,
                contentDNA: dnaString,
                bannedWords,
                styleInspiration: styleInspiration || undefined
            });
            setDrafts(result);
            setStep(3);
        } catch(e) {
            console.error(e);
        } finally {
            setGenerating(false);
        }
    };

    const copy = (text: string, idx: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 2000);
    };

    const originConfig = ORIGINS.find(o => o.id === origin)!;

    const colorMap: Record<string, string> = {
        blue:   'border-blue-500 bg-blue-50 text-blue-700',
        purple: 'border-purple-500 bg-purple-50 text-purple-700',
        gray:   'border-gray-900 bg-gray-50 text-gray-900',
        amber:  'border-amber-500 bg-amber-50 text-amber-700',
    };
    const colorRing: Record<string, string> = {
        blue:   'ring-blue-400',
        purple: 'ring-purple-400',
        gray:   'ring-gray-400',
        amber:  'ring-amber-400',
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-fade-in pb-24">

            {/* Header */}
            <div className="border-b border-gray-100 pb-8">
                <h2 className="text-4xl font-display font-medium text-brand-primary tracking-tight flex items-center gap-3">
                    <Flame size={32} className="text-amber-500" />
                    Content <span className="text-amber-500">Engine</span>
                </h2>
                <p className="text-brand-secondary mt-1 text-base">Unified AI content creation. From origin to polished, multi-platform drafts.</p>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-2">
                {([1,2,3] as const).map((s) => (
                    <React.Fragment key={s}>
                        <button
                            onClick={() => s < step ? setStep(s) : undefined}
                            className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                                step === s ? 'bg-amber-500 text-white scale-110 shadow-md shadow-amber-200' :
                                step > s   ? 'bg-gray-900 text-white cursor-pointer' :
                                             'bg-gray-100 text-gray-400'
                            }`}
                        >{s}</button>
                        {s < 3 && <div className={`flex-1 h-0.5 rounded-full transition-all ${step > s ? 'bg-gray-900' : 'bg-gray-100'}`} />}
                    </React.Fragment>
                ))}
                <span className="ml-3 text-xs font-bold text-gray-400 uppercase tracking-widest">
                    {step === 1 ? 'Choose Origin' : step === 2 ? 'Set Parameters' : 'Your Drafts'}
                </span>
            </div>

            {/* ─── STEP 1: Origin ───────────────────────────────────────── */}
            {step === 1 && (
                <div className="space-y-6 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {ORIGINS.map((o) => (
                            <button
                                key={o.id}
                                onClick={() => setOrigin(o.id)}
                                className={`p-6 rounded-3xl border-2 text-left transition-all hover:scale-[1.01] ${
                                    origin === o.id
                                    ? `${colorMap[o.color]} ring-2 ${colorRing[o.color]} ring-offset-2`
                                    : 'border-gray-100 bg-white hover:border-gray-200'
                                }`}
                            >
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${
                                    origin === o.id ? colorMap[o.color] : 'bg-gray-50 text-gray-400'
                                }`}>{o.icon}</div>
                                <h3 className="font-bold text-lg text-brand-primary">{o.label}</h3>
                                <p className="text-xs text-brand-secondary mt-1">{o.desc}</p>
                            </button>
                        ))}
                    </div>

                    {/* Source Input per origin */}
                    <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4">
                        <h3 className="font-bold text-base text-brand-primary">{originConfig.label} — Source</h3>

                        {origin === 'build_in_public' ? (
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    placeholder="GitHub URL (e.g. github.com/owner/repo)"
                                    value={repoUrl}
                                    onChange={e => setRepoUrl(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                                <input
                                    type="password"
                                    placeholder="Personal Access Token (optional)"
                                    value={repoToken}
                                    onChange={e => setRepoToken(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />

                                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Timeframe Filter</label>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => {
                                                    const d = new Date();
                                                    setUntilDate(d.toISOString().split('T')[0]);
                                                    d.setDate(d.getDate() - 1);
                                                    setSinceDate(d.toISOString().split('T')[0]);
                                                }}
                                                className="text-[10px] font-bold text-amber-600 hover:underline"
                                            >Last 24h</button>
                                            <button 
                                                onClick={() => {
                                                    const d = new Date();
                                                    setUntilDate(d.toISOString().split('T')[0]);
                                                    d.setDate(d.getDate() - 7);
                                                    setSinceDate(d.toISOString().split('T')[0]);
                                                }}
                                                className="text-[10px] font-bold text-amber-600 hover:underline"
                                            >Last 7d</button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Since</label>
                                            <input
                                                type="date"
                                                value={sinceDate}
                                                onChange={e => setSinceDate(e.target.value)}
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Until</label>
                                            <input
                                                type="date"
                                                value={untilDate}
                                                onChange={e => setUntilDate(e.target.value)}
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {repoError && <p className="text-xs text-red-500">{repoError}</p>}
                                <button onClick={handleRepoSync} disabled={repoLoading || !repoUrl}
                                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-gray-800 transition-all shadow-lg shadow-gray-200">
                                    {repoLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                    {repoLoading ? 'Analyzing History...' : 'Fetch & Analyze Changes'}
                                </button>
                                {sourceContent && (
                                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 text-xs font-mono text-gray-600 whitespace-pre-wrap">{sourceContent}</div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {(origin === 'answer' || origin === 'rephrase') && (
                                    <input
                                        type="text"
                                        placeholder="Source URL (optional)"
                                        value={sourceUrl}
                                        onChange={e => setSourceUrl(e.target.value)}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                )}
                                <textarea
                                    rows={5}
                                    placeholder={
                                        origin === 'answer'   ? 'Paste the post you want to reply to...' :
                                        origin === 'rephrase' ? 'Paste the post you want to rephrase...' :
                                        'What topic or idea do you want to post about?'
                                    }
                                    value={sourceContent}
                                    onChange={e => setSourceContent(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={() => setStep(2)}
                            disabled={!sourceContent}
                            className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-2xl font-bold text-sm disabled:opacity-40 hover:bg-gray-700 transition-all"
                        >
                            Set Parameters <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* ─── STEP 2: Parameters ───────────────────────────────────── */}
            {step === 2 && (
                <div className="space-y-6 animate-fade-in">

                    {/* Context preview banner */}
                    {sourceContent && (
                        <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-xs text-amber-800 flex items-start gap-2">
                            <BookOpen size={14} className="mt-0.5 shrink-0" />
                            <div>
                                <span className="font-bold uppercase tracking-wider">{originConfig.label} — </span>
                                {sourceContent.substring(0, 160)}{sourceContent.length > 160 ? '...' : ''}
                            </div>
                        </div>
                    )}

                    <div className="space-y-6">

                        {/* Target Platforms — MULTI SELECT */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">Target Platforms</label>
                                <span className="text-[10px] text-gray-400">Select multiple — one draft per platform</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { id: 'X',        icon: <Twitter size={18} />,       limit: '280 chars',   color: 'bg-gray-900 border-gray-900 text-white' },
                                    { id: 'LinkedIn', icon: <Linkedin size={18} />,      limit: '3,000 chars', color: 'bg-blue-600 border-blue-600 text-white' },
                                    { id: 'Reddit',   icon: <MessageCircle size={18} />, limit: 'No limit',    color: 'bg-orange-500 border-orange-500 text-white' },
                                    { id: 'Threads',  icon: <Hash size={18} />,          limit: '500 chars',   color: 'bg-purple-600 border-purple-600 text-white' },
                                ].map(p => (
                                    <button
                                        type="button"
                                        key={p.id}
                                        onClick={() => togglePlatform(p.id)}
                                        className={`relative p-4 rounded-2xl border-2 text-left transition-all ${
                                            targetPlatforms.includes(p.id)
                                            ? p.color
                                            : 'border-gray-100 bg-gray-50 text-gray-400 hover:border-gray-200 hover:bg-white'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            {p.icon}
                                            {targetPlatforms.includes(p.id) && (
                                                <Check size={14} className="opacity-80" />
                                            )}
                                        </div>
                                        <div className="font-bold text-sm">{p.id}</div>
                                        <div className={`text-[10px] mt-0.5 ${
                                            targetPlatforms.includes(p.id) ? 'opacity-70' : 'text-gray-400'
                                        }`}>{p.limit}</div>
                                    </button>
                                ))}
                            </div>
                            {targetPlatforms.length > 0 && (
                                <p className="text-[10px] text-gray-400 text-center">Generating {targetPlatforms.length} platform-adapted draft{targetPlatforms.length > 1 ? 's' : ''} with native length constraints</p>
                            )}
                        </div>

                        {/* Format */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">Format</label>
                            <div className="grid grid-cols-2 gap-2">
                                {([
                                    { id: 'single',   label: 'Single Post',    icon: '📝' },
                                    { id: 'thread',   label: 'Thread',         icon: '🧵' },
                                    { id: 'longform', label: 'Long-form',      icon: '📰' },
                                    { id: 'comment',  label: 'Comment/Reply',  icon: '💬' },
                                ] as const).map(f => (
                                    <button type="button" key={f.id} onClick={() => setFormat(f.id)}
                                        className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
                                            format === f.id
                                            ? 'bg-gray-900 text-white border-gray-900'
                                            : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'
                                        }`}>
                                        <span>{f.icon}</span>{f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tone & Voice — Expanded Archetypes */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4 col-span-full">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">Tone & Voice — Archetype</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { emoji: '🧘', label: 'The Calm Expert',    value: 'Calm, authoritative expert. No hype. Measured, trustworthy, deeply knowledgeable.' },
                                    { emoji: '🔥', label: 'The Savage',         value: 'Raw, savage, data-driven. Brutal honesty. No sugarcoating. Short punchy sentences.' },
                                    { emoji: '📖', label: 'The Storyteller',    value: 'Narrative-first. Pulls the reader in through personal story and emotional journey.' },
                                    { emoji: '🤡', label: 'The Contrarian',     value: 'Challenges conventional wisdom. Takes the opposite stance. Provokes thinking.' },
                                    { emoji: '🎓', label: 'The Professor',      value: 'Strategic, analytical. Frameworks and systems. Punchy lessons with depth.' },
                                    { emoji: '🚀', label: 'The Hype Builder',   value: 'High energy, motivating, optimistic. Bold claims. Creates FOMO and excitement.' },
                                    { emoji: '🕵️', label: 'The Insider',        value: 'Shares secrets and insider knowledge. "What nobody tells you about X" energy.' },
                                    { emoji: '😅', label: 'The Reluctant Hero', value: 'Humble, vulnerable, self-deprecating. Failed forward. Authentic imperfection.' },
                                    { emoji: '⚡', label: 'The Disruptor',     value: 'Challenges the status quo. Declares the old way dead. Future-forward, urgent.' },
                                ].map(t => (
                                    <button type="button" key={t.value} onClick={() => setTone(t.value)}
                                        className={`py-3 px-3 rounded-2xl text-xs font-bold border transition-all text-left ${
                                            tone === t.value
                                            ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-100'
                                            : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-white hover:border-gray-200'
                                        }`}>
                                        <div className="text-lg mb-1">{t.emoji}</div>
                                        <div>{t.label}</div>
                                    </button>
                                ))}
                            </div>
                            <input
                                type="text"
                                placeholder="Or describe your own custom voice..."
                                value={tone}
                                onChange={e => setTone(e.target.value)}
                                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder-gray-400"
                            />
                        </div>

                        {/* Hook — Viral Weapon Formulas */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4 col-span-full">
                            <div>
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">Viral Hook Weapon</label>
                                <p className="text-[10px] text-gray-400 mt-1">The first 3 seconds decide everything. Choose your opening move.</p>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { id: 'myth_buster',    emoji: '💥', name: 'The Myth Buster',       desc: '"Everyone says X... they\'re wrong."' },
                                    { id: 'plot_twist',     emoji: '🎭', name: 'The Plot Twist',        desc: 'Start expected, flip everything at the end.' },
                                    { id: 'brutal_truth',   emoji: '🔪', name: 'The Brutal Truth',      desc: 'The uncomfortable fact nobody talks about.' },
                                    { id: 'dollar_hook',    emoji: '💸', name: 'The Dollar Hook',       desc: 'Lead with a specific money/outcome number.' },
                                    { id: 'timebomb',       emoji: '⏳', name: 'The Timebomb',         desc: '"In 12 months, this will be obsolete."' },
                                    { id: 'confession',     emoji: '😳', name: 'The Confession',        desc: 'Personal failure or mistake reveals a lesson.' },
                                    { id: 'bold_prediction',emoji: '🔮', name: 'The Bold Prediction',   desc: 'Make a specific, audacious claim about the future.' },
                                    { id: 'cliffhanger',    emoji: '🧵', name: 'The Cliffhanger',       desc: 'Open a loop. Make them NEED to read more.' },
                                    { id: 'proof_first',    emoji: '🏆', name: 'Proof First',           desc: 'Specific result → then explain how.' },
                                ].map(h => (
                                    <button type="button" key={h.id} onClick={() => setHookStyle(h.id)}
                                        className={`p-4 rounded-2xl border-2 transition-all text-left ${
                                            hookStyle === h.id
                                            ? 'bg-gray-900 text-white border-gray-900 shadow-lg'
                                            : 'bg-white text-gray-600 border-gray-100 hover:border-gray-300'
                                        }`}>
                                        <div className="text-2xl mb-2">{h.emoji}</div>
                                        <div className="font-bold text-xs mb-1">{h.name}</div>
                                        <div className={`text-[10px] leading-snug ${hookStyle === h.id ? 'text-gray-300' : 'text-gray-400'}`}>{h.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* CTA */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block">Call to Action</label>
                            <div className="grid grid-cols-2 gap-2">
                                {([
                                    { id: 'none',   label: 'None',        sub: 'Pure content' },
                                    { id: 'soft',   label: 'Soft',        sub: 'Spark discussion' },
                                    { id: 'medium', label: 'Medium',      sub: 'Visit / learn more' },
                                    { id: 'hard',   label: 'Strong CTA',  sub: 'Trial / signup' },
                                ] as const).map(c => (
                                    <button type="button" key={c.id} onClick={() => setCtaType(c.id)}
                                        className={`py-2 px-3 rounded-xl border text-xs font-bold flex flex-col items-start gap-0.5 transition-all ${ctaType === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}>
                                        <span>{c.label}</span>
                                        <span className={`text-[10px] ${ctaType === c.id ? 'opacity-60' : 'opacity-50'}`}>{c.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                    </div>

                    {/* Style Inspiration Panel */}
                    <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-6 space-y-4">
                        <div>
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block flex items-center gap-2">
                                <Wand2 size={13} /> Style Inspiration <span className="text-gray-300 font-normal normal-case tracking-normal">(optional)</span>
                            </label>
                            <p className="text-[10px] text-gray-400 mt-1">
                                Paste posts from a creator you admire or extract from a URL. The AI will clone their writing rhythm and voice — not their ideas.
                            </p>
                        </div>

                        {/* URL extractor */}
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Link size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="url"
                                    placeholder="https://x.com/levelsio or any profile/post URL..."
                                    value={styleUrl}
                                    onChange={e => { setStyleUrl(e.target.value); setStyleUrlError(''); }}
                                    className="w-full pl-8 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={fetchStyleFromUrl}
                                disabled={styleUrlLoading || !styleUrl}
                                className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold disabled:opacity-40 hover:bg-gray-700 transition-all shrink-0"
                            >
                                {styleUrlLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                                {styleUrlLoading ? 'Extracting...' : 'Extract Style'}
                            </button>
                        </div>
                        {styleUrlError && (
                            <div className="flex items-center gap-1.5 text-[10px] text-red-500">
                                <AlertCircle size={11} /> {styleUrlError}
                            </div>
                        )}

                        {/* Paste area */}
                        <textarea
                            rows={4}
                            placeholder={"Paste 2-5 posts from your inspiration creator here...\n\nExample: tweets, LinkedIn posts, Reddit comments — any writing you want to emulate."}
                            value={styleInspiration}
                            onChange={e => setStyleInspiration(e.target.value)}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none placeholder-gray-300 leading-relaxed"
                        />

                        {styleInspiration && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-xl">
                                    <Wand2 size={10} /> Style DNA captured — {styleInspiration.length.toLocaleString()} characters of inspiration loaded
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { setStyleInspiration(''); setStyleUrl(''); }}
                                    className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                                >Clear</button>
                            </div>
                        )}
                    </div>

                    {/* DNA Status */}
                    {dnaString && (
                        <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-700 flex items-center gap-2">
                            <Zap size={14} fill="currentColor" />
                            <span>Content DNA loaded — your brand voice will be applied automatically.</span>
                        </div>

                    )}

                    <div className="flex justify-between">
                        <button onClick={() => setStep(1)} className="flex items-center gap-2 px-5 py-2.5 rounded-2xl border border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all">
                            <ChevronLeft size={16} /> Back
                        </button>
                        <button
                            onClick={handleGenerate}
                            disabled={generating || targetPlatforms.length === 0}
                            className="flex items-center gap-2 px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-sm disabled:opacity-50 transition-all shadow-lg shadow-amber-200"
                        >
                            {generating ? <><Loader2 size={18} className="animate-spin" /> Drafting...</> : <><Sparkles size={18} /> Generate Drafts</>}
                        </button>
                    </div>
                </div>
            )}

            {/* ─── STEP 3: Output ───────────────────────────────────────── */}
            {step === 3 && (
                <div className="space-y-6 animate-fade-in">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-bold text-brand-primary">Your Drafts</h3>
                        <div className="flex gap-2">
                            <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-500 hover:bg-gray-50 transition-all">
                                <ChevronLeft size={14} /> Tweak Params
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all"
                            >
                                {generating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                Regenerate All
                            </button>
                        </div>
                    </div>

                    {generating && (
                        <div className="flex items-center justify-center p-20 text-brand-secondary gap-3">
                            <Loader2 size={24} className="animate-spin text-amber-500" />
                            <span className="text-sm font-medium">Crafting your drafts...</span>
                        </div>
                    )}

                    <div className="space-y-6">
                        {drafts.map((draft, idx) => (
                            <div key={idx} className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-minimal">
                                {/* Card Header */}
                                <div className={`px-6 py-4 flex items-center justify-between ${
                                    draft.platform === 'X' ? 'bg-gray-900' :
                                    draft.platform === 'LinkedIn' ? 'bg-blue-600' :
                                    draft.platform === 'Reddit' ? 'bg-orange-500' :
                                    'bg-purple-600'
                                }`}>
                                    <div className="flex items-center gap-2 text-white">
                                        {PLATFORM_ICONS[draft.platform]}
                                        <span className="font-bold text-sm">{draft.platform}</span>
                                        <span className="text-white/60 text-xs">— {draft.hookUsed}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {draft.platform === 'X' && (
                                            <a href="https://x.com/compose/tweet" target="_blank" rel="noreferrer"
                                               className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-all">
                                                <ExternalLink size={14} />
                                            </a>
                                        )}
                                        {draft.platform === 'LinkedIn' && (
                                            <a href="https://www.linkedin.com/feed/" target="_blank" rel="noreferrer"
                                               className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-all">
                                                <ExternalLink size={14} />
                                            </a>
                                        )}
                                        <button onClick={() => copy(draft.content, idx)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs text-white font-bold transition-all">
                                            {copiedIdx === idx ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                                        </button>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="p-6">
                                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 text-sm text-brand-primary leading-relaxed whitespace-pre-wrap font-sans">
                                        {draft.content}
                                    </div>

                                    {draft.tips.length > 0 && (
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {draft.tips.map((tip, i) => (
                                                <div key={i} className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 text-amber-800 px-3 py-1.5 rounded-xl text-[10px] font-bold">
                                                    <Sparkles size={10} /> {tip}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Start Over */}
                    <div className="text-center pt-4">
                        <button onClick={() => { setStep(1); setDrafts([]); setSourceContent(''); setSourceUrl(''); }}
                            className="text-sm text-gray-400 hover:text-gray-600 transition-colors font-medium underline underline-offset-4">
                            Start a new draft
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
