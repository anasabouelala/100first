import React, { useState, useEffect, useRef, useMemo } from 'react';
import { generateBuyerPersonas, chatAsPersona, PersonaChatTurn } from '../services/geminiService';
import { BuyerPersonaAnalysis, BuyerPersona, PersonaRadar } from '../types';
import {
  MapPin, Target, Users, Zap, Loader2, Quote, Activity, Coffee, MessageSquare,
  Sparkles, ExternalLink, Send, X, Play, ChevronRight, Shield, Award
} from 'lucide-react';

interface PersonaViewProps {
  appName: string;
  appDesc: string;
  category: string;
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

// ─── Persona Card ─────────────────────────────────────────────────────
const PersonaCard: React.FC<{
  persona: BuyerPersona;
  themeIdx: number;
  onChat: () => void;
}> = ({ persona, themeIdx, onChat }) => {
  const theme = PERSONA_THEMES[themeIdx];
  const [activeTab, setActiveTab] = useState<'profile' | 'proof'>('profile');

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

      <div className="px-6 pt-4 flex items-center gap-1 border-b border-gray-50 flex-shrink-0">
        <TabBtn active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} color={theme.primary}>Profile</TabBtn>
        <TabBtn active={activeTab === 'proof'} onClick={() => setActiveTab('proof')} color={theme.primary}>
          <Shield size={11} /> Proof <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[9px]">{totalSources}</span>
        </TabBtn>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-5">
        {activeTab === 'profile' && (
          <>
            <div className="flex justify-center -mt-2">
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

            <div className="pt-3 border-t border-gray-50">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1">
                <MapPin size={11} /> Distribution Channels
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {persona.whereTheyHangOut.map((place, i) => (
                  <span key={i} className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${theme.tag}`}>{place}</span>
                ))}
              </div>
            </div>

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
          </>
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

// ─── Main View ────────────────────────────────────────────────────────
export const PersonaView: React.FC<PersonaViewProps> = ({ appName, appDesc, category }) => {
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
      const data = await generateBuyerPersonas(appName, appDesc, category);
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
          <h2 className="text-3xl font-display font-bold"><span className="text-primary">Buyer</span> Personas</h2>
          <p className="text-sm opacity-70 mt-1">Cinematic reveal · personality radar · live source proof · AI persona chat.</p>
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
            <h3 className="font-bold text-lg text-brand-primary">Generate Core Personas</h3>
            <p className="text-sm text-brand-secondary">Build highly specific profiles with personality radar charts, real source proof, and roleplay-ready AI chat.</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {analysis.personas.map((persona, idx) => (
              <PersonaCard
                key={idx}
                persona={persona}
                themeIdx={idx % PERSONA_THEMES.length}
                onChat={() => setChatTarget({ persona, themeIdx: idx % PERSONA_THEMES.length })}
              />
            ))}
          </div>
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
