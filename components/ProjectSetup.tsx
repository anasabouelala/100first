import React, { useState } from 'react';
import { useProject, ProjectConfig } from '../contexts/ProjectContext';
import { useT } from '../contexts/I18nContext';
import {
  Rocket, ChevronDown, ChevronUp, Check, Sparkles, Target, Users, Tag,
  DollarSign, Swords, TrendingUp, Globe, Flag, X
} from 'lucide-react';

interface Props {
  mode?: 'first-time' | 'edit' | 'new';
  onClose?: () => void;       // only called in 'edit' / 'new' mode
}

const CATEGORY_PRESETS = [
  'B2B SaaS', 'Consumer SaaS', 'DevTool', 'AI / ML', 'Marketplace',
  'Fintech', 'E-commerce', 'Vertical SaaS', 'Mobile App', 'Other'
];

// label/desc hold i18n keys resolved with t() at render.
const STAGE_OPTIONS: Array<{ value: ProjectConfig['stage']; label: string; desc: string }> = [
  { value: 'idea',        label: 'ps.stage.idea.label',      desc: 'ps.stage.idea.desc' },
  { value: 'pre-launch',  label: 'ps.stage.prelaunch.label', desc: 'ps.stage.prelaunch.desc' },
  { value: 'launched',    label: 'ps.stage.launched.label',  desc: 'ps.stage.launched.desc' },
  { value: 'scaling',     label: 'ps.stage.scaling.label',   desc: 'ps.stage.scaling.desc' }
];

// Only the product name is required to get in. Pitch / category / audience are
// optional — they sharpen the AI, but they should never wall a new user out on
// first run. Users add them anytime via "Optional details" or the edit modal.
const REQUIRED_FIELDS: (keyof ProjectConfig)[] = ['productName'];

export const ProjectSetup: React.FC<Props> = ({ mode = 'first-time', onClose }) => {
  const { project, setProject } = useProject();
  const t = useT();
  // 'new' mode starts blank (replacing current project); 'edit' starts with current values.
  const [form, setForm] = useState<Partial<ProjectConfig>>(
    mode === 'new' ? { stage: 'pre-launch' } : (project || { stage: 'pre-launch' })
  );
  const [showOptional, setShowOptional] = useState(mode === 'edit');
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const update = <K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: false }));
  };

  // ── Single active project ──────────────────────────────────────────
  // The app holds exactly ONE project (`project_config_v1`). Creating a new
  // project REPLACES the active one — so it must start clean. Previously the
  // new project silently inherited the old one's workspace (tracked accounts,
  // posts, leads, voice), which made it feel like two projects were bleeding
  // together. Here we wipe the prior project's working data while preserving
  // the Supabase auth session, so there's only ever one clean active project.
  const resetWorkspaceForNewProject = () => {
    try {
      const saved: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        // keep auth/session keys so the user stays signed in
        if (/supabase|^sb-|auth/i.test(k)) {
          const v = localStorage.getItem(k);
          if (v != null) saved[k] = v;
        }
      }
      localStorage.clear();
      Object.entries(saved).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch {}
    try { sessionStorage.clear(); } catch {}
    // Clear the extension's tracked accounts / captured posts too, so the new
    // project's Posts Tracker and Account Finder start empty.
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'STOP_RECON_MISSION' });
      }
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.clear();
      }
    } catch {}
  };

  const handleSubmit = () => {
    const next: Record<string, boolean> = {};
    let bad = false;
    REQUIRED_FIELDS.forEach(k => {
      if (!form[k] || (form[k] as string).trim() === '') {
        next[k] = true;
        bad = true;
      }
    });
    if (bad) {
      setErrors(next);
      return;
    }
    // A brand-new project replaces the active one — wipe the old workspace
    // first so nothing from the previous project carries over.
    if (mode === 'new') resetWorkspaceForNewProject();
    const now = new Date().toISOString();
    setProject({
      productName: form.productName!.trim(),
      // Optional now — default to empty strings (sections fall back gracefully).
      pitch: form.pitch?.trim() || '',
      category: form.category?.trim() || '',
      targetAudience: form.targetAudience?.trim() || '',
      valueProposition: form.valueProposition?.trim(),
      pricingModel: form.pricingModel?.trim(),
      competitors: form.competitors?.trim(),
      stage: form.stage,
      websiteUrl: form.websiteUrl?.trim(),
      primaryGoal: form.primaryGoal?.trim(),
      // 'new' mode creates a fresh project — don't inherit the old createdAt.
      createdAt: (mode === 'new' ? now : (project?.createdAt || now)),
      updatedAt: now
    });
    if (onClose) onClose();
  };

  const requiredFilled = REQUIRED_FIELDS
    .filter(k => form[k] && (form[k] as string).trim() !== '').length;
  const progress = (requiredFilled / REQUIRED_FIELDS.length) * 100;

  // ── The three "context" fields ──────────────────────────────────────
  // Required when the user deliberately edits/creates a project; optional on
  // first run (tucked under "Optional details" so the first screen is just a
  // name). Defined once and placed per-mode below.
  const pitchField = (
    <FieldRow
      icon={<Sparkles size={14} />}
      label={t('ps.pitch.label')}
      hint={t('ps.pitch.hint')}>
      <textarea
        value={form.pitch || ''}
        onChange={e => update('pitch', e.target.value)}
        placeholder={t('ps.pitch.ph')}
        rows={3}
        className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm leading-relaxed resize-none transition-colors" />
    </FieldRow>
  );

  const categoryField = (
    <FieldRow icon={<Target size={14} />} label={t('ps.category.label')}>
      <div className="space-y-2">
        <input
          value={form.category || ''}
          onChange={e => update('category', e.target.value)}
          placeholder={t('ps.category.ph')}
          className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-base font-medium transition-colors" />
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_PRESETS.map(c => (
            <button key={c} type="button" onClick={() => update('category', c)}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                form.category === c
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-primary hover:text-primary'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </FieldRow>
  );

  const audienceField = (
    <FieldRow
      icon={<Users size={14} />}
      label={t('ps.audience.label')}
      hint={t('ps.audience.hint')}>
      <input
        value={form.targetAudience || ''}
        onChange={e => update('targetAudience', e.target.value)}
        placeholder={t('ps.audience.ph')}
        className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-base transition-colors" />
    </FieldRow>
  );

  const isFirstTime = mode === 'first-time';

  // The form body (shared between modes)
  const body = (
    <>
      {/* Close (edit / new mode) */}
      {!isFirstTime && onClose && (
        <button onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition-colors">
          <X size={18} />
        </button>
      )}

      {/* Header */}
      <div className={`${!isFirstTime ? 'p-8 pb-6' : 'mb-8'}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20">
            <Rocket size={20} />
          </div>
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
            {mode === 'edit' ? t('ps.eyebrow.edit') : mode === 'new' ? t('ps.eyebrow.new') : t('ps.eyebrow.quick')}
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">
          {mode === 'edit' ? t('ps.title.edit')
            : mode === 'new' ? t('ps.title.new')
            : t('ps.title.first')}
        </h1>
        <p className="text-gray-500 mt-2 leading-relaxed">
          {mode === 'edit' ? t('ps.desc.edit')
            : mode === 'new' ? t('ps.desc.new')
            : t('ps.desc.first')}
        </p>

        {/* Progress — only meaningful when more than one field is required */}
        {REQUIRED_FIELDS.length > 1 && (
          <div className="mt-5 flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-500"
                style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-black tracking-widest uppercase text-gray-500 tabular-nums">{requiredFilled}/{REQUIRED_FIELDS.length}</span>
          </div>
        )}
      </div>

      {/* Required fields */}
      <div className={`bg-white ${!isFirstTime ? 'mx-8' : ''} rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5`}>
        <FieldRow
          icon={<Tag size={14} />}
          label={t('ps.productName.label')}
          required
          error={errors.productName}>
          <input
            value={form.productName || ''}
            onChange={e => update('productName', e.target.value)}
            placeholder={t('ps.productName.ph')}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && isFirstTime) handleSubmit(); }}
            className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-base font-medium transition-colors" />
        </FieldRow>

        {/* On edit/new, the context fields live here. On first run they move to
            "Optional details" so the first screen is just the name. */}
        {!isFirstTime && (
          <>
            {pitchField}
            {categoryField}
            {audienceField}
          </>
        )}
      </div>

      {/* Optional toggle */}
      <button onClick={() => setShowOptional(s => !s)}
        className={`${!isFirstTime ? 'mx-8' : ''} mt-4 w-full flex items-center justify-between px-5 py-3 rounded-2xl border border-gray-200 hover:border-gray-300 bg-white transition-all group`}
        style={mode === 'edit' ? { width: 'calc(100% - 4rem)' } : {}}>
        <span className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber-500" />
          <span className="text-sm font-bold text-gray-700">{isFirstTime ? t('ps.optional.addNow') : t('ps.optional.optional')}</span>
          <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">{t('ps.optional.hint')}</span>
        </span>
        {showOptional ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {/* Optional fields */}
      {showOptional && (
        <div className={`bg-white ${!isFirstTime ? 'mx-8' : ''} rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5 mt-3 animate-fade-in`}>
          {/* On first run, pitch/category/audience are optional and live here. */}
          {isFirstTime && (
            <>
              {pitchField}
              {categoryField}
              {audienceField}
            </>
          )}

          <FieldRow icon={<Swords size={14} />} label={t('ps.value.label')}>
            <textarea
              value={form.valueProposition || ''}
              onChange={e => update('valueProposition', e.target.value)}
              placeholder={t('ps.value.ph')}
              rows={2}
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm resize-none transition-colors" />
          </FieldRow>

          <FieldRow icon={<DollarSign size={14} />} label={t('ps.pricing.label')}>
            <input
              value={form.pricingModel || ''}
              onChange={e => update('pricingModel', e.target.value)}
              placeholder={t('ps.pricing.ph')}
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm transition-colors" />
          </FieldRow>

          <FieldRow icon={<Swords size={14} />} label={t('ps.competitors.label')}>
            <input
              value={form.competitors || ''}
              onChange={e => update('competitors', e.target.value)}
              placeholder={t('ps.competitors.ph')}
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm transition-colors" />
          </FieldRow>

          <FieldRow icon={<TrendingUp size={14} />} label={t('ps.stage.label')}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STAGE_OPTIONS.map(s => (
                <button key={s.value} type="button" onClick={() => update('stage', s.value)}
                  className={`text-start p-3 rounded-xl border-2 transition-all ${
                    form.stage === s.value
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                  <div className={`text-sm font-bold ${form.stage === s.value ? 'text-primary' : 'text-gray-900'}`}>{t(s.label)}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{t(s.desc)}</div>
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow icon={<Globe size={14} />} label={t('ps.website.label')}>
            <input
              value={form.websiteUrl || ''}
              onChange={e => update('websiteUrl', e.target.value)}
              placeholder="https://yourproduct.com"
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm font-mono transition-colors" />
          </FieldRow>

          <FieldRow icon={<Flag size={14} />} label={t('ps.goal.label')}>
            <input
              value={form.primaryGoal || ''}
              onChange={e => update('primaryGoal', e.target.value)}
              placeholder={t('ps.goal.ph')}
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm transition-colors" />
          </FieldRow>
        </div>
      )}

      {/* Footer CTA */}
      <div className={`${mode === 'edit' ? 'mx-8 mb-8' : ''} mt-6 flex items-center gap-3`}>
        {!isFirstTime && onClose && (
          <button onClick={onClose}
            className="px-6 py-3 text-gray-500 font-bold rounded-2xl hover:bg-gray-100 transition-colors">
            {t('common.cancel')}
          </button>
        )}
        <button onClick={handleSubmit}
          className="flex-1 flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-primary to-blue-600 text-white font-bold text-base rounded-2xl shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.01] active:scale-100 transition-all">
          <Check size={18} />
          {mode === 'edit' ? t('ps.submit.edit') : mode === 'new' ? t('ps.submit.new') : t('ps.submit.first')}
        </button>
      </div>

      {/* Footer hint — only on first-time */}
      {isFirstTime && (
        <p className="text-[11px] text-gray-400 text-center mt-4 font-medium">
          {t('ps.footerHint')}
        </p>
      )}
    </>
  );

  // Wrap in modal (edit / new) or full-page (first-time) — done inline so
  // the input components aren't unmounted on every keystroke
  if (!isFirstTime) {
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-gray-950/70 backdrop-blur-md animate-fade-in">
        <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl relative">
          {body}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 animate-fade-in">
      {body}
    </div>
  );
};

// ─── Reusable Field row ───────────────────────────────────────────────
const FieldRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  required?: boolean;
  error?: boolean;
  children: React.ReactNode;
}> = ({ icon, label, hint, required, error, children }) => {
  const t = useT();
  return (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <label className="flex items-center gap-1.5 text-xs font-black tracking-widest uppercase text-gray-600">
        <span className="text-gray-400">{icon}</span>
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {error && <span className="text-[10px] text-rose-500 font-bold">{t('ps.required')}</span>}
    </div>
    {hint && <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">{hint}</p>}
    <div className={error ? 'ring-2 ring-rose-200 rounded-xl' : ''}>{children}</div>
  </div>
  );
};

// ─── Compact project summary card (used in sidebar / dashboard) ───────
export const ProjectSummaryCard: React.FC<{ onEdit: () => void; compact?: boolean }> = ({ onEdit, compact }) => {
  const { project } = useProject();
  const t = useT();
  if (!project) return null;

  if (compact) {
    return (
      <button onClick={onEdit}
        className="w-full text-left p-3 rounded-2xl bg-gradient-to-br from-primary/5 to-blue-50 border border-primary/20 hover:border-primary/40 transition-all group">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center flex-shrink-0 shadow-sm">
              <Rocket size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm text-gray-900 truncate leading-tight">{project.productName}</div>
              <div className="text-[10px] text-gray-500 font-medium truncate leading-tight">{project.category || t('ps.summary.addDetails')}</div>
            </div>
          </div>
          <span className="text-[9px] font-black tracking-widest uppercase text-primary opacity-0 group-hover:opacity-100 transition-opacity">{t('common.edit')}</span>
        </div>
      </button>
    );
  }

  // Discreet badge — just the project name + stage. Single click to edit.
  return (
    <button
      onClick={onEdit}
      className="group inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full border border-gray-200 bg-white
                 hover:border-gray-400 hover:shadow-sm
                 transition-all duration-200 ease-out active:scale-[0.98]"
      title={t('dash.badge.editTitle')}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span className="text-xs font-medium text-gray-900">{project.productName}</span>
      {project.stage && (
        <span className="text-[10px] text-gray-400">· {project.stage}</span>
      )}
      <span className="text-[10px] text-gray-300 group-hover:text-gray-600 transition-colors duration-200">{t('common.edit')}</span>
    </button>
  );
};
