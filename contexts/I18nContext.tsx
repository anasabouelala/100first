import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// ─── UI language (chrome + views) ─────────────────────────────────────
// This is SEPARATE from ProjectConfig.outputLanguage, which controls the
// language of AI-*generated* content. This one controls the app's own
// interface strings and text direction. Kept to two options for now — the
// product ships EN/FR/AR landing pages, and Arabic is the RTL case we care
// about, so the dashboard toggles between English and Arabic.
export type UiLang = 'en' | 'ar';

const STORAGE_KEY = 'ui_lang';

// ─── Dictionaries ─────────────────────────────────────────────────────
// Flat, dotted keys. Arabic is professional Modern Standard Arabic tuned for
// a B2B SaaS audience (founders / growth teams), not literal machine
// translation. Keep brand names + platform names (Viraholic, LinkedIn, X,
// Chrome) in Latin script. English is the fallback for any missing key.
type Dict = Record<string, string>;

const en: Dict = {
  // Chrome extension install banner
  'ext.banner.title': 'Install the Viraholic Chrome extension to start scraping data',
  'ext.banner.body': 'The extension is what reads LinkedIn & X on your behalf. Without it, Account Finder, Posts Tracker and Feed Watcher stay empty. It’s free and installs in one click.',
  'ext.banner.cta': 'Add to Chrome',

  // Section headers (title + subtitle)
  'section.postsTracker.title': 'Posts Tracker',
  'section.postsTracker.subtitle': 'New posts from the accounts you follow',
  'section.accountFinder.title': 'Account Finder',
  'section.accountFinder.subtitle': 'Find and track creators in your niche',
  'section.feedWatcher.title': 'Feed Watcher',
  'section.feedWatcher.subtitle': 'Mine your home feed for opportunities, automatically',
  'section.contentEngine.title': 'Content Engine',
  'section.contentEngine.subtitle': 'Generate posts that convert',
  'section.voiceStudio.title': 'Voice Studio',
  'section.voiceStudio.subtitle': 'Tune your voice once. Every post inherits it.',
  'section.dashboard.title': 'Dashboard',

  // Sidebar nav groups
  'nav.group.missionControl': 'Mission Control',
  'nav.group.growthOps': 'Growth Ops',
  'nav.group.execution': 'Execution',
  'nav.item.dashboard': 'Dashboard',

  // Sidebar quick stats
  'stats.today': 'Today',
  'stats.open': 'Open',
  'stats.newPosts': 'New posts',
  'stats.replies': 'Replies',
  'stats.aria': 'Open Tracked posts. {posts} new posts and {replies} replies today.',
  'stats.tooltip': '{posts} new posts · {replies} replies today — open Tracked posts',

  // Sidebar footer / account
  'sidebar.newProject': 'New project',
  'sidebar.deleteProject': 'Delete project',
  'sidebar.signedInAs': 'Signed in as',
  'sidebar.signOut': 'Sign out',
  'sidebar.openMenu': 'Open navigation menu',

  // Trial expired screen
  'trial.title': 'Your 3-day trial has ended',
  'trial.body': 'Thanks for trying Viraholic. Free access lasts 3 days per account. Log out and create a new account (or sign in with a different one) to keep going.',
  'trial.logout': 'Log out',

  // Delete-project modal
  'delete.title': 'Delete this project?',
  'delete.body': 'This erases the project and all its data — personas, strategy, leads, tracked posts and content settings. This can’t be undone.',
  'common.cancel': 'Cancel',

  // Auth / loading
  'auth.checking': 'Checking session…',
  'auth.redirecting': 'Redirecting to sign in…',

  // Language switch
  'lang.switch': 'Language',
};

const ar: Dict = {
  // Chrome extension install banner
  'ext.banner.title': 'ثبّت إضافة Viraholic على Chrome لتبدأ بجمع البيانات',
  'ext.banner.body': 'الإضافة هي التي تقرأ LinkedIn وX نيابةً عنك. بدونها تبقى «مكتشف الحسابات» و«متتبّع المنشورات» و«مراقب الموجز» فارغة. مجّانية وتُثبّت بنقرة واحدة.',
  'ext.banner.cta': 'أضِفها إلى Chrome',

  // Section headers
  'section.postsTracker.title': 'متتبّع المنشورات',
  'section.postsTracker.subtitle': 'منشورات جديدة من الحسابات التي تتابعها',
  'section.accountFinder.title': 'مكتشف الحسابات',
  'section.accountFinder.subtitle': 'اعثر على صنّاع المحتوى في مجالك وتابعهم',
  'section.feedWatcher.title': 'مراقب الموجز',
  'section.feedWatcher.subtitle': 'نقّب في موجزك الرئيسي عن الفرص تلقائيًا',
  'section.contentEngine.title': 'محرّك المحتوى',
  'section.contentEngine.subtitle': 'أنشئ منشورات تُحقّق التحويل',
  'section.voiceStudio.title': 'استوديو الصوت',
  'section.voiceStudio.subtitle': 'اضبط نبرتك مرّةً واحدة، فترثها كلّ منشوراتك.',
  'section.dashboard.title': 'لوحة التحكّم',

  // Sidebar nav groups
  'nav.group.missionControl': 'مركز القيادة',
  'nav.group.growthOps': 'عمليات النمو',
  'nav.group.execution': 'التنفيذ',
  'nav.item.dashboard': 'لوحة التحكّم',

  // Sidebar quick stats
  'stats.today': 'اليوم',
  'stats.open': 'افتح',
  'stats.newPosts': 'منشورات جديدة',
  'stats.replies': 'الردود',
  'stats.aria': 'افتح متتبّع المنشورات. {posts} منشورات جديدة و{replies} ردود اليوم.',
  'stats.tooltip': '{posts} منشورات جديدة · {replies} ردود اليوم — افتح متتبّع المنشورات',

  // Sidebar footer / account
  'sidebar.newProject': 'مشروع جديد',
  'sidebar.deleteProject': 'حذف المشروع',
  'sidebar.signedInAs': 'مسجّل الدخول باسم',
  'sidebar.signOut': 'تسجيل الخروج',
  'sidebar.openMenu': 'فتح قائمة التنقّل',

  // Trial expired screen
  'trial.title': 'انتهت تجربتك المجّانية (3 أيام)',
  'trial.body': 'شكرًا لتجربتك Viraholic. تدوم الفترة المجّانية 3 أيام لكلّ حساب. سجّل الخروج وأنشئ حسابًا جديدًا (أو ادخل بحساب آخر) للمتابعة.',
  'trial.logout': 'تسجيل الخروج',

  // Delete-project modal
  'delete.title': 'حذف هذا المشروع؟',
  'delete.body': 'سيُمحى المشروع وكلّ بياناته — الشخصيات والاستراتيجية والعملاء المحتملون والمنشورات المتتبَّعة وإعدادات المحتوى. لا يمكن التراجع عن ذلك.',
  'common.cancel': 'إلغاء',

  // Auth / loading
  'auth.checking': 'جارٍ التحقّق من الجلسة…',
  'auth.redirecting': 'جارٍ التحويل إلى تسجيل الدخول…',

  // Language switch
  'lang.switch': 'اللغة',
};

const DICTS: Record<UiLang, Dict> = { en, ar };

// ─── Arabic web font ──────────────────────────────────────────────────
// Injected once so Arabic UI renders in Tajawal (the same family the Arabic
// landing page uses) instead of a system fallback. Also drops a scoped style
// rule so the font only applies while the app is in RTL. No-op if present.
function ensureArabicAssets() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('ar-ui-font')) {
    const link = document.createElement('link');
    link.id = 'ar-ui-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap';
    document.head.appendChild(link);
  }
  if (!document.getElementById('ar-ui-style')) {
    const style = document.createElement('style');
    style.id = 'ar-ui-style';
    style.textContent =
      "html[dir=\"rtl\"] body, html[dir=\"rtl\"] input, html[dir=\"rtl\"] textarea," +
      "html[dir=\"rtl\"] button, html[dir=\"rtl\"] select, html[dir=\"rtl\"] .font-display," +
      "html[dir=\"rtl\"] h1, html[dir=\"rtl\"] h2, html[dir=\"rtl\"] h3, html[dir=\"rtl\"] h4" +
      "{ font-family: 'Tajawal', system-ui, -apple-system, sans-serif; }";
    document.head.appendChild(style);
  }
}

interface I18nValue {
  lang: UiLang;
  dir: 'ltr' | 'rtl';
  setLang: (l: UiLang) => void;
  toggle: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const readInitial = (): UiLang => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {}
  return 'en';
};

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<UiLang>(readInitial);
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr';

  // Reflect the language on <html> so dir-aware CSS (and daisyUI's logical
  // properties) flip, and Arabic gets its font.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', dir);
    if (lang === 'ar') ensureArabicAssets();
  }, [lang, dir]);

  const setLang = useCallback((l: UiLang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const toggle = useCallback(() => setLang(lang === 'ar' ? 'en' : 'ar'), [lang, setLang]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    let str = DICTS[lang][key] ?? DICTS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, dir, setLang, toggle, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

/** Convenience hook when a component only needs the translate function. */
export function useT() {
  return useI18n().t;
}
