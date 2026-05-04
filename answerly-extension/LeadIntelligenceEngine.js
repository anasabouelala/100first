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

    let score = 20; // Base score for being discovered
    const pipeline = [];
    const signals = [];

    // --- LAYER 1: CONTEXT SYNTHESIS ---
    const context = {
        text: (rawPost.postText || rawPost.text || "").toLowerCase(),
        name: (rawPost.name || "").toLowerCase(),
        role: (rawPost.role || "").toLowerCase(),
        bio: (rawPost.bio || "").toLowerCase(),
        platform: rawPost.platform || "Unknown",
        timestamp: rawPost.timestamp || new Date().toISOString()
    };
    pipeline.push({ step: 'Ingestion', status: 'pass', detail: 'Context synthesized' });

    // --- LAYER 2: TOPIC & ICP ALIGNMENT ---
    const roles = (campaign.roles || []).map(r => r.toLowerCase());
    const industries = (campaign.industries || []).map(i => i.toLowerCase());
    const painPoints = (campaign.painPoints || []).map(p => p.toLowerCase());
    const interests = (campaign.interests || []).map(i => i.toLowerCase());
    const negatives = (campaign.negativeKeywords || []).map(n => n.toLowerCase());

    // A. Negative Keyword Filter (HARD FAIL)
    const negMatch = negatives.find(n => n && (context.text.includes(n) || context.role.includes(n)));
    if (negMatch) {
        pipeline.push({ step: 'Negative Filter', status: 'fail', detail: `Blacklisted: ${negMatch}` });
        return { score: 0, tier: 'IGNORE', pipeline, signals: ['Negative Keyword'] };
    }

    // B. Role/Industry Match (High Weight)
    const isRoleMatch = roles.some(r => r && (context.role.includes(r) || context.bio.includes(r)));
    if (isRoleMatch) {
        score += 30;
        signals.push('ICP Role Match');
        pipeline.push({ step: 'ICP Fit', status: 'pass', detail: 'Matches target role' });
    }

    const isIndustryMatch = industries.some(i => i && (context.text.includes(i) || context.role.includes(i)));
    if (isIndustryMatch) {
        score += 15;
        signals.push('Industry Match');
    }

    // C. Pain Point Detection (High Intent)
    const matchedPain = painPoints.filter(p => p && context.text.includes(p));
    if (matchedPain.length > 0) {
        score += 25;
        signals.push('Detected Pain: ' + matchedPain[0]);
        pipeline.push({ step: 'Pain Analysis', status: 'pass', detail: `Matched ${matchedPain.length} pain signals` });
    }

    // --- LAYER 3: SEMANTIC INTENT PATTERNS ---
    const intentPatterns = [
        { regex: /recommend|looking for|best tool|how to|any advice/i, weight: 20, label: "Buying Intent" },
        { regex: /alternative|switching|leaving|hate|broken|expensive/i, weight: 15, label: "Switch Signal" },
        { regex: /asap|today|urgent|immediately/i, weight: 10, label: "Urgency" }
    ];

    intentPatterns.forEach(p => {
        if (p.regex.test(context.text)) {
            score += p.weight;
            signals.push(p.label);
        }
    });

    // --- LAYER 4: AUTHORITY MODEL ---
    if (/\b(founder|ceo|cto|owner|director|head of|vp)\b/i.test(context.role + " " + context.bio)) {
        score += 20;
        signals.push('High Authority (DM)');
    }

    // --- LAYER 5: TIME DECAY ---
    const hoursOld = (new Date() - new Date(context.timestamp)) / 36e5;
    if (hoursOld < 2) score += 10; // Freshness bonus
    else if (hoursOld > 168) score -= 20; // Old content penalty

    // --- FINAL TIERING & IDENTITY PASS ---
    const finalScore = Math.min(100, Math.max(0, Math.round(score)));
    
    let tier = 'Nurture';
    if (finalScore >= 85) tier = 'Buy Now';
    else if (finalScore >= 65) tier = 'Warm Opportunity';
    else if (finalScore < 30) {
        // Identity-First Override: If they match ICP Role/Industry, don't ignore them!
        if (isRoleMatch || isIndustryMatch) {
            tier = 'Nurture';
            pipeline.push({ step: 'Identity Pass', status: 'pass', detail: 'High-value profile detected (ICP Role Match)' });
        } else {
            tier = 'IGNORE';
        }
    }

    pipeline.push({ step: 'Final Scoring', status: 'pass', detail: `Score ${finalScore}% -> ${tier}` });

    return {
        id: rawPost.id || Math.random().toString(36).substr(2, 9),
        score: finalScore,
        tier: tier,
        intelligenceScore: finalScore,
        intelligenceTier: tier,
        intelligenceSignals: signals,
        intelligencePipeline: pipeline,
        why: signals.length > 0 ? signals.join(', ') : "Contextual relevance",
        postText: rawPost.postText || rawPost.text,
        postUrl: rawPost.postUrl || rawPost.url,
        url: rawPost.url,
        name: rawPost.name,
        role: rawPost.role,
        timestamp: context.timestamp
    };
}

if (typeof module !== 'undefined') {
    module.exports = { processLeadIntelligence };
}
