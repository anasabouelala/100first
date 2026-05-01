/**
 * Answerly Lead Intelligence Engine v5.0
 * ULTIMATE 18-LAYER DETERMINISTIC PIPELINE
 * 
 * Transforms noisy social data into ranked buying opportunities
 * using a multi-layer decision engine.
 */

const INTEL_LOG = "[Intel Engine v5]";

/**
 * Main entry point for lead analysis.
 * Processes raw data through 18 layers of reasoning.
 */
function processLeadIntelligence(rawPost, campaign) {
    if (!rawPost || !campaign) return { score: 0, tier: 'IGNORE', pipeline: [], signals: [] };

    let score = 0;
    const pipeline = [];
    const signals = [];

    // --- LAYER 1: INGESTION ---
    const context = {
        text: (rawPost.postText || rawPost.text || "").toLowerCase(),
        name: (rawPost.name || "").toLowerCase(),
        role: (rawPost.role || "").toLowerCase(),
        bio: (rawPost.bio || "").toLowerCase(),
        platform: rawPost.platform || "Unknown",
        timestamp: rawPost.timestamp || new Date().toISOString(),
        engagement: rawPost.engagement || { replies: 0, likes: 0 },
        company: rawPost.company || "",
        location: rawPost.location || ""
    };
    pipeline.push({ step: 'Ingestion', status: 'pass', detail: 'Context object synthesized' });

    // --- LAYER 2: TEXT NORMALIZATION ---
    let normalized = context.text
        .replace(/\bsm1\b/g, "someone")
        .replace(/\basap\b/g, "urgent")
        .replace(/\bcrm\b/g, "customer relationship management")
        .replace(/[^\w\s\$\!\?]/g, " ") // Remove symbols but keep indicators
        .trim();
    pipeline.push({ step: 'Normalization', status: 'pass', detail: 'Slang expanded, text cleaned' });

    // --- LAYER 3: ENTITY EXTRACTION ---
    const entities = {
        tools: normalized.match(/\b(crm|seo|ads|stripe|aws|nextjs|shopify|hubspot)\b/g) || [],
        budget: normalized.includes('$') || /\b(budget|pay|expensive|cost)\b/.test(normalized),
        location: context.location || (normalized.match(/\b(miami|london|ny|sf|paris)\b/i) || [])[0]
    };
    pipeline.push({ step: 'Entity Extraction', status: 'pass', detail: `Detected: ${entities.tools.length} tools, Budget: ${entities.budget}` });

    // --- LAYER 4: TOPIC RELEVANCE FILTER ---
    // Compute semantic relevance 0-100
    let matches = 0;
    const campaignDNAs = [...(campaign.painPoints || []), ...(campaign.roles || [])];
    campaignDNAs.forEach(dna => {
        if (normalized.includes(dna.toLowerCase())) matches++;
    });
    const relevance = Math.min(100, (matches / (campaignDNAs.length || 1)) * 100 + 15);
    
    pipeline.push({ step: 'Topic Filter', status: relevance >= 35 ? 'pass' : 'fail', detail: `Relevance Score: ${relevance.toFixed(0)}%` });
    
    if (relevance < 35) {
        return { score: 0, tier: 'IGNORE', pipeline: pipeline, signals: ['Low Relevance'] };
    }

    // --- LAYER 5: SIGNAL DETECTION ENGINE ---
    // A. Buying Intent (+20)
    if (/\b(recommend|looking for|need tool|best software|agency needed|alternatives)\b/i.test(normalized)) {
        score += 20; signals.push('Buying Intent');
    }
    // B. Pain Signals (+18)
    if (/\b(not working|expensive|losing leads|no growth|wasting time|broken|failing)\b/i.test(normalized)) {
        score += 18; signals.push('Severe Pain');
    }
    // C. Urgency (+15)
    if (/\b(asap|today|this week|urgent|now|deadline)\b/i.test(normalized)) {
        score += 15; signals.push('High Urgency');
    }
    // E. Switch Signals (+18)
    if (/\b(leaving|cancelling|hate current|too expensive now)\b/i.test(normalized)) {
        score += 18; signals.push('Switch Ready');
    }

    // --- LAYER 6: AUTHOR AUTHORITY MODEL ---
    let authorityBonus = 3;
    const authorText = (context.role + " " + context.bio).toLowerCase();
    if (/\b(founder|owner|ceo|cto|founder)\b/.test(authorText)) authorityBonus = 20;
    else if (/\b(cmo|vp|director|head)\b/.test(authorText)) authorityBonus = 16;
    else if (/\b(manager)\b/.test(authorText)) authorityBonus = 10;
    score += authorityBonus;
    pipeline.push({ step: 'Authority', status: 'pass', detail: `Rank: ${authorityBonus === 20 ? 'Executive' : 'Contributor'}` });

    // --- LAYER 8: ICP FIT MODEL ---
    const isICPMatch = (campaign.roles || []).some(r => context.role.includes(r.toLowerCase()));
    if (isICPMatch) {
        score += 20;
        signals.push('ICP Match');
    } else {
        score += 5;
    }

    // --- LAYER 9: TIME DECAY MODEL ---
    const hoursOld = (new Date() - new Date(context.timestamp)) / 36e5;
    let multiplier = 1.0;
    if (hoursOld < 1) multiplier = 1.25;
    else if (hoursOld < 24) multiplier = 1.15;
    else if (hoursOld < 72) multiplier = 1.0;
    else if (hoursOld < 168) multiplier = 0.8;
    else multiplier = 0.2;
    
    score *= multiplier;
    pipeline.push({ step: 'Time Decay', status: 'pass', detail: `${multiplier.toFixed(2)}x (Age: ${hoursOld.toFixed(1)}h)` });

    // --- LAYER 13: COMBINATION BOOSTS ---
    if (authorityBonus === 20 && signals.includes('High Urgency')) {
        score += 15;
        pipeline.push({ step: 'Boost', status: 'active', detail: 'Founder + Urgency Bonus' });
    }

    // --- LAYER 14: FRAUD / NOISE REDUCTION ---
    const isJoke = /\b(lol|lmao|meme|joke|haha)\b/i.test(normalized) && normalized.length < 50;
    if (isJoke) {
       // Layer Tracking
    const triggeredLayers = [];
    
    // --- LAYERS 1-3: INGESTION & NORMALIZATION ---
    let score = 20; // Base score for being discovered
    triggeredLayers.push("L1-3: DNA Ingestion");

    // --- LAYER 4: INTENT SIGNALS ---
    const intentPatterns = [
        { regex: /recommend|looking for|best tool|how to/i, weight: 15, label: "High Intent" },
        { regex: /alternative|switching|leaving/i, weight: 10, label: "Switch Intent" }
    ];
    intentPatterns.forEach(p => {
        if (p.regex.test(text)) {
            score += p.weight;
            triggeredLayers.push(`L4: ${p.label}`);
        }
    });

    // --- LAYER 7: URGENCY ---
    if (/asap|today|immediately|urgent|tonight/i.test(text)) {
        score += 15;
        triggeredLayers.push("L7: Urgency Signal");
    }

    // --- LAYER 8: AUTHORITY MODELING ---
    if (authorInfo?.bio) {
        const bio = authorInfo.bio.toLowerCase();
        if (/founder|ceo|cto|owner|director|head of/i.test(bio)) {
            score += 20;
            triggeredLayers.push("L8: Authority Match (DM)");
        }
    }

    // --- LAYER 15: COMBINATION BOOSTS ---
    const isFounder = triggeredLayers.includes("L8: Authority Match (DM)");
    const isUrgent = triggeredLayers.includes("L7: Urgency Signal");
    if (isFounder && isUrgent) {
        score *= 1.2;
        triggeredLayers.push("L15: Founder+Urgency Boost");
    }

    // Final Tiering
    let tier = 'Strong';
    if (score >= 85) tier = 'Buy Now';
    else if (score >= 65) tier = 'Hot';

    return {
        score: Math.min(100, Math.round(score)),
        tier,
        reasoning: triggeredLayers,
        analysis: `Detected ${triggeredLayers.length} intelligence signals.`
    };
    }

    // --- LAYER 11-12: SCORING & TIERING ---
    const finalScore = Math.min(100, Math.max(0, Math.round(score)));
    let tier = 'IGNORE';
    if (finalScore >= 90) tier = 'BUY NOW';
    else if (finalScore >= 75) tier = 'HOT';
    else if (finalScore >= 60) tier = 'STRONG';
    else if (finalScore >= 45) tier = 'WATCHLIST';
    
    pipeline.push({ step: 'Scoring', status: 'pass', detail: `Confidence: ${finalScore}% -> ${tier}` });

    // --- LAYER 17: OUTREACH BRAIN ---
    let outreachAngle = "Discovery Inquiry";
    if (signals.includes('Switch Ready')) outreachAngle = "Alternative Solution / Comparison";
    else if (signals.includes('Severe Pain')) outreachAngle = "Immediate Friction Relief";
    else if (signals.includes('Buying Intent')) outreachAngle = "Direct Value Proposal";

    return {
        id: rawPost.id || Math.random().toString(36).substr(2, 9),
        score: finalScore,
        tier: tier,
        platform: context.platform,
        name: rawPost.name,
        role: context.role,
        intelligenceScore: finalScore,
        intelligenceTier: tier,
        intelligenceSignals: signals,
        intelligencePipeline: pipeline,
        why: outreachAngle,
        postText: rawPost.postText || rawPost.text,
        postUrl: rawPost.postUrl || rawPost.url,
        url: rawPost.url,
        outreachAngle: outreachAngle,
        evidence: normalized.substring(0, 150),
        timestamp: context.timestamp
    };
}

// Export for module systems
if (typeof module !== 'undefined') {
    module.exports = { processLeadIntelligence };
}
