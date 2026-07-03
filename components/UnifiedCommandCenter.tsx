import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    Radar, ExternalLink, RefreshCw, Target, Trash2, Send, Inbox,
    ShieldCheck, Heart, Sparkles, Check, X, ArrowRight, ArrowUpRight, Flame, MessageSquarePlus, Users,
    Activity, Clock, Repeat2, Lock, Rss, Quote, Film, Zap
} from 'lucide-react';
import { generateSmartEngagementComment, scoreProfileFits } from '../services/geminiService';
import { useVoiceProfile } from '../hooks/useVoiceProfile';
import { useProject } from '../contexts/ProjectContext';
import { useT } from '../contexts/I18nContext';
import { VOICE_PRESETS } from './ContentEngineView';
import { SmartComment, PipelineLead, LeadInteraction } from '../types';
import { useAutoCommentStatusMap } from './AutoCommentControls';
// AnswerlyView ("Stealth Configuration") removed from the Radar — tracking
// configuration now lives next to the accounts being tracked, in Account
// Finder. Keeping it here was redundant and added visual noise.

const STAGE_CONFIG = {
  'radar_help': {
    label: 'Help Requests',
    description: 'Needs Answers',
    color: 'orange',
    icon: <MessageSquarePlus size={18} />,
    gradient: 'from-orange-500 to-amber-400',
    bg: 'bg-orange-50/50',
    border: 'border-orange-200',
    accent: 'bg-orange-600',
    isRadar: true,
    radarType: 'help'
  },
  'radar_recon': {
    label: 'Signal Recon',
    description: 'ICP Matches',
    color: 'gray',
    icon: <Radar size={18} />,
    gradient: 'from-gray-700 to-gray-500',
    bg: 'bg-gray-50/50',
    border: 'border-gray-200',
    accent: 'bg-gray-800',
    isRadar: true,
    radarType: 'recon'
  },
  'new': {
    label: 'Tracked Leads',
    description: 'Vetted Targets',
    color: 'blue',
    icon: <Inbox size={18} />,
    gradient: 'from-blue-500 to-cyan-400',
    bg: 'bg-blue-50/50',
    border: 'border-blue-100',
    accent: 'bg-blue-600'
  },
  'engaging': {
    label: 'Warming Up',
    description: 'Active Engagement',
    color: 'purple',
    icon: <Heart size={18} />,
    gradient: 'from-purple-500 to-indigo-400',
    bg: 'bg-purple-50/50',
    border: 'border-purple-100',
    accent: 'bg-purple-600'
  }
};

// ────────────────────────────────────────────────────────────────────
// Radar post card — platform-tinted, default collapsed for long content.
// Scraped social posts often arrive with ragged whitespace and giant text
// blocks that wreck the feed's readability. Normalize the text first
// (collapse 3+ blank lines, trim, dedup spaces) so it always lays out
// the same regardless of source noise.
// ────────────────────────────────────────────────────────────────────
const RADAR_POST_PREVIEW_CHARS = 600;
// Paginate the tracker — rendering hundreds of post cards (each with its own
// expandable editor / masonry slot) was the cause of the slow load. 50/page
// keeps the DOM small while still showing a meaningful batch.
const POSTS_PER_PAGE = 50;

// Brand-accurate inline SVG logos so Reddit / LinkedIn / X get their own
// recognizable icons in the card header (not generic icons).
const PlatformBrandIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className = 'w-4 h-4 text-white' }) => {
    const p = String(platform || '').toLowerCase();
    if (p.includes('reddit')) {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-label="Reddit">
                <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.05l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.057 1.597.047.222.069.447.069.675 0 2.212-2.39 4.012-5.338 4.012s-5.338-1.8-5.338-4.012c0-.218.021-.432.065-.644a1.745 1.745 0 0 1-1.025-1.586c0-.968.786-1.754 1.754-1.754.463 0 .875.18 1.179.473 1.17-.834 2.8-1.393 4.602-1.474l.522-2.462 3.03.64zm-7.422 7.871c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.281-.574 1.281-1.282 0-.708-.573-1.282-1.281-1.282zm4.825 0c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.282-.574 1.282-1.282 0-.708-.574-1.282-1.282-1.282zm-2.377 3.724c-.232 0-.46.015-.685.042-.254.031-.498.08-.733.146-.147.042-.273.106-.381.187a.327.327 0 0 0-.099.448.327.327 0 0 0 .448.099c.071-.054.17-.102.289-.138.169-.047.346-.083.53-.105.19-.023.389-.035.592-.035.204 0 .403.012.593.035.184.022.361.058.53.105.119.036.218.084.289.138a.327.327 0 0 0 .448-.099.327.327 0 0 0-.099-.448c-.108-.081-.234-.145-.381-.187a3.984 3.984 0 0 0-.733-.146c-.225-.027-.453-.042-.685-.042z"/>
            </svg>
        );
    }
    if (p.includes('linkedin')) {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-label="LinkedIn">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
        );
    }
    if (p.includes('x') || p.includes('twitter')) {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-label="X">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
        );
    }
    return <ShieldCheck className={className} />;
};

function cleanPostText(raw: string): string {
    if (!raw) return '';
    return raw
        .replace(/\r\n/g, '\n')
        // Collapse 3+ consecutive blank lines into a single blank line.
        // Raw scrape often has chunks like "\n\n\n\n\n  Read more  \n\n\n"
        // which renders as a giant gap that breaks the visual rhythm.
        .replace(/\n{3,}/g, '\n\n')
        // Trim runs of trailing whitespace on each line — scrapers leave
        // these all over the place and they affect the rendered width.
        .split('\n').map(l => l.replace(/[ \t]+$/g, '').replace(/[ \t]{2,}/g, ' ')).join('\n')
        .trim();
}

// Format the post timestamp as "2h ago" / "Just now" / "3d ago" — much
// faster to parse at a glance than a full date+time. Falls back to a date
// for anything older than a week.
type TFn = (key: string, vars?: Record<string, string | number>) => string;
function formatRelativeTime(ts: number | string | undefined | null, t: TFn): string {
    // History items store timestamps as ISO strings — accept both.
    const n = typeof ts === 'number' ? ts : (ts ? new Date(ts).getTime() : NaN);
    if (!Number.isFinite(n)) return t('time.recently');
    const diffMs = Date.now() - n;
    if (diffMs < 0) return t('time.justNow');
    const m = Math.floor(diffMs / 60_000);
    if (m < 1) return t('time.justNow');
    if (m < 60) return t('time.mAgo', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('time.hAgo', { n: h });
    const d = Math.floor(h / 24);
    if (d < 7) return t('time.dAgo', { n: d });
    return new Date(n).toLocaleDateString();
}

const RadarPostCard: React.FC<{
    item: any;
    getPlatformIcon: (p: any, dark?: boolean) => React.ReactNode;
    onComment: () => void;
    commentStatus?: 'posted-auto' | 'posted-manual' | 'queued' | 'skipped';
    draft?: { postUrl: string; draft: string } | undefined;
    onConfirmDraft?: (postUrl: string, comment: string) => void;
    onDiscardDraft?: (postUrl: string) => void;
    onRemovePost?: () => void;
    onRepost?: () => void;
    onQuote?: () => void;
    selected?: boolean;
    onToggleSelect?: () => void;
    batchDraft?: string;
    batchState?: 'idle' | 'generating' | 'done' | 'error';
    onBatchDraftChange?: (text: string) => void;
    // Inline single-comment generation (the "Comment" button). The card shows an
    // editable draft in-place (like an auto-reply) instead of opening a modal.
    inlineDraft?: string;
    inlineState?: 'generating' | 'done' | 'error';
    onInlineDraftChange?: (text: string) => void;
    onInlinePost?: (text: string) => void;
    onInlineRegenerate?: () => void;
    onInlineDiscard?: () => void;
}> = ({ item, onComment, commentStatus, draft, onConfirmDraft, onDiscardDraft, onRemovePost, onRepost, onQuote, selected, onToggleSelect, batchDraft, batchState, onBatchDraftChange, inlineDraft, inlineState, onInlineDraftChange, onInlinePost, onInlineRegenerate, onInlineDiscard }) => {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    const [draftText, setDraftText] = useState('');
    const [showReply, setShowReply] = useState(false);
    useEffect(() => {
        if (draft?.draft) { setDraftText(draft.draft); setShowReply(true); }
    }, [draft?.draft]);
    const isRepost = !!item.isRepost;
    const replyRestricted = !!item.replyRestricted;
    const platform = String(item.platform || '').toLowerCase();
    const isX = platform.includes('x') || platform.includes('twitter');
    const isLinkedIn = platform.includes('linkedin');
    const isReddit = platform.includes('reddit');

    // Per-platform identity. Avatar gets the brand colour; everything else
    // stays neutral so the post content is what jumps out, not the chrome.
    const theme = isReddit
        ? { avatarBg: 'bg-orange-500', accent: 'text-orange-700', accentHover: 'group-hover:text-orange-700', name: 'Reddit', openOn: t('tracker.open.thread') }
        : isLinkedIn
        ? { avatarBg: 'bg-blue-600',  accent: 'text-blue-700',   accentHover: 'group-hover:text-blue-700',   name: 'LinkedIn', openOn: t('tracker.open.post') }
        : isX
        ? { avatarBg: 'bg-gray-900',  accent: 'text-gray-900',   accentHover: 'group-hover:text-gray-900',   name: 'X', openOn: t('tracker.open.post') }
        : { avatarBg: 'bg-gray-700',  accent: 'text-gray-700',   accentHover: 'group-hover:text-gray-700',   name: t('tracker.platform.web'), openOn: t('tracker.open.generic') };

    // Reddit posts: item.text = title, item.body = self-text (may be empty).
    // X / LinkedIn: item.text = the full post, item.body is unused.
    // Splitting this out makes the title pop at the top instead of being
    // buried in body text — the OLD card squashed everything into one block.
    const redditTitle = isReddit ? (item.text || '').trim() : '';
    const bodyRaw = isReddit ? (item.body || '') : (item.text || item.body || '');
    const body = useMemo(() => cleanPostText(bodyRaw), [bodyRaw]);
    const isLong = body.length > RADAR_POST_PREVIEW_CHARS;
    const visibleBody = expanded || !isLong
        ? body
        : body.slice(0, RADAR_POST_PREVIEW_CHARS).trimEnd() + '…';

    // The "creator" field is the X handle / LinkedIn name / subreddit name.
    // First char of that goes in the avatar circle as a fallback when we don't
    // have a profile pic. For Reddit's "r/foo", strip the prefix so we don't
    // show "R" in the circle.
    const creatorLabel = String(item.creator || '?');
    const avatarSeed = isReddit
        ? (creatorLabel.replace(/^r\//i, '').charAt(0) || 'R').toUpperCase()
        : (creatorLabel.charAt(0) || '?').toUpperCase();
    const creatorDisplay = isReddit
        ? (creatorLabel.startsWith('r/') ? creatorLabel : `r/${creatorLabel}`)
        : `@${creatorLabel}`;

    const relTime = formatRelativeTime(item.timestamp, t);

    // Visual style for the unified comment status pill. Every post shows
    // SOME status so the user can tell at a glance whether the post has
    // been touched yet. 'Not replied yet' is the absence-of-action state.
    const isReplied = commentStatus === 'posted-auto' || commentStatus === 'posted-manual';
    const commentBadge =
        commentStatus === 'posted-auto'
            ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '✓', label: t('tracker.status.autoReplied') }
        : commentStatus === 'posted-manual'
            ? { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '✓', label: t('tracker.status.youReplied') }
        : commentStatus === 'queued'
            ? { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⏳', label: t('tracker.status.queued') }
        : commentStatus === 'skipped'
            ? { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: '○', label: t('tracker.status.skipped') }
        : { cls: 'bg-white text-gray-400 border-gray-200', icon: '○', label: t('tracker.status.notReplied') };

    // ── Profile-fit tint ──
    // The whole card is tinted on a red→amber→green scale by how well the post
    // fits the user's niche/voice, so the feed is scannable at a glance: greener
    // = stronger fit (reply first), redder = weak fit. Tiers (not a raw gradient)
    // keep text contrast readable on a dense feed.
    const fit = typeof item.relevancyScore === 'number' ? item.relevancyScore
        : typeof item.relevance === 'number' ? item.relevance : null;
    const fitTier = fit === null ? null
        : fit >= 80 ? 'excellent'
        : fit >= 65 ? 'good'
        : fit >= 50 ? 'mid'
        : fit >= 35 ? 'low'
        : 'poor';

    // ── Reply-Priority Score ──
    // Combines fit (50%) + recency (35%) + engagement-already-on-the-post
    // (15%) into a single 0-100 "should I reply NOW" number. The user
    // already knows the FIT — what they lack is urgency. We surface the
    // tier (HOT / WARM / COOL / COLD) as a coloured pill next to the fit
    // badge so the eye can prioritize the queue at a glance.
    const minutesOld = (() => {
        const t = item.timestamp ? Date.parse(item.timestamp) : NaN;
        if (!Number.isFinite(t)) return null;
        return Math.max(0, (Date.now() - t) / 60000);
    })();
    // Recency score: 100 for ≤30min, decays to 0 over 24h (linear).
    const recencyScore = minutesOld === null ? 50
        : minutesOld <= 30 ? 100
        : minutesOld >= 1440 ? 0
        : Math.round(100 - ((minutesOld - 30) / (1440 - 30)) * 100);
    // Engagement-presence: any non-zero engagement signal counts as "alive".
    // We don't have rich per-platform numbers here, so this is a binary boost.
    const hasEngagement =
        (item.likes || 0) + (item.comments || 0) + (item.reactions || 0)
        + (item.upvotes || 0) + (item.engagement?.total || 0) > 0;
    const engagementScore = hasEngagement ? 100 : 30;
    // Composite priority, clamped 0-100.
    const priority = fit === null && minutesOld === null ? null
        : Math.round(
              (typeof fit === 'number' ? fit : 50) * 0.50 +
              recencyScore * 0.35 +
              engagementScore * 0.15
          );
    const priorityTier =
        priority === null ? null
        : priority >= 80 ? { label: 'HOT',  bg: 'bg-rose-100',   text: 'text-rose-700',   ring: 'ring-rose-200',   tip: 'Top priority — reply now while the spotlight is on.' }
        : priority >= 65 ? { label: 'WARM', bg: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-200', tip: 'Worth replying soon — still in the engagement window.' }
        : priority >= 45 ? { label: 'COOL', bg: 'bg-amber-50',   text: 'text-amber-700',  ring: 'ring-amber-200',  tip: 'Can wait — fresher or higher-fit posts will outrank it.' }
        :                  { label: 'COLD', bg: 'bg-gray-100',   text: 'text-gray-600',   ring: 'ring-gray-200',   tip: 'Low priority — old or low-fit. Probably skip.' };
    const FIT_STYLES: Record<string, { card: string; num: string; bar: string; label: string }> = {
        excellent: { card: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-200 hover:border-emerald-300 hover:shadow-emerald-100', num: 'text-emerald-600', bar: 'bg-emerald-500', label: t('tracker.fit.strong') },
        good:      { card: 'bg-gradient-to-br from-green-50/80 to-white border-green-200 hover:border-green-300 hover:shadow-green-100', num: 'text-green-600', bar: 'bg-green-500', label: t('tracker.fit.good') },
        mid:       { card: 'bg-gradient-to-br from-amber-50/80 to-white border-amber-200 hover:border-amber-300 hover:shadow-amber-100', num: 'text-amber-600', bar: 'bg-amber-500', label: t('tracker.fit.moderate') },
        low:       { card: 'bg-gradient-to-br from-orange-50/80 to-white border-orange-200 hover:border-orange-300 hover:shadow-orange-100', num: 'text-orange-600', bar: 'bg-orange-500', label: t('tracker.fit.weak') },
        poor:      { card: 'bg-gradient-to-br from-rose-50/70 to-white border-rose-200 hover:border-rose-300 hover:shadow-rose-100', num: 'text-rose-500', bar: 'bg-rose-400', label: t('tracker.fit.low') },
    };
    const fitStyle = fitTier ? FIT_STYLES[fitTier] : { card: 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-gray-200/40', num: 'text-gray-500', bar: 'bg-gray-300', label: t('tracker.fit.unscored') };
    // A replied post gets an emerald edge regardless of fit, so "done" still reads first.
    const cardBorder = isReplied ? 'border-emerald-300' : '';

    return (
        <article className={`group border ${fitStyle.card} ${cardBorder} ${selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''} hover:shadow-md rounded-2xl transition-all duration-200 ease-out overflow-hidden`}>
            {/* FIT METER — a slim top bar whose width + colour encode profile fit. */}
            {fit !== null && (
                <div className="h-1 w-full bg-black/5" title={`${fitStyle.label} · ${fit}%`}>
                    <div className={`h-full ${fitStyle.bar} transition-all`} style={{ width: `${Math.max(4, Math.min(100, fit))}%` }} />
                </div>
            )}
            {/* HEADER — avatar + creator + platform + when. Single visual unit. */}
            <header className="flex items-start gap-3 px-5 pt-4 pb-3">
                {/* Multi-select checkbox — lets the user pick posts for batch
                    comment generation + publish. Only rendered when the parent
                    wires up onToggleSelect. */}
                {onToggleSelect && (
                    <button
                        onClick={onToggleSelect}
                        className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                            selected
                                ? 'bg-blue-600 border-blue-600 text-white shadow-sm ring-2 ring-blue-200'
                                : 'bg-white border-gray-300 hover:border-blue-500 hover:bg-blue-50'
                        }`}
                        title={selected ? 'Deselect post' : 'Select post for batch actions'}
                        aria-label={selected ? 'Deselect post' : 'Select post'}
                        aria-pressed={!!selected}
                    >
                        {/* Only show the tick when actually selected — an always-on
                            faint check made the empty state look half-selected. */}
                        {selected && <Check size={15} strokeWidth={3.5} />}
                    </button>
                )}
                {/* Avatar circle with platform-icon corner badge */}
                <div className="relative flex-shrink-0">
                    <div className={`w-11 h-11 rounded-full ${theme.avatarBg} flex items-center justify-center text-white font-semibold text-base`}>
                        {avatarSeed}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-sm">
                        <div className={`w-4 h-4 rounded-full ${theme.avatarBg} flex items-center justify-center`}>
                            <PlatformBrandIcon platform={item.platform} className="w-2.5 h-2.5 text-white" />
                        </div>
                    </div>
                </div>
                {/* Creator + meta */}
                <div className="flex-1 min-w-0">
                    <a href={item.postUrl || item.url} target="_blank" rel="noreferrer"
                       className={`text-[15px] font-semibold text-gray-900 ${theme.accentHover} transition-colors leading-tight block truncate`}>
                        {creatorDisplay}
                    </a>
                    <div className="flex items-center gap-1.5 text-[12px] text-gray-500 mt-0.5 flex-wrap">
                        <span>{theme.name}</span>
                        <span className="text-gray-300">·</span>
                        <Clock size={11} className="text-gray-400" />
                        <span title={item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}>{relTime}</span>
                        {/* Source badge — where this post came from: the home-feed
                            watcher vs. a tracked account / keyword search. */}
                        <span className="text-gray-300">·</span>
                        {item.discoveredVia === 'feed' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border bg-violet-50 text-violet-700 border-violet-200" title="Surfaced by the Feed Watcher from your home timeline.">
                                <Rss size={10} /> {t('tracker.badge.feed')}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border bg-sky-50 text-sky-700 border-sky-200" title="From an account or keyword you're tracking.">
                                <Radar size={10} /> {t('tracker.badge.tracked')}
                            </span>
                        )}
                        {/* Comment status pill — ALWAYS shown so each post answers
                            "has this been replied to?" at a glance. */}
                        <span className="text-gray-300">·</span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${commentBadge.cls}`}
                            title={
                                commentStatus === 'posted-auto' ? 'The bot auto-replied to this post.'
                                : commentStatus === 'posted-manual' ? 'You manually replied to this post.'
                                : commentStatus === 'queued' ? 'Queued — waiting for the AI to generate the reply.'
                                : commentStatus === 'skipped' ? 'Skipped — match score, rate limit, or account opt-in didn\'t qualify.'
                                : 'No comment posted on this yet.'
                            }>
                            <span>{commentBadge.icon}</span>{commentBadge.label}
                        </span>
                        {isRepost && (
                            <>
                                <span className="text-gray-300">·</span>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border bg-sky-50 text-sky-700 border-sky-200" title="This is a repost — a reply targets the original post.">
                                    <Repeat2 size={11} /> {t('tracker.badge.repost')}
                                </span>
                            </>
                        )}
                        {replyRestricted && (
                            <>
                                <span className="text-gray-300">·</span>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border bg-amber-50 text-amber-700 border-amber-200" title="The author limited who can reply to this post — you may not be able to reply.">
                                    <Lock size={11} /> {t('tracker.badge.repliesRestricted')}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                {/* Profile-fit KPI — promoted to a 3-line badge so it reads
                    instantly: big number, tier label, "PROFILE FIT" caption.
                    Same colour palette as the card tint / fit meter so the
                    eye groups the signal across the card. Tooltip carries
                    the AI's relevancy reason if it provided one. */}
                {fit !== null && (
                    <div
                        className={`text-right flex-shrink-0 px-2.5 py-1.5 rounded-xl bg-white/70 border border-current/10 ${fitStyle.num}`}
                        title={item.relevancyReason || fitStyle.label}
                    >
                        <div className={`text-[22px] font-extrabold leading-none tabular-nums ${fitStyle.num}`}>{fit}<span className="text-[13px] font-bold opacity-70">%</span></div>
                        <div className={`text-[10px] font-extrabold uppercase tracking-wider mt-0.5 ${fitStyle.num}`}>{fitStyle.label}</div>
                        <div className="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">{t('tracker.fit.caption')}</div>
                    </div>
                )}
                {/* Remove this post from the tracker */}
                {onRemovePost && (
                    <button
                        onClick={onRemovePost}
                        className="flex-shrink-0 text-gray-300 hover:text-rose-500 transition-colors p-1 -mt-1 -mr-1"
                        title="Remove this post"
                        aria-label="Remove this post"
                    >
                        <X size={15} />
                    </button>
                )}
            </header>

            {/* BODY — Reddit shows TITLE + body (since title IS the content);
                 X / LinkedIn just show the post text */}
            <div className="px-5 pb-4">
                {isReddit && redditTitle && (
                    <h3 className="text-[16px] font-semibold text-gray-900 leading-snug mb-2">
                        {redditTitle}
                    </h3>
                )}
                {body && !/^\[Image post\]$/.test(body.trim()) && (
                    <p className="text-[14px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {visibleBody}
                    </p>
                )}
                {/* MEDIA — image thumbnails + a video/GIF marker so an
                     image-only post is never a blank card. Clicking opens the
                     real post (we don't proxy media). */}
                {item.media && (item.media.images?.length > 0 || item.media.hasVideo || item.media.hasGif) && (
                    <div className="mt-3">
                        {item.media.images?.length > 0 && (
                            <div className={`grid gap-1.5 rounded-xl overflow-hidden border border-gray-100 ${item.media.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                {item.media.images.slice(0, 4).map((src: string, i: number) => (
                                    <a key={i} href={item.postUrl || item.url} target="_blank" rel="noreferrer" className="block group/media">
                                        <img
                                            src={src}
                                            alt={item.media.alt?.[i] || 'Post image'}
                                            loading="lazy"
                                            onError={(e) => { (e.currentTarget.closest('a') as HTMLElement).style.display = 'none'; }}
                                            className={`w-full object-cover bg-gray-100 transition-opacity group-hover/media:opacity-90 ${item.media.images.length === 1 ? 'max-h-80' : 'h-40'}`}
                                        />
                                    </a>
                                ))}
                            </div>
                        )}
                        {(item.media.hasVideo || item.media.hasGif) && (
                            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-[11px] font-medium">
                                <Film size={12} /> {item.media.hasGif ? 'GIF' : 'Video'} · open the post to watch
                            </div>
                        )}
                    </div>
                )}
                {/* For quotes/reposts, show the ORIGINAL post too — that's what a
                     reply actually targets, so the user sees the real context.
                     Skip it for a native repost where the original IS the body
                     (showing identical text twice is just noise). */}
                {isRepost && item.originalPost?.text
                    && item.originalPost.text.trim().slice(0, 80) !== (body || '').trim().slice(0, 80) && (
                    <blockquote className="mt-3 border-l-2 border-sky-300 pl-3 py-1.5 bg-sky-50/50 rounded-r-md">
                        <div className="text-[10px] uppercase tracking-wider text-sky-700 font-bold mb-1 flex items-center gap-1">
                            <Quote size={10} /> {t('tracker.quoting')}{item.originalPost.author ? ` @${item.originalPost.author}` : ''}
                        </div>
                        <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {item.originalPost.text}
                        </p>
                    </blockquote>
                )}
                {isLong && (
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className={`mt-2 text-[12px] font-medium ${theme.accent} hover:underline transition-all duration-200`}
                    >
                        {expanded ? '↑ Show less' : '↓ Show full post'}
                    </button>
                )}
                {/* Edge case: a link/image-only Reddit post with no title + no body */}
                {!body && !redditTitle && (
                    <p className="text-[13px] text-gray-400 italic">No text content — open the post to see it.</p>
                )}
            </div>

            {/* DRAFT REVIEW — human-in-the-loop. An auto-reply draft was generated
                 for this post; the user edits/approves before anything is posted.
                 Collapsible via the "Suggested reply" toggle in the footer. */}
            {draft && showReply && (
                <div className="mx-5 mb-3 rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-violet-600 text-white">
                        <div className="flex items-center gap-2 text-[12px] font-bold">
                            <Sparkles size={14} /> Suggested reply
                            <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-semibold uppercase tracking-wide">Needs your approval</span>
                        </div>
                        <button onClick={() => setShowReply(false)} className="text-white/80 hover:text-white" title="Hide" aria-label="Hide reply">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="p-4">
                        <textarea
                            value={draftText}
                            onChange={e => setDraftText(e.target.value)}
                            rows={4}
                            className="w-full px-3 py-2.5 rounded-xl border border-violet-200 bg-white text-[14px] leading-relaxed text-gray-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
                        />
                        <div className="flex items-center justify-between mt-3">
                            <span className="text-[11px] text-gray-400">{draftText.length} characters · edit before posting</span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => onDiscardDraft?.(draft.postUrl)}
                                    className="px-3.5 py-2 rounded-lg text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:border-gray-400 transition-colors">
                                    Discard
                                </button>
                                <button
                                    onClick={() => onConfirmDraft?.(draft.postUrl, draftText)}
                                    disabled={replyRestricted || draftText.trim().length < 2}
                                    className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center gap-1.5 shadow-sm">
                                    <Send size={13} /> Approve &amp; post
                                </button>
                            </div>
                        </div>
                        {replyRestricted && (
                            <div className="mt-2 text-[11px] text-amber-700 flex items-center gap-1">
                                <Lock size={11} /> The author restricted replies — posting may fail.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* INLINE COMMENT — generated by the card's own "Comment" button.
                 Mirrors the auto-reply experience: the reply is written straight
                 into the card in your voice; you edit and Approve & post. Nothing
                 is posted until you approve (queue-only, human-in-the-loop). */}
            {inlineState && (
                <div className="mx-5 mb-3 rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-violet-600 text-white">
                        <div className="flex items-center gap-2 text-[12px] font-bold">
                            <Sparkles size={14} /> Your reply
                            {inlineState === 'generating'
                                ? <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-semibold uppercase tracking-wide animate-pulse">Writing…</span>
                                : inlineState === 'error'
                                ? <span className="px-1.5 py-0.5 rounded-md bg-rose-400/40 text-[10px] font-semibold uppercase tracking-wide">Failed</span>
                                : <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-semibold uppercase tracking-wide">Needs your approval</span>}
                        </div>
                        <button onClick={() => onInlineDiscard?.()} className="text-white/80 hover:text-white" title="Discard" aria-label="Discard reply">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="p-4">
                        {inlineState === 'generating' ? (
                            <div className="flex items-center gap-2 text-[13px] text-violet-700 py-2">
                                <RefreshCw size={14} className="animate-spin" /> Writing a reply in your voice…
                            </div>
                        ) : inlineState === 'error' ? (
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] text-rose-600">Couldn't generate — try again.</span>
                                <button onClick={() => onInlineRegenerate?.()} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-violet-700 bg-white border border-violet-200 hover:border-violet-400 flex items-center gap-1.5">
                                    <RefreshCw size={12} /> Retry
                                </button>
                            </div>
                        ) : (
                            <>
                                <textarea
                                    value={inlineDraft || ''}
                                    onChange={e => onInlineDraftChange?.(e.target.value)}
                                    rows={4}
                                    className="w-full px-3 py-2.5 rounded-xl border border-violet-200 bg-white text-[14px] leading-relaxed text-gray-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
                                />
                                <div className="flex items-center justify-between mt-3">
                                    <span className="text-[11px] text-gray-400">{(inlineDraft || '').length} characters · edit before posting</span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => onInlineRegenerate?.()}
                                            className="px-3 py-2 rounded-lg text-xs font-semibold text-violet-700 bg-white border border-violet-200 hover:border-violet-400 transition-colors flex items-center gap-1.5">
                                            <RefreshCw size={12} /> Regenerate
                                        </button>
                                        <button
                                            onClick={() => onInlinePost?.(inlineDraft || '')}
                                            disabled={replyRestricted || (inlineDraft || '').trim().length < 2}
                                            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center gap-1.5 shadow-sm">
                                            <Send size={13} /> Approve &amp; post
                                        </button>
                                    </div>
                                </div>
                                {replyRestricted && (
                                    <div className="mt-2 text-[11px] text-amber-700 flex items-center gap-1">
                                        <Lock size={11} /> The author restricted replies — posting may fail.
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* BATCH DRAFT — generated by "Generate comments for selected".
                Editable in place; published by "Publish selected". Only shows
                once a batch generation has touched this (selected) post. */}
            {batchState && batchState !== 'idle' && (
                <div className="mx-5 mb-3 rounded-2xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-white shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-[12px] font-bold">
                        <Sparkles size={14} /> Batch comment
                        {batchState === 'generating' && <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-semibold uppercase tracking-wide animate-pulse">Generating…</span>}
                        {batchState === 'done' && <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px] font-semibold uppercase tracking-wide">Review &amp; publish</span>}
                        {batchState === 'error' && <span className="px-1.5 py-0.5 rounded-md bg-rose-400/40 text-[10px] font-semibold uppercase tracking-wide">Failed</span>}
                    </div>
                    <div className="p-4">
                        {batchState === 'generating' ? (
                            <div className="flex items-center gap-2 text-[13px] text-blue-700 py-2">
                                <RefreshCw size={14} className="animate-spin" /> Writing a comment in your voice…
                            </div>
                        ) : batchState === 'error' ? (
                            <div className="text-[13px] text-rose-600 py-1">Couldn't generate — try again from the batch bar.</div>
                        ) : (
                            <>
                                <textarea
                                    value={batchDraft || ''}
                                    onChange={e => onBatchDraftChange?.(e.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2.5 rounded-xl border border-blue-200 bg-white text-[14px] leading-relaxed text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-y"
                                />
                                <span className="text-[11px] text-gray-400">{(batchDraft || '').length} characters · edit before publishing</span>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* FOOTER — actions. flex-wrap so the row never clips inside the
                overflow-hidden card when 4+ buttons don't fit the card width. */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/60">
                {/* The Auto-reply DRAFT toggle (only when an auto-draft is ready)
                     sits alongside the manual Comment button — both always
                     available; auto-generation only happens when the account
                     has Auto-reply ON in the Account Finder. */}
                {draft && (
                    <button
                        onClick={() => setShowReply(s => !s)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white transition-all duration-200 ease-out active:scale-[0.97] animate-pulse"
                        title="An auto-reply draft is ready — review and approve it">
                        <Sparkles size={12} /> {showReply ? t('tracker.btn.hideReply') : t('tracker.btn.reviewReply')}
                    </button>
                )}
                <button
                    onClick={onComment}
                    disabled={inlineState === 'generating'}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium
                                transition-all duration-200 ease-out hover:shadow-md hover:shadow-gray-300/40 active:scale-[0.97]
                                disabled:opacity-60 disabled:cursor-default
                                ${isReplied
                                    ? 'bg-white text-gray-700 border border-gray-200 hover:border-gray-400'
                                    : 'bg-gray-900 hover:bg-gray-800 text-white'
                                }`}
                    title={isReplied ? 'Already replied — generate another reply in your voice' : 'Generate a reply in your voice, right here'}>
                    {inlineState === 'generating'
                        ? <><RefreshCw size={12} className="animate-spin" /> {t('tracker.btn.writing')}</>
                        : <><Sparkles size={12} /> {isReplied ? t('tracker.btn.replyAgain') : t('tracker.btn.comment')}</>}
                </button>
                {/* Repost & Quote — X/Twitter only. Repost is one-tap; Quote
                     opens the comment composer in quote mode (adds your take). */}
                {isX && onRepost && (
                    <button
                        onClick={onRepost}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:text-emerald-700 bg-white border border-gray-200 hover:border-emerald-300 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-[0.97]"
                        title="Repost this to your followers (no added text)">
                        <Repeat2 size={12} /> {t('tracker.btn.repost')}
                    </button>
                )}
                {isX && onQuote && (
                    <button
                        onClick={onQuote}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:text-violet-700 bg-white border border-gray-200 hover:border-violet-300 rounded-lg text-xs font-medium transition-all duration-200 ease-out active:scale-[0.97]"
                        title="Quote this post with your own take">
                        <Quote size={12} /> {t('tracker.btn.quote')}
                    </button>
                )}
                <a href={item.postUrl || item.url} target="_blank" rel="noreferrer"
                   className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-400 rounded-lg text-xs font-medium
                              transition-all duration-200 ease-out active:scale-[0.97]">
                    <ExternalLink size={12} /> {theme.openOn}
                </a>
            </div>
        </article>
    );
};

export const UnifiedCommandCenter: React.FC<{ appDesc?: string }> = ({ appDesc }) => {
  const { project } = useProject();
  const [radarHistory, setRadarHistory] = useState<any[]>([]);
  // ── Real DeepSeek profile-fit scores, cached by post key (url|uuid) ──
  // Replaces the fake flat "100%" the extension used to stamp on every post.
  // Persisted so we don't re-score the same post across reloads.
  const [aiFitScores, setAiFitScores] = useState<Record<string, { score: number; reason: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('profile_fit_cache_v1') || '{}') || {}; } catch { return {}; }
  });
  // busy = a scoring pass is in flight; done = keys already sent (avoids
  // re-queuing); count caps how many posts we AI-score per mount (cost guard).
  const fitScoringRef = React.useRef<{ busy: boolean; done: Set<string>; count: number }>({ busy: false, done: new Set(), count: 0 });
  const [drafts, setDrafts] = useState<any[]>([]);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [activeMainTab, setActiveMainTab] = useState<'radar' | 'leads'>('radar');
  const [commentingLead, setCommentingLead] = useState<any | null>(null);
  const [commentMode, setCommentMode] = useState<'lead' | 'visibility'>('lead');
  // Which engagement the composer will perform on Send: a normal reply
  // ('comment') or a quote-tweet ('quote'). Set by the card's Comment/Quote
  // buttons before the modal opens.
  const [engagementAction, setEngagementAction] = useState<'comment' | 'quote'>('comment');
  const [smartComments, setSmartComments] = useState<SmartComment | null>(null);
  const [isGeneratingComment, setIsGeneratingComment] = useState(false);
  // Comment specification (tone/goal/length/angle) is configured ONCE in Voice
  // Studio and read from the shared hook (vp.commentSpec) — no per-post
  // re-parametrising and no redundancy with the voice dials.
  // Per-option editable text. Generated comments are always tweakable before
  // sending; this holds the user's edits keyed by option index.
  const [editedComments, setEditedComments] = useState<Record<number, string>>({});

  // ── Multi-select + batch comment state (Posts Tracker) ──
  // selectedPosts holds post keys (postUrl|url|uuid). batchDrafts/batchStates
  // hold the per-post generated comment + its lifecycle so each card can show
  // an editable draft. Everything is queue-only — nothing posts without the
  // user pressing Publish.
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [batchDrafts, setBatchDrafts] = useState<Record<string, string>>({});
  const [batchStates, setBatchStates] = useState<Record<string, 'generating' | 'done' | 'error'>>({});
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // ── Inline single-comment state (Posts Tracker) ──
  // Clicking "Comment" on a card now generates a reply directly INSIDE the card
  // (same inline editable box auto-replies use) instead of opening a modal. The
  // generation uses the active Voice Studio parameters; nothing posts until the
  // user presses "Approve & post". Keyed by postUrl|url|uuid, like the batch maps.
  const [inlineDrafts, setInlineDrafts] = useState<Record<string, string>>({});
  const [inlineStates, setInlineStates] = useState<Record<string, 'generating' | 'done' | 'error'>>({});

  // ── Posts Tracker filters ──
  // minFit: only show posts whose profile fit is >= this %. platformFilter:
  // restrict the feed to a single platform. Both are applied before rendering
  // and before "Select all". Persisted to localStorage so the user's filter
  // choice survives reloads / tab switches.
  const [minFit, setMinFit] = useState<number>(() => {
    const v = Number(localStorage.getItem('posts_tracker_min_fit'));
    return Number.isFinite(v) ? v : 0;
  });
  const [platformFilter, setPlatformFilter] = useState<'all' | 'x' | 'linkedin' | 'reddit'>(() => {
    const v = localStorage.getItem('posts_tracker_platform_filter');
    return (v === 'x' || v === 'linkedin' || v === 'reddit') ? v : 'all';
  });
  useEffect(() => { try { localStorage.setItem('posts_tracker_min_fit', String(minFit)); } catch {} }, [minFit]);
  useEffect(() => { try { localStorage.setItem('posts_tracker_platform_filter', platformFilter); } catch {} }, [platformFilter]);

  // Current pagination page (0-indexed). Reset when filters change so the user
  // doesn't end up stranded on an empty page after narrowing the feed.
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [minFit, platformFilter]);

  // Voice-profile hook — provides saved-profiles library so the user can
  // generate comments in any of their saved voices without leaving this view.
  const vp = useVoiceProfile();

  // Active voice label — surfaced on top of the Posts Tracker so the user
  // always knows WHICH voice the agent is using to generate comments here.
  // A saved profile (applied via the Studio) sets aiSuggestionReason to
  // "Saved profile · <name>"; otherwise we resolve the built-in preset's name,
  // falling back to "Custom voice" when the user has hand-tuned the dials.
  const activeVoice = useMemo(() => {
    const reason = vp.aiSuggestionReason || '';
    if (reason.startsWith('Saved profile ·')) {
      return { emoji: '💾', name: reason.replace('Saved profile ·', '').trim() || 'Saved voice' };
    }
    if (vp.activePreset) {
      const p = VOICE_PRESETS.find(x => x.id === vp.activePreset);
      if (p) return { emoji: p.emoji, name: p.name };
    }
    return { emoji: '🎛', name: 'Custom voice' };
  }, [vp.activePreset, vp.aiSuggestionReason]);

  // The active-voice chip is also an EDITOR: clicking it opens an inline
  // popover where the user can switch presets / saved profiles AND fine-tune
  // the live voice dials + comment spec. Any dial change clears the preset
  // (turning it into a fully modifiable "Custom voice"), so the voice the
  // tracker uses to draft comments is editable right here.
  const [voiceEditorOpen, setVoiceEditorOpen] = useState(false);

  const commentModalRef = React.useRef<HTMLDivElement>(null);
  const [notingLead, setNotingLead] = useState<any | null>(null);
  const [noteText, setNoteText] = useState('');

  // Responsive masonry column count for the Posts Tracker. Mirrors the old
  // Tailwind breakpoints (base=1, md=2, 2xl=3) but lets us distribute cards
  // into fixed columns by index — see the masonry render below.
  const [radarColumnCount, setRadarColumnCount] = useState(3);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      setRadarColumnCount(w >= 1536 ? 3 : w >= 768 ? 2 : 1);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const trackedUrls = useMemo(() => new Set(leads.map(l => l.url)), [leads]);

  // Auto-comment status indexed by post URL — populates the badges that
  // appear on each RadarPostCard. Polls the extension every 3s.
  const autoCommentStatusMap = useAutoCommentStatusMap();
  
  // 1. PUBLIC RADAR: Influencer tracking hits, excluding any recon or identified leads
  // ── Client-side profile-fit fallback ──────────────────────────────────
  // Tracked-account posts arrive from the extension WITHOUT a relevancyScore —
  // only the recon/discovery flow scores posts server-side, and that path
  // (DeepSeek) is both unreliable and never runs for tracked posts. So the fit
  // badge was simply missing for the whole Tracked-posts feed. We compute a
  // deterministic, explainable fit here from the project's own niche keywords,
  // used purely as a fallback when no numeric score exists. It is in-memory
  // only — we never write it back to social_radar_history, so a real score
  // (if one ever lands) still wins.
  const fitKeywords = useMemo(() => {
    const STOP = new Set(['the','and','for','with','that','this','your','you','our','are','was','from','into','out','who','how','why','what','when','will','can','all','any','one','two','get','got','use','used','using','via','per','etc','their','them','they','its','his','her','she','him','not','but','has','have','had','a','an','to','of','in','on','at','by','is','it','or','as','be','we','i','my','me','do','so','up','no','if','about','more','most','than','then','also','just','like','want','need','help','make','made','app','tool','tools','platform','product','users','user','people','founder','founders','growth']);
    const blob = [
      project?.productName, project?.category, project?.targetAudience,
      project?.valueProposition, project?.pitch, project?.competitors,
      appDesc,
    ].filter(Boolean).join(' ').toLowerCase();
    const words = blob.match(/[a-z0-9][a-z0-9+\-]{2,}/g) || [];
    const freq = new Map<string, number>();
    for (const w of words) { if (STOP.has(w)) continue; freq.set(w, (freq.get(w) || 0) + 1); }
    // Strong signal words (audience/category/value-prop) are the discriminating
    // ones; keep the highest-frequency distinct terms, capped so a long pitch
    // doesn't drown the signal.
    return new Set([...freq.keys()].slice(0, 48));
  }, [project?.productName, project?.category, project?.targetAudience, project?.valueProposition, project?.pitch, project?.competitors, appDesc]);

  const inferFit = (item: any): { score: number; reason: string } | null => {
    if (!fitKeywords.size) return null;
    const text = String(item?.text || item?.title || item?.content || '').toLowerCase();
    if (!text.trim()) return null;
    const matched: string[] = [];
    for (const kw of fitKeywords) {
      if (text.includes(kw)) matched.push(kw);
    }
    const hits = matched.length;
    // Smooth diminishing-returns curve: 0 hits → 38, 1 → 60, 2 → 73, 3 → 81,
    // 5 → 90, capped at 95 so an inferred score never poses as a perfect match.
    const score = Math.min(95, Math.round(38 + 57 * (1 - Math.exp(-hits / 2.2))));
    const reason = hits > 0
      ? `Estimated fit · matches your niche on ${matched.slice(0, 4).join(', ')}`
      : 'Estimated fit · no strong niche keywords in this post';
    return { score, reason };
  };

  const influencerSignals = useMemo(() => {
    return radarHistory.filter(item => {
      if (trackedUrls.has(item.url || item.uuid)) return false;
      const isRecon = item.isRecon ||
                      item.text?.includes('[RECON]') ||
                      item.platform?.toLowerCase().includes('recon') ||
                      item.campaignId;
      return !isRecon;
    }).map(item => {
      // Real DeepSeek score wins over everything (extension default, heuristic).
      const key = item.url || item.uuid;
      const ai = key ? aiFitScores[key] : null;
      if (ai) return { ...item, relevancyScore: ai.score, relevancyReason: ai.reason, _fitAI: true };
      // A bare relevancyScore of 100 with no reason is the extension's "promote
      // everything" default (or a scoring failure), NOT a real fit — it made every
      // post read as "100% profile fit". Treat it as unscored and re-estimate.
      const isBareDefault = item.relevancyScore === 100 && !item.relevancyReason;
      const hasRealScore = !isBareDefault &&
        (typeof item.relevancyScore === 'number' || typeof item.relevance === 'number');
      if (hasRealScore) return item;
      const inferred = inferFit(item);
      if (inferred) return { ...item, relevancyScore: inferred.score, relevancyReason: inferred.reason, _fitInferred: true };
      // Nothing to infer from and only a default → show as unscored, not a fake 100%.
      if (isBareDefault) { const { relevancyScore, relevance, ...rest } = item; return rest; }
      return item;
    });
  }, [radarHistory, trackedUrls, fitKeywords, aiFitScores]);

  // ── DeepSeek profile-fit scoring ──────────────────────────────────────
  // Score tracked posts that don't yet have a real AI fit, in small batches,
  // newest-first, and cache the result. This is what makes the fit badge a
  // realistic 0-100 (varied per post) instead of a flat 100%. Bounded per
  // mount so a large history can't run up the API bill.
  const MAX_AI_FIT_PER_MOUNT = 60;
  useEffect(() => {
    const product = project?.productName?.trim();
    const audience = project?.targetAudience?.trim();
    if (!product && !audience) return;               // no ICP context → keep heuristic
    if (fitScoringRef.current.busy) return;
    if (fitScoringRef.current.count >= MAX_AI_FIT_PER_MOUNT) return;

    const candidates = radarHistory.filter(item => {
      const key = item.url || item.uuid;
      if (!key || trackedUrls.has(key)) return false;
      if (aiFitScores[key] || fitScoringRef.current.done.has(key)) return false;
      const isRecon = item.isRecon || item.text?.includes('[RECON]') ||
        item.platform?.toLowerCase().includes('recon') || item.campaignId;
      if (isRecon) return false;
      return String(item.text || item.title || item.content || '').trim().length > 0;
    });
    if (!candidates.length) return;

    const room = MAX_AI_FIT_PER_MOUNT - fitScoringRef.current.count;
    const batch = candidates.slice(0, Math.min(24, room));   // newest-first (history is sorted)
    batch.forEach(i => fitScoringRef.current.done.add(i.url || i.uuid));
    fitScoringRef.current.busy = true;
    fitScoringRef.current.count += batch.length;

    (async () => {
      try {
        const ctx = { product, audience, pitch: project?.pitch, keywords: [...fitKeywords] };
        for (let i = 0; i < batch.length; i += 8) {
          const chunk = batch.slice(i, i + 8);
          const payload = chunk.map(it => ({
            key: it.url || it.uuid,
            author: it.author || it.authorName || it.name || '',
            text: String(it.text || it.title || it.content || ''),
            platform: it.platform || ''
          }));
          let results: { key: string; score: number; reason: string }[] = [];
          try { results = await scoreProfileFits(payload, ctx); }
          catch (e) { console.warn('[profile-fit] scoring failed', e); continue; }
          if (results.length) {
            setAiFitScores(prev => {
              const next = { ...prev };
              for (const r of results) if (r.key) next[r.key] = { score: r.score, reason: r.reason };
              try { localStorage.setItem('profile_fit_cache_v1', JSON.stringify(next)); } catch {}
              return next;
            });
          }
        }
      } finally {
        fitScoringRef.current.busy = false;
      }
    })();
  }, [radarHistory, trackedUrls, aiFitScores, fitKeywords, project?.productName, project?.targetAudience, project?.pitch]);

  // 2. RECON SIGNALS: Hits from automated missions that aren't in the pipeline yet
  const newReconSignals = useMemo(() => {
    let disqualified = new Set();
    try {
        const raw = localStorage.getItem('disqualified_signals');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) disqualified = new Set(parsed);
        }
    } catch(e) { console.error("Triage parse error:", e); }
    
    return radarHistory.filter(item => {
      const id = item.url || item.uuid;
      if (trackedUrls.has(id) || disqualified.has(id as any)) return false;
      const isRecon = item.isRecon || 
                      item.text?.includes('[RECON]') || 
                      item.platform?.toLowerCase().includes('recon') ||
                      item.campaignId;
      return isRecon;
    });
  }, [radarHistory, trackedUrls]);

  useEffect(() => {
    let answerlyExtHistory: any[] = [];
    const loadLocalData = () => {
        try {
            const histRaw = localStorage.getItem('social_radar_history');
            const pipelineRaw = localStorage.getItem('pipeline_leads_unified');
            const hist = histRaw ? JSON.parse(histRaw) : [];
            const pl = pipelineRaw ? JSON.parse(pipelineRaw) : [];
            setLeads(pl.map((l: any) => ({ ...l, interactions: l.interactions || [], status: l.status || 'new' })));
            return hist;
        } catch(e) { return []; }
    };
    const updateCombinedHistory = () => {
        const localHist = loadLocalData();
        const combined = [...localHist, ...answerlyExtHistory];
        const uniqueMap = new Map();
        combined.forEach(item => { uniqueMap.set(item.uuid || item.url, item); });
        const sorted = Array.from(uniqueMap.values()).sort((a: any, b: any) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        // Show every tracked post — no cap. Posts only leave the list when deleted.
        const capped = sorted;
        setRadarHistory(capped);
        // Mirror to localStorage so the Dashboard "Posts Tracker activity"
        // chart has data (it reads social_radar_history synchronously).
        try { localStorage.setItem('social_radar_history', JSON.stringify(capped)); } catch {}
        if (localHist.length > 0 || answerlyExtHistory.length > 0) setExtensionConnected(true);
    };
    const handlePong = () => setExtensionConnected(true);
    const handleHistory = (e: any) => {
        answerlyExtHistory = e.detail || [];
        updateCombinedHistory();
    };
    const handleStorage = () => updateCombinedHistory();
    const handleSync = (e: any) => {
        if (e.detail && Array.isArray(e.detail)) {
            const extLeads = e.detail;
            setLeads(extLeads.map((l: any) => ({ ...l, interactions: l.interactions || [], status: l.status || 'new' })));
            localStorage.setItem('pipeline_leads_unified', JSON.stringify(extLeads));
        }
        updateCombinedHistory();
    };
    window.addEventListener('answerly_pong', handlePong);
    window.addEventListener('answerly_history_update', handleHistory);
    window.addEventListener('pipeline_leads_update', handleSync);
    window.addEventListener('storage', handleStorage);
    updateCombinedHistory();
    const sync = () => {
        window.dispatchEvent(new CustomEvent('answerly_ping'));
        window.dispatchEvent(new CustomEvent('answerly_request_history'));
    };
    const interval = setInterval(sync, 10000);
    sync();
    return () => {
        window.removeEventListener('answerly_pong', handlePong);
        window.removeEventListener('answerly_history_update', handleHistory);
        window.removeEventListener('pipeline_leads_update', handleSync);
        window.removeEventListener('storage', handleStorage);
        clearInterval(interval);
    };
  }, []);

  // Auto-reply DRAFTS awaiting the user's confirmation. Shown under their post.
  useEffect(() => {
    const onDrafts = (e: any) => {
      const d = e.detail;
      if (Array.isArray(d)) setDrafts(d.filter((x: any) => x.status === 'pending'));
      else if (d?.success) setDrafts(d.drafts || []);
    };
    window.addEventListener('auto_comment_drafts_update', onDrafts);
    window.addEventListener('auto_comment_drafts_loaded', onDrafts);
    const ping = () => window.dispatchEvent(new CustomEvent('auto_comment_drafts_get'));
    ping();
    const id = setInterval(ping, 5000);
    return () => {
      clearInterval(id);
      window.removeEventListener('auto_comment_drafts_update', onDrafts);
      window.removeEventListener('auto_comment_drafts_loaded', onDrafts);
    };
  }, []);

  const draftByPostUrl = useMemo(() => {
    const m = new Map<string, any>();
    drafts.forEach(d => m.set(d.postUrl, d));
    return m;
  }, [drafts]);

  const handleConfirmDraft = (postUrl: string, comment: string) => {
    window.dispatchEvent(new CustomEvent('auto_comment_confirm', { detail: { postUrl, comment } }));
    setDrafts(prev => prev.filter(d => d.postUrl !== postUrl));
  };
  const handleDiscardDraft = (postUrl: string) => {
    window.dispatchEvent(new CustomEvent('auto_comment_discard', { detail: { postUrl } }));
    setDrafts(prev => prev.filter(d => d.postUrl !== postUrl));
  };
  const handleRemovePost = (item: any) => {
    window.dispatchEvent(new CustomEvent('posts_remove', { detail: { uuid: item.uuid, postUrl: item.postUrl || item.url } }));
    setRadarHistory(prev => {
      const next = prev.filter(h => (h.uuid || h.url) !== (item.uuid || item.url));
      // The list is a merge of the extension history AND the localStorage mirror
      // (`social_radar_history`). If we don't update the mirror too, the next
      // updateCombinedHistory() (fires every 10s) re-merges the stale item back
      // — which is why "delete" looked broken. Keep the mirror in sync.
      try { localStorage.setItem('social_radar_history', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const handleClearPosts = () => {
    window.dispatchEvent(new CustomEvent('posts_clear'));
    setRadarHistory([]);
    // Clear the localStorage mirror too, otherwise updateCombinedHistory()
    // repopulates the list from the stale mirror within ~10s ("Clear all"
    // appeared to do nothing).
    try { localStorage.setItem('social_radar_history', '[]'); } catch {}
  };

  const handleTrackInPipeline = (item: any) => {
    if (trackedUrls.has(item.url)) return;
    const newLead = {
        url: item.url,
        postUrl: item.postUrl || item.url,
        name: item.creator || item.name || item.title || item.url.split('/').pop(),
        why: item.why || item.reason || "Detected via Inbound Radar",
        postText: item.text || item.body,
        relevance: Math.floor(Math.random() * 20) + 80,
        scannedAt: new Date().toISOString(),
        status: 'new',
        interactions: [],
        timestamp: item.timestamp || new Date().toISOString(), // Use original discovery time
        tags: [item.platform, 'Radar'],
        campaignId: item.campaignId,
        campaignName: item.campaignName,
        intent: item.intent
    };
    const updated = [newLead, ...leads];
    setLeads(updated as any);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const updateLeadStatus = (url: string, newStatus: PipelineLead['status']) => {
    const updated = leads.map(d => d.url === url ? { ...d, status: newStatus } : d);
    setLeads(updated);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
  };

  const removeLead = (url: string) => {
    setLeads(prev => {
        const updated = prev.filter(l => l.url !== url);
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
        return updated;
    });
    setSelectedLeads(prev => { const next = new Set(prev); next.delete(url); return next; });
  };

  const logInteraction = (leadOrUrl: any, type: LeadInteraction['type']) => {
    const url = typeof leadOrUrl === 'string' ? leadOrUrl : (leadOrUrl.url || leadOrUrl.uuid);
    let existing = leads.find(l => l.url === url);
    let currentLeads = [...leads];
    
    if (!existing && typeof leadOrUrl !== 'string') {
        existing = {
            url: url,
            postUrl: leadOrUrl.postUrl || leadOrUrl.url || leadOrUrl.uuid,
            name: leadOrUrl.creator || leadOrUrl.name || leadOrUrl.title,
            why: leadOrUrl.why || leadOrUrl.reason || "Detected via Inbound Radar",
            postText: leadOrUrl.text || leadOrUrl.body || leadOrUrl.postText,
            relevance: leadOrUrl.relevance || Math.floor(Math.random() * 20) + 80,
            scannedAt: new Date().toISOString(),
            status: 'new',
            interactions: [],
            timestamp: new Date().toISOString(),
            tags: [leadOrUrl.platform, 'Radar'],
            campaignId: leadOrUrl.campaignId,
            campaignName: leadOrUrl.campaignName,
            intent: leadOrUrl.intent
        };
        currentLeads = [existing, ...currentLeads];
    }

    if (!existing && typeof leadOrUrl === 'string') return;

    const updatedLeads = currentLeads.map(l => l.url === url ? { 
        ...l, 
        interactions: [...(l.interactions || []), { type, timestamp: new Date().toISOString() }],
        status: (type === 'like' && l.status === 'new') ? 'engaging' : l.status
    } : l);
    
    setLeads(updatedLeads as any);
    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updatedLeads));
  };

  const getWarmupScore = (lead: any) => {
      let score = lead.relevance ? Math.floor(lead.relevance / 2) : 20; // Base: 0-50
      (lead.interactions || []).forEach((i: any) => {
          if (i.type === 'like') score += 15;
          if (i.type === 'reply' || i.type === 'comment') score += 30;
      });
      return Math.min(100, score);
  };

  const toggleSelectLead = (url: string) => {
    const next = new Set(selectedLeads);
    if (next.has(url)) next.delete(url); else next.add(url);
    setSelectedLeads(next);
  };

  const handleDiscardSignal = (signal: any) => {
    // 1. Internal State Update
    const id = signal.url || signal.uuid;
    const currentDisqualified = JSON.parse(localStorage.getItem('disqualified_signals') || '[]');
    if (!currentDisqualified.includes(id)) {
        localStorage.setItem('disqualified_signals', JSON.stringify([...currentDisqualified, id]));
    }
    
    // 2. Adaptive Learning Feedback Loop
    if (signal.campaignId) {
        const campaignsRaw = localStorage.getItem('icp_recon_campaigns');
        if (campaignsRaw) {
            try {
                let campaigns = JSON.parse(campaignsRaw);
                const idx = campaigns.findIndex((c: any) => c.id === signal.campaignId);
                
                if (idx !== -1) {
                    const campaign = campaigns[idx];
                    // Analyze profile for negative keywords to exclude
                    const roleText = (signal.role || signal.creator || "").toLowerCase();
                    const commonNoise = ['specialist', 'agency', 'expert', 'consultant', 'freelancer', 'coach', 'guru', 'service', 'solutions', 'partner'];
                    const foundNoise = commonNoise.filter(k => roleText.includes(k));
                    
                    if (foundNoise.length > 0) {
                        const existingNegs = campaign.negativeKeywords || [];
                        const updatedNegs = [...new Set([...existingNegs, ...foundNoise])];
                        
                        campaigns[idx] = { ...campaign, negativeKeywords: updatedNegs };
                        localStorage.setItem('icp_recon_campaigns', JSON.stringify(campaigns));
                        
                        // V4.2: Update Global Intel
                        const globalRaw = localStorage.getItem('global_negative_keywords');
                        const globals = globalRaw ? JSON.parse(globalRaw) : [];
                        const updatedGlobals = [...new Set([...globals, ...foundNoise])];
                        localStorage.setItem('global_negative_keywords', JSON.stringify(updatedGlobals));

                        // Update active campaign if it matches (for live UI update)
                        const activeRaw = localStorage.getItem('icp_recon_active_campaign');
                        if (activeRaw) {
                            const active = JSON.parse(activeRaw);
                            if (active.id === signal.campaignId) {
                                active.negativeKeywords = updatedNegs;
                                localStorage.setItem('icp_recon_active_campaign', JSON.stringify(active));
                            }
                        }

                        console.log(`[Adaptive Learning] Added exclusions for ${signal.campaignName}:`, foundNoise);
                        
                        // Notify ICP dashboard to refresh mission DNA if needed
                        window.dispatchEvent(new CustomEvent('icp_campaign_updated', { detail: { campaignId: signal.campaignId } }));
                    }
                }
            } catch(e) { console.error("Learning loop failed:", e); }
        }
    }

    setRadarHistory(prev => {
      const next = prev.filter(h => (h.url || h.uuid) !== id);
      try { localStorage.setItem('social_radar_history', JSON.stringify(next)); } catch {}
      return next;
    });
  };



  const saveNote = (lead: any, note: string) => {
    const url = lead.url || lead.uuid;
    const updatedLeads = leads.map(l => l.url === url ? { ...l, note } : l);
    // If lead is from recon and not tracked yet, add to pipeline with note
    if (!leads.find(l => l.url === url)) {
        const newLead = {
            url, 
            postUrl: lead.postUrl || lead.url || url,
            name: lead.creator || lead.title || lead.name, 
            why: note || "Detected via Radar",
            postText: lead.text || lead.body, 
            relevance: 80, 
            scannedAt: new Date().toISOString(),
            status: 'new' as const, 
            interactions: [], 
            tags: [lead.platform], 
            note
        };
        const updated = [newLead, ...leads];
        setLeads(updated as any);
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
    } else {
        setLeads(updatedLeads as any);
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updatedLeads));
    }
    setNotingLead(null);
    setNoteText('');
  };

  const qualifyLead = (url: string, qualified: boolean) => {
    setLeads(prev => {
        const updated = prev.map(l => l.url === url 
            ? { ...l, qualified, status: qualified ? 'engaging' as const : 'new' as const } 
            : l
        );
        localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
        return updated;
    });
  };

  // One-tap repost — no composer needed. Dispatches straight to the bridge,
  // which queues a stealth repost on the post's URL. Nothing posts until the
  // extension processes the queue (still human-gated by the click here).
  function handleRepost(item: any) {
    const targetUrl = item.postUrl || item.url;
    if (!targetUrl) return;
    window.dispatchEvent(new CustomEvent('pipeline_request_repost', { detail: { url: targetUrl } }));
    logInteraction(item, 'repost');
  }

  // Quote — reuse the smart-reply composer, but flag the action as a
  // quote-tweet so Send Now dispatches actionType 'quote'.
  function handleQuote(item: any) {
    handleOpenSmartReply(item, true, 'quote');
  }

  async function handleOpenSmartReply(lead: any, isRadarSignal = false, action: 'comment' | 'quote' = 'comment') {
    setEngagementAction(action);
    let targetLead = lead;
    const mode = isRadarSignal ? 'visibility' : 'lead';
    if (isRadarSignal) {
        handleTrackInPipeline(lead);
        targetLead = {
            url: lead.url,
            postUrl: lead.postUrl || lead.url,
            title: lead.creator,
            why: "Detected via Inbound Radar",
            postText: lead.text || lead.body,
            tags: [lead.platform],
            campaignId: lead.campaignId,
            campaignName: lead.campaignName,
            intent: lead.intent,
            // Carry any queued Feed Watcher draft through so the modal can
            // pre-fill it for one-tap approval.
            suggestedComment: lead.suggestedComment,
            suggestedAction: lead.suggestedAction,
            engagementRationale: lead.engagementRationale,
            engagementStatus: lead.engagementStatus
        };
    }
    setCommentingLead(targetLead);
    setCommentMode(mode);
    // If the Feed Watcher already drafted a reply for this post (queue-only),
    // pre-fill the modal with it so the user reviews & approves instead of
    // generating from scratch. Nothing was posted — this is the approval step.
    const queuedDraft = (lead.suggestedComment || '').trim();
    if (queuedDraft) {
        setSmartComments({ options: [{ body: queuedDraft, why: lead.engagementRationale || 'Drafted by the Feed Watcher in your voice — review and send.' }] });
    } else {
        setSmartComments(null);
    }
    setIsGeneratingComment(false); // Don't auto-generate; let user set options first
  }

  async function generateComments() {
    if (!commentingLead) return;
    setSmartComments(null);
    setIsGeneratingComment(true);
    try {
        const result = await generateSmartEngagementComment(
            commentingLead.postText || commentingLead.why || '',
            appDesc || 'A growth platform',
            commentingLead.title || commentingLead.creator || '',
            // Pass the active voice profile so the generated comment matches
            // whichever saved profile is currently applied (or the user's
            // current Voice Studio settings).
            { ...vp.commentSpec, mode: commentMode as any, voiceMix: vp.voiceMix, perspective: vp.perspective }
        );
        setSmartComments(result);
        setEditedComments({}); // fresh generation → drop any prior edits
    } catch (e) { console.error(e); }
    finally { setIsGeneratingComment(false); }
  }

  // ── Batch comment helpers (multi-select in the Posts Tracker) ──
  const postKey = (item: any) => item?.postUrl || item?.url || item?.uuid || '';

  // ── Inline single-comment handlers ──
  // Clicking "Comment" generates a reply straight into the card using the active
  // Voice Studio parameters — no modal, no extra "Generate" click. This mirrors
  // the auto-reply draft experience for manual replies.
  async function handleInlineComment(item: any) {
    const k = postKey(item);
    if (!k) return;
    setInlineStates(prev => ({ ...prev, [k]: 'generating' }));
    setInlineDrafts(prev => ({ ...prev, [k]: '' }));
    try {
      const result = await generateSmartEngagementComment(
        item.postText || item.text || item.body || item.why || '',
        appDesc || 'A growth platform',
        item.title || item.creator || '',
        { ...vp.commentSpec, mode: 'visibility' as any, voiceMix: vp.voiceMix, perspective: vp.perspective }
      );
      const body = (result?.options?.[0]?.body || '').trim();
      if (body) {
        setInlineDrafts(prev => ({ ...prev, [k]: body }));
        setInlineStates(prev => ({ ...prev, [k]: 'done' }));
      } else {
        setInlineStates(prev => ({ ...prev, [k]: 'error' }));
      }
    } catch (e) {
      console.error('inline comment failed', e);
      setInlineStates(prev => ({ ...prev, [k]: 'error' }));
    }
  }

  // Approve & queue the inline draft. Queue-only, human-in-the-loop — the user
  // explicitly pressed Approve. Same dispatch path as the modal's "Send Now".
  function handleInlinePost(item: any, text: string) {
    const clean = (text || '').trim();
    if (!clean) return;
    window.dispatchEvent(new CustomEvent('pipeline_queue_engagement', {
      detail: { lead: { ...item, actionType: 'comment', commentText: clean } }
    }));
    logInteraction(item, 'reply');
    markReplied(item, clean);
    const k = postKey(item);
    setInlineStates(prev => { const m = { ...prev }; delete m[k]; return m; });
    setInlineDrafts(prev => { const m = { ...prev }; delete m[k]; return m; });
  }

  function handleInlineDiscard(item: any) {
    const k = postKey(item);
    setInlineStates(prev => { const m = { ...prev }; delete m[k]; return m; });
    setInlineDrafts(prev => { const m = { ...prev }; delete m[k]; return m; });
  }

  const toggleSelectPost = (item: any) => {
    const k = postKey(item);
    if (!k) return;
    setSelectedPosts(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const clearBatchSelection = () => {
    setSelectedPosts(new Set());
    setBatchDrafts({});
    setBatchStates({});
  };

  // Generate a comment for every selected post, in the active voice — same
  // generator the single composer + auto-reply use. Runs sequentially to stay
  // within the Gemini rate budget and so the user watches drafts populate.
  async function generateBatchComments() {
    const items = influencerSignals.filter((it: any) => selectedPosts.has(postKey(it)));
    if (items.length === 0 || isBatchRunning) return;
    setIsBatchRunning(true);
    // Mark all selected as generating up front.
    setBatchStates(() => {
      const m: Record<string, 'generating' | 'done' | 'error'> = {};
      items.forEach(it => { m[postKey(it)] = 'generating'; });
      return m;
    });
    for (const it of items) {
      const k = postKey(it);
      try {
        const result = await generateSmartEngagementComment(
          it.postText || it.text || it.body || it.why || '',
          appDesc || 'A growth platform',
          it.title || it.creator || '',
          { ...vp.commentSpec, mode: 'visibility' as any, voiceMix: vp.voiceMix, perspective: vp.perspective }
        );
        const body = (result?.options?.[0]?.body || '').trim();
        if (body) {
          setBatchDrafts(prev => ({ ...prev, [k]: body }));
          setBatchStates(prev => ({ ...prev, [k]: 'done' }));
        } else {
          setBatchStates(prev => ({ ...prev, [k]: 'error' }));
        }
      } catch (e) {
        console.error('batch comment failed', e);
        setBatchStates(prev => ({ ...prev, [k]: 'error' }));
      }
    }
    setIsBatchRunning(false);
  }

  // Publish (queue) every selected post that has a non-empty draft. Queue-only,
  // human-in-the-loop: the user explicitly selected these and pressed Publish.
  function publishBatchComments() {
    const items = influencerSignals.filter((it: any) => selectedPosts.has(postKey(it)));
    let published = 0;
    items.forEach(it => {
      const k = postKey(it);
      const text = (batchDrafts[k] || '').trim();
      if (!text) return;
      window.dispatchEvent(new CustomEvent('pipeline_queue_engagement', {
        detail: { lead: { ...it, actionType: 'comment', commentText: text } }
      }));
      logInteraction(it, 'reply');
      markReplied(it, text);
      published++;
    });
    if (published > 0) clearBatchSelection();
  }

  const selectedReadyCount = useMemo(
    () => influencerSignals.filter((it: any) => selectedPosts.has(postKey(it)) && (batchDrafts[postKey(it)] || '').trim()).length,
    [influencerSignals, selectedPosts, batchDrafts]
  );

  // Apply the Posts Tracker filters (min profile-fit %, platform) to the feed.
  const getFit = (it: any): number | null =>
    typeof it?.relevancyScore === 'number' ? it.relevancyScore
    : typeof it?.relevance === 'number' ? it.relevance : null;
  const filteredSignals = useMemo(() => {
    return influencerSignals.filter((it: any) => {
      if (minFit > 0) {
        const f = getFit(it);
        if (f === null || f < minFit) return false;
      }
      if (platformFilter !== 'all') {
        const p = String(it.platform || '').toLowerCase();
        const isX = p.includes('x') || p.includes('twitter');
        const isLi = p.includes('linkedin');
        const isRe = p.includes('reddit');
        if (platformFilter === 'x' && !isX) return false;
        if (platformFilter === 'linkedin' && !isLi) return false;
        if (platformFilter === 'reddit' && !isRe) return false;
      }
      return true;
    });
  }, [influencerSignals, minFit, platformFilter]);

  // Paginate the filtered feed. pageCount is at least 1 so the controls render
  // sanely even when there are zero posts. clamp page to the last valid index
  // if the underlying list shrinks (e.g. user deletes posts on the last page).
  const pageCount = Math.max(1, Math.ceil(filteredSignals.length / POSTS_PER_PAGE));
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);
  const safePage = Math.min(page, pageCount - 1);
  const pagedSignals = useMemo(
    () => filteredSignals.slice(safePage * POSTS_PER_PAGE, (safePage + 1) * POSTS_PER_PAGE),
    [filteredSignals, safePage]
  );

  // Mark a post as "You replied" the instant the user fires a manual comment,
  // so the radar badge updates without waiting for the auto-pipeline. Writes
  // to the extension's unified comment_log (survives the 3s refresh) AND
  // optimistically updates the in-page mirror so the badge flips immediately.
  const markReplied = (lead: any, text: string) => {
    const url = lead?.postUrl || lead?.url || lead?.uuid;
    if (!url) return;
    try {
      window.dispatchEvent(new CustomEvent('comment_log_add', { detail: {
        url,
        source: 'manual',
        comment: text,
        creator: lead.creator || lead.name || lead.title || null,
        platform: lead.platform || null,
      }}));
      // Optimistic local mirror + instant rebuild for the status-map hook.
      const log = JSON.parse(localStorage.getItem('comment_log') || '[]');
      if (!log.some((c: any) => (c.url || c.postUrl) === url)) {
        log.unshift({ at: Date.now(), url, source: 'manual', commentPreview: (text || '').slice(0, 200) });
        localStorage.setItem('comment_log', JSON.stringify(log.slice(0, 200)));
        window.dispatchEvent(new CustomEvent('comment_log_loaded', { detail: { success: true, log } }));
      }
    } catch (e) { console.warn('markReplied failed', e); }
  };

  // The comment modal is `position: fixed` + flex-centered, so it is always
  // pinned to the middle of the viewport. We intentionally do NOT scrollIntoView
  // anymore (it caused the page behind to jump); the overlay handles visibility.

  const getPlatformIcon = (platformInput: any = 'X', isDark = false) => {
    const platform = String(platformInput || 'X').toLowerCase();
    const xColor = isDark ? "text-white" : "text-gray-900";
    if (platform.includes('twitter') || platform.includes('x')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={xColor}>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
    );
    if (platform.includes('linkedin')) return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-blue-500">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
    );
    if (platform.includes('reddit')) return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-orange-500">
            <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.05l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.057 1.597.047.222.069.447.069.675 0 2.212-2.39 4.012-5.338 4.012s-5.338-1.8-5.338-4.012c0-.218.021-.432.065-.644a1.745 1.745 0 0 1-1.025-1.586c0-.968.786-1.754 1.754-1.754.463 0 .875.18 1.179.473 1.17-.834 2.8-1.393 4.602-1.474l.522-2.462 3.03.64zm-7.422 7.871c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.281-.574 1.281-1.282 0-.708-.573-1.282-1.281-1.282zm4.825 0c-.708 0-1.282.574-1.282 1.282 0 .708.574 1.282 1.282 1.282.708 0 1.282-.574 1.282-1.282 0-.708-.574-1.282-1.282-1.282zm-2.377 3.724c-.232 0-.46.015-.685.042-.254.031-.498.08-.733.146-.147.042-.273.106-.381.187a.327.327 0 0 0-.099.448.327.327 0 0 0 .448.099c.071-.054.17-.102.289-.138.169-.047.346-.083.53-.105.19-.023.389-.035.592-.035.204 0 .403.012.593.035.184.022.361.058.53.105.119.036.218.084.289.138a.327.327 0 0 0 .448-.099.327.327 0 0 0-.099-.448c-.108-.081-.234-.145-.381-.187a3.984 3.984 0 0 0-.733-.146c-.225-.027-.453-.042-.685-.042z"/>
        </svg>
    );
    return <ShieldCheck size={20} className="text-gray-400" />;
  };

  return (
    <div className="min-h-screen">
      <div className="py-2 animate-fade-in max-w-[1600px] mx-auto px-1 sm:px-2">
        <header className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-display font-medium text-gray-900 tracking-tight">Tracked posts</h2>
            <p className="text-sm text-gray-500 mt-0.5">New posts from accounts you follow — be first to engage.</p>

            {/* ── Comment-voice control ──
                The Avg-Fit KPI that used to sit here was removed: it duplicated
                the per-post fit badges and the fit filter just below. What's
                left is a single, self-sized control telling the user WHICH
                voice the agent writes comments in — click to switch / fine-tune. */}
            <div className="mt-4">
              {/* Active voice — a self-sized pill, not a stretched card */}
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setVoiceEditorOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={voiceEditorOpen}
                  className="group flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-full bg-white border border-gray-200 hover:border-violet-300 hover:shadow-md shadow-sm transition-all text-gray-800"
                  title="Comments in the tracker are generated with this voice. Click to switch or fine-tune it."
                >
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm" aria-hidden="true">
                    <Sparkles size={15} />
                  </span>
                  <span className="flex flex-col items-start leading-tight text-left">
                    <span className="text-[8px] font-black uppercase tracking-[0.18em] text-gray-400">Comment voice</span>
                    <span className="text-[13px] font-bold leading-none mt-0.5 text-gray-900">{activeVoice.emoji} {activeVoice.name}</span>
                  </span>
                  <span className={`ml-1 text-[10px] text-gray-400 group-hover:text-violet-500 transition-transform ${voiceEditorOpen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
                </button>
              {voiceEditorOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setVoiceEditorOpen(false)} />
                  <div className="absolute left-0 top-full mt-2 z-50 w-[360px] max-h-[72vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl p-4 text-left animate-fade-in">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-black uppercase tracking-wider text-gray-400">Voice for comments</span>
                      <button onClick={() => setVoiceEditorOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={14} /></button>
                    </div>

                    {/* Saved voices ONLY. The tracker writes comments in a voice
                        you deliberately built and saved in Voice Studio — no
                        built-in presets are offered here, so the comment voice
                        is always one you authored. Picking one calls
                        vp.applySavedProfile, which updates the voiceMix/spec
                        that generation reads. */}
                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1.5">Your saved voices</p>
                    {vp.library.length > 0 ? (
                      <div className="space-y-1.5 mb-3">
                        {vp.library.map(s => {
                          const active = (vp.aiSuggestionReason || '') === `Saved profile · ${s.name}`;
                          return (
                            <button
                              key={s.id}
                              onClick={() => { vp.applySavedProfile(s.id); setVoiceEditorOpen(false); }}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left border transition-colors ${active ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300 hover:bg-violet-50'}`}
                              title={s.note || s.name}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <span>💾</span>
                                <span className="text-[12px] font-bold truncate">{s.name}</span>
                              </span>
                              {active && <Check size={14} className="shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mb-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center">
                        <p className="text-[12px] font-semibold text-gray-600">No saved voices yet</p>
                        <p className="text-[11px] text-gray-400 leading-snug mt-1">Build and save a voice in <span className="font-semibold">Voice Studio</span>, then pick it here to write every comment in it.</p>
                      </div>
                    )}

                    <p className="text-[10px] text-gray-400 leading-snug">
                      Comments in the tracker are written in your selected saved voice. Create or fine-tune voices in <span className="font-semibold">Voice Studio</span>.
                    </p>
                  </div>
                </>
              )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {influencerSignals.length > 0 && (
              <button
                onClick={handleClearPosts}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-tighter border border-gray-200 text-gray-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                title="Remove every post from the tracker"
              >
                <Trash2 size={12} /> Clear all
              </button>
            )}
            {!extensionConnected ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-500 rounded-2xl text-[10px] font-black uppercase tracking-tighter border border-rose-100 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    Disconnected
                </div>
            ) : (
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-500 rounded-2xl text-[10px] font-black uppercase tracking-tighter border border-emerald-100">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Active
                </div>
            )}
          </div>
        </header>

        {/* Batch selection toolbar + filters — select posts, generate comments
            for all of them at once (same generator as auto-reply), then publish
            the ones you keep. Filters narrow the feed by profile-fit % and
            platform. Only shown when there are posts to act on. */}
        {influencerSignals.length > 0 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                const pageKeys = pagedSignals.map((it: any) => postKey(it)).filter(Boolean);
                const allSelected = pageKeys.length > 0 && pageKeys.every(k => selectedPosts.has(k));
                setSelectedPosts(prev => {
                  const next = new Set(prev);
                  if (allSelected) pageKeys.forEach(k => next.delete(k));
                  else pageKeys.forEach(k => next.add(k));
                  return next;
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700 bg-white transition-colors"
            >
              <Check size={12} />
              {pagedSignals.length > 0 && pagedSignals.every((it: any) => selectedPosts.has(postKey(it))) ? 'Deselect page' : 'Select page'}
            </button>
            <span className="text-[11px] text-gray-400">{selectedPosts.size > 0 ? `${selectedPosts.size} selected` : 'Tick posts to batch-generate comments'}</span>

            <div className="w-px h-5 bg-gray-200 mx-1" />

            {/* Profile-fit filter */}
            <div className="flex items-center gap-1.5">
              <Target size={12} className="text-gray-400" />
              <select
                value={minFit}
                onChange={e => setMinFit(Number(e.target.value))}
                className="text-[11px] font-semibold border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-blue-400"
                title="Only show posts at or above this profile fit"
              >
                <option value={0}>Any fit</option>
                <option value={80}>≥ 80% · strong</option>
                <option value={65}>≥ 65% · good</option>
                <option value={50}>≥ 50% · moderate</option>
                <option value={35}>≥ 35% · weak+</option>
              </select>
            </div>

            {/* Platform filter */}
            <div className="flex items-center gap-1">
              {([['all', 'All'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['reddit', 'Reddit']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setPlatformFilter(val as any)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                    platformFilter === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >{label}</button>
              ))}
            </div>

            {(minFit > 0 || platformFilter !== 'all') && (
              <span className="text-[11px] text-gray-400">{filteredSignals.length} / {influencerSignals.length} shown</span>
            )}
          </div>
        )}

        {/* Today's Activity — quick metrics */}
        {(() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todayPostsCount = influencerSignals.filter((p: any) => {
            const postTime = new Date(p.timestamp || p.scannedAt || new Date());
            postTime.setHours(0, 0, 0, 0);
            return postTime.getTime() === today.getTime();
          }).length;

          const commentLogRaw = localStorage.getItem('comment_log') || '[]';
          const commentLog = JSON.parse(commentLogRaw);
          const todayReplies = commentLog.filter((c: any) => {
            const commentTime = new Date(c.at || 0);
            commentTime.setHours(0, 0, 0, 0);
            return commentTime.getTime() === today.getTime();
          }).length;

          if (todayPostsCount > 0 || todayReplies > 0) {
            return (
              <div className="mb-6 grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100">
                  <div className="p-2 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                    <Zap size={16} />
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-600">Today's posts</span>
                    <div className="text-xl font-bold text-blue-900 leading-none">{todayPostsCount}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100">
                  <div className="p-2 rounded-xl bg-violet-600 text-white flex items-center justify-center">
                    <MessageSquarePlus size={16} />
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-violet-600">Replies today</span>
                    <div className="text-xl font-bold text-violet-900 leading-none">{todayReplies}</div>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Posts feed — a responsive masonry grid that fills the width on
            large screens (1 col on mobile, up to 3 wide on big displays) so we
            stop wasting the side space. break-inside-avoid keeps each card
            whole within its column. */}
        <div className="space-y-3">
                {influencerSignals.length === 0 ? (
                    <div className="py-20 px-6 text-center bg-white/70 rounded-3xl border border-dashed border-gray-200">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-900/5 flex items-center justify-center">
                            <Radar size={26} className="text-gray-400" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-700">No new posts yet</h3>
                        <p className="text-[13px] text-gray-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                            When an account you track posts something, it lands here. Add accounts in the Account Finder and keep this tab open.
                        </p>
                    </div>
                ) : filteredSignals.length === 0 ? (
                    <div className="py-16 px-6 text-center bg-white/70 rounded-3xl border border-dashed border-gray-200">
                        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-900/5 flex items-center justify-center">
                            <Target size={26} className="text-gray-400" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-700">No posts match your filters</h3>
                        <p className="text-[13px] text-gray-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                            {influencerSignals.length} post{influencerSignals.length === 1 ? '' : 's'} hidden by the current fit / platform filters. Lower the profile-fit threshold or switch the platform to “All”.
                        </p>
                        <button
                            onClick={() => { setMinFit(0); setPlatformFilter('all'); }}
                            className="mt-4 px-3.5 py-2 rounded-lg text-[12px] font-semibold bg-gray-900 text-white hover:bg-gray-700 transition-colors"
                        >Clear filters</button>
                    </div>
                ) : (
                    <div className="flex gap-4 items-start">
                        {/* MASONRY (round-robin columns). Cards are distributed
                            into a fixed number of columns by index (i % count),
                            so every card has a PERMANENT column — expanding one
                            card (inline comment editor / selection UI) only grows
                            its own column and never reorders or jumps siblings,
                            which was the failure of the old balanced CSS masonry.
                            Within a column cards stack with no vertical gaps, so
                            there is no empty space between posts (the grid left
                            gaps below shorter cards in each row). */}
                        {Array.from({ length: radarColumnCount }, (_, colIndex) => (
                            <div key={colIndex} className="flex-1 min-w-0 flex flex-col gap-4">
                                {/* Render only the current page so the DOM
                                    stays small — the tracker used to slow to a
                                    crawl with hundreds of cards mounted. */}
                                {pagedSignals
                                    .filter((_: any, i: number) => i % radarColumnCount === colIndex)
                                    .map((item: any) => (
                                        <div key={item.uuid || item.url} className="min-w-0">
                                            <RadarPostCard
                                                item={item}
                                                getPlatformIcon={getPlatformIcon}
                                                onComment={() => handleInlineComment(item)}
                                                commentStatus={autoCommentStatusMap.get(item.postUrl || item.url)}
                                                draft={draftByPostUrl.get(item.postUrl || item.url)}
                                                onConfirmDraft={handleConfirmDraft}
                                                onDiscardDraft={handleDiscardDraft}
                                                onRemovePost={() => handleRemovePost(item)}
                                                onRepost={() => handleRepost(item)}
                                                onQuote={() => handleQuote(item)}
                                                selected={selectedPosts.has(item.postUrl || item.url || item.uuid)}
                                                onToggleSelect={() => toggleSelectPost(item)}
                                                batchDraft={batchDrafts[item.postUrl || item.url || item.uuid]}
                                                batchState={batchStates[item.postUrl || item.url || item.uuid]}
                                                onBatchDraftChange={(t) => setBatchDrafts(prev => ({ ...prev, [item.postUrl || item.url || item.uuid]: t }))}
                                                inlineDraft={inlineDrafts[item.postUrl || item.url || item.uuid]}
                                                inlineState={inlineStates[item.postUrl || item.url || item.uuid]}
                                                onInlineDraftChange={(t) => setInlineDrafts(prev => ({ ...prev, [item.postUrl || item.url || item.uuid]: t }))}
                                                onInlinePost={(t) => handleInlinePost(item, t)}
                                                onInlineRegenerate={() => handleInlineComment(item)}
                                                onInlineDiscard={() => handleInlineDiscard(item)}
                                            />
                                        </div>
                                    ))}
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination footer — only shown when there's more than one
                    page. Range string ("51–100 of 312") gives the user
                    context; arrow buttons disable at the ends. */}
                {filteredSignals.length > POSTS_PER_PAGE && (
                    <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-gray-100 text-[12px] text-gray-500">
                        <span className="tabular-nums">
                            Showing {safePage * POSTS_PER_PAGE + 1}–{Math.min((safePage + 1) * POSTS_PER_PAGE, filteredSignals.length)} of {filteredSignals.length}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={safePage === 0}
                                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 bg-white text-gray-600 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >← Prev</button>
                            <span className="tabular-nums text-gray-500">Page {safePage + 1} / {pageCount}</span>
                            <button
                                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                                disabled={safePage >= pageCount - 1}
                                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 bg-white text-gray-600 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >Next →</button>
                        </div>
                    </div>
                )}
            {false && (
                <div className="space-y-6">
                    {/* ── MISSION INTELLIGENCE TRIAGE ── */}
                    {newReconSignals.length > 0 && (
                        <div className="mb-10 space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-500 flex items-center gap-2">
                                    <Activity size={14} className="text-blue-500" /> Incoming Mission Signals 
                                    <span className="ml-1 px-2 py-0.5 bg-blue-500 text-white rounded-full text-[9px] font-black">{newReconSignals.length}</span>
                                </h3>
                                <button 
                                    onClick={() => {
                                        // Discard all signals
                                        const allUrls = newReconSignals.map(s => s.url);
                                        const disqualifiedLeads = newReconSignals.map(s => ({
                                            url: s.url,
                                            postUrl: s.postUrl || s.url,
                                            title: s.creator,
                                            why: "Mass Discarded from Triage",
                                            postText: s.text || s.body,
                                            relevance: 0,
                                            scannedAt: new Date().toISOString(),
                                            status: 'new',
                                            qualified: false,
                                            interactions: [],
                                            timestamp: new Date().toISOString(),
                                            tags: [s.platform, 'Radar'],
                                            campaignId: s.campaignId,
                                            campaignName: s.campaignName,
                                            intent: s.intent
                                        } as any));
                                        
                                        setLeads(prev => {
                                            const updated = [...disqualifiedLeads, ...prev];
                                            localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                            return updated;
                                        });
                                    }}
                                    className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 transition-all"
                                >
                                    Clear All Signals
                                </button>
                            </div>
                            
                            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-1">
                                {newReconSignals.map((signal) => (
                                    <div key={signal.url || signal.uuid} className="flex-shrink-0 w-80 bg-white border border-gray-100 rounded-[2rem] shadow-sm hover:shadow-xl hover:border-blue-200 transition-all p-6 space-y-4 group/card relative">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-100">
                                                    {getPlatformIcon(signal.platform || signal.url)}
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-bold text-gray-900 leading-tight">@{signal.creator}</h4>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{signal.platform}</p>
                                                </div>
                                            </div>
                                            <a href={signal.postUrl || signal.url} target="_blank" rel="noreferrer" className="p-2 text-gray-300 hover:text-blue-500 transition-colors">
                                                <ExternalLink size={16} />
                                            </a>
                                        </div>
                                        
                                        <div className="space-y-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest rounded-full border border-blue-100">
                                                    {signal.campaignName || "General Recon"}
                                                </span>
                                                {signal.intent && (
                                                    <span className="px-2 py-0.5 bg-purple-50 text-purple-600 text-[9px] font-bold rounded-full border border-purple-100 italic">
                                                        "{signal.intent}"
                                                    </span>
                                                )}
                                            </div>
                                            
                                            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 space-y-2 relative overflow-hidden group/card hover:bg-white transition-all">
                                                {/* Heat Ribbon */}
                                                <div className={`absolute top-0 left-0 w-1 h-full ${signal.relevance >= 85 ? 'bg-red-500' : signal.relevance >= 60 ? 'bg-orange-500' : 'bg-slate-300'}`}></div>
                                                
                                                <div className="flex justify-between items-center pl-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest flex items-center gap-1 ${signal.relevance >= 85 ? 'bg-red-500 text-white' : signal.relevance >= 60 ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                                            {signal.relevance >= 85 ? '🔥 HOT' : signal.relevance >= 60 ? '⚡ WARM' : '❄️ COLD'}
                                                        </span>
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 opacity-60">
                                                            {signal.interactionType === 'Comment' ? '💬 COMMENT' : '📣 POST'}
                                                        </span>
                                                    </div>
                                                    <span className="text-[10px] font-bold text-emerald-600">{signal.relevance || 88}% Match</span>
                                                </div>
                                                <p className="text-[11px] text-gray-600 leading-relaxed italic pl-3 whitespace-pre-wrap">
                                                    "{signal.text || signal.body}"
                                                </p>
                                                <div className="pt-1 flex items-center gap-1.5 pl-3">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-40"></div>
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600/70">Found via: {signal.intent || 'Keyword Match'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-2 pt-2">
                                            <button 
                                                onClick={() => handleTrackInPipeline(signal)}
                                                className="py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/10 active:scale-95 flex items-center justify-center gap-2"
                                            >
                                                <Check size={12} /> Approve
                                            </button>
                                            <button 
                                                onClick={() => handleDiscardSignal(signal)}
                                                className="py-2.5 bg-white border border-gray-200 text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                                            >
                                                <Trash2 size={12} /> Discard
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {(() => {
                        const allLeads = leads.filter(l => (l as any).why !== "Discarded from Triage" && (l as any).why !== "Mass Discarded from Triage");

                        if (allLeads.length === 0) return (
                            <div className="py-32 text-center bg-gray-50/50 rounded-[3rem] border border-dashed border-gray-200">
                                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-gray-100 mx-auto mb-6">
                                    <Target size={32} className="text-gray-300" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-400 uppercase tracking-widest">Pipeline Pristine</h3>
                                <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">Vette signals from the Mission Intelligence deck above to populate your active pipeline.</p>
                            </div>
                        );

                        return allLeads.map((lead: any) => {
                            const isSelected = selectedLeads.has(lead.url || lead.uuid);
                            const interactionCount = (lead.interactions || []).length;
                            const hasCommented = (lead.interactions || []).some((i: any) => i.type === 'reply' || i.type === 'comment');
                            const isRecon = lead.status === 'recon' || lead.isReconSignal;
                            const isQualified = (lead as any).qualified === true;
                            const isDisqualified = (lead as any).qualified === false;
                            const hasNote = !!(lead as any).note;

                            // Stage label reflects real sales progress
                            let stageLabel = 'Spotted';
                            let stageBg = 'bg-gray-100 text-gray-500';
                            if (hasCommented) { stageLabel = 'Commented'; stageBg = 'bg-blue-100 text-blue-700'; }
                            if (isQualified) { stageLabel = 'Qualified'; stageBg = 'bg-green-100 text-green-700'; }
                            if (isDisqualified) { stageLabel = 'Not a fit'; stageBg = 'bg-red-100 text-red-500'; }
                            if (isRecon) { stageLabel = 'New Signal'; stageBg = 'bg-amber-100 text-amber-700'; }

                            return (
                                <div key={lead.url || lead.uuid} className={`group flex items-start gap-4 p-5 rounded-2xl border bg-white transition-all ${
                                    isSelected ? 'border-blue-400 shadow-md ring-1 ring-blue-300' : 'border-gray-100 hover:border-gray-200 shadow-sm'
                                }`}>
                                    {/* Checkbox */}
                                    <button
                                        onClick={() => toggleSelectLead(lead.url || lead.uuid)}
                                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 hover:border-blue-400'
                                        }`}
                                    >
                                        {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                                    </button>

                                    {/* Platform icon */}
                                    <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-50 border border-gray-100 flex-shrink-0 hover:border-blue-300 hover:bg-blue-50 transition-all">
                                        {getPlatformIcon(lead.tags?.[0] || lead.platform || lead.url)}
                                    </a>

                                    {/* Main content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <a href={lead.postUrl || lead.url} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 text-sm hover:text-blue-600 transition-colors">@{lead.name || lead.title || lead.creator}</a>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${stageBg}`}>{stageLabel}</span>
                                            <span className="text-[10px] text-gray-500 font-bold bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100 flex items-center gap-1.5 shadow-sm">
                                                <Clock size={10} className="text-blue-500" />
                                                {(lead.timestamp || lead.scannedAt) ? 
                                                    new Date(lead.timestamp || lead.scannedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + 
                                                    new Date(lead.timestamp || lead.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) 
                                                    : 'Just now'}
                                            </span>
                                            
                                            {lead.campaignName && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1">
                                                    <Target size={10} /> {lead.campaignName}
                                                </span>
                                            )}
                                            
                                            {lead.intent && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-100 italic">
                                                    "{lead.intent}"
                                                </span>
                                            )}

                                            {interactionCount > 0 && (
                                                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md flex items-center gap-1.5 border border-blue-100">
                                                    🤝 {interactionCount} Interactions
                                                </span>
                                            )}

                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest flex items-center gap-1 ${lead.relevance >= 85 ? 'bg-red-500 text-white shadow-sm' : lead.relevance >= 60 ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>
                                                {lead.relevance >= 85 ? '🔥 HOT' : lead.relevance >= 60 ? '⚡ WARM' : '❄️ COLD'}
                                            </span>
                                            
                                            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 uppercase tracking-widest border border-slate-200">
                                                {lead.interactionType === 'Comment' ? '💬 COMMENT' : '📣 POST'}
                                            </span>

                                            {/* Feed Watcher queued a draft for this post (queue-only — nothing posted yet) */}
                                            {lead.engagementStatus === 'queued' && (lead.suggestedAction === 'repost'
                                                ? <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-violet-50 text-violet-600 uppercase tracking-widest border border-violet-100">♻️ Repost suggested</span>
                                                : <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 uppercase tracking-widest border border-emerald-100">✍️ Reply drafted</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                                            {lead.postText || lead.text || lead.why}
                                        </p>

                                        {/* Actions row */}
                                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                                            {isRecon ? (
                                                <button
                                                    onClick={() => handleTrackInPipeline(lead)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-all shadow-sm"
                                                >
                                                    <Check size={13} /> Track this prospect
                                                </button>
                                            ) : (
                                                <>
                                                    {/* Primary CTA: Write a comment — the #1 conversion action */}
                                                    <button
                                                        onClick={() => handleOpenSmartReply(lead)}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                            hasCommented
                                                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                            : 'bg-gray-900 text-white border-gray-900 hover:bg-blue-700 hover:border-blue-700'
                                                        }`}
                                                    >
                                                        <Sparkles size={13} />
                                                        {hasCommented ? 'Commented' : (lead.engagementStatus === 'queued' && lead.suggestedComment ? 'Review draft' : 'Write Comment')}
                                                    </button>

                                                    {/* NEW: Automated Like Button */}
                                                    <button
                                                        onClick={() => {
                                                            const event = new CustomEvent('pipeline_queue_engagement', { 
                                                                detail: { 
                                                                    lead: { ...lead, actionType: 'like' }
                                                                } 
                                                            });
                                                            window.dispatchEvent(event);
                                                            logInteraction(lead, 'like');
                                                        }}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-rose-600 border border-rose-100 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-all"
                                                        title="Automated Like via Extension"
                                                    >
                                                        <Heart size={13} fill={(lead.interactions || []).some((i: any) => i.type === 'like') ? 'currentColor' : 'none'} />
                                                        {(lead.interactions || []).some((i: any) => i.type === 'like') ? 'Liked' : 'Like'}
                                                    </button>

                                                    {/* Add a private note about pitch angle */}
                                                    <button
                                                        onClick={() => { setNotingLead(lead); setNoteText((lead as any).note || ''); }}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                                            hasNote ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300 hover:text-amber-700'
                                                        }`}
                                                    >
                                                        {hasNote ? '📝 Note' : '📝 +'}
                                                    </button>

                                                    {/* Qualify / Disqualify */}
                                                    {!isQualified && !isDisqualified && (
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => qualifyLead(lead.url, true)}
                                                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-all"
                                                                title="Qualify"
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => qualifyLead(lead.url, false)}
                                                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                                                                title="Not a fit"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            <a
                                                href={lead.postUrl || lead.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center gap-1.5 px-4 py-1.5 bg-white text-blue-600 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm group/btn"
                                            >
                                                <ExternalLink size={13} className="group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" /> 
                                                Direct Link
                                            </a>
                                            {!isRecon && (
                                                <button
                                                    onClick={() => removeLead(lead.url)}
                                                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-gray-300 hover:text-red-500 text-xs font-semibold rounded-lg hover:bg-red-50 transition-all"
                                                >
                                                    <Trash2 size={13} /> Remove
                                                </button>
                                            )}
                                        </div>

                                        {/* Note preview */}
                                        {hasNote && (
                                            <div className="mt-2 flex items-start gap-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                                                <span className="text-amber-500 text-xs mt-0.5">📝</span>
                                                <p className="text-xs text-amber-700 italic">{(lead as any).note}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </div>
            )}
        </div>

        {/* Floating Batch Actions Hub — reserved for future use */}
        {false && selectedLeads.size > 0 && activeMainTab === 'leads' && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[90] animate-in fade-in slide-in-from-bottom-6 duration-300">
                <div className="bg-gray-950/90 backdrop-blur-xl text-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.4)] px-8 py-5 flex items-center gap-8 border border-white/10 ring-1 ring-white/5">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 mb-0.5">Pipeline Pulse</span>
                        <span className="text-sm font-bold tracking-tight">{selectedLeads.size} leads selected</span>
                    </div>
                    
                    <div className="h-10 w-[1px] bg-white/10"></div>
                      <div className="flex items-center gap-4">
                        <button 
                            onClick={() => {
                                const urls = Array.from(selectedLeads);
                                // 1. Identify which recon signals need to be promoted/tracked
                                const signalsToTrack = newReconSignals.filter(s => urls.includes(s.url || s.uuid));
                                
                                setLeads(prev => {
                                    // Start with existing leads updated
                                    let updated = prev.map(l => urls.includes(l.url) 
                                        ? { ...l, qualified: true, status: 'engaging' as const } 
                                        : l
                                    );
                                    
                                    // Add new signals that were selected
                                    signalsToTrack.forEach(s => {
                                        if (!updated.find(l => l.url === s.url)) {
                                            updated.unshift({
                                                url: s.url,
                                                postUrl: s.postUrl || s.url,
                                                title: s.creator,
                                                why: "Batch Qualified via Pipeline",
                                                postText: s.text || s.body,
                                                relevance: 90,
                                                scannedAt: new Date().toISOString(),
                                                status: 'engaging',
                                                qualified: true,
                                                interactions: [],
                                                timestamp: new Date().toISOString(),
                                                tags: [s.platform, 'Radar'],
                                                campaignId: s.campaignId,
                                                campaignName: s.campaignName,
                                                intent: s.intent
                                            } as any);
                                        }
                                    });

                                    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                    return updated;
                                });
                                setSelectedLeads(new Set());
                            }}
                            className="flex items-center gap-2.5 px-6 py-3 bg-blue-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-95"
                        >
                            <Check size={14} /> Qualify All
                        </button>
                        
                        <button 
                            onClick={() => {
                                const urls = Array.from(selectedLeads);
                                // 1. Identify which recon signals need to be promoted/disqualified
                                const signalsToTrack = newReconSignals.filter(s => urls.includes(s.url || s.uuid));

                                setLeads(prev => {
                                    let updated = prev.map(l => urls.includes(l.url) 
                                        ? { ...l, qualified: false, status: 'new' as const } 
                                        : l
                                    );

                                    // Add new signals that were selected as disqualified
                                    signalsToTrack.forEach(s => {
                                        if (!updated.find(l => l.url === s.url)) {
                                            updated.unshift({
                                                url: s.url,
                                                postUrl: s.postUrl || s.url,
                                                title: s.creator,
                                                why: "Batch Disqualified via Pipeline",
                                                postText: s.text || s.body,
                                                relevance: 0,
                                                scannedAt: new Date().toISOString(),
                                                status: 'new',
                                                qualified: false,
                                                interactions: [],
                                                timestamp: new Date().toISOString(),
                                                tags: [s.platform, 'Radar'],
                                                campaignId: s.campaignId,
                                                campaignName: s.campaignName,
                                                intent: s.intent
                                            } as any);
                                        }
                                    });

                                    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                    return updated;
                                });
                                setSelectedLeads(new Set());
                            }}
                            className="flex items-center gap-2.5 px-6 py-3 bg-white/10 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-all active:scale-95 border border-white/10"
                        >
                            <X size={14} /> Not a Fit
                        </button>

                        <button 
                            onClick={() => {
                                const urls = Array.from(selectedLeads);
                                setLeads(prev => {
                                    const updated = prev.filter(l => !urls.includes(l.url));
                                    localStorage.setItem('pipeline_leads_unified', JSON.stringify(updated));
                                    return updated;
                                });
                                setSelectedLeads(new Set());
                            }}
                            className="flex items-center gap-2.5 px-6 py-3 bg-red-500/10 text-red-400 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all active:scale-95 border border-red-500/20"
                        >
                            <Trash2 size={14} /> Remove
                        </button>

                        <div className="w-[1px] h-6 bg-white/10 mx-2"></div>
                        
                        <button 
                            onClick={() => setSelectedLeads(new Set())}
                            className="p-3 text-gray-500 hover:text-white hover:bg-white/5 rounded-full transition-all"
                            title="Clear Selection"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* ── Batch action bar (floating) ──
            Appears when posts are selected. Generate comments for all selected
            in one go (queued in your voice), review/edit each inline, then
            Publish the batch. Queue-only — nothing posts until you press it. */}
        {selectedPosts.size > 0 && createPortal(
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-3 px-5 py-3 rounded-2xl bg-gray-900 text-white shadow-2xl border border-gray-700 max-w-[95vw] flex-wrap justify-center">
                <span className="text-xs font-bold">{selectedPosts.size} post{selectedPosts.size > 1 ? 's' : ''} selected</span>
                <div className="w-px h-5 bg-white/20" />
                <button
                    onClick={generateBatchComments}
                    disabled={isBatchRunning}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                    {isBatchRunning ? <><RefreshCw size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate comments</>}
                </button>
                <button
                    onClick={publishBatchComments}
                    disabled={selectedReadyCount === 0 || isBatchRunning}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition-colors"
                    title={selectedReadyCount === 0 ? 'Generate comments first' : `Queue ${selectedReadyCount} comment(s) for posting`}
                >
                    <Send size={13} /> Publish selected{selectedReadyCount > 0 ? ` (${selectedReadyCount})` : ''}
                </button>
                <button
                    onClick={clearBatchSelection}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                    title="Clear selection"
                    aria-label="Clear selection"
                >
                    <X size={16} />
                </button>
            </div>,
            document.body
        )}

        {/* ── Comment Writing Modal ──
            Rendered through a portal to <body> so it's never affected by an
            ancestor's CSS transform (the daisyUI drawer layout applies
            transforms, which would otherwise make `position: fixed` resolve
            against that ancestor instead of the viewport — that was why the
            modal sat off-screen and required scrolling). In the portal it is
            always pinned dead-center of the user's screen. */}
        {commentingLead && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/60 backdrop-blur-md" ref={commentModalRef}>
                <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="p-6 border-b border-gray-100 flex justify-between items-start flex-shrink-0">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">Write a comment for @{commentingLead.title || commentingLead.creator}</h3>
                            {commentingLead.postText && (
                                <p className="text-xs text-gray-400 mt-1 line-clamp-1 italic">"{commentingLead.postText}"</p>
                            )}
                        </div>
                        <button onClick={() => { setCommentingLead(null); setSmartComments(null); }} className="p-2 hover:bg-gray-100 rounded-xl transition-colors ml-4 flex-shrink-0">
                            <Trash2 size={18} className="text-gray-400" />
                        </button>
                    </div>

                    {/* Saved voices picker — quick switch row at the top of the modal.
                        Reads from the same library Voice Studio writes to.
                        Applying a profile here makes the next "Generate" use that voice. */}
                    {vp.library.length > 0 && (
                        <div className="px-6 py-3 border-b border-gray-100 bg-amber-50/50 flex items-center gap-2 flex-wrap flex-shrink-0">
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-900 mr-1">Voice</span>
                            {vp.library.map(p => {
                                const tip = `${p.note ? p.note + ' — ' : ''}auth ${p.voiceMix.authority} · energy ${p.voiceMix.energy} · prov ${p.voiceMix.provocation}`;
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => vp.applySavedProfile(p.id)}
                                        title={tip}
                                        className="px-2.5 py-1 rounded-md border border-amber-200 bg-white text-amber-900 text-[11px] font-medium hover:border-amber-400 transition-colors"
                                    >
                                        🔖 {p.name}
                                    </button>
                                );
                            })}
                            <span className="ml-auto text-[10px] text-amber-900/60 italic">Applied profile is used for the next generation.</span>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto min-h-0">
                        {/* Comment-spec summary (read-only).
                            Tone / goal / length / angle are configured ONCE in
                            Voice Studio (vp.commentSpec) and reused for every
                            comment, so there's nothing to set per post here. We
                            show the active spec so the user knows what they'll
                            get, with a hint pointing to Voice Studio to change it. */}
                        <div className="p-6 border-b border-gray-50">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-semibold text-gray-600">Comment style <span className="font-normal text-gray-400">— set in Voice Studio</span></label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-900 text-white capitalize">{vp.commentSpec.tone}</span>
                                <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-700">
                                    {vp.commentSpec.goal === 'build_relationship' ? 'Start a conversation'
                                        : vp.commentSpec.goal === 'ask_question' ? 'Ask a question'
                                        : vp.commentSpec.goal === 'share_insight' ? 'Share insight'
                                        : 'Stand out'}
                                </span>
                                <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-700">≤ {vp.commentSpec.maxLength} chars</span>
                                {vp.commentSpec.customInstruction.trim() && (
                                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 max-w-full truncate" title={vp.commentSpec.customInstruction}>
                                        “{vp.commentSpec.customInstruction}”
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-gray-400 italic mt-2">Change tone, goal, length or your standing angle once in <b>Voice Studio → Comment defaults</b>.</p>
                        </div>

                        {/* Results */}
                        {smartComments && (
                            <div className="p-6 space-y-3">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-semibold text-gray-500">Pick a comment to use — click to open the post and copy it</p>
                                    <button onClick={generateComments} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                        <RefreshCw size={12} /> Regenerate
                                    </button>
                                </div>
                                {smartComments.options.map((opt, i) => {
                                    const value = editedComments[i] ?? opt.body;
                                    return (
                                    <div
                                        key={i}
                                        className="group relative bg-white border border-gray-100 p-5 rounded-2xl hover:border-blue-200 transition-all text-left shadow-sm hover:shadow-md"
                                    >
                                        <div className="flex items-start justify-between gap-6">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 px-3 py-1 bg-blue-50 rounded-full">
                                                        {opt.type === 'agreement' ? 'Agree & build' : opt.type === 'insight' ? 'Share insight' : 'Ask a question'}
                                                    </span>
                                                    {(editedComments[i] !== undefined && editedComments[i] !== opt.body) && (
                                                        <span className="text-[10px] text-amber-600 font-semibold">edited</span>
                                                    )}
                                                </div>
                                                {/* Editable comment — the user can always tweak the
                                                    generated text before sending. The send buttons use
                                                    this exact value. */}
                                                <textarea
                                                    value={value}
                                                    onChange={e => setEditedComments(prev => ({ ...prev, [i]: e.target.value }))}
                                                    rows={Math.min(8, Math.max(2, Math.ceil(value.length / 60)))}
                                                    className="w-full text-sm text-gray-800 leading-relaxed font-medium border border-gray-200 rounded-xl p-3 resize-y focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                                                />
                                                <div className="flex items-center justify-between mt-1.5">
                                                    <p className="text-[10px] text-gray-400 italic truncate pr-2">{opt.why}</p>
                                                    <span className="text-[10px] text-gray-400 flex-shrink-0">{value.length} chars</span>
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-2 min-w-[140px]">
                                                <button
                                                    onClick={() => {
                                                        const text = (editedComments[i] ?? opt.body).trim();
                                                        if (!text) return;
                                                        const event = new CustomEvent('pipeline_queue_engagement', {
                                                            detail: {
                                                                lead: {
                                                                    ...commentingLead,
                                                                    actionType: engagementAction,
                                                                    commentText: text
                                                                }
                                                            }
                                                        });
                                                        window.dispatchEvent(event);
                                                        logInteraction(commentingLead, engagementAction === 'quote' ? 'quote' : 'reply');
                                                        markReplied(commentingLead, text);
                                                        setCommentingLead(null);
                                                        setSmartComments(null);
                                                    }}
                                                    className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                                                >
                                                    {engagementAction === 'quote' ? <Quote size={14} /> : <Sparkles size={14} />}
                                                    {engagementAction === 'quote' ? 'Quote Now' : 'Send Now'}
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        const text = (editedComments[i] ?? opt.body).trim();
                                                        if (!text) return;
                                                        // Only postUrl/url are real links. uuid is an INTERNAL id
                                                        // (e.g. "li_3f9a…" / "feed_…") — passing it to window.open
                                                        // makes the browser treat it as a RELATIVE path and resolve
                                                        // it against the current origin → http://localhost:3000/li_…
                                                        // (the "Open Manual sends me back to localhost" bug). This
                                                        // happens for LinkedIn new-feed cards that expose no permalink.
                                                        const rawUrl = commentingLead.postUrl || commentingLead.url || '';
                                                        const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
                                                        localStorage.setItem('answerly_comment_buffer', JSON.stringify({ url: targetUrl || commentingLead.uuid, text }));
                                                        logInteraction(commentingLead, 'reply');
                                                        markReplied(commentingLead, text);
                                                        if (targetUrl) {
                                                            window.open(targetUrl, '_blank');
                                                        } else {
                                                            // No capturable permalink — never bounce to localhost.
                                                            // The reply is saved + the post marked replied; open
                                                            // LinkedIn manually to paste it.
                                                            alert("Ce post n'a pas de lien direct capturable depuis le fil LinkedIn. Ta réponse est enregistrée — ouvre le post sur LinkedIn pour la coller.");
                                                        }
                                                        setCommentingLead(null);
                                                        setSmartComments(null);
                                                    }}
                                                    className="px-4 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 flex items-center justify-center gap-2 transition-all"
                                                >
                                                    <ExternalLink size={14} /> Open Manual
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Sticky footer — Generate button lives here so it's
                        always visible regardless of how tall the customisation
                        panel + results get. This fixes the "I have to scroll
                        to find the Generate button" reported issue. */}
                    <div className="flex-shrink-0 border-t border-gray-100 bg-white p-4">
                        <button
                            onClick={generateComments}
                            disabled={isGeneratingComment}
                            className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isGeneratingComment
                                ? <><RefreshCw size={15} className="animate-spin" /> Generating...</>
                                : <><Sparkles size={15} /> {smartComments ? 'Regenerate comments' : 'Generate comments'}</>}
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        {/* ── Note Modal ── */}
        {notingLead && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-gray-950/50 backdrop-blur-sm">
                <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-50">
                        <h3 className="text-base font-bold text-gray-900">Note for @{notingLead.name || notingLead.title || notingLead.creator}</h3>
                        <p className="text-xs text-gray-400 mt-1">Private. Write your pitch angle, context, or follow-up plan.</p>
                    </div>
                    <div className="p-6">
                        <textarea
                            autoFocus
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="e.g. They're complaining about slow dev cycles — our tool directly solves this. Lead with the time-to-market angle."
                            rows={4}
                            className="w-full text-sm text-gray-800 border border-gray-200 rounded-2xl p-4 resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                        />
                        <div className="flex items-center justify-end gap-3 mt-4">
                            <button onClick={() => { setNotingLead(null); setNoteText(''); }} className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2">Cancel</button>
                            <button
                                onClick={() => saveNote(notingLead, noteText)}
                                disabled={!noteText.trim()}
                                className="px-6 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-all disabled:opacity-40"
                            >
                                Save note
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
