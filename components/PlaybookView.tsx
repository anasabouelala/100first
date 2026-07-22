import React from 'react';
import { BookOpen, Linkedin, Twitter, Repeat, Sparkles } from 'lucide-react';
import { useT } from '../contexts/I18nContext';

// Inline **bold** markers → <strong>. Kept dumb-simple on purpose: bullets
// come from i18n so we can't hand-author JSX per string, but we still want
// one visible emphasis phrase per bullet.
const renderRich = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{p.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
};

type Section = {
  key: string;
  icon: React.ReactNode;
  accent: 'blue' | 'slate' | 'emerald' | 'purple';
  titleKey: string;
  introKey?: string;
  bulletKeys: string[];
};

const SECTIONS: Section[] = [
  {
    key: 'linkedin',
    icon: <Linkedin size={20} />,
    accent: 'blue',
    titleKey: 'pb.li.title',
    introKey: 'pb.li.intro',
    bulletKeys: [
      'pb.li.b1', 'pb.li.b2', 'pb.li.b3', 'pb.li.b4', 'pb.li.b5',
      'pb.li.b6', 'pb.li.b7', 'pb.li.b8', 'pb.li.b9', 'pb.li.b10',
    ],
  },
  {
    key: 'x',
    icon: <Twitter size={20} />,
    accent: 'slate',
    titleKey: 'pb.x.title',
    introKey: 'pb.x.intro',
    bulletKeys: [
      'pb.x.b1', 'pb.x.b2', 'pb.x.b3', 'pb.x.b4', 'pb.x.b5',
      'pb.x.b6', 'pb.x.b7', 'pb.x.b8', 'pb.x.b9',
    ],
  },
  {
    key: 'habits',
    icon: <Repeat size={20} />,
    accent: 'emerald',
    titleKey: 'pb.hab.title',
    bulletKeys: ['pb.hab.b1', 'pb.hab.b2', 'pb.hab.b3', 'pb.hab.b4', 'pb.hab.b5'],
  },
  {
    key: 'viraholic',
    icon: <Sparkles size={20} />,
    accent: 'purple',
    titleKey: 'pb.vh.title',
    bulletKeys: ['pb.vh.b1', 'pb.vh.b2', 'pb.vh.b3', 'pb.vh.b4', 'pb.vh.b5'],
  },
];

const ACCENT: Record<Section['accent'], { chip: string; dot: string }> = {
  blue:    { chip: 'bg-gradient-to-br from-blue-50 to-white border-blue-200 text-blue-700',       dot: 'bg-blue-500' },
  slate:   { chip: 'bg-gradient-to-br from-slate-50 to-white border-slate-200 text-slate-700',    dot: 'bg-slate-500' },
  emerald: { chip: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-200 text-emerald-700', dot: 'bg-emerald-500' },
  purple:  { chip: 'bg-gradient-to-br from-purple-50 to-white border-purple-200 text-purple-700', dot: 'bg-purple-500' },
};

export const PlaybookView: React.FC = () => {
  const t = useT();

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white">
            <BookOpen size={22} aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-gray-900">{t('pb.hero.title')}</h2>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">{t('pb.hero.body')}</p>
          </div>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const accent = ACCENT[section.accent];
        return (
          <div key={section.key} className="bg-white rounded-2xl border border-gray-200 p-5 md:p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${accent.chip}`}>
                {section.icon}
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{t(section.titleKey)}</h3>
            </div>

            {section.introKey && (
              <p className="text-sm text-gray-600 leading-relaxed mb-5">
                {t(section.introKey)}
              </p>
            )}

            <ul className="space-y-3">
              {section.bulletKeys.map((k) => (
                <li key={k} className="flex gap-3 items-start">
                  <span className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${accent.dot}`} aria-hidden="true" />
                  <span className="text-sm text-gray-700 leading-relaxed">
                    {renderRich(t(k))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
};
