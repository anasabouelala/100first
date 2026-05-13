import React, { useMemo } from 'react';
import {
  StrategyPlan, StrategyStep, GrowthLoop, AINativeTactic, First72Block,
  AntiPattern, TrustLever, LaunchRisk, FounderActivity, JourneyStage, PlanSummary
} from '../types';
import {
  Zap, Battery, Target, Rocket, Compass, RefreshCw, Sparkles, Clock,
  AlertTriangle, ShieldCheck, Users, ArrowRight, ArrowDown, X, Check,
  TrendingUp, Cpu, Network, Globe, Briefcase, Activity, BookOpen,
  GitBranch, Layers, Lightbulb, BookMarked, ChevronRight
} from 'lucide-react';

interface StrategyViewProps { plan: StrategyPlan }

export const StrategyView: React.FC<StrategyViewProps> = ({ plan }) => {
  return (
    <div className="space-y-12 animate-fade-in pb-20">

      {/* ═══════════ HERO ═══════════ */}
      <section className="bg-gradient-to-br from-indigo-950 via-gray-900 to-violet-950 rounded-[2rem] p-8 lg:p-10 text-white relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-violet-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-2 mb-3 text-[10px] font-black tracking-[0.3em] uppercase">
            <Rocket size={12} className="text-amber-300" />
            <span className="text-amber-300">Launch roadmap</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">2026 AI-era playbook</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold tracking-tight leading-[1.05] mb-3">
            Ship <span className="bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 bg-clip-text text-transparent">{plan.productName}</span> to its first 100 users
          </h1>
          <p className="text-white/60 text-base md:text-lg leading-relaxed max-w-3xl">
            Targeting <span className="text-white font-bold">{plan.targetAudience}</span>. Built for the post-AI-flood era where compounding loops, AI-native discovery, and founder brand beat the 2020 playbook.
          </p>

          {/* North Star + Pricing Thesis row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-8 pt-6 border-t border-white/10">
            {plan.northStarMetric && (
              <div>
                <div className="text-[10px] font-black tracking-widest uppercase text-amber-300 mb-1">★ North Star Metric</div>
                <div className="text-2xl font-display font-bold mb-1">{plan.northStarMetric.name}</div>
                <div className="text-[11px] font-mono text-emerald-400 font-bold mb-2">Target: {plan.northStarMetric.target}</div>
                <p className="text-xs text-white/50 leading-relaxed italic">{plan.northStarMetric.rationale}</p>
              </div>
            )}
            {plan.pricingThesis && (
              <div>
                <div className="text-[10px] font-black tracking-widest uppercase text-amber-300 mb-1">💰 Pricing Thesis</div>
                <p className="text-sm text-white/80 leading-relaxed">{plan.pricingThesis}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═══════════ TL;DR ═══════════ */}
      {plan.summary && <TLDRSection summary={plan.summary} />}

      {/* ═══════════ CUSTOMER JOURNEY ═══════════ */}
      {plan.customerJourney && plan.customerJourney.length > 0 && (
        <CustomerJourneySection stages={plan.customerJourney} />
      )}

      {/* ═══════════ THE WEDGE ═══════════ */}
      {plan.wedge && <WedgeDoctrine wedge={plan.wedge} />}

      {/* ═══════════ THE ROADMAP (PHASES) ═══════════ */}
      <RoadmapSection phases={plan.phases} />

      {/* ═══════════ GROWTH LOOPS ═══════════ */}
      {plan.growthLoops && plan.growthLoops.length > 0 && (
        <GrowthLoopsSection loops={plan.growthLoops} />
      )}

      {/* ═══════════ AI-NATIVE DISCOVERY ═══════════ */}
      {plan.aiNativeDiscovery && plan.aiNativeDiscovery.length > 0 && (
        <AINativeSection tactics={plan.aiNativeDiscovery} />
      )}

      {/* ═══════════ FIRST 72 HOURS ═══════════ */}
      {plan.first72Hours && plan.first72Hours.length > 0 && (
        <First72HoursSection blocks={plan.first72Hours} />
      )}

      {/* ═══════════ ANTI-PATTERNS ═══════════ */}
      {plan.antiPatterns && plan.antiPatterns.length > 0 && (
        <AntiPatternsSection patterns={plan.antiPatterns} />
      )}

      {/* ═══════════ TRUST LEVERS ═══════════ */}
      {plan.trustLevers && plan.trustLevers.length > 0 && (
        <TrustLeversSection levers={plan.trustLevers} />
      )}

      {/* ═══════════ RISK REGISTER ═══════════ */}
      {plan.risks && plan.risks.length > 0 && (
        <RiskRegisterSection risks={plan.risks} />
      )}

      {/* ═══════════ FOUNDER OPERATING MODEL + MOATS ═══════════ */}
      {plan.founderOperatingModel && plan.founderOperatingModel.length > 0 && (
        <FounderOperatingSection activities={plan.founderOperatingModel} moats={plan.compoundingMoats || []} />
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SECTION 01 — TL;DR (plain English summary)
// ═════════════════════════════════════════════════════════════════════
const TLDRSection: React.FC<{ summary: PlanSummary }> = ({ summary }) => (
  <section>
    <SectionHeader number="01" kicker="In plain English" title="The whole plan, in 30 seconds" accent="#f59e0b"
      intro="If you only read one section, read this. Everything below is just expansion on these points." />

    <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200/70 rounded-3xl p-6 lg:p-8 shadow-sm">
      {/* One-sentence */}
      <div className="mb-6 pb-6 border-b border-amber-200/60">
        <div className="text-[10px] font-black tracking-widest uppercase text-amber-700 mb-2">The plan in one sentence</div>
        <p className="text-2xl md:text-3xl font-display font-bold text-gray-900 leading-snug">{summary.oneSentence}</p>
      </div>

      {/* Bullets */}
      <div>
        <div className="text-[10px] font-black tracking-widest uppercase text-amber-700 mb-3">The plan in {summary.bullets.length} bullets</div>
        <ul className="space-y-3">
          {summary.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center font-black text-xs shadow-md">
                {i + 1}
              </div>
              <p className="text-base text-gray-800 leading-relaxed flex-1 pt-1">{b}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

// ═════════════════════════════════════════════════════════════════════
// SECTION 02 — CUSTOMER JOURNEY FUNNEL
// ═════════════════════════════════════════════════════════════════════
const CustomerJourneySection: React.FC<{ stages: JourneyStage[] }> = ({ stages }) => {
  const stageColors = [
    { bg: 'bg-gray-100',     text: 'text-gray-700',    accent: '#6b7280', label: 'bg-gray-500' },
    { bg: 'bg-sky-100',      text: 'text-sky-700',     accent: '#0ea5e9', label: 'bg-sky-500' },
    { bg: 'bg-violet-100',   text: 'text-violet-700',  accent: '#8b5cf6', label: 'bg-violet-500' },
    { bg: 'bg-amber-100',    text: 'text-amber-700',   accent: '#f59e0b', label: 'bg-amber-500' },
    { bg: 'bg-emerald-100',  text: 'text-emerald-700', accent: '#10b981', label: 'bg-emerald-500' }
  ];

  return (
    <section>
      <SectionHeader number="02" kicker="The big picture" title="The customer journey: stranger → paying user" accent="#0ea5e9"
        intro="How someone goes from never hearing about you, to clicking through, to paying. Each stage tells you what they think, what you do, and where it happens." />

      {/* Funnel visualization */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 lg:p-8 shadow-sm">
        {/* Horizontal funnel bar */}
        <div className="hidden lg:flex items-stretch gap-2 mb-6">
          {stages.map((s, i) => {
            const c = stageColors[i % stageColors.length];
            const widthClass = i === 0 ? 'flex-[5]' : i === 1 ? 'flex-[4]' : i === 2 ? 'flex-[3]' : i === 3 ? 'flex-[2]' : 'flex-1';
            return (
              <div key={i} className={`${widthClass} ${c.bg} border-2 rounded-2xl p-3 flex flex-col items-center justify-center text-center relative`}
                style={{ borderColor: c.accent }}>
                <div className="text-[9px] font-mono font-black text-gray-400 mb-1">Stage {i + 1}</div>
                <div className={`text-sm font-bold ${c.text} leading-tight`}>{s.stage}</div>
                <div className="text-[10px] text-gray-500 mt-1 font-mono tabular-nums">~{s.typicalDays}d</div>
                {i < stages.length - 1 && (
                  <ChevronRight size={20} className="absolute -right-3 top-1/2 -translate-y-1/2 text-gray-300 z-10 bg-white rounded-full" />
                )}
              </div>
            );
          })}
        </div>

        {/* Stage detail cards */}
        <div className="space-y-3">
          {stages.map((s, i) => {
            const c = stageColors[i % stageColors.length];
            return (
              <div key={i} className="grid grid-cols-1 lg:grid-cols-[140px_1fr] gap-4 p-4 rounded-2xl hover:bg-gray-50/50 transition-colors border border-gray-100">
                {/* Stage label */}
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-2xl ${c.label} text-white flex items-center justify-center font-black text-sm flex-shrink-0`}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="text-[9px] font-black tracking-widest uppercase text-gray-400">Stage</div>
                    <div className={`text-sm font-bold ${c.text} leading-tight`}>{s.stage}</div>
                    <div className="text-[10px] text-gray-400 mt-1 font-mono tabular-nums">~{s.typicalDays} days here</div>
                  </div>
                </div>

                {/* Content */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-[9px] font-black tracking-widest uppercase text-gray-400 mb-1">They think</div>
                    <p className="text-xs text-gray-700 italic leading-snug">"{s.whatTheyThink}"</p>
                  </div>
                  <div>
                    <div className="text-[9px] font-black tracking-widest uppercase mb-1" style={{ color: c.accent }}>You do</div>
                    <p className="text-xs text-gray-800 font-bold leading-snug">{s.yourMove}</p>
                    <div className="text-[10px] text-gray-400 mt-1">in {s.channel}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-black tracking-widest uppercase text-emerald-600 mb-1">Example</div>
                    <p className="text-xs text-gray-600 leading-snug italic">{s.example}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SECTION WRAPPER
// ═════════════════════════════════════════════════════════════════════
const SectionHeader: React.FC<{
  number: string;
  kicker: string;
  title: string;
  intro: string;
  accent: string;
}> = ({ number, kicker, title, intro, accent }) => (
  <div className="flex items-start gap-4 mb-6">
    <div className="flex flex-col items-center gap-2 flex-shrink-0">
      <span className="text-[10px] font-black tracking-[0.3em] uppercase" style={{ color: accent }}>{kicker}</span>
      <div className="w-[2px] h-12 rounded-full" style={{ background: accent }} />
      <span className="text-xs font-mono font-black" style={{ color: accent }}>{number}</span>
    </div>
    <div className="flex-1 pt-4">
      <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tight text-gray-900 mb-2">{title}</h2>
      <p className="text-sm md:text-base text-gray-500 leading-relaxed max-w-3xl">{intro}</p>
    </div>
  </div>
);

// ═════════════════════════════════════════════════════════════════════
// SECTION 01 — WEDGE DOCTRINE
// ═════════════════════════════════════════════════════════════════════
const WedgeDoctrine: React.FC<{ wedge: NonNullable<StrategyPlan['wedge']> }> = ({ wedge }) => (
  <section>
    <SectionHeader number="03" kicker="Step 1" title="Where to start (and where to expand)" accent="#0ea5e9"
      intro="Pick the smallest, most specific group of users you can win 100% — then expand outward. The mistake most founders make: aiming too broad on day 1." />

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200/60 rounded-3xl p-6">
        <div className="text-[10px] font-black tracking-widest uppercase text-sky-700 mb-2">🎯 Wedge use case</div>
        <p className="text-2xl font-display font-bold text-gray-900 leading-tight mb-4">{wedge.useCase}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 border-t border-sky-200/60">
          <div>
            <div className="text-[10px] font-black tracking-widest uppercase text-gray-500 mb-1">For</div>
            <p className="text-sm font-bold text-gray-800 leading-snug">{wedge.idealUser}</p>
          </div>
          <div>
            <div className="text-[10px] font-black tracking-widest uppercase text-gray-500 mb-1">Why now (2026)</div>
            <p className="text-sm text-gray-700 leading-snug italic">{wedge.whyNow}</p>
          </div>
        </div>
      </div>

      {/* Expansion path visualization */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
        <div className="text-[10px] font-black tracking-widest uppercase text-gray-500 mb-3">→ Expansion path</div>
        <ol className="space-y-3">
          {wedge.expansionPath.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-xl bg-gradient-to-br from-sky-500 to-blue-500 text-white flex items-center justify-center font-black text-xs shadow-md">
                {i + 1}
              </div>
              <div className="flex-1 pt-1">
                <p className="text-sm text-gray-800 leading-snug">{step}</p>
                {i < wedge.expansionPath.length - 1 && (
                  <div className="ml-[-3px] mt-2"><ArrowDown size={12} className="text-gray-300" /></div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  </section>
);

// ═════════════════════════════════════════════════════════════════════
// SECTION 02 — ROADMAP (PHASES)
// ═════════════════════════════════════════════════════════════════════
const RoadmapSection: React.FC<{ phases: StrategyPlan['phases'] }> = ({ phases }) => (
  <section>
    <SectionHeader number="04" kicker="Step 2" title="Your week-by-week plan" accent="#10b981"
      intro="3-4 phases, each with a clear goal and one success number. Inside each phase: 3-5 specific things to do. Every step has an AI shortcut so you don't do it the slow way." />

    <div className="space-y-4">
      {phases.map((phase, idx) => (
        <PhaseCard key={idx} phase={phase} index={idx} />
      ))}
    </div>
  </section>
);

const PhaseCard: React.FC<{ phase: StrategyPlan['phases'][number]; index: number }> = ({ phase, index }) => {
  const colors = [
    { bg: 'from-emerald-50 to-teal-50', border: 'border-emerald-200/60', accent: 'text-emerald-700', dot: 'bg-emerald-500' },
    { bg: 'from-blue-50 to-cyan-50',    border: 'border-blue-200/60',    accent: 'text-blue-700',    dot: 'bg-blue-500' },
    { bg: 'from-violet-50 to-purple-50', border: 'border-violet-200/60',  accent: 'text-violet-700',  dot: 'bg-violet-500' },
    { bg: 'from-amber-50 to-orange-50',  border: 'border-amber-200/60',   accent: 'text-amber-700',   dot: 'bg-amber-500' }
  ];
  const c = colors[index % colors.length];

  return (
    <div className={`bg-gradient-to-br ${c.bg} ${c.border} border rounded-3xl overflow-hidden`}>
      {/* Phase header */}
      <div className="p-6 border-b border-white/40">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className={`text-[10px] font-black tracking-widest uppercase ${c.accent} mb-1`}>
              {phase.weekRange || `Phase ${index + 1}`}
            </div>
            <h3 className="text-2xl font-display font-bold text-gray-900">{phase.phaseName}</h3>
            {phase.goal && (
              <p className="text-sm text-gray-700 mt-2 leading-relaxed italic max-w-2xl">→ {phase.goal}</p>
            )}
          </div>
          {phase.successMetric && (
            <div className="bg-white/60 backdrop-blur-sm border border-white/60 rounded-2xl px-4 py-3">
              <div className={`text-[9px] font-black tracking-widest uppercase ${c.accent} mb-0.5`}>Success metric</div>
              <p className="text-sm font-bold text-gray-900 font-mono tabular-nums">{phase.successMetric}</p>
            </div>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="p-6 space-y-3 bg-white/30">
        {phase.steps.map((step) => (
          <StepCard key={step.id} step={step} dotColor={c.dot} />
        ))}
      </div>
    </div>
  );
};

const StepCard: React.FC<{ step: StrategyStep; dotColor: string }> = ({ step, dotColor }) => {
  const impactColor = step.impact === 'High' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : step.impact === 'Medium' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-gray-100 text-gray-600 border-gray-200';
  const effortColor = step.effort === 'High' ? 'bg-rose-100 text-rose-700 border-rose-200'
    : step.effort === 'Medium' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-emerald-100 text-emerald-700 border-emerald-200';

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 hover:shadow-sm transition-all">
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-2 h-2 rounded-full ${dotColor} mt-2`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1.5">
            <h4 className="font-bold text-base text-gray-900 leading-snug flex-1">{step.title}</h4>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 border border-gray-200 inline-flex items-center gap-1">
                <Target size={9} /> {step.channel}
              </span>
              <span className={`text-[10px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md border ${impactColor}`}>
                {step.impact} impact
              </span>
              <span className={`text-[10px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md border ${effortColor}`}>
                {step.effort} effort
              </span>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>
          {step.aiAngle && (
            <div className="mt-3 pt-3 border-t border-gray-50 flex items-start gap-2">
              <Sparkles size={12} className="text-violet-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-[9px] font-black tracking-widest uppercase text-violet-600 mr-1">AI angle:</span>
                <span className="text-[11px] text-gray-600 italic leading-relaxed">{step.aiAngle}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SECTION 03 — GROWTH LOOPS (with circular SVG)
// ═════════════════════════════════════════════════════════════════════
const GrowthLoopsSection: React.FC<{ loops: GrowthLoop[] }> = ({ loops }) => (
  <section>
    <SectionHeader number="05" kicker="Engines" title="Growth loops: how one user brings the next" accent="#8b5cf6"
      intro="A growth loop is when something a user does today creates fuel for the next user to find you. Unlike ads (you stop paying = users stop coming), loops keep working while you sleep." />

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {loops.map((loop, idx) => <GrowthLoopCard key={idx} loop={loop} />)}
    </div>
  </section>
);

const GrowthLoopCard: React.FC<{ loop: GrowthLoop }> = ({ loop }) => {
  const typeColors: Record<string, { bg: string; text: string; ring: string }> = {
    Content:   { bg: 'bg-violet-100', text: 'text-violet-700', ring: '#8b5cf6' },
    Network:   { bg: 'bg-sky-100',    text: 'text-sky-700',    ring: '#0ea5e9' },
    Product:   { bg: 'bg-emerald-100',text: 'text-emerald-700',ring: '#10b981' },
    Community: { bg: 'bg-amber-100',  text: 'text-amber-700',  ring: '#f59e0b' },
    Data:      { bg: 'bg-pink-100',   text: 'text-pink-700',   ring: '#ec4899' },
    Sales:     { bg: 'bg-rose-100',   text: 'text-rose-700',   ring: '#f43f5e' }
  };
  const c = typeColors[loop.type] || typeColors.Content;
  const leverageColor = loop.leverage === 'High' ? 'text-emerald-600' : loop.leverage === 'Medium' ? 'text-amber-600' : 'text-gray-500';

  // Circular loop SVG — plain-English labels
  const stages = [
    { label: '① Kick off',   text: loop.trigger,      angle: -90 },
    { label: '② User does',  text: loop.action,       angle: 0 },
    { label: '③ Result',     text: loop.output,       angle: 90 },
    { label: '④ Snowballs',  text: loop.reinvestment, angle: 180 }
  ];

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[9px] font-black tracking-widest uppercase px-2 py-1 rounded-md ${c.bg} ${c.text}`}>{loop.type}</span>
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-gray-500">
          <Clock size={10} /> Pays off in {loop.velocityWeeks}w · <span className={leverageColor}>{loop.leverage} payback</span>
        </div>
      </div>
      <h3 className="font-display font-bold text-lg text-gray-900 mb-4 leading-snug">{loop.name}</h3>

      {/* Compact loop diagram */}
      <div className="relative mb-2">
        <svg width="100%" height="40" viewBox="0 0 320 40" className="overflow-visible">
          <defs>
            <marker id={`arrow-${loop.name.replace(/\W/g, '')}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill={c.ring} />
            </marker>
          </defs>
          {[0, 1, 2, 3].map(i => (
            <g key={i}>
              <circle cx={20 + i * 95} cy={20} r="14" fill={c.ring} fillOpacity="0.12" stroke={c.ring} strokeWidth="2" />
              <text x={20 + i * 95} y={24} fontSize="11" fontWeight="800" fill={c.ring} textAnchor="middle">{i + 1}</text>
              {i < 3 && (
                <line x1={36 + i * 95} y1={20} x2={94 + i * 95} y2={20} stroke={c.ring} strokeWidth="2"
                  strokeDasharray="3,3" markerEnd={`url(#arrow-${loop.name.replace(/\W/g, '')})`} />
              )}
            </g>
          ))}
        </svg>
      </div>

      <ol className="space-y-1.5 text-[12px] mt-3">
        {stages.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-[9px] font-black tracking-widest uppercase mt-0.5 w-16 flex-shrink-0" style={{ color: c.ring }}>{s.label}</span>
            <span className="text-gray-700 flex-1 leading-snug">{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SECTION 04 — AI-NATIVE DISCOVERY
// ═════════════════════════════════════════════════════════════════════
const AINativeSection: React.FC<{ tactics: AINativeTactic[] }> = ({ tactics }) => {
  const categoryIcons: Record<string, React.ReactNode> = {
    GEO: <Globe size={14} />,
    MCP: <Cpu size={14} />,
    'Agent-Distribution': <Network size={14} />,
    'AI-Directory': <BookOpen size={14} />,
    'Eval-as-Marketing': <Activity size={14} />,
    'API-First': <GitBranch size={14} />
  };

  return (
    <section>
      <SectionHeader number="06" kicker="2026 channels" title="How people will find you in the AI era" accent="#f59e0b"
        intro="Google isn't the only search engine anymore. People ask ChatGPT, Perplexity, and Claude. Your product needs to be 'visible' to them. Here's how — without any marketing degree." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {tactics.map((t, i) => {
          const impactColor = t.impact === 'High' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : t.impact === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-gray-50 text-gray-600 border-gray-200';
          return (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 hover:border-amber-200 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-widest uppercase px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                  {categoryIcons[t.category] || <Sparkles size={14} />}
                  {t.category}
                </span>
                <span className={`text-[10px] font-black tracking-widest uppercase px-2 py-1 rounded-md border ${impactColor}`}>{t.impact} impact</span>
                <span className="ml-auto text-[10px] font-mono font-bold text-gray-400 tabular-nums">{t.timeframe}</span>
              </div>
              <p className="text-sm font-bold text-gray-900 leading-snug mb-1.5">{t.tactic}</p>
              <p className="text-[11px] text-gray-500 italic leading-relaxed">{t.rationale}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SECTION 05 — FIRST 72 HOURS (timeline)
// ═════════════════════════════════════════════════════════════════════
const First72HoursSection: React.FC<{ blocks: First72Block[] }> = ({ blocks }) => (
  <section>
    <SectionHeader number="07" kicker="Launch day" title="What to do in your first 72 hours" accent="#ec4899"
      intro="When you press 'go live', what exactly do you do — hour by hour? This is your printable cheat sheet. Pin it to your wall." />

    <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200/60 rounded-3xl p-6 lg:p-8">
      <div className="relative">
        {/* Vertical timeline */}
        <div className="absolute left-6 top-2 bottom-2 w-0.5 bg-gradient-to-b from-pink-400 via-pink-500 to-rose-500 rounded-full" />

        <ul className="space-y-5">
          {blocks.map((b, i) => (
            <li key={i} className="relative pl-16">
              {/* Time marker */}
              <div className="absolute left-0 top-0 flex items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-white flex flex-col items-center justify-center shadow-lg shadow-pink-200">
                  <span className="text-[9px] font-black tracking-widest uppercase opacity-80">T+</span>
                  <span className="text-[10px] font-black leading-none">{i + 1}</span>
                </div>
              </div>

              <div className="bg-white border border-pink-200/60 rounded-2xl p-4 shadow-sm">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <div className="text-[10px] font-black tracking-widest uppercase text-pink-700">{b.timeBlock}</div>
                  <div className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500">
                    <Target size={10} /> {b.channel}
                  </div>
                </div>
                <p className="text-sm font-bold text-gray-900 leading-snug mb-1">{b.action}</p>
                <p className="text-[11px] text-emerald-700 italic leading-snug">
                  <Check size={11} className="inline mr-0.5" /> {b.successMetric}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

// ═════════════════════════════════════════════════════════════════════
// SECTION 06 — ANTI-PATTERNS
// ═════════════════════════════════════════════════════════════════════
const AntiPatternsSection: React.FC<{ patterns: AntiPattern[] }> = ({ patterns }) => (
  <section>
    <SectionHeader number="08" kicker="Stop doing this" title="Tactics that used to work — but don't anymore" accent="#f43f5e"
      intro="Don't waste weeks on these. They worked 5 years ago. They don't anymore. Here's what to do instead." />

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {patterns.map((p, i) => (
        <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 hover:border-rose-200 transition-colors">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
              <X size={16} strokeWidth={3} />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 leading-snug mb-1.5 line-through decoration-rose-300 decoration-2">{p.pattern}</h4>
              <p className="text-[11px] text-gray-500 leading-relaxed italic mb-3">{p.whyItFails2026}</p>
              <div className="flex items-start gap-2 pt-3 border-t border-gray-100">
                <div className="flex-shrink-0 w-5 h-5 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Check size={11} strokeWidth={3} />
                </div>
                <p className="text-xs text-gray-700 leading-relaxed font-medium flex-1">{p.instead}</p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ═════════════════════════════════════════════════════════════════════
// SECTION 07 — TRUST LEVERS
// ═════════════════════════════════════════════════════════════════════
const TrustLeversSection: React.FC<{ levers: TrustLever[] }> = ({ levers }) => (
  <section>
    <SectionHeader number="09" kicker="Building trust" title="How to make people trust your AI product" accent="#10b981"
      intro="In 2026, every product claims AI superpowers. Buyers are skeptical by default. These specific moves prove you're legit and turn doubters into buyers." />

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {levers.map((l, i) => (
        <div key={i} className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/60 rounded-2xl p-5">
          <div className="flex items-start gap-2 mb-2">
            <ShieldCheck size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <h4 className="font-bold text-gray-900 leading-snug flex-1">{l.lever}</h4>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed italic mb-3">{l.mechanism}</p>
          <div className="pt-3 border-t border-emerald-200/60 flex items-center gap-1.5">
            <Clock size={10} className="text-emerald-600" />
            <span className="text-[10px] font-black tracking-widest uppercase text-emerald-700">{l.timeToInstall}</span>
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ═════════════════════════════════════════════════════════════════════
// SECTION 08 — RISK REGISTER (heatmap)
// ═════════════════════════════════════════════════════════════════════
const RiskRegisterSection: React.FC<{ risks: LaunchRisk[] }> = ({ risks }) => {
  // Place risks on impact × probability grid
  const cellOf = (impact: string, probability: string): [number, number] => {
    const r = impact === 'High' ? 0 : impact === 'Medium' ? 1 : 2;
    const c = probability === 'Low' ? 0 : probability === 'Medium' ? 1 : 2;
    return [r, c];
  };

  const grid: LaunchRisk[][][] = [[[],[],[]],[[],[],[]],[[],[],[]]];
  risks.forEach((r, idx) => {
    const [row, col] = cellOf(r.impact, r.probability);
    grid[row][col].push({ ...r, _idx: idx } as any);
  });

  const cellColor = (row: number, col: number) => {
    const score = (2 - row) + col;  // higher = more dangerous
    if (score >= 3) return 'bg-rose-50 border-rose-200';
    if (score >= 2) return 'bg-amber-50 border-amber-200';
    return 'bg-emerald-50 border-emerald-200';
  };

  return (
    <section>
      <SectionHeader number="10" kicker="What could go wrong" title="The risks (and how to handle them)" accent="#dc2626"
        intro="Honest list of what could kill your launch. The grid shows how dangerous each risk is. Each risk has a fix you can do this week — not 'monitor closely'." />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* Heatmap */}
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black tracking-widest uppercase text-gray-400">Risk heatmap</div>
            <AlertTriangle size={14} className="text-rose-400" />
          </div>
          <div className="relative pl-12 pb-8">
            {/* Y axis */}
            <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-[9px] font-black tracking-widest uppercase text-gray-400">
              <span>High</span><span>Med</span><span>Low</span>
            </div>
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 -translate-x-full rotate-[-90deg] text-[9px] font-black tracking-widest uppercase text-gray-500 whitespace-nowrap">
              Impact →
            </div>
            {/* Grid */}
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map(row =>
                [0, 1, 2].map(col => {
                  const cell = grid[row][col];
                  return (
                    <div key={`${row}-${col}`} className={`min-h-[80px] rounded-xl border ${cellColor(row, col)} p-2 flex flex-wrap gap-1`}>
                      {cell.map((r: any) => (
                        <div key={r._idx}
                          className="bg-white border border-gray-200 rounded-md px-1.5 py-0.5 text-[9px] font-black tracking-widest uppercase shadow-sm"
                          title={r.risk}>
                          R{r._idx + 1}
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
            {/* X axis */}
            <div className="absolute -bottom-2 left-12 right-0 flex justify-between text-[9px] font-black tracking-widest uppercase text-gray-400">
              <span>Low</span><span>Med</span><span>High</span>
            </div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 translate-y-full text-[9px] font-black tracking-widest uppercase text-gray-500">
              Probability →
            </div>
          </div>
        </div>

        {/* Detailed list */}
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
          <div className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-3">Mitigations</div>
          <ol className="space-y-3">
            {risks.map((r, i) => {
              const sev = r.impact === 'High' ? 'border-l-rose-500' : r.impact === 'Medium' ? 'border-l-amber-500' : 'border-l-emerald-500';
              return (
                <li key={i} className={`pl-3 border-l-2 ${sev}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono font-black text-gray-400">R{i + 1}</span>
                    <span className="text-[9px] font-black tracking-widest uppercase px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600">{r.impact}/{r.probability}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-800 leading-snug mb-1">{r.risk}</p>
                  <p className="text-[11px] text-emerald-700 italic leading-snug">→ {r.mitigation}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SECTION 09 — FOUNDER OPERATING MODEL + COMPOUNDING MOATS
// ═════════════════════════════════════════════════════════════════════
const FounderOperatingSection: React.FC<{
  activities: FounderActivity[];
  moats: string[];
}> = ({ activities, moats }) => {
  const total = activities.reduce((acc, a) => acc + a.hoursPerWeek, 0);
  const palette = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#f43f5e', '#6366f1', '#14b8a6'];

  return (
    <section>
      <SectionHeader number="11" kicker="Your week" title="How to spend your 50-60 hours each week" accent="#6366f1"
        intro="You have one calendar. Where each hour goes determines what compounds. Plus the assets you'll have built by month 6 that competitors can't easily steal." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Time allocation */}
        <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-black tracking-widest uppercase text-gray-400">Weekly time allocation</div>
              <h3 className="font-display font-bold text-lg text-gray-900">{total} hrs/week</h3>
            </div>
            <Briefcase size={18} className="text-gray-300" />
          </div>

          {/* Stacked horizontal bar */}
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 mb-4">
            {activities.map((a, i) => (
              <div key={i} className="transition-all"
                style={{ width: `${(a.hoursPerWeek / total) * 100}%`, background: palette[i % palette.length] }}
                title={`${a.activity}: ${a.hoursPerWeek}h`} />
            ))}
          </div>

          {/* Legend */}
          <ul className="space-y-2.5">
            {activities.map((a, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: palette[i % palette.length] }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-sm font-bold text-gray-900 leading-snug flex-1">{a.activity}</span>
                    <span className="text-sm font-mono font-black text-gray-700 tabular-nums flex-shrink-0">{a.hoursPerWeek}h</span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug italic">{a.rationale}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Compounding moats */}
        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200/60 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-black tracking-widest uppercase text-indigo-700">Compounding moats</div>
              <h3 className="font-display font-bold text-lg text-gray-900">Getting harder to copy</h3>
            </div>
            <TrendingUp size={18} className="text-indigo-400" />
          </div>
          <ul className="space-y-3">
            {moats.map((m, i) => (
              <li key={i} className="flex items-start gap-3 p-3 bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl">
                <div className="flex-shrink-0 w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center font-black text-xs shadow-md">
                  {i + 1}
                </div>
                <p className="text-sm text-gray-800 leading-snug flex-1 pt-0.5">{m}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};
