import * as cheerio from 'cheerio';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';
import { StrategyPlan, RoastResult, GroundingChunk, DistributionChannel, GeneratedContent, ChannelAnalysis, CompetitorData, CompetitorDeepDive, OutreachResponse, MarketOpportunity, ReplyDraft, IndustryBenchmark, SearchDork } from "../types";

// ─── DeepSeek-backed AI client (Gemini-compatible adapter) ──────────
// The codebase was originally written against @google/genai. We swapped the
// backing model out for DeepSeek (OpenAI-compatible chat completions) without
// rewriting every call site — this adapter exposes the same surface
// (`ai.models.generateContent`, `Type.*`, `Schema`) and translates each call
// into a DeepSeek chat completion under the hood.
//
// Trade-offs of the swap:
//   • `tools: [{ googleSearch: {} }]` — no DeepSeek equivalent, silently
//      dropped. `response.candidates[0].groundingMetadata` is always empty,
//      so URL-grounding code paths fall back gracefully (they already had
//      defensive `if (chunks) {}` guards).
//   • Image input (`inlineData`) — DeepSeek's chat model is text-only here.
//      We strip the image and send only the text part with a console warning.
//   • Gemini's `Type` enum / `Schema` shape — re-implemented locally with the
//      same uppercase names so existing schema literals compile unchanged.

// DeepSeek runs through a Supabase Edge Function so the API key stays
// server-side (Supabase secret DEEPSEEK_API_KEY) and never ships to the browser.
// URL + anon key (with baked-in fallbacks) come from supabaseClient.
const DEEPSEEK_PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/deepseek` : '';

// Default model. Per spec — kept as a single source of truth so swapping the
// model id (e.g. to `deepseek-chat`) is a one-line change.
export const MODEL_FLASH = 'deepseek-v4-flash';

// ─── Output language / dialect ─────────────────────────────────────
// Content generators append this directive so every post, reply and
// outreach message comes out in the language/dialect the user picked in
// the project config (Voice Studio). Read from localStorage so service
// functions don't each need the project threaded through their params.
export type OutputLanguage = 'en' | 'ar' | 'ar-SA' | 'ar-AE' | 'fr';

const LANGUAGE_DIRECTIVES: Record<OutputLanguage, string> = {
  en: '',
  ar: `

═══ OUTPUT LANGUAGE — MODERN STANDARD ARABIC (العربية الفصحى) ═══
Write ALL reader-facing text in refined, eloquent Modern Standard Arabic (فصحى) at the level of a top-tier Arabic copywriter: precise, dignified, persuasive — never stiff, never machine-translated. Vary the rhythm. Keep brand names and established tech terms (SaaS, X, LinkedIn, Reddit) in Latin script; use Western digits. JSON keys and enum values stay in English — only the human-readable text is Arabic.`,
  'ar-SA': `

═══ OUTPUT LANGUAGE — SAUDI ARABIC DIALECT (لهجة سعودية راقية) ═══
Write ALL reader-facing text in natural, upscale Saudi dialect — the way a sharp, well-spoken Saudi founder writes on X today: confident, warm, modern, effortless. Keep it classy and premium: NO crude street slang, NO vulgarity, NO clownish filler. It must read native, not فصحى in disguise. Keep brand/tech terms in Latin script; Western digits. JSON keys/enums stay English; only human-readable text is Arabic.`,
  'ar-AE': `

═══ OUTPUT LANGUAGE — EMIRATI ARABIC DIALECT (لهجة إماراتية راقية) ═══
Write ALL reader-facing text in natural, refined Emirati Gulf (خليجي) dialect — the voice of a polished Emirati creator: elegant, self-assured, contemporary. Keep it classy and premium: NO crude slang, NO vulgarity. It must read authentically Emirati, not generic فصحى. Keep brand/tech terms in Latin script; Western digits. JSON keys/enums stay English; only human-readable text is Arabic.`,
  fr: `

═══ LANGUE DE SORTIE — FRANÇAIS (haut de gamme) ═══
Rédige TOUT le texte destiné au lecteur dans un français impeccable et haut de gamme, au niveau d'un excellent concepteur-rédacteur : élégant, rythmé, idiomatique — jamais traduit mécaniquement. Évite les anglicismes inutiles. Conserve les noms de marque et termes techniques établis (SaaS, X, LinkedIn) tels quels. Les clés et énumérations JSON restent en anglais ; seul le texte lisible est en français.`,
};

const getOutputLanguage = (): OutputLanguage => {
  try {
    if (typeof localStorage === 'undefined') return 'en';
    const raw = localStorage.getItem('project_config_v1');
    if (!raw) return 'en';
    const lang = JSON.parse(raw)?.outputLanguage as OutputLanguage | undefined;
    return lang && LANGUAGE_DIRECTIVES[lang] !== undefined ? lang : 'en';
  } catch { return 'en'; }
};

/** Directive appended to content-generation prompts so output matches the
 *  user's chosen language/dialect. Empty string for English (default). */
export const languageDirective = (): string => LANGUAGE_DIRECTIVES[getOutputLanguage()] || '';

// Appended to every content/reply prompt: force fidelity to the user's own
// voice AND make the output read human, not AI (defeats AI-detector tells).
const HUMAN_VOICE_RULES = `

VOICE FIDELITY (top priority): match the user's voice profile EXACTLY — their rhythm, sentence length, vocabulary, punctuation habits, energy and quirks. If a writing sample is provided, mirror its cadence and word choices. Someone who knows them should think "that's them", not "an AI wrote this."

SOUND HUMAN, NEVER LIKE AI (this content must be indistinguishable from a real person's):
- Banned AI tells (never use): em-dashes (—); "in today's world", "let's dive in", "it's not just X, it's Y", "the truth is", "let's be honest", "at the end of the day", "game-changer", "unlock", "leverage", "elevate", "supercharge", "navigate the landscape", "testament to", "delve", "tapestry", "robust", "seamless", "realm", "in conclusion", "needle-moving".
- Vary sentence length: mix short punchy lines with longer ones. Uniform, balanced rhythm reads as AI.
- Avoid tidy rule-of-three lists, over-balanced parallelism, and a neat summary sentence at the end.
- Use concrete specifics (real numbers, names, dates), contractions, the occasional sentence fragment, and one genuine opinion. Slightly imperfect beats polished.
- Don't hedge ("might", "perhaps") or over-explain. Write like someone who actually lived it.`;

// ── Gemini-compatible Type enum / Schema type ──────────────────────
// These exist purely so the existing `Type.OBJECT` / `Type.STRING` literals
// keep compiling. They are converted to JSON Schema strings before hitting
// the DeepSeek API.
export const Type = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY'
} as const;

export type Schema = {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
};

// Recursively convert a Gemini-style Schema into a JSON Schema the DeepSeek
// API understands (lowercase types, OpenAI-style `additionalProperties`).
function geminiSchemaToJsonSchema(s: Schema | undefined): any {
  if (!s) return undefined;
  const typeMap: Record<string, string> = {
    OBJECT: 'object', STRING: 'string', NUMBER: 'number',
    INTEGER: 'integer', BOOLEAN: 'boolean', ARRAY: 'array'
  };
  const out: any = { type: typeMap[s.type] || s.type?.toLowerCase?.() || s.type };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = geminiSchemaToJsonSchema(s.items);
  if (s.properties) {
    out.properties = {};
    Object.entries(s.properties).forEach(([k, v]) => {
      out.properties[k] = geminiSchemaToJsonSchema(v);
    });
  }
  if (s.required) out.required = s.required;
  return out;
}

// Flatten the `contents` field, which can be a string, a `{ parts: [...] }`
// object, or an array of either. Image parts are stripped (DeepSeek chat is
// text-only here); a warning is logged so the caller can see what happened.
function flattenContents(contents: any): string {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  const parts: string[] = [];
  const visit = (item: any) => {
    if (!item) return;
    if (typeof item === 'string') { parts.push(item); return; }
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (item.parts) { visit(item.parts); return; }
    if (item.text) { parts.push(item.text); return; }
    if (item.inlineData) {
      console.warn('[DeepSeek adapter] Dropping inline image — DeepSeek chat is text-only.');
      return;
    }
  };
  visit(contents);
  return parts.join('\n\n');
}

interface GeminiCallShape {
  model?: string;
  contents: any;
  config?: {
    responseMimeType?: string;
    responseSchema?: Schema;
    systemInstruction?: string;
    temperature?: number;
    maxOutputTokens?: number;
    tools?: any[];
  };
}

interface GeminiResponseShape {
  text: string;
  candidates: Array<{ groundingMetadata?: { groundingChunks?: any[] } }>;
}

async function deepseekGenerateContent(req: GeminiCallShape): Promise<GeminiResponseShape> {
  const cfg = req.config || {};
  const userText = flattenContents(req.contents);
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (cfg.systemInstruction) messages.push({ role: 'system', content: cfg.systemInstruction });
  messages.push({ role: 'user', content: userText });

  if (cfg.tools?.length) {
    // googleSearch / other Gemini-only tools have no DeepSeek equivalent;
    // grounded callers already guard on missing groundingChunks.
    console.warn('[DeepSeek adapter] Dropping `tools` from request — not supported on DeepSeek.');
  }

  const body: any = {
    model: req.model || MODEL_FLASH,
    messages,
    stream: false
  };
  if (typeof cfg.temperature === 'number') body.temperature = cfg.temperature;
  if (typeof cfg.maxOutputTokens === 'number') body.max_tokens = cfg.maxOutputTokens;

  // JSON mode. DeepSeek supports OpenAI's `response_format: { type: "json_object" }`.
  // If a schema is supplied, we additionally inject it into the system prompt so
  // the model knows the shape — DeepSeek's strict JSON-Schema mode is limited.
  if (cfg.responseMimeType === 'application/json' || cfg.responseSchema) {
    body.response_format = { type: 'json_object' };
    const jsonSchema = geminiSchemaToJsonSchema(cfg.responseSchema);
    if (jsonSchema) {
      messages.unshift({
        role: 'system',
        content:
          'You MUST reply with a single JSON value that conforms exactly to this JSON Schema. ' +
          'No prose, no markdown fences. Schema:\n' +
          JSON.stringify(jsonSchema)
      });
    } else {
      messages.unshift({
        role: 'system',
        content: 'You MUST reply with a single JSON value. No prose, no markdown fences.'
      });
    }
  }

  const res = await fetch(DEEPSEEK_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Auth to the Supabase Edge Function — the DeepSeek key lives server-side.
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek API ${res.status}: ${errText || res.statusText}`);
  }

  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content || '';
  return {
    text,
    candidates: [{ groundingMetadata: { groundingChunks: [] } }]
  };
}

// Single shared client. External code imports `ai` and calls
// `ai.models.generateContent(...)`. The shape mirrors @google/genai's client
// just enough to keep every existing call site working.
export const ai = {
  models: {
    generateContent: deepseekGenerateContent
  }
};

export const isGeminiConfigured = (): boolean => !!DEEPSEEK_PROXY_URL;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Supabase URL missing (VITE_SUPABASE_URL) — the DeepSeek proxy is unreachable.');
    this.name = 'GeminiNotConfiguredError';
  }
}

export function assertConfigured() {
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

// =====================================================================
// LAUNCH STRATEGY — 2026 AI-era roadmap
// =====================================================================
export const generateLaunchStrategy = async (
  appName: string,
  description: string,
  audience: string
): Promise<StrategyPlan> => {
  assertConfigured();
  const model = MODEL_FLASH;

  // Reusable sub-schemas
  const stepSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      title: { type: Type.STRING },
      description: { type: Type.STRING, description: "Specific, executable tactic. Mention exact tools, channels, numbers. Not generic." },
      impact: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
      effort: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
      channel: { type: Type.STRING, description: "Specific platform or surface — e.g. 'X/Twitter build-in-public', 'r/SaaS', 'MicroConf community', 'Show HN'" },
      aiAngle: { type: Type.STRING, description: "How AI accelerates THIS step in 2026. e.g. 'Use Claude to draft 30 variations, A/B test'" }
    },
    required: ["id", "title", "description", "impact", "effort", "channel", "aiAngle"]
  };

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      productName: { type: Type.STRING },
      targetAudience: { type: Type.STRING },

      // ── Plain-English TL;DR at top of report ──
      summary: {
        type: Type.OBJECT,
        description: "Plain-English summary of the whole plan. NO jargon. Written for a non-technical founder reading their morning coffee.",
        properties: {
          oneSentence: { type: Type.STRING, description: "One sentence summary starting with a verb. e.g. 'Get your first 100 paying users in 12 weeks by being the only tool that solves X for Y.'" },
          bullets: { type: Type.ARRAY, items: { type: Type.STRING }, description: "5-7 plain-English bullets capturing the strategy. Each bullet under 20 words. No acronyms unless followed by '(meaning: ...)'." }
        },
        required: ["oneSentence", "bullets"]
      },

      // ── Customer journey funnel ──
      customerJourney: {
        type: Type.ARRAY,
        description: "How someone goes from 'never heard of you' to 'paying customer'. 4-5 stages. Concrete and specific. Each stage in plain English.",
        items: {
          type: Type.OBJECT,
          properties: {
            stage: { type: Type.STRING, description: "Stage label — e.g. 'Never heard of you', 'Curious', 'Trying it', 'Paying'" },
            whatTheyThink: { type: Type.STRING, description: "What the user thinks at this stage, in first person. e.g. 'I have problem X but I don't know any tool solves it'" },
            yourMove: { type: Type.STRING, description: "What YOU do at this stage. Concrete action." },
            channel: { type: Type.STRING, description: "Where this happens — specific channel/surface" },
            example: { type: Type.STRING, description: "A concrete real-world example. Use a fake user name + scenario." },
            typicalDays: { type: Type.NUMBER, description: "Avg days a user spends at this stage" }
          },
          required: ["stage", "whatTheyThink", "yourMove", "channel", "example", "typicalDays"]
        }
      },

      // ── 2026 strategic frame ──
      northStarMetric: {
        type: Type.OBJECT,
        description: "The ONE metric that matters more than vanity numbers. Not 'signups' — outcome-based.",
        properties: {
          name: { type: Type.STRING, description: "e.g. 'Weekly Active Use Sessions' or 'Aha-moment in <60s rate'" },
          target: { type: Type.STRING, description: "Specific number + timeframe — e.g. '200 by week 12'" },
          rationale: { type: Type.STRING, description: "Why this is the right metric in 2026" }
        },
        required: ["name", "target", "rationale"]
      },

      wedge: {
        type: Type.OBJECT,
        description: "The smallest possible market entry — narrow enough to dominate completely, then expand from.",
        properties: {
          useCase: { type: Type.STRING, description: "The single hyper-specific job-to-be-done you solve perfectly" },
          idealUser: { type: Type.STRING, description: "The narrowest persona — title + company size + situation" },
          whyNow: { type: Type.STRING, description: "Why 2026 makes this wedge winnable now (AI capability shift, market change, etc.)" },
          expansionPath: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-4 expansion steps from wedge to broader market" }
        },
        required: ["useCase", "idealUser", "whyNow", "expansionPath"]
      },

      phases: {
        type: Type.ARRAY,
        description: "3-4 phases, each with a goal, week range, success metric, and 3-5 concrete steps. NOT generic 'day 1-3 launch'.",
        items: {
          type: Type.OBJECT,
          properties: {
            phaseName: { type: Type.STRING, description: "e.g. 'Phase 1 — Design Partners' or 'Phase 2 — Compounding Engine'" },
            weekRange: { type: Type.STRING, description: "e.g. 'Week 1-3'" },
            goal: { type: Type.STRING, description: "The single outcome this phase produces" },
            successMetric: { type: Type.STRING, description: "How you know it worked. Specific number." },
            steps: { type: Type.ARRAY, items: stepSchema }
          },
          required: ["phaseName", "weekRange", "goal", "successMetric", "steps"]
        }
      },

      // ── 2026 wow sections ──
      growthLoops: {
        type: Type.ARRAY,
        description: "3-4 compounding growth loops. Each loop's output must feed back into its own trigger. Linear acquisition does NOT count.",
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "e.g. 'User → Public artifact → SEO → User'" },
            type: { type: Type.STRING, description: "One of: Content, Network, Product, Community, Data, Sales" },
            trigger: { type: Type.STRING, description: "What kicks off one cycle" },
            action: { type: Type.STRING, description: "What the user does" },
            output: { type: Type.STRING, description: "What gets created/changed as a result" },
            reinvestment: { type: Type.STRING, description: "How the output makes the next trigger easier" },
            velocityWeeks: { type: Type.NUMBER, description: "How many weeks until first compounding return is visible" },
            leverage: { type: Type.STRING, enum: ["High", "Medium", "Low"] }
          },
          required: ["name", "type", "trigger", "action", "output", "reinvestment", "velocityWeeks", "leverage"]
        }
      },

      aiNativeDiscovery: {
        type: Type.ARRAY,
        description: "5-7 specifically 2026-era discovery tactics that didn't exist or didn't matter in 2020. Be concrete.",
        items: {
          type: Type.OBJECT,
          properties: {
            tactic: { type: Type.STRING, description: "e.g. 'Publish llm.txt + OG metadata so ChatGPT/Perplexity cite you for [keyword]'" },
            category: { type: Type.STRING, description: "One of: GEO, MCP, Agent-Distribution, AI-Directory, Eval-as-Marketing, API-First" },
            rationale: { type: Type.STRING, description: "Why this matters in 2026 — what shifted" },
            impact: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            timeframe: { type: Type.STRING, description: "e.g. 'Week 1' or 'Month 2'" }
          },
          required: ["tactic", "category", "rationale", "impact", "timeframe"]
        }
      },

      first72Hours: {
        type: Type.ARRAY,
        description: "Hour-by-hour launch playbook for the first 72 hours. 6-10 time blocks. NO 'post on Product Hunt'.",
        items: {
          type: Type.OBJECT,
          properties: {
            timeBlock: { type: Type.STRING, description: "e.g. 'Hour 0-3' or 'Day 1, AM' or 'Day 2, late afternoon'" },
            action: { type: Type.STRING, description: "Exactly what you do, with specifics" },
            channel: { type: Type.STRING, description: "Where it happens" },
            successMetric: { type: Type.STRING, description: "What success looks like for this block — specific" }
          },
          required: ["timeBlock", "action", "channel", "successMetric"]
        }
      },

      antiPatterns: {
        type: Type.ARRAY,
        description: "5-7 things founders STILL do in 2026 that worked 2018-2022 but are broken now. Be specific and brave.",
        items: {
          type: Type.OBJECT,
          properties: {
            pattern: { type: Type.STRING, description: "The mistake — e.g. 'Big Product Hunt launch day push'" },
            whyItFails2026: { type: Type.STRING, description: "Specifically what shifted — AI flood, attention fragmentation, etc." },
            instead: { type: Type.STRING, description: "What to do in 2026 instead" }
          },
          required: ["pattern", "whyItFails2026", "instead"]
        }
      },

      trustLevers: {
        type: Type.ARRAY,
        description: "4-6 moves to install trust early. Open-source, transparency, public evals, no-data-retention claims, etc.",
        items: {
          type: Type.OBJECT,
          properties: {
            lever: { type: Type.STRING },
            mechanism: { type: Type.STRING, description: "Why this builds trust specifically in the AI era" },
            timeToInstall: { type: Type.STRING, description: "When in the roadmap to do this" }
          },
          required: ["lever", "mechanism", "timeToInstall"]
        }
      },

      risks: {
        type: Type.ARRAY,
        description: "Top 5-6 things that could kill the launch. Honest. Include both market and execution risks.",
        items: {
          type: Type.OBJECT,
          properties: {
            risk: { type: Type.STRING },
            impact: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            probability: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            mitigation: { type: Type.STRING, description: "Specific action to reduce probability or impact" }
          },
          required: ["risk", "impact", "probability", "mitigation"]
        }
      },

      founderOperatingModel: {
        type: Type.ARRAY,
        description: "How the founder should spend their week pre-launch and during launch. Hours/week per activity. Total should sum to ~50-60 sustainable hours.",
        items: {
          type: Type.OBJECT,
          properties: {
            activity: { type: Type.STRING, description: "e.g. 'Daily writing on X/LinkedIn (build-in-public)'" },
            hoursPerWeek: { type: Type.NUMBER },
            rationale: { type: Type.STRING }
          },
          required: ["activity", "hoursPerWeek", "rationale"]
        }
      },

      compoundingMoats: {
        type: Type.ARRAY,
        description: "3-5 things that get harder for competitors to copy each week of operation. Data, brand, distribution, integrations.",
        items: { type: Type.STRING }
      },

      pricingThesis: {
        type: Type.STRING,
        description: "One paragraph: what pricing model fits this product in 2026 and why. Mention outcome-based vs seat-based, usage tiers, free-tier philosophy."
      }
    },
    required: [
      "productName", "targetAudience", "phases", "summary", "customerJourney",
      "northStarMetric", "wedge", "growthLoops", "aiNativeDiscovery",
      "first72Hours", "antiPatterns", "trustLevers", "risks",
      "founderOperatingModel", "compoundingMoats", "pricingThesis"
    ]
  };

  const prompt = `You are a senior B2B SaaS GTM operator who has shipped 5+ products in the 2024-2026 AI era. You are building a launch roadmap for a FOUNDER WHO HAS NEVER WORKED IN MARKETING. Their first language may not be English. They are reading this on their phone over morning coffee.

WRITING RULES — non-negotiable
1. **Plain English only.** No marketing jargon. If you MUST use a term, follow it with "(meaning: ...)". Example: "GEO (meaning: getting your product cited in AI search engines like ChatGPT)".
2. **Every tactic must include a concrete example.** Not "engage in communities" but "post a 3-tweet thread on Tuesday morning sharing your week-1 MRR screenshot — example: '$340 MRR week 1. Here's what worked and what didn't 🧵'".
3. **Use specific tools, numbers, and time blocks.** "Send 5 DMs per day, Tuesday-Thursday" not "do outreach regularly".
4. **Verbs at the start of every action.** Not "engagement strategy" → "DM 10 founders this week on LinkedIn".
5. **No abstract nouns when concrete verbs work.** Not "build trust" → "publish your benchmark numbers in a public Google Sheet".
6. **One idea per sentence.** Short sentences. Founder is tired and busy.
7. **Speak directly to the founder.** Use "you", "your", "you'll".
8. **Always answer "Why?"** Every tactic must include why it works in 2026 specifically.

THE PRODUCT
- Name: ${appName}
- Description: ${description}
- Target audience: ${audience}

2026 REALITY YOU MUST DESIGN AROUND
1. AI flooded every distribution channel. Cold email is at 0.2% reply. Generic LinkedIn DMs are dead. Product Hunt has become noise.
2. ChatGPT, Claude, Perplexity, Gemini are the new search engines. If you're not cited there, you don't exist for a significant chunk of buyers.
3. MCP servers + Claude Agent SDK mean AI agents are buying and using products on behalf of users. Discoverability is now agent-readable.
4. Attention is fragmented across micro-communities (Discord, Slack groups, niche subreddits). Mass channels don't work.
5. Trust is the bottleneck — buyers default-distrust AI products. Open-source, public evals, no-retention defaults move the needle.
6. Compounding loops beat linear acquisition. Every dollar that doesn't compound is a dollar wasted.
7. Founder voice = brand. Personal X/LinkedIn presence is the primary marketing channel for SaaS founders <$1M ARR.
8. Pricing is shifting from seat-based to outcome/usage-based as AI does the work.
9. Velocity matters more than perfection. Ship + iterate publicly.
10. The "100 users" milestone is no longer about quantity — it's about 100 design partners who give you compounding signal.

WHAT NOT TO RECOMMEND
- ❌ Generic "Product Hunt launch day"
- ❌ "Write blog posts for SEO" (without a compounding loop)
- ❌ "Post on social media"
- ❌ Paid ads (CAC is broken at <$10M ARR in 2026 for B2B SaaS)
- ❌ Cold email blasts
- ❌ Generic "Find communities and engage"
- ❌ Anything that doesn't have a compounding mechanism

WHAT TO RECOMMEND
- ✅ GEO (Generative Engine Optimization) — getting cited in ChatGPT/Perplexity for ICP queries
- ✅ MCP / Agent distribution — publishing as an MCP server, registry submission
- ✅ Build-in-public on X with metrics — compounds founder brand
- ✅ Open-sourcing strategic primitives that drive top-of-funnel
- ✅ Public evals + benchmarks (especially for AI products)
- ✅ "Eval-as-marketing" — releasing a public benchmark in your category
- ✅ Embedded distribution (be the AI inside someone else's tool)
- ✅ Co-launches with adjacent tools (cross-promotion compounds)
- ✅ Niche Slack/Discord communities (10K members > LinkedIn)
- ✅ llm.txt + structured product metadata for AI crawlers
- ✅ Personal narrative content (founder's POV on their own X)
- ✅ Tool directories: theresanaiforthat.com, ai-stars, etc.
- ✅ Anchor on a single wedge that's so narrow nobody else cares — own it 100%
- ✅ Booking calls with the founder as the lead magnet
- ✅ Loom walkthroughs over scheduled demos

OUTPUT
Generate a strategic launch roadmap with (in this exact order):
1. **summary** — TL;DR. ONE sentence + 5-7 plain-English bullets. NO jargon.
2. **customerJourney** — 4-5 stages from "Never heard of you" to "Paying". Each stage has: what the user thinks (1st person), what you do, where, a concrete example with a fake user name, and typical days at that stage.
3. **northStarMetric** — the ONE outcome metric (not signups). Rationale in plain English.
4. **wedge** — narrowest possible entry point + 3-4 expansion steps. Use concrete user descriptions.
5. **phases** — 3-4 phases with weekRange, goal, successMetric, and 3-5 concrete steps (each step's description = a checklist item with specifics, each step's aiAngle = exact tool + prompt example like "Use Claude to write 20 cold-DM variations, pick top 3 by gut").
6. **growthLoops** — 3-4 compounding loops. For each: write trigger/action/output/reinvestment as if explaining to a 12-year-old.
7. **aiNativeDiscovery** — 5-7 2026-era tactics. ALWAYS explain the acronym in the tactic itself. e.g. "GEO (Generative Engine Optimization): publish an /llm.txt file on your website..."
8. **first72Hours** — 6-10 time blocks. Each block = "Hour X-Y: DO this exact thing. Channel: Z. You'll know it worked if: [specific metric]."
9. **antiPatterns** — 5-7 things to AVOID with concrete 2026 alternative. Format: pattern in 1 sentence, why it fails in 2026 in 1 sentence, instead-do in 1 sentence with example.
10. **trustLevers** — 4-6 trust moves. Each with mechanism explained in plain language.
11. **risks** — top 5-6 risks. Mitigation must be ACTIONABLE (a thing the founder does, not "monitor closely").
12. **founderOperatingModel** — weekly hours allocation totaling 50-60 hrs. Each activity has a clear "this is what you'll actually be doing all day".
13. **compoundingMoats** — 3-5 advantages. Write each as "By month 6 you'll have [specific asset] that competitors can't easily copy because [specific reason]."
14. **pricingThesis** — one paragraph. Recommend a specific pricing model with a concrete number. e.g. "Charge $79/mo per detected qualified lead instead of per-seat. Why: ..."

Be specific, contrarian, and bold. Every line must be executable BY A FOUNDER WHO IS NOT A MARKETING EXPERT.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.85,
        systemInstruction: "You are a 2026-era growth operator. You've shipped products in the post-AI-flood era. You know what worked 2018-2022 is dead. Be sharp, specific, contrarian."
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
  const model = MODEL_FLASH;

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
  const model = MODEL_FLASH;

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
  const model = MODEL_FLASH;

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
  const model = MODEL_FLASH;

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

  // Detect the actual platform from the channel name/url so the KPIs we ask for
  // are scoped to THIS channel — not a generic "Avg CPC on LinkedIn" example
  // that the model would copy-paste regardless of channel. This is why
  // r/leadgeneration used to show LinkedIn Ads CPC.
  const lc = `${channelName} ${channelUrl}`.toLowerCase();
  const platform =
    /reddit\.com|^r\/| r\//.test(lc) ? 'Reddit' :
    /linkedin\.com|linkedin/.test(lc) ? 'LinkedIn' :
    /(x\.com|twitter\.com|twitter)/.test(lc) ? 'X (Twitter)' :
    /producthunt|product hunt/.test(lc) ? 'Product Hunt' :
    /hacker ?news|news\.ycombinator/.test(lc) ? 'Hacker News' :
    /youtube\.com/.test(lc) ? 'YouTube' :
    /tiktok\.com/.test(lc) ? 'TikTok' :
    /instagram\.com/.test(lc) ? 'Instagram' :
    /discord/.test(lc) ? 'Discord' :
    /slack/.test(lc) ? 'Slack' :
    'Web / Other';
  const exampleKpis: Record<string, string> = {
    'Reddit':      `"Median upvotes per top post", "Subscriber growth / mo", "Sticky post CTR", "Self-promo allowed (Y/N)"`,
    'LinkedIn':    `"Avg LinkedIn Ads CPC", "Organic post reach (median)", "Comment-to-impression ratio", "Connection acceptance rate"`,
    'X (Twitter)': `"Median impressions per post", "Reply-to-impression ratio", "Follow rate from a viral post", "Hashtag dilution rate"`,
    'Product Hunt': `"Median upvotes for #1 of day", "Maker comment response time", "Hunter network effect", "Notify-button conversion"`,
    'Hacker News':  `"Show HN front-page rate", "Avg points to front-page", "Comment-to-upvote ratio", "Negative tone penalty"`,
    'YouTube':      `"Avg CTR for the niche", "Subscriber/view ratio", "Median watch-time %", "Mid-roll ad RPM"`,
    'TikTok':       `"Median impressions per post", "Follow-conversion %", "Watch-time benchmark", "Hashtag virality"`,
    'Instagram':    `"Reach-to-follower %", "Reels vs feed engagement", "Story completion rate", "Saves-per-post benchmark"`,
    'Discord':      `"Active-member %", "Self-promo channel rules", "Conversion from ambient lurkers", "Mod tolerance for tools"`,
    'Slack':        `"Member-to-active ratio", "Self-promo channel rules", "DM response rate", "Mod tolerance for tools"`
  };
  const exampleLine = exampleKpis[platform] || `"Engagement rate", "Audience size", "Conversion benchmark", "Self-promo tolerance"`;

  const prompt = `
    Conduct a "Growth Engineer" level deep dive into: ${channelName} (${channelUrl}).
    App to launch: ${appDescription}

    The channel is on the **${platform}** platform. ALL benchmarks and tactics in your answer MUST be scoped to ${platform} only — do not return KPIs from other platforms.

    I want HARD DATA and GROWTH HACKING SECRETS.

    1. **SaaS KPIs**: Estimate ${platform}-specific benchmarks. Example labels for ${platform}: ${exampleLine}. DO NOT use specific competitor names. Use market averages.
    2. **Algorithm Secrets**: How do we hack visibility on ${platform} specifically?
    3. **Content Hooks**: Give me 3 headline / post structures that go viral on ${platform}.

    Use Google Search to find current ${platform} benchmarks (2024/2025).

    Return ONLY a JSON object (no markdown fences, no prose) with these fields:
    ${JSON.stringify({
      summary: "string", rules: ["string"], audienceVibe: "string", successfulPostTypes: ["string"],
      moderationStrictness: "Low|Medium|High|Brutal", verdict: "string",
      saasKpis: [{ label: "string", value: "string", trend: "Up|Down|Stable", context: "string" }],
      algorithmSecrets: [{ trigger: "string", tactic: "string", impact: "string" }],
      contentHooks: ["string"]
    }, null, 2)}
  `;

  try {
    // Gemini rejects combining googleSearch with responseSchema/JSON mode.
    // We keep the search tool (we need real benchmarks) and parse the JSON
    // defensively from the response text.
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: `You are a specialized Growth Engineer focused on the ${platform} platform. You provide ${platform}-specific market averages and benchmarks. Never mix KPIs from other platforms. You do NOT discuss specific competitors in this analysis.`
      }
    });

    let text = (response.text || '').trim();
    if (!text) throw new Error("No analysis generated");
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) text = text.slice(first, last + 1);
    try {
      return JSON.parse(text) as ChannelAnalysis;
    } catch (parseErr) {
      console.error("Channel analysis parse error. Raw:", text);
      throw new Error("Model returned non-JSON output");
    }
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
  const model = MODEL_FLASH;

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
  ${languageDirective()}`;

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
  const model = MODEL_FLASH;

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
  const model = MODEL_FLASH;

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
    // IMPORTANT: Gemini rejects the combination of googleSearch + responseSchema
    // (the panel was opening blank because the call threw and the catch in the
    // view swallowed it). We keep the tool (we want real, searched data) and
    // ask the model to emit raw JSON; we parse defensively below.
    const response = await ai.models.generateContent({
      model,
      contents: prompt + `\n\nReturn ONLY a JSON object (no markdown fences, no prose) with these fields and shapes:\n${JSON.stringify({
        summary: "string",
        trafficSources: [{ name: "string", kpi: "string", sentiment: "Positive|Neutral|Negative", link: "string?" }],
        first100UsersStrategy: [{ timeframe: "string", action: "string", result: "string", details: "string?" }],
        communityBehaviors: [{ platform: "string", persona: "string", actionFrequency: "string", engagementMetrics: "string", tone: "string", keyTactic: "string" }],
        videoMentions: [{ title: "string", channelName: "string", views: "string", url: "string?", type: "Review|Interview|Tutorial" }],
        founderQuote: "string?",
        techStack: ["string"],
        pricingModel: "string?",
        marketingHooks: ["string"],
        weakness: "string"
      }, null, 2)}`,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: "You are a forensic marketing analyst. You provide concrete, actionable intelligence. You verify all claims and links using Google Search. Do not fabricate urls."
      }
    });

    let text = (response.text || '').trim();
    if (!text) throw new Error("No deep dive analysis generated");
    // Strip ```json fences and any leading prose before the JSON object.
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace > 0 || lastBrace < text.length - 1) {
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        text = text.slice(firstBrace, lastBrace + 1);
      }
    }
    try {
      return JSON.parse(text) as CompetitorDeepDive;
    } catch (parseErr) {
      console.error("Deep Dive Error: could not parse model JSON. Raw text:", text);
      throw new Error("Model returned non-JSON output");
    }
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
  const model = MODEL_FLASH;

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
  ${languageDirective()}`;

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
  const model = MODEL_FLASH;

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
  const model = MODEL_FLASH;

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

    Write a specific, high-value reply that adds to the conversation and reads like a genuine human peer.
    - Add real value first: a concrete insight, a relevant experience, or a sharp, respectful question.
    - Mentioning the app should be natural, not forced. If the thread is genuinely about a problem the app solves and naming it would actually help the reader, you may bring it up briefly and conversationally — never as an ad. If it doesn't fit naturally, just write a normal helpful reply with no mention of the app.
    - Don't be spammy or copy-paste promotional. Avoid hard CTAs unless they'd feel completely natural from a real person.
    - Match the tone of the platform.
  ${languageDirective()}`;

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
  const model = MODEL_FLASH;

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
  const model = MODEL_FLASH;
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
  energy: number;           // 0=zen → 100=electric
  vulnerability: number;    // 0=guarded → 100=bare soul   (legacy, kept for backward compat)
  provocation: number;      // 0=agreeable → 100=sharp
  specificity: number;      // 0=poetic → 100=forensic
  intimacy: number;         // 0=corporate → 100=DM to a friend  (legacy)
  // New axes — visible in the panel polygon (matches the screenshot mock).
  humor: number;            // 0=serious → 100=witty
  warmth: number;           // 0=clinical → 100=hearth
  optimism: number;         // 0=realist → 100=evangelist
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

// Comment-strategy defaults inferred from the source content. Kept loose
// (string fields) so the consumer can map to whatever its UI calls them.
export interface CommentSpecSuggestion {
  tone: 'casual' | 'formal' | 'funny';
  goal: 'build_relationship' | 'ask_question' | 'share_insight' | 'get_noticed';
  maxLength: number;            // hard budget in characters
  customInstruction: string;    // optional one-line angle ("always end with a number")
}

export interface VoiceProfileSuggestion {
  voiceMix: VoiceMix;
  hook: HookArchitecture;
  viral: ViralPhysics;
  closer: CloserStrategy;
  // NEW — populated when the AI can infer the writer's POV + reply strategy
  // from the source sample. Used by the "steal a voice" flow so cloning a
  // creator fills out perspective + comment defaults too, not just the dials.
  perspective: PerspectiveInjector;
  commentSpec: CommentSpecSuggestion;
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
  const model = MODEL_FLASH;

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
          humor: { type: Type.NUMBER },
          warmth: { type: Type.NUMBER },
          optimism: { type: Type.NUMBER },
          rhythm: { type: Type.STRING, enum: ['staccato', 'punchy', 'flowing', 'contemplative'] }
        },
        required: ['authority', 'energy', 'vulnerability', 'provocation', 'specificity', 'intimacy', 'humor', 'warmth', 'optimism', 'rhythm']
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
      // Perspective — the writer's POV inferred from the sample. Used by the
      // "steal a voice" flow so cloning a creator also fills out their angle.
      perspective: {
        type: Type.OBJECT,
        properties: {
          uniqueAngle:    { type: Type.STRING, description: "The one-line POV that makes this writer's content distinctive (e.g. 'I shipped 47 failed products before this one'). Infer from the sample." },
          contrarian:     { type: Type.STRING, description: 'The mainstream belief this writer pushes back on, in one line.' },
          forbiddenTakes: { type: Type.STRING, description: 'Topics or framings this writer pointedly avoids. Empty string if nothing obvious.' },
          receipts:       { type: Type.STRING, description: '2-4 concrete numbers, results, or credentials hinted at in the sample. Empty string if none surface.' }
        },
        required: ['uniqueAngle', 'contrarian', 'forbiddenTakes', 'receipts']
      },
      // Comment defaults — how this writer's replies should feel.
      commentSpec: {
        type: Type.OBJECT,
        properties: {
          tone:              { type: Type.STRING, enum: ['casual', 'formal', 'funny'], description: 'Overall register of the replies.' },
          goal:              { type: Type.STRING, enum: ['build_relationship', 'ask_question', 'share_insight', 'get_noticed'], description: "Default reply intent. 'share_insight' for experts, 'ask_question' for builders, 'get_noticed' for self-promoters, 'build_relationship' for community-first." },
          maxLength:         { type: Type.INTEGER, description: 'Character budget. 120-180 for terse writers, 240-320 for detailed ones, 420-600 for LinkedIn-style.' },
          customInstruction: { type: Type.STRING, description: "Optional one-line rule that captures something specific about the writer's reply style (e.g. 'always end with a contrarian aside'). Empty string if nothing distinctive." }
        },
        required: ['tone', 'goal', 'maxLength', 'customInstruction']
      },
      reasoning: { type: Type.STRING, description: 'One sentence explaining WHY these settings fit this context.' }
    },
    required: ['voiceMix', 'hook', 'viral', 'closer', 'perspective', 'commentSpec', 'reasoning']
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
Choose voice mix values (0-100 for each dimension), the best hook architecture, which viral physics to activate, the closer that fits, AND also infer the writer's POV (perspective) and their default reply strategy (commentSpec) from the sample. The perspective + commentSpec fields are critical for the "steal a voice" workflow — the user wants to clone the writer's angle and how they'd reply, not just the dials.

THINK ABOUT:
- Topic vulnerability vs hard data → adjust vulnerability/specificity
- Audience expertise → adjust authority/in-group signaling
- Tone fit: humor (serious 0 ↔ witty 100), warmth (clinical 0 ↔ hearth 100), optimism (gritty realist 0 ↔ evangelist 100). Match these to how the SAMPLE actually reads, not how you'd like it to read.
- Format constraints (X tweet = high energy/staccato; LinkedIn long-form = contemplative)
- The writer's contrarian view → enable bait-and-switch and forbidden specificity if strong; also surface it in perspective.contrarian.
- If they have receipts → enable concession move + status currency; also list 2-4 specific receipts in perspective.receipts.
- perspective.uniqueAngle MUST be a sharp, one-line POV (not generic). If the sample doesn't reveal one, infer the most plausible from their recurring themes.
- commentSpec.maxLength: shorter for terse writers (120-180), medium for most (240-320), longer for LinkedIn-essay writers (420-600).
- commentSpec.customInstruction: leave empty unless the writer has a *distinctive* reply tic (e.g. always closes with a one-liner).

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
  const model = MODEL_FLASH;

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
        systemInstruction: 'You are an elite social copywriter trained on the best-performing posts of solo founders and contrarian thinkers. You hate corporate language. You worship specificity.' + languageDirective() + HUMAN_VOICE_RULES
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
  const model = MODEL_FLASH;
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

export const generateSmartEngagementComment = async (
  postText: string,
  appDesc: string,
  title: string,
  params?: {
    tone?: string;
    goal?: string;
    platform?: string;
    customInstruction?: string;
    maxLength?: number;          // hard character budget from the Voice Studio comment spec
    mode?: string;               // 'comment' | 'quote' | 'visibility'
    // Optional voice profile — when supplied, the prompt also threads in the
    // user's saved voice characteristics so generated comments match their
    // saved-profile dial settings (matches what Voice Studio outputs).
    voiceMix?: Partial<VoiceMix>;
    perspective?: PerspectiveInjector;
  }
): Promise<SmartComment> => {
  const model = MODEL_FLASH;
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
  const tone = (params?.tone || 'casual').toLowerCase();
  const goal = (params?.goal || 'build_relationship').replace(/_/g, ' ');
  const extra = params?.customInstruction ? ` Extra guidance: ${params.customInstruction}.` : '';
  // ── TONE DIRECTIVE ──────────────────────────────────────────────────
  // The user picks this explicitly in the engine parameters; it is NOT a
  // soft hint. Translate it into a concrete, strongly-worded directive and
  // surface it at the TOP of the prompt — otherwise a single "Tone: funny"
  // line buried at the end gets steamrolled by the voice-dial block below
  // (e.g. a low humor dial emitting "earnest and straight-faced" directly
  // contradicts "funny"). This is the user's #1 reported bug: they chose
  // "funny" and got comments that weren't funny.
  const toneDirectiveMap: Record<string, string> = {
    funny: 'TONE — FUNNY (non-negotiable): Be genuinely, noticeably funny. Use real wit — a clever observation, dry punchline, playful exaggeration, an unexpected analogy, or self-aware humor — anchored to a SPECIFIC detail in their post. A reader should actually smile or laugh. A flat, earnest, or merely "nice" reply has FAILED this requirement. Do not announce that you are joking; just be funny. Avoid corny puns and forced jokes — land it like a sharp, witty person would.',
    casual: 'TONE — CASUAL: Write like you are texting a smart friend. Relaxed and conversational, contractions, plain words, zero corporate stiffness. Warm and easy, never formal or salesy.',
    formal: 'TONE — FORMAL: Polished, professional, and precise. Complete sentences, no slang, no emojis. Measured and credible — the way a respected expert writes in a professional setting.',
  };
  const toneDirective = (toneDirectiveMap[tone]
    || `TONE — ${tone.toUpperCase()}: Write the reply unmistakably in a ${tone} tone; it must be obvious from the very first sentence.`)
    + languageDirective() + HUMAN_VOICE_RULES;
  // When the user explicitly asked for "funny", a conflicting LOW humor dial
  // from their saved voice profile would sabotage it. The explicit tone wins:
  // we force the humor dial high so the voice block reinforces (not fights)
  // the tone choice.
  const toneForcesHumor = tone === 'funny';
  // Caller may thread these in from the Voice Studio comment spec (spread onto
  // params). They're not in the static type, so read them defensively.
  const maxLen = typeof (params as any)?.maxLength === 'number' ? (params as any).maxLength : null;
  const mode = String((params as any)?.mode || 'comment').toLowerCase();
  // Length budget = platform ceiling, tightened by the user's configured cap.
  const p = String(params?.platform || '').toLowerCase();
  const isX = p.includes('x') || p.includes('twitter');
  const platformCeil = isX ? 280 : p.includes('linkedin') ? 400 : p.includes('reddit') ? 600 : 400;
  const budget = maxLen ? Math.min(maxLen, platformCeil) : platformCeil;
  const platformGuide =
    isX
      ? `This is X (Twitter): keep the reply tight and punchy, under ${budget} characters, no hashtags.`
    : p.includes('linkedin')
      ? `This is LinkedIn: a professional, value-adding reply (under ${budget} characters), no hashtags.`
    : p.includes('reddit')
      ? `This is Reddit: a helpful, authentic, conversational reply (under ${budget} characters); never salesy or it will be downvoted.`
      : `Keep the reply concise and conversational (under ${budget} characters).`;
  const modeGuide = mode === 'quote'
    ? '\nThis is a QUOTE post: you are resharing their post WITH your own take on top. Lead with a sharp, standalone opinion that frames why their post matters — it must stand on its own and make the reader want to read the quoted post.'
    : '';
  // Date anchor — gemini-flash's training data is stale, so left unchecked it
  // drops "in 2024" / "as of 2025" / "this year" references that read as
  // out-of-date to anyone reading the reply now. Anchor today's date and ban
  // dated claims unless they appear in the post itself.
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── VOICE BLOCK ─────────────────────────────────────────────────────
  // Translate the Voice Studio dials into CONCRETE writing directives (the same
  // dial→directive engine the Content Engine uses) so replies sound like the
  // user's configured voice instead of generic "nice reply" filler. Only built
  // when a voice profile is supplied; default callers keep the lighter prompt.
  let voiceBlock = '';
  if (params?.voiceMix || params?.perspective) {
    const vm: any = params.voiceMix || {};
    const dir: string[] = [];
    const add = (key: string, low: string, high: string) => {
      if (typeof vm[key] === 'number') {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        dir.push('- ' + sliderToDirective(label, vm[key], low, high));
      }
    };
    add('authority',     'a humble, curious peer',        'an unquestionable expert');
    add('energy',        'calm and measured',             'electric and urgent');
    add('provocation',   'agreeable and safe',            'sharp, contrarian, willing to disagree');
    add('specificity',   'big-picture and abstract',      'forensic — concrete details, names, numbers');
    // If the user explicitly chose the "funny" tone, never let a low humor dial
    // contradict it — force the dial directive to the witty/playful extreme so
    // the voice block reinforces the tone instead of cancelling it out.
    if (toneForcesHumor) {
      dir.push('- ' + sliderToDirective('Humor', 100, 'earnest and straight-faced', 'witty and playful'));
    } else {
      add('humor',       'earnest and straight-faced',    'witty and playful');
    }
    add('warmth',        'clinical and detached',         'warm and personal');
    add('optimism',      'a grounded realist',            'an energising evangelist');
    add('vulnerability', 'guarded',                       'openly self-revealing');
    add('intimacy',      'a professional register',       'talking to a close friend');
    const rhythmDesc: Record<string, string> = {
      staccato: 'Short, punchy sentences. Fragments are fine.',
      punchy: 'Tight sentences with forward momentum.',
      flowing: 'Smooth, connected, easy-reading sentences.',
      contemplative: 'Slower, reflective phrasing.'
    };
    if (vm.rhythm && rhythmDesc[vm.rhythm]) dir.push(`- Rhythm: ${rhythmDesc[vm.rhythm]}`);

    const pp: any = params.perspective || {};
    const perspLines = [
      pp.uniqueAngle && `Write from this lived vantage point: ${pp.uniqueAngle}.`,
      pp.contrarian && `You believe most people get this wrong: ${pp.contrarian}. Let that conviction show when it's relevant.`,
      pp.receipts && `Credibility you can draw on — weave in a concrete detail ONLY if it fits naturally, never dump the whole list: ${pp.receipts}.`,
      pp.forbiddenTakes && `NEVER say or imply: ${pp.forbiddenTakes}.`
    ].filter(Boolean);

    voiceBlock =
      `\nWRITE IN THIS EXACT VOICE — it must be unmistakable in every sentence:\n${dir.join('\n')}` +
      (perspLines.length ? `\n\nPERSPECTIVE / POINT OF VIEW:\n- ${perspLines.join('\n- ')}` : '') +
      `\n\nThe reply must read like THIS specific person — not a generic, interchangeable commenter. Match these dials faithfully; they are the whole point.`;
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Write 3 genuine, human engagement replies to @${title}'s post.

Their post: "${postText}"

${toneDirective}

${platformGuide}${modeGuide}

The 3 options must be GENUINELY DIFFERENT takes — not three rewordings of the same point. Give each a distinct angle, e.g.:
  • Option 1 — a specific INSIGHT or build on a point they made.
  • Option 2 — a concrete EXPERIENCE / example, or a sharp QUESTION that moves the thread forward.
  • Option 3 — a respectful COUNTERPOINT or a non-obvious angle most commenters would miss.
Each must quote or clearly reference a SPECIFIC detail from THIS post (a phrase, claim, or number they used) so it could only be posted under this exact post — never a template that fits any post. Lead with the substance, not a warm-up.

Write like a real, sharp person joining the conversation — add real value. Be natural and conversational. Hard bans: generic praise ("Great post!", "So true!", "This is gold", "Couldn't agree more"), empty agreement, restating their post back to them, hashtags, and emojis (unless the voice clearly uses them). Do NOT invent facts, fake statistics, or experiences you weren't given — stay truthful; if you cite a number or result, it must come from the perspective/receipts below or not appear at all.

Today's date is ${today}. CRITICAL: do NOT reference specific years, dates, "this year", "recently", "the latest", current events, trends, tools, version numbers, or "as of 20XX" claims UNLESS those exact details appear in their post — your knowledge is not current and any year/recency claim you add from memory will be outdated and wrong (e.g. citing 2024 or 2025 as "now"). Keep the reply timeless: react to what they actually wrote, not to dated facts you think you know.

On mentioning the writer's product: let it be natural, not forced.
- If the post is about a problem this product genuinely solves and bringing it up would actually help the reader, you may mention it briefly and conversationally — the way a helpful peer would, never as an ad.
- If it doesn't fit naturally, just write a normal, valuable reply and don't mention any product at all. Most replies should be plain, helpful comments with no pitch.
- Never sound salesy or copy-paste promotional. No hard call-to-action unless it would feel completely natural coming from a real person.

Who's replying (their background/product, for context): ${appDesc}.
Relationship goal: ${goal}.${extra}
${voiceBlock}

REMINDER — the ${tone.toUpperCase()} tone defined at the top is the single most important constraint and applies to ALL 3 options. Re-read it and make sure every option clearly satisfies it before returning.

For each option, "why" explains in one short phrase why this reply lands AND which angle it takes. Return JSON matching the schema.`,
      config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.95 }
    });
    return JSON.parse(response.text) as SmartComment;
  } catch {
    return { options: [{ body: "Great perspective! Would love to connect.", why: "Neutral opener" }] };
  }
};

export const evaluateHNOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
  const model = MODEL_FLASH;
  const response = await ai.models.generateContent({
    model,
    contents: `Evaluate these Hacker News items for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
};

export const evaluatePHOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
  const model = MODEL_FLASH;
  const response = await ai.models.generateContent({
    model,
    contents: `Evaluate these Product Hunt items for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
};

export const evaluateRedditOpportunities = async (items: any[]): Promise<ForumOpportunity[]> => {
  const model = MODEL_FLASH;
  const response = await ai.models.generateContent({
    model,
    contents: `Evaluate these Reddit posts for SaaS founder relevance, return JSON array: ${JSON.stringify(items.slice(0, 10))}`,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
};

export const generateBuyerPersonas = async (appName: string, appDesc: string, category: string): Promise<BuyerPersonaAnalysis> => {
  assertConfigured();
  const model = MODEL_FLASH;

  // Reusable sub-schemas
  const radarSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      priceSensitive: { type: Type.NUMBER },
      techSavvy: { type: Type.NUMBER },
      riskAverse: { type: Type.NUMBER },
      collaborative: { type: Type.NUMBER },
      pragmatic: { type: Type.NUMBER },
      vocal: { type: Type.NUMBER }
    },
    required: ["priceSensitive", "techSavvy", "riskAverse", "collaborative", "pragmatic", "vocal"]
  };

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      marketOverview: { type: Type.STRING, description: "2-3 sentences. Frame the addressable market in concrete buyer terms — who pays for this category, what budget, what they currently use." },
      personas: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "First name only, memorable" },
            role: { type: Type.STRING, description: "REAL job title pattern found on LinkedIn. NEVER a niche label." },
            tagline: { type: Type.STRING, description: "One punchy line (max 10 words) — the buyer's POV" },
            demographics: { type: Type.STRING, description: "Years experience, seniority level, reporting line, geo bias, team size" },
            realWorldQuote: { type: Type.STRING, description: "What they'd actually say in a sales call (max 25 words)" },
            painPoints: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-5 OPERATIONAL pains (not abstract) — measurable, time-bound, costing $$$" },
            goals: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-5 quarterly/annual goals tied to their job KPIs" },
            whereTheyHangOut: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Legacy — short channel list" },
            contentTheyConsume: { type: Type.ARRAY, items: { type: Type.STRING } },
            personalityRadar: { ...radarSchema, description: "Each value 0-100. Use the full range — be decisive." },
            companyProfile: {
              type: Type.OBJECT,
              description: "ICP firmographics — must be SEARCHABLE on LinkedIn Sales Nav / Crunchbase / BuiltWith.",
              properties: {
                industries: { type: Type.ARRAY, items: { type: Type.STRING } },
                companySize: { type: Type.STRING, description: "e.g. '50-200 employees' or 'Solo founders' or 'Mid-market 200-1000'" },
                stage: { type: Type.STRING, description: "e.g. 'Series A-B' or 'Bootstrapped profitable' or 'Pre-seed'" },
                arrRange: { type: Type.STRING, description: "e.g. '$2M-$20M ARR' or 'Pre-revenue' or 'Mature $50M+'" },
                techStackSignals: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific tool names that signal this ICP — e.g. ['Stripe', 'Linear', 'HubSpot']" },
                estimatedTAM: { type: Type.STRING, description: "A defensible number with geography — e.g. '~18,000 companies in US + EU + UK matching this ICP'" }
              },
              required: ["industries", "companySize", "stage", "arrRange", "techStackSignals", "estimatedTAM"]
            },
            buyerRole: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, description: "One of: Champion, Economic Buyer, End User, Influencer, Founder" },
                decisionPower: { type: Type.STRING, description: "One of: Solo decision, Strong recommender, Committee member, Final approver, Blocker risk" },
                typicalBudget: { type: Type.STRING, description: "Discretionary monthly budget — e.g. '$500-$5K/mo'" },
                procurementFriction: { type: Type.STRING, description: "What it takes to close — e.g. 'Self-serve under $500/mo, legal review over $5K/yr, security review over $20K/yr'" }
              },
              required: ["type", "decisionPower", "typicalBudget", "procurementFriction"]
            },
            triggerEvents: {
              type: Type.ARRAY,
              description: "Real-world events that create urgency to buy NOW. Each must be DETECTABLE in public signals.",
              items: {
                type: Type.OBJECT,
                properties: {
                  event: { type: Type.STRING, description: "e.g. 'Hired their first VP Marketing'" },
                  detectionSignal: { type: Type.STRING, description: "How to detect — e.g. 'LinkedIn job change + new headcount on their team page'" },
                  urgencyDays: { type: Type.NUMBER, description: "Days the buyer is in active-evaluation mode after the trigger" }
                },
                required: ["event", "detectionSignal", "urgencyDays"]
              }
            },
            currentStack: {
              type: Type.ARRAY,
              description: "Tools they are currently using to solve this problem. Use REAL vendor names. This is your competition.",
              items: {
                type: Type.OBJECT,
                properties: {
                  tool: { type: Type.STRING },
                  rolePlayed: { type: Type.STRING },
                  painWithIt: { type: Type.STRING },
                  switchingFriction: { type: Type.STRING, description: "One of: Low, Medium, High" }
                },
                required: ["tool", "rolePlayed", "painWithIt", "switchingFriction"]
              }
            },
            wateringHoles: {
              type: Type.ARRAY,
              description: "SPECIFIC named communities (not generic 'Twitter'). Subreddit names with member counts, Slack/Discord names, specific newsletters/podcasts/conferences.",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Specific name — e.g. 'r/SaaS' or 'MarketingOps Community Slack' or 'Lenny's Newsletter'" },
                  type: { type: Type.STRING, description: "One of: Subreddit, Slack, Discord, Newsletter, Podcast, Conference, Twitter, LinkedIn group, Forum" },
                  memberCount: { type: Type.STRING, description: "Approximate count — e.g. '187K members' or '12K subscribers'" },
                  activityLevel: { type: Type.STRING, description: "How this persona participates — e.g. 'Lurks daily, posts monthly'" },
                  bestPostFormat: { type: Type.STRING, description: "What content gets engagement from this persona here" },
                  url: { type: Type.STRING }
                },
                required: ["name", "type", "memberCount", "activityLevel", "bestPostFormat"]
              }
            },
            outreach: {
              type: Type.OBJECT,
              properties: {
                bestChannel: { type: Type.STRING },
                worstChannel: { type: Type.STRING },
                bestTimeToReach: { type: Type.STRING },
                openingAngle: { type: Type.STRING, description: "First-message playbook — specific enough to copy" },
                avgSalesCycleDays: { type: Type.NUMBER }
              },
              required: ["bestChannel", "worstChannel", "bestTimeToReach", "openingAngle", "avgSalesCycleDays"]
            },
            objections: {
              type: Type.ARRAY,
              description: "Top 3 objections + how to counter each",
              items: {
                type: Type.OBJECT,
                properties: {
                  objection: { type: Type.STRING },
                  counter: { type: Type.STRING }
                },
                required: ["objection", "counter"]
              }
            },
            painSources: {
              type: Type.ARRAY,
              description: "Public sources where this persona has voiced their pain — real-looking URLs to Reddit/X/HN/LinkedIn/IndieHackers/specific Slack communities.",
              items: {
                type: Type.OBJECT,
                properties: {
                  painIndex: { type: Type.NUMBER },
                  platform: { type: Type.STRING },
                  snippet: { type: Type.STRING },
                  url: { type: Type.STRING }
                },
                required: ["painIndex", "platform", "snippet", "url"]
              }
            }
          },
          required: [
            "name", "role", "tagline", "demographics", "painPoints", "goals",
            "whereTheyHangOut", "contentTheyConsume", "personalityRadar",
            "companyProfile", "buyerRole", "triggerEvents", "currentStack", "wateringHoles", "outreach"
          ]
        }
      }
    },
    required: ["marketOverview", "personas"]
  };

  const contents = `You are a senior B2B SaaS GTM strategist building buyer personas for a SaaS founder who needs to FIND and CLOSE real customers — not for a marketing-school assignment.

PRODUCT
- Name: "${appName}"
- Category: ${category}
- Description: "${appDesc}"

CRITICAL RULES — Reject narrow / niche personas

1. **Each persona MUST represent a market with at least 5,000 matching companies (US+EU+UK).** If you cannot defend the TAM number, the segment is too narrow — collapse it into a broader one.

2. **Use REAL job titles found on LinkedIn Sales Navigator.** Examples of GOOD roles:
   - "Head of Demand Generation"
   - "Director of Revenue Operations"
   - "VP of Marketing"
   - "Solo SaaS Founder"
   - "Head of Growth"
   - "CFO at Series B SaaS"
   - "Marketing Operations Lead"

3. **NEVER invent niche labels** like:
   - ❌ "Citation crisis business owner"
   - ❌ "Burned-out content creator with imposter syndrome"
   - ❌ "Sustainability-focused micro-influencer"
   These are useless — a founder cannot search for them, cannot find them, cannot close them.

4. **Each persona must be DISTINCT on the buyer-role axis.** Mix Champion / Economic Buyer / End User. Do not generate three flavors of the same role.

5. **companyProfile.estimatedTAM must be a defensible number.** Show your work in the string — e.g. "~18,000 B2B SaaS companies at Series A-B in US/EU/UK per Crunchbase".

6. **wateringHoles must be SPECIFIC NAMED communities** with member counts (approximate is fine). NEVER generic like "Twitter" or "Reddit". Use real names like "r/SaaS (187K members)", "Demand Curve Slack", "Lenny's Newsletter", "MicroConf community", "MarketingOps Community", "Latent Space Discord", "HackerNews", "Indie Hackers", etc.

7. **currentStack uses real vendor names.** This is the founder's competition.

8. **triggerEvents must be DETECTABLE in public data** — funding announcements, LinkedIn hires, GitHub stars, AppStore launches, layoff news, etc.

9. **personalityRadar values must use the full 0-100 range.** Two personas should not have similar radar shapes.

10. **painSources URLs must look real** — use specific subreddit paths, Twitter username patterns, HN item IDs, LinkedIn post URL patterns. Snippets must be conversational, not corporate.

STRUCTURE
Generate exactly 3 personas. Sort them by addressability (easiest to reach + close first).

Each persona answers:
1. WHO they are (name, role, demographics, radar, quote, ICP firmographics, buyer role)
2. WHAT they struggle with (pain points + currentStack + objections)
3. WHEN they buy (triggerEvents)
4. WHERE to find them (wateringHoles)
5. HOW to win them (outreach playbook + objection counters)
6. PROOF — painSources

Return strict JSON matching the schema. No commentary.`;

  const response = await ai.models.generateContent({
    model,
    contents,
    config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.75 }
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
  const model = MODEL_FLASH;

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

    // @google/genai uses ai.models.generateContent (not legacy
    // ai.getGenerativeModel which threw "is not a function" here).
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: `Act as a High-Precision ICP Recon DNA Parser.
Given the following user brief, extract a structured campaign identity.

### CRITICAL: THE BUYER vs SELLER POLARITY
Identify "SELLERS" (specialists, agencies, consultants, experts) and add them to negativeKeywords.

Brief: "${brief}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const result = JSON.parse((response.text || '').trim() || '{}');
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
    assertConfigured();
    const prompt = `You are a lead qualification AI. Given these prospects and campaign context, score each prospect's relevance.

Campaign: ${JSON.stringify({ name: campaign?.name, roles: campaign?.roles, painPoints: campaign?.painPoints })}

Prospects (handle, bio, url):
${prospects.slice(0, 30).map((p: any, i: number) => `${i + 1}. @${p.handle || 'unknown'} | ${(p.bio || '').substring(0, 100)} | ${p.url || ''}`).join('\n')}

Return JSON: { "validProfiles": [{ "handle": string, "url": string, "isTarget": boolean, "relevanceScore": number (0-100), "reasoning": string }] }`;
    const response = await ai.models.generateContent({
      model: MODEL_FLASH,
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    return JSON.parse(response.text || '{"validProfiles":[]}');
  } catch (e) {
    console.error('[Gemini] filterProfilesWithAI failed:', e);
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

// =====================================================================
// FEED WATCHER — score a batch of feed posts against the user's prompt.
// =====================================================================
// Used by the Account Finder → Feed Watcher loop. The extension buffers raw
// scraped posts from the user's home feeds (X / LinkedIn / Reddit); this
// function takes a chunk + the user's free-text "what I'm looking for" prompt
// and returns a 0–100 relevancy score with a one-sentence reason for each.
// Returned `uuid` mirrors the input so the caller can reconcile by id.
export interface FeedRelevancyResult {
  uuid: string;
  score: number;       // 0..100
  reason: string;      // one short sentence
}

export const scoreFeedPostRelevancy = async (
  prompt: string,
  posts: Array<{ uuid: string; platform: string; text: string; author?: { displayName?: string; handle?: string; bylineSubtitle?: string } }>
): Promise<FeedRelevancyResult[]> => {
  if (!posts || posts.length === 0) return [];
  assertConfigured();
  const model = MODEL_FLASH;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            uuid: { type: Type.STRING },
            score: { type: Type.NUMBER },
            reason: { type: Type.STRING }
          },
          required: ["uuid", "score", "reason"]
        }
      }
    },
    required: ["results"]
  };

  // Pack a compact payload (text capped) — keeps token cost predictable for
  // batches up to ~25 posts per call.
  const payload = posts.slice(0, 25).map(p => ({
    uuid: p.uuid,
    platform: p.platform,
    author: [p.author?.displayName, p.author?.handle && '@' + p.author.handle, p.author?.bylineSubtitle]
      .filter(Boolean).join(' · ').slice(0, 200),
    text: (p.text || '').slice(0, 800)
  }));

  const instructions = `You are an opportunity-spotter. The user is watching their social feeds for posts that match THIS BRIEF:

"${(prompt || '').trim() || '(no brief given — score everything 0)'}"

For each post below, return:
- score: 0..100 reflecting how well it matches the brief (0 = irrelevant noise, 100 = perfect match the user MUST see).
- reason: ONE short sentence explaining the score.

Return the EXACT same uuids you received. Do not invent posts. Be strict — only > 60 should mean a genuine opportunity.

POSTS:
${JSON.stringify(payload)}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: instructions,
      config: { responseMimeType: "application/json", responseSchema: schema }
    });
    const parsed = JSON.parse(response.text);
    const results: FeedRelevancyResult[] = Array.isArray(parsed?.results) ? parsed.results : [];
    // Defensive: clamp scores; backfill any missing uuids at score 0 so the
    // caller can mark them processed and avoid an infinite re-score loop.
    const byUuid = new Map(results.map(r => [r.uuid, r]));
    return posts.map(p => {
      const r = byUuid.get(p.uuid);
      if (!r) return { uuid: p.uuid, score: 0, reason: 'No AI response for this post' };
      const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
      return { uuid: p.uuid, score, reason: String(r.reason || '').slice(0, 280) };
    });
  } catch (e) {
    // On API failure, return all zeros with a reason so we don't promote noise.
    return posts.map(p => ({ uuid: p.uuid, score: 0, reason: `Scorer failed: ${(e as Error)?.message?.slice(0, 120) || 'unknown error'}` }));
  }
};

// =====================================================================
// AI ACCOUNT FINDER
// =====================================================================
// Replaces the old in-browser extension search. Asks the model to suggest
// real accounts to follow on the chosen platform given the user's niche
// + engagement parameters. Output is shaped to fit DiscoveredAccount so
// the existing ResultsPanel renders it without changes.

export interface AIFinderParams {
  platform: 'X' | 'LinkedIn' | 'Reddit';
  niche: string;                 // free-text: "AI agents for SaaS founders"
  keywords?: string[];           // chip list
  audienceSize?: 'any' | 'small' | 'medium' | 'large';
  engagementBar?: 'any' | 'some' | 'real' | 'viral';
  country?: string;              // free-text country / region. Omit for worldwide.
  productName?: string;
  productPitch?: string;
  targetAudience?: string;
  limit?: number;                // soft cap on returned accounts (default 15)
}

export interface AISuggestedAccount {
  handle: string;                // bare handle, no @ prefix
  displayName: string;
  url: string;                   // canonical profile / subreddit URL
  bio: string;
  followers: number;             // best-guess from public data
  verified: boolean;
  engagementRate?: number;       // 0..100 approximate
  matchedSignals: string[];      // why this account fits
  topTopics: string[];
  whyHighEngagement: string;     // single-sentence rationale

  // ── Wow KPIs (best-effort estimates by the model) ──
  // These reframe vanity numbers into actionable numbers. Optional because
  // older callers don't pass targetAudience; the consumer falls back to a
  // local heuristic when these are missing.

  // % of this creator's most engaged commenters whose bios match the user's
  // ICP. 0-100. Reflect how dense their audience is in the user's niche.
  icpMatchRate?: number;
  // 2-3 sample matched-commenter handles for hover-proof. Real handles only.
  icpMatchSamples?: string[];
  // Median minutes from post-published until ~50% of total engagement has
  // landed. Lower = a tighter window before replies become invisible.
  spotlightWindowMin?: number;
}

export const findAccountsWithAI = async (params: AIFinderParams): Promise<AISuggestedAccount[]> => {
  assertConfigured();
  const model = MODEL_FLASH;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      accounts: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            handle: { type: Type.STRING, description: "Bare handle — no @, no URL. For Reddit, use the subreddit name (no r/)." },
            displayName: { type: Type.STRING },
            url: { type: Type.STRING, description: "Canonical profile URL. X: https://x.com/<handle>. LinkedIn: https://linkedin.com/in/<slug>. Reddit: https://reddit.com/r/<name>/." },
            bio: { type: Type.STRING, description: "One-sentence bio summarizing who they are." },
            followers: { type: Type.INTEGER, description: "Best-guess follower count (or member count for subreddits). Round numbers OK." },
            verified: { type: Type.BOOLEAN },
            engagementRate: { type: Type.NUMBER, description: "Approximate engagement rate as percent 0..100." },
            matchedSignals: { type: Type.ARRAY, items: { type: Type.STRING }, description: "2-4 reasons this account matches the user's niche." },
            topTopics: { type: Type.ARRAY, items: { type: Type.STRING }, description: "2-5 recurring topics they post about." },
            whyHighEngagement: { type: Type.STRING, description: "One short sentence on why this account drives engagement." },

            // ── Wow KPIs ──
            icpMatchRate: { type: Type.NUMBER, description: "Best-effort estimate (0-100) of the percentage of this account's recent engaged commenters whose bios fit the user's TARGET AUDIENCE. If you don't know, estimate based on the audience overlap between their TOPICS and the user's niche. Be honest: 30-50 is realistic for niche-adjacent accounts, 70+ is rare." },
            icpMatchSamples: { type: Type.ARRAY, items: { type: Type.STRING }, description: "2-3 REAL handles of plausible matched commenters (no fabrications). Leave empty if you don't have specific knowledge." },
            spotlightWindowMin: { type: Type.INTEGER, description: "Estimated median minutes from post-published until ~50% of engagement is collected. Typical ranges: 15-30 for X power users, 60-180 for LinkedIn slow burns, 180-360 for evergreen creators. Smaller = the user must reply faster to grab the top-comment slot." }
          },
          required: ["handle", "displayName", "url", "bio", "followers", "verified", "matchedSignals", "topTopics", "whyHighEngagement"]
        }
      }
    },
    required: ["accounts"]
  };

  const sizeHint = {
    any: 'any size',
    small: 'small accounts under ~50k followers — approachable, high reply rate',
    medium: 'mid-size accounts ~50k–1M followers — solid reach, still engageable',
    large: 'large accounts over 1M followers — massive reach but harder to engage'
  }[params.audienceSize || 'any'];

  const engagementHint = {
    any: 'engagement is not a hard filter',
    some: 'posts must get at least modest engagement (~10+ likes / reactions / upvotes per post)',
    real: 'posts must show real signal (~50+ likes / reactions / upvotes per post)',
    viral: 'only accounts whose posts regularly go viral (~500+ engagement)'
  }[params.engagementBar || 'real'];

  const limit = Math.min(Math.max(params.limit || 15, 5), 30);

  const countryClause = params.country
    ? `\n- Only suggest accounts primarily based in ${params.country}, or whose audience is concentrated there. Filter out creators based outside this region.`
    : '';

  const prompt = `You are an expert social-graph researcher. Suggest ${limit} real accounts on ${params.platform} that the user should FOLLOW to engage with high-engagement content in their niche.

USER NICHE: ${params.niche || '(unspecified)'}
KEYWORDS: ${(params.keywords || []).join(', ') || '(none)'}
AUDIENCE SIZE PREFERENCE: ${sizeHint}
ENGAGEMENT BAR: ${engagementHint}
${params.country ? `COUNTRY / REGION: accounts must be based in ${params.country}` : ''}
${params.productName ? `USER'S PRODUCT: ${params.productName} — ${params.productPitch || ''}` : ''}
${params.targetAudience ? `USER'S TARGET AUDIENCE: ${params.targetAudience}` : ''}

Rules:
- Only suggest accounts that ACTUALLY EXIST. No invented handles.
- Prioritize accounts where engagement-per-post is HIGH for their follower size.
- For ${params.platform === 'Reddit' ? 'Reddit, suggest active subreddits — not individual users' : 'individual creators'}.
- Diversify: don’t just suggest the 5 most famous names — include mid-tier creators whose audience is dense and active.
- Each \`whyHighEngagement\` must be specific (e.g. "posts contrarian takes on B2B SaaS pricing — replies average 80+").${countryClause}
- icpMatchRate, icpMatchSamples, spotlightWindowMin are CRITICAL — they're the headline KPIs the user sees on each account card. Be honest, don't fabricate. If you can't estimate, return null fields and the UI will fall back to a local heuristic. Real-handle samples only.
- Return ONLY the JSON object.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.7,
        systemInstruction: "You are a social-graph researcher. You suggest only real, verifiable accounts. You never invent handles."
      }
    });
    const parsed = JSON.parse(response.text || '{}');
    const list: AISuggestedAccount[] = Array.isArray(parsed?.accounts) ? parsed.accounts : [];
    return list.map(a => ({
      ...a,
      followers: Math.max(0, Math.round(Number(a.followers) || 0)),
      engagementRate: typeof a.engagementRate === 'number' ? Math.max(0, Math.min(100, a.engagementRate)) : undefined,
      matchedSignals: Array.isArray(a.matchedSignals) ? a.matchedSignals : [],
      topTopics: Array.isArray(a.topTopics) ? a.topTopics : [],
      // ── Wow-KPI normalization. Clamp to sane ranges, drop garbage. ──
      icpMatchRate: typeof a.icpMatchRate === 'number'
        ? Math.max(0, Math.min(100, Math.round(a.icpMatchRate)))
        : undefined,
      icpMatchSamples: Array.isArray(a.icpMatchSamples)
        ? a.icpMatchSamples.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
        : [],
      spotlightWindowMin: typeof a.spotlightWindowMin === 'number'
        ? Math.max(5, Math.min(720, Math.round(a.spotlightWindowMin))) // 5min - 12h
        : undefined
    }));
  } catch (e) {
    console.error("AI account finder error:", e);
    throw e;
  }
};
