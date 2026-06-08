import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Target, Zap, Users, Crosshair, ShieldCheck, ShieldAlert, ShieldOff,
  Twitter, Linkedin, MessageCircle, Plus, X, Play, Pause, StopCircle,
  Activity, Eye, ExternalLink, Check, CheckCircle2, Star, TrendingUp, Globe, Filter,
  ChevronDown, ChevronUp, Sparkles, Loader2, Radar, Hash, AlertTriangle,
  Verified, Settings2, Terminal, Clock, Gauge, Skull, Brain, Heart,
  ArrowUpRight, BarChart3, FileSearch, Trash2, Download, Share2,
  Repeat, CalendarClock, RotateCw
} from 'lucide-react';
import {
  DiscoveryPlatform, DiscoveryMode, AuthorityLevel, DiscoveryFilters,
  DiscoveredAccount, MissionLog, StealthState, MissionProgress,
  DiscoveryMission, MissionStatus, AccountTier,
  DiscoveryCampaign, EngagementFloor, PostRecencyDays
} from '../types';
import { useProject } from '../contexts/ProjectContext';
import { findAccountsWithAI, AISuggestedAccount, isGeminiConfigured } from '../services/geminiService';

const STORAGE_KEY_MISSION = 'discovery_mission_active';
const STORAGE_KEY_FILTERS = 'discovery_filters_draft';
const STORAGE_KEY_RESULTS = 'discovery_results_archive';

const PLATFORMS: { id: DiscoveryPlatform; label: string; icon: React.ReactNode; color: string; bgGradient: string }[] = [
  { id: 'X', label: 'X / Twitter', icon: <Twitter size={20} />, color: 'text-slate-900', bgGradient: 'from-slate-900 to-slate-700' },
  { id: 'LinkedIn', label: 'LinkedIn', icon: <Linkedin size={20} />, color: 'text-blue-700', bgGradient: 'from-blue-700 to-blue-500' },
  { id: 'Reddit', label: 'Reddit', icon: <MessageCircle size={20} />, color: 'text-orange-600', bgGradient: 'from-orange-600 to-amber-500' }
];

const AUTHORITY_TIERS: { id: AuthorityLevel; label: string; range: string; description: string }[] = [
  { id: 'all',  label: 'Any size',  range: 'No limit',  description: 'Show every account' },
  { id: 'nano', label: 'Small',     range: '< 50K',     description: 'Loyal followers, easy to reach' },
  { id: 'mid',  label: 'Medium',    range: '50K – 1M',  description: 'Solid reach, still approachable' },
  { id: 'mega', label: 'Large',     range: '> 1M',      description: 'Massive reach, hard to engage' }
];

// Engagement preset → human-readable per-platform translation. The actual
// numeric thresholds live in the engine (ENGAGEMENT_THRESHOLDS); these
// strings exist only so the user can SEE what each preset means.
const ENGAGEMENT_PRESETS: { id: EngagementFloor; label: string; tagline: string; helper: string }[] = [
  { id: 'any',   label: 'Any post',       tagline: 'No engagement filter',  helper: 'Surface every author who mentioned your keywords. Maximum breadth, lowest signal.' },
  { id: 'some',  label: 'Some traction',  tagline: '~10+ likes per post',    helper: 'Filters out total dead posts. Use when your niche is small.' },
  { id: 'real',  label: 'Real signal',    tagline: '~50+ likes per post',    helper: 'Recommended. Authors whose content is actually engaged with.' },
  { id: 'viral', label: 'Viral only',     tagline: '~500+ likes per post',   helper: 'Only top creators. Use sparingly — most niches don’t have many.' }
];

const RECENCY_PRESETS: { id: PostRecencyDays; label: string }[] = [
  { id: 7,    label: 'Last 7 days' },
  { id: 30,   label: 'Last 30 days' },
  { id: 90,   label: 'Last 90 days' },
  { id: null, label: 'Any time' }
];

const MODE_CONFIG: Record<DiscoveryMode, { label: string; description: string; icon: React.ReactNode; budget: string; color: string }> = {
  surgical: { label: 'Quick',  description: 'Pure feed scrape, engagement floor only', icon: <Crosshair size={20} />, budget: '~10-20 accounts', color: 'emerald' },
  volume:   { label: 'Wide',   description: 'More queries + deeper scroll',             icon: <Radar size={20} />,     budget: '~50-100 accounts', color: 'blue' },
  deep:     { label: 'Deep',   description: 'Seed expand: click into top posts, scrape reactors/repliers', icon: <Brain size={20} />, budget: '~25-50 high-confidence', color: 'purple' }
};

const DEFAULT_FILTERS: DiscoveryFilters = {
  platforms: ['X'],
  keywords: [],
  hashtags: [],
  excludeKeywords: [],
  // Engagement bar — these are the new headline filters.
  engagementFloor: 'real',
  postRecencyDays: 30,
  // Audience refinement (demoted) — default to "any" so engagement leads.
  authorityLevel: 'all',
  seeds: {},
  // Feed watcher moved to its own top-level section; intentionally not seeded here.
  verifiedOnly: false,
  excludeAlreadyTracked: true
};

// Adapter for missions/filters persisted under the pre-engagement-rework
// shape. Fills in new fields with sane defaults so old localStorage payloads
// keep loading. Drops postingFrequency which no longer has UI.
function migrateFilters(raw: any): DiscoveryFilters {
  const merged: DiscoveryFilters = { ...DEFAULT_FILTERS, ...(raw || {}) };
  if (!merged.seeds || typeof merged.seeds !== 'object') merged.seeds = {};
  if (typeof merged.engagementFloor !== 'string') merged.engagementFloor = DEFAULT_FILTERS.engagementFloor;
  if (merged.postRecencyDays === undefined) merged.postRecencyDays = DEFAULT_FILTERS.postRecencyDays;
  // Old default was 'micro'; if user kept it, treat as 'all' (engagement leads now).
  if (!AUTHORITY_TIERS.some(t => t.id === merged.authorityLevel)) {
    merged.authorityLevel = 'all';
  }
  // Feed watcher field is owned by FeedWatcherView now — left untouched here.
  return merged;
}

// =====================================================================
// AI-POWERED ACCOUNT FINDER
// =====================================================================
// The old extension-driven mission/console search has been retired in favour
// of an AI account finder: user picks platform + niche + engagement
// parameters; we ask the model for accounts to follow and stream them into
// the existing results panel. Tracking, manual-add and the polling settings
// all still work — only the discovery step changed.

type AudienceSize = 'any' | 'small' | 'medium' | 'large';

const AUDIENCE_PRESETS: { id: AudienceSize; label: string; helper: string }[] = [
  { id: 'any',    label: 'Any size',  helper: 'No follower-count filter' },
  { id: 'small',  label: 'Small',     helper: 'Under ~50K — high reply rate' },
  { id: 'medium', label: 'Medium',    helper: '~50K–1M — solid reach' },
  { id: 'large',  label: 'Large',     helper: 'Over 1M — broad influence' }
];

const AI_ENGAGEMENT_PRESETS: { id: 'any' | 'some' | 'real' | 'viral'; label: string; helper: string }[] = [
  { id: 'any',   label: 'Any',         helper: 'No engagement filter' },
  { id: 'some',  label: 'Some',        helper: '~10+ per post' },
  { id: 'real',  label: 'Real signal', helper: '~50+ per post' },
  { id: 'viral', label: 'Viral',       helper: '~500+ per post' }
];

// Curated country list for the geo filter. "Worldwide" disables the filter.
// Kept short on purpose — users with a more specific market can type into the
// free-text field that follows. Order: anglosphere first, then EU, then APAC.
const COUNTRY_OPTIONS: { id: string; label: string }[] = [
  { id: 'any',          label: 'Worldwide' },
  { id: 'United States', label: 'United States' },
  { id: 'United Kingdom', label: 'United Kingdom' },
  { id: 'Canada',       label: 'Canada' },
  { id: 'Australia',    label: 'Australia' },
  { id: 'Ireland',      label: 'Ireland' },
  { id: 'Germany',      label: 'Germany' },
  { id: 'France',       label: 'France' },
  { id: 'Netherlands',  label: 'Netherlands' },
  { id: 'Spain',        label: 'Spain' },
  { id: 'Italy',        label: 'Italy' },
  { id: 'Sweden',       label: 'Sweden' },
  { id: 'Switzerland',  label: 'Switzerland' },
  { id: 'Brazil',       label: 'Brazil' },
  { id: 'Mexico',       label: 'Mexico' },
  { id: 'India',        label: 'India' },
  { id: 'Singapore',    label: 'Singapore' },
  { id: 'UAE',          label: 'United Arab Emirates' },
  { id: 'Japan',        label: 'Japan' },
  { id: 'custom',       label: 'Other — type below' }
];

// Influence is a composite signal of real audience pull. It combines how much
// engagement each post actually gets (heaviest weight), how well the account
// matches the user's niche, and a smaller authority/reach component. Higher =
// more impact on you when they engage with your content.
function computeInfluence(a: DiscoveredAccount): number {
  // Engagement rate is a percent. 4% maps to 100 (anything above is rare/excellent).
  const erComponent = Math.min(100, Math.max(0, (a.engagementRate ?? 0) * 25));
  const niche = Math.max(0, Math.min(100, a.nicheMatch || 0));
  const authority = Math.max(0, Math.min(100, a.authorityScore || 0));
  return Math.max(0, Math.min(100, Math.round(erComponent * 0.5 + niche * 0.3 + authority * 0.2)));
}

function influenceLabel(score: number): { label: string; tone: string } {
  if (score >= 80) return { label: 'Heavyweight', tone: 'text-rose-600' };
  if (score >= 60) return { label: 'Strong',      tone: 'text-orange-600' };
  if (score >= 40) return { label: 'Solid',       tone: 'text-amber-600' };
  return { label: 'Light', tone: 'text-gray-500' };
}

// Tier from final score 0..100.
function scoreToTier(score: number): AccountTier {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  return 'C';
}

function aiToDiscovered(a: AISuggestedAccount, platform: DiscoveryPlatform): DiscoveredAccount {
  const followerScore = Math.min(100, Math.round(Math.log10(Math.max(1, a.followers || 1)) * 20));
  const engagementScore = Math.round((a.engagementRate || 2) * 8);
  const finalScore = Math.max(40, Math.min(99, Math.round(followerScore * 0.45 + engagementScore * 0.55 + 20)));
  return {
    id: `ai_${platform}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    platform,
    handle: a.handle,
    url: a.url,
    displayName: a.displayName || a.handle,
    bio: a.bio,
    followers: a.followers || 0,
    verified: !!a.verified,
    avgEngagement: a.engagementRate ? Math.round((a.followers || 0) * (a.engagementRate / 100)) : undefined,
    engagementRate: a.engagementRate,
    authorityScore: followerScore,
    nicheMatch: Math.round((engagementScore + 70) / 2),
    finalScore,
    matchedSignals: a.matchedSignals && a.matchedSignals.length ? a.matchedSignals : [a.whyHighEngagement].filter(Boolean),
    topTopics: a.topTopics,
    tier: scoreToTier(finalScore),
    discoveredAt: new Date().toISOString(),
    trackingStatus: 'untracked',
    discoveredVia: 'search',
    verificationStatus: 'card-only'
  };
}

export const AccountFinderView: React.FC = () => {
  const { project } = useProject();

  // --- AI finder config ---
  const [platform, setPlatform] = useState<DiscoveryPlatform>('X');
  const [niche, setNiche] = useState<string>(() => {
    try { return localStorage.getItem('aifinder_niche') || ''; } catch { return ''; }
  });
  const [keywords, setKeywords] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('aifinder_keywords') || '[]'); } catch { return []; }
  });
  const [keywordDraft, setKeywordDraft] = useState('');
  const [audienceSize, setAudienceSize] = useState<AudienceSize>('any');
  const [engagementBar, setEngagementBar] = useState<'any' | 'some' | 'real' | 'viral'>('real');
  const [country, setCountry] = useState<string>(() => {
    try { return localStorage.getItem('aifinder_country') || 'any'; } catch { return 'any'; }
  });
  const [countryCustom, setCountryCustom] = useState<string>(() => {
    try { return localStorage.getItem('aifinder_country_custom') || ''; } catch { return ''; }
  });
  const [resultLimit, setResultLimit] = useState<number>(15);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [archivedResults, setArchivedResults] = useState<DiscoveredAccount[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RESULTS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [resultFilter, setResultFilter] = useState<'all' | AccountTier | 'untracked'>('all');
  const [resultSort, setResultSort] = useState<'score' | 'influence' | 'engagement' | 'recent' | 'lastpost'>('score');
  const [selectedAccount, setSelectedAccount] = useState<DiscoveredAccount | null>(null);

  // --- Persistence ---
  useEffect(() => {
    try { localStorage.setItem('aifinder_niche', niche); } catch {}
  }, [niche]);
  useEffect(() => {
    try { localStorage.setItem('aifinder_keywords', JSON.stringify(keywords)); } catch {}
  }, [keywords]);
  useEffect(() => {
    try { localStorage.setItem('aifinder_country', country); } catch {}
  }, [country]);
  useEffect(() => {
    try { localStorage.setItem('aifinder_country_custom', countryCustom); } catch {}
  }, [countryCustom]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(archivedResults));
  }, [archivedResults]);

  // --- Helpers ---
  const addKeyword = () => {
    const v = keywordDraft.trim();
    if (!v) return;
    setKeywords(k => Array.from(new Set([...k, v])));
    setKeywordDraft('');
  };
  const removeKeyword = (v: string) => setKeywords(k => k.filter(x => x !== v));

  const runAIFinder = async () => {
    setSearchError(null);
    if (!niche.trim() && keywords.length === 0) {
      setSearchError('Add a niche description or at least one keyword to search for.');
      return;
    }
    if (!isGeminiConfigured()) {
      setSearchError('AI client is not configured. Check services/geminiService.ts.');
      return;
    }
    setSearching(true);
    try {
      const resolvedCountry =
        country === 'any'    ? undefined :
        country === 'custom' ? (countryCustom.trim() || undefined) :
                                country;
      const suggestions = await findAccountsWithAI({
        platform,
        niche: niche.trim(),
        keywords,
        audienceSize,
        engagementBar,
        country: resolvedCountry,
        productName: (project as any)?.productName,
        productPitch: (project as any)?.pitch,
        targetAudience: (project as any)?.targetAudience,
        limit: resultLimit
      });
      const mapped = suggestions.map(s => aiToDiscovered(s, platform));
      setArchivedResults(prev => {
        const existing = new Set(prev.map(a => a.url));
        const fresh = mapped.filter(a => !existing.has(a.url));
        return [...fresh, ...prev].slice(0, 500);
      });
      if (mapped.length === 0) {
        setSearchError('The AI returned no matches. Try broadening your niche or relaxing the engagement bar.');
      }
    } catch (e: any) {
      console.error('[AccountFinder] AI search failed:', e);
      setSearchError(e?.message || 'AI search failed. Check the console for details.');
    } finally {
      setSearching(false);
    }
  };

  const trackAccount = (account: DiscoveredAccount) => {
    try {
      const existing = JSON.parse(localStorage.getItem('answerly_creator_configs') || '[]');
      if (existing.some((c: any) => c.url === account.url)) {
        updateAccountStatus(account.id, 'tracking');
        return;
      }
      const newConfig = {
        id: 'ans_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        platform: account.platform,
        url: account.url,
        label: account.displayName || account.handle
      };
      const updated = [...existing, newConfig];
      localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
      updateAccountStatus(account.id, 'tracking');
    } catch (e) {
      console.error('Track failed', e);
    }
  };

  const dismissAccount = (account: DiscoveredAccount) => {
    // Skip = DELETE the account from the results entirely (not a soft "dismissed"
    // state). First strip it from the synced config so a skipped account never
    // lingers in tracking, then drop it from both the archived results and the
    // current mission's results so it disappears from the list immediately.
    try {
      const existing = JSON.parse(localStorage.getItem('answerly_creator_configs') || '[]');
      const updated = existing.filter((c: any) => c.url !== account.url);
      if (updated.length !== existing.length) {
        localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
      }
    } catch (e) {
      console.error('Dismiss cleanup failed', e);
    }
    removeAccount(account.id);
  };

  // Remove an account from every result list so it vanishes from the UI.
  const removeAccount = (id: string) => {
    setArchivedResults(prev => prev.filter(a => a.id !== id));
  };

  // Actually STOP tracking: remove from the synced creator-config list and
  // push the change to the extension so the engine stops polling this account.
  const untrackAccount = (account: DiscoveredAccount) => {
    try {
      const existing = JSON.parse(localStorage.getItem('answerly_creator_configs') || '[]');
      const updated = existing.filter((c: any) => c.url !== account.url);
      localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
    } catch (e) {
      console.error('Untrack failed', e);
    }
    updateAccountStatus(account.id, 'untracked');
  };

  const updateAccountStatus = (id: string, status: 'tracking' | 'dismissed' | 'untracked') => {
    setArchivedResults(prev => prev.map(a => a.id === id ? { ...a, trackingStatus: status } : a));
  };

  const trackBatch = (accounts: DiscoveredAccount[]) => {
    accounts.forEach(a => trackAccount(a));
  };

  // Parse a handle / URL / r/name into a normalized account and track it.
  // Lets users watch accounts the discovery search didn't surface.
  const addManualAccount = (platform: DiscoveryPlatform, input: string): { ok: boolean; error?: string } => {
    const cleaned = input.trim();
    if (!cleaned) return { ok: false, error: 'Enter a handle or URL' };

    let handle = '';
    let url = '';
    try {
      if (platform === 'X') {
        const m = cleaned.match(/(?:x\.com|twitter\.com)\/(@?)([A-Za-z0-9_]{1,15})/i)
              ||  cleaned.match(/^@?([A-Za-z0-9_]{1,15})$/);
        handle = (m && (m[2] || m[1])) || '';
        if (!handle) return { ok: false, error: 'Invalid X handle' };
        url = `https://x.com/${handle}`;
      } else if (platform === 'LinkedIn') {
        const m = cleaned.match(/linkedin\.com\/in\/([^/?#\s]+)/i)
              ||  cleaned.match(/^([A-Za-z0-9-]{3,})$/);
        handle = (m && m[1]) || '';
        if (!handle) return { ok: false, error: 'Use the full /in/ URL or the slug' };
        url = `https://www.linkedin.com/in/${handle}/`;
      } else if (platform === 'Reddit') {
        // Reddit tracking targets subreddits, so accept r/name or full URL
        const m = cleaned.match(/reddit\.com\/r\/([^/?#\s]+)/i)
              ||  cleaned.match(/^r\/([^/\s]+)$/i)
              ||  cleaned.match(/^([A-Za-z0-9_]{3,})$/);
        const name = (m && m[1]) || '';
        if (!name) return { ok: false, error: 'Use r/name or the subreddit URL' };
        handle = `r/${name}`;
        url = `https://www.reddit.com/r/${name}/`;
      } else {
        return { ok: false, error: 'Unsupported platform' };
      }
    } catch {
      return { ok: false, error: 'Could not parse input' };
    }

    // Avoid duplicates — if the URL already exists, just (re-)track it.
    const existing = allResults.find(a => a.url === url);
    if (existing) {
      trackAccount(existing);
      return { ok: true };
    }

    const now = new Date().toISOString();
    const account: DiscoveredAccount = {
      id: `manual_${platform}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      platform,
      handle,
      url,
      displayName: handle,
      bio: '',
      followers: 0,
      verified: false,
      authorityScore: 50,
      nicheMatch: 50,
      finalScore: 50,
      matchedSignals: ['Manually added'],
      tier: 'B' as AccountTier,
      discoveredAt: now,
      trackingStatus: 'untracked'
    };
    setArchivedResults(prev => [account, ...prev]);
    trackAccount(account);
    // Kick off async enrichment so the card fills in real follower count,
    // verification and display name instead of the manual-add placeholders.
    try {
      window.dispatchEvent(new CustomEvent('answerly_enrich_account', {
        detail: { platform, url, requestId: account.id }
      }));
    } catch {}
    return { ok: true };
  };

  // Apply enrichment results coming back from the extension (manual adds + refresh).
  useEffect(() => {
    const onEnriched = (e: any) => {
      const { url, ok, data, error } = e.detail || {};
      if (!url) return;
      if (!ok) {
        console.warn('[Enrich]', url, 'failed:', error);
        return;
      }
      if (data && data.__loginWall) {
        console.warn('[Enrich]', url, '→ login wall. Log in to that platform in this browser, then click Refresh on the row.');
        return;
      }
      if (!data) return;
      const patch: Partial<DiscoveredAccount> = {};
      if (typeof data.followers === 'number' && data.followers > 0) patch.followers = data.followers;
      if (typeof data.following === 'number' && data.following > 0) patch.following = data.following;
      if (typeof data.verified === 'boolean') patch.verified = data.verified;
      if (data.displayName) patch.displayName = data.displayName;
      if (data.bio) patch.bio = data.bio;
      if (data.avatar) patch.avatar = data.avatar;
      if (Object.keys(patch).length === 0) return;
      setArchivedResults(prev => prev.map(a => a.url === url ? { ...a, ...patch } : a));
    };
    window.addEventListener('answerly_enrich_result', onEnriched);
    return () => window.removeEventListener('answerly_enrich_result', onEnriched);
  }, []);

  // Re-trigger enrichment for an existing tracked account (used by the Refresh
  // button on each row when followers stays at 0).
  const refreshAccountData = (account: DiscoveredAccount) => {
    try {
      window.dispatchEvent(new CustomEvent('answerly_enrich_account', {
        detail: { platform: account.platform, url: account.url, requestId: account.id }
      }));
    } catch (e) { console.error('Refresh failed', e); }
  };

  // Per-account auto-reply state (read from the synced tracked configs) so the
  // results table can show + toggle it inline, per account.
  const [trackedConfigs, setTrackedConfigs] = useState<any[]>([]);
  useEffect(() => {
    const load = () => {
      try { setTrackedConfigs(JSON.parse(localStorage.getItem('answerly_creator_configs') || '[]')); }
      catch { setTrackedConfigs([]); }
    };
    load();
    window.addEventListener('answerly_sync', load);
    const id = setInterval(load, 3000);
    return () => { window.removeEventListener('answerly_sync', load); clearInterval(id); };
  }, []);
  const autoReplyByUrl = useMemo(() => {
    const m = new Map<string, boolean>();
    trackedConfigs.forEach((c: any) => m.set(c.url, !!c.autoComment));
    return m;
  }, [trackedConfigs]);
  const toggleAutoReply = (account: DiscoveredAccount, enabled: boolean) => {
    try {
      const list = JSON.parse(localStorage.getItem('answerly_creator_configs') || '[]');
      const updated = list.map((c: any) => c.url === account.url ? { ...c, autoComment: enabled } : c);
      localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
      window.dispatchEvent(new CustomEvent('tracking_toggle_auto_comment', { detail: { url: account.url, enabled } }));
      setTrackedConfigs(updated);
    } catch (e) { console.error('Toggle auto-reply failed', e); }
  };

  // --- Derived ---
  const allResults = useMemo(() => {
    const map = new Map<string, DiscoveredAccount>();
    archivedResults.forEach(a => map.set(a.id, a));
    return Array.from(map.values());
  }, [archivedResults]);

  const filteredResults = useMemo(() => {
    let r = allResults.slice();
    if (resultFilter === 'untracked') r = r.filter(a => a.trackingStatus === 'untracked');
    else if (resultFilter !== 'all') r = r.filter(a => a.tier === resultFilter);
    r.sort((a, b) => {
      if (resultSort === 'score') return b.finalScore - a.finalScore;
      if (resultSort === 'influence') return computeInfluence(b) - computeInfluence(a);
      if (resultSort === 'engagement') return (b.engagementRate || 0) - (a.engagementRate || 0);
      if (resultSort === 'lastpost') {
        // Smaller daysSinceLastPost = more recent. Unknown sinks to the bottom.
        const ad = typeof a.daysSinceLastPost === 'number' ? a.daysSinceLastPost : Number.POSITIVE_INFINITY;
        const bd = typeof b.daysSinceLastPost === 'number' ? b.daysSinceLastPost : Number.POSITIVE_INFINITY;
        return ad - bd;
      }
      return new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime();
    });
    return r;
  }, [allResults, resultFilter, resultSort]);

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Section title is provided by the unified glass header in App shell. */}

      {/* AI FINDER CONFIG */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Where to search" subtitle="Pick one platform" icon={<Globe size={18} />}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`group relative p-5 rounded-2xl border-2 transition-all text-left overflow-hidden ${
                    platform === p.id
                      ? 'border-gray-900 bg-gradient-to-br ' + p.bgGradient + ' text-white shadow-lg'
                      : 'border-gray-200 bg-white hover:border-gray-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={platform === p.id ? 'text-white' : p.color}>{p.icon}</div>
                    {platform === p.id && <Check size={16} className="text-white" />}
                  </div>
                  <div className={`font-bold text-sm ${platform === p.id ? 'text-white' : 'text-gray-900'}`}>{p.label}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title="What's your niche?" subtitle="The AI uses this to pick accounts" icon={<Brain size={18} />}>
            <textarea
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="e.g. AI agents for SaaS founders, build-in-public solopreneurs in dev tools, growth marketers focused on B2B SaaS pricing…"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400 transition-colors min-h-[90px] resize-y"
            />
            <div className="mt-4">
              <ChipsInput
                label="Keywords (optional)"
                placeholder="e.g. agents, no-code, indie hacker"
                value={keywordDraft}
                onChange={setKeywordDraft}
                chips={keywords}
                onAdd={(v: string) => { setKeywords(k => Array.from(new Set([...k, v.trim()].filter(Boolean)))); setKeywordDraft(''); }}
                onRemove={removeKeyword}
                color="indigo"
              />
            </div>
          </Card>

          <Card title="Country" subtitle="Where should the accounts be based?" icon={<Globe size={18} />}>
            <div className="space-y-3">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium bg-white text-gray-800 outline-none hover:border-gray-400 focus:border-gray-400 transition-colors"
              >
                {COUNTRY_OPTIONS.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              {country === 'custom' && (
                <input
                  value={countryCustom}
                  onChange={e => setCountryCustom(e.target.value)}
                  placeholder="e.g. Norway, South Korea, Bay Area..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400 transition-colors"
                />
              )}
              <div className="text-[10px] text-gray-500 leading-relaxed">
                {country === 'any'
                  ? 'No geo filter — accounts can be based anywhere.'
                  : country === 'custom'
                    ? 'The AI will prioritize creators based in this region.'
                    : `Only suggest creators primarily based in ${country}.`}
              </div>
            </div>
          </Card>

          <Card title="Account size" subtitle="How big should the accounts be?" icon={<Users size={18} />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {AUDIENCE_PRESETS.map(p => {
                const active = audienceSize === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setAudienceSize(p.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400 bg-white'
                    }`}
                  >
                    <div className="font-bold text-xs">{p.label}</div>
                    <div className={`text-[10px] mt-0.5 ${active ? 'text-white/80' : 'text-gray-500'}`}>{p.helper}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Engagement bar" subtitle="Filter for accounts whose posts get traction" icon={<Heart size={18} />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {AI_ENGAGEMENT_PRESETS.map(p => {
                const active = engagementBar === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setEngagementBar(p.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      active ? 'border-rose-600 bg-rose-600 text-white' : 'border-gray-200 hover:border-rose-300 bg-white'
                    }`}
                  >
                    <div className="font-bold text-xs">{p.label}</div>
                    <div className={`text-[10px] mt-0.5 ${active ? 'text-white/80' : 'text-gray-500'}`}>{p.helper}</div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* RIGHT: Run + tracking settings */}
        <div className="space-y-6">
          <Card title="Find accounts" subtitle="AI suggests real accounts to follow" icon={<Sparkles size={18} />}>
            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-1.5">
                  How many to suggest
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={5} max={30} step={5}
                    value={resultLimit}
                    onChange={e => setResultLimit(parseInt(e.target.value))}
                    className="flex-1 accent-gray-900"
                  />
                  <span className="text-sm font-bold text-gray-900 w-8 text-right tabular-nums">{resultLimit}</span>
                </div>
              </div>
              <button
                onClick={runAIFinder}
                disabled={searching || (!niche.trim() && keywords.length === 0)}
                className="w-full px-4 py-3 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
              >
                {searching ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Searching…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Find accounts
                  </>
                )}
              </button>
              {searchError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
                  <AlertTriangle size={14} className="text-rose-700 mt-0.5 flex-shrink-0" />
                  <div className="text-[11px] text-rose-800 leading-relaxed">{searchError}</div>
                </div>
              )}
              {!niche.trim() && keywords.length === 0 && (
                <div className="text-[10px] text-gray-500 leading-relaxed">
                  Describe your niche or add a keyword first.
                </div>
              )}
            </div>
          </Card>

          <TrackingSettingsCard />
        </div>
      </div>

      {/* Manual add */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="bg-gray-900 p-1.5 rounded-lg"><Plus size={14} className="text-white" /></div>
          <div>
            <div className="text-sm font-bold text-gray-900">Add an account to track manually</div>
            <div className="text-[10px] text-gray-500">Paste a handle, profile URL, or subreddit — it starts getting watched right away.</div>
          </div>
        </div>
        <ManualAddForm onAdd={addManualAccount} />
      </div>

      {/* Results */}
      {allResults.length > 0 && (
        <ResultsPanel
          results={filteredResults}
          totalCount={allResults.length}
          resultFilter={resultFilter}
          setResultFilter={setResultFilter}
          resultSort={resultSort}
          setResultSort={setResultSort}
          onTrack={trackAccount}
          onDismiss={dismissAccount}
          onUntrack={untrackAccount}
          onInspect={setSelectedAccount}
          onTrackBatch={trackBatch}
          autoReplyByUrl={autoReplyByUrl}
          onToggleAutoReply={toggleAutoReply}
          onRefreshAccount={refreshAccountData}
        />
      )}

      {/* Empty State */}
      {allResults.length === 0 && (
        <EmptyState />
      )}

      {/* Inspect Modal */}
      {selectedAccount && (
        <InspectModal
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
          onTrack={() => { trackAccount(selectedAccount); setSelectedAccount(null); }}
          onDismiss={() => { dismissAccount(selectedAccount); setSelectedAccount(null); }}
        />
      )}
    </div>
  );
};

// ============================================================
// SUB-COMPONENTS
// ============================================================

// Manual add — accepts handle / URL / r/name for the selected platform
const ManualAddForm: React.FC<{
  onAdd: (platform: DiscoveryPlatform, input: string) => { ok: boolean; error?: string };
}> = ({ onAdd }) => {
  const [platform, setPlatform] = useState<DiscoveryPlatform>('X');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = () => {
    setError('');
    const res = onAdd(platform, input);
    if (res.ok) {
      setInput('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1500);
    } else {
      setError(res.error || 'Could not add');
    }
  };

  const placeholder = platform === 'X' ? '@handle or https://x.com/handle'
    : platform === 'LinkedIn' ? 'https://linkedin.com/in/slug or slug'
    : 'r/subreddit or https://reddit.com/r/subreddit';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={platform}
          onChange={(e) => { setPlatform(e.target.value as DiscoveryPlatform); setError(''); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium bg-white text-gray-700 outline-none hover:border-gray-400 transition-colors"
        >
          <option value="X">X</option>
          <option value="LinkedIn">LinkedIn</option>
          <option value="Reddit">Reddit</option>
        </select>
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder={placeholder}
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none hover:border-gray-400 focus:border-gray-400 transition-colors"
        />
        <button
          onClick={submit}
          disabled={!input.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-[0.97]"
        >
          <Plus size={13} /> Add &amp; track
        </button>
      </div>
      {error && <div className="text-[11px] text-rose-600 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</div>}
      {success && <div className="text-[11px] text-emerald-700 flex items-center gap-1.5"><Check size={11} /> Added — first scan will run shortly.</div>}
    </div>
  );
};

const Header: React.FC<{ extensionConnected: boolean; mission: DiscoveryMission | null }> = ({ extensionConnected, mission }) => (
  <div className="bg-gray-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden shadow-2xl">
    <div className="absolute top-0 right-0 opacity-5 rotate-12 p-10"><Crosshair size={240} /></div>
    <div className="relative z-10 flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-primary/20 p-2 rounded-xl"><Crosshair className="text-primary" size={20} /></div>
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Account Finder</span>
        </div>
        <h1 className="text-4xl lg:text-5xl font-display font-bold mb-3 tracking-tight">
          Find <span className="text-primary">creators</span> in your niche
        </h1>
        <p className="opacity-60 max-w-2xl text-base leading-relaxed">
          Search X, LinkedIn and Reddit for accounts worth following and engaging with. Built to stay safe and avoid getting flagged.
        </p>
      </div>
      <div className="flex flex-col gap-2 items-end">
        <ExtensionBadge connected={extensionConnected} />
        {mission && <MissionStatusBadge status={mission.status} />}
      </div>
    </div>
  </div>
);

const ExtensionBadge: React.FC<{ connected: boolean }> = ({ connected }) => (
  <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl border backdrop-blur-md transition-all ${
    connected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
  }`}>
    <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
    <span className={`text-[10px] font-black uppercase tracking-widest ${connected ? 'text-emerald-300' : 'text-amber-300'}`}>
      {connected ? 'Connected' : 'Extension off'}
    </span>
  </div>
);

const MissionStatusBadge: React.FC<{ status: MissionStatus }> = ({ status }) => {
  const config: Record<MissionStatus, { label: string; color: string; icon: React.ReactNode }> = {
    idle: { label: 'Ready', color: 'gray', icon: <Clock size={10} /> },
    preparing: { label: 'Starting', color: 'blue', icon: <Loader2 size={10} className="animate-spin" /> },
    scanning: { label: 'Searching', color: 'purple', icon: <Activity size={10} className="animate-pulse" /> },
    paused: { label: 'Paused', color: 'amber', icon: <Pause size={10} /> },
    cooldown: { label: 'Waiting', color: 'orange', icon: <ShieldAlert size={10} /> },
    completed: { label: 'Done', color: 'emerald', icon: <Check size={10} /> },
    failed: { label: 'Failed', color: 'red', icon: <X size={10} /> },
    aborted: { label: 'Stopped', color: 'gray', icon: <StopCircle size={10} /> }
  };
  const c = config[status];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl bg-${c.color}-500/10 border border-${c.color}-500/30`}>
      {c.icon}
      <span className={`text-[9px] font-black uppercase tracking-widest text-${c.color}-300`}>{c.label}</span>
    </div>
  );
};

const ConfigurationPanel: React.FC<any> = ({
  filters, setFilters, mode, setMode, showAdvanced, setShowAdvanced,
  activeKeywordInput, setActiveKeywordInput, activeHashtagInput, setActiveHashtagInput,
  activeExcludeInput, setActiveExcludeInput,
  seedInputs, setSeedInputs, addSeed, removeSeed,
  togglePlatform, addToArray, removeFromArray,
  launchMission, extensionConnected
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* LEFT: Targeting */}
      <div className="lg:col-span-2 space-y-6">
        {/* PLATFORMS */}
        <Card title="Where to search" subtitle="Pick one or more" icon={<Globe size={18} />}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                className={`group relative p-5 rounded-2xl border-2 transition-all text-left overflow-hidden ${
                  filters.platforms.includes(p.id)
                    ? 'border-gray-900 bg-gradient-to-br ' + p.bgGradient + ' text-white shadow-lg'
                    : 'border-gray-200 bg-white hover:border-gray-400'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={filters.platforms.includes(p.id) ? 'text-white' : p.color}>{p.icon}</div>
                  {filters.platforms.includes(p.id) && <Check size={16} className="text-white" />}
                </div>
                <div className={`font-bold text-sm ${filters.platforms.includes(p.id) ? 'text-white' : 'text-gray-900'}`}>{p.label}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* KEYWORDS */}
        <Card title="What to search for" subtitle="Words that describe your niche" icon={<Hash size={18} />}>
          <ChipsInput
            label="Keywords (required)"
            placeholder="e.g. AI agents, no-code, indie hacker"
            value={activeKeywordInput}
            onChange={setActiveKeywordInput}
            chips={filters.keywords}
            onAdd={(v) => addToArray('keywords', v, () => setActiveKeywordInput(''))}
            onRemove={(v) => removeFromArray('keywords', v)}
            color="indigo"
          />
          <div className="mt-4">
            <ChipsInput
              label="Hashtags (optional)"
              placeholder="#buildinpublic"
              value={activeHashtagInput}
              onChange={setActiveHashtagInput}
              chips={filters.hashtags}
              onAdd={(v) => addToArray('hashtags', v.startsWith('#') ? v : '#' + v, () => setActiveHashtagInput(''))}
              onRemove={(v) => removeFromArray('hashtags', v)}
              color="purple"
            />
          </div>
          <div className="mt-4">
            <ChipsInput
              label="Words to avoid"
              placeholder="crypto, NFT (skip these)"
              value={activeExcludeInput}
              onChange={setActiveExcludeInput}
              chips={filters.excludeKeywords}
              onAdd={(v) => addToArray('excludeKeywords', v, () => setActiveExcludeInput(''))}
              onRemove={(v) => removeFromArray('excludeKeywords', v)}
              color="red"
            />
          </div>
        </Card>

        {/* ENGAGEMENT BAR — the headline filter under the engagement-led model */}
        <Card title="Engagement bar" subtitle="How engaged must their posts be" icon={<Heart size={18} />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {ENGAGEMENT_PRESETS.map(p => {
              const active = filters.engagementFloor === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setFilters((f: DiscoveryFilters) => ({ ...f, engagementFloor: p.id }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    active
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-gray-200 hover:border-rose-300 bg-white'
                  }`}
                >
                  <div className="font-bold text-xs">{p.label}</div>
                  <div className={`text-[10px] mt-0.5 ${active ? 'text-white/80' : 'text-gray-500'}`}>{p.tagline}</div>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-gray-500 leading-relaxed mb-4">
            {ENGAGEMENT_PRESETS.find(p => p.id === filters.engagementFloor)?.helper}
          </div>
          <div className="border-t border-gray-100 pt-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
              <CalendarClock size={12} /> Posts within
            </div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {RECENCY_PRESETS.map(r => {
                const active = filters.postRecencyDays === r.id;
                return (
                  <button
                    key={String(r.id)}
                    onClick={() => setFilters((f: DiscoveryFilters) => ({ ...f, postRecencyDays: r.id }))}
                    className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                      active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400 bg-white'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <NumberInput
              label="Audience engagement rate ≥ (%)"
              value={filters.minEngagementRate}
              onChange={(v: number | undefined) => setFilters((f: DiscoveryFilters) => ({ ...f, minEngagementRate: v }))}
              placeholder="optional — e.g. 2"
            />
          </div>
        </Card>

        {/* ADVANCED */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 hover:border-gray-300 transition-all"
        >
          <div className="flex items-center gap-3">
            <Settings2 size={18} className="text-gray-700" />
            <span className="font-bold text-sm">More filters</span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Optional</span>
          </div>
          {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showAdvanced && (
          <Card title="Refine audience" subtitle="Optional — extra knobs. Engagement leads, these are tiebreakers." icon={<Filter size={18} />}>
            <div className="space-y-5">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2 flex items-center gap-1.5">
                  <Globe size={12} /> Language
                </div>
                <TextInput
                  label=""
                  value={filters.language || ''}
                  onChange={(v: string) => setFilters((f: DiscoveryFilters) => ({ ...f, language: v }))}
                  placeholder="en, fr, es…"
                />
              </div>

              <div className="space-y-3 pt-1">
                <Toggle
                  label="Only verified accounts"
                  checked={filters.verifiedOnly}
                  onChange={(v: boolean) => setFilters((f: DiscoveryFilters) => ({ ...f, verifiedOnly: v }))}
                />
                <Toggle
                  label="Skip accounts I already track"
                  checked={filters.excludeAlreadyTracked}
                  onChange={(v: boolean) => setFilters((f: DiscoveryFilters) => ({ ...f, excludeAlreadyTracked: v }))}
                />
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* RIGHT: Mode + Launch */}
      <div className="space-y-6">
        <Card title="Search type" subtitle="Pick your strategy" icon={<Brain size={18} />}>
          <div className="space-y-3">
            {(Object.keys(MODE_CONFIG) as DiscoveryMode[]).map(m => {
              const c = MODE_CONFIG[m];
              const active = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                    active
                      ? `border-${c.color}-500 bg-${c.color}-50`
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={active ? `text-${c.color}-600` : 'text-gray-500'}>{c.icon}</div>
                      <span className="font-bold text-sm">{c.label}</span>
                    </div>
                    {active && <Check size={16} className={`text-${c.color}-600`} />}
                  </div>
                  <div className="text-xs text-gray-600 leading-relaxed mb-2">{c.description}</div>
                  <div className={`text-[10px] uppercase tracking-wider font-black ${active ? `text-${c.color}-700` : 'text-gray-400'}`}>{c.budget}</div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* TRACKED ACCOUNTS POLLING SETTINGS */}
        <TrackingSettingsCard />

        {/* LAUNCH */}
        <CampaignLauncher
          onOneShot={launchMission}
          filters={filters}
          mode={mode}
          disabled={!filters.platforms.length || !filters.keywords.length}
        />
        {(!filters.platforms.length || !filters.keywords.length) && (
          <div className="text-[10px] text-gray-500 text-center font-bold uppercase tracking-wider">
            Pick a platform and add keywords to start
          </div>
        )}
        {!extensionConnected && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="text-[10px] text-amber-800 leading-relaxed">
              <span className="font-bold">Extension not installed.</span> Install the Answerly extension to search real accounts.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const LiveMissionConsole: React.FC<{ mission: DiscoveryMission; onPause: () => void; onResume: () => void; onAbort: () => void }> = ({
  mission, onPause, onResume, onAbort
}) => {
  const progressPct = mission.progress.totalQueriesPlanned > 0
    ? Math.round((mission.progress.queriesCompleted / mission.progress.totalQueriesPlanned) * 100)
    : 0;
  const timeElapsed = mission.startedAt ? Math.floor((Date.now() - new Date(mission.startedAt).getTime()) / 1000) : 0;
  const minutes = Math.floor(timeElapsed / 60);
  const seconds = timeElapsed % 60;

  return (
    <div className="space-y-4">
      {/* Top Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Doing" value={mission.progress.phase || 'Waiting'} icon={<Activity size={16} />} primary />
        <StatCard label="Looked at" value={mission.progress.candidatesScanned.toString()} icon={<FileSearch size={16} />} />
        <StatCard label="Found" value={mission.progress.matched.toString()} icon={<Target size={16} />} accent />
        <StatCard label="Skipped" value={mission.progress.rejected.toString()} icon={<X size={16} />} />
        <StatCard label="Time" value={`${minutes}:${seconds.toString().padStart(2, '0')}`} icon={<Clock size={16} />} />
      </div>

      {/* Progress Bar */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-xl"><Loader2 size={16} className="text-primary animate-spin" /></div>
            <div>
              <div className="font-bold text-sm">Searching "{mission.name}"</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">{mission.mode} · {mission.filters.platforms.join(' + ')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mission.status === 'paused' ? (
              <button onClick={onResume} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-emerald-700">
                <Play size={14} /> Resume
              </button>
            ) : (
              <button onClick={onPause} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-amber-600">
                <Pause size={14} /> Pause
              </button>
            )}
            <button onClick={onAbort} className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-red-100">
              <StopCircle size={14} /> Stop
            </button>
          </div>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">
          <span>{mission.progress.queriesCompleted} / {mission.progress.totalQueriesPlanned} searches done</span>
          <span>{progressPct}%</span>
        </div>
      </div>

      {/* Anti-Bot Defense Panel + Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StealthPanel stealth={mission.stealth} status={mission.status} />
        <div className="lg:col-span-2 bg-gray-950 rounded-3xl p-5 border border-gray-800 max-h-[500px] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Live Activity</span>
            </div>
            <div className="text-[10px] text-gray-500 font-mono">{mission.logs.length} events</div>
          </div>
          <div className="flex-1 overflow-y-auto font-mono text-[11px] space-y-1 pr-2">
            {mission.logs.slice(-100).map((log, idx) => (
              <LogLine key={idx} log={log} />
            ))}
            {mission.logs.length === 0 && (
              <div className="text-gray-600 italic">Waiting for the search to start...</div>
            )}
            <div ref={(el) => { if (el) el.scrollIntoView(); }} />
          </div>
        </div>
      </div>
    </div>
  );
};

const StealthPanel: React.FC<{ stealth: StealthState; status: MissionStatus }> = ({ stealth, status }) => {
  const score = stealth.humanizedBehaviorScore;
  const scoreColor = score > 80 ? 'emerald' : score > 60 ? 'amber' : 'red';
  return (
    <div className={`bg-gradient-to-br ${stealth.detected ? 'from-red-900 to-red-950' : 'from-gray-900 to-gray-950'} rounded-3xl p-5 border ${stealth.detected ? 'border-red-700' : 'border-gray-800'} text-white`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {stealth.detected ? <ShieldOff size={16} className="text-red-400" /> : <ShieldCheck size={16} className="text-emerald-400" />}
          <span className="text-[10px] font-black uppercase tracking-widest">{stealth.detected ? 'Risk detected' : 'Account safe'}</span>
        </div>
      </div>
      <div className="text-center mb-4">
        <div className={`text-5xl font-display font-bold text-${scoreColor}-400`}>{score}</div>
        <div className="text-[9px] uppercase tracking-widest text-gray-400 mt-1">Safety score</div>
      </div>
      <div className="space-y-2 text-[11px]">
        <StealthMetric label="Actions per minute" value={`${stealth.actionsThisMinute} / ${stealth.rateLimit}`} />
        <StealthMetric label="Total actions" value={stealth.actionsThisSession.toString()} />
        <StealthMetric label="Next action in" value={stealth.nextActionInMs > 0 ? `${(stealth.nextActionInMs / 1000).toFixed(1)}s` : 'now'} />
        {stealth.cooldownUntil && stealth.cooldownUntil > Date.now() && (
          <StealthMetric label="Resting for" value={`${Math.ceil((stealth.cooldownUntil - Date.now()) / 1000)}s`} alert />
        )}
      </div>
      {stealth.patternsDetected.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-[9px] uppercase tracking-widest text-amber-400 font-bold mb-2">Patterns Detected</div>
          {stealth.patternsDetected.map((p, i) => (
            <div key={i} className="text-[10px] text-amber-200">• {p}</div>
          ))}
        </div>
      )}
      {stealth.detected && stealth.detectionReason && (
        <div className="mt-4 pt-4 border-t border-red-700/50">
          <div className="text-[9px] uppercase tracking-widest text-red-300 font-bold mb-2">Reason</div>
          <div className="text-[10px] text-red-200">{stealth.detectionReason}</div>
        </div>
      )}
    </div>
  );
};

const StealthMetric: React.FC<{ label: string; value: string; alert?: boolean }> = ({ label, value, alert }) => (
  <div className="flex justify-between items-center">
    <span className="text-gray-400">{label}</span>
    <span className={`font-bold font-mono ${alert ? 'text-amber-300' : 'text-white'}`}>{value}</span>
  </div>
);

const LogLine: React.FC<{ log: MissionLog }> = ({ log }) => {
  const colors = {
    info: 'text-gray-300',
    success: 'text-emerald-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
    stealth: 'text-purple-400'
  };
  const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
  return (
    <div className="flex gap-2">
      <span className="text-gray-600 flex-shrink-0">[{time}]</span>
      {log.platform && <span className="text-blue-400 flex-shrink-0">[{log.platform}]</span>}
      <span className={colors[log.level]}>{log.message}</span>
    </div>
  );
};

const CompletedMissionBanner: React.FC<{ mission: DiscoveryMission; onDismiss: () => void }> = ({ mission, onDismiss }) => {
  const isSuccess = mission.status === 'completed';
  return (
    <div className={`p-6 rounded-3xl border-2 ${
      isSuccess ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
    } flex items-center justify-between gap-4`}>
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-2xl ${isSuccess ? 'bg-emerald-500' : 'bg-amber-500'} text-white`}>
          {isSuccess ? <Check size={24} /> : <AlertTriangle size={24} />}
        </div>
        <div>
          <div className="font-bold text-base">
            Search {mission.status === 'completed' ? 'finished' : mission.status === 'aborted' ? 'stopped' : 'failed'}
          </div>
          <div className="text-sm text-gray-600">
            <span className="font-bold">{mission.results.length}</span> accounts found ·
            <span className="font-bold ml-1">{mission.progress.queriesCompleted}</span> searches done
          </div>
        </div>
      </div>
      <button onClick={onDismiss} className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50">
        Close
      </button>
    </div>
  );
};

const ResultsPanel: React.FC<{
  results: DiscoveredAccount[];
  totalCount: number;
  resultFilter: any;
  setResultFilter: any;
  resultSort: any;
  setResultSort: any;
  onTrack: (a: DiscoveredAccount) => void;
  onDismiss: (a: DiscoveredAccount) => void;
  onUntrack: (a: DiscoveredAccount) => void;
  onInspect: (a: DiscoveredAccount) => void;
  onTrackBatch: (accounts: DiscoveredAccount[]) => void;
  autoReplyByUrl: Map<string, boolean>;
  onToggleAutoReply: (a: DiscoveredAccount, enabled: boolean) => void;
  onRefreshAccount: (a: DiscoveredAccount) => void;
}> = ({ results, totalCount, resultFilter, setResultFilter, resultSort, setResultSort, onTrack, onDismiss, onUntrack, onInspect, onTrackBatch, autoReplyByUrl, onToggleAutoReply, onRefreshAccount }) => {
  const tierCounts = useMemo(() => ({
    S: results.filter(r => r.tier === 'S').length,
    A: results.filter(r => r.tier === 'A').length,
    B: results.filter(r => r.tier === 'B').length,
    C: results.filter(r => r.tier === 'C').length
  }), [results]);

  return (
    <div className="bg-white rounded-[2rem] border border-gray-100 p-8 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="bg-gray-900 p-2 rounded-xl"><Users size={18} className="text-white" /></div>
          <div>
            <h2 className="font-bold text-lg">Accounts found</h2>
            <p className="text-xs text-gray-500">{totalCount} total · {results.length} shown</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTrackBatch(results.filter(r => r.trackingStatus === 'untracked').slice(0, 10))}
            className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-gray-800"
          >
            <Radar size={14} /> Track top 10
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <FilterChip active={resultFilter === 'all'} onClick={() => setResultFilter('all')} label="All" count={results.length} />
        <FilterChip active={resultFilter === 'untracked'} onClick={() => setResultFilter('untracked')} label="Not tracked" />
        <FilterChip active={resultFilter === 'S'} onClick={() => setResultFilter('S')} label="Best" count={tierCounts.S} color="purple" />
        <FilterChip active={resultFilter === 'A'} onClick={() => setResultFilter('A')} label="Great" count={tierCounts.A} color="indigo" />
        <FilterChip active={resultFilter === 'B'} onClick={() => setResultFilter('B')} label="Good" count={tierCounts.B} color="blue" />
        <FilterChip active={resultFilter === 'C'} onClick={() => setResultFilter('C')} label="Maybe" count={tierCounts.C} color="gray" />
        <div className="ml-auto">
          <select
            value={resultSort}
            onChange={(e) => setResultSort(e.target.value as typeof resultSort)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
          >
            <option value="score">Sort: Best match</option>
            <option value="influence">Sort: Influence</option>
            <option value="engagement">Sort: Engagement</option>
            <option value="lastpost">Sort: Most recently active</option>
            <option value="recent">Sort: Newest discovery</option>
          </select>
        </div>
      </div>

      {/* Results List — table-style rows, all columns aligned. Replaces the card grid. */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {/* Sticky column header — labels every numeric KPI and the action column. */}
        <div className="hidden md:grid sticky top-0 z-10 bg-gray-50 border-b border-gray-200 text-[9px] font-bold uppercase tracking-widest text-gray-500"
             style={{ gridTemplateColumns: '1fr 130px 110px 400px', columnGap: '0px' }}>
          <div className="px-4 py-2.5">Account</div>
          <div className="px-3 py-2.5 text-center">Match</div>
          <div className="px-3 py-2.5 text-center" title="Influence = engagement-per-post (50%) + niche match (30%) + reach authority (20%). Higher = more impact when they engage with you.">
            Influence
          </div>
          <div className="px-3 py-2.5 text-center">Actions</div>
        </div>
        <ul className="divide-y divide-gray-100">
          {results.map(account => (
            <AccountRow
              key={account.id}
              account={account}
              onTrack={() => onTrack(account)}
              onDismiss={() => onDismiss(account)}
              onUntrack={() => onUntrack(account)}
              onInspect={() => onInspect(account)}
              autoReply={!!autoReplyByUrl.get(account.url)}
              onToggleAutoReply={(en) => onToggleAutoReply(account, en)}
              onRefresh={() => onRefreshAccount(account)}
            />
          ))}
        </ul>
      </div>
      {/* End of row-list. (AccountCard component remains defined below as a one-line revert path.) */}

      {results.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <FileSearch size={32} className="mx-auto mb-3 opacity-40" />
          <div className="text-sm font-bold">No accounts match this filter</div>
        </div>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// AccountRow — single-line row form, all KPIs aligned, all four
// original action buttons restored (Track / Skip / Inspect / Open profile).
// Tracked rows get an emerald background tint so they stand out from
// the long list of untracked discoveries. Replaces the card grid as
// the default view of the results.
// ────────────────────────────────────────────────────────────────────
const AccountRow: React.FC<{
  account: DiscoveredAccount;
  onTrack: () => void;
  onDismiss: () => void;
  onUntrack: () => void;
  onInspect: () => void;
  autoReply: boolean;
  onToggleAutoReply: (enabled: boolean) => void;
  onRefresh: () => void;
}> = ({ account, onTrack, onDismiss, onUntrack, onInspect, autoReply, onToggleAutoReply, onRefresh }) => {
  const tierConfig: Record<AccountTier, { gradient: string }> = {
    S: { gradient: 'from-purple-500 to-pink-500' },
    A: { gradient: 'from-indigo-500 to-blue-500' },
    B: { gradient: 'from-blue-500 to-cyan-500' },
    C: { gradient: 'from-gray-500 to-gray-600' }
  };
  const tc = tierConfig[account.tier];
  const platformIcon = account.platform === 'X' ? <Twitter size={11} /> :
                       account.platform === 'LinkedIn' ? <Linkedin size={11} /> :
                       <MessageCircle size={11} />;

  const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : (n || 0).toString();

  const isTracked = account.trackingStatus === 'tracking';
  const isDismissed = account.trackingStatus === 'dismissed';
  const isPreliminary = account.verificationStatus === 'preliminary';
  const isIncomplete = account.verificationStatus === 'incomplete';

  // Match strength — 1 to 3 fires, or empty for low match.
  const fires =
    account.finalScore >= 85 ? '🔥🔥🔥' :
    account.finalScore >= 65 ? '🔥🔥' :
    account.finalScore >= 45 ? '🔥' :
    '';
  const fireLabel =
    account.finalScore >= 85 ? 'Top match' :
    account.finalScore >= 65 ? 'Strong match' :
    account.finalScore >= 45 ? 'Decent match' :
    'Low match';

  const rowBg =
    isTracked    ? 'bg-emerald-50/70 hover:bg-emerald-50' :
    isDismissed  ? 'bg-gray-50 opacity-60' :
                   'bg-white hover:bg-gray-50';

  return (
    <li className={`group relative transition-colors ${rowBg}`}>
      {/* Tracked accent stripe on the left edge so the eye finds tracked rows at a glance */}
      {isTracked && <span className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></span>}

      {/* Mobile layout: stacked. Desktop: 4-column grid that lines up with the sticky header. */}
      <div className="md:grid md:items-center md:gap-0 flex flex-col"
           style={{ gridTemplateColumns: '1fr 130px 110px 400px' }}>

        {/* ── Identity column ── */}
        <div className="px-4 py-3 flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 bg-gradient-to-br ${tc.gradient}`}>
            {account.avatar
              ? <img src={account.avatar} alt={account.handle} className="w-full h-full rounded-xl object-cover" />
              : (account.displayName?.[0] || account.handle[0] || '?').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-sm text-gray-900 truncate">{account.displayName || account.handle}</span>
              {account.verified && <Verified size={11} className="text-blue-500 flex-shrink-0" />}
              {isTracked && (
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">Tracking</span>
              )}
              {isPreliminary && (
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-1"
                      title="Score from search card only — will refine after profile visit">
                  <Loader2 size={8} className="animate-spin" /> Preliminary
                </span>
              )}
              {isIncomplete && (
                <span className="text-[9px] font-black uppercase tracking-widest text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded"
                      title="Visited profile but post data was unreadable">Incomplete</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5">
              <span className="flex items-center gap-1">{platformIcon}@{account.handle}</span>
              <span className={`text-[9px] font-black tracking-widest px-1 rounded ${
                account.tier === 'S' ? 'text-purple-600' :
                account.tier === 'A' ? 'text-indigo-600' :
                account.tier === 'B' ? 'text-blue-600' :
                'text-gray-500'
              }`}>· {account.tier}</span>
            </div>
          </div>
        </div>

        {/* ── Match strength ── */}
        <div className="px-3 py-2 md:py-3 flex md:flex-col items-center md:items-center justify-between md:justify-center gap-2 md:gap-0.5">
          <span className="md:hidden text-[9px] uppercase tracking-widest font-bold text-gray-400">Match</span>
          <div className="flex flex-col items-center">
            <div className="text-base leading-none">{fires || <span className="text-gray-300">·</span>}</div>
            <div className={`text-[9px] uppercase tracking-widest font-bold mt-0.5 ${
              account.finalScore >= 85 ? 'text-rose-600' :
              account.finalScore >= 65 ? 'text-orange-600' :
              account.finalScore >= 45 ? 'text-amber-600' :
              'text-gray-400'
            }`}>{fireLabel}</div>
          </div>
        </div>

        {/* ── Influence ── composite signal of audience pull */}
        <div className="px-3 py-2 md:py-3 flex md:flex-col items-center md:items-center justify-between md:justify-center gap-2 md:gap-0.5">
          <span className="md:hidden text-[9px] uppercase tracking-widest font-bold text-gray-400">Influence</span>
          {(() => {
            const inf = computeInfluence(account);
            const meta = influenceLabel(inf);
            return (
              <div className="flex flex-col items-center" title={`Influence ${inf}/100 — engagement-per-post (50%) + niche match (30%) + reach authority (20%)`}>
                <div className={`text-sm font-black tabular-nums ${meta.tone}`}>{inf}</div>
                <div className={`text-[9px] uppercase tracking-widest font-bold ${meta.tone}`}>{meta.label}</div>
              </div>
            );
          })()}
        </div>

        {/* ── Actions ── pixel-aligned across all states.
            Desktop layout is a fixed 4-cell grid:
              [primary 100px][gap][inspect 28px][gap][open 28px]
            The "primary" cell is the same width whether the row shows
            "Track + Skip" (untracked) or "Tracking" (tracked) — so the
            right edge of every row's Inspect/Open icons lines up
            perfectly down the column. */}
        <div className="px-3 py-2 md:py-2.5 flex items-center justify-end gap-1.5 flex-wrap md:flex-nowrap">
          <div className="flex items-center gap-1.5 w-full md:w-auto">
            {isTracked ? (
              <>
              <button
                onClick={() => onToggleAutoReply(!autoReply)}
                className={`h-9 px-3.5 rounded-lg text-[11px] font-black uppercase tracking-wide flex items-center justify-center gap-1.5 border-2 transition-all whitespace-nowrap shadow-sm ${
                  autoReply
                    ? 'bg-violet-600 text-white border-violet-700 hover:bg-violet-700 shadow-violet-300/40'
                    : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 hover:border-violet-400'
                }`}
                title={autoReply ? 'Auto-reply ON — drafts a reply for each new post (you approve before posting). Click to turn off.' : 'Auto-reply OFF — click to draft replies for this account\'s new posts'}
              >
                <Sparkles size={13} className="flex-shrink-0" />
                <span>Auto-reply</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${autoReply ? 'bg-white/25 text-white' : 'bg-violet-200/70 text-violet-800'}`}>
                  {autoReply ? 'ON' : 'OFF'}
                </span>
              </button>
              <button
                onClick={onUntrack}
                className="group/untrack h-8 px-3 bg-emerald-600 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-rose-600 transition-colors whitespace-nowrap"
                title="Stop tracking this account"
              >
                <CheckCircle2 size={12} className="group-hover/untrack:hidden flex-shrink-0" />
                <X size={12} className="hidden group-hover/untrack:inline flex-shrink-0" />
                <span className="group-hover/untrack:hidden">Tracking</span>
                <span className="hidden group-hover/untrack:inline">Untrack</span>
              </button>
              </>
            ) : isDismissed ? (
              <button
                onClick={onTrack}
                className="flex-1 md:w-[100px] h-8 px-2 bg-gray-100 text-gray-500 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 hover:bg-gray-200 transition-colors"
                title="Restore (track this account)"
              >
                <Radar size={12} /> Skipped
              </button>
            ) : (
              <>
                <button
                  onClick={onTrack}
                  className="flex-1 md:w-[68px] h-8 px-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-colors"
                  title="Watch this account for new posts"
                >
                  <Radar size={12} /> Track
                </button>
                <button
                  onClick={onDismiss}
                  className="w-[28px] h-8 flex-shrink-0 bg-white border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center justify-center"
                  title="Skip"
                  aria-label="Skip"
                >
                  <X size={13} />
                </button>
              </>
            )}
          </div>
          <button
            onClick={onRefresh}
            className={`w-[28px] h-8 flex-shrink-0 bg-white border rounded-lg transition-colors flex items-center justify-center ${
              (!account.followers || account.followers === 0)
                ? 'border-amber-300 text-amber-600 hover:bg-amber-50'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
            title={(!account.followers || account.followers === 0)
              ? "Followers missing — click to re-fetch metrics (log in to the platform in this browser first if it's behind a login wall)"
              : "Refresh metrics (followers, verified, name)"}
            aria-label="Refresh metrics"
          >
            <RotateCw size={13} />
          </button>
          <button
            onClick={onInspect}
            className="w-[28px] h-8 flex-shrink-0 bg-white border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center justify-center"
            title="Inspect details"
            aria-label="Inspect"
          >
            <Eye size={13} />
          </button>
          <a
            href={account.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-[28px] h-8 flex-shrink-0 bg-white border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center justify-center"
            title="Open profile in new tab"
            aria-label="Open profile"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </li>
  );
};

const AccountCard: React.FC<{
  account: DiscoveredAccount;
  onTrack: () => void;
  onDismiss: () => void;
  onInspect: () => void;
}> = ({ account, onTrack, onDismiss, onInspect }) => {
  const tierConfig: Record<AccountTier, { color: string; gradient: string }> = {
    S: { color: 'purple', gradient: 'from-purple-500 to-pink-500' },
    A: { color: 'indigo', gradient: 'from-indigo-500 to-blue-500' },
    B: { color: 'blue', gradient: 'from-blue-500 to-cyan-500' },
    C: { color: 'gray', gradient: 'from-gray-500 to-gray-600' }
  };
  const tc = tierConfig[account.tier];
  const platformIcon = account.platform === 'X' ? <Twitter size={12} /> :
                       account.platform === 'LinkedIn' ? <Linkedin size={12} /> :
                       <MessageCircle size={12} />;

  const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toString();

  const isTracked = account.trackingStatus === 'tracking';
  const isDismissed = account.trackingStatus === 'dismissed';
  const isPreliminary = account.verificationStatus === 'preliminary';
  const isIncomplete = account.verificationStatus === 'incomplete';
  const hasMismatch = (account.filterMismatchReasons?.length || 0) > 0;

  // ── MATCH STRENGTH (fire emoji + label) ────────────────────────
  // Replaces the numeric "Score" KPI. Fire count scales with match strength
  // so users see relative quality at a glance without having to interpret
  // an arbitrary 0-100 number. Below 45 we drop fire entirely so weak
  // matches are clearly differentiated from strong ones.
  const matchStrength =
    account.finalScore >= 85 ? { fires: '🔥🔥🔥', label: 'Top match',  tone: 'text-rose-600' } :
    account.finalScore >= 65 ? { fires: '🔥🔥',   label: 'Strong match', tone: 'text-orange-600' } :
    account.finalScore >= 45 ? { fires: '🔥',     label: 'Decent match', tone: 'text-amber-600' } :
                                { fires: '',       label: 'Low match',    tone: 'text-gray-400' };

  // Card surface: tracked accounts get a solid emerald fill so they pop
  // out of a long list. Dismissed accounts fade. Untracked stays clean white.
  const surfaceClass = isTracked
    ? 'bg-emerald-50 border-emerald-500 shadow-lg shadow-emerald-200/50 ring-2 ring-emerald-300/60'
    : isDismissed
      ? 'bg-gray-50 border-gray-100 opacity-50'
      : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-md';

  return (
    <div className={`relative p-5 rounded-2xl border-2 transition-all overflow-hidden flex flex-col ${surfaceClass}`}>
      {/* TRACKED — animated radar pulse on top edge */}
      {isTracked && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-pulse"></div>
        </div>
      )}

      {/* TOP BAR — tier (left) + verification status (right). Symmetric. */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          {isTracked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
              Tracking
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-lg bg-gradient-to-br ${tc.gradient} text-white text-[10px] font-black tracking-widest`}>
            {account.tier}
          </span>
        </div>

        {(isPreliminary || isIncomplete) && !isTracked && (
          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${
            isPreliminary ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-orange-100 text-orange-800 border border-orange-200'
          }`}
            title={isPreliminary ? 'Score from search card only — will refine after profile visit' : 'Visited profile but post data was unreadable'}
          >
            {isPreliminary ? <Loader2 size={9} className="animate-spin" /> : null}
            {isPreliminary ? 'Preliminary' : 'Incomplete'}
          </span>
        )}
      </div>

      {/* IDENTITY — avatar + name + handle. No bio (removed per redesign). */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`relative w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0 bg-gradient-to-br ${tc.gradient} ${isTracked ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-emerald-50' : ''}`}>
          {account.avatar
            ? <img src={account.avatar} alt={account.handle} className="w-full h-full rounded-2xl object-cover" />
            : (account.displayName?.[0] || account.handle[0]).toUpperCase()}
          {isTracked && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
              <Eye size={9} className="text-white" strokeWidth={3} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-bold text-sm truncate">{account.displayName || account.handle}</h3>
            {account.verified && <Verified size={12} className="text-blue-500 flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-0.5">
            {platformIcon}
            <span className="truncate">@{account.handle}</span>
          </div>
        </div>
      </div>

      {/* KPI GRID — 2x2 symmetric. Match strength is featured (full row). */}
      <div className="mb-4 p-4 bg-gray-50 rounded-xl space-y-3">
        {/* Match strength — the headline KPI, replaces numeric score */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-200">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-gray-500 font-bold mb-0.5">Match strength</div>
            <div className={`text-sm font-black ${matchStrength.tone}`}>{matchStrength.label}</div>
          </div>
          <div className="text-2xl leading-none" aria-label={`${matchStrength.label}, ${matchStrength.fires.length / 2} out of 3`}>
            {matchStrength.fires || <span className="text-gray-300">·</span>}
          </div>
        </div>
        {/* numeric KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <KpiCell label="Influence" value={`${computeInfluence(account)}/100`} />
          <KpiCell label="Engagement" value={`${account.engagementRate?.toFixed(1) || '—'}%`} />
        </div>
      </div>

      {/* Filter mismatch — informational, not exclusionary */}
      {hasMismatch && !isPreliminary && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-800"
          title={account.filterMismatchReasons?.join(' · ')}
        >
          <span className="font-bold">Doesn't match all filters:</span> {account.filterMismatchReasons!.slice(0, 2).join(', ')}
          {(account.filterMismatchReasons?.length || 0) > 2 ? ` +${account.filterMismatchReasons!.length - 2}` : ''}
        </div>
      )}

      {/* Spacer pushes actions to the bottom so cards of different heights still align action rows */}
      <div className="flex-1" />

      {/* ACTIONS — three equal-width buttons. Same height, same paddings. */}
      <div className="grid grid-cols-3 gap-2 mt-1">
        {isTracked ? (
          <div className="col-span-2 h-10 px-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-200">
            <Radar size={14} className="animate-pulse" /> Tracking
          </div>
        ) : isDismissed ? (
          <div className="col-span-2 h-10 px-3 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
            <X size={14} /> Skipped
          </div>
        ) : (
          <>
            <button
              onClick={onTrack}
              className="h-10 px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              title="Watch this account for new posts. They'll show up in the Pipeline."
            >
              <Radar size={14} /> Track
            </button>
            <button
              onClick={onDismiss}
              className="h-10 px-3 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 hover:border-gray-300 flex items-center justify-center gap-1.5 transition-colors"
              title="Skip"
            >
              <X size={14} /> Skip
            </button>
          </>
        )}
        <button
          onClick={onInspect}
          className="h-10 px-3 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 hover:border-gray-300 flex items-center justify-center gap-1.5 transition-colors"
          title="Inspect details"
        >
          <Eye size={14} /> Details
        </button>
      </div>
    </div>
  );
};

// Symmetric KPI cell used inside the AccountCard grid. Fixed height keeps
// rows aligned across cards even when one value is "—".
const KpiCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col justify-center h-12">
    <div className="text-[9px] uppercase tracking-widest text-gray-500 font-bold leading-none mb-1">{label}</div>
    <div className="text-sm font-bold text-gray-900 leading-tight truncate">{value}</div>
  </div>
);

const InspectModal: React.FC<{
  account: DiscoveredAccount;
  onClose: () => void;
  onTrack: () => void;
  onDismiss: () => void;
}> = ({ account, onClose, onTrack, onDismiss }) => (
  <div
    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-8">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-2xl`}>
              {account.avatar
                ? <img src={account.avatar} className="w-full h-full rounded-2xl object-cover" />
                : (account.displayName?.[0] || account.handle[0]).toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                {account.displayName || account.handle}
                {account.verified && <Verified size={18} className="text-blue-500" />}
              </h2>
              <div className="text-sm text-gray-500">@{account.handle} · {account.platform}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
            <X size={20} />
          </button>
        </div>

        {account.bio && (
          <div className="mb-6 p-4 bg-gray-50 rounded-2xl">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Bio</div>
            <p className="text-sm leading-relaxed">{account.bio}</p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <BigStat label="Influence" value={`${computeInfluence(account)}/100`} />
          <BigStat label="Engagement" value={`${account.engagementRate?.toFixed(2) || '—'}%`} />
          <BigStat label="Reach score" value={`${account.authorityScore}/100`} />
          <BigStat label="Topic match" value={`${account.nicheMatch}/100`} />
        </div>

        {/* Influence explainer — surfaced in the modal so the score isn't a black box */}
        <div className="mb-6 p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl text-[11px] text-indigo-900 leading-relaxed">
          <span className="font-bold uppercase tracking-widest text-[9px] text-indigo-700">What is Influence?</span>
          <p className="mt-1">A composite signal of real audience pull. We weight engagement-per-post the heaviest (50%), then how well their content matches your niche (30%), then reach authority (20%). A high score means their attention actually moves the needle for you — not just a big follower number.</p>
        </div>

        {/* LinkedIn post signals — surface in the inspector so the user can judge cadence */}
        {account.platform === 'LinkedIn' && typeof account.recentPostCount === 'number' && (
          <div className="grid grid-cols-1 gap-3 mb-6">
            <BigStat
              label="Posts last 7d"
              value={`${account.recentPostCount}`}
            />
          </div>
        )}

        {/* Filter mismatch reasons — non-blocking, informational */}
        {(account.filterMismatchReasons?.length || 0) > 0 && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
            <div className="text-[10px] uppercase tracking-widest text-amber-800 font-bold mb-2">Doesn't match all your filters</div>
            <ul className="space-y-1">
              {account.filterMismatchReasons!.map((r, i) => (
                <li key={i} className="text-sm text-amber-900 flex items-start gap-2">
                  <span className="text-amber-600 mt-0.5">·</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {account.verificationStatus === 'preliminary' && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-900 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Preliminary score from search results. Will refine once we visit the profile.
          </div>
        )}

        {account.topTopics && account.topTopics.length > 0 && (
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Top Topics</div>
            <div className="flex flex-wrap gap-2">
              {account.topTopics.map((t, i) => (
                <span key={i} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {account.matchedSignals.length > 0 && (
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Why This Account</div>
            <ul className="space-y-1">
              {account.matchedSignals.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <Check size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {account.sampleHooks && account.sampleHooks.length > 0 && (
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Recent Post Hooks</div>
            <div className="space-y-2">
              {account.sampleHooks.map((h, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-xl text-xs leading-relaxed border border-gray-100">
                  "{h}"
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
          <a
            href={account.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          >
            <ExternalLink size={14} /> Open Profile
          </a>
          {account.trackingStatus !== 'tracking' && (
            <>
              <button
                onClick={onDismiss}
                className="px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50"
              >
                Dismiss
              </button>
              <button
                onClick={onTrack}
                className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-gray-800"
              >
                <Radar size={14} /> Track this account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  </div>
);

const EmptyState: React.FC = () => (
  <div className="bg-white p-16 rounded-[2rem] border border-gray-100 text-center">
    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
      <Crosshair size={32} className="text-gray-400" />
    </div>
    <h3 className="font-bold text-lg mb-2">No accounts yet</h3>
    <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
      Describe your niche above and tap <b>Find accounts</b>. The AI will suggest real accounts to follow with high engagement in your space.
    </p>
  </div>
);

// ============================================================
// MICRO COMPONENTS
// ============================================================

// ────────────────────────────────────────────────────────────────────
// FEED WATCHER SECTION (standalone)
// Independent automation — opt-in per platform. Polls the user's home feeds
// on a timer (extension-side), and the AI scoring runs inside the service
// worker so it works even when the panel is closed.
// ────────────────────────────────────────────────────────────────────
const Card: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, icon, children }) => (
  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
      {icon && <div className="bg-gray-100 p-2 rounded-xl">{icon}</div>}
      <div>
        <div className="font-bold text-sm">{title}</div>
        {subtitle && <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">{subtitle}</div>}
      </div>
    </div>
    {children}
  </div>
);

const ChipsInput: React.FC<{
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; chips: string[];
  onAdd: (v: string) => void; onRemove: (v: string) => void;
  color?: string;
}> = ({ label, placeholder, value, onChange, chips, onAdd, onRemove, color = 'gray' }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">{label}</div>
    <div className="flex gap-2 mb-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(value); } }}
        placeholder={placeholder}
        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:border-gray-900 focus:outline-none"
      />
      <button
        onClick={() => onAdd(value)}
        className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-gray-800"
      >
        <Plus size={14} /> Add
      </button>
    </div>
    {chips.length > 0 && (
      <div className="flex flex-wrap gap-1.5">
        {chips.map(c => (
          <span key={c} className={`group px-3 py-1.5 rounded-lg bg-${color}-50 text-${color}-700 border border-${color}-100 text-xs font-bold flex items-center gap-1.5`}>
            {c}
            <button onClick={() => onRemove(c)} className="opacity-50 group-hover:opacity-100 transition-opacity">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
    )}
  </div>
);

const NumberInput: React.FC<{ label: string; value?: number; onChange: (v: number | undefined) => void; placeholder?: string }> = ({
  label, value, onChange, placeholder
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">{label}</div>
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      placeholder={placeholder}
      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:border-gray-900 focus:outline-none"
    />
  </div>
);

const TextInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({
  label, value, onChange, placeholder
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">{label}</div>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:border-gray-900 focus:outline-none"
    />
  </div>
);

const SelectInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }> = ({
  label, value, onChange, options
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">{label}</div>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:border-gray-900 focus:outline-none"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-gray-200 cursor-pointer">
    <span className="text-sm font-bold">{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="toggle toggle-sm"
    />
  </label>
);

const StealthLayerItem: React.FC<{ label: string; enabled: boolean }> = ({ label, enabled }) => (
  <div className="flex items-center justify-between p-2 rounded-lg">
    <span className="text-xs">{label}</span>
    <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-gray-300'}`} />
  </div>
);

const StatCard: React.FC<{ label: string; value: string; icon?: React.ReactNode; primary?: boolean; accent?: boolean }> = ({
  label, value, icon, primary, accent
}) => (
  <div className={`p-4 rounded-2xl border ${
    primary ? 'bg-gray-900 border-gray-900 text-white' :
    accent ? 'bg-emerald-50 border-emerald-200' :
    'bg-white border-gray-100'
  }`}>
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <span className={`text-[9px] uppercase tracking-widest font-bold ${primary ? 'text-white/60' : accent ? 'text-emerald-700' : 'text-gray-500'}`}>{label}</span>
    </div>
    <div className={`font-display font-bold text-base truncate ${accent ? 'text-emerald-700' : ''}`}>{value}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className="text-center">
    <div className={`font-bold text-sm ${highlight ? 'text-indigo-600' : ''}`}>{value}</div>
    <div className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mt-0.5">{label}</div>
  </div>
);

const BigStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-4 bg-gray-50 rounded-2xl text-center">
    <div className="font-display font-bold text-xl">{value}</div>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mt-1">{label}</div>
  </div>
);

const FilterChip: React.FC<{ active: boolean; onClick: () => void; label: string; count?: number; color?: string }> = ({
  active, onClick, label, count, color = 'gray'
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
      active ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 hover:border-gray-300'
    }`}
  >
    {label}
    {count !== undefined && (
      <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/20' : 'bg-gray-100'}`}>
        {count}
      </span>
    )}
  </button>
);

// ============================================================
// CAMPAIGN LAUNCHER
// ============================================================
const CampaignLauncher: React.FC<{
  onOneShot: () => void;
  filters: DiscoveryFilters;
  mode: DiscoveryMode;
  disabled: boolean;
}> = ({ onOneShot, filters, mode, disabled }) => {
  const [campaignMode, setCampaignMode] = useState(false);
  const [intervalHours, setIntervalHours] = useState(4);
  const [durationDays, setDurationDays] = useState(7);
  const [campaigns, setCampaigns] = useState<Record<string, DiscoveryCampaign>>({});

  useEffect(() => {
    const handler = (e: any) => setCampaigns(e.detail || {});
    window.addEventListener('discovery_campaigns_update', handler);
    return () => window.removeEventListener('discovery_campaigns_update', handler);
  }, []);

  const launchCampaign = () => {
    if (!filters.platforms.length || !filters.keywords.length) {
      alert('Add at least one platform and one keyword.');
      return;
    }
    const config = {
      id: `camp_${Date.now()}`,
      name: filters.keywords.slice(0, 3).join(' + '),
      mode,
      filters,
      intervalHours,
      intervalJitter: Math.max(0.5, intervalHours * 0.25),
      durationDays
    };
    window.dispatchEvent(new CustomEvent('discovery_campaign_start', { detail: config }));
  };

  const activeCampaigns = Object.values(campaigns).filter(c => c.status === 'active' || c.status === 'paused');

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
        <button
          onClick={() => setCampaignMode(false)}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            !campaignMode ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <Zap size={12} /> Run once
        </button>
        <button
          onClick={() => setCampaignMode(true)}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            campaignMode ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <Repeat size={12} /> Run on a schedule
        </button>
      </div>

      {/* Campaign settings */}
      {campaignMode && (
        <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700 block mb-1">
                Run every (hours)
              </span>
              <input
                type="number" min={1} max={24} value={intervalHours}
                onChange={e => setIntervalHours(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-2 py-1.5 bg-white border border-indigo-200 rounded-lg text-sm font-bold text-gray-900"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-700 block mb-1">
                Keep going (days)
              </span>
              <input
                type="number" min={1} max={30} value={durationDays}
                onChange={e => setDurationDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-2 py-1.5 bg-white border border-indigo-200 rounded-lg text-sm font-bold text-gray-900"
              />
            </label>
          </div>
          <div className="text-[10px] text-indigo-700 leading-relaxed">
            <CalendarClock size={10} className="inline mr-1" />
            Will run ~{Math.floor((durationDays * 24) / intervalHours)} times · keeps adding new accounts as it runs.
          </div>
        </div>
      )}

      {/* Launch button */}
      <button
        onClick={campaignMode ? launchCampaign : onOneShot}
        disabled={disabled}
        className={`w-full py-5 rounded-2xl font-bold text-base shadow-2xl flex items-center justify-center gap-3 transition-all ${
          campaignMode
            ? 'bg-gradient-to-br from-indigo-600 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white shadow-indigo-900/20'
            : 'bg-gradient-to-br from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white shadow-gray-900/20'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {campaignMode ? (
          <><Repeat size={20} /> Start scheduled search</>
        ) : (
          <><Play size={20} /> Start search</>
        )}
      </button>

      {/* Active campaigns list */}
      {activeCampaigns.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-1">
            Running searches ({activeCampaigns.length})
          </div>
          {activeCampaigns.map(c => <CampaignChip key={c.id} campaign={c} />)}
        </div>
      )}
    </div>
  );
};

const CampaignChip: React.FC<{ campaign: DiscoveryCampaign }> = ({ campaign }) => {
  const isActive = campaign.status === 'active';
  const nextIn = campaign.nextTickAt ? Math.max(0, Math.floor((new Date(campaign.nextTickAt).getTime() - Date.now()) / 60000)) : 0;
  const daysLeft = Math.max(0, Math.floor((new Date(campaign.endsAt).getTime() - Date.now()) / 86400000));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></div>
          <div className="text-xs font-bold text-gray-900 truncate">{campaign.name}</div>
        </div>
        <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">
          {campaign.results.length} found
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div className="text-gray-500"><span className="font-bold text-gray-700">{campaign.ticksCompleted}</span> runs done</div>
        <div className="text-gray-500"><span className="font-bold text-gray-700">{daysLeft}d</span> left</div>
        <div className="text-gray-500">
          {isActive
            ? 'next in ' + (nextIn > 60 ? `${Math.round(nextIn/60)}h` : `${nextIn}min`)
            : campaign.status === 'paused' ? 'paused' : campaign.status}
        </div>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('discovery_campaign_run_now', { detail: { id: campaign.id } }))}
          className="flex-1 py-1.5 px-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-[10px] font-bold text-gray-700 flex items-center justify-center gap-1"
        >
          <RotateCw size={10} /> Run now
        </button>
        {isActive ? (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('discovery_campaign_pause', { detail: { id: campaign.id } }))}
            className="flex-1 py-1.5 px-2 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1"
          >
            <Pause size={10} /> Pause
          </button>
        ) : (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('discovery_campaign_resume', { detail: { id: campaign.id } }))}
            className="flex-1 py-1.5 px-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1"
          >
            <Play size={10} /> Resume
          </button>
        )}
        <button
          onClick={() => {
            if (confirm('Stop and delete this scheduled search?')) {
              window.dispatchEvent(new CustomEvent('discovery_campaign_abort', { detail: { id: campaign.id } }));
              window.dispatchEvent(new CustomEvent('discovery_campaign_delete', { detail: { id: campaign.id } }));
            }
          }}
          className="py-1.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[10px] font-bold flex items-center justify-center"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  );
};

// ============================================================
// TRACKING SETTINGS — controls how often the bot polls tracked accounts
// ============================================================
type TrackingSettings = {
  intervalMinutes: number;
  respectOffHours: boolean;
  jitterPercent: number;
};

const TrackingSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<TrackingSettings>({
    intervalMinutes: 15, respectOffHours: true, jitterPercent: 0.25
  });
  const [tracked, setTracked] = useState<any[]>([]);
  const trackedCount = tracked.length;
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Load on mount
  useEffect(() => {
    const handler = (e: any) => { if (e.detail) setSettings(e.detail); };
    window.addEventListener('tracking_settings_loaded', handler);
    window.dispatchEvent(new CustomEvent('tracking_settings_get'));
    return () => window.removeEventListener('tracking_settings_loaded', handler);
  }, []);

  // Watch the actual tracked-accounts list (source of truth the engine polls).
  useEffect(() => {
    const refresh = () => {
      try {
        const raw = localStorage.getItem('answerly_creator_configs');
        const list = raw ? JSON.parse(raw) : [];
        setTracked(Array.isArray(list) ? list : []);
      } catch { setTracked([]); }
    };
    refresh();
    const id = setInterval(refresh, 3000);
    window.addEventListener('answerly_sync', refresh);
    return () => { clearInterval(id); window.removeEventListener('answerly_sync', refresh); };
  }, []);

  // Remove an account from tracking — strips it from the synced config so the
  // engine stops polling it (this is the source of truth, regardless of any
  // stale UI status elsewhere).
  const removeTracked = (url: string) => {
    try {
      const raw = localStorage.getItem('answerly_creator_configs');
      const list = raw ? JSON.parse(raw) : [];
      const updated = list.filter((c: any) => c.url !== url);
      localStorage.setItem('answerly_creator_configs', JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('answerly_sync', { detail: updated }));
      setTracked(updated);
    } catch (e) { console.error('Remove tracked failed', e); }
  };

  const update = (patch: Partial<TrackingSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaved('saving');
    window.dispatchEvent(new CustomEvent('tracking_settings_set', { detail: next }));
    setTimeout(() => setSaved('saved'), 400);
    setTimeout(() => setSaved('idle'), 1800);
  };

  const runNow = () => {
    window.dispatchEvent(new CustomEvent('tracking_run_now'));
  };

  const interval = Math.max(5, settings.intervalMinutes);
  const checksPerHour = Math.max(1, Math.floor(60 / interval));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-emerald-50 p-2 rounded-xl flex-shrink-0">
            <Eye size={16} className="text-emerald-600" />
          </div>
          <div className="text-left min-w-0">
            <div className="text-sm font-bold text-gray-900">Watching tracked accounts</div>
            <div className="text-[10px] text-gray-500">
              {trackedCount === 0 ? 'No accounts tracked yet' : `${trackedCount} account${trackedCount > 1 ? 's' : ''} · check every ${interval} min`}
            </div>
          </div>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {trackedCount === 0 && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-[11px] text-gray-600 leading-relaxed">
              When you follow an account from the search results, the bot will start watching it for new posts. New posts show up in the <b>Posts Tracker</b> so you can comment on them.
            </div>
          )}

          {/* Tracked accounts — the exact list the engine polls. Remove here to
              stop tracking, regardless of any stale status in search results. */}
          {trackedCount > 0 && (
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2">
                Currently watching ({trackedCount})
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {tracked.map((c: any) => (
                  <div key={c.url} className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">{c.label || c.url}</div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {c.platform}
                        {c.lastStatus ? ` · ${c.lastStatus}` : ' · not checked yet'}
                      </div>
                    </div>
                    <button
                      onClick={() => removeTracked(c.url)}
                      className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-rose-600 hover:bg-rose-50 border border-rose-100 transition-colors flex items-center gap-1.5"
                      title="Stop tracking this account"
                    >
                      <X size={12} /> Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interval slider */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-600">
                Check for new posts every
              </span>
              <span className="text-xs font-bold text-gray-900">{interval} min</span>
            </div>
            <input
              type="range" min={5} max={120} step={5}
              value={interval}
              onChange={e => update({ intervalMinutes: parseInt(e.target.value) })}
              className="w-full accent-gray-900"
            />
            <div className="flex justify-between text-[9px] text-gray-400 mt-1 font-bold uppercase tracking-wider">
              <span>5 min (more posts)</span>
              <span>2 hours (safer)</span>
            </div>
            <div className="text-[10px] text-gray-500 mt-1.5">
              That's about {checksPerHour} check{checksPerHour > 1 ? 's' : ''} per hour, with random timing to avoid patterns.
            </div>
          </div>

          {/* Off-hours toggle */}
          <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={settings.respectOffHours}
              onChange={e => update({ respectOffHours: e.target.checked })}
              className="mt-0.5 accent-gray-900"
            />
            <div>
              <div className="text-xs font-bold text-gray-900">Pause at night (11pm – 8am)</div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                Most platforms flag accounts that stay active 24/7. Recommended.
              </div>
            </div>
          </label>

          {/* Status / Run now */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="text-[10px] text-gray-400">
              {saved === 'saving' ? 'Saving…' : saved === 'saved' ? '✓ Saved' : 'Changes save automatically'}
            </div>
            <button
              onClick={runNow}
              disabled={trackedCount === 0}
              className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5"
            >
              <RotateCw size={10} /> Check now
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
