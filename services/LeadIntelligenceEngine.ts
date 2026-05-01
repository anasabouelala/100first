/**
 * Lead Intelligence Engine (V5)
 * Deterministic scoring + reasoning logic for buying opportunities.
 */

import { ICPReconCampaign, PipelineLead } from '../types';

export interface IntelligenceContext {
    postText: string;
    authorBio?: string;
    headline?: string;
    followerCount?: number;
    platform: string;
    timestamp: string;
    companyName?: string;
    role?: string;
    engagementMetrics?: {
        replies?: number;
        likes?: number;
    };
}

export interface IntelligenceResult {
    score: number;
    tier: 'BUY NOW' | 'HOT' | 'STRONG' | 'WATCHLIST' | 'IGNORE';
    need: string;
    pain: string;
    reasoning: string;
    outreachAngle: string;
}

export function processLeadIntelligence(context: IntelligenceContext, campaign: ICPReconCampaign): IntelligenceResult {
    // LAYER 2 - Normalization (Simplified for JS implementation)
    const text = context.postText.toLowerCase();
    const bio = (context.authorBio || '').toLowerCase();
    const headline = (context.headline || '').toLowerCase();
    
    let score = 0;
    const signals: string[] = [];

    // LAYER 5A - BUYING INTENT SIGNALS (+20 max)
    const intentKeywords = {
        direct: ['recommend', 'looking for', 'need tool', 'best software', 'agency needed', 'alternatives'],
        research: ['researching', 'comparing', 'how to choose']
    };
    if (intentKeywords.direct.some(k => text.includes(k))) {
        score += 20;
        signals.push("Direct Buying Intent");
    } else if (intentKeywords.research.some(k => text.includes(k))) {
        score += 10;
        signals.push("Research Mode");
    }

    // LAYER 5B - PAIN SIGNALS (+18 max)
    const painKeywords = {
        severe: ['broken', 'losing leads', 'wasting time', 'broken workflow', 'manual work', 'no growth'],
        mild: ['expensive', 'not working', 'slow']
    };
    if (painKeywords.severe.some(k => text.includes(k))) {
        score += 18;
        signals.push("Severe Operational Pain");
    } else if (painKeywords.mild.some(k => text.includes(k))) {
        score += 8;
        signals.push("Efficiency Bottleneck");
    }

    // LAYER 5C - URGENCY SIGNALS (+15 max)
    const urgencyKeywords = ['asap', 'today', 'this week', 'urgent', 'need now'];
    if (urgencyKeywords.some(k => text.includes(k))) {
        score += 15;
        signals.push("High Urgency");
    }

    // LAYER 6 - AUTHOR AUTHORITY (+20 max)
    const authorityWeights = [
        { keys: ['founder', 'owner', 'ceo', 'co-founder'], weight: 20, label: 'Decision Maker' },
        { keys: ['cmo', 'vp', 'director', 'head of'], weight: 16, label: 'Executive' },
        { keys: ['manager', 'lead'], weight: 10, label: 'Influencer' }
    ];
    let authorityLabel = 'Unknown';
    for (const auth of authorityWeights) {
        if (auth.keys.some(k => bio.includes(k) || headline.includes(k))) {
            score += auth.weight;
            authorityLabel = auth.label;
            break;
        }
    }

    // LAYER 8 - ICP FIT (+20 max)
    const industryMatch = campaign.industries.some(i => text.includes(i.toLowerCase()) || bio.includes(i.toLowerCase()));
    const roleMatch = campaign.roles.some(r => bio.includes(r.toLowerCase()) || headline.includes(r.toLowerCase()));
    
    if (industryMatch && roleMatch) score += 20;
    else if (industryMatch || roleMatch) score += 10;

    // LAYER 9 - TIME DECAY
    const hoursOld = (Date.now() - new Date(context.timestamp).getTime()) / (1000 * 60 * 60);
    let multiplier = 1.0;
    if (hoursOld < 1) multiplier = 1.25;
    else if (hoursOld < 24) multiplier = 1.15;
    else if (hoursOld > 72) multiplier = 0.8;
    else if (hoursOld > 720) multiplier = 0.2;

    score = Math.min(100, Math.round(score * multiplier));

    // LAYER 12 - TIERS
    let tier: IntelligenceResult['tier'] = 'IGNORE';
    if (score >= 90) tier = 'BUY NOW';
    else if (score >= 75) tier = 'HOT';
    else if (score >= 60) tier = 'STRONG';
    else if (score >= 45) tier = 'WATCHLIST';

    // LAYER 17 - OUTREACH BRAIN
    let angle = "General intro";
    if (signals.includes("Severe Operational Pain")) angle = "Solve the broken workflow immediately";
    if (signals.includes("High Urgency")) angle = "Express delivery/ASAP setup focus";
    if (signals.includes("Direct Buying Intent")) angle = "Direct comparison vs competitors";

    return {
        score,
        tier,
        need: signals.length > 0 ? signals[0] : "General Investigation",
        pain: signals.find(s => s.includes("Pain")) || "Status Quo Friction",
        reasoning: `${authorityLabel} found on ${context.platform} with ${signals.join(' + ')}`,
        outreachAngle: angle
    };
}
