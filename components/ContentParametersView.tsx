import React, { useState, useRef } from 'react';
import { Loader2, Wand2, Brain, AlertCircle, Link } from 'lucide-react';
import { useVoiceProfile } from '../hooks/useVoiceProfile';
import { VoiceArchitectureSection, VoiceMatchQuiz } from './ContentEngineView';
import { Section, PageHeader } from './ui/Section';

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

    // Style inspiration URL helper (mirrors the Content Engine helper)
    const [styleUrl, setStyleUrl] = useState('');
    const [styleUrlLoading, setStyleUrlLoading] = useState(false);
    const [styleUrlError, setStyleUrlError] = useState('');

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
            if (text.length < 50) throw new Error('Could not extract readable content. Paste it manually.');
            vp.setStyleInspiration(prev => prev ? prev + '\n\n' + text : text);
        } catch (e: any) {
            setStyleUrlError(e.message || 'Fetch failed. Paste the content manually instead.');
        } finally {
            setStyleUrlLoading(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-10 animate-fade-in pb-24">
            <PageHeader
                title="Content parameters"
                subtitle="Your voice profile, hooks, and style inspiration. Saved automatically — every post in Content Engine uses these."
            />

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

            {/* Calibration sample — feeds the AI calibrate button above */}
            <Section
                title="Calibration sample"
                subtitle="Paste a piece of writing (yours or a creator you admire) so the AI calibrate button has context to tune against. Not saved — used only for the next calibrate click."
            >
                <textarea
                    ref={sampleRef}
                    rows={4}
                    placeholder="Paste 2–5 posts here…"
                    value={calibrationSample}
                    onChange={e => setCalibrationSample(e.target.value)}
                    className={`w-full px-4 py-3 bg-white border rounded-xl text-sm outline-none resize-none leading-relaxed transition-all ${
                        sampleFlash
                            ? 'border-amber-400 ring-4 ring-amber-200 animate-pulse'
                            : 'border-gray-200 focus:border-gray-400'
                    }`}
                />
                {sampleFlash && (
                    <p className="text-xs text-amber-700 font-medium mt-2 flex items-center gap-1.5">
                        <AlertCircle size={12} /> Paste a writing sample here, then click "AI calibrate" again.
                    </p>
                )}
            </Section>

            {/* Style Inspiration — persisted, applied at generation time */}
            <Section
                title="Style inspiration"
                subtitle="Optional — paste posts from a creator you admire. Saved permanently. The engine clones their rhythm, not their ideas."
            >
                <div className="space-y-3">
                    {/* URL extractor */}
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Link size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="url"
                                placeholder="https://x.com/levelsio or any profile/post URL…"
                                value={styleUrl}
                                onChange={e => { setStyleUrl(e.target.value); setStyleUrlError(''); }}
                                className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-200 focus:border-gray-400 rounded-xl text-xs outline-none transition-colors" />
                        </div>
                        <button
                            type="button"
                            onClick={fetchStyleFromUrl}
                            disabled={styleUrlLoading || !styleUrl}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-medium disabled:opacity-40 transition-all duration-200 ease-out active:scale-[0.97]"
                        >
                            {styleUrlLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                            {styleUrlLoading ? 'Extracting…' : 'Extract'}
                        </button>
                    </div>
                    {styleUrlError && (
                        <div className="flex items-center gap-1.5 text-[11px] text-red-500">
                            <AlertCircle size={11} /> {styleUrlError}
                        </div>
                    )}

                    <textarea
                        rows={6}
                        placeholder={'Paste 2–5 posts from a creator you want to emulate…'}
                        value={vp.styleInspiration}
                        onChange={e => vp.setStyleInspiration(e.target.value)}
                        className="w-full px-4 py-3 bg-white border border-gray-200 focus:border-gray-400 rounded-xl text-xs outline-none resize-none leading-relaxed placeholder-gray-300 transition-colors"
                    />

                    {vp.styleInspiration && (
                        <div className="flex items-center justify-between">
                            <div className="text-[11px] text-gray-500">
                                Style captured — {vp.styleInspiration.length.toLocaleString()} chars
                            </div>
                            <button
                                type="button"
                                onClick={() => { vp.setStyleInspiration(''); setStyleUrl(''); }}
                                className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors underline underline-offset-2"
                            >Clear</button>
                        </div>
                    )}
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
