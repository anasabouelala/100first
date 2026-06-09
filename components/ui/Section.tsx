import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// ────────────────────────────────────────────────────────────────────
// MINIMAL SECTION HEADERS — shared across all views.
// Discreet typography over decorative chrome.
// ────────────────────────────────────────────────────────────────────

// Hover-explainer: a small "i" badge that reveals a description on hover.
// The tooltip is rendered in a PORTAL with fixed positioning so it can never
// be clipped by a section's overflow, hidden behind another card, or overlap
// neighbouring text — it always floats above everything at the viewport level.
export const InfoTip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const width = 256; // w-64
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 8, left });
    }
    setShow(true);
  };

  return (
    <span
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={() => setShow(false)}
      className={`relative inline-flex items-center align-middle ml-1.5 ${className}`}
    >
      <span className="w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] font-bold flex items-center justify-center cursor-help hover:border-gray-500 hover:text-gray-600 transition-colors select-none">i</span>
      {show && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 256 }}
          className="z-[300] px-3 py-2 rounded-lg bg-gray-900 text-white text-[11px] leading-relaxed font-normal normal-case tracking-normal shadow-2xl pointer-events-none"
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
};

export const Section: React.FC<{
  title: string;
  subtitle?: string;
  info?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, info, aside, children, className = '' }) => (
  <section className={`space-y-4 ${className}`}>
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] font-medium text-gray-900 tracking-tight inline-flex items-center">
          {title}{info && <InfoTip text={info} />}
        </h3>
        {subtitle && <p className="text-[12px] text-gray-400 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
      {aside && <div className="flex items-center gap-2 flex-wrap">{aside}</div>}
    </div>
    {children}
  </section>
);

export const SubSection: React.FC<{
  title: string;
  hint?: string;
  info?: string;
  children: React.ReactNode;
}> = ({ title, hint, info, children }) => (
  <div className="space-y-3 pt-6 border-t border-gray-100/80">
    <div className="flex items-baseline gap-3 flex-wrap">
      <h4 className="text-[13px] font-medium text-gray-900 inline-flex items-center">{title}{info && <InfoTip text={info} />}</h4>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </div>
    {children}
  </div>
);

// Page-level header: title + subtitle + optional badge/aside
export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  info?: string;
  aside?: React.ReactNode;
}> = ({ title, subtitle, info, aside }) => (
  <header className="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 className="text-2xl font-display font-medium text-gray-900 tracking-tight inline-flex items-center">
        {title}{info && <InfoTip text={info} />}
      </h2>
      {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
    {aside && <div className="flex items-center gap-2 flex-wrap">{aside}</div>}
  </header>
);

// First-page intro — title + short description + single CTA, vertically centered.
// Shared by Strategy, Competitor Analysis, and Distribution so they feel like
// the same product before the user has data.
export const IntroScreen: React.FC<{
  title: string;
  description: string;
  buttonLabel: string;
  buttonIcon?: React.ReactNode;
  onAction: () => void;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  footer?: React.ReactNode;     // optional secondary action below the button
}> = ({ title, description, buttonLabel, buttonIcon, onAction, loading, loadingLabel, disabled, footer }) => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="max-w-xl w-full text-center animate-fade-in space-y-6">
      <h2 className="text-3xl md:text-4xl font-display font-medium text-gray-900 tracking-tight">
        {title}
      </h2>
      <p className="text-gray-500 text-sm md:text-base leading-relaxed">{description}</p>
      <button
        onClick={onAction}
        disabled={loading || disabled}
        className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-medium text-sm
                   disabled:opacity-40 disabled:cursor-not-allowed
                   transition-all duration-200 ease-out hover:shadow-lg hover:shadow-gray-300/40 active:scale-[0.98]"
      >
        {loading
          ? <span className="inline-flex items-center gap-2"><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> {loadingLabel || 'Loading…'}</span>
          : <>{buttonIcon}{buttonLabel}</>
        }
      </button>
      {footer && <div className="pt-2">{footer}</div>}
    </div>
  </div>
);
