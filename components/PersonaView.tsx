import React, { useState, useEffect, useRef, useMemo } from 'react';
import { generateBuyerPersonas, chatAsPersona, PersonaChatTurn } from '../services/geminiService';
import { BuyerPersonaAnalysis, BuyerPersona, PersonaRadar } from '../types';
import { useProject } from '../contexts/ProjectContext';
import {
  MapPin, Target, Users, Zap, Loader2, Quote, Activity, Coffee, MessageSquare,
  Sparkles, ExternalLink, Send, X, Play, ChevronRight, Shield, Award,
  Building2, Briefcase, Wallet, Clock, AlertTriangle, Layers, Compass, TrendingUp, ShieldAlert
} from 'lucide-react';

// Props are now optional — context wins
interface PersonaViewProps {
  appName?: string;
  appDesc?: string;
  category?: string;
}

// ─── Personality radar axes (shared) ──────────────────────────────────
const RADAR_AXES: Array<{ key: keyof PersonaRadar; label: string; low: string; high: string }> = [
  { key: 'priceSensitive', label: 'Price',    low: 'Bargain',   high: 'Premium' },
  { key: 'techSavvy',      label: 'Tech',     low: 'Beginner',  high: 'Power' },
  { key: 'riskAverse',     label: 'Risk',     low: 'Adopter',   high: 'Averse' },
  { key: 'collaborative',  label: 'Social',   low: 'Solo',      high: 'Team' },
  { key: 'pragmatic',      label: 'Style',    low: 'Trendy',    high: 'Pragmatic' },
  { key: 'vocal',          label: 'Voice',    low: 'Quiet',     high: 'Vocal' }
];

// Per-persona color theme (index-based)
const PERSONA_THEMES = [
  { primary: '#0ea5e9', secondary: '#0284c7', glow: 'rgba(14,165,233,0.45)', gradient: 'from-sky-500 to-cyan-400',     bg: 'from-sky-50 to-cyan-50',     ring: 'ring-sky-200', text: 'text-sky-600', tag: 'bg-sky-100 text-sky-700' },
  { primary: '#f59e0b', secondary: '#d97706', glow: 'rgba(245,158,11,0.45)', gradient: 'from-amber-500 to-orange-400', bg: 'from-amber-50 to-orange-50', ring: 'ring-amber-200', text: 'text-amber-600', tag: 'bg-amber-100 text-amber-700' },
  { primary: '#8b5cf6', secondary: '#7c3aed', glow: 'rgba(139,92,246,0.45)', gradient: 'from-violet-500 to-purple-400', bg: 'from-violet-50 to-purple-50', ring: 'ring-violet-200', text: 'text-violet-600', tag: 'bg-violet-100 text-violet-700' },
  { primary: '#10b981', secondary: '#059669', glow: 'rgba(16,185,129,0.45)', gradient: 'from-emerald-500 to-teal-400', bg: 'from-emerald-50 to-teal-50', ring: 'ring-emerald-200', text: 'text-emerald-600', tag: 'bg-emerald-100 text-emerald-700' },
  { primary: '#ec4899', secondary: '#db2777', glow: 'rgba(236,72,153,0.45)', gradient: 'from-pink-500 to-rose-400',     bg: 'from-pink-50 to-rose-50',     ring: 'ring-pink-200', text: 'text-pink-600', tag: 'bg-pink-100 text-pink-700' }
];

const PLATFORM_LABEL = (p: string) => {
  const x = p.toLowerCase();
  if (x.includes('reddit'))      return { icon: '🔥', label: 'Reddit',       bg: 'bg-orange-50 text-orange-700 border-orange-200' };
  if (x.includes('twitter') || x.includes('x.com')) return { icon: '𝕏', label: 'X / Twitter',  bg: 'bg-gray-100 text-gray-900 border-gray-300' };
  if (x.includes('hacker') || x.includes('hn'))     return { icon: 'Y', label: 'HackerNews',   bg: 'bg-orange-50 text-orange-700 border-orange-200' };
  if (x.includes('linkedin'))    return { icon: '💼', label: 'LinkedIn',     bg: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (x.includes('indie'))       return { icon: '🚀', label: 'IndieHackers', bg: 'bg-violet-50 text-violet-700 border-violet-200' };
  return { icon: '🔗', label: p, bg: 'bg-gray-100 text-gray-700 border-gray-200' };
};

// DiceBear avatar URL (deterministic based on seed)
const avatarUrl = (seed: string) =>
  `https://api.dicebear.com/7.x/avataaars-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent&radius=50`;

// ─── Mini Radar Chart ─────────────────────────────────────────────────
const MiniRadarChart: React.FC<{ radar: PersonaRadar; color: string; glow: string; size?: number; animated?: boolean }> = ({
  radar, color, glow, size = 180, animated = true
}) => {
  const [progress, setProgress] = useState(animated ? 0 : 1);
  useEffect(() => {
    if (!animated) return;
    const start = Date.now();
    const duration = 1000;
    let raf: number;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated]);

  const center = size / 2;
  const radius = size * 0.36;
  const angles = RADAR_AXES.map((_, i) => (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2);
  const points = RADAR_AXES.map((ax, i) => {
    const v = (radar[ax.key] ?? 50) * progress;
    const r = (v / 100) * radius;
    return [center + r * Math.cos(angles[i]), center + r * Math.sin(angles[i])];
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map(level => {
        const pts = RADAR_AXES.map((_, i) => {
          const r = level * radius;
          return `${center + r * Math.cos(angles[i])},${center + r * Math.sin(angles[i])}`;
        }).join(' ');
        return <polygon key={level} points={pts} fill={level === 1 ? 'rgba(0,0,0,0.02)' : 'none'}
          stroke="#e5e7eb" strokeWidth={1} strokeDasharray={level < 1 ? '3,3' : '0'} />;
      })}
      {angles.map((a, i) => (
        <line key={i} x1={center} y1={center}
          x2={center + radius * Math.cos(a)} y2={center + radius * Math.sin(a)}
          stroke="#e5e7eb" strokeWidth={1} />
      ))}
      <polygon points={points.map(p => p.join(',')).join(' ')}
        fill={color} fillOpacity={0.18}
        stroke={color} strokeWidth={2.2} strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 10px ${glow})` }} />
      {progress > 0.7 && points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={color}
          style={{ opacity: (progress - 0.7) / 0.3 }} />
      ))}
      {RADAR_AXES.map((ax, i) => {
        const lx = center + (radius + 14) * Math.cos(angles[i]);
        const ly = center + (radius + 14) * Math.sin(angles[i]);
        return (
          <text key={i} x={lx} y={ly} fontSize={9} fontWeight={700}
            fill="#6b7280" textAnchor="middle" dominantBaseline="middle"
            style={{ opacity: progress, transition: 'opacity 600ms' }}>
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
};

// ─── Cinematic Reveal ─────────────────────────────────────────────────
const CinematicReveal: React.FC<{ personas: BuyerPersona[]; onClose: () => void }> = ({ personas, onClose }) => {
  const [step, setStep] = useState(0);
  const total = personas.length;

  useEffect(() => {
    const duration = step === 0 ? 2000 : 5500;
    const t = setTimeout(() => {
      if (step >= total) onClose();
      else setStep(s => s + 1);
    }, duration);
    return () => clearTimeout(t);
  }, [step, total, onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-gray-950 flex items-center justify-center overflow-hidden">
      <button onClick={onClose}
        className="absolute top-6 right-6 z-10 flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-xl text-xs font-bold tracking-widest uppercase backdrop-blur-md transition-all">
        Skip Intro <ChevronRight size={14} />
      </button>

      <div className="absolute top-6 left-6 flex gap-2 z-10">
        {Array.from({ length: total + 1 }).map((_, i) => (
          <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i === step ? 'w-12 bg-white' : i < step ? 'w-6 bg-white/60' : 'w-6 bg-white/15'}`} />
        ))}
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-20 blur-3xl animate-pulse"
          style={{ background: step > 0 ? PERSONA_THEMES[(step - 1) % PERSONA_THEMES.length].primary : '#3b82f6' }} />
        <div className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full opacity-15 blur-3xl animate-pulse"
          style={{ background: step > 0 ? PERSONA_THEMES[(step - 1) % PERSONA_THEMES.length].secondary : '#8b5cf6', animationDelay: '1s' }} />
      </div>

      {step === 0 ? (
        <div className="text-center px-6 animate-fade-in">
          <div className="text-amber-300 text-xs font-black tracking-[0.5em] uppercase mb-6 animate-pulse">Now Presenting</div>
          <h1 className="text-6xl md:text-8xl font-display font-black text-white tracking-tight mb-4">
            Your <span className="bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 bg-clip-text text-transparent">{total} Personas</span>
          </h1>
          <p className="text-white/40 text-lg font-medium mt-6 tracking-widest uppercase text-xs">Built from market signals</p>
        </div>
      ) : (
        <CinematicPersonaSlide persona={personas[step - 1]} themeIdx={(step - 1) % PERSONA_THEMES.length} index={step - 1} total={total} />
      )}
    </div>
  );
};

const CinematicPersonaSlide: React.FC<{ persona: BuyerPersona; themeIdx: number; index: number; total: number }> = ({ persona, themeIdx, index, total }) => {
  const theme = PERSONA_THEMES[themeIdx];
  const [showAvatar, setShowAvatar] = useState(false);
  const [showName, setShowName] = useState(false);
  const [showTagline, setShowTagline] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [typedName, setTypedName] = useState('');

  useEffect(() => {
    setShowAvatar(false); setShowName(false); setShowTagline(false); setShowQuote(false); setShowRadar(false); setTypedName('');
    const fullName = `${persona.name}, ${persona.role}`;
    const t0 = setTimeout(() => setShowAvatar(true), 200);
    const t1 = setTimeout(() => setShowName(true), 600);
    let i = 0;
    const typer = setInterval(() => {
      i++;
      setTypedName(fullName.slice(0, i));
      if (i >= fullName.length) clearInterval(typer);
    }, 40);
    const t2 = setTimeout(() => setShowTagline(true), 1800);
    const t3 = setTimeout(() => setShowRadar(true), 2400);
    const t4 = setTimeout(() => setShowQuote(true), 3400);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearInterval(typer); };
  }, [persona]);

  const radar = persona.personalityRadar || { priceSensitive: 50, techSavvy: 50, riskAverse: 50, collaborative: 50, pragmatic: 50, vocal: 50 };

  return (
    <div className="relative z-[1] max-w-5xl w-full px-8 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
      <div className="flex flex-col items-center gap-6">
        <div className={`relative transition-all duration-1000 ${showAvatar ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
          <div className="absolute inset-0 rounded-full blur-2xl"
            style={{ background: theme.primary, opacity: 0.5 }} />
          <div className="relative w-44 h-44 rounded-full bg-white p-1 shadow-2xl"
            style={{ boxShadow: `0 0 80px ${theme.glow}` }}>
            <img src={avatarUrl(persona.avatarSeed || persona.name)} alt={persona.name}
              className="w-full h-full rounded-full" />
          </div>
          <div className="absolute -top-3 -right-3 w-12 h-12 rounded-full bg-white text-gray-900 flex items-center justify-center font-black text-lg shadow-xl">
            {index + 1}<span className="text-xs opacity-40">/{total}</span>
          </div>
        </div>

        <div className={`transition-all duration-700 ${showRadar ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <MiniRadarChart radar={radar} color={theme.primary} glow={theme.glow} size={200} animated={showRadar} />
        </div>
      </div>

      <div className="text-white space-y-6">
        <div className={`transition-all duration-500 ${showName ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="text-xs font-black tracking-[0.4em] uppercase mb-3" style={{ color: theme.primary }}>
            Persona #{index + 1}
          </div>
          <h1 className="text-5xl md:text-6xl font-display font-black tracking-tight leading-tight min-h-[3.5rem]">
            {typedName}<span className="animate-pulse text-white/40">|</span>
          </h1>
        </div>

        {persona.tagline && (
          <div className={`text-2xl md:text-3xl font-medium leading-snug transition-all duration-700 delay-100 ${showTagline ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}
            style={{ color: theme.primary }}>
            "{persona.tagline}"
          </div>
        )}

        <div className={`grid grid-cols-3 gap-4 pt-2 transition-all duration-700 delay-200 ${showRadar ? 'opacity-100' : 'opacity-0'}`}>
          <StatCounter label="Pains" value={persona.painPoints.length} active={showRadar} color={theme.primary} />
          <StatCounter label="Goals" value={persona.goals.length} active={showRadar} color={theme.primary} />
          <StatCounter label="Channels" value={persona.whereTheyHangOut.length} active={showRadar} color={theme.primary} />
        </div>

        {persona.realWorldQuote && (
          <div className={`mt-6 pl-6 border-l-2 text-white/70 italic text-lg font-light leading-relaxed transition-all duration-700 ${showQuote ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3'}`}
            style={{ borderColor: theme.primary }}>
            "{persona.realWorldQuote}"
          </div>
        )}
      </div>
    </div>
  );
};

const StatCounter: React.FC<{ label: string; value: number; active: boolean; color: string }> = ({ label, value, active, color }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) { setCount(0); return; }
    let raf: number; const start = Date.now(); const duration = 800;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value]);
  return (
    <div className="bg-white/5 rounded-2xl px-3 py-4 text-center border border-white/10 backdrop-blur-sm">
      <div className="text-3xl font-black" style={{ color }}>{count}</div>
      <div className="text-[9px] tracking-[0.2em] uppercase text-white/40 font-bold mt-1">{label}</div>
    </div>
  );
};

// ─── Persona Chat Modal ───────────────────────────────────────────────
const PersonaChatModal: React.FC<{
  persona: BuyerPersona;
  themeIdx: number;
  appName: string;
  appDesc: string;
  onClose: () => void;
}> = ({ persona, themeIdx, appName, appDesc, onClose }) => {
  const theme = PERSONA_THEMES[themeIdx];
  const [history, setHistory] = useState<PersonaChatTurn[]>([
    { role: 'model', text: `Hey — I'm ${persona.name}. ${persona.tagline ? persona.tagline + '.' : ''} You wanted to talk about ${appName}? I've got like 5 minutes, what's the pitch?` }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, sending]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput(''); setError(null);
    setHistory(h => [...h, { role: 'user', text: msg }]);
    setSending(true);
    try {
      const reply = await chatAsPersona(persona, msg, history, { appName: appName || 'this product', appDesc: appDesc || '' });
      setHistory(h => [...h, { role: 'model', text: reply }]);
    } catch (e: any) {
      setError(e?.message || 'Failed to reach Gemini. Check API key.');
    } finally {
      setSending(false);
    }
  };

  const SUGGESTIONS = [
    "What's your biggest frustration right now?",
    `Would you pay $29/month for ${appName || 'this'}?`,
    "What's stopping you from switching to a new tool?",
    "Walk me through your current workflow."
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-gray-950/70 backdrop-blur-md animate-fade-in">
      <div className="bg-white rounded-3xl w-full max-w-2xl h-[85vh] shadow-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: `0 30px 80px ${theme.glow}` }}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-4 flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${theme.primary}10, ${theme.secondary}05)` }}>
          <div className="relative">
            <img src={avatarUrl(persona.avatarSeed || persona.name)}
              className="w-12 h-12 rounded-full bg-gray-50 p-0.5"
              style={{ boxShadow: `0 0 0 2px ${theme.primary}` } as any}
              alt={persona.name} />
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 truncate">{persona.name}</h3>
              <span className="text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full"
                style={{ background: `${theme.primary}15`, color: theme.primary }}>
                In Character
              </span>
            </div>
            <p className="text-xs text-gray-500 truncate">{persona.role} · Online now</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gradient-to-b from-gray-50/50 to-white">
          {history.map((turn, i) => (
            <ChatBubble key={i} turn={turn} themeColor={theme.primary} avatar={avatarUrl(persona.avatarSeed || persona.name)} />
          ))}
          {sending && (
            <div className="flex items-start gap-2">
              <img src={avatarUrl(persona.avatarSeed || persona.name)} className="w-7 h-7 rounded-full bg-gray-100" alt="" />
              <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-2.5 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {history.length <= 2 && !sending && (
          <div className="px-5 pb-2 flex flex-wrap gap-2 flex-shrink-0">
            {SUGGESTIONS.map(s => (
              <button key={s}
                onClick={() => setInput(s)}
                className="px-3 py-1.5 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-full border border-gray-200 transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="p-4 border-t border-gray-100 flex items-center gap-2 flex-shrink-0">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Ask ${persona.name} anything...`}
            className="flex-1 px-4 py-3 bg-gray-50 rounded-2xl border border-gray-200 focus:outline-none focus:border-gray-400 text-sm" />
          <button onClick={send} disabled={!input.trim() || sending}
            className="p-3 rounded-2xl text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
            style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` }}>
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>

        <div className="px-5 pb-3 text-center text-[9px] text-gray-300 font-bold uppercase tracking-widest flex-shrink-0">
          AI roleplay · pressure-test your pitch
        </div>
      </div>
    </div>
  );
};

const ChatBubble: React.FC<{ turn: PersonaChatTurn; themeColor: string; avatar: string }> = ({ turn, themeColor, avatar }) => {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-md text-white text-sm leading-relaxed"
          style={{ background: `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}>
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 animate-fade-in">
      <img src={avatar} className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" alt="" />
      <div className="max-w-[80%] bg-white border border-gray-100 px-4 py-2.5 rounded-2xl rounded-tl-md text-gray-800 text-sm leading-relaxed shadow-sm">
        {turn.text}
      </div>
    </div>
  );
};

// ─── ICP Snapshot block — appears at top of every card ──────────────
const ICPSnapshot: React.FC<{ persona: BuyerPersona; theme: typeof PERSONA_THEMES[number] }> = ({ persona, theme }) => {
  const cp = persona.companyProfile;
  const br = persona.buyerRole;
  if (!cp && !br) return null;

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      {/* Top ICP strip */}
      {cp && (
        <div className="p-4 bg-gradient-to-br from-gray-50 to-white">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={13} style={{ color: theme.primary }} />
            <h4 className="text-[10px] font-black uppercase tracking-widest" style={{ color: theme.primary }}>ICP Snapshot</h4>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ICPStat label="Industry" value={cp.industries.join(' · ')} />
            <ICPStat label="Company size" value={cp.companySize} />
            <ICPStat label="Stage" value={cp.stage} />
            <ICPStat label="ARR" value={cp.arrRange} />
          </div>
          {cp.techStackSignals?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Tech stack signals</div>
              <div className="flex flex-wrap gap-1">
                {cp.techStackSignals.map((t, i) => (
                  <span key={i} className="px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-700 rounded-md border border-gray-200">{t}</span>
                ))}
              </div>
            </div>
          )}
          {cp.estimatedTAM && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-2">
              <TrendingUp size={13} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-gray-700 font-medium leading-snug"><span className="text-emerald-700 font-black">TAM:</span> {cp.estimatedTAM}</p>
            </div>
          )}
        </div>
      )}
      {/* Buyer-role strip */}
      {br && (
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex items-start gap-3">
          <Briefcase size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0 text-xs space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest"
                style={{ background: `${theme.primary}15`, color: theme.primary }}>{br.type}</span>
              <span className="text-gray-500 font-medium">{br.decisionPower}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600"><Wallet size={11} /><span className="font-medium">{br.typicalBudget}</span></div>
            <div className="text-gray-500 leading-snug italic">{br.procurementFriction}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ICPStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</div>
    <div className="text-gray-800 font-semibold leading-tight mt-0.5 text-xs">{value || '—'}</div>
  </div>
);

// ─── Playbook tab content (triggers, stack, watering holes, outreach, objections) ───
const PlaybookView: React.FC<{ persona: BuyerPersona; theme: typeof PERSONA_THEMES[number] }> = ({ persona, theme }) => {
  const hasAny = !!(persona.triggerEvents?.length || persona.currentStack?.length || persona.wateringHoles?.length || persona.outreach || persona.objections?.length);
  if (!hasAny) {
    return (
      <div className="py-10 text-center">
        <Compass size={36} className="mx-auto mb-3 text-gray-200" />
        <p className="text-sm text-gray-400">Playbook data not generated.</p>
        <p className="text-xs text-gray-300 mt-1">Regenerate personas to capture trigger events, stack, watering holes, and outreach plan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Trigger events */}
      {persona.triggerEvents && persona.triggerEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={13} className="text-amber-500" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-600">Buy-Now Triggers</h4>
          </div>
          <div className="space-y-2">
            {persona.triggerEvents.map((t, i) => (
              <div key={i} className="bg-amber-50/40 border border-amber-100 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-gray-900 leading-snug flex-1">{t.event}</p>
                  <span className="flex-shrink-0 px-2 py-0.5 bg-amber-500 text-white rounded-md text-[9px] font-black tracking-widest flex items-center gap-1">
                    <Clock size={9} /> {t.urgencyDays}d
                  </span>
                </div>
                <div className="mt-2 pt-2 border-t border-amber-100/60 text-[11px] text-gray-600 leading-relaxed flex items-start gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 flex-shrink-0 mt-0.5">Signal:</span>
                  <span>{t.detectionSignal}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current stack (competition) */}
      {persona.currentStack && persona.currentStack.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Layers size={13} className="text-rose-500" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-rose-600">Current Stack (Competition)</h4>
          </div>
          <div className="space-y-1.5">
            {persona.currentStack.map((s, i) => {
              const fric = s.switchingFriction;
              const fricColor = fric === 'Low' ? 'bg-emerald-100 text-emerald-700' : fric === 'High' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
              return (
                <div key={i} className="bg-white border border-gray-100 rounded-xl p-3 hover:border-gray-200 transition-colors">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-sm text-gray-900 truncate">{s.tool}</span>
                      <span className="text-[10px] text-gray-400 font-medium truncate">· {s.rolePlayed}</span>
                    </div>
                    <span className={`flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md ${fricColor}`}>
                      {fric} switch
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 leading-snug italic">"{s.painWithIt}"</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Watering holes */}
      {persona.wateringHoles && persona.wateringHoles.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={13} className="text-violet-500" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-violet-600">Watering Holes</h4>
          </div>
          <div className="space-y-1.5">
            {persona.wateringHoles.map((w, i) => {
              const inner = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-sm text-gray-900 truncate">{w.name}</span>
                      <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700">{w.type}</span>
                    </div>
                    <span className="flex-shrink-0 text-[10px] text-gray-500 font-bold">{w.memberCount}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 block">Activity</span>
                      <span className="text-gray-700">{w.activityLevel}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 block">Best post</span>
                      <span className="text-gray-700 truncate">{w.bestPostFormat}</span>
                    </div>
                  </div>
                </>
              );
              return w.url ? (
                <a key={i} href={w.url} target="_blank" rel="noreferrer"
                  className="block bg-white border border-gray-100 rounded-xl p-3 hover:border-violet-200 hover:bg-violet-50/30 transition-colors">
                  {inner}
                </a>
              ) : (
                <div key={i} className="bg-white border border-gray-100 rounded-xl p-3">
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Outreach playbook */}
      {persona.outreach && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Send size={13} className="text-sky-500" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-sky-600">Outreach Playbook</h4>
          </div>
          <div className="bg-sky-50/40 border border-sky-100 rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mb-0.5">✓ Best channel</div>
                <p className="text-gray-800 font-medium leading-snug">{persona.outreach.bestChannel}</p>
              </div>
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-rose-700 mb-0.5">✗ Avoid</div>
                <p className="text-gray-800 font-medium leading-snug">{persona.outreach.worstChannel}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-sky-100/60 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Best time</div>
                <p className="text-gray-700 leading-snug">{persona.outreach.bestTimeToReach}</p>
              </div>
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Sales cycle</div>
                <p className="text-gray-700 leading-snug">~{persona.outreach.avgSalesCycleDays} days</p>
              </div>
            </div>
            <div className="pt-2 border-t border-sky-100/60">
              <div className="text-[9px] font-black uppercase tracking-widest text-sky-700 mb-1">First-message angle</div>
              <p className="text-xs text-gray-700 italic leading-relaxed">"{persona.outreach.openingAngle}"</p>
            </div>
          </div>
        </div>
      )}

      {/* Objections + counters */}
      {persona.objections && persona.objections.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert size={13} className="text-gray-500" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-600">Objections + Counters</h4>
          </div>
          <div className="space-y-2">
            {persona.objections.map((o, i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <span className="text-rose-400 text-[10px] font-black uppercase tracking-widest flex-shrink-0 mt-0.5">No:</span>
                  <p className="text-sm text-gray-800 leading-snug">{o.objection}</p>
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-gray-50 flex items-start gap-2">
                  <span className="text-emerald-500 text-[10px] font-black uppercase tracking-widest flex-shrink-0 mt-0.5">Win:</span>
                  <p className="text-xs text-gray-600 leading-snug">{o.counter}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Persona Card ─────────────────────────────────────────────────────
const PersonaCard: React.FC<{
  persona: BuyerPersona;
  themeIdx: number;
  onChat: () => void;
}> = ({ persona, themeIdx, onChat }) => {
  const theme = PERSONA_THEMES[themeIdx];
  const [activeTab, setActiveTab] = useState<'profile' | 'playbook' | 'proof'>('profile');

  const sourcesByPain = useMemo(() => {
    const map = new Map<number, NonNullable<BuyerPersona['painSources']>>();
    (persona.painSources || []).forEach(s => {
      const list = map.get(s.painIndex) || [];
      list.push(s);
      map.set(s.painIndex, list);
    });
    return map;
  }, [persona.painSources]);

  const radar = persona.personalityRadar || { priceSensitive: 50, techSavvy: 50, riskAverse: 50, collaborative: 50, pragmatic: 50, vocal: 50 };
  const totalSources = persona.painSources?.length || 0;

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-2xl transition-all overflow-hidden flex flex-col group">
      <div className={`relative p-6 bg-gradient-to-br ${theme.bg} border-b border-gray-100`}>
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl opacity-20"
          style={{ background: theme.primary }} />

        <div className="relative flex items-start gap-4">
          <div className="relative flex-shrink-0">
            <img src={avatarUrl(persona.avatarSeed || persona.name)}
              className="w-16 h-16 rounded-full bg-white p-0.5"
              style={{ boxShadow: `0 0 0 2px ${theme.primary}` } as any}
              alt={persona.name} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-display font-bold text-gray-900 leading-tight">{persona.name}</h3>
            <p className="text-xs font-bold uppercase tracking-widest mt-1" style={{ color: theme.primary }}>{persona.role}</p>
            {persona.tagline && (
              <p className="text-sm text-gray-600 mt-2 italic leading-relaxed">"{persona.tagline}"</p>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 pt-4 flex items-center gap-1 border-b border-gray-50 flex-shrink-0 overflow-x-auto">
        <TabBtn active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} color={theme.primary}>Profile</TabBtn>
        <TabBtn active={activeTab === 'playbook'} onClick={() => setActiveTab('playbook')} color={theme.primary}>
          <Compass size={11} /> Playbook
        </TabBtn>
        <TabBtn active={activeTab === 'proof'} onClick={() => setActiveTab('proof')} color={theme.primary}>
          <Shield size={11} /> Proof <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[9px]">{totalSources}</span>
        </TabBtn>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-5">
        {activeTab === 'profile' && (
          <>
            {/* ICP firmographics + buyer role — top of profile */}
            <ICPSnapshot persona={persona} theme={theme} />

            <div className="flex justify-center -mt-1">
              <MiniRadarChart radar={radar} color={theme.primary} glow={theme.glow} size={200} animated={true} />
            </div>

            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1 flex items-center gap-1">
                <Users size={11} /> Demographics
              </h4>
              <p className="text-sm text-gray-700 leading-relaxed">{persona.demographics}</p>
            </div>

            {persona.realWorldQuote && (
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 relative">
                <Quote className="absolute top-2 left-2 text-gray-200" size={18} />
                <p className="pl-5 text-sm text-gray-600 italic leading-relaxed">"{persona.realWorldQuote}"</p>
              </div>
            )}

            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-rose-500 mb-2 flex items-center gap-1">
                <Zap size={11} /> Core Pain Points
              </h4>
              <ul className="space-y-1.5">
                {persona.painPoints.map((point, i) => {
                  const hasProof = sourcesByPain.has(i);
                  return (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2 group/pain">
                      <span className="text-rose-400 mt-0.5">•</span>
                      <span className="flex-1">{point}</span>
                      {hasProof && (
                        <button onClick={() => setActiveTab('proof')}
                          className="text-[9px] font-black tracking-widest uppercase px-1.5 py-0.5 rounded-full text-emerald-700 bg-emerald-50 border border-emerald-200 transition-opacity flex-shrink-0 hover:bg-emerald-100">
                          <Shield size={9} className="inline mr-0.5" />
                          {sourcesByPain.get(i)!.length}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-2 flex items-center gap-1">
                <Target size={11} /> Goals & Desires
              </h4>
              <ul className="space-y-1.5">
                {persona.goals.map((g, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-emerald-500 mt-0.5">•</span> <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA strip to deep playbook */}
            {(persona.wateringHoles?.length || persona.triggerEvents?.length || persona.outreach) && (
              <button onClick={() => setActiveTab('playbook')}
                className="mt-1 w-full flex items-center justify-between px-4 py-3 rounded-2xl border-2 border-dashed hover:border-solid transition-all group/cta"
                style={{ borderColor: `${theme.primary}40`, background: `${theme.primary}05` }}>
                <div className="flex items-center gap-2">
                  <Compass size={14} style={{ color: theme.primary }} />
                  <span className="text-xs font-black uppercase tracking-widest" style={{ color: theme.primary }}>Open GTM Playbook →</span>
                </div>
                <span className="text-[10px] text-gray-500 font-bold">{persona.wateringHoles?.length || 0} channels · {persona.triggerEvents?.length || 0} triggers · {persona.currentStack?.length || 0} competitors</span>
              </button>
            )}

            {/* Legacy content-consumed (kept as fallback signal) */}
            {persona.contentTheyConsume && persona.contentTheyConsume.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1">
                  <Coffee size={11} /> Content Consumed
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {persona.contentTheyConsume.map((c, i) => (
                    <span key={i} className="text-[10px] font-medium px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{c}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'playbook' && (
          <PlaybookView persona={persona} theme={theme} />
        )}

        {activeTab === 'proof' && (
          <ProofView persona={persona} sourcesByPain={sourcesByPain} theme={theme} />
        )}
      </div>

      <div className="p-4 border-t border-gray-100 bg-gradient-to-br from-gray-50/30 to-white flex-shrink-0">
        <button onClick={onChat}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-white font-bold text-sm shadow-lg transition-all hover:scale-[1.02] active:scale-100 group/btn"
          style={{
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
            boxShadow: `0 8px 24px ${theme.glow}`
          }}>
          <MessageSquare size={16} className="group-hover/btn:scale-110 transition-transform" />
          Chat with {persona.name}
          <Sparkles size={14} className="text-white/70" />
        </button>
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; color: string; children: React.ReactNode }> = ({ active, onClick, color, children }) => (
  <button onClick={onClick}
    className="relative flex items-center gap-1 px-3 py-2 text-xs font-bold transition-colors"
    style={{ color: active ? color : '#9ca3af' }}>
    {children}
    {active && (
      <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full" style={{ background: color }} />
    )}
  </button>
);

// ─── Proof View ───────────────────────────────────────────────────────
const ProofView: React.FC<{
  persona: BuyerPersona;
  sourcesByPain: Map<number, NonNullable<BuyerPersona['painSources']>>;
  theme: typeof PERSONA_THEMES[number];
}> = ({ persona, sourcesByPain, theme }) => {
  const total = persona.painSources?.length || 0;

  if (total === 0) {
    return (
      <div className="py-10 text-center">
        <Shield size={36} className="mx-auto mb-3 text-gray-200" />
        <p className="text-sm text-gray-400">No sources captured for this persona.</p>
        <p className="text-xs text-gray-300 mt-1">Try regenerating personas — Gemini may surface sources next run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Award size={14} style={{ color: theme.primary }} />
        <h4 className="text-xs font-bold uppercase tracking-widest" style={{ color: theme.primary }}>
          Live Evidence — {total} source{total !== 1 ? 's' : ''}
        </h4>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed -mt-2">
        Real public posts where someone matching this persona voiced one of their pains.
      </p>

      {persona.painPoints.map((pain, i) => {
        const sources = sourcesByPain.get(i);
        if (!sources || sources.length === 0) return null;
        return (
          <div key={i} className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 bg-rose-50/40 border-b border-rose-100">
              <div className="text-[9px] font-black tracking-widest uppercase text-rose-500 mb-1">Pain #{i + 1}</div>
              <p className="text-sm text-gray-800 font-medium leading-snug">{pain}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {sources.map((src, j) => {
                const platform = PLATFORM_LABEL(src.platform);
                return (
                  <a key={j} href={src.url} target="_blank" rel="noreferrer"
                    className="block px-4 py-3 hover:bg-gray-50 transition-colors group/src">
                    <div className="flex items-start gap-3">
                      <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black tracking-widest uppercase rounded-md border ${platform.bg}`}>
                        <span className="text-sm leading-none">{platform.icon}</span>
                        {platform.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 italic leading-relaxed">"{src.snippet}"</p>
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400 font-medium group-hover/src:text-gray-600 transition-colors">
                          <ExternalLink size={10} /> <span className="truncate">{src.url}</span>
                        </div>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// ANALYTICS DASHBOARD COMPONENTS (Bloomberg-style)
// ═════════════════════════════════════════════════════════════════════

// Parse a number out of a string like "~18,000 companies" or "$2M-$20M ARR"
const parseFirstNumber = (s: string | undefined, scaleSuffix = true): number => {
  if (!s) return 0;
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmKMbB])?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (scaleSuffix && m[2]) {
    const u = m[2].toLowerCase();
    if (u === 'k') n *= 1000;
    else if (u === 'm') n *= 1_000_000;
    else if (u === 'b') n *= 1_000_000_000;
  }
  return n;
};

const formatBigNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
};

// ─── KPI Ticker (top bar) ─────────────────────────────────────────────
const KPITicker: React.FC<{ personas: BuyerPersona[] }> = ({ personas }) => {
  const totalTAM = personas.reduce((acc, p) => acc + parseFirstNumber(p.companyProfile?.estimatedTAM), 0);
  const avgCycle = Math.round(
    personas.reduce((acc, p) => acc + (p.outreach?.avgSalesCycleDays || 0), 0) / Math.max(1, personas.length)
  );
  const totalCompetitors = new Set(personas.flatMap(p => (p.currentStack || []).map(s => s.tool))).size;
  const totalTriggers = personas.reduce((acc, p) => acc + (p.triggerEvents?.length || 0), 0);
  const totalChannels = new Set(personas.flatMap(p => (p.wateringHoles || []).map(w => w.name))).size;
  const totalSources = personas.reduce((acc, p) => acc + (p.painSources?.length || 0), 0);

  const items = [
    { label: 'Total TAM',           value: totalTAM > 0 ? `~${formatBigNumber(totalTAM)}` : '—',  sub: 'companies in range',  trend: 'up'   as const, color: 'text-emerald-500' },
    { label: 'Avg Sales Cycle',     value: avgCycle ? `${avgCycle}d` : '—',                        sub: 'time to close',       trend: avgCycle < 60 ? 'up' as const : 'down' as const, color: avgCycle < 60 ? 'text-emerald-500' : 'text-rose-500' },
    { label: 'Competitors Found',   value: `${totalCompetitors}`,                                   sub: 'vendors in stack',    trend: 'flat' as const, color: 'text-amber-500' },
    { label: 'Buy-Now Triggers',    value: `${totalTriggers}`,                                      sub: 'events tracked',      trend: 'up'   as const, color: 'text-violet-500' },
    { label: 'Watering Holes',      value: `${totalChannels}`,                                      sub: 'channels mapped',     trend: 'up'   as const, color: 'text-sky-500' },
    { label: 'Validated Sources',   value: `${totalSources}`,                                       sub: 'public proof',        trend: 'up'   as const, color: 'text-pink-500' }
  ];

  return (
    <div className="bg-gray-900 rounded-2xl px-4 py-3 shadow-lg overflow-x-auto">
      <div className="flex items-stretch gap-px min-w-max">
        {items.map((it, i) => (
          <div key={i} className="flex-1 min-w-[160px] px-4 py-1 border-r border-white/5 last:border-r-0">
            <div className="flex items-center gap-1.5 text-[9px] font-black tracking-widest uppercase text-white/40">
              {it.label}
              {it.trend === 'up' && <TrendingUp size={9} className="text-emerald-400" />}
              {it.trend === 'down' && <TrendingUp size={9} className="text-rose-400 rotate-180" />}
            </div>
            <div className={`font-black text-2xl mt-0.5 ${it.color} font-mono tabular-nums`}>{it.value}</div>
            <div className="text-[10px] text-white/30 font-medium">{it.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Overlay Radar (all personas in one chart) ────────────────────────
const OverlayRadar: React.FC<{ personas: BuyerPersona[]; size?: number }> = ({ personas, size = 320 }) => {
  const center = size / 2;
  const radius = size * 0.34;
  const angles = RADAR_AXES.map((_, i) => (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const duration = 1200;
    let raf: number;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [personas]);

  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-500">Persona Overlay</div>
          <h4 className="font-bold text-sm text-gray-900">Personality Fingerprints</h4>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {personas.map((p, i) => {
            const t = PERSONA_THEMES[i % PERSONA_THEMES.length];
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: t.primary }} />
                <span className="text-[10px] font-bold text-gray-700">{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Grid */}
          {[0.25, 0.5, 0.75, 1].map(level => {
            const pts = RADAR_AXES.map((_, i) => {
              const r = level * radius;
              return `${center + r * Math.cos(angles[i])},${center + r * Math.sin(angles[i])}`;
            }).join(' ');
            return <polygon key={level} points={pts} fill="none" stroke="#e5e7eb" strokeWidth={1} strokeDasharray={level < 1 ? '3,3' : '0'} />;
          })}
          {/* Axis lines */}
          {angles.map((a, i) => (
            <line key={i} x1={center} y1={center}
              x2={center + radius * Math.cos(a)} y2={center + radius * Math.sin(a)}
              stroke="#e5e7eb" strokeWidth={1} />
          ))}
          {/* Overlay each persona */}
          {personas.map((p, idx) => {
            const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
            const radar = p.personalityRadar || { priceSensitive: 50, techSavvy: 50, riskAverse: 50, collaborative: 50, pragmatic: 50, vocal: 50 };
            const points = RADAR_AXES.map((ax, i) => {
              const v = (radar[ax.key] ?? 50) * progress;
              const r = (v / 100) * radius;
              return [center + r * Math.cos(angles[i]), center + r * Math.sin(angles[i])];
            });
            return (
              <polygon key={idx}
                points={points.map(pt => pt.join(',')).join(' ')}
                fill={t.primary} fillOpacity={0.1}
                stroke={t.primary} strokeWidth={2} strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 6px ${t.glow})` }} />
            );
          })}
          {/* Axis labels */}
          {RADAR_AXES.map((ax, i) => {
            const lx = center + (radius + 18) * Math.cos(angles[i]);
            const ly = center + (radius + 18) * Math.sin(angles[i]);
            return (
              <text key={i} x={lx} y={ly} fontSize={10} fontWeight={700}
                fill="#6b7280" textAnchor="middle" dominantBaseline="middle"
                style={{ opacity: progress }}>
                {ax.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// ─── Market Map (TAM vs sales cycle scatter) ──────────────────────────
const MarketMap: React.FC<{ personas: BuyerPersona[]; onChat: (idx: number) => void }> = ({ personas, onChat }) => {
  const W = 380, H = 260, PAD = 40;
  const tams = personas.map(p => parseFirstNumber(p.companyProfile?.estimatedTAM));
  const cycles = personas.map(p => p.outreach?.avgSalesCycleDays || 30);
  const maxTAM = Math.max(...tams, 10000);
  const maxCycle = Math.max(...cycles, 180);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="text-[10px] font-black tracking-widest uppercase text-gray-500">Market Map</div>
      <h4 className="font-bold text-sm text-gray-900 mb-2">TAM vs Sales Cycle</h4>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Axes */}
        <line x1={PAD} y1={H - PAD} x2={W - 10} y2={H - PAD} stroke="#e5e7eb" strokeWidth={1.5} />
        <line x1={PAD} y1={10} x2={PAD} y2={H - PAD} stroke="#e5e7eb" strokeWidth={1.5} />
        {/* Axis labels */}
        <text x={W / 2} y={H - 6} fontSize={10} fontWeight={700} fill="#9ca3af" textAnchor="middle" className="uppercase tracking-widest">Sales cycle days →</text>
        <text x={12} y={H / 2} fontSize={10} fontWeight={700} fill="#9ca3af" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="uppercase tracking-widest">TAM size →</text>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map(p => (
          <g key={p}>
            <line x1={PAD + (W - PAD - 10) * p} y1={10} x2={PAD + (W - PAD - 10) * p} y2={H - PAD} stroke="#f3f4f6" strokeDasharray="2,3" />
            <line x1={PAD} y1={(H - PAD - 10) * p + 10} x2={W - 10} y2={(H - PAD - 10) * p + 10} stroke="#f3f4f6" strokeDasharray="2,3" />
          </g>
        ))}
        {/* Bubbles */}
        {personas.map((p, idx) => {
          const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
          const x = PAD + ((cycles[idx] / maxCycle) * (W - PAD - 20));
          const y = (H - PAD) - ((tams[idx] / maxTAM) * (H - PAD - 20));
          // Bubble size based on relative TAM
          const size = 12 + (tams[idx] / maxTAM) * 28;
          return (
            <g key={idx} className="cursor-pointer" onClick={() => onChat(idx)}>
              <circle cx={x} cy={y} r={size} fill={t.primary} fillOpacity={0.25} />
              <circle cx={x} cy={y} r={size * 0.5} fill={t.primary} fillOpacity={0.8} stroke="white" strokeWidth={2} />
              <text x={x} y={y - size - 6} fontSize={11} fontWeight={800} fill="#111827" textAnchor="middle">{p.name}</text>
              <text x={x} y={y + size + 14} fontSize={9} fontWeight={700} fill={t.primary} textAnchor="middle" className="tracking-widest uppercase">
                {formatBigNumber(tams[idx])} · {cycles[idx]}d
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-[10px] text-gray-400 mt-1 text-center">Bubble size = TAM. Click a persona to start a chat.</p>
    </div>
  );
};

// ─── Mini horizontal bar (used in cells for visual comparison) ────────
const MetricBar: React.FC<{ value: number; max: number; color: string; label?: string; tabular?: boolean }> = ({ value, max, color, label, tabular = true }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className={`flex items-baseline justify-between gap-2 ${tabular ? 'font-mono tabular-nums' : ''}`}>
        <span className="text-sm font-black text-gray-900">{label || value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
};

// ─── COMPARISON MATRIX (the main dashboard table) ─────────────────────
const ComparisonMatrix: React.FC<{
  personas: BuyerPersona[];
  onChat: (idx: number) => void;
}> = ({ personas, onChat }) => {
  // Pre-compute maxes for cross-persona bar normalization
  const tams = personas.map(p => parseFirstNumber(p.companyProfile?.estimatedTAM));
  const maxTAM = Math.max(...tams, 1);
  const cycles = personas.map(p => p.outreach?.avgSalesCycleDays || 0);
  const maxCycle = Math.max(...cycles, 1);
  const budgets = personas.map(p => parseFirstNumber(p.buyerRole?.typicalBudget));
  const maxBudget = Math.max(...budgets, 1);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Sticky column headers */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-900 text-white">
            <tr>
              <th className="text-left p-4 w-[180px] font-black text-[10px] tracking-widest uppercase text-white/40 border-r border-white/5 sticky left-0 z-20 bg-gray-900">
                Dimension
              </th>
              {personas.map((p, idx) => {
                const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
                return (
                  <th key={idx} className="p-4 text-left border-r border-white/5 last:border-r-0 align-top min-w-[230px]">
                    <div className="flex items-start gap-3">
                      <img src={avatarUrl(p.avatarSeed || p.name)}
                        className="w-12 h-12 rounded-full bg-white p-0.5 flex-shrink-0"
                        style={{ boxShadow: `0 0 0 2px ${t.primary}` } as any}
                        alt={p.name} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-base text-white truncate">{p.name}</span>
                          <button onClick={() => onChat(idx)}
                            className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md transition-colors hover:opacity-90"
                            style={{ background: t.primary, color: 'white' }}
                            title={`Chat with ${p.name}`}>
                            <MessageSquare size={9} /> Chat
                          </button>
                        </div>
                        <div className="text-[10px] font-bold tracking-widest uppercase truncate" style={{ color: t.primary }}>{p.role}</div>
                        {p.tagline && (
                          <p className="text-[11px] text-white/60 italic mt-1 leading-snug line-clamp-2">"{p.tagline}"</p>
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="text-sm">
            {/* ──────── SECTION: AT A GLANCE ──────── */}
            <SectionRow label="At a glance" icon={<Briefcase size={11} />} />
            <DataRow label="Buyer role" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.buyerRole ? (
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest"
                        style={{ background: `${PERSONA_THEMES[idx % PERSONA_THEMES.length].primary}15`, color: PERSONA_THEMES[idx % PERSONA_THEMES.length].primary }}>
                        {p.buyerRole.type}
                      </span>
                      <div className="text-[11px] text-gray-500 mt-1 font-medium">{p.buyerRole.decisionPower}</div>
                    </div>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="TAM (companies)" sticky>
              {personas.map((p, idx) => {
                const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
                return (
                  <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                    <MetricBar value={tams[idx]} max={maxTAM} color={t.primary} label={tams[idx] > 0 ? `~${formatBigNumber(tams[idx])}` : '—'} />
                    {p.companyProfile?.estimatedTAM && (
                      <div className="text-[10px] text-gray-400 mt-1 leading-snug line-clamp-2">{p.companyProfile.estimatedTAM}</div>
                    )}
                  </td>
                );
              })}
            </DataRow>
            <DataRow label="Sales cycle" sticky>
              {personas.map((p, idx) => {
                const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
                const d = p.outreach?.avgSalesCycleDays || 0;
                return (
                  <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                    <MetricBar value={d} max={maxCycle} color={t.primary} label={d ? `${d} days` : '—'} />
                  </td>
                );
              })}
            </DataRow>
            <DataRow label="Budget authority" sticky>
              {personas.map((p, idx) => {
                const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
                return (
                  <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                    <MetricBar value={budgets[idx]} max={maxBudget} color={t.primary}
                      label={p.buyerRole?.typicalBudget || '—'} tabular={false} />
                  </td>
                );
              })}
            </DataRow>

            {/* ──────── SECTION: PAIN POINTS ──────── */}
            <SectionRow label="Pain Points" icon={<Zap size={11} />} color="text-rose-500" />
            <DataRow label="Top operational pains" sticky>
              {personas.map((p, idx) => {
                const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
                const sources = (p.painSources || []);
                return (
                  <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                    <ul className="space-y-1.5">
                      {p.painPoints.slice(0, 4).map((pp, i) => {
                        const proofCount = sources.filter(s => s.painIndex === i).length;
                        return (
                          <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug">
                            <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: t.primary }} />
                            <span className="text-gray-700 flex-1">{pp}</span>
                            {proofCount > 0 && (
                              <span className="flex-shrink-0 text-[8px] font-black tracking-widest uppercase px-1 py-px rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {proofCount}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                );
              })}
            </DataRow>
            <DataRow label="What they actually say" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.realWorldQuote ? (
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-2.5 text-[11px] text-gray-600 italic leading-relaxed">
                      "{p.realWorldQuote}"
                    </div>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Pain intensity radar" sticky>
              {personas.map((p, idx) => {
                const t = PERSONA_THEMES[idx % PERSONA_THEMES.length];
                const radar = p.personalityRadar || { priceSensitive: 50, techSavvy: 50, riskAverse: 50, collaborative: 50, pragmatic: 50, vocal: 50 };
                return (
                  <td key={idx} className="p-2 border-r border-gray-50 last:border-r-0 align-top">
                    <div className="flex justify-center">
                      <MiniRadarChart radar={radar} color={t.primary} glow={t.glow} size={140} animated={true} />
                    </div>
                  </td>
                );
              })}
            </DataRow>

            {/* ──────── SECTION: SOLUTIONS / CURRENT STACK ──────── */}
            <SectionRow label="Current Solutions (Competition)" icon={<Layers size={11} />} color="text-amber-500" />
            <DataRow label="Tools they use today" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.currentStack && p.currentStack.length > 0 ? (
                    <div className="space-y-1.5">
                      {p.currentStack.map((s, i) => {
                        const fricColor = s.switchingFriction === 'Low' ? 'bg-emerald-100 text-emerald-700' : s.switchingFriction === 'High' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
                        return (
                          <div key={i} className="text-[11px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-gray-900 truncate">{s.tool}</span>
                              <span className={`flex-shrink-0 text-[8px] font-black uppercase tracking-widest px-1 py-px rounded-sm ${fricColor}`}>{s.switchingFriction}</span>
                            </div>
                            <div className="text-gray-500 italic leading-snug truncate">{s.painWithIt}</div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Switching friction" sticky>
              {personas.map((p, idx) => {
                const tools = p.currentStack || [];
                const fricCount = { Low: 0, Medium: 0, High: 0 };
                tools.forEach(s => { fricCount[s.switchingFriction] = (fricCount[s.switchingFriction] || 0) + 1; });
                const total = tools.length;
                if (total === 0) return <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0"><Em>—</Em></td>;
                return (
                  <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                    <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                      <div className="bg-emerald-500" style={{ width: `${(fricCount.Low / total) * 100}%` }} title={`Low: ${fricCount.Low}`} />
                      <div className="bg-amber-500" style={{ width: `${(fricCount.Medium / total) * 100}%` }} title={`Medium: ${fricCount.Medium}`} />
                      <div className="bg-rose-500" style={{ width: `${(fricCount.High / total) * 100}%` }} title={`High: ${fricCount.High}`} />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[9px] font-bold uppercase tracking-widest">
                      {fricCount.Low > 0 && <span className="text-emerald-600">{fricCount.Low} Low</span>}
                      {fricCount.Medium > 0 && <span className="text-amber-600">{fricCount.Medium} Med</span>}
                      {fricCount.High > 0 && <span className="text-rose-600">{fricCount.High} High</span>}
                    </div>
                  </td>
                );
              })}
            </DataRow>

            {/* ──────── SECTION: DEMOGRAPHICS / FIRMOGRAPHICS ──────── */}
            <SectionRow label="Demographics & Firmographics" icon={<Building2 size={11} />} color="text-sky-500" />
            <DataRow label="Industry" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.companyProfile?.industries ? (
                    <div className="flex flex-wrap gap-1">
                      {p.companyProfile.industries.map((ind, i) => (
                        <span key={i} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-100">{ind}</span>
                      ))}
                    </div>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Company size" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top text-gray-700 font-semibold text-[12px]">
                  {p.companyProfile?.companySize || <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Stage" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top text-gray-700 font-semibold text-[12px]">
                  {p.companyProfile?.stage || <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="ARR range" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top text-gray-700 font-mono font-bold tabular-nums text-[12px]">
                  {p.companyProfile?.arrRange || <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Tech stack signals" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.companyProfile?.techStackSignals ? (
                    <div className="flex flex-wrap gap-1">
                      {p.companyProfile.techStackSignals.map((t, i) => (
                        <span key={i} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">{t}</span>
                      ))}
                    </div>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Person demographics" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top text-[11px] text-gray-600 leading-snug">
                  {p.demographics || <Em>—</Em>}
                </td>
              ))}
            </DataRow>

            {/* ──────── SECTION: WATERING HOLES ──────── */}
            <SectionRow label="Watering Holes" icon={<MapPin size={11} />} color="text-violet-500" />
            <DataRow label="Named communities" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.wateringHoles && p.wateringHoles.length > 0 ? (
                    <ul className="space-y-1">
                      {p.wateringHoles.slice(0, 4).map((w, i) => (
                        <li key={i} className="text-[11px]">
                          <div className="flex items-center justify-between gap-1.5">
                            {w.url ? (
                              <a href={w.url} target="_blank" rel="noreferrer" className="font-bold text-gray-900 truncate hover:text-violet-600 transition-colors">{w.name}</a>
                            ) : (
                              <span className="font-bold text-gray-900 truncate">{w.name}</span>
                            )}
                            <span className="flex-shrink-0 text-[9px] font-mono font-bold text-gray-500 tabular-nums">{w.memberCount}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 truncate">
                            <span className="text-violet-600 font-bold">{w.type}</span> · {w.activityLevel}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>

            {/* ──────── SECTION: TRIGGER EVENTS ──────── */}
            <SectionRow label="Buy-Now Triggers" icon={<Clock size={11} />} color="text-amber-500" />
            <DataRow label="Detect & act" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.triggerEvents && p.triggerEvents.length > 0 ? (
                    <ul className="space-y-1.5">
                      {p.triggerEvents.slice(0, 3).map((t, i) => (
                        <li key={i} className="text-[11px]">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-gray-900 leading-snug flex-1">{t.event}</span>
                            <span className="flex-shrink-0 text-[8px] font-black uppercase tracking-widest px-1 py-px rounded-sm bg-amber-100 text-amber-700">{t.urgencyDays}d</span>
                          </div>
                          <div className="text-[10px] text-gray-500 italic leading-snug mt-0.5">{t.detectionSignal}</div>
                        </li>
                      ))}
                    </ul>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>

            {/* ──────── SECTION: OUTREACH PLAYBOOK ──────── */}
            <SectionRow label="Outreach Playbook" icon={<Send size={11} />} color="text-emerald-500" />
            <DataRow label="Best channel" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.outreach?.bestChannel ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                      ✓ {p.outreach.bestChannel}
                    </span>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Avoid" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.outreach?.worstChannel ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
                      ✗ {p.outreach.worstChannel}
                    </span>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Best time to reach" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top text-[11px] text-gray-700 font-medium">
                  {p.outreach?.bestTimeToReach || <Em>—</Em>}
                </td>
              ))}
            </DataRow>
            <DataRow label="Opening angle" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.outreach?.openingAngle ? (
                    <div className="text-[11px] text-gray-600 italic leading-snug border-l-2 border-emerald-300 pl-2">
                      "{p.outreach.openingAngle}"
                    </div>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>

            {/* ──────── SECTION: PROOF ──────── */}
            <SectionRow label="Validated Sources" icon={<Shield size={11} />} color="text-pink-500" />
            <DataRow label="Public proof links" sticky>
              {personas.map((p, idx) => (
                <td key={idx} className="p-3 border-r border-gray-50 last:border-r-0 align-top">
                  {p.painSources && p.painSources.length > 0 ? (
                    <ul className="space-y-1">
                      {p.painSources.slice(0, 4).map((s, i) => {
                        const plat = PLATFORM_LABEL(s.platform);
                        return (
                          <li key={i}>
                            <a href={s.url} target="_blank" rel="noreferrer"
                              className="block text-[11px] hover:bg-gray-50 rounded-md p-1.5 transition-colors group/src">
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center gap-0.5 px-1 py-px text-[8px] font-black tracking-widest uppercase rounded-sm border ${plat.bg}`}>
                                  <span className="text-[10px]">{plat.icon}</span>
                                  {plat.label}
                                </span>
                                <ExternalLink size={9} className="text-gray-300 group-hover/src:text-gray-600 transition-colors" />
                              </div>
                              <div className="text-gray-600 italic leading-snug mt-0.5 line-clamp-2">"{s.snippet}"</div>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <Em>—</Em>}
                </td>
              ))}
            </DataRow>
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Section header row in the matrix
const SectionRow: React.FC<{ label: string; icon: React.ReactNode; color?: string }> = ({ label, icon, color = 'text-gray-400' }) => (
  <tr className="bg-gray-50 border-y border-gray-100">
    <td colSpan={4} className="px-4 py-2 sticky left-0 z-[5] bg-gray-50">
      <div className={`flex items-center gap-2 text-[10px] font-black tracking-widest uppercase ${color}`}>
        {icon} {label}
      </div>
    </td>
  </tr>
);

// Standard data row with sticky first column
const DataRow: React.FC<{ label: string; sticky?: boolean; children: React.ReactNode }> = ({ label, children }) => (
  <tr className="border-b border-gray-50 hover:bg-gray-50/40 transition-colors group/row">
    <td className="p-3 sticky left-0 z-[5] bg-white group-hover/row:bg-gray-50/40 border-r border-gray-100 align-top">
      <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 leading-tight">{label}</div>
    </td>
    {children}
  </tr>
);

const Em: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-gray-300 text-[11px] italic">{children}</span>
);

// ─── Main View ────────────────────────────────────────────────────────
export const PersonaView: React.FC<PersonaViewProps> = (props) => {
  const { project } = useProject();
  // Project context wins; fall back to legacy props for back-compat
  const appName = project?.productName || props.appName || '';
  const appDesc = project?.pitch || props.appDesc || '';
  const category = project?.category || props.category || '';
  const targetAudience = project?.targetAudience || category;

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<BuyerPersonaAnalysis | null>(() => {
    const saved = localStorage.getItem('buyer_personas');
    return saved ? JSON.parse(saved) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [chatTarget, setChatTarget] = useState<{ persona: BuyerPersona; themeIdx: number } | null>(null);

  const handleGenerate = async () => {
    if (!appName || !appDesc || !category) return;
    setLoading(true);
    setError(null);
    try {
      // Use targetAudience as the "category" for richer persona generation (per project context)
      const data = await generateBuyerPersonas(appName, appDesc, targetAudience || category);
      setAnalysis(data);
      localStorage.setItem('buyer_personas', JSON.stringify(data));
      setReveal(true);
    } catch (e: any) {
      console.error("Failed to fetch personas", e);
      setError(e?.message || "Failed to generate personas. Check your Gemini API key in .env.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-20">
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-base-300 pb-4">
        <div>
          <h2 className="text-3xl font-display font-bold"><span className="text-primary">Buyer</span> Personas <span className="text-xs font-bold tracking-widest uppercase text-gray-400 ml-2 align-middle">for SaaS founders</span></h2>
          <p className="text-sm opacity-70 mt-1">Comparison dashboard for B2B buyer intel — TAM ticker, personality overlay, market map, single matrix table from pains to outreach.</p>
        </div>
        {analysis && (
          <button onClick={() => setReveal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-black tracking-widest uppercase rounded-xl shadow-lg shadow-gray-200 transition-all">
            <Play size={14} /> Replay Reveal
          </button>
        )}
      </div>

      <div className="card bg-white border border-gray-100 shadow-minimal">
        <div className="card-body p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg text-brand-primary">Generate ICP-Grade Personas</h3>
            <p className="text-sm text-brand-secondary">Each persona ships with a searchable LinkedIn job title pattern, TAM estimate, current vendor stack (your competition), named watering holes with member counts, trigger events to detect, and a first-message outreach angle.</p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading || !appName || !appDesc || !category}
            className="btn btn-primary px-8 py-3 w-full sm:w-auto text-base whitespace-nowrap text-white shadow-lg hover:shadow-primary/30">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
            {loading ? 'Researching Market...' : 'Generate Personas'}
          </button>
        </div>
      </div>

      {(!appName || !appDesc || !category) && (
        <div className="alert bg-warning/20 text-warning-content">
          <Activity size={18} />
          <span>Please set up all Mission Control fields (Name, Pitch, Category) first!</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
          <Zap size={16} className="mt-0.5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 space-y-4">
          <span className="loading loading-spinner loading-lg text-primary"></span>
          <p className="text-brand-secondary font-medium">Analyzing market trends, building personality profiles, and surfacing live sources...</p>
        </div>
      ) : analysis ? (
        <div className="space-y-8 animate-fade-in">
          <div className="bg-gradient-to-r from-primary/10 to-secondary/10 p-6 rounded-2xl border border-primary/20">
            <h3 className="font-bold text-primary flex items-center gap-2 mb-2"><Activity size={20} /> Market Overview</h3>
            <p className="text-gray-700 leading-relaxed text-sm">{analysis.marketOverview}</p>
          </div>

          {/* ═══ KPI TICKER ═══ */}
          <KPITicker personas={analysis.personas} />

          {/* ═══ ANALYTICS CHARTS ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <OverlayRadar personas={analysis.personas} />
            <MarketMap personas={analysis.personas}
              onChat={(idx) => setChatTarget({ persona: analysis.personas[idx], themeIdx: idx % PERSONA_THEMES.length })} />
          </div>

          {/* ═══ COMPARISON MATRIX ═══ */}
          <ComparisonMatrix personas={analysis.personas}
            onChat={(idx) => setChatTarget({ persona: analysis.personas[idx], themeIdx: idx % PERSONA_THEMES.length })} />
        </div>
      ) : null}

      {reveal && analysis && (
        <CinematicReveal personas={analysis.personas} onClose={() => setReveal(false)} />
      )}

      {chatTarget && (
        <PersonaChatModal
          persona={chatTarget.persona}
          themeIdx={chatTarget.themeIdx}
          appName={appName}
          appDesc={appDesc}
          onClose={() => setChatTarget(null)}
        />
      )}
    </div>
  );
};
