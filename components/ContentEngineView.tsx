import React, { useState, useEffect, useMemo } from 'react';
import { MessageSquarePlus, RefreshCw, Github, Sparkles, Twitter, Linkedin, MessageCircle, Hash, Loader2, Copy, Check, ChevronRight, ChevronLeft, ChevronDown, Zap, ExternalLink, BookOpen, Flame, Link, Wand2, AlertCircle, Sliders, Brain, Target, Skull, Heart, Crown, Eye, Layers, X, Settings2 } from 'lucide-react';
import {
  generateContentEnginePost, suggestVoiceProfile, ContentEngineParams, ContentEngineDraft,
  VoiceMix, HookArchitecture, PerspectiveInjector, ViralPhysics, CloserStrategy
} from '../services/geminiService';
import { fetchRepoPulse, parseGitHubUrl } from '../services/githubService';
import { Section, SubSection } from './ui/Section';
import { useVoiceProfile } from '../hooks/useVoiceProfile';
import { AppMode } from '../types';

// ────────────────────────────────────────────────────────────────────
// VOICE ARCHITECTURE — Defaults, Presets, Catalogues
// ────────────────────────────────────────────────────────────────────
export const DEFAULT_VOICE_MIX: VoiceMix = {
  authority: 60, energy: 50, vulnerability: 50, provocation: 50, specificity: 75, intimacy: 60, rhythm: 'punchy'
};
export const DEFAULT_HOOK: HookArchitecture = {
  patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap', promisePayoff: 'what_to_avoid'
};
export const DEFAULT_VIRAL: ViralPhysics = {
  statusCurrency: true, inGroupSignaling: false, tribalFraming: false,
  fortuneCookieClose: true, loopOpener: false, concessionMove: true,
  baitAndSwitch: false, forbiddenSpecificity: true
};
export const DEFAULT_PERSPECTIVE: PerspectiveInjector = {
  uniqueAngle: '', contrarian: '', forbiddenTakes: '', receipts: ''
};

export const VOICE_PRESETS: Array<{
  id: string; name: string; emoji: string; tagline: string;
  voiceMix: VoiceMix; hook: HookArchitecture; viral: ViralPhysics; closer: CloserStrategy;
}> = [
  {
    id: 'brutal_founder', name: 'Brutal Founder', emoji: '🔥', tagline: 'No fluff. Receipts only. Will offend SaaS bros.',
    voiceMix: { authority: 85, energy: 75, vulnerability: 30, provocation: 85, specificity: 95, intimacy: 70, rhythm: 'staccato' },
    hook: { patternInterrupt: 'forbidden_statement', tensionMechanism: 'status_threat', promisePayoff: 'what_to_avoid' },
    viral: { statusCurrency: true, inGroupSignaling: true, tribalFraming: true, fortuneCookieClose: true, loopOpener: false, concessionMove: false, baitAndSwitch: false, forbiddenSpecificity: true },
    closer: 'punchline'
  },
  {
    id: 'wise_mentor', name: 'Wise Mentor', emoji: '🧘', tagline: 'Calm authority. Frameworks over hype. Long-game thinking.',
    voiceMix: { authority: 80, energy: 25, vulnerability: 60, provocation: 35, specificity: 70, intimacy: 65, rhythm: 'contemplative' },
    hook: { patternInterrupt: 'precise_moment', tensionMechanism: 'cognitive_dissonance', promisePayoff: 'who_to_become' },
    viral: { statusCurrency: true, inGroupSignaling: false, tribalFraming: false, fortuneCookieClose: true, loopOpener: false, concessionMove: true, baitAndSwitch: false, forbiddenSpecificity: false },
    closer: 'soft_proof'
  },
  {
    id: 'sharp_contrarian', name: 'Sharp Contrarian', emoji: '🎭', tagline: 'Flips conventional wisdom. Bait then switch. Earned credibility.',
    voiceMix: { authority: 75, energy: 60, vulnerability: 40, provocation: 90, specificity: 85, intimacy: 55, rhythm: 'punchy' },
    hook: { patternInterrupt: 'forbidden_statement', tensionMechanism: 'cognitive_dissonance', promisePayoff: 'what_to_avoid' },
    viral: { statusCurrency: true, inGroupSignaling: true, tribalFraming: true, fortuneCookieClose: true, loopOpener: false, concessionMove: false, baitAndSwitch: true, forbiddenSpecificity: true },
    closer: 'reverse_cta'
  },
  {
    id: 'vulnerable_storyteller', name: 'Vulnerable Storyteller', emoji: '📖', tagline: 'Confession-led. Failure as teacher. Permission to feel.',
    voiceMix: { authority: 50, energy: 40, vulnerability: 95, provocation: 30, specificity: 80, intimacy: 90, rhythm: 'flowing' },
    hook: { patternInterrupt: 'taboo_confession', tensionMechanism: 'pain_mirror', promisePayoff: 'what_to_feel' },
    viral: { statusCurrency: false, inGroupSignaling: false, tribalFraming: false, fortuneCookieClose: true, loopOpener: false, concessionMove: true, baitAndSwitch: false, forbiddenSpecificity: false },
    closer: 'open_question'
  },
  {
    id: 'data_sniper', name: 'Data Sniper', emoji: '🎯', tagline: 'Numbers-first. Surgical insights. Zero adjectives.',
    voiceMix: { authority: 90, energy: 45, vulnerability: 20, provocation: 60, specificity: 100, intimacy: 40, rhythm: 'staccato' },
    hook: { patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap', promisePayoff: 'what_to_learn' },
    viral: { statusCurrency: true, inGroupSignaling: true, tribalFraming: false, fortuneCookieClose: false, loopOpener: false, concessionMove: false, baitAndSwitch: false, forbiddenSpecificity: true },
    closer: 'punchline'
  },
  {
    id: 'the_insider', name: 'The Insider', emoji: '🕵️', tagline: 'Forbidden knowledge. "What they don\'t tell you" energy.',
    voiceMix: { authority: 80, energy: 55, vulnerability: 50, provocation: 75, specificity: 85, intimacy: 75, rhythm: 'punchy' },
    hook: { patternInterrupt: 'unexpected_name', tensionMechanism: 'forbidden_knowledge', promisePayoff: 'who_to_become' },
    viral: { statusCurrency: true, inGroupSignaling: true, tribalFraming: true, fortuneCookieClose: false, loopOpener: true, concessionMove: false, baitAndSwitch: false, forbiddenSpecificity: true },
    closer: 'open_loop'
  }
];

const PATTERN_INTERRUPTS: Array<{ id: HookArchitecture['patternInterrupt']; label: string; example: string }> = [
  { id: 'shocking_number',   label: 'Shocking number',   example: '"$2,847 in 6 hours."' },
  { id: 'taboo_confession',  label: 'Taboo confession',  example: '"I lied to my first 100 users."' },
  { id: 'precise_moment',    label: 'Precise moment',    example: '"On Tuesday at 3:14am..."' },
  { id: 'self_indictment',   label: 'Self-indictment',   example: '"I built the wrong feature for 18 months."' },
  { id: 'forbidden_statement', label: 'Forbidden statement', example: '"PMF is a lie sold by VCs."' },
  { id: 'unexpected_name',   label: 'Unexpected name',   example: '"Stripe rejected us 4 times."' },
];
const TENSION_MECHANISMS: Array<{ id: HookArchitecture['tensionMechanism']; label: string; desc: string }> = [
  { id: 'curiosity_gap',         label: 'Curiosity gap',         desc: 'Question they can\'t guess the answer to' },
  { id: 'cognitive_dissonance',  label: 'Cognitive dissonance',  desc: 'Two facts that shouldn\'t both be true' },
  { id: 'pain_mirror',           label: 'Pain mirror',           desc: 'Name a frustration they\'ve felt' },
  { id: 'status_threat',         label: 'Status threat',         desc: '"You\'re losing credibility doing X"' },
  { id: 'forbidden_knowledge',   label: 'Forbidden knowledge',   desc: '"They don\'t want you to know..."' },
];
const PROMISE_PAYOFFS: Array<{ id: HookArchitecture['promisePayoff']; label: string; desc: string }> = [
  { id: 'what_to_learn',  label: 'What to learn',  desc: 'A clear takeaway' },
  { id: 'what_to_avoid',  label: 'What to avoid',  desc: 'A specific mistake to dodge' },
  { id: 'who_to_become',  label: 'Who to become',  desc: 'Identity transformation' },
  { id: 'what_to_feel',   label: 'What to feel',   desc: 'Relief, validation, vindication' },
];
const VIRAL_TOGGLES: Array<{ key: keyof ViralPhysics; label: string; desc: string }> = [
  { key: 'statusCurrency',       label: 'Status currency',       desc: 'A shareable insight that makes the reader look smart' },
  { key: 'inGroupSignaling',     label: 'In-group signaling',    desc: 'Insider vocabulary your tribe will recognize' },
  { key: 'tribalFraming',        label: 'Tribal framing',        desc: '"Us vs them" opposition (use sparingly)' },
  { key: 'fortuneCookieClose',   label: 'Fortune cookie close',  desc: 'Quotable, screenshot-worthy final line' },
  { key: 'loopOpener',           label: 'Loop opener',           desc: 'Cliffhanger that forces a DM/reply' },
  { key: 'concessionMove',       label: 'Concession move',       desc: 'Admit something against your interest' },
  { key: 'baitAndSwitch',        label: 'Bait & switch',         desc: 'Agree first, then flip the take' },
  { key: 'forbiddenSpecificity', label: 'Forbidden specificity', desc: 'Name the exact tool/dollar amount/competitor' },
];
const CLOSERS: Array<{ id: CloserStrategy; label: string; desc: string }> = [
  { id: 'open_question', label: 'Open question', desc: 'Specific, answerable (not "thoughts?")' },
  { id: 'punchline',     label: 'Punchline',     desc: 'Quotable one-liner' },
  { id: 'reverse_cta',   label: 'Reverse CTA',   desc: '"Don\'t X if Y" — counterintuitive' },
  { id: 'soft_proof',    label: 'Soft proof',    desc: 'Casual mention of a result/number' },
  { id: 'open_loop',     label: 'Open loop',     desc: 'Tease the next post' },
];
const VOICE_DIMENSIONS: Array<{ key: keyof Omit<VoiceMix, 'rhythm'>; label: string; low: string; high: string }> = [
  { key: 'authority',      label: 'Authority',      low: 'humble student',  high: 'unquestionable expert' },
  { key: 'energy',         label: 'Energy',         low: 'zen contemplative', high: 'manic urgency' },
  { key: 'vulnerability',  label: 'Vulnerability',  low: 'guarded armor',    high: 'bare soul' },
  { key: 'provocation',    label: 'Provocation',    low: 'polite consensus', high: 'controversial heat' },
  { key: 'specificity',    label: 'Specificity',    low: 'vague poetry',     high: 'numbers & names' },
  { key: 'intimacy',       label: 'Intimacy',       low: 'corporate distant', high: 'DM to a friend' },
];

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

// Section/SubSection now live in ui/Section.tsx — shared across all views.

export const ContentEngineView: React.FC<{ onOpenParameters?: () => void }> = ({ onOpenParameters }) => {
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
    const [ctaType, setCtaType] = useState<ContentEngineParams['cta']>('soft');

    // ─── Voice profile — read from the shared hook ───
    // All voice/hook/viral/closer/variants/perspective/style live in
    // ContentParametersView and are persisted there. This view consumes
    // them at generation time. Anything edited in Parameters takes effect
    // on the next post without a reload.
    const vp = useVoiceProfile();
    const { voiceMix, hook, viral, closer, variants, activePreset, perspective, styleInspiration } = vp;

    // Output
    const [drafts, setDrafts] = useState<ContentEngineDraft[]>([]);
    const [generating, setGenerating] = useState(false);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    // DNA
    const [dnaString, setDnaString] = useState('');
    const [bannedWords, setBannedWords] = useState<string[]>([]);
    // Style Inspiration — now lives in Parameters; read from hook (vp.styleInspiration above)

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

    const [generationError, setGenerationError] = useState<string | null>(null);

    const handleGenerate = async () => {
        if (!sourceContent || targetPlatforms.length === 0) return;
        setGenerating(true);
        setGenerationError(null);
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
                length: 'medium',
                cta: ctaType,
                contentDNA: dnaString,
                bannedWords,
                styleInspiration: styleInspiration || undefined,
                voiceMix,
                hook,
                perspective,
                viral,
                closer,
                variants
            });
            setDrafts(result);
            setStep(3);
        } catch (e: any) {
            console.error(e);
            setGenerationError(e?.message || 'Generation failed');
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
        <div className="max-w-5xl mx-auto space-y-10 animate-fade-in pb-24">

            {/* Header — minimalist, no icon box, no colored word */}
            <header className="space-y-1">
                <h2 className="text-2xl font-display font-medium text-gray-900 tracking-tight">Content Engine</h2>
                <p className="text-gray-500 text-sm">From a source idea to platform-native drafts.</p>
            </header>

            {/* Step indicator — thin, discreet */}
            <div className="flex items-center gap-3">
                {([1,2,3] as const).map((s) => (
                    <React.Fragment key={s}>
                        <button
                            onClick={() => s < step ? setStep(s) : undefined}
                            className={`w-7 h-7 rounded-full text-[11px] font-medium flex items-center justify-center transition-all ${
                                step === s ? 'bg-gray-900 text-white' :
                                step > s   ? 'bg-gray-200 text-gray-700 cursor-pointer hover:bg-gray-300' :
                                             'bg-gray-50 text-gray-400'
                            }`}
                        >{s}</button>
                        {s < 3 && <div className={`flex-1 h-px transition-all ${step > s ? 'bg-gray-300' : 'bg-gray-100'}`} />}
                    </React.Fragment>
                ))}
                <span className="ml-2 text-xs text-gray-400">
                    {step === 1 ? 'Origin' : step === 2 ? 'Parameters' : 'Drafts'}
                </span>
            </div>

            {/* ─── STEP 1: Origin ───────────────────────────────────────── */}
            {step === 1 && (
                <div className="space-y-8 animate-fade-in">
                    <Section title="Where does this post come from?" subtitle="Pick an origin — the engine adapts its voice to it.">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {ORIGINS.map((o) => (
                                <button
                                    key={o.id}
                                    onClick={() => setOrigin(o.id)}
                                    className={`p-5 rounded-2xl border text-left transition-all ${
                                        origin === o.id
                                        ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                                        : 'border-gray-100 bg-white hover:border-gray-300'
                                    }`}
                                >
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
                                        origin === o.id ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-400'
                                    }`}>{React.cloneElement(o.icon as React.ReactElement, { size: 18 })}</div>
                                    <h4 className="font-medium text-sm text-gray-900">{o.label}</h4>
                                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{o.desc}</p>
                                </button>
                            ))}
                        </div>
                    </Section>

                    {/* Source Input per origin */}
                    <Section title="Source" subtitle={originConfig.desc}>
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
                    </Section>

                    <div className="flex justify-end">
                        <button
                            onClick={() => setStep(2)}
                            disabled={!sourceContent}
                            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl font-medium text-sm disabled:opacity-40 hover:bg-gray-700 transition-all"
                        >
                            Next <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* ─── STEP 2: Parameters ───────────────────────────────────── */}
            {step === 2 && (
                <div className="space-y-10 animate-fade-in">

                    {/* Context preview banner — slim, no uppercase */}
                    {sourceContent && (
                        <div className="border-l-2 border-gray-300 pl-3 text-xs text-gray-500 italic">
                            <span className="text-gray-700 not-italic font-medium">{originConfig.label}:</span>{' '}
                            {sourceContent.substring(0, 160)}{sourceContent.length > 160 ? '…' : ''}
                        </div>
                    )}

                    <div className="space-y-10">

                        {/* Target Platforms */}
                        <Section
                            title="Target platforms"
                            subtitle="One draft per platform, length-adapted to each.">
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
                                <p className="text-[11px] text-gray-400">Generating {targetPlatforms.length} draft{targetPlatforms.length > 1 ? 's' : ''} — one per platform, length-adapted.</p>
                            )}
                        </Section>

                        {/* Format */}
                        <Section title="Format" subtitle="The shape the post takes.">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {([
                                    { id: 'single',   label: 'Single post',  icon: '📝' },
                                    { id: 'thread',   label: 'Thread',       icon: '🧵' },
                                    { id: 'longform', label: 'Long-form',    icon: '📰' },
                                    { id: 'comment',  label: 'Comment',      icon: '💬' },
                                ] as const).map(f => (
                                    <button type="button" key={f.id} onClick={() => setFormat(f.id)}
                                        className={`py-2.5 px-3 rounded-xl text-xs font-medium border transition-all flex items-center gap-2 ${
                                            format === f.id
                                            ? 'bg-gray-900 text-white border-gray-900'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                        }`}>
                                        <span>{f.icon}</span>{f.label}
                                    </button>
                                ))}
                            </div>
                        </Section>

                        {/* Voice summary — linked to Content Parameters view */}
                        <Section
                            title="Voice"
                            subtitle={
                                activePreset
                                    ? `Preset · ${VOICE_PRESETS.find(p => p.id === activePreset)?.name} · ${variants} variant${variants > 1 ? 's' : ''}`
                                    : `Custom profile · ${variants} variant${variants > 1 ? 's' : ''} per platform`
                            }
                            aside={
                                onOpenParameters ? (
                                    <button
                                        type="button"
                                        onClick={onOpenParameters}
                                        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:border-gray-400 bg-white text-gray-700 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-[0.97]"
                                    >
                                        <Settings2 size={12} /> Adjust voice
                                    </button>
                                ) : null
                            }
                        >
                            <p className="text-[12px] text-gray-500 leading-relaxed">
                                Voice mix, hook, viral physics, closer and perspective are managed in{' '}
                                <button
                                    type="button"
                                    onClick={onOpenParameters}
                                    className="text-gray-900 underline underline-offset-2 hover:text-gray-700 transition-colors"
                                >Content parameters</button>.
                                Changes there apply to the next generation automatically.
                            </p>
                        </Section>

                        {/* CTA */}
                        <Section title="Call to action" subtitle="How hard you push at the end.">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {([
                                    { id: 'none',   label: 'None',     sub: 'Pure content' },
                                    { id: 'soft',   label: 'Soft',     sub: 'Spark discussion' },
                                    { id: 'medium', label: 'Medium',   sub: 'Learn more' },
                                    { id: 'hard',   label: 'Strong',   sub: 'Trial / signup' },
                                ] as const).map(c => (
                                    <button type="button" key={c.id} onClick={() => setCtaType(c.id)}
                                        className={`py-2.5 px-3 rounded-xl border text-xs font-medium flex flex-col items-start gap-0.5 transition-all ${ctaType === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                                        <span>{c.label}</span>
                                        <span className={`text-[10px] ${ctaType === c.id ? 'opacity-60' : 'text-gray-400'}`}>{c.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </Section>

                    </div>

                    {/* Style inspiration status — lives in Parameters now */}
                    {styleInspiration && (
                        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                            <Wand2 size={11} className="text-gray-400" />
                            Style inspiration loaded ({styleInspiration.length.toLocaleString()} chars) — managed in Parameters.
                        </p>
                    )}

                    {/* DNA Status — slim inline note */}
                    {dnaString && (
                        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                            <Zap size={11} className="text-amber-500" fill="currentColor" />
                            Brand DNA loaded — voice will apply automatically.
                        </p>
                    )}

                    <div className="flex justify-between pt-2">
                        <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-900 transition-all">
                            <ChevronLeft size={16} /> Back
                        </button>
                        <button
                            onClick={handleGenerate}
                            disabled={generating || targetPlatforms.length === 0}
                            className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-medium text-sm disabled:opacity-40 transition-all"
                        >
                            {generating ? <><Loader2 size={16} className="animate-spin" /> Drafting…</> : <><Sparkles size={16} /> Generate</>}
                        </button>
                    </div>
                    {generationError && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs">
                            <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="text-red-800">
                                <span className="font-bold">Generation failed.</span> {generationError}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── STEP 3: Output ───────────────────────────────────────── */}
            {step === 3 && (
                <div className="space-y-8 animate-fade-in">
                    <Section
                        title="Drafts"
                        subtitle={`${drafts.length} platform-adapted post${drafts.length === 1 ? '' : 's'}.`}
                        aside={
                            <>
                                <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-900 transition-all">
                                    <ChevronLeft size={13} /> Tweak
                                </button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-medium disabled:opacity-40 transition-all"
                                >
                                    {generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                    Regenerate
                                </button>
                            </>
                        }
                    >
                        {generating && (
                            <div className="flex items-center justify-center py-16 text-gray-500 gap-3">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-sm">Crafting your drafts…</span>
                            </div>
                        )}

                        <div className="space-y-6">
                            {drafts.map((draft, idx) => (
                                <div key={idx} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                                    {/* Card Header — discreet, no big colored bar */}
                                    <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
                                        <div className="flex items-center gap-2 text-gray-700">
                                            <span className={`w-6 h-6 rounded-md flex items-center justify-center ${
                                                draft.platform === 'X' ? 'bg-gray-900 text-white' :
                                                draft.platform === 'LinkedIn' ? 'bg-blue-600 text-white' :
                                                draft.platform === 'Reddit' ? 'bg-orange-500 text-white' :
                                                'bg-purple-600 text-white'
                                            }`}>{PLATFORM_ICONS[draft.platform]}</span>
                                            <span className="font-medium text-sm text-gray-900">{draft.platform}</span>
                                            <span className="text-gray-400 text-xs">· {draft.hookUsed}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {draft.platform === 'X' && (
                                                <a href="https://x.com/compose/tweet" target="_blank" rel="noreferrer"
                                                   className="p-1.5 hover:bg-gray-100 rounded-md text-gray-500 transition-all">
                                                    <ExternalLink size={13} />
                                                </a>
                                            )}
                                            {draft.platform === 'LinkedIn' && (
                                                <a href="https://www.linkedin.com/feed/" target="_blank" rel="noreferrer"
                                                   className="p-1.5 hover:bg-gray-100 rounded-md text-gray-500 transition-all">
                                                    <ExternalLink size={13} />
                                                </a>
                                            )}
                                            <button onClick={() => copy(draft.content, idx)}
                                                className="flex items-center gap-1 px-2.5 py-1 hover:bg-gray-100 rounded-md text-xs text-gray-600 font-medium transition-all">
                                                {copiedIdx === idx ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="p-5">
                                        {(draft.variantNote || draft.voiceProfile) && (
                                            <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-gray-500">
                                                {draft.variantNote && (
                                                    <span className="flex items-center gap-1">
                                                        <Layers size={10} /> {draft.variantNote}
                                                    </span>
                                                )}
                                                {draft.voiceProfile && (
                                                    <span className="flex items-center gap-1 italic">
                                                        <Eye size={10} /> {draft.voiceProfile}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <div className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap font-sans">
                                            {draft.content}
                                        </div>

                                        {draft.tips.length > 0 && (
                                            <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                                                {draft.tips.map((tip, i) => (
                                                    <span key={i} className="flex items-center gap-1">
                                                        <Sparkles size={10} className="text-amber-500" /> {tip}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* Start Over */}
                    <div className="text-center">
                        <button onClick={() => { setStep(1); setDrafts([]); setSourceContent(''); setSourceUrl(''); }}
                            className="text-xs text-gray-400 hover:text-gray-700 transition-colors underline underline-offset-4">
                            Start a new draft
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════
// VOICE ARCHITECTURE SECTION
// ════════════════════════════════════════════════════════════════════
export const VoiceArchitectureSection: React.FC<{
    activePreset: string | null; applyPreset: (id: string) => void;
    voiceMix: VoiceMix; customizeVoice: (p: Partial<VoiceMix>) => void;
    setVoiceMix: React.Dispatch<React.SetStateAction<VoiceMix>>; setActivePreset: (id: string | null) => void;
    hook: HookArchitecture; customizeHook: (p: Partial<HookArchitecture>) => void;
    perspective: PerspectiveInjector; setPerspective: React.Dispatch<React.SetStateAction<PerspectiveInjector>>;
    viral: ViralPhysics; toggleViral: (k: keyof ViralPhysics) => void;
    closer: CloserStrategy; setCloser: (c: CloserStrategy) => void;
    variants: number; setVariants: (n: number) => void;
    onAiAutoSet: () => void;
    aiSuggesting: boolean;
    aiSuggestionReason: string | null;
    aiSuggestError: string | null;
    sourceContent: string;
    onOpenQuiz: () => void;
}> = ({
    activePreset, applyPreset, voiceMix, customizeVoice, setVoiceMix, setActivePreset,
    hook, customizeHook, perspective, setPerspective, viral, toggleViral, closer, setCloser, variants, setVariants,
    onAiAutoSet, aiSuggesting, aiSuggestionReason, aiSuggestError, sourceContent, onOpenQuiz
}) => (
    <Section
        title="Voice"
        subtitle={
            aiSuggestionReason ? aiSuggestionReason :
            activePreset ? `Preset · ${VOICE_PRESETS.find(p => p.id === activePreset)?.name}` :
            'Custom voice profile — saved automatically.'
        }
        aside={
            <>
                <button
                    type="button"
                    onClick={onOpenQuiz}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-medium transition-all"
                >
                    <span>🎙️</span>
                    Voice match
                </button>
                {/* AI calibrate — always clickable. If a sample is missing,
                    the parent's onAiAutoSet handles the feedback (scroll +
                    flash on the calibration sample field). Disabling the
                    button was the root of "AI calibrate doesn't work" — it
                    was greyed out and the prereq lived below the fold. */}
                <button
                    type="button"
                    onClick={onAiAutoSet}
                    disabled={aiSuggesting}
                    title={!sourceContent.trim() ? 'Click to set up calibration — needs a writing sample' : 'Let AI calibrate the voice for your context'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        aiSuggesting
                            ? 'opacity-60 cursor-wait bg-white border-gray-200 text-gray-700'
                            : !sourceContent.trim()
                                ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 hover:border-amber-400'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'
                    }`}
                >
                    {aiSuggesting ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                    {aiSuggesting ? 'Analyzing…' : !sourceContent.trim() ? 'AI calibrate — needs sample' : 'AI calibrate'}
                </button>
                <button
                    type="button"
                    onClick={() => { setVoiceMix(DEFAULT_VOICE_MIX); setActivePreset(null); }}
                    className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors px-1"
                >Reset</button>
            </>
        }
    >
        <div className="space-y-8">
            {/* AI calibrate error */}
            {aiSuggestError && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 font-medium leading-relaxed">{aiSuggestError}</div>
                </div>
            )}

            {/* QUICK PRESETS — chips, no eyebrow label */}
            <div>
                <div className="flex flex-wrap gap-2">
                    {VOICE_PRESETS.map(p => (
                        <button key={p.id} type="button" onClick={() => applyPreset(p.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                                activePreset === p.id
                                  ? 'border-gray-900 bg-gray-900 text-white'
                                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                            }`}>
                            <span>{p.emoji}</span> {p.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* INTERACTIVE POLYGON */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
                <div className="lg:col-span-3 flex flex-col items-center">
                    <InteractivePolygon mix={voiceMix} onChange={(patch) => customizeVoice(patch)} />
                    <p className="text-[11px] text-gray-400 mt-2 text-center">
                        Drag a vertex to adjust. Click an axis to snap.
                    </p>
                </div>
                <div className="lg:col-span-2 space-y-1.5">
                    {VOICE_DIMENSIONS.map(dim => (
                        <PolygonValueRow key={dim.key} label={dim.label} value={voiceMix[dim.key]}
                            low={dim.low} high={dim.high} />
                    ))}
                </div>
            </div>

            {/* Rhythm */}
            <SubSection title="Rhythm" hint="How sentences move.">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {([
                        { id: 'staccato', label: 'Staccato', desc: 'Short. Bursts.' },
                        { id: 'punchy', label: 'Punchy', desc: 'Short, sometimes long.' },
                        { id: 'flowing', label: 'Flowing', desc: 'Long, momentum.' },
                        { id: 'contemplative', label: 'Contemplative', desc: 'Paused, deliberate.' },
                    ] as const).map(r => (
                        <button key={r.id} type="button" onClick={() => customizeVoice({ rhythm: r.id })}
                            className={`p-2.5 rounded-xl text-left text-xs border transition-all ${
                                voiceMix.rhythm === r.id
                                  ? 'bg-gray-900 text-white border-gray-900'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                            }`}>
                            <div className="font-medium">{r.label}</div>
                            <div className={`text-[10px] mt-0.5 ${voiceMix.rhythm === r.id ? 'text-white/60' : 'text-gray-400'}`}>{r.desc}</div>
                        </button>
                    ))}
                </div>
            </SubSection>

            {/* Hook — Visual sentence treatment.
                Instead of 3 stacked vertical button lists, render the 3 hook
                pieces as an editable English sentence. Each bracketed phrase
                opens a dropdown chooser on click. Reads like prose, edits
                like a form. */}
            <SubSection title="Hook" hint="The first three lines decide everything.">
                <HookSentence hook={hook} onChange={customizeHook} />
            </SubSection>

            {/* Viral Physics — row of illuminated bulbs.
                One bulb per amplifier: bright = active, dim = inactive. Hover
                for the description. Click to toggle. Replaces the heavy
                2-col grid of card-style toggles. */}
            <SubSection title="Amplifiers" hint="Psychological levers — tap a bulb to activate.">
                <AmplifierBulbs viral={viral} toggle={toggleViral} />
            </SubSection>

            {/* Closer */}
            <SubSection title="Closer" hint="How the post lands.">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {CLOSERS.map(c => (
                        <button key={c.id} type="button" onClick={() => setCloser(c.id)}
                            className={`p-2.5 rounded-xl text-left text-xs border transition-all ${
                                closer === c.id
                                  ? 'bg-gray-900 text-white border-gray-900'
                                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                            }`}>
                            <div className="font-medium">{c.label}</div>
                            <div className={`text-[10px] mt-0.5 ${closer === c.id ? 'text-white/60' : 'text-gray-400'}`}>{c.desc}</div>
                        </button>
                    ))}
                </div>
            </SubSection>

            {/* Variants */}
            <SubSection title="Variants per platform" hint={`${variants} angle${variants > 1 ? 's' : ''} — same voice, different attack.`}>
                <div className="flex items-center gap-4">
                    <input type="range" min={1} max={5} value={variants} onChange={e => setVariants(parseInt(e.target.value))}
                        className="flex-1 accent-gray-900" />
                    <span className="text-xl font-medium text-gray-900 w-8 text-right">{variants}</span>
                </div>
            </SubSection>

            {/* Perspective — Mad Libs paragraph.
                Renders all four perspective fields as a single prose paragraph
                with click-to-edit inline blanks. Feels like a character sheet
                you read, not 4 generic textareas to fill. */}
            <SubSection title="Perspective" hint="Reads like prose — click any blank to edit. Saved automatically.">
                <PerspectiveParagraph perspective={perspective} setPerspective={setPerspective} />
            </SubSection>
        </div>
    </Section>
);

// ────────────────────────────────────────────────────────────────────
// HOOK SENTENCE — the Hook section as an editable English sentence.
// Each bracketed phrase is a Pill that opens a popover with the options.
// Prose-first; the underlying state model is identical to the old grid.
// ────────────────────────────────────────────────────────────────────
const HookSentence: React.FC<{
    hook: HookArchitecture;
    onChange: (patch: Partial<HookArchitecture>) => void;
}> = ({ hook, onChange }) => {
    const patternLabel = PATTERN_INTERRUPTS.find(p => p.id === hook.patternInterrupt)?.label || '—';
    const tensionLabel = TENSION_MECHANISMS.find(t => t.id === hook.tensionMechanism)?.label || '—';
    const payoffLabel = PROMISE_PAYOFFS.find(p => p.id === hook.promisePayoff)?.label || '—';

    return (
        <div className="p-5 bg-gray-50/60 border border-gray-200 rounded-2xl">
            {/* The sentence — readable, with inline chips. */}
            <p className="text-base md:text-lg leading-relaxed text-gray-800 font-medium flex flex-wrap gap-2 items-baseline">
                <span>Open with a</span>
                <HookPill
                    label={patternLabel}
                    options={PATTERN_INTERRUPTS.map(o => ({ id: o.id, label: o.label, hint: o.example }))}
                    value={hook.patternInterrupt}
                    onSelect={(v) => onChange({ patternInterrupt: v as HookArchitecture['patternInterrupt'] })}
                />
                <span>, pull readers in by</span>
                <HookPill
                    label={tensionLabel.toLowerCase()}
                    options={TENSION_MECHANISMS.map(o => ({ id: o.id, label: o.label, hint: o.desc }))}
                    value={hook.tensionMechanism}
                    onSelect={(v) => onChange({ tensionMechanism: v as HookArchitecture['tensionMechanism'] })}
                />
                <span>, and promise them</span>
                <HookPill
                    label={payoffLabel.toLowerCase()}
                    options={PROMISE_PAYOFFS.map(o => ({ id: o.id, label: o.label, hint: o.desc }))}
                    value={hook.promisePayoff}
                    onSelect={(v) => onChange({ promisePayoff: v as HookArchitecture['promisePayoff'] })}
                />
                <span>.</span>
            </p>
            <p className="text-[11px] text-gray-400 mt-3">Click any chip to swap. The first three lines decide everything.</p>
        </div>
    );
};

// Inline editable chip used inside HookSentence. Click to open a popover
// with options. Closes on outside-click or selection.
const HookPill: React.FC<{
    label: string;
    value: string;
    options: { id: string; label: string; hint: string }[];
    onSelect: (id: string) => void;
}> = ({ label, value, options, onSelect }) => {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const onClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener('mousedown', onClickOutside);
        return () => window.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    return (
        <span ref={ref} className="relative inline-block">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md border-b-2 border-dashed transition-colors ${
                    open
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-amber-100/60 text-amber-900 border-amber-400 hover:bg-amber-200/70'
                }`}
            >
                <span className="font-bold">{label}</span>
                <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute left-0 top-full mt-1 z-30 min-w-[260px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                    {options.map(o => (
                        <button
                            key={o.id}
                            type="button"
                            onClick={() => { onSelect(o.id); setOpen(false); }}
                            className={`w-full text-left px-3 py-2 transition-colors ${
                                value === o.id
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                        >
                            <div className="text-sm font-bold">{o.label}</div>
                            <div className={`text-[11px] mt-0.5 ${value === o.id ? 'text-white/70' : 'text-gray-500'}`}>{o.hint}</div>
                        </button>
                    ))}
                </div>
            )}
        </span>
    );
};

// ────────────────────────────────────────────────────────────────────
// AMPLIFIER BULBS — 8 amplifiers rendered as illuminated lightbulbs.
// On = saturated amber + halo; off = dim grey. Tooltip on hover.
// ────────────────────────────────────────────────────────────────────
const AmplifierBulbs: React.FC<{
    viral: ViralPhysics;
    toggle: (key: keyof ViralPhysics) => void;
}> = ({ viral, toggle }) => {
    const activeCount = VIRAL_TOGGLES.filter(t => viral[t.key]).length;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-3 p-5 bg-gradient-to-b from-gray-50 to-white border border-gray-200 rounded-2xl">
                {VIRAL_TOGGLES.map(t => {
                    const on = viral[t.key];
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => toggle(t.key)}
                            title={`${t.label} — ${t.desc}`}
                            className="group flex flex-col items-center gap-2 px-2 py-2 rounded-xl hover:bg-white/60 transition-colors min-w-[88px]"
                        >
                            {/* The bulb */}
                            <div className="relative w-10 h-10 flex items-center justify-center">
                                {on && (
                                    <span className="absolute inset-0 rounded-full bg-amber-300/60 blur-md animate-pulse"></span>
                                )}
                                <div className={`relative w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                                    on
                                        ? 'bg-gradient-to-b from-amber-300 to-amber-500 border-amber-500 shadow-lg shadow-amber-300/50'
                                        : 'bg-gray-100 border-gray-300 group-hover:border-gray-400'
                                }`}>
                                    <Zap size={14} className={on ? 'text-amber-900' : 'text-gray-400'} fill={on ? 'currentColor' : 'none'} />
                                </div>
                            </div>
                            <span className={`text-[10px] font-bold leading-tight text-center max-w-[88px] ${on ? 'text-gray-900' : 'text-gray-400'}`}>
                                {t.label}
                            </span>
                        </button>
                    );
                })}
            </div>
            <p className="text-[11px] text-gray-400">
                {activeCount === 0
                    ? 'No amplifiers active — output will lean neutral.'
                    : `${activeCount} amplifier${activeCount > 1 ? 's' : ''} on — hover any bulb to read what it does.`}
            </p>
        </div>
    );
};

// ────────────────────────────────────────────────────────────────────
// PERSPECTIVE PARAGRAPH — Mad Libs prose. Renders the four perspective
// fields as a single readable paragraph with click-to-edit blanks.
// ────────────────────────────────────────────────────────────────────
const PerspectiveParagraph: React.FC<{
    perspective: PerspectiveInjector;
    setPerspective: React.Dispatch<React.SetStateAction<PerspectiveInjector>>;
}> = ({ perspective, setPerspective }) => (
    <div className="p-5 bg-gray-50/60 border border-gray-200 rounded-2xl">
        <p className="text-base leading-loose text-gray-800 font-medium">
            <span>I'm someone who </span>
            <PerspectiveBlank
                value={perspective.uniqueAngle}
                placeholder="ships 47 failed products before this one"
                color="emerald"
                onChange={v => setPerspective(p => ({ ...p, uniqueAngle: v }))}
            />
            <span>. Most people get </span>
            <PerspectiveBlank
                value={perspective.contrarian}
                placeholder="PMF is a lie — it's just retention with better marketing"
                color="rose"
                onChange={v => setPerspective(p => ({ ...p, contrarian: v }))}
            />
            <span> wrong. My receipts: </span>
            <PerspectiveBlank
                value={perspective.receipts}
                placeholder="$2,847 MRR, 18 months bootstrap, 4 failed launches"
                color="indigo"
                onChange={v => setPerspective(p => ({ ...p, receipts: v }))}
            />
            <span>. Never write: </span>
            <PerspectiveBlank
                value={perspective.forbiddenTakes}
                placeholder="'Hustle culture is essential', 'Move fast and break things'"
                color="amber"
                onChange={v => setPerspective(p => ({ ...p, forbiddenTakes: v }))}
            />
            <span>.</span>
        </p>
    </div>
);

// Inline contenteditable-style blank used inside PerspectiveParagraph.
// Renders as a colored underline-pill when filled, dashed placeholder
// when empty. Tap to expand into a full editable textarea inline.
const PerspectiveBlank: React.FC<{
    value: string;
    placeholder: string;
    color: 'emerald' | 'rose' | 'indigo' | 'amber';
    onChange: (v: string) => void;
}> = ({ value, placeholder, color, onChange }) => {
    const [editing, setEditing] = React.useState(false);
    const ref = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        if (editing && ref.current) ref.current.focus();
    }, [editing]);

    const colorMap = {
        emerald: { bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-900', empty: 'border-emerald-300 text-emerald-600' },
        rose:    { bg: 'bg-rose-50',    border: 'border-rose-400',    text: 'text-rose-900',    empty: 'border-rose-300 text-rose-600' },
        indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-400',  text: 'text-indigo-900',  empty: 'border-indigo-300 text-indigo-600' },
        amber:   { bg: 'bg-amber-50',   border: 'border-amber-400',   text: 'text-amber-900',   empty: 'border-amber-300 text-amber-600' },
    };
    const c = colorMap[color];

    if (editing) {
        return (
            <textarea
                ref={ref}
                rows={2}
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={() => setEditing(false)}
                placeholder={placeholder}
                className={`inline-block w-full max-w-md px-3 py-2 my-1 ${c.bg} ${c.border} border-2 ${c.text} rounded-lg text-sm font-medium outline-none resize-none align-middle`}
            />
        );
    }

    return (
        <button
            type="button"
            onClick={() => setEditing(true)}
            className={`inline px-2 py-0.5 rounded-md text-sm font-bold align-baseline border-b-2 border-dashed transition-colors ${
                value
                    ? `${c.bg} ${c.text} ${c.border} hover:brightness-95`
                    : `bg-white ${c.empty} italic hover:bg-gray-50`
            }`}
        >
            {value || `[ click to add — e.g. ${placeholder.slice(0, 40)}${placeholder.length > 40 ? '…' : ''} ]`}
        </button>
    );
};

// ────────── Helper components ──────────
const VoiceSlider: React.FC<{ label: string; low: string; high: string; value: number; onChange: (v: number) => void }> = ({ label, low, high, value, onChange }) => (
    <div>
        <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-gray-700">{label}</span>
            <span className="text-[10px] font-mono text-gray-500">{value}/100</span>
        </div>
        <input type="range" min={0} max={100} value={value} onChange={e => onChange(parseInt(e.target.value))}
            className="w-full accent-amber-500" />
        <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
            <span>{low}</span>
            <span>{high}</span>
        </div>
    </div>
);

const HookSelector: React.FC<{ label: string; sub: string; options: { id: string; label: string; hint: string }[]; value: string; onChange: (v: string) => void }> = ({ label, sub, options, value, onChange }) => (
    <div>
        <div className="text-[12px] font-medium text-gray-900">{label}</div>
        <div className="text-[11px] text-gray-400 mb-2">{sub}</div>
        <div className="space-y-1">
            {options.map(o => (
                <button key={o.id} type="button" onClick={() => onChange(o.id)}
                    className={`w-full text-left p-2 rounded-lg text-xs transition-all ${
                        value === o.id
                          ? 'bg-gray-900 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
                    }`}>
                    <div className="font-medium">{o.label}</div>
                    <div className={`text-[10px] mt-0.5 ${value === o.id ? 'text-white/60' : 'text-gray-500'}`}>{o.hint}</div>
                </button>
            ))}
        </div>
    </div>
);

const PerspectiveField: React.FC<{ label: string; placeholder: string; icon: React.ReactNode; value: string; onChange: (v: string) => void }> = ({ label, placeholder, icon, value, onChange }) => (
    <div>
        <div className="flex items-center gap-1.5 mb-1">
            <span className="text-gray-400">{icon}</span>
            <span className="text-[12px] text-gray-700">{label}</span>
        </div>
        <textarea rows={2} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 placeholder-gray-300 resize-none leading-relaxed" />
    </div>
);

// ──────────────────────────────────────────────────────────────
// INTERACTIVE POLYGON — drag vertices to adjust voice mix values
// ──────────────────────────────────────────────────────────────
const InteractivePolygon: React.FC<{ mix: VoiceMix; onChange: (patch: Partial<VoiceMix>) => void }> = ({ mix, onChange }) => {
    const dims = VOICE_DIMENSIONS;
    const size = 320;
    const center = size / 2;
    const radius = 110;
    const svgRef = React.useRef<SVGSVGElement>(null);
    const [dragging, setDragging] = React.useState<number | null>(null);
    const [hovering, setHovering] = React.useState<number | null>(null);

    const angles = dims.map((_, i) => (Math.PI * 2 * i) / dims.length - Math.PI / 2);

    const vertexAt = (i: number, value: number) => {
        const a = angles[i];
        const r = (value / 100) * radius;
        return [center + r * Math.cos(a), center + r * Math.sin(a)];
    };

    const labelAt = (i: number) => {
        const a = angles[i];
        return [center + (radius + 22) * Math.cos(a), center + (radius + 22) * Math.sin(a)];
    };

    const points = dims.map((d, i) => vertexAt(i, mix[d.key]));

    // Project mouse coords onto the dragging axis to get new value
    const projectMouseToValue = React.useCallback((clientX: number, clientY: number, axisIdx: number) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return null;
        // Convert client → SVG user coords (assuming viewBox = size x size)
        const x = ((clientX - rect.left) / rect.width) * size;
        const y = ((clientY - rect.top) / rect.height) * size;
        // Vector from center
        const dx = x - center;
        const dy = y - center;
        // Project onto axis direction
        const ax = Math.cos(angles[axisIdx]);
        const ay = Math.sin(angles[axisIdx]);
        const projection = dx * ax + dy * ay; // scalar distance along axis
        const clamped = Math.max(0, Math.min(radius, projection));
        return Math.round((clamped / radius) * 100);
    }, [angles]);

    React.useEffect(() => {
        if (dragging === null) return;
        const onMove = (e: MouseEvent | TouchEvent) => {
            const evt = 'touches' in e ? e.touches[0] : (e as MouseEvent);
            if (!evt) return;
            const value = projectMouseToValue(evt.clientX, evt.clientY, dragging);
            if (value === null) return;
            const key = dims[dragging].key;
            onChange({ [key]: value } as Partial<VoiceMix>);
        };
        const onUp = () => setDragging(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchend', onUp);
        };
    }, [dragging, dims, onChange, projectMouseToValue]);

    // Click anywhere on an axis line to snap-set value
    const handleAxisClick = (e: React.MouseEvent, axisIdx: number) => {
        const value = projectMouseToValue(e.clientX, e.clientY, axisIdx);
        if (value === null) return;
        const key = dims[axisIdx].key;
        onChange({ [key]: value } as Partial<VoiceMix>);
    };

    const gridLevels = [0.25, 0.5, 0.75, 1];
    return (
        <svg ref={svgRef} width="100%" height="auto" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: 380, touchAction: 'none', userSelect: 'none' }}>
            {/* Concentric hex grid */}
            {gridLevels.map(level => {
                const pts = dims.map((_, i) => {
                    const r = level * radius;
                    return `${center + r * Math.cos(angles[i])},${center + r * Math.sin(angles[i])}`;
                }).join(' ');
                return <polygon key={level} points={pts} fill={level === 1 ? 'rgba(0,0,0,0.02)' : 'none'} stroke="#e5e7eb" strokeWidth={1} strokeDasharray={level < 1 ? '3,3' : '0'} />;
            })}
            {/* Axis lines (clickable to set value) */}
            {dims.map((_, i) => {
                const a = angles[i];
                const x2 = center + radius * Math.cos(a);
                const y2 = center + radius * Math.sin(a);
                return (
                    <line key={i} x1={center} y1={center} x2={x2} y2={y2}
                        stroke="#d1d5db" strokeWidth={1}
                        style={{ cursor: 'crosshair' }}
                        onClick={(e) => handleAxisClick(e, i)} />
                );
            })}
            {/* Voice shape */}
            <polygon
                points={points.map(p => p.join(',')).join(' ')}
                fill="url(#voiceGradient)"
                stroke="#f59e0b"
                strokeWidth={2.5}
                strokeLinejoin="round"
                style={{ pointerEvents: 'none', filter: 'drop-shadow(0 4px 12px rgba(245,158,11,0.25))' }}
            />
            <defs>
                <radialGradient id="voiceGradient" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(251, 191, 36, 0.5)" />
                    <stop offset="100%" stopColor="rgba(245, 158, 11, 0.3)" />
                </radialGradient>
            </defs>
            {/* Draggable vertex dots */}
            {points.map((p, i) => {
                const isActive = dragging === i || hovering === i;
                return (
                    <g key={i}>
                        {/* Wider invisible hit area for easier grabbing */}
                        <circle cx={p[0]} cy={p[1]} r={16} fill="transparent"
                            style={{ cursor: dragging === i ? 'grabbing' : 'grab' }}
                            onMouseDown={(e) => { e.preventDefault(); setDragging(i); }}
                            onTouchStart={(e) => { e.preventDefault(); setDragging(i); }}
                            onMouseEnter={() => setHovering(i)}
                            onMouseLeave={() => setHovering(null)}
                        />
                        <circle cx={p[0]} cy={p[1]} r={isActive ? 8 : 6}
                            fill={isActive ? '#dc2626' : '#f59e0b'}
                            stroke="#fff" strokeWidth={2.5}
                            style={{ transition: 'r 0.15s, fill 0.15s', pointerEvents: 'none', filter: isActive ? 'drop-shadow(0 0 6px rgba(245,158,11,0.6))' : 'none' }}
                        />
                        {/* Value tooltip on hover/drag */}
                        {isActive && (
                            <g style={{ pointerEvents: 'none' }}>
                                <rect x={p[0] - 18} y={p[1] - 28} width={36} height={18} rx={4} fill="#111827" />
                                <text x={p[0]} y={p[1] - 16} fontSize={11} fontWeight={700} fill="#fff"
                                    textAnchor="middle" dominantBaseline="middle">
                                    {mix[dims[i].key]}
                                </text>
                            </g>
                        )}
                    </g>
                );
            })}
            {/* Axis labels */}
            {dims.map((d, i) => {
                const [lx, ly] = labelAt(i);
                const isActive = dragging === i || hovering === i;
                return (
                    <text key={i} x={lx} y={ly} fontSize={10} fontWeight={isActive ? 800 : 700}
                        fill={isActive ? '#111827' : '#475569'}
                        textAnchor="middle" dominantBaseline="middle">
                        {d.label}
                    </text>
                );
            })}
        </svg>
    );
};

// Live values panel next to polygon — minimal row, no box
const PolygonValueRow: React.FC<{ label: string; value: number; low: string; high: string }> = ({ label, value, low, high }) => {
    const descriptor = value < 25 ? low : value > 75 ? high : 'balanced';
    return (
        <div className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 last:border-b-0">
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-medium text-gray-900">{label}</span>
                <span className="text-[10px] text-gray-400 truncate">{descriptor}</span>
            </div>
            <span className="text-xs font-mono text-gray-700 flex-shrink-0">{value}</span>
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════
// VOICE MATCH — Personality quiz that configures the voice architecture
// ════════════════════════════════════════════════════════════════════
type QuizOption = {
    id: string;
    sample: string;
    deltas: Partial<VoiceMix> & { rhythm?: VoiceMix['rhythm'] };
    hook?: Partial<HookArchitecture>;
    viral?: Partial<ViralPhysics>;
    closer?: CloserStrategy;
    weight: number; // contribution to persona name
};

type QuizQuestion = {
    id: string;
    prompt: string;
    subtitle: string;
    options: QuizOption[];
};

// ────────────────────────────────────────────────────────────────────
// QUIZ — 7 calibrated questions covering 6 dimensions of voice.
// Each option contributes WEIGHTED deltas so the final result is the
// average of stated preferences — not a runaway accumulation. The persona
// is inferred by matching the resulting voice vector against known
// presets via cosine distance, falling back to a transparent
// "Trait · Trait · Rhythm" descriptor when no preset is close enough.
// ────────────────────────────────────────────────────────────────────
const QUIZ_QUESTIONS: QuizQuestion[] = [
    {
        id: 'voice',
        prompt: 'When you\'re most convincing, you sound like…',
        subtitle: 'Pick the one that feels most like you on a good day.',
        options: [
            {
                id: 'confession',
                sample: '"I shipped 47 failed products before this one. Here\'s what every single one taught me."',
                deltas: { vulnerability: 30, intimacy: 18, specificity: 8, authority: -3 },
                hook: { patternInterrupt: 'taboo_confession', tensionMechanism: 'pain_mirror' },
                viral: { concessionMove: true },
                weight: 1
            },
            {
                id: 'data',
                sample: '"Revenue: $2,847. Hours: 6. Tools: 3. Customers: 8."',
                deltas: { specificity: 30, authority: 18, vulnerability: -10, energy: -3 },
                hook: { patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap' },
                viral: { forbiddenSpecificity: true, statusCurrency: true },
                weight: 1
            },
            {
                id: 'provocation',
                sample: '"PMF is a lie sold by VCs to founders who haven\'t done the work."',
                deltas: { provocation: 30, authority: 18, vulnerability: -10 },
                hook: { patternInterrupt: 'forbidden_statement', tensionMechanism: 'cognitive_dissonance' },
                viral: { tribalFraming: true, baitAndSwitch: true },
                weight: 1
            }
        ]
    },
    {
        id: 'tempo',
        prompt: 'Your sentences feel like…',
        subtitle: 'The pace at which you naturally write.',
        options: [
            {
                id: 'staccato',
                sample: '"Built it. Shipped it. Got 8 users. $355 each. Now what?"',
                deltas: { energy: 20, rhythm: 'staccato', intimacy: 6 },
                weight: 1
            },
            {
                id: 'flowing',
                sample: '"I started with one idea, then realized the problem was bigger than I thought, and the solution had to evolve with every new user I talked to."',
                deltas: { energy: 4, rhythm: 'flowing', vulnerability: 8 },
                weight: 1
            },
            {
                id: 'contemplative',
                sample: '"I waited. Then I listened. The market told me everything — eventually."',
                deltas: { energy: -12, rhythm: 'contemplative', authority: 8 },
                weight: 1
            }
        ]
    },
    {
        id: 'distance',
        prompt: 'Your relationship to the reader is…',
        subtitle: 'How close do you get?',
        options: [
            {
                id: 'friend',
                sample: '"Listen — between you and me, this changed everything. You\'re going to want to try it."',
                deltas: { intimacy: 28, vulnerability: 8, authority: -4 },
                closer: 'open_question',
                weight: 1
            },
            {
                id: 'mentor',
                sample: '"Here\'s the model. Three principles. Apply them in this order: first X, then Y, then Z."',
                deltas: { authority: 24, specificity: 12, intimacy: -8 },
                closer: 'soft_proof',
                weight: 1
            },
            {
                id: 'insider',
                sample: '"What I\'m about to share, most agencies will hate me for. But you deserve to know."',
                deltas: { intimacy: 12, authority: 16, provocation: 12 },
                viral: { forbiddenSpecificity: true, inGroupSignaling: true },
                closer: 'open_loop',
                weight: 1
            }
        ]
    },
    {
        id: 'weapon',
        prompt: 'Your strongest weapon is…',
        subtitle: 'What you reach for when you really want to land.',
        options: [
            {
                id: 'numbers',
                sample: '"$0 → $10k MRR in 47 days. Here\'s the exact stack."',
                deltas: { specificity: 22, authority: 12 },
                hook: { patternInterrupt: 'shocking_number', promisePayoff: 'what_to_learn' },
                viral: { statusCurrency: true, fortuneCookieClose: true },
                closer: 'soft_proof',
                weight: 1
            },
            {
                id: 'story',
                sample: '"I almost quit. Yesterday. Here\'s what changed my mind."',
                deltas: { vulnerability: 22, intimacy: 12 },
                hook: { patternInterrupt: 'taboo_confession', promisePayoff: 'what_to_feel' },
                viral: { concessionMove: true },
                closer: 'open_question',
                weight: 1
            },
            {
                id: 'forbidden',
                sample: '"Stop telling founders to \'just talk to users\'. Here\'s what actually works."',
                deltas: { provocation: 22, authority: 12 },
                hook: { patternInterrupt: 'forbidden_statement', promisePayoff: 'what_to_avoid' },
                viral: { baitAndSwitch: true, tribalFraming: true },
                closer: 'reverse_cta',
                weight: 1
            }
        ]
    },
    {
        id: 'feeling',
        prompt: 'After reading you, the reader should feel…',
        subtitle: 'The emotional residue you want to leave.',
        options: [
            {
                id: 'seen',
                sample: '"Yeah, I\'ve been there too. Here\'s what I wish someone had told me."',
                deltas: { intimacy: 16, vulnerability: 14, provocation: -6 },
                viral: { concessionMove: true },
                closer: 'open_question',
                weight: 1
            },
            {
                id: 'sharper',
                sample: '"You can stop scrolling now. You have what you need."',
                deltas: { specificity: 16, authority: 12, energy: 6 },
                viral: { fortuneCookieClose: true, statusCurrency: true },
                closer: 'punchline',
                weight: 1
            },
            {
                id: 'shaken',
                sample: '"If you finished that and felt nothing — you\'re not the audience."',
                deltas: { provocation: 18, authority: 8, intimacy: -4 },
                viral: { tribalFraming: true, baitAndSwitch: true },
                closer: 'reverse_cta',
                weight: 1
            },
            {
                id: 'curious',
                sample: '"There\'s a second part to this. But you won\'t need it if you do part one right."',
                deltas: { authority: 10, specificity: 6, energy: 4 },
                viral: { loopOpener: true },
                hook: { tensionMechanism: 'curiosity_gap' },
                closer: 'open_loop',
                weight: 1
            }
        ]
    },
    {
        id: 'proof',
        prompt: 'Where do you draw credibility from?',
        subtitle: 'How you prove you\'re worth listening to.',
        options: [
            {
                id: 'receipts',
                sample: '"Six months. Three pivots. $2,847 MRR. Numbers don\'t lie — and neither do I."',
                deltas: { specificity: 22, authority: 14 },
                viral: { forbiddenSpecificity: true, statusCurrency: true },
                hook: { promisePayoff: 'what_to_learn' },
                weight: 1
            },
            {
                id: 'scars',
                sample: '"I\'ve made every mistake on this list. The list is the proof."',
                deltas: { vulnerability: 20, intimacy: 10, authority: 6 },
                viral: { concessionMove: true },
                weight: 1
            },
            {
                id: 'pattern',
                sample: '"I\'ve watched 40 founders try this. 36 broke the same way. Here\'s the pattern."',
                deltas: { authority: 18, specificity: 14, intimacy: -4 },
                hook: { tensionMechanism: 'forbidden_knowledge' },
                viral: { inGroupSignaling: true },
                weight: 1
            }
        ]
    },
    {
        id: 'stance',
        prompt: 'When someone pushes back on your post, you…',
        subtitle: 'Your default posture under disagreement.',
        options: [
            {
                id: 'concede',
                sample: '"Fair — there\'s a version of this where you\'re right. Here\'s where I think you\'re missing it."',
                deltas: { vulnerability: 14, intimacy: 8, provocation: -10 },
                viral: { concessionMove: true },
                weight: 1
            },
            {
                id: 'sharpen',
                sample: '"That\'s the surface read. The deeper one is harder to swallow. Let me unpack it."',
                deltas: { authority: 14, specificity: 8, provocation: 6 },
                viral: { statusCurrency: true },
                weight: 1
            },
            {
                id: 'press',
                sample: '"You\'re wrong. Here\'s why — and why most people who disagree haven\'t built the thing."',
                deltas: { provocation: 18, authority: 10, intimacy: -8 },
                viral: { tribalFraming: true, baitAndSwitch: true },
                weight: 1
            }
        ]
    }
];

function clamp01_100(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

// Cosine similarity between two VoiceMix vectors (numeric dimensions only)
function voiceVector(m: VoiceMix): number[] {
    return [m.authority, m.energy, m.vulnerability, m.provocation, m.specificity, m.intimacy];
}
function cosineSim(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function computePersonaResult(answers: QuizOption[]): {
    voiceMix: VoiceMix;
    hook: HookArchitecture;
    viral: ViralPhysics;
    closer: CloserStrategy;
    personaName: string;
    tagline: string;
    sampleLine: string;
    confidence: number;        // 0-100, how confident we are in the match
    closestPreset: string | null;
} {
    // Mid-point baseline so a single "extreme" answer doesn't dominate.
    let mix: VoiceMix = { authority: 50, energy: 50, vulnerability: 50, provocation: 50, specificity: 50, intimacy: 50, rhythm: 'punchy' };
    let hook: HookArchitecture = { patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap', promisePayoff: 'what_to_avoid' };
    let viral: ViralPhysics = { statusCurrency: false, inGroupSignaling: false, tribalFraming: false, fortuneCookieClose: false, loopOpener: false, concessionMove: false, baitAndSwitch: false, forbiddenSpecificity: false };
    let closer: CloserStrategy = 'punchline';

    // Aggregate deltas. Each dimension gets a weighted-average shift based on
    // how many answers actually touched it — prevents under-touched axes
    // from drifting and over-touched axes from saturating.
    type Dim = 'authority'|'energy'|'vulnerability'|'provocation'|'specificity'|'intimacy';
    const dims: Dim[] = ['authority', 'energy', 'vulnerability', 'provocation', 'specificity', 'intimacy'];
    const sum: Record<Dim, number> = { authority: 0, energy: 0, vulnerability: 0, provocation: 0, specificity: 0, intimacy: 0 };
    const count: Record<Dim, number> = { authority: 0, energy: 0, vulnerability: 0, provocation: 0, specificity: 0, intimacy: 0 };
    const rhythmVotes: Record<VoiceMix['rhythm'], number> = { staccato: 0, punchy: 0, flowing: 0, contemplative: 0 };
    const hookVotes: Partial<Record<string, number>> = {};
    const tensionVotes: Partial<Record<string, number>> = {};
    const payoffVotes: Partial<Record<string, number>> = {};
    const closerVotes: Partial<Record<CloserStrategy, number>> = {};
    const viralVotes: Partial<Record<keyof ViralPhysics, number>> = {};

    for (const ans of answers) {
        for (const k of dims) {
            const d = ans.deltas[k];
            if (typeof d === 'number') { sum[k] += d; count[k] += 1; }
        }
        if (ans.deltas.rhythm) rhythmVotes[ans.deltas.rhythm] += 1;
        if (ans.hook?.patternInterrupt) hookVotes[ans.hook.patternInterrupt] = (hookVotes[ans.hook.patternInterrupt] || 0) + 1;
        if (ans.hook?.tensionMechanism) tensionVotes[ans.hook.tensionMechanism] = (tensionVotes[ans.hook.tensionMechanism] || 0) + 1;
        if (ans.hook?.promisePayoff) payoffVotes[ans.hook.promisePayoff] = (payoffVotes[ans.hook.promisePayoff] || 0) + 1;
        if (ans.closer) closerVotes[ans.closer] = (closerVotes[ans.closer] || 0) + 1;
        if (ans.viral) {
            for (const [k, v] of Object.entries(ans.viral) as [keyof ViralPhysics, boolean][]) {
                if (v) viralVotes[k] = (viralVotes[k] || 0) + 1;
            }
        }
    }

    // Apply averaged deltas to baseline — averaging keeps each dimension in
    // a realistic range regardless of how many questions hit it.
    for (const k of dims) {
        if (count[k] > 0) {
            const avgDelta = sum[k] / count[k];
            // Scale: averaged delta gets full effect (each answer was already calibrated)
            mix[k] = clamp01_100(mix[k] + avgDelta * 1.6);
        }
    }

    // Pick the rhythm with the most votes (default: punchy)
    const rhythmEntries = (Object.entries(rhythmVotes) as [VoiceMix['rhythm'], number][])
        .sort((a, b) => b[1] - a[1]);
    if (rhythmEntries[0][1] > 0) mix.rhythm = rhythmEntries[0][0];

    // Pick top-voted hook architecture pieces
    const topKey = <T extends string>(votes: Partial<Record<T, number>>): T | null => {
        const e = (Object.entries(votes) as [T, number][]).sort((a, b) => (b[1] || 0) - (a[1] || 0));
        return e.length && e[0][1] > 0 ? e[0][0] : null;
    };
    const piVote = topKey<HookArchitecture['patternInterrupt']>(hookVotes as any);
    const tmVote = topKey<HookArchitecture['tensionMechanism']>(tensionVotes as any);
    const ppVote = topKey<HookArchitecture['promisePayoff']>(payoffVotes as any);
    if (piVote) hook.patternInterrupt = piVote;
    if (tmVote) hook.tensionMechanism = tmVote;
    if (ppVote) hook.promisePayoff = ppVote;

    const cVote = topKey<CloserStrategy>(closerVotes as any);
    if (cVote) closer = cVote;

    // Viral toggles: enable when at least 2 answers vote for them, OR when a
    // single high-conviction answer votes (since we have 7 questions, ≥2
    // is a meaningful signal).
    for (const [k, v] of Object.entries(viralVotes) as [keyof ViralPhysics, number][]) {
        if (v >= 2) viral[k] = true;
    }

    // ─── Persona inference via nearest-preset matching ──────────────
    const targetVec = voiceVector(mix);
    const presetScores = VOICE_PRESETS.map(p => ({
        preset: p,
        sim: cosineSim(targetVec, voiceVector(p.voiceMix))
    })).sort((a, b) => b.sim - a.sim);
    const best = presetScores[0];
    const confidence = Math.round(Math.max(0, Math.min(1, best.sim)) * 100);

    // Compose a transparent persona descriptor — three traits, not a buzzfeed name.
    // Each trait is anchored to a real value, so the user can sanity-check it.
    type Trait = { label: string; score: number };
    const traits: Trait[] = [
        { label: 'Brutal',         score: mix.provocation },
        { label: 'Vulnerable',     score: mix.vulnerability },
        { label: 'Surgical',       score: mix.specificity },
        { label: 'Authoritative',  score: mix.authority },
        { label: 'Calm',           score: 100 - mix.energy },
        { label: 'Intimate',       score: mix.intimacy },
        { label: 'High-energy',    score: mix.energy }
    ].filter(t => t.score >= 60)        // only surface traits the user actually leans into
     .sort((a, b) => b.score - a.score);

    const rhythmDescriptor: Record<VoiceMix['rhythm'], string> = {
        staccato: 'staccato pace',
        punchy: 'punchy pace',
        flowing: 'flowing pace',
        contemplative: 'contemplative pace'
    };

    let personaName: string;
    let tagline: string;
    // If a preset is very close, surface it as the "looks like" label — but always
    // also show the user's actual dimensions so it's transparent, not magic.
    if (best.sim >= 0.97 && traits.length > 0) {
        personaName = `${traits.slice(0, 2).map(t => t.label).join(' · ')} · ${rhythmDescriptor[mix.rhythm]}`;
        tagline = `Closest to "${best.preset.name}" — ${best.preset.tagline}`;
    } else if (traits.length >= 2) {
        personaName = `${traits.slice(0, 2).map(t => t.label).join(' · ')} · ${rhythmDescriptor[mix.rhythm]}`;
        tagline = `A ${traits[0].label.toLowerCase()} voice that ${
            traits[1].label === 'Surgical' ? 'leans on receipts over claims' :
            traits[1].label === 'Vulnerable' ? 'trades certainty for honesty' :
            traits[1].label === 'Intimate' ? 'writes one-to-one, not one-to-many' :
            traits[1].label === 'Authoritative' ? 'sets the frame and holds it' :
            traits[1].label === 'Brutal' ? 'refuses to soften the edges' :
            traits[1].label === 'Calm' ? 'pulls authority from pace, not volume' :
            'meets the reader where they are'
        }.`;
    } else {
        personaName = `Balanced · ${rhythmDescriptor[mix.rhythm]}`;
        tagline = 'No single dimension dominates — you adapt to the moment.';
    }

    // ─── Sample line — uses the actual computed values, not just the hook ─
    // We pick from a richer template library based on pattern interrupt + rhythm + intimacy.
    const rnd = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    const templates: Record<HookArchitecture['patternInterrupt'], string[]> = {
        shocking_number: [
            `$${(Math.random() * 9000 + 1000).toFixed(0)} in ${Math.floor(Math.random() * 30 + 2)} days. ${mix.intimacy > 60 ? "Here's what I learned that nobody told me." : "Here's the exact mechanic."}`,
            `${Math.floor(Math.random() * 40 + 3)} months. ${Math.floor(Math.random() * 5 + 2)} pivots. One thing finally clicked.`,
            `${Math.floor(Math.random() * 90 + 10)}% of the value came from ${Math.floor(Math.random() * 4 + 2)}% of the work. ${mix.authority > 70 ? 'Here is the 4%.' : 'I had to be told.'}`
        ],
        taboo_confession: [
            `I almost quit ${rnd(['yesterday', 'last Tuesday', 'three weeks ago', 'twice last quarter'])}. Here's what changed my mind.`,
            `I lied in my pitch deck. ${mix.vulnerability > 70 ? 'I still think about it.' : 'Then I rebuilt the company around fixing it.'}`,
            `For ${Math.floor(Math.random() * 18 + 3)} months I built the wrong thing. One sentence from a user rewrote everything.`
        ],
        forbidden_statement: [
            `Stop chasing PMF. ${mix.provocation > 75 ? "It's a lie sold by people who never built anything." : "It's a lagging indicator, not a strategy."}`,
            `Most ${mix.intimacy > 60 ? 'of us' : 'founders'} are doing this wrong. ${mix.authority > 70 ? "Here's the fix." : "I include myself."}`,
            `${mix.provocation > 80 ? 'Hot take' : 'Unpopular angle'}: the metric you optimize for is the one you'll regret.`
        ],
        precise_moment: [
            `${rnd(['Tuesday', 'Last Thursday', 'A Friday in March'])} at ${Math.floor(Math.random() * 4 + 2)}:${Math.floor(Math.random() * 50 + 10)}am, the email arrived. I read it three times.`,
            `${Math.floor(Math.random() * 18 + 2)} months in, I opened ${rnd(['Stripe', 'Linear', 'our analytics'])}. The number wasn't what I expected.`,
            `It was the ${rnd(['third', 'fourth', 'seventh'])} call that week. The customer said one sentence. Everything changed.`
        ],
        self_indictment: [
            `I built the wrong feature for ${Math.floor(Math.random() * 14 + 4)} months. Then a single message rewrote the roadmap.`,
            `I ignored the ${rnd(['churn', 'feedback', 'support load'])} for too long. Here's what it cost me — and what I do now.`,
            `I told myself I was iterating. I was actually procrastinating. Here's how I caught it.`
        ],
        unexpected_name: [
            `${rnd(['Stripe', 'YC', 'Linear', 'Notion'])} rejected us ${Math.floor(Math.random() * 4 + 2)} times. I'm grateful for every "no".`,
            `${rnd(['Paul Graham', 'a junior PM', 'my first customer'])} said one thing that broke my model — in the best way.`,
            `${rnd(['A 14-year-old', 'A retired CEO', 'A solo dev in Lagos'])} taught me more about distribution than any book.`
        ]
    };
    const sampleLine = `"${rnd(templates[hook.patternInterrupt])}"`;

    return {
        voiceMix: mix, hook, viral, closer,
        personaName, tagline, sampleLine, confidence,
        closestPreset: best.preset.name
    };
}

export const VoiceMatchQuiz: React.FC<{ onClose: () => void; onComplete: (result: { voiceMix: VoiceMix; hook: HookArchitecture; viral: ViralPhysics; closer: CloserStrategy; personaName: string; tagline: string }) => void }> = ({ onClose, onComplete }) => {
    const [step, setStep] = useState(0); // 0 = intro, 1-4 = questions, 5 = reveal
    const [answers, setAnswers] = useState<QuizOption[]>([]);
    const [transitioning, setTransitioning] = useState(false);

    const totalQuestions = QUIZ_QUESTIONS.length;
    const currentQuestion = step >= 1 && step <= totalQuestions ? QUIZ_QUESTIONS[step - 1] : null;

    const handleSelect = (opt: QuizOption) => {
        if (transitioning) return;
        setTransitioning(true);
        const newAnswers = [...answers, opt];
        setAnswers(newAnswers);
        setTimeout(() => {
            setStep(s => s + 1);
            setTransitioning(false);
        }, 350);
    };

    const result = step > totalQuestions ? computePersonaResult(answers) : null;

    return (
        <div className="fixed inset-0 z-50 bg-gradient-to-br from-gray-900 via-slate-900 to-amber-950 flex items-center justify-center p-4 animate-fade-in" style={{ animationDuration: '300ms' }}>
            {/* Close button */}
            <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/40 hover:text-white transition-colors rounded-full bg-white/5 hover:bg-white/10">
                <X size={20} />
            </button>

            {/* Progress dots */}
            {step >= 1 && step <= totalQuestions && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                    {Array.from({ length: totalQuestions }).map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                            i < step ? 'w-8 bg-amber-400' :
                            i === step - 1 ? 'w-8 bg-amber-400' :
                            'w-1.5 bg-white/20'
                        }`}></div>
                    ))}
                </div>
            )}

            {/* INTRO */}
            {step === 0 && (
                <div className="max-w-xl w-full text-center animate-fade-in" style={{ animationDuration: '400ms' }}>
                    <div className="text-6xl mb-6">🎙️</div>
                    <h1 className="text-4xl md:text-5xl font-display font-medium text-white mb-3 tracking-tight">Find your voice</h1>
                    <p className="text-white/60 text-base mb-10 leading-relaxed">
                        {totalQuestions} questions. About a minute. No sliders.<br />
                        Pick what feels like you — we'll do the math.
                    </p>
                    <button onClick={() => setStep(1)}
                        className="group inline-flex items-center gap-3 px-7 py-3.5 bg-white text-gray-900 rounded-xl font-medium text-sm hover:bg-gray-100 transition-all">
                        Start
                        <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            )}

            {/* QUESTIONS */}
            {currentQuestion && (
                <div key={currentQuestion.id} className="max-w-3xl w-full transition-all" style={{ opacity: transitioning ? 0 : 1, transform: transitioning ? 'translateY(10px)' : 'translateY(0)', transitionDuration: '300ms' }}>
                    <div className="text-center mb-8">
                        <div className="text-[10px] font-black tracking-[0.3em] text-amber-400/70 uppercase mb-3">
                            Question {step} of {totalQuestions}
                        </div>
                        <h2 className="text-4xl font-display font-bold text-white tracking-tight mb-2">{currentQuestion.prompt}</h2>
                        <p className="text-white/50 text-sm">{currentQuestion.subtitle}</p>
                    </div>

                    <div className="space-y-3">
                        {currentQuestion.options.map((opt, i) => (
                            <button key={opt.id} type="button" onClick={() => handleSelect(opt)}
                                className="group w-full text-left p-5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-amber-400/60 rounded-2xl transition-all backdrop-blur-sm hover:scale-[1.01]"
                                style={{ animationDelay: `${i * 80}ms` }}>
                                <div className="flex items-start gap-4">
                                    <div className="w-8 h-8 rounded-lg bg-white/10 group-hover:bg-amber-400 group-hover:text-gray-900 flex items-center justify-center flex-shrink-0 transition-all">
                                        <span className="text-xs font-black">{String.fromCharCode(65 + i)}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white/90 text-base leading-relaxed group-hover:text-white italic font-display">
                                            {opt.sample}
                                        </p>
                                    </div>
                                    <ChevronRight size={20} className="text-white/30 group-hover:text-amber-400 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* REVEAL */}
            {result && step > totalQuestions && (
                <RevealScreen result={result} onLockIn={() => onComplete(result)} onRedo={() => { setStep(0); setAnswers([]); }} />
            )}
        </div>
    );
};

// Animated reveal of the matched persona
const RevealScreen: React.FC<{ result: ReturnType<typeof computePersonaResult>; onLockIn: () => void; onRedo: () => void }> = ({ result, onLockIn, onRedo }) => {
    const [drawProgress, setDrawProgress] = useState(0); // 0 → 1 for animating polygon
    const [showText, setShowText] = useState(false);
    const [showSample, setShowSample] = useState(false);

    React.useEffect(() => {
        // Animate the polygon drawing from 0 to actual values over ~1.2s
        const start = Date.now();
        const duration = 1200;
        let raf: number;
        const tick = () => {
            const elapsed = Date.now() - start;
            const t = Math.min(1, elapsed / duration);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            setDrawProgress(eased);
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const t1 = setTimeout(() => setShowText(true), 700);
        const t2 = setTimeout(() => setShowSample(true), 1300);
        return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
    }, []);

    // Build the polygon points at current animation progress
    const dims = VOICE_DIMENSIONS;
    const size = 280;
    const center = size / 2;
    const radius = 100;
    const angles = dims.map((_, i) => (Math.PI * 2 * i) / dims.length - Math.PI / 2);
    const points = dims.map((d, i) => {
        const targetValue = result.voiceMix[d.key];
        const animValue = targetValue * drawProgress;
        const r = (animValue / 100) * radius;
        return [center + r * Math.cos(angles[i]), center + r * Math.sin(angles[i])];
    });

    return (
        <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Polygon */}
            <div className="flex flex-col items-center">
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-2xl">
                    {/* Grid */}
                    {[0.25, 0.5, 0.75, 1].map(level => {
                        const pts = dims.map((_, i) => {
                            const r = level * radius;
                            return `${center + r * Math.cos(angles[i])},${center + r * Math.sin(angles[i])}`;
                        }).join(' ');
                        return <polygon key={level} points={pts} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray={level < 1 ? '3,3' : '0'} />;
                    })}
                    {/* Voice shape */}
                    <polygon points={points.map(p => p.join(',')).join(' ')}
                        fill="url(#revealGradient)" stroke="#fbbf24" strokeWidth={3} strokeLinejoin="round"
                        style={{ filter: 'drop-shadow(0 0 24px rgba(251,191,36,0.5))' }} />
                    <defs>
                        <radialGradient id="revealGradient" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="rgba(251,191,36,0.6)" />
                            <stop offset="100%" stopColor="rgba(245,158,11,0.2)" />
                        </radialGradient>
                    </defs>
                    {/* Labels */}
                    {dims.map((d, i) => {
                        const lx = center + (radius + 22) * Math.cos(angles[i]);
                        const ly = center + (radius + 22) * Math.sin(angles[i]);
                        return (
                            <text key={i} x={lx} y={ly} fontSize={10} fontWeight={700}
                                fill="rgba(255,255,255,0.7)"
                                textAnchor="middle" dominantBaseline="middle"
                                style={{ opacity: drawProgress, transition: 'opacity 800ms' }}>
                                {d.label}
                            </text>
                        );
                    })}
                    {/* Vertex dots */}
                    {drawProgress > 0.7 && points.map((p, i) => (
                        <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#fbbf24"
                            style={{ opacity: (drawProgress - 0.7) / 0.3 }} />
                    ))}
                </svg>
            </div>

            {/* Reveal text */}
            <div className="text-white">
                <div className="flex items-center gap-3 mb-3"
                    style={{ opacity: showText ? 1 : 0, transition: 'opacity 600ms' }}>
                    <span className="text-[10px] tracking-[0.2em] text-amber-400/80 uppercase">Your voice profile</span>
                    <span className="text-[10px] text-white/40">·</span>
                    <span className="text-[10px] text-white/50">{result.confidence}% match to known patterns</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-display font-medium mb-3 tracking-tight text-white"
                    style={{ opacity: showText ? 1 : 0, transform: showText ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 600ms, transform 600ms' }}>
                    {result.personaName}
                </h1>
                <p className="text-white/70 text-sm leading-relaxed mb-5"
                    style={{ opacity: showText ? 1 : 0, transition: 'opacity 600ms 100ms' }}>
                    {result.tagline}
                </p>

                {/* Profile vitals — actual computed values, not buzzfeed labels */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-5 text-[12px]"
                    style={{ opacity: showText ? 1 : 0, transition: 'opacity 600ms 200ms' }}>
                    {VOICE_DIMENSIONS.map(d => (
                        <div key={d.key} className="flex items-center justify-between border-b border-white/5 py-1">
                            <span className="text-white/60">{d.label}</span>
                            <span className="text-white font-mono">{result.voiceMix[d.key]}</span>
                        </div>
                    ))}
                </div>

                <div className="p-4 bg-white/5 border border-white/10 rounded-xl mb-5"
                    style={{ opacity: showSample ? 1 : 0, transform: showSample ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 500ms, transform 500ms' }}>
                    <div className="text-[10px] tracking-[0.15em] text-white/40 uppercase mb-2">Sample line at these settings</div>
                    <p className="text-white text-sm italic font-display leading-relaxed">{result.sampleLine}</p>
                </div>

                <div className="flex flex-wrap gap-2"
                    style={{ opacity: showSample ? 1 : 0, transition: 'opacity 500ms 200ms' }}>
                    <button onClick={onLockIn}
                        className="flex-1 min-w-[160px] px-5 py-2.5 bg-white text-gray-900 rounded-xl font-medium text-sm hover:bg-gray-100 transition-all flex items-center justify-center gap-2">
                        <Check size={15} /> Use this profile
                    </button>
                    <button onClick={onRedo}
                        className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-medium text-sm transition-all">
                        Try again
                    </button>
                </div>
            </div>
        </div>
    );
};
