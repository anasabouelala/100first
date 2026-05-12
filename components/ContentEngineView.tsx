import React, { useState, useEffect, useMemo } from 'react';
import { MessageSquarePlus, RefreshCw, Github, Sparkles, Twitter, Linkedin, MessageCircle, Hash, Loader2, Copy, Check, ChevronRight, ChevronLeft, Zap, ExternalLink, BookOpen, Flame, Link, Wand2, AlertCircle, Sliders, Brain, Target, Skull, Heart, Crown, Eye, Layers, X } from 'lucide-react';
import {
  generateContentEnginePost, suggestVoiceProfile, ContentEngineParams, ContentEngineDraft,
  VoiceMix, HookArchitecture, PerspectiveInjector, ViralPhysics, CloserStrategy
} from '../services/geminiService';
import { fetchRepoPulse, parseGitHubUrl } from '../services/githubService';

// ────────────────────────────────────────────────────────────────────
// VOICE ARCHITECTURE — Defaults, Presets, Catalogues
// ────────────────────────────────────────────────────────────────────
const DEFAULT_VOICE_MIX: VoiceMix = {
  authority: 60, energy: 50, vulnerability: 50, provocation: 50, specificity: 75, intimacy: 60, rhythm: 'punchy'
};
const DEFAULT_HOOK: HookArchitecture = {
  patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap', promisePayoff: 'what_to_avoid'
};
const DEFAULT_VIRAL: ViralPhysics = {
  statusCurrency: true, inGroupSignaling: false, tribalFraming: false,
  fortuneCookieClose: true, loopOpener: false, concessionMove: true,
  baitAndSwitch: false, forbiddenSpecificity: true
};
const DEFAULT_PERSPECTIVE: PerspectiveInjector = {
  uniqueAngle: '', contrarian: '', forbiddenTakes: '', receipts: ''
};

const VOICE_PRESETS: Array<{
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
    const [ctaType, setCtaType] = useState<ContentEngineParams['cta']>('soft');

    // ─── Voice Architecture (FULLY PERSISTED to localStorage) ───
    const VOICE_PROFILE_KEY = 'content_voice_profile_v2';
    type VoiceProfile = {
        voiceMix: VoiceMix;
        hook: HookArchitecture;
        viral: ViralPhysics;
        closer: CloserStrategy;
        variants: number;
        activePreset: string | null;
    };
    const defaultProfile: VoiceProfile = {
        voiceMix: VOICE_PRESETS[0].voiceMix,
        hook: VOICE_PRESETS[0].hook,
        viral: VOICE_PRESETS[0].viral,
        closer: VOICE_PRESETS[0].closer,
        variants: 1,
        activePreset: 'brutal_founder'
    };
    const loadedProfile: VoiceProfile = (() => {
        try {
            const raw = localStorage.getItem(VOICE_PROFILE_KEY);
            return raw ? { ...defaultProfile, ...JSON.parse(raw) } : defaultProfile;
        } catch { return defaultProfile; }
    })();

    const [activePreset, setActivePreset] = useState<string | null>(loadedProfile.activePreset);
    const [voiceMix, setVoiceMix] = useState<VoiceMix>(loadedProfile.voiceMix);
    const [hook, setHook] = useState<HookArchitecture>(loadedProfile.hook);
    const [viral, setViral] = useState<ViralPhysics>(loadedProfile.viral);
    const [closer, setCloser] = useState<CloserStrategy>(loadedProfile.closer);
    const [variants, setVariants] = useState(loadedProfile.variants);

    // Persist every change
    useEffect(() => {
        const profile: VoiceProfile = { voiceMix, hook, viral, closer, variants, activePreset };
        localStorage.setItem(VOICE_PROFILE_KEY, JSON.stringify(profile));
    }, [voiceMix, hook, viral, closer, variants, activePreset]);

    // AI auto-set state
    const [aiSuggesting, setAiSuggesting] = useState(false);
    const [aiSuggestionReason, setAiSuggestionReason] = useState<string | null>(null);
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);

    // Voice Match quiz
    const [quizOpen, setQuizOpen] = useState(false);
    const handleQuizComplete = (result: { voiceMix: VoiceMix; hook: HookArchitecture; viral: ViralPhysics; closer: CloserStrategy; personaName: string; tagline: string }) => {
        setVoiceMix(result.voiceMix);
        setHook(result.hook);
        setViral(result.viral);
        setCloser(result.closer);
        setActivePreset(null);
        setAiSuggestionReason(`${result.personaName} — ${result.tagline}`);
        setQuizOpen(false);
    };

    // Perspective Injector — persisted (signature)
    const [perspective, setPerspective] = useState<PerspectiveInjector>(() => {
        try {
            const raw = localStorage.getItem('content_perspective_v1');
            return raw ? JSON.parse(raw) : DEFAULT_PERSPECTIVE;
        } catch { return DEFAULT_PERSPECTIVE; }
    });
    useEffect(() => {
        localStorage.setItem('content_perspective_v1', JSON.stringify(perspective));
    }, [perspective]);

    const applyPreset = (presetId: string) => {
        const p = VOICE_PRESETS.find(x => x.id === presetId);
        if (!p) return;
        setActivePreset(presetId);
        setVoiceMix(p.voiceMix);
        setHook(p.hook);
        setViral(p.viral);
        setCloser(p.closer);
        setAiSuggestionReason(null);
    };

    const handleAiAutoSet = async () => {
        if (!sourceContent.trim()) {
            setAiSuggestError('Add some source content first so the AI knows what you\'re writing about.');
            return;
        }
        setAiSuggesting(true);
        setAiSuggestError(null);
        try {
            const suggestion = await suggestVoiceProfile({
                sourceContent,
                perspective,
                format,
                targetPlatforms,
                styleInspiration: styleInspiration || undefined
            });
            setVoiceMix(suggestion.voiceMix);
            setHook(suggestion.hook);
            setViral(suggestion.viral);
            setCloser(suggestion.closer);
            setActivePreset(null);
            setAiSuggestionReason(suggestion.reasoning);
        } catch (e: any) {
            setAiSuggestError(e?.message || 'AI suggestion failed');
        } finally {
            setAiSuggesting(false);
        }
    };

    // Markers: any manual edit clears preset & AI reasoning
    const customizeVoice = (patch: Partial<VoiceMix>) => { setVoiceMix(v => ({ ...v, ...patch })); setActivePreset(null); setAiSuggestionReason(null); };
    const customizeHook = (patch: Partial<HookArchitecture>) => { setHook(h => ({ ...h, ...patch })); setActivePreset(null); setAiSuggestionReason(null); };
    const toggleViral = (key: keyof ViralPhysics) => { setViral(v => ({ ...v, [key]: !v[key] })); setActivePreset(null); setAiSuggestionReason(null); };
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

                        {/* ────────── VOICE ARCHITECTURE ────────── */}
                        <VoiceArchitectureSection
                            activePreset={activePreset} applyPreset={applyPreset}
                            voiceMix={voiceMix} customizeVoice={customizeVoice} setVoiceMix={setVoiceMix} setActivePreset={setActivePreset}
                            hook={hook} customizeHook={customizeHook}
                            perspective={perspective} setPerspective={setPerspective}
                            viral={viral} toggleViral={toggleViral}
                            closer={closer} setCloser={(c) => { setCloser(c); setActivePreset(null); setAiSuggestionReason(null); }}
                            variants={variants} setVariants={setVariants}
                            onAiAutoSet={handleAiAutoSet}
                            aiSuggesting={aiSuggesting}
                            aiSuggestionReason={aiSuggestionReason}
                            aiSuggestError={aiSuggestError}
                            sourceContent={sourceContent}
                            onOpenQuiz={() => setQuizOpen(true)}
                        />
                        {quizOpen && <VoiceMatchQuiz onClose={() => setQuizOpen(false)} onComplete={handleQuizComplete} />}

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
                                    {/* Variant + voice metadata */}
                                    {(draft.variantNote || draft.voiceProfile) && (
                                        <div className="flex flex-wrap items-center gap-2 mb-3">
                                            {draft.variantNote && (
                                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-200 text-amber-900 rounded-lg text-[10px] font-bold">
                                                    <Layers size={10} /> {draft.variantNote}
                                                </div>
                                            )}
                                            {draft.voiceProfile && (
                                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-[10px] italic">
                                                    <Eye size={10} /> {draft.voiceProfile}
                                                </div>
                                            )}
                                        </div>
                                    )}
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

// ════════════════════════════════════════════════════════════════════
// VOICE ARCHITECTURE SECTION
// ════════════════════════════════════════════════════════════════════
const VoiceArchitectureSection: React.FC<{
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
    <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-6 col-span-full">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white">
                    <Layers size={18} />
                </div>
                <div>
                    <h3 className="font-bold text-base">Voice Architecture</h3>
                    <p className="text-[11px] text-gray-500">
                        {aiSuggestionReason ? <><Sparkles size={10} className="inline mr-1 text-amber-500" />{aiSuggestionReason}</> :
                         activePreset ? `Preset: ${VOICE_PRESETS.find(p => p.id === activePreset)?.name}` :
                         'Custom voice profile · saved automatically'}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    type="button"
                    onClick={onOpenQuiz}
                    className="group relative flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-200/60 hover:shadow-xl hover:shadow-amber-300/70 transition-all overflow-hidden"
                >
                    <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700"></span>
                    <span className="text-base relative">🎙️</span>
                    <span className="relative">Voice Match</span>
                    <span className="relative text-[9px] bg-white/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">30s</span>
                </button>
                <button
                    type="button"
                    onClick={onAiAutoSet}
                    disabled={aiSuggesting || !sourceContent.trim()}
                    title={!sourceContent.trim() ? 'Add some source content first' : 'Let AI choose the optimal voice profile for your context'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-md transition-all"
                >
                    {aiSuggesting ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                    {aiSuggesting ? 'Analyzing…' : 'AI auto-set'}
                </button>
                <button
                    type="button"
                    onClick={() => { setVoiceMix(DEFAULT_VOICE_MIX); setActivePreset(null); }}
                    className="text-[10px] text-gray-400 hover:text-gray-700 font-bold uppercase tracking-wider px-2"
                >Reset</button>
            </div>
        </div>

        {/* AI suggest error */}
        {aiSuggestError && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 flex items-start gap-2">
                <AlertCircle size={12} className="text-amber-600 flex-shrink-0 mt-0.5" /> {aiSuggestError}
            </div>
        )}

        {/* QUICK PRESETS — always visible chips */}
        <div>
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Quick presets</div>
            <div className="flex flex-wrap gap-2">
                {VOICE_PRESETS.map(p => (
                    <button key={p.id} type="button" onClick={() => applyPreset(p.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                            activePreset === p.id
                              ? 'border-amber-500 bg-gradient-to-r from-amber-50 to-orange-50 text-gray-900 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                        }`}>
                        <span>{p.emoji}</span> {p.name}
                    </button>
                ))}
            </div>
        </div>

        {/* INTERACTIVE POLYGON — primary control */}
        <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-100 rounded-3xl p-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-center">
                <div className="lg:col-span-3 flex flex-col items-center">
                    <InteractivePolygon mix={voiceMix} onChange={(patch) => customizeVoice(patch)} />
                    <p className="text-[10px] text-gray-500 mt-2 text-center">
                        <Wand2 size={10} className="inline mr-1" />
                        Drag the orange dots to fine-tune. Each axis = one dimension of your voice.
                    </p>
                </div>
                <div className="lg:col-span-2 space-y-1.5">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Live values</div>
                    {VOICE_DIMENSIONS.map(dim => (
                        <PolygonValueRow key={dim.key} label={dim.label} value={voiceMix[dim.key]}
                            low={dim.low} high={dim.high} />
                    ))}
                </div>
            </div>
        </div>

        {/* Rhythm picker */}
        <div>
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Sentence Rhythm</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {([
                    { id: 'staccato', label: 'Staccato', desc: 'Short. Bursts.' },
                    { id: 'punchy', label: 'Punchy mix', desc: 'Mostly short. Sometimes long.' },
                    { id: 'flowing', label: 'Flowing', desc: 'Long, building, momentum.' },
                    { id: 'contemplative', label: 'Contemplative', desc: 'Comma-rich, deliberate, paused.' },
                ] as const).map(r => (
                    <button key={r.id} type="button" onClick={() => customizeVoice({ rhythm: r.id })}
                        className={`p-2.5 rounded-xl text-left text-xs border transition-all ${
                            voiceMix.rhythm === r.id
                              ? 'bg-gray-900 text-white border-gray-900'
                              : 'bg-gray-50 border-gray-100 text-gray-600 hover:bg-white'
                        }`}>
                        <div className="font-bold">{r.label}</div>
                        <div className={`text-[10px] mt-0.5 ${voiceMix.rhythm === r.id ? 'text-white/60' : 'text-gray-400'}`}>{r.desc}</div>
                    </button>
                ))}
            </div>
        </div>

        <div className="space-y-6">

                {/* Hook Architecture Builder */}
                <div className="border-t border-gray-100 pt-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Target size={14} className="text-gray-500" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Hook Architecture</span>
                        <span className="text-[10px] text-gray-400">— first 3 lines decide everything</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <HookSelector label="1. Pattern Interrupt" sub="Open with..."
                            options={PATTERN_INTERRUPTS.map(o => ({ id: o.id, label: o.label, hint: o.example }))}
                            value={hook.patternInterrupt}
                            onChange={(v) => customizeHook({ patternInterrupt: v as HookArchitecture['patternInterrupt'] })} />
                        <HookSelector label="2. Tension Mechanism" sub="Pull them in by..."
                            options={TENSION_MECHANISMS.map(o => ({ id: o.id, label: o.label, hint: o.desc }))}
                            value={hook.tensionMechanism}
                            onChange={(v) => customizeHook({ tensionMechanism: v as HookArchitecture['tensionMechanism'] })} />
                        <HookSelector label="3. Promise / Payoff" sub="Why keep reading"
                            options={PROMISE_PAYOFFS.map(o => ({ id: o.id, label: o.label, hint: o.desc }))}
                            value={hook.promisePayoff}
                            onChange={(v) => customizeHook({ promisePayoff: v as HookArchitecture['promisePayoff'] })} />
                    </div>
                </div>

                {/* Viral Physics Toggles */}
                <div className="border-t border-gray-100 pt-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Zap size={14} className="text-gray-500" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Viral Physics</span>
                        <span className="text-[10px] text-gray-400">— psychological amplifiers (toggle to activate)</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {VIRAL_TOGGLES.map(t => (
                            <button key={t.key} type="button" onClick={() => toggleViral(t.key)}
                                className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                                    viral[t.key]
                                      ? 'bg-amber-50 border-amber-300'
                                      : 'bg-white border-gray-200 hover:border-gray-300'
                                }`}>
                                <div className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center flex-shrink-0 ${viral[t.key] ? 'bg-amber-500 text-white' : 'border-2 border-gray-300'}`}>
                                    {viral[t.key] && <Check size={10} strokeWidth={3} />}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-bold text-xs text-gray-900">{t.label}</div>
                                    <div className="text-[10px] text-gray-500 leading-snug mt-0.5">{t.desc}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Closer */}
                <div className="border-t border-gray-100 pt-6">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Closer Strategy</span>
                        <span className="text-[10px] text-gray-400">— how the post lands</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {CLOSERS.map(c => (
                            <button key={c.id} type="button" onClick={() => setCloser(c.id)}
                                className={`p-3 rounded-xl text-left text-xs border transition-all ${
                                    closer === c.id
                                      ? 'bg-gray-900 text-white border-gray-900'
                                      : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-white'
                                }`}>
                                <div className="font-bold">{c.label}</div>
                                <div className={`text-[10px] mt-0.5 ${closer === c.id ? 'text-white/60' : 'text-gray-400'}`}>{c.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Variants count */}
                <div className="border-t border-gray-100 pt-6">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Variants per platform</span>
                            <p className="text-[11px] text-gray-500 mt-0.5">Generate {variants} different angle{variants > 1 ? 's' : ''} per platform — same voice, different attack.</p>
                        </div>
                        <span className="text-2xl font-display font-bold text-gray-900">{variants}</span>
                    </div>
                    <input type="range" min={1} max={5} value={variants} onChange={e => setVariants(parseInt(e.target.value))}
                        className="w-full accent-amber-500" />
                    <div className="flex justify-between text-[9px] text-gray-400 mt-1 font-bold uppercase tracking-wider">
                        <span>1 (focused)</span>
                        <span>5 (A/B/C/D/E test)</span>
                    </div>
                </div>
            </div>

        {/* PERSPECTIVE INJECTOR — ALWAYS VISIBLE (the uniqueness vector) */}
        <div className="border-t-2 border-dashed border-amber-200 pt-6">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                    <Crown size={14} />
                </div>
                <div>
                    <span className="text-xs font-black text-gray-900 uppercase tracking-widest">Perspective Injector</span>
                    <p className="text-[10px] text-gray-500 mt-0.5">This is what makes YOUR content unique. Saved automatically.</p>
                </div>
            </div>
            <div className="space-y-3">
                <PerspectiveField
                    label="My unique angle / credential"
                    placeholder="e.g. I shipped 47 failed products before this one"
                    icon={<Eye size={12} />}
                    value={perspective.uniqueAngle}
                    onChange={v => setPerspective(p => ({ ...p, uniqueAngle: v }))} />
                <PerspectiveField
                    label="What I believe most people get wrong"
                    placeholder="e.g. PMF is a lie — it's just retention with better marketing"
                    icon={<Skull size={12} />}
                    value={perspective.contrarian}
                    onChange={v => setPerspective(p => ({ ...p, contrarian: v }))} />
                <PerspectiveField
                    label="My receipts (numbers/results to weave in)"
                    placeholder="e.g. $2,847 MRR, 18 months bootstrap, 4 failed launches"
                    icon={<Check size={12} />}
                    value={perspective.receipts}
                    onChange={v => setPerspective(p => ({ ...p, receipts: v }))} />
                <PerspectiveField
                    label="Forbidden takes (what to NEVER write)"
                    placeholder="e.g. 'Hustle culture is essential', 'Move fast and break things'"
                    icon={<AlertCircle size={12} />}
                    value={perspective.forbiddenTakes}
                    onChange={v => setPerspective(p => ({ ...p, forbiddenTakes: v }))} />
            </div>
        </div>
    </div>
);

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
    <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
        <div className="text-[10px] font-black text-gray-700 uppercase tracking-wider">{label}</div>
        <div className="text-[10px] text-gray-400 mb-2">{sub}</div>
        <div className="space-y-1">
            {options.map(o => (
                <button key={o.id} type="button" onClick={() => onChange(o.id)}
                    className={`w-full text-left p-2 rounded-lg text-xs transition-all ${
                        value === o.id
                          ? 'bg-gray-900 text-white'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                    }`}>
                    <div className="font-bold">{o.label}</div>
                    <div className={`text-[10px] mt-0.5 ${value === o.id ? 'text-white/60' : 'text-gray-500'}`}>{o.hint}</div>
                </button>
            ))}
        </div>
    </div>
);

const PerspectiveField: React.FC<{ label: string; placeholder: string; icon: React.ReactNode; value: string; onChange: (v: string) => void }> = ({ label, placeholder, icon, value, onChange }) => (
    <div>
        <div className="flex items-center gap-1.5 mb-1">
            <span className="text-amber-600">{icon}</span>
            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">{label}</span>
        </div>
        <textarea rows={2} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full px-3 py-2 bg-amber-50/40 border border-amber-100 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder-gray-400 resize-none leading-relaxed" />
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

// Live values panel next to polygon
const PolygonValueRow: React.FC<{ label: string; value: number; low: string; high: string }> = ({ label, value, low, high }) => {
    const descriptor = value < 25 ? low : value > 75 ? high : 'balanced';
    return (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-100">
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-gray-900">{label}</span>
                <span className="text-[10px] text-gray-400 italic truncate">{descriptor}</span>
            </div>
            <span className="text-xs font-mono font-bold text-amber-600 flex-shrink-0">{value}</span>
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

const QUIZ_QUESTIONS: QuizQuestion[] = [
    {
        id: 'voice',
        prompt: 'When you\'re most convincing, you sound like…',
        subtitle: 'Pick the one that feels most like you.',
        options: [
            {
                id: 'confession',
                sample: '"I shipped 47 failed products before this one. Here\'s what every single one taught me."',
                deltas: { vulnerability: 35, intimacy: 20, specificity: 10, authority: -5 },
                hook: { patternInterrupt: 'taboo_confession', tensionMechanism: 'pain_mirror' },
                viral: { concessionMove: true, statusCurrency: false },
                weight: 1
            },
            {
                id: 'data',
                sample: '"Revenue: $2,847. Hours: 6. Tools: 3. Customers: 8."',
                deltas: { specificity: 35, authority: 20, vulnerability: -15, energy: -5 },
                hook: { patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap' },
                viral: { forbiddenSpecificity: true, statusCurrency: true },
                weight: 1
            },
            {
                id: 'provocation',
                sample: '"PMF is a lie sold by VCs to founders who haven\'t done the work."',
                deltas: { provocation: 35, authority: 20, vulnerability: -15 },
                hook: { patternInterrupt: 'forbidden_statement', tensionMechanism: 'cognitive_dissonance' },
                viral: { tribalFraming: true, baitAndSwitch: true },
                weight: 1
            }
        ]
    },
    {
        id: 'tempo',
        prompt: 'Your sentences feel like…',
        subtitle: 'The pace of your writing.',
        options: [
            {
                id: 'staccato',
                sample: '"Built it. Shipped it. Got 8 users. $355 each. Now what?"',
                deltas: { energy: 25, rhythm: 'staccato', intimacy: 10 },
                weight: 1
            },
            {
                id: 'flowing',
                sample: '"I started with one idea, then realized the problem was bigger than I thought, and the solution had to evolve with every new user I talked to."',
                deltas: { energy: 5, rhythm: 'flowing', vulnerability: 10 },
                weight: 1
            },
            {
                id: 'contemplative',
                sample: '"I waited. Then I listened. The market told me everything — eventually."',
                deltas: { energy: -15, rhythm: 'contemplative', authority: 10 },
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
                deltas: { intimacy: 35, vulnerability: 10, authority: -5 },
                closer: 'open_question',
                weight: 1
            },
            {
                id: 'mentor',
                sample: '"Here\'s the model. Three principles. Apply them in this order: first X, then Y, then Z."',
                deltas: { authority: 30, specificity: 15, intimacy: -10 },
                closer: 'soft_proof',
                weight: 1
            },
            {
                id: 'insider',
                sample: '"What I\'m about to share, most agencies will hate me for. But you deserve to know."',
                deltas: { intimacy: 15, authority: 20, provocation: 15 },
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
                deltas: { specificity: 25, authority: 15 },
                hook: { patternInterrupt: 'shocking_number', promisePayoff: 'what_to_learn' },
                viral: { statusCurrency: true, fortuneCookieClose: true },
                closer: 'soft_proof',
                weight: 1
            },
            {
                id: 'story',
                sample: '"I almost quit. Yesterday. Here\'s what changed my mind."',
                deltas: { vulnerability: 25, intimacy: 15 },
                hook: { patternInterrupt: 'taboo_confession', promisePayoff: 'what_to_feel' },
                viral: { concessionMove: true },
                closer: 'open_question',
                weight: 1
            },
            {
                id: 'forbidden',
                sample: '"Stop telling founders to \'just talk to users\'. Here\'s what actually works."',
                deltas: { provocation: 25, authority: 15 },
                hook: { patternInterrupt: 'forbidden_statement', promisePayoff: 'what_to_avoid' },
                viral: { baitAndSwitch: true, tribalFraming: true },
                closer: 'reverse_cta',
                weight: 1
            }
        ]
    }
];

function clamp01_100(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

function computePersonaResult(answers: QuizOption[]): {
    voiceMix: VoiceMix;
    hook: HookArchitecture;
    viral: ViralPhysics;
    closer: CloserStrategy;
    personaName: string;
    tagline: string;
    sampleLine: string;
} {
    // Start from neutral midpoints
    let mix: VoiceMix = { authority: 50, energy: 50, vulnerability: 50, provocation: 50, specificity: 50, intimacy: 50, rhythm: 'punchy' };
    let hook: HookArchitecture = { patternInterrupt: 'shocking_number', tensionMechanism: 'curiosity_gap', promisePayoff: 'what_to_avoid' };
    let viral: ViralPhysics = { statusCurrency: false, inGroupSignaling: false, tribalFraming: false, fortuneCookieClose: false, loopOpener: false, concessionMove: false, baitAndSwitch: false, forbiddenSpecificity: false };
    let closer: CloserStrategy = 'punchline';

    for (const ans of answers) {
        // Apply numeric deltas
        for (const k of ['authority', 'energy', 'vulnerability', 'provocation', 'specificity', 'intimacy'] as const) {
            if (typeof ans.deltas[k] === 'number') {
                mix[k] = clamp01_100(mix[k] + (ans.deltas[k] as number));
            }
        }
        if (ans.deltas.rhythm) mix.rhythm = ans.deltas.rhythm;
        if (ans.hook) hook = { ...hook, ...ans.hook };
        if (ans.viral) viral = { ...viral, ...ans.viral };
        if (ans.closer) closer = ans.closer;
    }

    // Persona naming from dominant traits
    const top = [
        { trait: 'Brutal', score: mix.provocation, sample: '"Stop pretending. Here\'s the truth."' },
        { trait: 'Vulnerable', score: mix.vulnerability, sample: '"I lost everything. Here\'s what saved me."' },
        { trait: 'Surgical', score: mix.specificity - 50 + 50, sample: '"$2,847 in 6 hours. The 4-step playbook."' },
        { trait: 'Calm', score: 100 - mix.energy, sample: '"Three principles. Applied carefully."' },
        { trait: 'Intimate', score: mix.intimacy, sample: '"Listen — between you and me…"' }
    ].sort((a, b) => b.score - a.score);

    const second = [
        { archetype: 'Sniper', sample: '"$2,847. 6 hours. Done."' },
        { archetype: 'Storyteller', sample: '"Tuesday at 3am, the email arrived…"' },
        { archetype: 'Architect', sample: '"Three principles, in this order…"' },
        { archetype: 'Observer', sample: '"I watched 40 founders do this. Here\'s the pattern."' },
        { archetype: 'Insider', sample: '"What they don\'t tell you about X…"' }
    ];
    // Pick archetype based on authority+specificity vs intimacy+vulnerability balance
    const archetypeScore = mix.authority + mix.specificity - mix.intimacy - mix.vulnerability;
    let archetype = 'Observer';
    if (archetypeScore > 40) archetype = 'Sniper';
    else if (archetypeScore < -40) archetype = 'Storyteller';
    else if (mix.authority > 70) archetype = 'Architect';
    else if (mix.provocation > 70) archetype = 'Insider';

    const personaName = `The ${top[0].trait} ${archetype}`;
    const taglines: Record<string, string> = {
        'Brutal': 'You hit first, soothe never. People listen because you don\'t soften it.',
        'Vulnerable': 'You lead with the wound. People trust you because you go first.',
        'Surgical': 'You hide credentials behind receipts. You don\'t claim — you show.',
        'Calm': 'You don\'t need volume. Your authority is in the pace.',
        'Intimate': 'You write like you\'re leaning across the table. People feel seen.'
    };

    // Build a sample line based on the chosen settings
    const sampleLine =
        hook.patternInterrupt === 'shocking_number' ? `"$${(Math.random() * 9000 + 1000).toFixed(0)} in ${Math.floor(Math.random() * 30 + 1)} days. Most ${archetypeScore > 0 ? 'founders' : 'people'} would hide this. Here's why you shouldn't."` :
        hook.patternInterrupt === 'taboo_confession' ? `"I almost quit yesterday. Here's what changed my mind — and why I should have known sooner."` :
        hook.patternInterrupt === 'forbidden_statement' ? `"Stop chasing PMF. It's a lie sold by people who never built anything. Here's what actually works."` :
        hook.patternInterrupt === 'precise_moment' ? `"On Tuesday at 3:14am, the email arrived. I read it three times. I haven't built the same way since."` :
        hook.patternInterrupt === 'self_indictment' ? `"I built the wrong feature for 18 months. Then a single user message rewrote everything."` :
        `"Stripe rejected us 4 times. I'm grateful for every single 'no'. Here's why."`;

    return { voiceMix: mix, hook, viral, closer, personaName, tagline: taglines[top[0].trait] || 'A unique voice profile.', sampleLine };
}

const VoiceMatchQuiz: React.FC<{ onClose: () => void; onComplete: (result: { voiceMix: VoiceMix; hook: HookArchitecture; viral: ViralPhysics; closer: CloserStrategy; personaName: string; tagline: string }) => void }> = ({ onClose, onComplete }) => {
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
                    <div className="text-7xl mb-6 animate-pulse">🎙️</div>
                    <h1 className="text-5xl font-display font-bold text-white mb-3 tracking-tight">Find your voice</h1>
                    <p className="text-white/60 text-lg mb-10 leading-relaxed">
                        4 questions. 30 seconds. No sliders.<br />
                        Just pick what feels like you.
                    </p>
                    <button onClick={() => setStep(1)}
                        className="group inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 text-gray-900 rounded-2xl font-bold text-base shadow-2xl shadow-amber-500/20 hover:shadow-amber-500/40 transition-all">
                        Start the match
                        <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
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
                <div className="text-[10px] font-black tracking-[0.3em] text-amber-400 uppercase mb-3"
                    style={{ opacity: showText ? 1 : 0, transition: 'opacity 600ms' }}>
                    Your voice is
                </div>
                <h1 className="text-5xl md:text-6xl font-display font-bold mb-4 tracking-tight bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 bg-clip-text text-transparent"
                    style={{ opacity: showText ? 1 : 0, transform: showText ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 600ms, transform 600ms' }}>
                    {result.personaName}
                </h1>
                <p className="text-white/70 text-base leading-relaxed mb-6"
                    style={{ opacity: showText ? 1 : 0, transition: 'opacity 600ms 100ms' }}>
                    {result.tagline}
                </p>

                <div className="p-4 bg-white/5 border border-amber-400/30 rounded-2xl mb-6"
                    style={{ opacity: showSample ? 1 : 0, transform: showSample ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 500ms, transform 500ms' }}>
                    <div className="text-[10px] font-black tracking-[0.2em] text-amber-400 uppercase mb-2">Sample line you'd write</div>
                    <p className="text-white text-sm italic font-display leading-relaxed">{result.sampleLine}</p>
                </div>

                <div className="flex flex-wrap gap-2"
                    style={{ opacity: showSample ? 1 : 0, transition: 'opacity 500ms 200ms' }}>
                    <button onClick={onLockIn}
                        className="flex-1 min-w-[160px] px-6 py-3 bg-gradient-to-r from-amber-400 to-orange-400 text-gray-900 rounded-xl font-bold text-sm shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 transition-all flex items-center justify-center gap-2">
                        <Check size={16} /> Lock it in
                    </button>
                    <button onClick={onRedo}
                        className="px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-bold text-sm transition-all">
                        Try again
                    </button>
                </div>
            </div>
        </div>
    );
};
