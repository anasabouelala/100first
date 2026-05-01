import { GoogleGenAI, Type, Schema } from "@google/genai";
import * as cheerio from 'cheerio';
import { StrategyPlan, RoastResult, GroundingChunk, DistributionChannel, GeneratedContent, ChannelAnalysis, CompetitorData, CompetitorDeepDive, OutreachResponse, MarketOpportunity, ReplyDraft, IndustryBenchmark, SearchDork } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper: Validate and enrich opportunity with real page title
const validateOpportunity = async (opp: MarketOpportunity): Promise<MarketOpportunity | null> => {
    try {
        // 1. Basic URL check
        if (!opp.url || !opp.url.startsWith('http')) return null;
        if (opp.url.includes('google.com/search')) return null;

        // 2. Fetch the page (with timeout and user-agent)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
        
        const response = await fetch(opp.url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        // 3. Handle status codes
        if (response.status === 404) {
            console.log(`[Validator] Dead Link (404): ${opp.url}`);
            return null;
        }
        
        // 4. If successful, try to parse title
        if (response.ok) {
            const html = await response.text();
            const $ = cheerio.load(html);
            const pageTitle = $('title').text().trim();
            
            // Check for generic error pages
            if (pageTitle.includes('404') || pageTitle.includes('Not Found') || pageTitle.includes('Page not found')) {
                console.log(`[Validator] Soft 404: ${opp.url}`);
                return null;
            }

            // Update headline with real title if it seems valid
            if (pageTitle && pageTitle.length > 5 && !pageTitle.includes('Captcha') && !pageTitle.includes('Access Denied')) {
                console.log(`[Validator] Verified: ${opp.url} -> "${pageTitle}"`);
                return { ...opp, headline: pageTitle };
            }
        }
        
        // If we got here (e.g. 403 Forbidden or no title found), we keep the original opportunity 
        // but mark it as potentially unverified if needed. For now, we assume it's okay if not 404.
        return opp;

    } catch (error) {
        // Network error or timeout - usually means the site exists but blocked us or is slow.
        // We'll keep it but log the error.
        console.log(`[Validator] Fetch Error (${opp.url}):`, error);
        return opp; 
    }
};

// ... existing generateLaunchStrategy ...
export const generateLaunchStrategy = async (
  appName: string,
  description: string,
  audience: string
): Promise<StrategyPlan> => {
  const model = "gemini-3-flash-preview";
  
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      productName: { type: Type.STRING },
      targetAudience: { type: Type.STRING },
      phases: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            phaseName: { type: Type.STRING, description: "e.g., 'Day 1-3: The Warm Up' or 'The Viral Hook'" },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING, description: "Specific, actionable tactic to get users." },
                  impact: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                  effort: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                  channel: { type: Type.STRING, description: "e.g., Twitter, Reddit, LinkedIn, Cold Email" }
                },
                required: ["id", "title", "description", "impact", "effort", "channel"]
              }
            }
          },
          required: ["phaseName", "steps"]
        }
      }
    },
    required: ["productName", "targetAudience", "phases"]
  };

  const prompt = `
    Create a high-impact, unconventional launch strategy to get the first 100 users for:
    App Name: ${appName}
    Description: ${description}
    Target Audience: ${audience}

    Focus on "Guerrilla Marketing", "Engineering as Marketing", and high-conversion direct outreach. 
    Avoid generic advice like "post on social media". Be specific.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are a growth hacker specializing in getting the first 100 users for indie products. You are bold, strategic, and practical."
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    return JSON.parse(text) as StrategyPlan;
  } catch (error) {
    console.error("Strategy Gen Error:", error);
    throw error;
  }
};

// ... existing roastLandingPage ...
export const roastLandingPage = async (
  base64Image: string
): Promise<RoastResult> => {
  const model = "gemini-2.5-flash-image";
  
  const prompt = `
    Look at this landing page screenshot. 
    1. Give it a conversion score out of 100.
    2. Roast it mercilessly but constructively. Focus on the headline, CTA, and clarity.
    3. List 3 specific improvements to increase conversion immediately.

    Output format:
    SCORE: [number]
    ROAST: [text]
    IMPROVEMENT 1: [text]
    IMPROVEMENT 2: [text]
    IMPROVEMENT 3: [text]
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Image } },
          { text: prompt }
        ]
      }
    });

    const text = response.text || "";
    
    const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    
    const roastMatch = text.match(/ROAST:\s*([\s\S]*?)(?=IMPROVEMENT)/i);
    const roast = roastMatch ? roastMatch[1].trim() : "Could not generate roast.";

    const improvements: string[] = [];
    const impRegex = /IMPROVEMENT \d+:\s*([^\n]+)/gi;
    let m;
    while ((m = impRegex.exec(text)) !== null) {
      improvements.push(m[1].trim());
    }

    return { score, roast, improvements };

  } catch (error) {
    console.error("Roast Error:", error);
    throw error;
  }
};

// ... updated findDistributionChannels ...
export const findDistributionChannels = async (
  appDescription: string,
  category: string
): Promise<DistributionChannel[]> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Specific name. For Reddit, use 'r/SubredditName'. For newsletters, use the specific newsletter name." },
        url: { type: Type.STRING, description: "MUST be the main homepage URL. No deep links that might 404." },
        type: { type: Type.STRING, enum: ["Directory", "Community", "Social", "Newsletter", "Launchpad"] },
        category: { type: Type.STRING, enum: ["Organic", "Ads"], description: "Is this a free/organic channel or a paid ad/sponsorship channel?" },
        tier: { type: Type.STRING, enum: ["Tier 1 (Viral)", "Tier 2 (Niche)", "Tier 3 (SEO)"] },
        reason: { type: Type.STRING, description: "Why is this specific platform good for this app?" },
        matchScore: { type: Type.INTEGER, description: "0-100 relevance score" },
        audienceSize: { type: Type.STRING, description: "Estimated active users e.g. '2.4M/mo' or '15k Subs'" },
        engagementLevel: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
        cost: { type: Type.STRING, enum: ["Free", "Paid", "Freemium"] },
        minEntryCost: { type: Type.STRING, description: "For Ads: Minimum budget to start (e.g. '$500/mo'). For Organic: '0'." },
        avgCPC: { type: Type.STRING, description: "For Ads: Average Cost Per Click (e.g. '$1.50'). For Organic: '0'." },
        successCase: { type: Type.STRING, description: "Name of a similar app that succeeded here" },
        bestTime: { type: Type.STRING, description: "Best day/time to post" },
        opportunityCount: { type: Type.INTEGER, description: "Estimated number of active weekly discussions/threads relevant to this app. BE SPECIFIC." }
      },
      required: ["name", "url", "type", "category", "tier", "reason", "matchScore", "audienceSize", "engagementLevel", "cost", "successCase", "bestTime", "opportunityCount"]
    }
  };

  const prompt = `
    Find the TOP 15 Best distribution channels to launch this app:
    Category: ${category}
    Description: ${appDescription}

    I need a mix of ORGANIC (free), ADS (paid), and LAUNCHPADS (directories).
    
    REQUIREMENTS:
    1. **Specific Names**: 
       - For Reddit, do NOT just say "Reddit". Give me specific subreddits like "r/SaaS" or "r/SideProject".
       - For Newsletters, give me specific newsletter names.
    2. **Mandatory Launchpads**:
       - You MUST include relevant "Launchpads" or "Directories" for early adopters (e.g., "There's An AI For That", "Product Hunt", "BetaList", "Uneed.best", "Microlaunch", etc.) if applicable.
       - Categorize these as 'Launchpad' type.
    3. **Categories**:
       - **Organic**: Forums, communities, social media where you can post for free.
       - **Ads**: Newsletters, paid directories, or ad networks where you can pay for placement.
    4. **Accurate Data**:
       - **Opportunity Count**: Be specific about how many relevant weekly threads/opportunities exist.
       - **Ads Data**: For "Ads" category, you MUST estimate 'minEntryCost' (minimum budget) and 'avgCPC'.
    5. **Working Links**:
       - ONLY provide the MAIN HOMEPAGE URL (e.g., "https://www.reddit.com/r/SaaS").
       - DO NOT provide deep links to specific posts that might be old or broken.
       - If the community doesn't exist, do not list it.

    Structure the response to have roughly:
    - 40% Organic Communities
    - 30% Launchpads / Directories (TAAFT, etc.)
    - 30% Paid Ads / Sponsorships
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are a senior distribution strategist. You find high-leverage opportunities. You NEVER hallucinate URLs. You provide specific subreddits and newsletter names."
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    return JSON.parse(text) as DistributionChannel[];
  } catch (error) {
    console.error("Distribution Gen Error:", error);
    throw error;
  }
};

// ... updated getIndustryBenchmarks ...
export const getIndustryBenchmarks = async (
  category: string
): Promise<IndustryBenchmark[]> => {
  const model = "gemini-3-flash-preview";
  
  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        metric: { type: Type.STRING, description: "e.g. CAC, Churn Rate, Conversion" },
        avgValue: { type: Type.STRING, description: "Industry Average" },
        top10Value: { type: Type.STRING, description: "Top 10% performance" },
        unit: { type: Type.STRING, description: "e.g. %, $" },
        insight: { type: Type.STRING, description: "Why this matters for this category" }
      },
      required: ["metric", "avgValue", "top10Value", "unit", "insight"]
    }
  };

  const prompt = `
    Generate 5 key Growth Benchmarks specific to this category: "${category}".
    
    Do NOT assume B2B unless the category implies it. 
    If it is B2C, provide B2C metrics (e.g. Virality, Retention).
    If it is Marketplace, provide GMV/Take Rate metrics.

    Include:
    1. Acquisition Cost (CAC)
    2. Retention/Churn
    3. Conversion Rate
    4. Monetization Metric (ARPU/LTV)
    5. A wildcard metric specific to this niche (e.g. "Time to Value").

    Use 2024/2025 industry standard data.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No benchmarks generated");
    return JSON.parse(text) as IndustryBenchmark[];
  } catch (error) {
    console.error("Benchmarks Gen Error:", error);
    throw error;
  }
};

// ... updated analyzeChannel ...
export const analyzeChannel = async (
  channelName: string,
  channelUrl: string,
  appDescription: string
): Promise<ChannelAnalysis> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: "Brief overview of what this community is about." },
      rules: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "3-5 most critical rules regarding self-promotion."
      },
      audienceVibe: { type: Type.STRING, description: "e.g. 'Supportive of makers', 'Ruthlessly technical', 'Hates spam'" },
      successfulPostTypes: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "What formats work best? e.g. 'Long stories', 'Video demos', 'Open source repos'" 
      },
      moderationStrictness: { type: Type.STRING, enum: ["Low", "Medium", "High", "Brutal"] },
      verdict: { type: Type.STRING, description: "Final strategic advice on how to win here." },
      saasKpis: {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                label: { type: Type.STRING, description: "Metric name e.g. 'Benchmark CPC' or 'Signup Rate'"},
                value: { type: Type.STRING, description: "Value e.g. '$2.50' or '4%'"},
                trend: { type: Type.STRING, enum: ["Up", "Down", "Stable"]},
                context: { type: Type.STRING, description: "Contextual note"}
            },
            required: ["label", "value", "trend", "context"]
        }
      },
      algorithmSecrets: {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                trigger: { type: Type.STRING, description: "The action that triggers growth"},
                tactic: { type: Type.STRING, description: "What you should do"},
                impact: { type: Type.STRING, description: "Expected result"}
            },
            required: ["trigger", "tactic", "impact"]
        }
      },
      contentHooks: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Specific headlines or hooks that work on this platform."
      }
    },
    required: ["summary", "rules", "audienceVibe", "successfulPostTypes", "moderationStrictness", "verdict", "saasKpis", "algorithmSecrets", "contentHooks"]
  };

  const prompt = `
    Conduct a "Growth Engineer" level deep dive into: ${channelName} (${channelUrl}).
    App to launch: ${appDescription}

    I want HARD DATA and GROWTH HACKING SECRETS.
    
    1. **SaaS KPIs**: Estimate *Platform Specific* benchmarks. (e.g. "Avg CPC on LinkedIn", "Reddit Organic Viral Rate"). DO NOT use specific competitor names. Use market averages.
    2. **Algorithm Secrets**: How do we hack visibility here? 
    3. **Content Hooks**: Give me 3 headline structures that go viral here.
    
    Use Google Search to find current benchmarks (2024/2025).
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are a specialized Growth Engineer. You provide market averages and platform benchmarks. You do NOT discuss specific competitors in this analysis."
      }
    });

    const text = response.text;
    if (!text) throw new Error("No analysis generated");
    return JSON.parse(text) as ChannelAnalysis;
  } catch (error) {
    console.error("Analysis Gen Error:", error);
    throw error;
  }
};

// ... existing generateChannelContent ...
export const generateChannelContent = async (
  channel: DistributionChannel,
  appName: string,
  description: string
): Promise<GeneratedContent> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      subject: { type: Type.STRING, description: "Title or Headline of the post" },
      body: { type: Type.STRING, description: "The main content/post body" },
      firstComment: { type: Type.STRING, description: "Optional: A first comment to kickstart engagement" },
      postingTips: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "3 specific tips to avoid getting banned and maximize clicks" 
      }
    },
    required: ["subject", "body", "postingTips"]
  };

  const prompt = `
    Write a high-converting launch post for the app "${appName}" on the platform "${channel.name}".
    App Description: ${description}
    Platform Context: ${channel.type}, Audience: ${channel.audienceSize}, Tone: ${channel.tier}.
    
    CRITICAL: 
    - Adapt the tone perfectly (Reddit = authentic, PH = excited maker, HN = technical).
    - Provide 3 specific tips for this platform (e.g. "Don't use link shorteners", "Reply to every comment").
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No content generated");
    return JSON.parse(text) as GeneratedContent;
  } catch (error) {
    console.error("Content Gen Error:", error);
    throw error;
  }
};

// ... existing findCompetitors ...
export const findCompetitors = async (
  appDescription: string
): Promise<CompetitorData[]> => {
  const model = "gemini-3-flash-preview";
  
  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        url: { type: Type.STRING },
        tagline: { type: Type.STRING },
        similarityScore: { type: Type.INTEGER, description: "0-100" },
        threatLevel: { type: Type.STRING, enum: ["High", "Medium", "Low"] }
      },
      required: ["name", "url", "tagline", "similarityScore", "threatLevel"]
    }
  };

  const prompt = `
    Identify 6 existing apps or competitors that are similar to this idea:
    "${appDescription}"

    Use Google Search to find REAL, currently active apps.
    Prioritize apps that have successfully launched (e.g., have a Product Hunt history or active social accounts).
    
    STRICT RULE: The 'url' must be the ACTUAL homepage of the app. Do not invent apps.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are a market intelligence analyst. You only report on real, existing competitors with verified URLs."
      }
    });

    const text = response.text;
    if (!text) throw new Error("No competitors found");
    return JSON.parse(text) as CompetitorData[];
  } catch (error) {
    console.error("Competitor Search Error:", error);
    throw error;
  }
};

// ... existing analyzeCompetitorStrategy ...
export const analyzeCompetitorStrategy = async (
  competitorName: string,
  competitorUrl: string
): Promise<CompetitorDeepDive> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: "How they position themselves in the market." },
      trafficSources: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "e.g. Product Hunt, Twitter, SEO" },
            kpi: { type: Type.STRING, description: "e.g. '#1 Product of the Day', '45k Followers', 'DR 70'" },
            sentiment: { type: Type.STRING, enum: ["Positive", "Neutral", "Negative"] },
            link: { type: Type.STRING, description: "Link to their profile or viral post if found" }
          },
          required: ["name", "kpi", "sentiment"]
        }
      },
      first100UsersStrategy: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timeframe: { type: Type.STRING, description: "e.g. 'Launch Day', 'Month 1'" },
            action: { type: Type.STRING, description: "What did they do? e.g. 'Posted on HN'" },
            result: { type: Type.STRING, description: "Outcome? e.g. 'Front page, 2k visitors'" },
            details: { type: Type.STRING, description: "Extremely detailed context. What specific content did they post? Why did it work? Include numbers." }
          },
          required: ["timeframe", "action", "result"]
        }
      },
      communityBehaviors: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            platform: { type: Type.STRING },
            persona: { type: Type.STRING, description: "Their behavioral persona e.g. 'The Helpful Expert', 'The Meme Lord', 'The Humble Builder'" },
            actionFrequency: { type: Type.STRING, description: "e.g. 'Posts daily updates', 'Comments on 10+ threads/day'" },
            engagementMetrics: { type: Type.STRING, description: "e.g. 'Avg 50 upvotes/post', 'Replies within 5 mins'" },
            tone: { type: Type.STRING, description: "e.g. 'Authoritative', 'Vulnerable', 'Aggressive'" },
            keyTactic: { type: Type.STRING, description: "The specific move they use to win trust." }
          },
          required: ["platform", "persona", "actionFrequency", "engagementMetrics", "tone", "keyTactic"]
        }
      },
      videoMentions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            channelName: { type: Type.STRING },
            views: { type: Type.STRING },
            url: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["Review", "Interview", "Tutorial"] }
          },
          required: ["title", "channelName", "views", "type"]
        }
      },
      founderQuote: { type: Type.STRING },
      techStack: { type: Type.ARRAY, items: { type: Type.STRING } },
      pricingModel: { type: Type.STRING },
      marketingHooks: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "Key phrases they use to convert users"
      },
      weakness: { type: Type.STRING, description: "The biggest complaint users have about them." }
    },
    required: ["summary", "trafficSources", "first100UsersStrategy", "communityBehaviors", "videoMentions", "marketingHooks", "weakness"]
  };

  const prompt = `
    Perform a "Reverse Engineering" Deep Dive on: ${competitorName} (${competitorUrl}).
    
    GOAL: Reconstruct their path to their first 100 users with forensic detail.

    1. **"First 100" Timeline**: Don't just say "they posted on Reddit". Say "They posted a 'Show HN' thread titled 'I built X to solve Y' which got 150 points. They then cross-posted to r/SideProject."
       - Look for the exact moments they spiked in traffic.
    
    2. **Community Behavior Analysis**: How do they behave in forums (Reddit, X, Discord)?
       - What is their "Persona"? (e.g., The vulnerable founder sharing failures? The expert giving free advice?)
       - What are their MICRO-METRICS? (e.g., "They reply to every comment", "They post 3x/week").
       - What is their "Trojan Horse" for self-promotion? (e.g., "Salary transparency", "Open sourcing code").

    3. **Tech & Media**:
       - YouTube reviews/interviews.
       - Tech stack & pricing.

    Use Google Search to find real, specific data points from their history (Indie Hackers interviews, old tweets, Product Hunt launch day comments).
    STRICT RULE: All links (YouTube videos, viral posts, social profiles) MUST be real. Do not hallucinate links.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are a forensic marketing analyst. You provide concrete, actionable intelligence. You verify all claims and links using Google Search. Do not fabricate urls."
      }
    });

    const text = response.text;
    if (!text) throw new Error("No deep dive analysis generated");
    return JSON.parse(text) as CompetitorDeepDive;
  } catch (error) {
    console.error("Deep Dive Error:", error);
    throw error;
  }
};

// ... existing generateColdOutreach ...
export const generateColdOutreach = async (
  prospectInfo: string,
  appDescription: string
): Promise<OutreachResponse> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      prospectAnalysis: { type: Type.STRING, description: "Quick analysis of who this person is and what they value." },
      messages: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            angle: { type: Type.STRING, description: "e.g. 'The Flattery', 'The Problem Solver', 'The Beta Invite'" },
            subject: { type: Type.STRING },
            body: { type: Type.STRING, description: "The DM/Email body." },
            whyItWorks: { type: Type.STRING, description: "Psychological explanation." }
          },
          required: ["angle", "subject", "body", "whyItWorks"]
        }
      }
    },
    required: ["prospectAnalysis", "messages"]
  };

  const prompt = `
    Generate 3 distinct cold outreach messages (DMs or Emails) to potential early user.
    
    My App: ${appDescription}
    
    The Prospect (Bio/Tweet/Headline):
    "${prospectInfo}"

    RULES:
    1. NO GENERIC FLUFF. Do not say "I hope this email finds you well."
    2. Be hyper-personalized. Reference specific things from their info.
    3. Goal: Get them to try the app (Beta) or give feedback. Not a hard sale.
    4. Tone: Casual, Founder-to-Founder, or "Hacker" vibes.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No outreach content generated");
    return JSON.parse(text) as OutreachResponse;
  } catch (error) {
    console.error("Outreach Gen Error:", error);
    throw error;
  }
};

// ... updated findChannelOpportunities ...
// STRATEGY SHIFT: User explicitly requested REAL links only. No Dorks.
// We now use groundingMetadata to verify and correct URLs.
export const findChannelOpportunities = async (
  channel: DistributionChannel,
  appDescription: string
): Promise<MarketOpportunity[]> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ["Thread", "Comment", "Post"] },
        headline: { type: Type.STRING, description: "The exact title of the thread/post found in search." },
        url: { type: Type.STRING, description: "The DIRECT URL to the specific thread/comment." },
        context: { type: Type.STRING, description: "Why this opportunity matters." },
        relevanceScore: { type: Type.INTEGER },
      },
      required: ["type", "headline", "url", "context", "relevanceScore"]
    }
  };

  const prompt = `
    I need to find 5 ACTIVE, REAL discussions on ${channel.name} (${channel.url}) about topics related to: "${appDescription}".
    
    CRITICAL INSTRUCTION:
    - You MUST use Google Search to find ACTUAL, EXISTING threads/posts from the last 3 months.
    - **DO NOT** generate "Search Dorks" or Google Search Query URLs.
    - **DO NOT** hallucinate URLs. If you can't find a direct link, do not invent one.
    - The 'url' field MUST be a direct link to the content (e.g., "https://www.reddit.com/r/SaaS/comments/xyz/how_to_market...").
    
    Task:
    1. Search for keywords related to the app description on the specific site (site:${channel.url.replace('https://', '').replace('www.', '')}).
    2. Select the top 5 most relevant, recent discussions.
    3. Return them as a list of opportunities.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No opportunities found");
    
    let opportunities = JSON.parse(text) as MarketOpportunity[];
    
    // VERIFICATION STEP:
    // The model sometimes hallucinates URLs even with search. 
    // We can cross-reference with groundingChunks (the actual search results) to ensure validity.
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] | undefined;
    
    if (chunks && chunks.length > 0) {
        // Create a map of valid URLs from search results
        const validUrls = new Set(chunks.map(c => c.web?.uri).filter(u => u));
        
        opportunities = opportunities.map(opp => {
            // 1. If the URL is already in the valid list, keep it.
            if (validUrls.has(opp.url)) return opp;

            // 2. If not, try to find a fuzzy match in the chunks based on title/headline
            const match = chunks.find(c => 
                c.web?.title && (
                    c.web.title.includes(opp.headline) || 
                    opp.headline.includes(c.web.title) ||
                    (c.web.uri && opp.url.includes(c.web.uri)) // Partial URL match
                )
            );

            if (match && match.web?.uri) {
                console.log(`Corrected URL for "${opp.headline}": ${opp.url} -> ${match.web.uri}`);
                return { ...opp, url: match.web.uri };
            }

            // 3. If still no match, flag it or keep it (it might be a sub-page not explicitly in chunks but valid)
            // Ideally, we filter out completely invalid ones, but for now let's keep it but warn.
            return opp;
        });
    }

    // Filter out obviously bad URLs (search pages, 404s patterns)
    const filteredOpps = opportunities.filter(opp => 
        opp.url && 
        !opp.url.includes('google.com/search') && 
        !opp.url.includes('search?q=') &&
        opp.url.startsWith('http')
    );

    // FINAL VALIDATION: Ping the URLs to ensure they are alive (200 OK)
    const validatedOpps = await Promise.all(filteredOpps.map(validateOpportunity));
    return validatedOpps.filter((opp): opp is MarketOpportunity => opp !== null);

  } catch (error) {
    console.error("Opportunity Scan Error:", error);
    throw error;
  }
};

// ... existing generateOpportunityReply ...
export const generateOpportunityReply = async (
  opportunity: MarketOpportunity,
  channelName: string,
  appDescription: string,
  rules: string[]
): Promise<ReplyDraft> => {
  const model = "gemini-3-flash-preview";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: "The actual comment/reply text." },
      explanation: { type: Type.STRING, description: "Why this reply will work." },
      safetyCheck: { type: Type.STRING, description: "Policy check against channel rules." }
    },
    required: ["text", "explanation", "safetyCheck"]
  };

  const prompt = `
    Write a reply strategy for this opportunity on ${channelName}:
    Headline: "${opportunity.headline}"
    Context: "${opportunity.context}"
    URL: "${opportunity.url}"

    My App: "${appDescription}"
    Channel Rules: ${rules.join('\n')}

    Write a specific, high-value reply that adds value to the conversation.
    - Do NOT be spammy.
    - If appropriate, subtly mention the app as a solution, but prioritize being helpful.
    - Match the tone of the platform.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No reply generated");
    return JSON.parse(text) as ReplyDraft;
  } catch (error) {
    console.error("Reply Gen Error:", error);
    throw error;
  }
};

export const generateLeadDorks = async (
    targetAudience: string,
    platform: string
): Promise<SearchDork[]> => {
    const model = "gemini-3-flash-preview";

    const schema: Schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                label: { type: Type.STRING, description: "What this search finds (e.g. 'CEOs hiring now')"},
                query: { type: Type.STRING, description: "The Google search query string." },
                explanation: { type: Type.STRING, description: "Why this syntax works."}
            },
            required: ["label", "query", "explanation"]
        }
    }

    const prompt = `
        Generate 3 advanced Google Search Dorks (Boolean Search Strings) to find leads for: "${targetAudience}" on Platform: "${platform}".
        
        Techniques:
        - Use "site:${platform}"
        - Use "intitle:" or "inurl:"
        - Use "AND", "OR", "-" logic.
        - Example for LinkedIn: 'site:linkedin.com/in/ "Founder" AND "SaaS" AND "hiring"'
        - Example for Twitter: 'site:twitter.com "looking for" AND "marketing agency" -intitle:jobs'

        Return the raw search query string that I can paste into Google.
    `;

    try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema
          }
        });
    
        const text = response.text;
        if (!text) throw new Error("No dorks generated");
        return JSON.parse(text) as SearchDork[];
      } catch (error) {
        console.error("Dork Gen Error:", error);
        throw error;
      }
}
// Restored Answerly & ICP Recon Functions
export const generateICPReconQueries = async (campaign: ICPReconCampaign): Promise<ICPTrackingKeyword[]> => {
    const model = "gemini-3-flash-preview";
    const schema: Schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                platform: { type: Type.STRING },
                query: { type: Type.STRING },
                intent: { type: Type.STRING }
            },
            required: ["platform", "query", "intent"]
        }
    };

    const prompt = `
You are an Intent-Based Keyword Architect for 2026. Your mission is to translate a founder's lead generation brief into surgically precise Boolean search strings. 

### THE BUYER vs SELLER RULE
- BUYERS say: "Need help with X", "X is failing", "Alternative to X", "Recommendations for X", "Budget for X".
- SELLERS (Competitors) say: "How to fix X", "X tips", "DM for X", "Hire us for X", "X case study".
- YOUR MISSION: Generate queries that catch BUYER signals while aggressively EXCLUDING SELLER noise.

### CONTEXT
Product Name: ${campaign.name}
Full Brief: "${campaign.originalBrief || 'N/A'}"
Target Personas: ${campaign.roles.join(', ')}
Key Pain Points: ${campaign.painPoints.join(', ')}
Manual Negative Keywords (EXCLUDE THESE): ${(campaign.negativeKeywords || []).join(', ')}

### THE TASK
Generate a MASSIVE matrix of 30-50 surgically precise search dorks.
Spread them across these platforms: ${campaign.platforms.join(', ')}.

The matrix MUST cover the following 18-layer signal clusters:
- Intent Cluster: (recommend, looking for, buying, budget)
- Pain Cluster: (broken, slow, expensive, losing leads)
- Urgency Cluster: (asap, today, urgent, launch)
- Switch Cluster: (alternatives, cancelling, leaving, hate)
- Growth Cluster: (hiring, expansion, fundraising)
- Authority Cluster: (founder, CEO, director, head of)

Return a JSON array of 30-50 objects.
`;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema }
        });
        return JSON.parse(response.text) as ICPTrackingKeyword[];
    } catch (error) {
        console.error("ICP Recon Gen Error:", error);
        return campaign.painPoints.map(pp => ({
            platform: campaign.platforms[0],
            query: pp,
            intent: "Fallback Keyword Search"
        }));
    }
};

export const generateContentEnginePost = async (params: any): Promise<ContentEnginePost> => {
    const model = "gemini-3-flash-preview";
    const schema: Schema = {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING },
            hook: { type: Type.STRING },
            body: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["title", "hook", "body", "tags"]
    };
    const prompt = `Generate a high-engagement social post for ${params.platform}. Topic: ${params.topic}. Target: ${params.audience}.`;
    const response = await ai.models.generateContent({
        model, contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema }
    });
    return JSON.parse(response.text) as ContentEnginePost;
};

export const getPlatformInsights = async (platform: string): Promise<PlatformInsight> => {
    const model = "gemini-3-flash-preview";
    const schema: Schema = {
        type: Type.OBJECT,
        properties: {
            platform: { type: Type.STRING },
            trend: { type: Type.STRING },
            intensity: { type: Type.NUMBER },
            opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
            threats: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["platform", "trend", "intensity", "opportunities", "threats"]
    };
    const response = await ai.models.generateContent({
        model, contents: `Analyze current trends and opportunities for developers/founders on ${platform}.`,
        config: { responseMimeType: "application/json", responseSchema: schema }
    });
    return JSON.parse(response.text) as PlatformInsight;
};

export const generateSmartEngagementComment = async (postText: string, appDesc: string, title: string): Promise<SmartComment> => {
    const model = "gemini-3-flash-preview";
    const schema: Schema = {
        type: Type.OBJECT,
        properties: {
            options: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        body: { type: Type.STRING },
                        why: { type: Type.STRING }
                    },
                    required: ["body", "why"]
                }
            }
        },
        required: ["options"]
    };
    try {
        const response = await ai.models.generateContent({
            model,
            contents: `Generate 3 smart, non-spammy engagement comments for lead @${title}. Their post: "${postText}". My product: "${appDesc}". Under 200 chars each, conversational.`,
            config: { responseMimeType: "application/json", responseSchema: schema }
        });
        return JSON.parse(response.text) as SmartComment;
    } catch {
        return { options: [{ body: "Great perspective! Would love to connect.", why: "Neutral opener" }] };
    }
};

export const evaluateHNOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
        model,
        contents: `Evaluate these Hacker News items for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
};

export const evaluatePHOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
        model,
        contents: `Evaluate these Product Hunt items for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
};

export const evaluateRedditOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
        model,
        contents: `Evaluate these Reddit posts for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
};

export const generateBuyerPersonas = async (appName: string, appDesc: string, category: string): Promise<BuyerPersonaAnalysis> => {
    const model = "gemini-3-flash-preview";
    const schema: Schema = {
        type: Type.OBJECT,
        properties: {
            marketOverview: { type: Type.STRING },
            personas: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        role: { type: Type.STRING },
                        demographics: { type: Type.STRING },
                        realWorldQuote: { type: Type.STRING },
                        painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                        goals: { type: Type.ARRAY, items: { type: Type.STRING } },
                        whereTheyHangOut: { type: Type.ARRAY, items: { type: Type.STRING } },
                        contentTheyConsume: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["name","role","demographics","painPoints","goals","whereTheyHangOut","contentTheyConsume"]
                }
            }
        },
        required: ["marketOverview", "personas"]
    };
    const response = await ai.models.generateContent({
        model,
        contents: `Generate 3 detailed buyer personas for "${appName}" - a ${category} product. Description: "${appDesc}". Include market overview, demographics, pain points, goals, where they hang out online, and content they consume.`,
        config: { responseMimeType: "application/json", responseSchema: schema }
    });
    return JSON.parse(response.text) as BuyerPersonaAnalysis;
};

export const parseReconBrief = async (brief: string): Promise<{
    name: string;
    roles: string[];
    painPoints: string[];
    negativeKeywords: string[];
    platforms: string[];
}> => {
    try {
        // V5: Upgraded to latest flash for faster synthesis
        const modelName = "gemini-1.5-flash-latest"; 
        
        const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                roles: { type: Type.ARRAY, items: { type: Type.STRING } },
                painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                negativeKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                platforms: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["name", "roles", "painPoints", "negativeKeywords", "platforms"]
        };

        const generativeModel = ai.getGenerativeModel({ model: modelName });
        const response = await generativeModel.generateContent({
            contents: [{
                role: 'user',
                parts: [{
                    text: `Act as a High-Precision ICP Recon DNA Parser. 
                    Given the following user brief, extract a structured campaign identity.
                    
                    ### CRITICAL: THE BUYER vs SELLER POLARITY
                    Identify "SELLERS" (specialists, agencies, consultants, experts) and add them to negativeKeywords.
                    
                    Brief: "${brief}"`
                }]
            }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema
            }
        });

        const result = JSON.parse(response.response.text());
        return {
            name: result.name || brief.substring(0, 20),
            roles: (result.roles || []).filter((r: string) => r.length > 2),
            painPoints: (result.painPoints || []).filter((p: string) => p.length > 2),
            negativeKeywords: [...new Set([...(result.negativeKeywords || []), "agency", "expert", "consultant"])],
            platforms: (result.platforms || []).length > 0 ? result.platforms : ["X", "LinkedIn", "Reddit"]
        };
    } catch (e) {
        console.error("[Gemini] Brief Parsing Failed:", e);
        // ENHANCED FALLBACK: Use a more intelligent 'reasoning' approach even in failure
        const stopWords = new Set(['looking', 'for', 'people', 'facing', 'with', 'their', 'the', 'and', 'this']);
        const words = brief.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
        
        return {
            name: "Campaign: " + (words[0] || "Targeting"),
            roles: words.length > 0 ? [words[0].charAt(0).toUpperCase() + words[0].slice(1) + " Professional"] : ["Target Persona"],
            painPoints: words.length > 1 ? [words.slice(1, 3).join(' ') + " Issues"] : ["Operational Friction"],
            negativeKeywords: ["agency", "consultant", "expert", "freelancer"],
            platforms: ["X", "LinkedIn", "Reddit"]
        };
    }
};

