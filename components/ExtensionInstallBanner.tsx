import React, { useEffect, useState } from 'react';
import { Puzzle, ArrowUpRight } from 'lucide-react';
import { useT } from '../contexts/I18nContext';

// Public Chrome Web Store listing for the Viraholic extension.
export const EXTENSION_URL =
  'https://chromewebstore.google.com/detail/ljnecbmaokhhncanelailolflheamieg';

/**
 * Dashboard-wide banner shown until the Viraholic Chrome extension is detected.
 * The extension is what actually reads LinkedIn / X on the user's behalf, so
 * without it every data-driven view (Account Finder, Posts Tracker, Feed
 * Watcher) stays empty. We detect it via the same bridge handshake the rest of
 * the app uses — EXTENSION_BRIDGE_READY on load, plus answerly_ping/pong — and
 * hide the banner the moment the bridge answers. The listeners stay mounted, so
 * even if the extension connects late (slow first paint) the banner disappears.
 */
export const ExtensionInstallBanner: React.FC = () => {
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [checked, setChecked] = useState(false); // grace period elapsed

  useEffect(() => {
    let answered = false;
    const markConnected = () => { answered = true; setConnected(true); };
    window.addEventListener('EXTENSION_BRIDGE_READY', markConnected);
    window.addEventListener('answerly_pong', markConnected);

    // The bridge replies to answerly_ping with answerly_pong. Ping a few times
    // to cover the case where the bridge mounts a beat after this component.
    const ping = () => { try { window.dispatchEvent(new CustomEvent('answerly_ping')); } catch {} };
    ping();
    const t1 = setTimeout(ping, 400);
    const t2 = setTimeout(ping, 1200);
    // Only reveal the banner after a short grace period, so users who DO have
    // the extension never see a flash of "not installed".
    const t3 = setTimeout(() => { if (!answered) setChecked(true); }, 2500);

    return () => {
      window.removeEventListener('EXTENSION_BRIDGE_READY', markConnected);
      window.removeEventListener('answerly_pong', markConnected);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
    };
  }, []);

  if (connected || !checked) return null;

  return (
    <div
      role="alert"
      className="mb-6 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 shadow-sm"
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="bg-indigo-600 text-white p-2.5 rounded-xl flex-shrink-0">
          <Puzzle size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-gray-900 text-sm sm:text-base leading-snug">
            {t('ext.banner.title')}
          </h3>
          <p className="text-xs sm:text-[13px] text-gray-600 mt-1 leading-relaxed">
            {t('ext.banner.body')}
          </p>
        </div>
      </div>
      <a
        href={EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors whitespace-nowrap"
      >
        {t('ext.banner.cta')} <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </div>
  );
};
