import { useState, useEffect, useCallback } from 'react';
import {
  VoiceMix, HookArchitecture, ViralPhysics, CloserStrategy, PerspectiveInjector,
  suggestVoiceProfile
} from '../services/geminiService';
import { DEFAULT_PERSPECTIVE, VOICE_PRESETS } from '../components/ContentEngineView';

// ────────────────────────────────────────────────────────────────────
// SHARED VOICE-PROFILE HOOK
// Single source of truth for everything that persists across sessions:
// voice mix, hook architecture, viral physics, closer, variants,
// perspective injector, style inspiration. Both ContentParametersView
// (editor) and ContentEngineView (consumer at generation time) use this.
// All state is auto-persisted to localStorage on every change.
// ────────────────────────────────────────────────────────────────────

const KEY_VOICE = 'content_voice_profile_v2';
const KEY_PERSPECTIVE = 'content_perspective_v1';
const KEY_STYLE = 'content_style_inspiration_v1';
const KEY_LIBRARY = 'voice_profile_library_v1';
const KEY_COMMENT_SPEC = 'comment_spec_v1';
const LIBRARY_CAP = 50;

// ── COMMENT SPECIFICATION ───────────────────────────────────────────
// How engagement COMMENTS (replies/quotes) should read. Configured ONCE in
// Voice Studio and reused everywhere a comment is generated (Posts Tracker
// single + batch). These are intentionally distinct from the voiceMix dials
// (authority/energy/humor/…) — those shape the WRITING voice; these shape the
// reply STRATEGY (intent, length budget, one-off angle). No redundancy.
export interface CommentSpec {
  tone: string;            // casual | formal | funny — overall register
  goal: string;            // build_relationship | ask_question | share_insight | get_noticed
  maxLength: number;       // hard character budget for the reply
  customInstruction: string; // optional one-line angle applied to every comment
}

function defaultCommentSpec(): CommentSpec {
  return { tone: 'casual', goal: 'build_relationship', maxLength: 250, customInstruction: '' };
}

function loadCommentSpec(): CommentSpec {
  try {
    const raw = localStorage.getItem(KEY_COMMENT_SPEC);
    if (!raw) return defaultCommentSpec();
    return { ...defaultCommentSpec(), ...JSON.parse(raw) };
  } catch { return defaultCommentSpec(); }
}

interface PersistedVoice {
  voiceMix: VoiceMix;
  hook: HookArchitecture;
  viral: ViralPhysics;
  closer: CloserStrategy;
  variants: number;
  activePreset: string | null;
}

// A complete snapshot of the user's voice profile that they can name, save,
// and re-apply later. Includes the Perspective injector so the AI writes
// from the right point of view when the profile is reloaded.
export interface SavedVoiceProfile {
  id: string;
  name: string;
  savedAt: string;
  voiceMix: VoiceMix;
  hook: HookArchitecture;
  viral: ViralPhysics;
  closer: CloserStrategy;
  perspective: PerspectiveInjector;
  // Comment specification bundled with the voice so applying a saved profile
  // also restores how its replies should read (optional — older saves omit it).
  commentSpec?: CommentSpec;
  // optional one-line description the user types when saving — surfaces in
  // the chip tooltip so they remember WHY they saved this profile.
  note?: string;
}

function defaultVoice(): PersistedVoice {
  return {
    voiceMix: VOICE_PRESETS[0].voiceMix,
    hook: VOICE_PRESETS[0].hook,
    viral: VOICE_PRESETS[0].viral,
    closer: VOICE_PRESETS[0].closer,
    variants: 1,
    activePreset: 'brutal_founder'
  };
}

// Rewrite old closer ids → new ones from the reference Voice Studio set.
// Kept here (not imported from ContentEngineView to avoid a cycle).
const _CLOSER_MIGRATE: Record<string, string> = {
  open_question: 'open_invitation',
  open_loop:     'open_invitation',
  soft_proof:    'soft_landing'
};

function loadVoice(): PersistedVoice {
  try {
    const raw = localStorage.getItem(KEY_VOICE);
    if (!raw) return defaultVoice();
    const parsed = JSON.parse(raw);
    const d = defaultVoice();
    // Shallow-merge top-level + backfill nested voiceMix so persisted profiles
    // missing the newer axes (humor / warmth / optimism) don't render with
    // undefined values in the polygon. Migrate legacy closer ids to their new
    // equivalents so the picker highlights the right chip.
    const closer = parsed.closer && _CLOSER_MIGRATE[parsed.closer]
      ? _CLOSER_MIGRATE[parsed.closer]
      : (parsed.closer || d.closer);
    return {
      ...d,
      ...parsed,
      closer,
      voiceMix: { ...d.voiceMix, ...(parsed.voiceMix || {}) }
    };
  } catch { return defaultVoice(); }
}

function loadPerspective(): PerspectiveInjector {
  try {
    const raw = localStorage.getItem(KEY_PERSPECTIVE);
    return raw ? JSON.parse(raw) : DEFAULT_PERSPECTIVE;
  } catch { return DEFAULT_PERSPECTIVE; }
}

function loadStyle(): string {
  try { return localStorage.getItem(KEY_STYLE) || ''; } catch { return ''; }
}

function loadLibrary(): SavedVoiceProfile[] {
  try {
    const raw = localStorage.getItem(KEY_LIBRARY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function useVoiceProfile() {
  const loaded = loadVoice();
  const [activePreset, setActivePreset] = useState<string | null>(loaded.activePreset);
  const [voiceMix, setVoiceMix] = useState<VoiceMix>(loaded.voiceMix);
  const [hook, setHook] = useState<HookArchitecture>(loaded.hook);
  const [viral, setViral] = useState<ViralPhysics>(loaded.viral);
  const [closer, setCloser] = useState<CloserStrategy>(loaded.closer);
  const [variants, setVariants] = useState<number>(loaded.variants);
  const [perspective, setPerspective] = useState<PerspectiveInjector>(loadPerspective);
  const [styleInspiration, setStyleInspiration] = useState<string>(loadStyle);
  const [library, setLibrary] = useState<SavedVoiceProfile[]>(loadLibrary);
  const [commentSpec, setCommentSpecState] = useState<CommentSpec>(loadCommentSpec);

  // AI calibrate state — used by the parameters view's AI button.
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestionReason, setAiSuggestionReason] = useState<string | null>(null);
  const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);

  // Persist every change
  useEffect(() => {
    const profile: PersistedVoice = { voiceMix, hook, viral, closer, variants, activePreset };
    localStorage.setItem(KEY_VOICE, JSON.stringify(profile));
  }, [voiceMix, hook, viral, closer, variants, activePreset]);

  useEffect(() => {
    localStorage.setItem(KEY_PERSPECTIVE, JSON.stringify(perspective));
  }, [perspective]);

  useEffect(() => {
    localStorage.setItem(KEY_STYLE, styleInspiration);
  }, [styleInspiration]);

  useEffect(() => {
    try { localStorage.setItem(KEY_LIBRARY, JSON.stringify(library.slice(0, LIBRARY_CAP))); } catch {}
  }, [library]);

  useEffect(() => {
    try { localStorage.setItem(KEY_COMMENT_SPEC, JSON.stringify(commentSpec)); } catch {}
  }, [commentSpec]);

  // Patch helper — merge a partial update into the global comment spec.
  const setCommentSpec = useCallback((patch: Partial<CommentSpec>) => {
    setCommentSpecState(s => ({ ...s, ...patch }));
  }, []);

  // Helpers — any manual edit clears preset & AI reasoning
  const customizeVoice = useCallback((patch: Partial<VoiceMix>) => {
    setVoiceMix(v => ({ ...v, ...patch }));
    setActivePreset(null);
    setAiSuggestionReason(null);
  }, []);
  const customizeHook = useCallback((patch: Partial<HookArchitecture>) => {
    setHook(h => ({ ...h, ...patch }));
    setActivePreset(null);
    setAiSuggestionReason(null);
  }, []);
  const toggleViral = useCallback((key: keyof ViralPhysics) => {
    setViral(v => ({ ...v, [key]: !v[key] }));
    setActivePreset(null);
    setAiSuggestionReason(null);
  }, []);
  const applyPreset = useCallback((presetId: string) => {
    const p = VOICE_PRESETS.find(x => x.id === presetId);
    if (!p) return;
    setActivePreset(presetId);
    setVoiceMix(p.voiceMix);
    setHook(p.hook);
    setViral(p.viral);
    setCloser(p.closer);
    setAiSuggestionReason(null);
  }, []);
  const setCloserAndClear = useCallback((c: CloserStrategy) => {
    setCloser(c);
    setActivePreset(null);
    setAiSuggestionReason(null);
  }, []);

  // ── SAVED-PROFILES LIBRARY ─────────────────────────────────────────
  // Snapshot the current voice + perspective into a new entry. Returns the
  // saved profile so the caller can do its own toast / scroll-to behavior.
  const saveCurrentAsProfile = useCallback((name: string, note?: string): SavedVoiceProfile | null => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const profile: SavedVoiceProfile = {
      id: 'vp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: trimmed,
      savedAt: new Date().toISOString(),
      voiceMix: { ...voiceMix },
      hook: { ...hook },
      viral: { ...viral },
      closer,
      perspective: { ...perspective },
      commentSpec: { ...commentSpec },
      note: (note || '').trim() || undefined
    };
    setLibrary(prev => [profile, ...prev].slice(0, LIBRARY_CAP));
    return profile;
  }, [voiceMix, hook, viral, closer, perspective, commentSpec]);

  // Apply a saved profile in one click: blasts current state with the snapshot.
  const applySavedProfile = useCallback((id: string) => {
    const p = library.find(x => x.id === id);
    if (!p) return;
    setVoiceMix({ ...p.voiceMix });
    setHook({ ...p.hook });
    setViral({ ...p.viral });
    setCloser(p.closer);
    setPerspective({ ...p.perspective });
    if (p.commentSpec) setCommentSpecState({ ...defaultCommentSpec(), ...p.commentSpec });
    setActivePreset(null);
    setAiSuggestionReason(`Saved profile · ${p.name}`);
  }, [library]);

  const deleteSavedProfile = useCallback((id: string) => {
    setLibrary(prev => prev.filter(p => p.id !== id));
  }, []);

  // Start a BLANK new voice: reset every dial, hook, perspective, and comment
  // spec to a neutral baseline so the user can build a fresh profile from
  // scratch (then save it). Distinct from applyPreset (loads a built-in) and
  // applySavedProfile (loads a saved snapshot) — this clears the slate.
  const startNewVoice = useCallback(() => {
    const d = defaultVoice();
    setVoiceMix({ ...d.voiceMix });
    setHook({ ...d.hook });
    setViral({ ...d.viral });
    setCloser(d.closer);
    setPerspective(DEFAULT_PERSPECTIVE);
    setCommentSpecState(defaultCommentSpec());
    setVariants(1);
    setActivePreset(null);
    setAiSuggestionReason('New voice — tune the dials below, then save it.');
  }, []);

  const renameSavedProfile = useCallback((id: string, newName: string) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    setLibrary(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
  }, []);

  // AI calibrate — relies on the shared Gemini client via suggestVoiceProfile.
  // Caller passes a sample of the source content to inform the calibration.
  const aiCalibrate = useCallback(async (sourceContent: string, opts?: {
    format?: string; targetPlatforms?: string[];
  }) => {
    if (!sourceContent.trim()) {
      setAiSuggestError("Add a writing sample first so the AI knows what you're calibrating for.");
      return;
    }
    setAiSuggesting(true);
    setAiSuggestError(null);
    try {
      const suggestion = await suggestVoiceProfile({
        sourceContent,
        perspective,
        format: opts?.format,
        targetPlatforms: opts?.targetPlatforms,
        styleInspiration: styleInspiration || undefined
      });
      // Apply the writing-voice fields (rhythm lives inside voiceMix already).
      setVoiceMix(suggestion.voiceMix);
      setHook(suggestion.hook);
      setViral(suggestion.viral);
      setCloser(suggestion.closer);
      // Perspective + comment defaults — the "steal a voice" workflow asks
      // the model to infer these too so cloning a creator fills the whole
      // profile, not just the dials. We merge so any user-typed text the
      // model couldn't improve on stays untouched.
      if (suggestion.perspective) {
        setPerspective(prev => ({
          uniqueAngle:    suggestion.perspective.uniqueAngle    || prev.uniqueAngle,
          contrarian:     suggestion.perspective.contrarian     || prev.contrarian,
          forbiddenTakes: suggestion.perspective.forbiddenTakes || prev.forbiddenTakes,
          receipts:       suggestion.perspective.receipts       || prev.receipts
        }));
      }
      if (suggestion.commentSpec) {
        // maxLength is clamped to a sane window so the model can't suggest
        // a 5000-char "reply" or a 20-char one that would break the UI.
        const clampedMax = Math.max(80, Math.min(800, Math.round(suggestion.commentSpec.maxLength || 250)));
        setCommentSpec({
          tone:              suggestion.commentSpec.tone              || 'casual',
          goal:              suggestion.commentSpec.goal              || 'build_relationship',
          maxLength:         clampedMax,
          customInstruction: suggestion.commentSpec.customInstruction || ''
        });
      }
      // Style Inspiration — the writing sample IS the style guide. Persist
      // it so the Style Inspiration section reflects the stolen voice and
      // subsequent generations get the raw rhythm/word-choices to clone.
      // Cap at 4k chars so we don't bloat localStorage.
      setStyleInspiration(sourceContent.slice(0, 4000));
      setActivePreset(null);
      setAiSuggestionReason(suggestion.reasoning);
    } catch (e: any) {
      setAiSuggestError(e?.message || 'AI suggestion failed');
    } finally {
      setAiSuggesting(false);
    }
  }, [perspective, styleInspiration]);

  return {
    // state
    voiceMix, hook, viral, closer, variants, activePreset, perspective, styleInspiration,
    commentSpec,
    // setters
    setVoiceMix, setHook, setViral, setCloser, setVariants, setActivePreset, setPerspective, setStyleInspiration,
    setCommentSpec,
    // helpers
    customizeVoice, customizeHook, toggleViral, applyPreset, setCloserAndClear,
    // AI
    aiCalibrate, aiSuggesting, aiSuggestionReason, aiSuggestError,
    setAiSuggestionReason,
    // saved-profiles library
    library, saveCurrentAsProfile, applySavedProfile, deleteSavedProfile, renameSavedProfile,
    startNewVoice
  };
}

export type UseVoiceProfile = ReturnType<typeof useVoiceProfile>;
