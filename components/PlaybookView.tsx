import React from 'react';
import { BookOpen, Check, X as XIcon, Clock, Shuffle, ThumbsUp } from 'lucide-react';
import { useT } from '../contexts/I18nContext';

// ────────────────────────────────────────────────────────────────────
// PLAYBOOK — plain-English growth guide.
// Copy target: readable by someone with no social-media / tech background.
// Every specific number was fact-checked against 2026 platform behavior;
// jargon (SSI, algorithm names, ranking weights) is intentionally left out
// so the page reads like advice from a friend, not a whitepaper.
// ────────────────────────────────────────────────────────────────────

type T = (k: string) => string;

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white rounded-2xl border border-gray-200 p-5 md:p-6">{children}</div>
);

const SectionHeader: React.FC<{ n: number; title: string }> = ({ n, title }) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="shrink-0 w-9 h-9 rounded-xl bg-gray-900 text-white flex items-center justify-center text-sm font-bold tabular-nums">
      {n}
    </div>
    <h3 className="text-lg md:text-xl font-semibold text-gray-900">{title}</h3>
  </div>
);

// ── VISUALS ─────────────────────────────────────────────────────────

// § 2 — safe-zone bar. `min`/`max` are drawn as a filled segment on a 0–60
// scale so LinkedIn (15–40) and X (10–40) share the same visual ruler.
const VolumeBar: React.FC<{ name: string; range: string; min: number; max: number; barClass: string }> = ({ name, range, min, max, barClass }) => {
  const scale = 60;
  const leftPct = (min / scale) * 100;
  const widthPct = ((max - min) / scale) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-bold text-gray-900">{name}</span>
        <span className="text-sm text-gray-700">{range}</span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`absolute h-full rounded-full ${barClass}`}
          style={{ insetInlineStart: `${leftPct}%`, width: `${widthPct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-gray-400 tabular-nums">
        <span>0</span>
        <span>{scale}+</span>
      </div>
    </div>
  );
};

// § 3 — three ascending columns representing weeks 1-2 / 3-4 / 5+.
const Staircase: React.FC<{ t: T }> = ({ t }) => {
  const steps = [
    { labelKey: 'pb.s3.step1.label', valueKey: 'pb.s3.step1.value', h: 'h-24' },
    { labelKey: 'pb.s3.step2.label', valueKey: 'pb.s3.step2.value', h: 'h-32' },
    { labelKey: 'pb.s3.step3.label', valueKey: 'pb.s3.step3.value', h: 'h-40' },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 md:gap-4 items-end">
      {steps.map((s, i) => (
        <div key={i} className={`rounded-t-2xl bg-gradient-to-t from-purple-600 to-purple-400 text-white p-3 md:p-4 ${s.h} flex flex-col items-center justify-center text-center`}>
          <div className="text-[10px] md:text-xs font-bold opacity-90 mb-1">{t(s.labelKey)}</div>
          <div className="text-lg md:text-2xl font-black tabular-nums">{t(s.valueKey)}</div>
        </div>
      ))}
    </div>
  );
};

// § 4 — one column per day. Weekdays have a green band in the middle (work
// hours) with gray above/below (mornings + evenings). Weekends are all gray.
const WeekStrip: React.FC<{ t: T }> = ({ t }) => {
  const days = [
    { key: 'pb.s4.day.mon', active: true },
    { key: 'pb.s4.day.tue', active: true },
    { key: 'pb.s4.day.wed', active: true },
    { key: 'pb.s4.day.thu', active: true },
    { key: 'pb.s4.day.fri', active: true },
    { key: 'pb.s4.day.sat', active: false },
    { key: 'pb.s4.day.sun', active: false },
  ];
  return (
    <div className="grid grid-cols-7 gap-1.5 md:gap-2">
      {days.map((d) => (
        <div key={d.key} className="flex flex-col items-center">
          <div className="w-full h-24 rounded-lg overflow-hidden border border-gray-200" aria-hidden="true">
            {d.active ? (
              <>
                <div className="h-1/3 bg-gray-100" />
                <div className="h-1/3 bg-emerald-500" />
                <div className="h-1/3 bg-gray-100" />
              </>
            ) : (
              <div className="h-full bg-gray-200" />
            )}
          </div>
          <div className={`mt-2 text-xs font-bold ${d.active ? 'text-gray-700' : 'text-gray-400'}`}>{t(d.key)}</div>
        </div>
      ))}
    </div>
  );
};

// § 6 — a fake profile card (banner, avatar, name, bio, featured tiles) so
// "fill in your profile" is visual, not just a list.
const ProfileMockup: React.FC<{ t: T }> = ({ t }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
    <div className="rounded-2xl border-2 border-gray-200 overflow-hidden bg-white">
      <div className="h-14 bg-gradient-to-r from-teal-400 to-emerald-400" aria-hidden="true" />
      <div className="p-4 -mt-7">
        <div className="w-12 h-12 rounded-full bg-gray-900 border-4 border-white mb-3" aria-hidden="true" />
        <div className="h-3 rounded bg-gray-800 w-2/3 mb-2" aria-hidden="true" />
        <div className="h-2 rounded bg-gray-300 w-full mb-1" aria-hidden="true" />
        <div className="h-2 rounded bg-gray-300 w-4/5 mb-3" aria-hidden="true" />
        <div className="grid grid-cols-3 gap-1.5">
          <div className="aspect-video rounded bg-gray-100" aria-hidden="true" />
          <div className="aspect-video rounded bg-gray-100" aria-hidden="true" />
          <div className="aspect-video rounded bg-gray-100" aria-hidden="true" />
        </div>
      </div>
    </div>
    <ul className="space-y-3">
      {['pb.s6.i1', 'pb.s6.i2', 'pb.s6.i3', 'pb.s6.i4'].map((k) => (
        <li key={k} className="flex items-start gap-2 text-sm text-gray-800">
          <Check size={18} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t(k)}</span>
        </li>
      ))}
    </ul>
  </div>
);

// § 7 — one card per Viraholic feature.
const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; body: string; chip: string }> = ({ icon, title, body, chip }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-5">
    <div className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-3 ${chip}`}>{icon}</div>
    <div className="font-bold text-gray-900 text-base mb-1">{title}</div>
    <div className="text-sm text-gray-600 leading-relaxed">{body}</div>
  </div>
);

// ── PAGE ────────────────────────────────────────────────────────────

export const PlaybookView: React.FC = () => {
  const t = useT();

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white">
            <BookOpen size={22} aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900">{t('pb.hero.title')}</h2>
            <p className="text-sm md:text-base text-gray-600 mt-2 leading-relaxed">{t('pb.hero.body')}</p>
          </div>
        </div>
      </Card>

      {/* 1 — Comment fast */}
      <Card>
        <SectionHeader n={1} title={t('pb.s1.title')} />
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-5">{t('pb.s1.p1')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-2">{t('pb.s1.card1.label')}</div>
            <div className="text-5xl md:text-6xl font-black text-emerald-600 tabular-nums my-3">{t('pb.s1.card1.big')}</div>
            <div className="text-sm text-gray-700">{t('pb.s1.card1.caption')}</div>
          </div>
          <div className="rounded-2xl border-2 border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5 text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">{t('pb.s1.card2.label')}</div>
            <div className="text-5xl md:text-6xl font-black text-gray-500 tabular-nums my-3">{t('pb.s1.card2.big')}</div>
            <div className="text-sm text-gray-500">{t('pb.s1.card2.caption')}</div>
          </div>
        </div>
      </Card>

      {/* 2 — Don't do too much */}
      <Card>
        <SectionHeader n={2} title={t('pb.s2.title')} />
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-5">{t('pb.s2.p1')}</p>
        <div className="space-y-4">
          <VolumeBar name={t('pb.s2.li.name')}  range={t('pb.s2.li.range')} min={15} max={40} barClass="bg-blue-500" />
          <VolumeBar name={t('pb.s2.x.name')}   range={t('pb.s2.x.range')}  min={10} max={40} barClass="bg-slate-700" />
        </div>
        <p className="text-xs text-gray-500 mt-4 italic">{t('pb.s2.caption')}</p>
      </Card>

      {/* 3 — Start slow */}
      <Card>
        <SectionHeader n={3} title={t('pb.s3.title')} />
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-5">{t('pb.s3.p1')}</p>
        <Staircase t={t} />
      </Card>

      {/* 4 — Normal hours */}
      <Card>
        <SectionHeader n={4} title={t('pb.s4.title')} />
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-5">{t('pb.s4.p1')}</p>
        <WeekStrip t={t} />
        <div className="mt-4 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <span className="inline-flex w-4 h-4 mt-0.5 rounded-sm bg-emerald-500 shrink-0" aria-hidden="true" />
            <span className="text-gray-700">{t('pb.s4.yes')}</span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="inline-flex w-4 h-4 mt-0.5 rounded-sm bg-gray-300 shrink-0" aria-hidden="true" />
            <span className="text-gray-500">{t('pb.s4.no')}</span>
          </div>
        </div>
      </Card>

      {/* 5 — Do / Don't */}
      <Card>
        <SectionHeader n={5} title={t('pb.s5.title')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5">
            <div className="flex items-center gap-2 mb-4 text-emerald-700">
              <Check size={20} aria-hidden="true" />
              <span className="uppercase tracking-widest text-xs font-black">{t('pb.s5.do.title')}</span>
            </div>
            <ul className="space-y-3">
              {['pb.s5.do.i1', 'pb.s5.do.i2', 'pb.s5.do.i3', 'pb.s5.do.i4'].map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm text-gray-800">
                  <Check size={16} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border-2 border-rose-200 bg-rose-50/50 p-5">
            <div className="flex items-center gap-2 mb-4 text-rose-700">
              <XIcon size={20} aria-hidden="true" />
              <span className="uppercase tracking-widest text-xs font-black">{t('pb.s5.dont.title')}</span>
            </div>
            <ul className="space-y-3">
              {['pb.s5.dont.i1', 'pb.s5.dont.i2', 'pb.s5.dont.i3', 'pb.s5.dont.i4'].map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm text-gray-800">
                  <XIcon size={16} className="text-rose-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {/* 6 — Fill your profile */}
      <Card>
        <SectionHeader n={6} title={t('pb.s6.title')} />
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-5">{t('pb.s6.p1')}</p>
        <ProfileMockup t={t} />
      </Card>

      {/* 7 — What Viraholic does */}
      <Card>
        <SectionHeader n={7} title={t('pb.s7.title')} />
        <p className="text-sm md:text-base text-gray-700 leading-relaxed mb-6">{t('pb.s7.p1')}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeatureCard icon={<Clock size={24} />}    title={t('pb.s7.c1.title')} body={t('pb.s7.c1.body')} chip="bg-gradient-to-br from-indigo-100 to-white border-indigo-200 text-indigo-700" />
          <FeatureCard icon={<Shuffle size={24} />}  title={t('pb.s7.c2.title')} body={t('pb.s7.c2.body')} chip="bg-gradient-to-br from-purple-100 to-white border-purple-200 text-purple-700" />
          <FeatureCard icon={<ThumbsUp size={24} />} title={t('pb.s7.c3.title')} body={t('pb.s7.c3.body')} chip="bg-gradient-to-br from-emerald-100 to-white border-emerald-200 text-emerald-700" />
        </div>
      </Card>
    </div>
  );
};
