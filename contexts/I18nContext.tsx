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

  // Common
  'common.edit': 'Edit',
  'common.open': 'Open',

  // Dashboard view
  'dash.header.subtitle': 'A quick read on what’s moving.',
  'dash.badge.editTitle': 'Edit project',
  'dash.nudge.title': 'Sharpen your AI output',
  'dash.nudge.body': 'Add your pitch{audience} so content and replies sound on-brand instead of generic.',
  'dash.nudge.andAudience': ' and target audience',
  'dash.nudge.cta': 'Complete',
  'dash.kpi.trackedAccounts': 'Tracked accounts',
  'dash.kpi.trackedAccounts.hint0': 'Tap to find your first',
  'dash.kpi.trackedAccounts.hint': 'Being watched 24/7',
  'dash.kpi.trackedPosts7d': 'Tracked posts · 7d',
  'dash.kpi.trackedPosts7d.hint': '{n} previous week',
  'dash.kpi.answered': 'Answered posts',
  'dash.kpi.answered.hint0': 'No replies posted yet',
  'dash.kpi.answered.hint': 'Replies posted',
  'dash.activity.title': 'Posts Tracker activity',
  'dash.activity.subtitle': 'Posts captured in the last 14 days.',
  'dash.activity.total': 'Total signals',
  'dash.activity.dailyAvg': 'Daily avg',
  'dash.activity.aria': 'Posts captured per day over the last 14 days. {total} total, {avg} per day on average.',
  'dash.chart.today': 'Today',
  'dash.chart.14dAgo': '14d ago',
  'dash.chart.7dAgo': '7d ago',
  'dash.getStarted.title': 'Get started',
  'dash.getStarted.subtitle': 'Three quick moves to your first wins — pick any to begin.',
  'dash.step.find.title': 'Find accounts to track',
  'dash.step.find.desc': 'Pick creators in your niche — Viraholic watches their posts for you.',
  'dash.step.find.cta': 'Find accounts',
  'dash.step.watch.title': 'Watch your feed',
  'dash.step.watch.desc': 'Auto-surface buying-intent posts from your own home feed.',
  'dash.step.watch.cta': 'Set up Feed Watcher',
  'dash.step.generate.title': 'Generate content',
  'dash.step.generate.desc': 'Draft posts and replies in your voice that actually convert.',
  'dash.step.generate.cta': 'Open Content Engine',

  // Posts Tracker — relative time
  'time.recently': 'Recently',
  'time.justNow': 'Just now',
  'time.mAgo': '{n}m ago',
  'time.hAgo': '{n}h ago',
  'time.dAgo': '{n}d ago',

  // Posts Tracker — card
  'tracker.open.thread': 'Open thread',
  'tracker.open.post': 'Open post',
  'tracker.open.generic': 'Open',
  'tracker.platform.web': 'Web',
  'tracker.badge.feed': 'Feed',
  'tracker.badge.tracked': 'Tracked',
  'tracker.badge.repost': 'Repost',
  'tracker.badge.repliesRestricted': 'Replies restricted',
  'tracker.status.autoReplied': 'Auto-replied',
  'tracker.status.youReplied': 'You replied',
  'tracker.status.queued': 'Auto-reply queued',
  'tracker.status.skipped': 'Skipped by filter',
  'tracker.status.notReplied': 'Not replied yet',
  'tracker.fit.strong': 'Strong fit',
  'tracker.fit.good': 'Good fit',
  'tracker.fit.moderate': 'Moderate fit',
  'tracker.fit.weak': 'Weak fit',
  'tracker.fit.low': 'Low fit',
  'tracker.fit.unscored': 'Unscored',
  'tracker.fit.caption': 'Profile fit',
  'tracker.btn.reviewReply': 'Review suggested reply',
  'tracker.btn.hideReply': 'Hide suggested reply',
  'tracker.btn.writing': 'Writing…',
  'tracker.btn.comment': 'Comment',
  'tracker.btn.replyAgain': 'Reply again',
  'tracker.btn.repost': 'Repost',
  'tracker.btn.quote': 'Quote',
  'tracker.quoting': 'Quoting',

  // Account Finder
  'af.eyebrow': 'Account Finder',
  'af.title.a': 'Find',
  'af.title.hl': 'creators',
  'af.title.b': 'in your niche',
  'af.subtitle': 'Search X and LinkedIn for accounts worth following and engaging with. Built to stay safe and avoid getting flagged.',
  'af.badge.connected': 'Connected',
  'af.badge.off': 'Extension off',
  'af.status.idle': 'Ready',
  'af.status.preparing': 'Starting',
  'af.status.scanning': 'Searching',
  'af.status.paused': 'Paused',
  'af.status.cooldown': 'Waiting',
  'af.status.completed': 'Done',
  'af.status.failed': 'Failed',
  'af.status.aborted': 'Stopped',
  'af.card.where.title': 'Where to search',
  'af.card.where.sub': 'Pick one or more',
  'af.card.what.title': 'What to search for',
  'af.card.what.sub': 'Words that describe your niche',
  'af.kw.label': 'Keywords (required)',
  'af.kw.ph': 'e.g. AI agents, no-code, indie hacker',
  'af.ht.label': 'Hashtags (optional)',
  'af.excl.label': 'Words to avoid',
  'af.excl.ph': 'crypto, NFT (skip these)',
  'af.card.eng.title': 'Engagement bar',
  'af.card.eng.sub': 'How engaged must their posts be',
  'af.postsWithin': 'Posts within',
  'af.engRate.label': 'Audience engagement rate ≥ (%)',
  'af.engRate.ph': 'optional — e.g. 2',
  'af.moreFilters': 'More filters',
  'af.optional': 'Optional',
  'af.card.refine.title': 'Refine audience',
  'af.card.refine.sub': 'Optional — extra knobs. Engagement leads, these are tiebreakers.',
  'af.language': 'Language',
  'af.verifiedOnly': 'Only verified accounts',
  'af.skipTracked': 'Skip accounts I already track',
  'af.card.searchType.title': 'Search type',
  'af.card.searchType.sub': 'Pick your strategy',
  'af.launchHint': 'Pick a platform and add keywords to start',
  'af.extNotInstalled.bold': 'Extension not installed.',
  'af.extNotInstalled.rest': 'Install the Viraholic extension to search real accounts.',
  'af.eng.any.label': 'Any post',
  'af.eng.any.tagline': 'No engagement filter',
  'af.eng.any.helper': 'Surface every author who mentioned your keywords. Maximum breadth, lowest signal.',
  'af.eng.some.label': 'Some traction',
  'af.eng.some.tagline': '~10+ likes per post',
  'af.eng.some.helper': 'Filters out total dead posts. Use when your niche is small.',
  'af.eng.real.label': 'Real signal',
  'af.eng.real.tagline': '~50+ likes per post',
  'af.eng.real.helper': 'Recommended. Authors whose content is actually engaged with.',
  'af.eng.viral.label': 'Viral only',
  'af.eng.viral.tagline': '~500+ likes per post',
  'af.eng.viral.helper': 'Only top creators. Use sparingly — most niches don’t have many.',
  'af.recency.7': 'Last 7 days',
  'af.recency.30': 'Last 30 days',
  'af.recency.90': 'Last 90 days',
  'af.recency.any': 'Any time',
  'af.mode.surgical.label': 'Quick',
  'af.mode.surgical.desc': 'Pure feed scrape, engagement floor only',
  'af.mode.surgical.budget': '~10-20 accounts',
  'af.mode.volume.label': 'Wide',
  'af.mode.volume.desc': 'More queries + deeper scroll',
  'af.mode.volume.budget': '~50-100 accounts',
  'af.mode.deep.label': 'Deep',
  'af.mode.deep.desc': 'Seed expand: click into top posts, scrape reactors/repliers',
  'af.mode.deep.budget': '~25-50 high-confidence',
  // Account Finder — AI finder panel (the one actually rendered)
  'af.card.where.sub2': 'Pick one platform',
  'af.niche.title': 'What’s your niche?',
  'af.niche.sub': 'The AI uses this to pick accounts',
  'af.niche.ph': 'e.g. AI agents for SaaS founders, build-in-public solopreneurs in dev tools, growth marketers focused on B2B SaaS pricing…',
  'af.kw2.label': 'Keywords (optional)',
  'af.kw2.ph': 'e.g. agents, no-code, indie hacker',
  'af.country.title': 'Country',
  'af.country.sub': 'Where should the accounts be based?',
  'af.country.custom.ph': 'e.g. Norway, South Korea, Bay Area...',
  'af.country.helper.any': 'No geo filter — accounts can be based anywhere.',
  'af.country.helper.custom': 'The AI will prioritize creators based in this region.',
  'af.country.helper.specific': 'Only suggest creators primarily based in {country}.',
  'af.country.worldwide': 'Worldwide',
  'af.size.title': 'Account size',
  'af.size.sub': 'How big should the accounts be?',
  'af.size.any.label': 'Any size',
  'af.size.any.helper': 'No follower-count filter',
  'af.size.small.label': 'Small',
  'af.size.small.helper': 'Under ~50K — high reply rate',
  'af.size.medium.label': 'Medium',
  'af.size.medium.helper': '~50K–1M — solid reach',
  'af.size.large.label': 'Large',
  'af.size.large.helper': 'Over 1M — broad influence',
  'af.card.eng2.sub': 'Filter for accounts whose posts get traction',
  'af.aieng.any.label': 'Any',
  'af.aieng.any.helper': 'No engagement filter',
  'af.aieng.some.label': 'Some',
  'af.aieng.some.helper': '~10+ per post',
  'af.aieng.real.label': 'Real signal',
  'af.aieng.real.helper': '~50+ per post',
  'af.aieng.viral.label': 'Viral',
  'af.aieng.viral.helper': '~500+ per post',
  'af.find.title': 'Find accounts',
  'af.find.sub': 'AI suggests real accounts to follow',
  'af.find.howMany': 'How many to suggest',
  'af.find.searching': 'Searching…',
  'af.find.cta': 'Find accounts',
  'af.find.hint': 'Describe your niche or add a keyword first.',
  'af.manual.title': 'Add an account to track manually',
  'af.manual.sub': 'Paste a handle, profile URL, or subreddit — it starts getting watched right away.',

  // Feed Watcher
  'fw.ext': 'Extension',
  'fw.connected': 'Connected',
  'fw.bridgeOff': 'Bridge not detected — reload the extension',
  'fw.title': 'Background automation',
  'fw.subtitle': 'Runs in the extension — even when this tab is closed.',
  'fw.active': 'Active',
  'fw.off': 'Off',
  'fw.intro': 'Toggle the platforms below. Every {interval} minutes, the extension opens a stealth window and scrolls each enabled home feed — exactly like a human would — until it has scraped up to {max} posts (your target below) or runs out of new ones. The AI scores each new post against your brief; anything ≥ {min}/100 lands in the Posts Tracker. The same post never gets scored twice. Author info is read straight from the feed card — no profile is ever opened.',
  'fw.watching': 'Watching',
  'fw.brief.label': 'What I’m looking for',
  'fw.optional': 'optional',
  'fw.brief.ph': 'Leave blank to auto-target from your product — or get specific, e.g. People complaining about cold-outreach tools, founders asking for marketing help, posts about hiring their first growth marketer.',
  'fw.brief.specific': 'Be specific — vague briefs surface vague matches.',
  'fw.brief.everythingBold': 'Surfacing everything.',
  'fw.brief.everythingRest': 'With no brief I send every post I scroll past to your Posts Tracker — ranked by fit to the product & audience in your project when available. Type a brief above to filter strictly instead.',
  'fw.maxPosts': 'Max posts per sweep',
  'fw.maxPosts.helper': 'How many posts to pull into your Posts Tracker each sweep (1–100). Higher targets scroll the feed longer — a 100-post sweep can take several minutes of visible scrolling.',
  'fw.minFit': 'Minimum profile fit',
  'fw.min.keepMost': '0% — keep most',
  'fw.min.perfect': '100% — perfect fit only',
  'fw.minFit.helper': 'Only posts that fit your profile at or above this % reach the tracker — the same fit score shown on each card.',
  'fw.pollEvery': 'Poll every',
  'fw.minutes': 'minutes',
  'fw.sweeping': 'Sweeping…',
  'fw.sweepNow': 'Sweep now',
  'fw.sweep.titleDisconnected': 'Extension not connected',
  'fw.sweep.titleNoPlat': 'Toggle at least one platform',
  'fw.sweep.titleRun': 'Run one sweep now',
  'fw.poll.helper': 'Min 2 min, max 6 h. Each sweep scrolls every enabled feed until it hits your “Max posts per sweep” target or runs out of new posts.',
  'fw.stat.buffer': 'in last scroll buffer',
  'fw.stat.scored': 'scored',
  'fw.stat.promoted': 'promoted to tracker',
  'fw.stat.scrolling': '{n}s of scrolling',
  'fw.stat.lastSweep': 'last sweep {time}',
  'fw.diag.hide': 'Hide diagnostics',
  'fw.diag.show': 'Why 0 posts? →',
  'fw.diag.none.a': 'No sweep diagnostic yet. Click',
  'fw.diag.none.b': 'and the exact result appears here.',

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

  // Common
  'common.edit': 'تعديل',
  'common.open': 'افتح',

  // Dashboard view
  'dash.header.subtitle': 'نظرة سريعة على ما يتحرّك.',
  'dash.badge.editTitle': 'تعديل المشروع',
  'dash.nudge.title': 'اضبط مخرجات الذكاء الاصطناعي',
  'dash.nudge.body': 'أضِف نبذتك التعريفية{audience} ليأتي المحتوى والردود على هويّة علامتك بدلًا من أن يكونا عامّين.',
  'dash.nudge.andAudience': ' وجمهورك المستهدف',
  'dash.nudge.cta': 'أكمِل',
  'dash.kpi.trackedAccounts': 'الحسابات المتابَعة',
  'dash.kpi.trackedAccounts.hint0': 'انقر لتجد أوّل حساب',
  'dash.kpi.trackedAccounts.hint': 'تحت المراقبة على مدار الساعة',
  'dash.kpi.trackedPosts7d': 'المنشورات المتتبَّعة · 7 أيام',
  'dash.kpi.trackedPosts7d.hint': '{n} في الأسبوع السابق',
  'dash.kpi.answered': 'المنشورات المُجاب عنها',
  'dash.kpi.answered.hint0': 'لا ردود منشورة بعد',
  'dash.kpi.answered.hint': 'ردود منشورة',
  'dash.activity.title': 'نشاط متتبّع المنشورات',
  'dash.activity.subtitle': 'المنشورات المُلتقَطة خلال آخر 14 يومًا.',
  'dash.activity.total': 'إجمالي الإشارات',
  'dash.activity.dailyAvg': 'المعدّل اليومي',
  'dash.activity.aria': 'المنشورات المُلتقَطة يوميًا خلال آخر 14 يومًا. {total} إجمالًا، بمعدّل {avg} يوميًا.',
  'dash.chart.today': 'اليوم',
  'dash.chart.14dAgo': 'قبل 14 يومًا',
  'dash.chart.7dAgo': 'قبل 7 أيام',
  'dash.getStarted.title': 'ابدأ الآن',
  'dash.getStarted.subtitle': 'ثلاث خطوات سريعة نحو أولى نتائجك — اختر أيًّا منها للبدء.',
  'dash.step.find.title': 'اعثر على حسابات لمتابعتها',
  'dash.step.find.desc': 'اختر صنّاع المحتوى في مجالك — ويتابع Viraholic منشوراتهم نيابةً عنك.',
  'dash.step.find.cta': 'ابحث عن حسابات',
  'dash.step.watch.title': 'راقب موجزك',
  'dash.step.watch.desc': 'استخرج تلقائيًا المنشورات ذات نيّة الشراء من موجزك الرئيسي.',
  'dash.step.watch.cta': 'فعّل مراقب الموجز',
  'dash.step.generate.title': 'أنشئ المحتوى',
  'dash.step.generate.desc': 'اكتب منشورات وردودًا بنبرتك تُحقّق التحويل فعلًا.',
  'dash.step.generate.cta': 'افتح محرّك المحتوى',

  // Posts Tracker — relative time
  'time.recently': 'مؤخّرًا',
  'time.justNow': 'الآن',
  'time.mAgo': 'قبل {n} د',
  'time.hAgo': 'قبل {n} س',
  'time.dAgo': 'قبل {n} ي',

  // Posts Tracker — card
  'tracker.open.thread': 'افتح الموضوع',
  'tracker.open.post': 'افتح المنشور',
  'tracker.open.generic': 'افتح',
  'tracker.platform.web': 'الويب',
  'tracker.badge.feed': 'الموجز',
  'tracker.badge.tracked': 'متابَع',
  'tracker.badge.repost': 'إعادة نشر',
  'tracker.badge.repliesRestricted': 'الردود مُقيَّدة',
  'tracker.status.autoReplied': 'رُدَّ آليًا',
  'tracker.status.youReplied': 'ردَدتَ عليه',
  'tracker.status.queued': 'ردّ آليّ في الانتظار',
  'tracker.status.skipped': 'تخطّاه الفلتر',
  'tracker.status.notReplied': 'لم يُردّ عليه بعد',
  'tracker.fit.strong': 'ملاءمة قوية',
  'tracker.fit.good': 'ملاءمة جيدة',
  'tracker.fit.moderate': 'ملاءمة متوسطة',
  'tracker.fit.weak': 'ملاءمة ضعيفة',
  'tracker.fit.low': 'ملاءمة منخفضة',
  'tracker.fit.unscored': 'غير مُقيَّم',
  'tracker.fit.caption': 'مدى الملاءمة',
  'tracker.btn.reviewReply': 'راجِع الردّ المقترح',
  'tracker.btn.hideReply': 'أخفِ الردّ المقترح',
  'tracker.btn.writing': 'جارٍ الكتابة…',
  'tracker.btn.comment': 'علّق',
  'tracker.btn.replyAgain': 'ردّ مجددًا',
  'tracker.btn.repost': 'إعادة نشر',
  'tracker.btn.quote': 'اقتباس',
  'tracker.quoting': 'اقتباس من',

  // Account Finder
  'af.eyebrow': 'مكتشف الحسابات',
  'af.title.a': 'اعثر على',
  'af.title.hl': 'صنّاع المحتوى',
  'af.title.b': 'في مجالك',
  'af.subtitle': 'ابحث في X وLinkedIn عن حسابات تستحقّ المتابعة والتفاعل معها. مصمَّم ليبقى آمنًا ويتجنّب الحظر.',
  'af.badge.connected': 'متّصلة',
  'af.badge.off': 'الإضافة متوقّفة',
  'af.status.idle': 'جاهز',
  'af.status.preparing': 'يبدأ',
  'af.status.scanning': 'يبحث',
  'af.status.paused': 'متوقّف مؤقتًا',
  'af.status.cooldown': 'في الانتظار',
  'af.status.completed': 'اكتمل',
  'af.status.failed': 'فشل',
  'af.status.aborted': 'أُوقف',
  'af.card.where.title': 'أين نبحث',
  'af.card.where.sub': 'اختر واحدة أو أكثر',
  'af.card.what.title': 'عمّ نبحث',
  'af.card.what.sub': 'كلمات تصف مجالك',
  'af.kw.label': 'الكلمات المفتاحية (مطلوبة)',
  'af.kw.ph': 'مثال: وكلاء الذكاء الاصطناعي، no-code، indie hacker',
  'af.ht.label': 'الوسوم (اختياري)',
  'af.excl.label': 'كلمات لتجنّبها',
  'af.excl.ph': 'crypto، NFT (تخطَّها)',
  'af.card.eng.title': 'حدّ التفاعل',
  'af.card.eng.sub': 'ما مقدار التفاعل المطلوب على منشوراتهم',
  'af.postsWithin': 'منشورات خلال',
  'af.engRate.label': 'معدّل تفاعل الجمهور ≥ (%)',
  'af.engRate.ph': 'اختياري — مثال: 2',
  'af.moreFilters': 'مزيد من عوامل التصفية',
  'af.optional': 'اختياري',
  'af.card.refine.title': 'صقل الجمهور',
  'af.card.refine.sub': 'اختياري — إعدادات إضافية. التفاعل هو الأساس، وهذه لترجيح الكفّة.',
  'af.language': 'اللغة',
  'af.verifiedOnly': 'الحسابات المُوثّقة فقط',
  'af.skipTracked': 'تخطَّ الحسابات التي أتابعها بالفعل',
  'af.card.searchType.title': 'نوع البحث',
  'af.card.searchType.sub': 'اختر استراتيجيتك',
  'af.launchHint': 'اختر منصّة وأضِف كلمات مفتاحية للبدء',
  'af.extNotInstalled.bold': 'الإضافة غير مثبّتة.',
  'af.extNotInstalled.rest': 'ثبّت إضافة Viraholic للبحث عن حسابات حقيقية.',
  'af.eng.any.label': 'أي منشور',
  'af.eng.any.tagline': 'دون فلتر تفاعل',
  'af.eng.any.helper': 'أظهِر كل من ذكر كلماتك المفتاحية. أوسع نطاق، وأضعف إشارة.',
  'af.eng.some.label': 'تفاعل بسيط',
  'af.eng.some.tagline': '~10+ إعجاب لكل منشور',
  'af.eng.some.helper': 'يستبعد المنشورات الميّتة تمامًا. استخدمه إذا كان مجالك صغيرًا.',
  'af.eng.real.label': 'إشارة حقيقية',
  'af.eng.real.tagline': '~50+ إعجاب لكل منشور',
  'af.eng.real.helper': 'موصى به. أصحاب محتوى يتفاعل معه الجمهور فعلًا.',
  'af.eng.viral.label': 'المنتشِر فقط',
  'af.eng.viral.tagline': '~500+ إعجاب لكل منشور',
  'af.eng.viral.helper': 'كبار صنّاع المحتوى فقط. استخدمه بحذر — أغلب المجالات لا تضمّ كثيرين.',
  'af.recency.7': 'آخر 7 أيام',
  'af.recency.30': 'آخر 30 يومًا',
  'af.recency.90': 'آخر 90 يومًا',
  'af.recency.any': 'أي وقت',
  'af.mode.surgical.label': 'سريع',
  'af.mode.surgical.desc': 'مسح للموجز فقط، بحدّ تفاعل',
  'af.mode.surgical.budget': '~10-20 حسابًا',
  'af.mode.volume.label': 'واسع',
  'af.mode.volume.desc': 'استعلامات أكثر وتمرير أعمق',
  'af.mode.volume.budget': '~50-100 حساب',
  'af.mode.deep.label': 'عميق',
  'af.mode.deep.desc': 'توسيع من البذور: الدخول إلى أبرز المنشورات وجمع المتفاعلين والمُعلّقين',
  'af.mode.deep.budget': '~25-50 عالي الثقة',
  // Account Finder — لوحة البحث بالذكاء الاصطناعي (المعروضة فعليًا)
  'af.card.where.sub2': 'اختر منصّة واحدة',
  'af.niche.title': 'ما مجالك؟',
  'af.niche.sub': 'يستخدمه الذكاء الاصطناعي لاختيار الحسابات',
  'af.niche.ph': 'مثال: وكلاء ذكاء اصطناعي لمؤسّسي SaaS، روّاد يبنون علنًا في أدوات المطوّرين، مسوّقو نمو يركّزون على تسعير B2B SaaS…',
  'af.kw2.label': 'الكلمات المفتاحية (اختياري)',
  'af.kw2.ph': 'مثال: agents، no-code، indie hacker',
  'af.country.title': 'الدولة',
  'af.country.sub': 'أين يجب أن تتمركز الحسابات؟',
  'af.country.custom.ph': 'مثال: النرويج، كوريا الجنوبية، منطقة الخليج…',
  'af.country.helper.any': 'دون فلتر جغرافي — يمكن أن تتمركز الحسابات في أي مكان.',
  'af.country.helper.custom': 'سيعطي الذكاء الاصطناعي الأولوية لصنّاع المحتوى في هذه المنطقة.',
  'af.country.helper.specific': 'اقترح فقط صنّاع محتوى يتمركزون أساسًا في {country}.',
  'af.country.worldwide': 'عالميًا',
  'af.size.title': 'حجم الحساب',
  'af.size.sub': 'ما الحجم المطلوب للحسابات؟',
  'af.size.any.label': 'أيّ حجم',
  'af.size.any.helper': 'دون فلتر لعدد المتابعين',
  'af.size.small.label': 'صغير',
  'af.size.small.helper': 'أقل من ~50 ألفًا — معدّل ردّ مرتفع',
  'af.size.medium.label': 'متوسط',
  'af.size.medium.helper': '~50 ألفًا – مليون — وصول جيّد',
  'af.size.large.label': 'كبير',
  'af.size.large.helper': 'أكثر من مليون — تأثير واسع',
  'af.card.eng2.sub': 'صفِّ الحسابات التي تحظى منشوراتها بتفاعل',
  'af.aieng.any.label': 'أي',
  'af.aieng.any.helper': 'دون فلتر تفاعل',
  'af.aieng.some.label': 'بعض',
  'af.aieng.some.helper': '~10+ لكل منشور',
  'af.aieng.real.label': 'إشارة حقيقية',
  'af.aieng.real.helper': '~50+ لكل منشور',
  'af.aieng.viral.label': 'منتشِر',
  'af.aieng.viral.helper': '~500+ لكل منشور',
  'af.find.title': 'اعثر على حسابات',
  'af.find.sub': 'يقترح الذكاء الاصطناعي حسابات حقيقية للمتابعة',
  'af.find.howMany': 'كم اقتراحًا',
  'af.find.searching': 'جارٍ البحث…',
  'af.find.cta': 'ابحث عن حسابات',
  'af.find.hint': 'صِف مجالك أو أضِف كلمة مفتاحية أولًا.',
  'af.manual.title': 'أضِف حسابًا للمتابعة يدويًا',
  'af.manual.sub': 'الصق معرّفًا أو رابط ملف شخصي أو subreddit — وتبدأ متابعته فورًا.',

  // Feed Watcher
  'fw.ext': 'الإضافة',
  'fw.connected': 'متّصلة',
  'fw.bridgeOff': 'لم يُكتشف الجسر — أعِد تحميل الإضافة',
  'fw.title': 'أتمتة في الخلفية',
  'fw.subtitle': 'تعمل داخل الإضافة — حتى عندما يكون هذا التبويب مغلقًا.',
  'fw.active': 'نشط',
  'fw.off': 'متوقّف',
  'fw.intro': 'فعّل المنصّات أدناه. كل {interval} دقيقة، تفتح الإضافة نافذة خفيّة وتمرّر كل موجز رئيسي مُفعّل — تمامًا كما يفعل الإنسان — حتى تجمع حتى {max} منشورًا (هدفك أدناه) أو تنفد المنشورات الجديدة. يُقيّم الذكاء الاصطناعي كل منشور جديد وفق موجزك؛ وكل ما بلغ {min}/100 أو أكثر يصل إلى متتبّع المنشورات. ولا يُقيَّم المنشور نفسه مرّتين. وتُقرأ بيانات الكاتب من بطاقة الموجز مباشرة — دون فتح أي ملف شخصي.',
  'fw.watching': 'قيد المراقبة',
  'fw.brief.label': 'ما الذي أبحث عنه',
  'fw.optional': 'اختياري',
  'fw.brief.ph': 'اتركه فارغًا لاستهداف تلقائي من منتجك — أو حدّد بدقّة، مثل: أشخاص يشكون من أدوات التواصل البارد، مؤسّسون يطلبون مساعدة تسويقية، منشورات عن توظيف أوّل مسوّق نمو.',
  'fw.brief.specific': 'كن محدّدًا — الموجز الغامض يعطي نتائج غامضة.',
  'fw.brief.everythingBold': 'إظهار كل شيء.',
  'fw.brief.everythingRest': 'بلا موجز، أُرسل كل منشور أمرّ عليه إلى متتبّع المنشورات — مُرتَّبًا بحسب ملاءمته للمنتج والجمهور في مشروعك عند توفّرهما. اكتب موجزًا في الأعلى للتصفية بصرامة بدلًا من ذلك.',
  'fw.maxPosts': 'أقصى عدد منشورات لكل جولة',
  'fw.maxPosts.helper': 'كم منشورًا يُسحب إلى متتبّع المنشورات في كل جولة (1–100). الأهداف الأعلى تُمرّر الموجز مدّة أطول — قد تستغرق جولة من 100 منشور عدّة دقائق من التمرير المرئي.',
  'fw.minFit': 'الحدّ الأدنى لملاءمة الملف',
  'fw.min.keepMost': '0% — احتفظ بالأغلب',
  'fw.min.perfect': '100% — الملاءمة التامة فقط',
  'fw.minFit.helper': 'المنشورات التي تبلغ ملاءمتها هذه النسبة أو أعلى فقط تصل إلى المتتبّع — وهي نفس درجة الملاءمة الظاهرة على كل بطاقة.',
  'fw.pollEvery': 'افحص كل',
  'fw.minutes': 'دقيقة',
  'fw.sweeping': 'جارٍ المسح…',
  'fw.sweepNow': 'امسح الآن',
  'fw.sweep.titleDisconnected': 'الإضافة غير متّصلة',
  'fw.sweep.titleNoPlat': 'فعّل منصّة واحدة على الأقل',
  'fw.sweep.titleRun': 'شغّل جولة واحدة الآن',
  'fw.poll.helper': 'الحدّ الأدنى دقيقتان، والأقصى 6 ساعات. تُمرّر كل جولة كل موجز مُفعّل حتى تبلغ هدف «أقصى عدد منشورات لكل جولة» أو تنفد المنشورات الجديدة.',
  'fw.stat.buffer': 'في آخر مخزّن تمرير',
  'fw.stat.scored': 'مُقيَّم',
  'fw.stat.promoted': 'مُرقّى إلى المتتبّع',
  'fw.stat.scrolling': '{n} ث من التمرير',
  'fw.stat.lastSweep': 'آخر جولة {time}',
  'fw.diag.hide': 'أخفِ التشخيص',
  'fw.diag.show': 'لماذا 0 منشور؟ →',
  'fw.diag.none.a': 'لا تشخيص لأي جولة بعد. اضغط',
  'fw.diag.none.b': 'وستظهر النتيجة الدقيقة هنا.',

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
