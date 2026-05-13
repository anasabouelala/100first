import { GoogleGenAI, Type, Schema } from "@google/genai";
import * as cheerio from 'cheerio';
import { StrategyPlan, RoastResult, GroundingChunk, DistributionChannel, GeneratedContent, ChannelAnalysis, CompetitorData, CompetitorDeepDive, OutreachResponse, MarketOpportunity, ReplyDraft, IndustryBenchmark, SearchDork } from "../types";

const _apiKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || '';
const ai = new GoogleGenAI({ apiKey: _apiKey || 'MISSING_KEY_ADD_TO_.env' });

export const isGeminiConfigured = (): boolean => !!_apiKey && _apiKey !== 'MISSING_KEY_ADD_TO_.env';

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Gemini API key missing. Add VITE_GEMINI_API_KEY to your .env file (get one at https://aistudio.google.com/app/apikey) and restart the dev server.');
    this.name = 'GeminiNotConfiguredError';
  }
}

function assertConfigured() {
  if (!isGeminiConfigured()) throw new GeminiNotConfiguredError();
}

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
  const model = "gemini-flash-latest";

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
  assertConfigured();
  const model = "gemini-flash-latest";

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

  // Gemini API rejects `tools` (googleSearch) combined with `responseSchema`.
  // Try schema-mode first (deterministic). Fall back to grounded text mode if schema fails.
  const systemInstruction = "You are a senior distribution strategist. You find high-leverage opportunities. You NEVER hallucinate URLs. You provide specific subreddits and newsletter names.";

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction
      }
    });
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    return JSON.parse(text) as DistributionChannel[];
  } catch (schemaErr: any) {
    console.warn("Schema mode failed, retrying with grounded mode:", schemaErr?.message);
    // Fallback: ask for JSON in plain text with grounding
    const fallbackPrompt = prompt + "\n\nRespond ONLY with a valid JSON array matching the structure described. No markdown, no commentary.";
    try {
      const response = await ai.models.generateContent({
        model,
        contents: fallbackPrompt,
        config: { tools: [{ googleSearch: {} }], systemInstruction }
      });
      const text = response.text || "";
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start === -1 || end === -1) throw new Error("No JSON array in fallback response");
      return JSON.parse(cleaned.slice(start, end + 1)) as DistributionChannel[];
    } catch (fallbackErr: any) {
      console.error("Both modes failed. Schema:", schemaErr?.message, "Fallback:", fallbackErr?.message);
      throw new Error(`Channel search failed: ${fallbackErr?.message || schemaErr?.message || 'Unknown error'}`);
    }
  }
};

// ... updated getIndustryBenchmarks ...
export const getIndustryBenchmarks = async (
  category: string
): Promise<IndustryBenchmark[]> => {
  assertConfigured();
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
  assertConfigured();
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
            label: { type: Type.STRING, description: "Metric name e.g. 'Benchmark CPC' or 'Signup Rate'" },
            value: { type: Type.STRING, description: "Value e.g. '$2.50' or '4%'" },
            trend: { type: Type.STRING, enum: ["Up", "Down", "Stable"] },
            context: { type: Type.STRING, description: "Contextual note" }
          },
          required: ["label", "value", "trend", "context"]
        }
      },
      algorithmSecrets: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            trigger: { type: Type.STRING, description: "The action that triggers growth" },
            tactic: { type: Type.STRING, description: "What you should do" },
            impact: { type: Type.STRING, description: "Expected result" }
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
  assertConfigured();
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
  assertConfigured();
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
  assertConfigured();
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
        label: { type: Type.STRING, description: "What this search finds (e.g. 'CEOs hiring now')" },
        query: { type: Type.STRING, description: "The Google search query string." },
        explanation: { type: Type.STRING, description: "Why this syntax works." }
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
  const model = "gemini-flash-latest";
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
Mission Archetype: ${campaign.campaignType || 'Balanced'}
Funnel Intent: ${campaign.funnelStage || 'Full Funnel'}
Manual Negative Keywords (EXCLUDE THESE): ${(campaign.negativeKeywords || []).join(', ')}
Custom Mission Constraints: ${Object.entries(campaign.customParameters || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || 'None'}

### THE TASK
Generate exactly 50 surgically precise search keywords/dorks. 
Do NOT include explanations or details. 
Focus purely on variety and precision.

### GOAL CALIBRATION (MANDATORY)
Current Goal: ${campaign.campaignType || 'intent'}
Current Funnel: ${campaign.funnelStage || 'tofu'}

- If Goal is 'intent': Focus 100% on "Looking for", "Need", "Recommend".
- If Goal is 'pain': Focus 100% on "Broken", "Hate", "Failing", "Problem".
- If Goal is 'competitor': Focus 100% on "Alternative to", "Switching from [Competitor]".
- If Goal is 'growth': Focus 100% on "Hiring", "Funding", "New".

Spread them across: ${campaign.platforms.join(', ')}.
Each keyword must be a valid search string for the platform.

Return a JSON array of 50 objects.
`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema: schema }
    });
    return JSON.parse(response.text) as ICPTrackingKeyword[];
  } catch (error: any) {
    console.error("[Gemini] ICP Recon Gen Error:", error);
    
    // V6: ULTIMATE GOAL-AWARE Fallback (Ensures 50 keywords even if AI is offline)
    const goalModifiers: Record<string, string[]> = {
        intent: ['recommendations', 'looking for', 'need help', 'best tool for', 'anyone using', 'budget for'],
        pain: ['broken', 'not working', 'failing', 'slow', 'hate', 'problems with', 'stuck with'],
        competitor: ['alternative to', 'switching from', 'vs', 'leaving', 'better than', 'is it worth it'],
        growth: ['hiring', 'new office', 'funding', 'expansion', 'scaling'],
        engagement: ['anyone else', 'share link', 'what do you think', 'thoughts on']
    };
    
    const intentModifiers = goalModifiers[campaign.campaignType || 'intent'] || goalModifiers.intent;
    const fallbackQueries: ICPTrackingKeyword[] = [];
    const sourceKeywords = campaign.painPoints.length > 0 ? campaign.painPoints : (campaign.interests.length > 0 ? campaign.interests : ['growth']);
    
    let count = 0;
    while (count < 50) {
        for (const kw of sourceKeywords) {
            for (const platform of campaign.platforms) {
                for (const mod of intentModifiers) {
                    if (count >= 50) break;
                    fallbackQueries.push({
                        platform,
                        query: `${mod} ${kw}`,
                        intent: `Goal: ${campaign.campaignType} Fallback`
                    });
                    count++;
                }
                if (count >= 50) break;
            }
            if (count >= 50) break;
        }
    }

    return fallbackQueries;
  }
};

// ════════════════════════════════════════════════════════════════════
// CONTENT ENGINE — Voice Architecture System
// ════════════════════════════════════════════════════════════════════

export interface VoiceMix {
  authority: number;        // 0=humble student → 100=unquestionable expert
  energy: number;           // 0=zen → 100=manic
  vulnerability: number;    // 0=guarded → 100=bare soul
  provocation: number;      // 0=consensus → 100=controversial
  specificity: number;      // 0=vague poetry → 100=concrete numbers
  intimacy: number;         // 0=corporate → 100=DM to a friend
  rhythm: 'staccato' | 'punchy' | 'flowing' | 'contemplative';
}

export interface HookArchitecture {
  patternInterrupt: 'shocking_number' | 'taboo_confession' | 'precise_moment'
                  | 'self_indictment' | 'forbidden_statement' | 'unexpected_name';
  tensionMechanism: 'curiosity_gap' | 'cognitive_dissonance' | 'pain_mirror'
                  | 'status_threat' | 'forbidden_knowledge';
  promisePayoff: 'what_to_learn' | 'what_to_avoid' | 'who_to_become' | 'what_to_feel';
}

export interface PerspectiveInjector {
  uniqueAngle: string;       // "I shipped 47 failed products before this one"
  contrarian: string;        // what the majority gets wrong
  forbiddenTakes: string;    // what to NEVER say
  receipts: string;          // 3-5 numbers/results that credibilize
}

export interface ViralPhysics {
  statusCurrency: boolean;
  inGroupSignaling: boolean;
  tribalFraming: boolean;
  fortuneCookieClose: boolean;
  loopOpener: boolean;
  concessionMove: boolean;
  baitAndSwitch: boolean;
  forbiddenSpecificity: boolean;
}

export type CloserStrategy = 'open_question' | 'punchline' | 'reverse_cta' | 'soft_proof' | 'open_loop';

export interface ContentEngineParams {
  origin: 'answer' | 'rephrase' | 'build_in_public' | 'fresh';
  sourceContent: string;
  sourceUrl?: string;
  sourceCreator?: string;
  sourcePlatform?: string;
  targetPlatforms: string[];
  format: 'single' | 'thread' | 'longform' | 'comment';
  length?: 'short' | 'medium' | 'long';
  tone?: string;            // legacy field, optional
  hookStyle?: string;       // legacy field, optional
  cta: 'none' | 'soft' | 'medium' | 'hard';
  contentDNA?: string;
  bannedWords?: string[];
  styleInspiration?: string;
  // NEW Voice Architecture
  voiceMix?: VoiceMix;
  hook?: HookArchitecture;
  perspective?: PerspectiveInjector;
  viral?: ViralPhysics;
  closer?: CloserStrategy;
  variants?: number;        // generate N variants per platform (1-5)
}

export interface ContentEngineDraft {
  platform: string;
  content: string;
  hookUsed: string;
  tips: string[];
  voiceProfile?: string;
  variantNote?: string;
}

// Helper: turn a slider value into a directive
const sliderToDirective = (label: string, value: number, lowDesc: string, highDesc: string): string => {
  if (value < 20) return `${label}: ${value}/100 — strongly ${lowDesc}`;
  if (value < 40) return `${label}: ${value}/100 — leaning ${lowDesc}`;
  if (value < 60) return `${label}: ${value}/100 — balanced`;
  if (value < 80) return `${label}: ${value}/100 — leaning ${highDesc}`;
  return `${label}: ${value}/100 — strongly ${highDesc}`;
};

const PATTERN_INTERRUPT_DESC: Record<HookArchitecture['patternInterrupt'], string> = {
  shocking_number: 'Open with a specific, surprising figure (revenue, time, count) in the FIRST 5 words.',
  taboo_confession: 'Open with a personal admission most people would hide.',
  precise_moment: 'Open with "On [date]" or "At [time]" — anchor the reader in a specific instant.',
  self_indictment: 'Open by accusing yourself of something embarrassing or naive.',
  forbidden_statement: 'Open with a sentence that violates the unspoken rules of your industry.',
  unexpected_name: 'Open by naming a specific person, brand or tool nobody expects to see.'
};

const TENSION_MECHANISM_DESC: Record<HookArchitecture['tensionMechanism'], string> = {
  curiosity_gap: 'Set up a question whose answer the reader CANNOT guess from context.',
  cognitive_dissonance: 'State two facts that seem contradictory. Force the reader to wonder how both can be true.',
  pain_mirror: 'Articulate a frustration the reader has felt but never put into words.',
  status_threat: 'Hint that the reader is doing something that\'s costing them status/credibility/money.',
  forbidden_knowledge: 'Frame it as info "they" don\'t want you to have.'
};

const PROMISE_PAYOFF_DESC: Record<HookArchitecture['promisePayoff'], string> = {
  what_to_learn: 'Promise a clear takeaway they can apply today.',
  what_to_avoid: 'Promise a specific mistake/trap they\'ll dodge.',
  who_to_become: 'Promise an identity transformation (operator, expert, founder, etc.).',
  what_to_feel: 'Promise a felt experience (relief, validation, vindication).'
};

const VIRAL_DESC: Record<keyof ViralPhysics, string> = {
  statusCurrency: 'Embed at least one quotable insight the reader will WANT to share to look smart.',
  inGroupSignaling: 'Use insider vocabulary/acronyms/references that make the right audience feel "this person gets us".',
  tribalFraming: 'Frame an "us vs them" opposition (founders vs VCs, builders vs talkers, etc.) — but tasteful.',
  fortuneCookieClose: 'End with a single quotable, screenshot-worthy line.',
  loopOpener: 'Drop a cliffhanger that forces a reply or DM (e.g. "DM me for the spreadsheet").',
  concessionMove: 'Admit ONE thing against your own interest (huge trust amplifier).',
  baitAndSwitch: 'Start by AGREEING with the conventional view, then pivot mid-post to flip it.',
  forbiddenSpecificity: 'Name a specific tool / dollar amount / competitor that less brave writers wouldn\'t.'
};

const CLOSER_DESC: Record<CloserStrategy, string> = {
  open_question: 'End with a specific, answerable question (NOT "thoughts?").',
  punchline: 'End with a quotable, screenshot-worthy one-liner.',
  reverse_cta: 'End with "Don\'t [X] if [Y]" — counterintuitive call to NOT act.',
  soft_proof: 'End by casually mentioning a result/number from your own experience.',
  open_loop: 'End by teasing what you\'ll cover next time.'
};

function buildVoiceArchitecturePrompt(params: ContentEngineParams): string {
  const sections: string[] = [];

  // ── Voice Mix
  if (params.voiceMix) {
    const v = params.voiceMix;
    sections.push(`VOICE MIX (must be palpable in EVERY line — this is the writer's identity):
${sliderToDirective('Authority', v.authority, 'humble student tone, ask-as-you-go', 'unquestionable expert, declarative')}
${sliderToDirective('Energy', v.energy, 'zen contemplative, slow cadence', 'manic urgency, exclamation-heavy')}
${sliderToDirective('Vulnerability', v.vulnerability, 'guarded armor, no admissions', 'bare-soul confession, name your fear')}
${sliderToDirective('Provocation', v.provocation, 'polite consensus, agreeable', 'controversial, take a side')}
${sliderToDirective('Specificity', v.specificity, 'vague generalities, poetic', 'concrete numbers, dates, names')}
${sliderToDirective('Intimacy', v.intimacy, 'corporate distant, third-person', 'DM to a friend, second-person')}
RHYTHM: ${v.rhythm} — ${
      v.rhythm === 'staccato' ? 'short fragments. Three words. Period. Repeat.' :
      v.rhythm === 'punchy' ? 'mostly short sentences punctuated by occasional longer reflective lines.' :
      v.rhythm === 'flowing' ? 'long, winding sentences that build momentum across multiple clauses.' :
      'contemplative, comma-rich, with deliberate pauses and rhetorical breath marks.'
    }`);
  }

  // ── Hook Architecture
  if (params.hook) {
    sections.push(`HOOK ARCHITECTURE (the first 3 lines decide everything):
1. Pattern Interrupt: ${PATTERN_INTERRUPT_DESC[params.hook.patternInterrupt]}
2. Tension Mechanism: ${TENSION_MECHANISM_DESC[params.hook.tensionMechanism]}
3. Promise/Payoff: ${PROMISE_PAYOFF_DESC[params.hook.promisePayoff]}`);
  }

  // ── Perspective Injector — THIS IS THE UNIQUENESS VECTOR
  if (params.perspective) {
    const p = params.perspective;
    const uniqueParts: string[] = [];
    if (p.uniqueAngle) uniqueParts.push(`Unique angle / credential: "${p.uniqueAngle}"`);
    if (p.contrarian) uniqueParts.push(`Contrarian belief I want to express: "${p.contrarian}"`);
    if (p.receipts) uniqueParts.push(`Receipts (weave in naturally, do NOT list): ${p.receipts}`);
    if (p.forbiddenTakes) uniqueParts.push(`NEVER write any of these takes (forbidden): ${p.forbiddenTakes}`);
    if (uniqueParts.length) {
      sections.push(`PERSPECTIVE (this is what makes this post UNIQUELY mine — it MUST shape the angle):\n${uniqueParts.join('\n')}`);
    }
  }

  // ── Viral Physics
  if (params.viral) {
    const active = (Object.keys(params.viral) as Array<keyof ViralPhysics>).filter(k => params.viral![k]);
    if (active.length) {
      sections.push(`VIRAL PHYSICS (psychological triggers to ACTIVATE):\n${active.map(k => `- ${VIRAL_DESC[k]}`).join('\n')}`);
    }
  }

  // ── Closer
  if (params.closer) {
    sections.push(`CLOSER STRATEGY: ${CLOSER_DESC[params.closer]}`);
  }

  return sections.join('\n\n');
}

export interface VoiceProfileSuggestion {
  voiceMix: VoiceMix;
  hook: HookArchitecture;
  viral: ViralPhysics;
  closer: CloserStrategy;
  reasoning: string;
}

export const suggestVoiceProfile = async (context: {
  sourceContent: string;
  perspective?: PerspectiveInjector;
  format?: string;
  targetPlatforms?: string[];
  styleInspiration?: string;
}): Promise<VoiceProfileSuggestion> => {
  assertConfigured();
  const model = "gemini-flash-latest";

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      voiceMix: {
        type: Type.OBJECT,
        properties: {
          authority: { type: Type.NUMBER },
          energy: { type: Type.NUMBER },
          vulnerability: { type: Type.NUMBER },
          provocation: { type: Type.NUMBER },
          specificity: { type: Type.NUMBER },
          intimacy: { type: Type.NUMBER },
          rhythm: { type: Type.STRING, enum: ['staccato', 'punchy', 'flowing', 'contemplative'] }
        },
        required: ['authority', 'energy', 'vulnerability', 'provocation', 'specificity', 'intimacy', 'rhythm']
      },
      hook: {
        type: Type.OBJECT,
        properties: {
          patternInterrupt: { type: Type.STRING, enum: ['shocking_number', 'taboo_confession', 'precise_moment', 'self_indictment', 'forbidden_statement', 'unexpected_name'] },
          tensionMechanism: { type: Type.STRING, enum: ['curiosity_gap', 'cognitive_dissonance', 'pain_mirror', 'status_threat', 'forbidden_knowledge'] },
          promisePayoff: { type: Type.STRING, enum: ['what_to_learn', 'what_to_avoid', 'who_to_become', 'what_to_feel'] }
        },
        required: ['patternInterrupt', 'tensionMechanism', 'promisePayoff']
      },
      viral: {
        type: Type.OBJECT,
        properties: {
          statusCurrency: { type: Type.BOOLEAN },
          inGroupSignaling: { type: Type.BOOLEAN },
          tribalFraming: { type: Type.BOOLEAN },
          fortuneCookieClose: { type: Type.BOOLEAN },
          loopOpener: { type: Type.BOOLEAN },
          concessionMove: { type: Type.BOOLEAN },
          baitAndSwitch: { type: Type.BOOLEAN },
          forbiddenSpecificity: { type: Type.BOOLEAN }
        },
        required: ['statusCurrency', 'inGroupSignaling', 'tribalFraming', 'fortuneCookieClose', 'loopOpener', 'concessionMove', 'baitAndSwitch', 'forbiddenSpecificity']
      },
      closer: { type: Type.STRING, enum: ['open_question', 'punchline', 'reverse_cta', 'soft_proof', 'open_loop'] },
      reasoning: { type: Type.STRING, description: 'One sentence explaining WHY these settings fit this context.' }
    },
    required: ['voiceMix', 'hook', 'viral', 'closer', 'reasoning']
  };

  const p = context.perspective || { uniqueAngle: '', contrarian: '', forbiddenTakes: '', receipts: '' };
  const prompt = `You are a senior content strategist. Given the writer's context, suggest the OPTIMAL voice architecture for this specific post.

CONTEXT:
- Source / topic: ${context.sourceContent.slice(0, 800)}
- Format: ${context.format || 'single'}
- Target platforms: ${(context.targetPlatforms || ['X']).join(', ')}
${p.uniqueAngle ? `- Writer's unique angle: ${p.uniqueAngle}` : ''}
${p.contrarian ? `- Writer's contrarian belief: ${p.contrarian}` : ''}
${p.receipts ? `- Writer's receipts/credentials: ${p.receipts}` : ''}
${context.styleInspiration ? `- Style inspiration sample: ${context.styleInspiration.slice(0, 500)}` : ''}

TASK:
Choose voice mix values (0-100 for each dimension), the best hook architecture, which viral physics to activate, and the closer that fits this content best.

THINK ABOUT:
- Topic vulnerability vs hard data → adjust vulnerability/specificity
- Audience expertise → adjust authority/in-group signaling
- Format constraints (X tweet = high energy/staccato; LinkedIn long-form = contemplative)
- The writer's contrarian view → enable bait-and-switch and forbidden specificity if strong
- If they have receipts → enable concession move + status currency

Return JSON only.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: schema }
  });
  const text = response.text;
  if (!text) throw new Error('Empty response');
  return JSON.parse(text) as VoiceProfileSuggestion;
};

export const generateContentEnginePost = async (params: ContentEngineParams): Promise<ContentEngineDraft[]> => {
  assertConfigured();
  const model = "gemini-flash-latest";

  const variants = Math.max(1, Math.min(5, params.variants || 1));
  const platforms = params.targetPlatforms.length ? params.targetPlatforms : ['X'];

  const platformLimits: Record<string, string> = {
    'X': '280 characters MAX per tweet. If thread, each tweet stands alone yet links to the next.',
    'LinkedIn': '1,200-2,500 characters. Use line breaks aggressively. First line is the entire hook.',
    'Reddit': 'No length limit. Lowercase title-style. NO marketing language. Sound like a real human.',
    'Threads': '500 characters MAX. More casual, more meme-aware than X.'
  };

  const formatHints: Record<string, string> = {
    single: 'A single self-contained post.',
    thread: 'A thread of 5-9 connected posts. Number them. Each tweet must hook into the next.',
    longform: 'A long-form post with clear structure (hook → reveal → details → close).',
    comment: 'A reply to an existing post — should feel native to the conversation, not promotional.'
  };

  const voiceArchitecture = buildVoiceArchitecturePrompt(params);

  const sourceBlock = params.sourceContent
    ? `SOURCE MATERIAL (${params.origin}):\n${params.sourceContent}${params.sourceCreator ? `\n— Original by ${params.sourceCreator}` : ''}${params.sourceUrl ? `\n— URL: ${params.sourceUrl}` : ''}`
    : '';

  const dnaBlock = params.contentDNA ? `\nMY BRAND DNA (apply silently):\n${params.contentDNA}` : '';
  const styleBlock = params.styleInspiration ? `\nSTYLE INSPIRATION (clone the rhythm and word choices, NEVER the ideas):\n${params.styleInspiration.slice(0, 2500)}` : '';
  const bannedBlock = params.bannedWords?.length ? `\nBANNED WORDS (never use): ${params.bannedWords.join(', ')}` : '';

  const ctaBlock = `CTA INTENSITY: ${params.cta} — ${
    params.cta === 'none' ? 'no call to action, pure value' :
    params.cta === 'soft' ? 'spark discussion only (question, prompt, opinion)' :
    params.cta === 'medium' ? 'invite to learn more (link, profile, more posts)' :
    'direct call to action (sign up, try, buy)'
  }`;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      drafts: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            platform: { type: Type.STRING },
            content: { type: Type.STRING, description: 'The complete, ready-to-post content with native formatting.' },
            hookUsed: { type: Type.STRING, description: 'Short label of which hook angle was used (max 6 words).' },
            tips: { type: Type.ARRAY, items: { type: Type.STRING }, description: '1-3 short posting tips (best time, what to add, etc.).' },
            voiceProfile: { type: Type.STRING, description: 'One-line summary of the voice that came through (e.g. "vulnerable expert, low-energy, high-specificity").' },
            variantNote: { type: Type.STRING, description: 'If multiple variants per platform, what makes THIS variant different (e.g. "Confession opener", "Status-currency angle"). Empty if single variant.' }
          },
          required: ['platform', 'content', 'hookUsed', 'tips']
        }
      }
    },
    required: ['drafts']
  };

  const prompt = `You are an elite social copywriter. You write with surgical voice control — no generic LinkedIn-influencer hype, no AI-flavored fluff. Every line earns its place.

${voiceArchitecture}

ORIGIN MODE: ${params.origin}
FORMAT: ${params.format} — ${formatHints[params.format]}
${ctaBlock}

TARGET PLATFORMS:
${platforms.map(p => `- ${p}: ${platformLimits[p] || 'native conventions.'}`).join('\n')}

${sourceBlock}
${dnaBlock}
${styleBlock}
${bannedBlock}

TASK:
Generate ${variants > 1 ? `${variants} DISTINCT variants per platform` : 'one draft per platform'}, each respecting the voice mix, hook architecture, perspective, viral physics and closer above.

${variants > 1 ? `Each variant must take a DIFFERENT angle within the same voice — different hook entry, different tension, different proof. Use variantNote to label the angle (e.g. "Confession opener", "Numbers-first", "Contrarian flip").` : ''}

CRITICAL RULES:
1. The Perspective section is non-negotiable. The reader must FEEL this is from someone with that specific angle.
2. NO em-dashes (—). NO "I'm not gonna lie". NO "let's be real". NO "the truth is". NO "game-changer". NO "leverage". NO "unlock".
3. Match the platform's NATIVE writing style (LinkedIn ≠ X ≠ Reddit).
4. Specific > generic. "$2,847 MRR" > "some revenue". "Tuesday at 3pm" > "the other day".
5. The hook architecture is the FIRST 3 lines. Treat them like a song's first riff.

Return JSON only.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        systemInstruction: 'You are an elite social copywriter trained on the best-performing posts of solo founders and contrarian thinkers. You hate corporate language. You worship specificity.'
      }
    });
    const text = response.text;
    if (!text) throw new Error('Empty response from Gemini');
    const parsed = JSON.parse(text);
    return (parsed.drafts || []) as ContentEngineDraft[];
  } catch (e: any) {
    console.error('Content Engine generation failed:', e);
    throw new Error(e?.message || 'Generation failed');
  }
};

export const getPlatformInsights = async (platform: string): Promise<PlatformInsight> => {
  const model = "gemini-flash-latest";
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
  const model = "gemini-flash-latest";
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
  const model = "gemini-flash-latest";
  const response = await ai.models.generateContent({
    model,
    contents: `Evaluate these Hacker News items for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
};

export const evaluatePHOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
  const model = "gemini-flash-latest";
  const response = await ai.models.generateContent({
    model,
    contents: `Evaluate these Product Hunt items for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
};

export const evaluateRedditOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
  const model = "gemini-flash-latest";
  const response = await ai.models.generateContent({
    model,
    contents: `Evaluate these Reddit posts for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
};

export const generateBuyerPersonas = async (appName: string, appDesc: string, category: string): Promise<BuyerPersonaAnalysis> => {
  assertConfigured();
  const model = "gemini-flash-latest";
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      marketOverview: { type: Type.STRING },
      personas: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "First name only, evocative and memorable" },
            role: { type: Type.STRING },
            tagline: { type: Type.STRING, description: "One punchy line that captures who they are — used in cinematic reveal" },
            demographics: { type: Type.STRING },
            realWorldQuote: { type: Type.STRING },
            painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            goals: { type: Type.ARRAY, items: { type: Type.STRING } },
            whereTheyHangOut: { type: Type.ARRAY, items: { type: Type.STRING } },
            contentTheyConsume: { type: Type.ARRAY, items: { type: Type.STRING } },
            personalityRadar: {
              type: Type.OBJECT,
              description: "Each value 0-100. priceSensitive: 0=bargain hunter, 100=premium buyer. techSavvy: 0=beginner, 100=power user. riskAverse: 0=early adopter, 100=risk averse. collaborative: 0=lone wolf, 100=team-oriented. pragmatic: 0=trend-driven, 100=pragmatic. vocal: 0=quiet, 100=vocal/influencer.",
              properties: {
                priceSensitive: { type: Type.NUMBER },
                techSavvy: { type: Type.NUMBER },
                riskAverse: { type: Type.NUMBER },
                collaborative: { type: Type.NUMBER },
                pragmatic: { type: Type.NUMBER },
                vocal: { type: Type.NUMBER }
              },
              required: ["priceSensitive", "techSavvy", "riskAverse", "collaborative", "pragmatic", "vocal"]
            },
            painSources: {
              type: Type.ARRAY,
              description: "Real public sources (Reddit threads, Twitter/X posts, HackerNews, LinkedIn posts, IndieHackers) where someone fitting this persona has voiced one of the painPoints. Must be plausible, specific URLs.",
              items: {
                type: Type.OBJECT,
                properties: {
                  painIndex: { type: Type.NUMBER, description: "0-based index into painPoints array" },
                  platform: { type: Type.STRING },
                  snippet: { type: Type.STRING, description: "Short quote (under 25 words) from the source" },
                  url: { type: Type.STRING }
                },
                required: ["painIndex", "platform", "snippet", "url"]
              }
            }
          },
          required: ["name", "role", "tagline", "demographics", "painPoints", "goals", "whereTheyHangOut", "contentTheyConsume", "personalityRadar"]
        }
      }
    },
    required: ["marketOverview", "personas"]
  };
  const response = await ai.models.generateContent({
    model,
    contents: `Generate 3 detailed buyer personas for "${appName}" — a ${category} product. Description: "${appDesc}".

For each persona include:
- A memorable first-name + role (e.g. "Maya, Solo Designer")
- A punchy ONE-LINE tagline (max 8 words) that captures their essence — used in a cinematic reveal screen
- Demographics, pain points (3-5), goals (3-5), where they hang out online, content they consume
- A realistic "realWorldQuote" — something they'd actually say (max 20 words)
- A 6-axis personalityRadar (each 0-100). Be DECISIVE — use the full 0-100 range. Two personas should NOT have identical radars.
- 2-4 painSources: real-looking public web URLs (Reddit threads in relevant subreddits, Twitter/X posts, HackerNews comments, LinkedIn posts, IndieHackers) where someone in this persona has voiced one of their painPoints. Include the short snippet. Each painSource must include painIndex (0-based) pointing to which painPoint it proves.

Return strict JSON matching the schema.`,
    config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.85 }
  });
  return JSON.parse(response.text) as BuyerPersonaAnalysis;
};

// =====================================================================
// CHAT WITH PERSONA — AI roleplays AS the buyer persona
// =====================================================================
export interface PersonaChatTurn { role: 'user' | 'model'; text: string }

export const chatAsPersona = async (
  persona: { name: string; role: string; demographics: string; painPoints: string[]; goals: string[]; realWorldQuote?: string; tagline?: string; personalityRadar?: any },
  userMessage: string,
  history: PersonaChatTurn[],
  productContext: { appName: string; appDesc: string }
): Promise<string> => {
  assertConfigured();
  const model = "gemini-flash-latest";

  const radar = persona.personalityRadar
    ? `\nPersonality (0-100):
  - Price sensitivity: ${persona.personalityRadar.priceSensitive} (lower = bargain hunter, higher = premium buyer)
  - Tech savvy: ${persona.personalityRadar.techSavvy}
  - Risk averse: ${persona.personalityRadar.riskAverse} (lower = early adopter)
  - Collaborative: ${persona.personalityRadar.collaborative}
  - Pragmatic: ${persona.personalityRadar.pragmatic} (lower = trend-driven)
  - Vocal: ${persona.personalityRadar.vocal}`
    : '';

  const systemPrompt = `You are roleplaying as ${persona.name}, a real human prospect — NOT a chatbot, NOT an AI assistant.

WHO YOU ARE:
- ${persona.role}
- ${persona.demographics}
- Tagline: ${persona.tagline || ''}
${persona.realWorldQuote ? `- Something you'd say: "${persona.realWorldQuote}"` : ''}${radar}

YOUR PAIN POINTS (what frustrates you daily):
${persona.painPoints.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

YOUR GOALS:
${persona.goals.map((g, i) => `  ${i + 1}. ${g}`).join('\n')}

CONTEXT — The founder of "${productContext.appName}" is interviewing you to understand if their product is right for you. Their product: "${productContext.appDesc}"

RULES:
1. Stay 100% in character. NEVER break the fourth wall. NEVER say you are an AI or a persona.
2. Be skeptical, busy, honest. Real prospects don't gush — they probe, push back, and reveal pain only when trust builds.
3. Use first-person ("I", "my team", "my workflow"). Bring specific scenarios from your life that match your demographics + role.
4. Push back if their pitch feels generic. Ask hard questions about price, switching cost, time-to-value.
5. Reveal one of your pain points only when the conversation naturally surfaces it.
6. Keep replies under 80 words. Conversational, not corporate. Occasional typos or filler ("tbh", "honestly", "hmm") are fine if it fits your demographic.
7. If the founder asks "would you pay $X?" answer truthfully based on your priceSensitive score and pain intensity. Don't auto-say yes.`;

  const contents = [
    ...history.map(t => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: 'user' as const, parts: [{ text: userMessage }] }
  ];

  const response = await ai.models.generateContent({
    model,
    contents,
    config: { systemInstruction: systemPrompt, temperature: 0.9, maxOutputTokens: 300 }
  });
  return response.text?.trim() || "...";
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
    const modelName = "gemini-3-flash";

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

export const filterProfilesWithAI = async (prospects: any[], campaign: any): Promise<{ validProfiles: any[] }> => {
  try {
    const modelName = "gemini-3-flash";
    const generativeModel = ai.getGenerativeModel({ model: modelName });
    const response = await generativeModel.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a lead qualification AI. Given these prospects and campaign context, score each prospect's relevance.

Campaign: ${JSON.stringify({ name: campaign?.name, roles: campaign?.roles, painPoints: campaign?.painPoints })}

Prospects (handle, bio, url):
${prospects.slice(0, 30).map((p: any, i: number) => `${i+1}. @${p.handle || 'unknown'} | ${(p.bio || '').substring(0, 100)} | ${p.url || ''}`).join('\n')}

Return JSON: { "validProfiles": [{ "handle": string, "url": string, "isTarget": boolean, "relevanceScore": number (0-100), "reasoning": string }] }`
        }]
      }],
      generationConfig: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.response.text());
  } catch (e) {
    console.error("[Gemini] filterProfilesWithAI failed:", e);
    return {
      validProfiles: prospects.map((p: any) => ({
        handle: p.handle,
        url: p.url,
        isTarget: true,
        relevanceScore: 50,
        reasoning: 'AI audit unavailable — defaulting to neutral score'
      }))
    };
  }
};

