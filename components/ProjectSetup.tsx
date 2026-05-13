import React, { useState } from 'react';
import { useProject, ProjectConfig } from '../contexts/ProjectContext';
import {
  Rocket, ChevronDown, ChevronUp, Check, Sparkles, Target, Users, Tag,
  DollarSign, Swords, TrendingUp, Globe, Flag, X
} from 'lucide-react';

interface Props {
  mode?: 'first-time' | 'edit';
  onClose?: () => void;       // only called in 'edit' mode
}

const CATEGORY_PRESETS = [
  'B2B SaaS', 'Consumer SaaS', 'DevTool', 'AI / ML', 'Marketplace',
  'Fintech', 'E-commerce', 'Vertical SaaS', 'Mobile App', 'Other'
];

const STAGE_OPTIONS: Array<{ value: ProjectConfig['stage']; label: string; desc: string }> = [
  { value: 'idea',        label: 'Idea',        desc: "Pre-build, validating" },
  { value: 'pre-launch',  label: 'Pre-launch',  desc: "Building, waitlist open" },
  { value: 'launched',    label: 'Launched',    desc: "Live, getting first users" },
  { value: 'scaling',     label: 'Scaling',     desc: "Real revenue, growing" }
];

export const ProjectSetup: React.FC<Props> = ({ mode = 'first-time', onClose }) => {
  const { project, setProject } = useProject();
  const [form, setForm] = useState<Partial<ProjectConfig>>(
    project || { stage: 'pre-launch' }
  );
  const [showOptional, setShowOptional] = useState(mode === 'edit');
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const update = <K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: false }));
  };

  const handleSubmit = () => {
    const required: (keyof ProjectConfig)[] = ['productName', 'pitch', 'category', 'targetAudience'];
    const next: Record<string, boolean> = {};
    let bad = false;
    required.forEach(k => {
      if (!form[k] || (form[k] as string).trim() === '') {
        next[k] = true;
        bad = true;
      }
    });
    if (bad) {
      setErrors(next);
      return;
    }
    const now = new Date().toISOString();
    setProject({
      productName: form.productName!.trim(),
      pitch: form.pitch!.trim(),
      category: form.category!.trim(),
      targetAudience: form.targetAudience!.trim(),
      valueProposition: form.valueProposition?.trim(),
      pricingModel: form.pricingModel?.trim(),
      competitors: form.competitors?.trim(),
      stage: form.stage,
      websiteUrl: form.websiteUrl?.trim(),
      primaryGoal: form.primaryGoal?.trim(),
      createdAt: project?.createdAt || now,
      updatedAt: now
    });
    if (onClose) onClose();
  };

  const requiredFilled = ['productName', 'pitch', 'category', 'targetAudience']
    .filter(k => form[k as keyof ProjectConfig] && (form[k as keyof ProjectConfig] as string).trim() !== '').length;
  const progress = (requiredFilled / 4) * 100;

  // The form body (shared between modes)
  const body = (
    <>
      {/* Close (edit mode) */}
      {mode === 'edit' && onClose && (
        <button onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition-colors">
          <X size={18} />
        </button>
      )}

      {/* Header */}
      <div className={`${mode === 'edit' ? 'p-8 pb-6' : 'mb-8'}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20">
            <Rocket size={20} />
          </div>
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
            {mode === 'edit' ? 'Edit Project' : 'One-time Setup'}
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">
          {mode === 'edit' ? 'Update your project' : 'Tell us about your product'}
        </h1>
        <p className="text-gray-500 mt-2 leading-relaxed">
          {mode === 'edit'
            ? 'Changes apply to every section — personas, distribution, strategy, content engine.'
            : 'Fill this once. Every section — personas, distribution, competitor analysis, strategy, content engine — will use this data instead of asking you again.'}
        </p>

        {/* Progress */}
        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-500"
              style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs font-black tracking-widest uppercase text-gray-500 tabular-nums">{requiredFilled}/4</span>
        </div>
      </div>

      {/* Required fields */}
      <div className={`bg-white ${mode === 'edit' ? 'mx-8' : ''} rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5`}>
        <FieldRow
          icon={<Tag size={14} />}
          label="Product name"
          required
          error={errors.productName}>
          <input
            value={form.productName || ''}
            onChange={e => update('productName', e.target.value)}
            placeholder="e.g. Answerly"
            className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-base font-medium transition-colors" />
        </FieldRow>

        <FieldRow
          icon={<Sparkles size={14} />}
          label="Elevator pitch"
          hint="What does it do, who is it for, and why does it matter? 1-2 sentences."
          required
          error={errors.pitch}>
          <textarea
            value={form.pitch || ''}
            onChange={e => update('pitch', e.target.value)}
            placeholder="e.g. Answerly turns every social platform into a customer-acquisition engine for SaaS founders by surfacing buying-intent conversations across Reddit, X and LinkedIn, then drafting on-brand replies."
            rows={3}
            className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm leading-relaxed resize-none transition-colors" />
        </FieldRow>

        <FieldRow
          icon={<Target size={14} />}
          label="Category"
          required
          error={errors.category}>
          <div className="space-y-2">
            <input
              value={form.category || ''}
              onChange={e => update('category', e.target.value)}
              placeholder="e.g. B2B SaaS"
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

        <FieldRow
          icon={<Users size={14} />}
          label="Target audience"
          hint="Who pays for this? Be specific — job title, company stage, or persona."
          required
          error={errors.targetAudience}>
          <input
            value={form.targetAudience || ''}
            onChange={e => update('targetAudience', e.target.value)}
            placeholder="e.g. Solo SaaS founders & Heads of Demand Gen at Series A-B B2B SaaS"
            className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-base transition-colors" />
        </FieldRow>
      </div>

      {/* Optional toggle */}
      <button onClick={() => setShowOptional(s => !s)}
        className={`${mode === 'edit' ? 'mx-8' : ''} mt-4 w-[calc(100%-${mode === 'edit' ? '4rem' : '0'})] mx-auto flex items-center justify-between px-5 py-3 rounded-2xl border border-gray-200 hover:border-gray-300 bg-white transition-all group`}
        style={mode === 'edit' ? { width: 'calc(100% - 4rem)' } : {}}>
        <span className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber-500" />
          <span className="text-sm font-bold text-gray-700">Optional details</span>
          <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">— sharpens AI output for personas & distribution</span>
        </span>
        {showOptional ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {/* Optional fields */}
      {showOptional && (
        <div className={`bg-white ${mode === 'edit' ? 'mx-8' : ''} rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5 mt-3 animate-fade-in`}>
          <FieldRow icon={<Swords size={14} />} label="Unique value / wedge">
            <textarea
              value={form.valueProposition || ''}
              onChange={e => update('valueProposition', e.target.value)}
              placeholder="e.g. The only inbound-radar that works without Twitter/LinkedIn API keys (uses a stealth browser extension)."
              rows={2}
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm resize-none transition-colors" />
          </FieldRow>

          <FieldRow icon={<DollarSign size={14} />} label="Pricing model">
            <input
              value={form.pricingModel || ''}
              onChange={e => update('pricingModel', e.target.value)}
              placeholder="e.g. Free tier + $29/mo Pro · $99/mo Team"
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm transition-colors" />
          </FieldRow>

          <FieldRow icon={<Swords size={14} />} label="Known competitors (comma-separated)">
            <input
              value={form.competitors || ''}
              onChange={e => update('competitors', e.target.value)}
              placeholder="e.g. Common Room, Apollo, Clay"
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm transition-colors" />
          </FieldRow>

          <FieldRow icon={<TrendingUp size={14} />} label="Current stage">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STAGE_OPTIONS.map(s => (
                <button key={s.value} type="button" onClick={() => update('stage', s.value)}
                  className={`text-left p-3 rounded-xl border-2 transition-all ${
                    form.stage === s.value
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                  <div className={`text-sm font-bold ${form.stage === s.value ? 'text-primary' : 'text-gray-900'}`}>{s.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{s.desc}</div>
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow icon={<Globe size={14} />} label="Website / landing URL">
            <input
              value={form.websiteUrl || ''}
              onChange={e => update('websiteUrl', e.target.value)}
              placeholder="https://yourproduct.com"
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm font-mono transition-colors" />
          </FieldRow>

          <FieldRow icon={<Flag size={14} />} label="Primary goal (next 90 days)">
            <input
              value={form.primaryGoal || ''}
              onChange={e => update('primaryGoal', e.target.value)}
              placeholder="e.g. Reach 100 paying users at $29/mo MRR"
              className="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:border-primary focus:bg-white text-sm transition-colors" />
          </FieldRow>
        </div>
      )}

      {/* Footer CTA */}
      <div className={`${mode === 'edit' ? 'mx-8 mb-8' : ''} mt-6 flex items-center gap-3`}>
        {mode === 'edit' && onClose && (
          <button onClick={onClose}
            className="px-6 py-3 text-gray-500 font-bold rounded-2xl hover:bg-gray-100 transition-colors">
            Cancel
          </button>
        )}
        <button onClick={handleSubmit}
          className="flex-1 flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-primary to-blue-600 text-white font-bold text-base rounded-2xl shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.01] active:scale-100 transition-all">
          <Check size={18} />
          {mode === 'edit' ? 'Save changes' : 'Launch project'}
        </button>
      </div>

      {/* Footer hint */}
      {mode !== 'edit' && (
        <p className="text-[11px] text-gray-400 text-center mt-4 font-medium">
          Everything is stored locally — never sent anywhere except to the AI sections you trigger manually.
        </p>
      )}
    </>
  );

  // Wrap in modal (edit) or full-page (first-time) — done inline so
  // the input components aren't unmounted on every keystroke
  if (mode === 'edit') {
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
}> = ({ icon, label, hint, required, error, children }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <label className="flex items-center gap-1.5 text-xs font-black tracking-widest uppercase text-gray-600">
        <span className="text-gray-400">{icon}</span>
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {error && <span className="text-[10px] text-rose-500 font-bold">Required</span>}
    </div>
    {hint && <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">{hint}</p>}
    <div className={error ? 'ring-2 ring-rose-200 rounded-xl' : ''}>{children}</div>
  </div>
);

// ─── Compact project summary card (used in sidebar / dashboard) ───────
export const ProjectSummaryCard: React.FC<{ onEdit: () => void; compact?: boolean }> = ({ onEdit, compact }) => {
  const { project } = useProject();
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
              <div className="text-[10px] text-gray-500 font-medium truncate leading-tight">{project.category}</div>
            </div>
          </div>
          <span className="text-[9px] font-black tracking-widest uppercase text-primary opacity-0 group-hover:opacity-100 transition-opacity">Edit</span>
        </div>
      </button>
    );
  }

  return (
    <div className="bg-gradient-to-br from-primary/5 to-blue-50 rounded-3xl border border-primary/20 p-6 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black tracking-widest uppercase text-primary">Active Project</span>
            {project.stage && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-primary/20 text-primary">{project.stage}</span>
            )}
          </div>
          <h2 className="text-2xl font-display font-bold text-gray-900">{project.productName}</h2>
          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{project.pitch}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-700">{project.category}</span>
            <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-700">For: {project.targetAudience}</span>
          </div>
        </div>
        <button onClick={onEdit}
          className="flex-shrink-0 px-4 py-2 text-xs font-black tracking-widest uppercase text-primary bg-white border border-primary/20 hover:border-primary rounded-xl transition-all">
          Edit
        </button>
      </div>
    </div>
  );
};
