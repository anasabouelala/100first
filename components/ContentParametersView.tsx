import React, { useState, useRef } from 'react';
import { Loader2, Brain, AlertCircle, Zap, Twitter, Save, Bookmark, X, Plus } from 'lucide-react';
import { useVoiceProfile } from '../hooks/useVoiceProfile';
import { VoiceArchitectureSection, VoiceMatchQuiz } from './ContentEngineView';
import { Section } from './ui/Section';

// ────────────────────────────────────────────────────────────────────
// CONTENT PARAMETERS VIEW
// Standalone editor for the voice profile (voice mix / hook / viral /
// closer / variants / perspective) plus style inspiration. The Content
// Engine view reads these values at generation time via the same hook
// so a saved change here applies to every future post immediately.
// ────────────────────────────────────────────────────────────────────

export const ContentParametersView: React.FC = () => {
    const vp = useVoiceProfile();
    const [quizOpen, setQuizOpen] = useState(false);

    // Calibration sample lets the user paste a writing sample so the AI
    // calibrate button has context. This is decoupled from any specific
    // post — purely for tuning the voice profile.
    const [calibrationSample, setCalibrationSample] = useState('');

    // The calibration sample textarea sits BELOW the Voice section. When a
    // user clicks "AI calibrate" with an empty sample, the button used to
    // appear inert (it was disabled, with a tiny tooltip). We now intercept
    // the click, scroll the sample field into view, and flash it so the
    // prereq is impossible to miss.
    const sampleRef = useRef<HTMLTextAreaElement>(null);
    const [sampleFlash, setSampleFlash] = useState(false);

    const handleAiCalibrateClick = () => {
        if (!calibrationSample.trim()) {
            // Scroll-and-flash the calibration sample field.
            const el = sampleRef.current;
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Give the scroll a beat before stealing focus so the user
                // tracks the motion.
                setTimeout(() => el.focus(), 350);
            }
            setSampleFlash(true);
            setTimeout(() => setSampleFlash(false), 2200);
            // Show the human-readable error in the voice-section banner.
            vp.aiCalibrate(''); // triggers the empty-sample error message in the hook
            return;
        }
        vp.aiCalibrate(calibrationSample);
    };

    // ── Steal-a-voice (X-handle fetcher) ──
    // Reference Voice Studio's dominant entry point: paste a handle, the agent
    // opens the profile, reads recent original tweets, AI calibrates the whole
    // profile in one click. We piggyback on the allorigins HTML proxy used
    // elsewhere in this file — no extra infra needed.
    const [stealHandle, setStealHandle] = useState('');
    const [stealFetching, setStealFetching] = useState(false);
    const [stealStatus, setStealStatus] = useState('Nothing loaded yet — fetch a handle or paste writing to begin.');
    const [stealError, setStealError] = useState('');

    const stripHandle = (raw: string) => raw.trim().replace(/^@/, '').replace(/^https?:\/\/(twitter|x)\.com\//i, '').split(/[/?#]/)[0];

    // Try the Chrome extension first: it opens the profile in a real (logged-in)
    // browser window, scrolls the timeline, and returns 10–20 ORIGINAL posts —
    // no proxy, no truncation, no login wall. Resolves with `null` if the
    // extension isn't installed or doesn't answer within the timeout so the
    // caller can fall back to the public proxy.
    const fetchPostsViaExtension = (handle: string, target = 15, timeoutMs = 70000): Promise<{
        posts: { text: string; id?: string; timestamp?: number }[];
        loginWall: boolean;
    } | null> => {
        return new Promise(resolve => {
            const requestId = 'sv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            let done = false;
            const cleanup = () => {
                if (done) return;
                done = true;
                window.removeEventListener('answerly_steal_voice_result', onResult as EventListener);
                clearTimeout(timer);
            };
            const onResult = (e: Event) => {
                const detail = (e as CustomEvent).detail || {};
                if (detail.requestId !== requestId) return;
                cleanup();
                if (detail.ok) {
                    resolve({ posts: detail.posts || [], loginWall: false });
                } else if (detail.loginWall) {
                    resolve({ posts: [], loginWall: true });
                } else {
                    resolve(null); // bridge said "no" — fall back
                }
            };
            const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
            window.addEventListener('answerly_steal_voice_result', onResult as EventListener);
            window.dispatchEvent(new CustomEvent('answerly_steal_voice_fetch', {
                detail: { handle, target, requestId }
            }));
        });
    };

    const fetchHandleAndCalibrate = async () => {
        const h = stripHandle(stealHandle);
        if (!h) { setStealError("Paste an @handle or X profile URL."); return; }
        setStealFetching(true);
        setStealError('');
        setStealStatus(`Opening @${h} in a Chrome window…`);
        try {
            // 1) PRIMARY PATH — Chrome extension opens the X profile in a real
            //    window, scrolls the timeline, and returns the latest original
            //    posts. Far more reliable than any HTML proxy.
            const ext = await fetchPostsViaExtension(h, 18);
            if (ext && ext.posts.length >= 5) {
                const joined = ext.posts.map(p => p.text).join('\n\n').slice(0, 8000);
                setStealStatus(`Read ${ext.posts.length} post${ext.posts.length === 1 ? '' : 's'} from @${h} — calibrating voice…`);
                setCalibrationSample(joined);
                // Prefill the save form so the user is one click from bottling
                // the new voice as "@handle".
                setSaveName(`@${h}`);
                setSaveNote(`Cloned from ${ext.posts.length} recent posts on ${new Date().toLocaleDateString()}`);
                await vp.aiCalibrate(joined);
                setStealStatus(`✓ Voice rebuilt from ${ext.posts.length} of @${h}'s posts. Name it below and save.`);
                return;
            }
            if (ext && ext.loginWall) {
                throw new Error(`Couldn't read @${h} — X is showing a login wall. Log in to x.com in this browser and try again.`);
            }

            // 2) FALLBACK — extension not installed / didn't respond. Use the
            //    public allorigins+Nitter proxy. Less reliable but keeps the
            //    button useful for users without the extension.
            setStealStatus(`Extension didn't respond — trying public proxy for @${h}…`);
            const tryUrls = [
                `https://nitter.net/${encodeURIComponent(h)}`,
                `https://x.com/${encodeURIComponent(h)}`
            ];
            let text = '';
            for (const u of tryUrls) {
                try {
                    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(u)}`);
                    if (!res.ok) continue;
                    const data = await res.json();
                    const cleaned = (data.contents || '')
                        .replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (cleaned.length > text.length) text = cleaned;
                    if (text.length > 800) break;
                } catch { /* try next */ }
            }
            if (text.length < 200) {
                throw new Error(`Couldn't read @${h}'s tweets. Install the Viraholic extension or paste 3–10 of their posts below and click "Build voice from this".`);
            }
            setStealStatus(`Read ~${text.length.toLocaleString()} chars from @${h} — calibrating voice…`);
            setCalibrationSample(text.slice(0, 6000));
            setSaveName(`@${h}`);
            setSaveNote(`Cloned via proxy on ${new Date().toLocaleDateString()}`);
            await vp.aiCalibrate(text.slice(0, 6000));
            setStealStatus(`✓ Voice rebuilt from @${h}'s posts. Name it below and save.`);
        } catch (e: any) {
            setStealError(e?.message || 'Fetch failed.');
            setStealStatus('Fetch failed — paste writing instead.');
        } finally {
            setStealFetching(false);
        }
    };

    // ── Saved-profiles library UI state ──
    const [saveName, setSaveName] = useState('');
    const [saveNote, setSaveNote] = useState('');
    // Track the last-applied saved profile so the tab row can highlight the
    // active selection (Chrome-tab style).
    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const applyProfileTab = (id: string) => { vp.applySavedProfile(id); setActiveProfileId(id); };
    // "+ New voice" — wipe the dials to a blank baseline and scroll the save
    // form into view so the user can name and bottle the fresh profile.
    const saveRef = useRef<HTMLDivElement>(null);
    const handleNewVoice = () => {
        vp.startNewVoice();
        setActiveProfileId(null);
        setSaveName('');
        setSaveNote('');
        setTimeout(() => saveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    };
    const handleSaveCurrent = () => {
        const p = vp.saveCurrentAsProfile(saveName, saveNote);
        if (p) {
            setSaveName('');
            setSaveNote('');
            setActiveProfileId(p.id); // highlight the new tab at the top
        }
    };

    const stealFromPaste = () => {
        if (!calibrationSample.trim()) {
            setStealError('Paste at least a few posts in the box below first.');
            return;
        }
        setStealError('');
        setStealStatus(`Calibrating voice from ${calibrationSample.length.toLocaleString()} chars of pasted writing…`);
        vp.aiCalibrate(calibrationSample);
    };

    return (
        <div className="max-w-5xl mx-auto space-y-10 animate-fade-in pb-24">
            {/* ─── SAVED PROFILES — Chrome-style tab selector at the very top ───
                Sits BEFORE any customization so the user picks a saved voice
                first (like switching browser tabs), then tweaks below. Applying
                a tab replaces every dial; the active tab is highlighted. */}
            <div className="border-b border-gray-200">
                <div className="flex items-end gap-1 flex-wrap">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 self-center mr-2 mb-2">Voices</span>
                    {vp.library.length === 0 ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-400 italic">
                            <Bookmark size={12} /> No saved voices yet — tune the dials below and save one at the bottom.
                        </div>
                    ) : (
                        vp.library.map(p => {
                            const isActive = activeProfileId === p.id;
                            const fp = `auth ${p.voiceMix.authority} · energy ${p.voiceMix.energy} · prov ${p.voiceMix.provocation} · humor ${p.voiceMix.humor} · warmth ${p.voiceMix.warmth}`;
                            const tip = `${p.note ? p.note + ' — ' : ''}${fp}\nSaved ${new Date(p.savedAt).toLocaleString()}`;
                            return (
                                <div
                                    key={p.id}
                                    title={tip}
                                    className={`group relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg border border-b-0 cursor-pointer transition-all -mb-px ${
                                        isActive
                                            ? 'bg-white border-gray-200 text-gray-900 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]'
                                            : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                                    }`}
                                    onClick={() => applyProfileTab(p.id)}
                                >
                                    <Bookmark size={12} className={isActive ? 'text-amber-600' : 'text-gray-400'} />
                                    <span className="text-xs font-medium whitespace-nowrap">{p.name}</span>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete saved voice "${p.name}"?`)) { vp.deleteSavedProfile(p.id); if (activeProfileId === p.id) setActiveProfileId(null); } }}
                                        title="Delete this voice"
                                        className="ml-0.5 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            );
                        })
                    )}
                    {/* + New voice — clears the dials to a blank baseline so the
                        user can build a fresh profile from scratch, then save it. */}
                    <button
                        type="button"
                        onClick={handleNewVoice}
                        title="Start a blank new voice — reset every dial, then save it as a new profile"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-t-lg border border-b-0 border-dashed border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400 hover:bg-gray-50 transition-all -mb-px ml-1"
                    >
                        <Plus size={13} />
                        <span className="text-xs font-semibold whitespace-nowrap">New voice</span>
                    </button>
                </div>
            </div>

            {/* ─── STEAL A VOICE — dominant one-click card ───
                Mirrors the reference Voice Studio's top card. Two paths:
                  1) Paste an X / Twitter handle → fetch their recent posts
                     via proxy → AI auto-builds the entire voice profile.
                  2) Paste writing directly → same calibration, no fetch.
                Both routes feed the same calibration sample state, so the
                voice section below picks up the result the moment AI finishes.
            */}
            <Section
                title="Steal a voice"
                subtitle="One-click automation — drop a handle or paste writing, AI builds the entire profile below."
                info="The engine clones their rhythm and structure, never their ideas — your topics stay yours."
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-[11px] font-bold text-amber-900 w-fit">
                        <Zap size={12} /> One-click automation
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">
                        Drop an <b>X / Twitter handle</b> — the agent opens their profile, reads their latest <b>original tweets</b>, and AI auto-builds your <b>entire voice profile below</b>: the 7 trait dials, rhythm, hook formula, amplifiers, closer, even your perspective. No manual setup. Tweak anything afterward.
                    </p>

                    {/* Handle row */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                            <Twitter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="@levelsio  —  paste any X / Twitter handle to clone"
                                value={stealHandle}
                                onChange={e => { setStealHandle(e.target.value); setStealError(''); }}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fetchHandleAndCalibrate(); } }}
                                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 focus:border-gray-400 rounded-xl text-sm outline-none transition-colors"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={fetchHandleAndCalibrate}
                            disabled={stealFetching || !stealHandle.trim() || vp.aiSuggesting}
                            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-medium disabled:opacity-40 transition-all"
                        >
                            {stealFetching ? <Loader2 size={12} className="animate-spin" /> : <Twitter size={12} />}
                            {stealFetching ? 'Fetching…' : '𝕏 Fetch & build profile'}
                        </button>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-3 text-[11px] text-gray-400 font-medium uppercase tracking-widest">
                        <div className="flex-1 h-px bg-gray-200"></div>
                        <span>or paste writing instead</span>
                        <div className="flex-1 h-px bg-gray-200"></div>
                    </div>

                    {/* Paste-writing fallback — shares the calibrationSample state
                        with the rest of the page so the "AI calibrate" button in
                        the Voice section also picks it up. */}
                    <textarea
                        ref={sampleRef}
                        rows={4}
                        placeholder="Paste 3–10 posts, tweets, or paragraphs from the voice you want to emulate…"
                        value={calibrationSample}
                        onChange={e => { setCalibrationSample(e.target.value); setSampleFlash(false); setStealError(''); }}
                        className={`w-full px-4 py-3 bg-white border rounded-xl text-sm outline-none resize-none leading-relaxed transition-all ${
                            sampleFlash ? 'border-amber-400 ring-4 ring-amber-200 animate-pulse' : 'border-gray-200 focus:border-gray-400'
                        }`}
                    />

                    {/* Status + build button */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-[11px] text-gray-500 italic flex-1 min-w-0 truncate" title={stealStatus}>
                            {vp.aiSuggesting ? 'Analyzing voice…' : stealStatus}
                        </div>
                        <button
                            type="button"
                            onClick={stealFromPaste}
                            disabled={vp.aiSuggesting || !calibrationSample.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-medium disabled:opacity-40 transition-all"
                        >
                            {vp.aiSuggesting ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                            ✦ Build voice from this
                        </button>
                    </div>

                    {stealError && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-amber-900 font-medium leading-relaxed">{stealError}</div>
                        </div>
                    )}

                    <div className="text-[11px] text-gray-400 italic">
                        The engine clones their <b>rhythm and structure</b>, never their ideas — your topics stay yours.
                    </div>
                </div>
            </Section>

            {/* Voice Architecture — owns the polygon, presets, hook builder, perspective injector */}
            <VoiceArchitectureSection
                activePreset={vp.activePreset}
                applyPreset={vp.applyPreset}
                voiceMix={vp.voiceMix}
                customizeVoice={vp.customizeVoice}
                setVoiceMix={vp.setVoiceMix}
                setActivePreset={vp.setActivePreset}
                hook={vp.hook}
                customizeHook={vp.customizeHook}
                perspective={vp.perspective}
                setPerspective={vp.setPerspective}
                viral={vp.viral}
                toggleViral={vp.toggleViral}
                closer={vp.closer}
                setCloser={vp.setCloserAndClear}
                variants={vp.variants}
                setVariants={vp.setVariants}
                onAiAutoSet={handleAiCalibrateClick}
                aiSuggesting={vp.aiSuggesting}
                aiSuggestionReason={vp.aiSuggestionReason}
                aiSuggestError={vp.aiSuggestError}
                sourceContent={calibrationSample}
                onOpenQuiz={() => setQuizOpen(true)}
            />

            {/* ─── COMMENT DEFAULTS ───
                The reply/quote STRATEGY, set once here and reused for every
                comment generated in the Posts Tracker (single + batch). Kept
                separate from the voice dials above (which shape the writing
                voice) so there's no redundancy — these shape intent & length. */}
            <Section
                title="Comment defaults"
                subtitle="How your replies should read — set once, every generated comment inherits it. No need to reconfigure per post."
                info="These are reused by the Posts Tracker comment generator (single and batch). The voice dials above shape HOW you write; these shape the reply's intent and length budget."
            >
                <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {/* Tone */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-2">Tone</label>
                            <div className="flex gap-2">
                                {[['casual', 'Casual'], ['formal', 'Formal'], ['funny', 'Witty']].map(([val, label]) => (
                                    <button key={val} type="button" onClick={() => vp.setCommentSpec({ tone: val })}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                            vp.commentSpec.tone === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                        }`}>{label}</button>
                                ))}
                            </div>
                        </div>
                        {/* Goal */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-2">What should each comment achieve?</label>
                            <select
                                value={vp.commentSpec.goal}
                                onChange={e => vp.setCommentSpec({ goal: e.target.value })}
                                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400 bg-white"
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
                            Max comment length: <span className="text-gray-900">{vp.commentSpec.maxLength} characters</span>
                        </label>
                        <input type="range" min={80} max={500} step={20}
                            value={vp.commentSpec.maxLength}
                            onChange={e => vp.setCommentSpec({ maxLength: Number(e.target.value) })}
                            className="w-full accent-gray-900"
                        />
                        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                            <span>Short (80)</span><span>Tweet-length (250)</span><span>Long (500)</span>
                        </div>
                    </div>
                    {/* Custom Instruction */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-2">Standing angle for every comment <span className="font-normal text-gray-400">(optional)</span></label>
                        <input type="text"
                            value={vp.commentSpec.customInstruction}
                            onChange={e => vp.setCommentSpec({ customInstruction: e.target.value })}
                            placeholder='e.g. "Tie back to shipping fast" or "Always be empathetic first"'
                            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400"
                        />
                    </div>
                    <p className="text-[11px] text-gray-400 italic">Saved into each voice profile — applying a saved voice also restores its comment defaults.</p>
                </div>
            </Section>

            {/* ─── SAVE CURRENT VOICE PROFILE (bottom of page) ───
                Lives at the end so users save AFTER tuning. The form is
                always visible — no toggle gymnastics. Saving adds a new
                chip to the Saved profiles row at the top. */}
            <Section
                title="Save voice profile"
                subtitle="Bottle the current voice under a name. Reapply any time from the Saved profiles row at the top — or from Content Engine and the Posts Tracker comment generator."
                info="Saves everything: the 7 trait axes, rhythm, hook, amplifiers, closer, and your perspective. Each saved profile can be applied with one click in any place that generates content."
            >
                <div ref={saveRef} className="space-y-3 p-4 bg-amber-50/50 border border-amber-200 rounded-2xl">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-amber-900 flex items-center gap-1.5">
                        <Save size={12} /> Save current voice profile
                    </div>
                    <input
                        type="text"
                        value={saveName}
                        onChange={e => setSaveName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) handleSaveCurrent(); }}
                        placeholder="Profile name (e.g. 'Launch-week voice', 'B2B sober', 'Spicy founder')"
                        className="w-full px-3 py-2 bg-white border border-amber-200 focus:border-amber-400 rounded-lg text-sm outline-none"
                    />
                    <input
                        type="text"
                        value={saveNote}
                        onChange={e => setSaveNote(e.target.value)}
                        placeholder="Optional one-line note — appears on the chip's hover tooltip"
                        className="w-full px-3 py-2 bg-white border border-amber-200 focus:border-amber-400 rounded-lg text-xs outline-none"
                    />
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-[11px] text-amber-900/70 italic">
                            Snapshot: <b>{vp.activePreset ? `Preset · ${vp.activePreset}` : (vp.aiSuggestionReason || 'Custom voice')}</b>
                        </div>
                        <button
                            type="button"
                            onClick={handleSaveCurrent}
                            disabled={!saveName.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-all"
                        >
                            <Bookmark size={12} /> Save profile
                        </button>
                    </div>
                </div>
            </Section>

            {quizOpen && (
                <VoiceMatchQuiz
                    onClose={() => setQuizOpen(false)}
                    onComplete={(result) => {
                        vp.setVoiceMix(result.voiceMix);
                        vp.setHook(result.hook);
                        vp.setViral(result.viral);
                        vp.setCloser(result.closer);
                        vp.setActivePreset(null);
                        vp.setAiSuggestionReason(`${result.personaName} — ${result.tagline}`);
                        setQuizOpen(false);
                    }}
                />
            )}
        </div>
    );
};
