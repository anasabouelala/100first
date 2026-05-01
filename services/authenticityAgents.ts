import { Schema, GoogleGenAI } from "@google/genai";
import { ContentDNA } from '../types';

const ai = new GoogleGenAI({ apiKey: import.meta.env?.VITE_GEMINI_API_KEY || process.env.API_KEY || '' });

export const getContentDNA = (): ContentDNA | null => {
    try {
        const saved = localStorage.getItem('content_dna_config');
        return saved ? JSON.parse(saved) : null;
    } catch {
        return null;
    }
};

// ─── Elite Copywriter Shield ──────────────────────────────────────────────────
// Rules distilled from Dan Kennedy, Gary Halbert, Alex Hormozi, Justin Welsh,
// Levelsio, and MJ DeMarco's published writing patterns.

const ELITE_COPYWRITER_SHIELD = `
ELITE HUMAN COPYWRITER SHIELD — MANDATORY ENFORCEMENT:

RHYTHM & STRUCTURE:
- Vary sentence length DRAMATICALLY. Use 2-3 word sentences next to 20-word ones.
- The "Punch" rhythm: Short. Short. Then the longer payoff sentence.
- Maximum 2-3 sentences per paragraph. Hard breaks between every paragraph.
- Sentence fragments are allowed and powerful for emphasis. Like this.
- Never write more than 2 consecutive sentences of similar length.

VOCABULARY & SPECIFICITY:
- Use contractions always: don't / won't / can't / it's — NEVER "do not", "will not"
- Specificity beats vagueness: write "43%" NOT "nearly half". Write "$127k" NOT "six figures".
- Use the simplest possible word. "Use" not "utilize". "Show" not "demonstrate".
- Write with full conviction. Remove ALL hedging: delete "I think", "I believe", "perhaps", "it seems", "might", "could potentially"

AI-TELL ERADICATION — THESE WILL DISQUALIFY THE CONTENT:
- NEVER use: "It's worth noting", "In today's world", "I'm excited to share", "In conclusion", "Furthermore", "Moreover", "Additionally", "Needless to say", "Game-changer", "Synergy", "Leverage" (as a verb)
- NEVER use em-dashes (—) more than once per piece (overuse is the #1 AI fingerprint)
- NEVER start two consecutive sentences with the same word
- NEVER open any post with "I've been thinking about..." or "In today's fast-paced..."
- NEVER write perfectly balanced lists (3 items of similar length = instant AI detection)
- Avoid passive voice. "The team built X" not "X was built by the team."

CONVERSATIONAL AUTHENTICITY:
- Write like you're talking to one smart person, not broadcasting to a crowd
- Use "you" more than "people" or "they"
- It's okay to start a sentence with "And" or "But" — real humans do this
- Occasional imperfection in rhythm is a feature, not a bug
`;

/**
 * Executes the 3-Layer Multi-Agent Authenticity Pipeline.
 * Upgraded with optional Style Inspiration injection and Elite Copywriter Shield.
 */
export const runMultiAgentPipeline = async (
    objectivePrompt: string,
    finalSchema: Schema,
    platform: 'twitter' | 'linkedin' | 'reddit' | 'general',
    styleInspiration?: string
): Promise<string> => {
    const dna = getContentDNA();

    if (!dna) {
        // Fallback to standard if no DNA is configured
        console.warn("[Multi-Agent] No DNA found. Falling back to single-shot.");
        const r = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: objectivePrompt,
            config: { responseSchema: finalSchema, responseMimeType: "application/json" }
        });
        return r.text || "{}";
    }

    console.log("[Multi-Agent] Initiating Content DNA Pipeline...");

    // ==========================================
    // AGENT 1: The Raw Architect (Logic & Value)
    // ==========================================
    console.log("[Multi-Agent] Agent 1: Drafting Architecture");
    const agent1Prompt = `
        You are the Brain. Do not worry about style, tone, or format.
        Your ONLY job is to extract the logical value, the narrative arc, and the raw ideas from the given objective.

        OBJECTIVE:
        ${objectivePrompt}
    `;
    const draftRes = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: agent1Prompt
    });
    const rawArchitecture = draftRes.text || "";

    // ==========================================
    // AGENT 2: The Voice Cloner (Style & Tone)
    // ==========================================
    const platformDna = dna.platforms[platform !== 'general' ? platform : 'twitter'];

    const x = platformDna.vibeMatrix.x;
    const y = platformDna.vibeMatrix.y;

    const logicAdjective = x < 25 ? "Strictly Corporate and Professional" :
                           x < 50 ? "Startup Safe but approachably casual" :
                           x < 75 ? "Direct, indie-hacker style, no-nonsense" :
                                    "Unfiltered, rebellious, completely raw and edgy";

    const emotionalAdjective = y < 25 ? "Highly vulnerable, humble, sharing failures" :
                               y < 50 ? "Helpful, community-focused, peer-to-peer" :
                               y < 75 ? "Confident, expert-level, slightly authoritative" :
                                        "Aggressively confident, controversial, purely authoritative";

    const promptTone = `The tone must be ${logicAdjective} AND ${emotionalAdjective}.`;

    console.log("[Multi-Agent] Agent 2: Applying Vibe Matrix + Style Inspiration", { x, y });

    let creatorContext = "";
    if (platformDna.extractedCreatorDNA) {
        creatorContext = `\nMANDATORY STRUCTURAL BLUEPRINT TO CLONE:\n${platformDna.extractedCreatorDNA}\nYou MUST strictly write exactly like the blueprint above.`;
    }

    // Style Inspiration injection — clones structural writing DNA, NOT ideas
    let styleInspirationContext = "";
    if (styleInspiration && styleInspiration.trim().length > 20) {
        styleInspirationContext = `
STYLE INSPIRATION — CLONE THE WRITING DNA (NOT THE IDEAS):
Analyze the following reference content from the user's chosen creator.
Extract and replicate ONLY these structural patterns:
1. Sentence length rhythm (short/long patterns and how they alternate)
2. Vocabulary register (casual/technical/raw/polished)
3. How they open sentences and paragraphs
4. Their punctuation habits
5. How they use line breaks and white space
6. Their energy level, confidence, and pacing

You MUST apply those patterns to your rewrite. Do NOT reuse their ideas or topics.
--- STYLE REFERENCE BEGIN ---
${styleInspiration.substring(0, 2000)}
--- STYLE REFERENCE END ---
`;
    }

    const agent2Prompt = `
        You are the Voice Cloner. Take the following Raw Architecture and rewrite it using this tone DNA:

        TONE DNA: ${promptTone}
        ${creatorContext}
        ${styleInspirationContext}

        RAW ARCHITECTURE:
        ${rawArchitecture}

        Rewrite it completely. Be extremely authentic. Do not sound like an AI.
    `;
    const styleRes = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: agent2Prompt
    });
    const styledDraft = styleRes.text || "";

    // ==========================================
    // AGENT 3: Elite Copywriter Auditor
    // Anti-Slop + Platform Formatter + Human Quality Shield
    // ==========================================
    const bannedWordsList = dna.bannedWords.length > 0 ? dna.bannedWords.join(", ") : "none";
    const platformRule = platformDna.rules || "";

    console.log("[Multi-Agent] Agent 3: Elite Copywriter Audit", { platform, bannedWordsList });

    const agent3Prompt = `
        You are the Final Auditor, Platform Formatter, and Elite Copywriter Shield Enforcer.
        Take the Styled Draft and output it formatted exactly into the requested JSON Schema.

        ${ELITE_COPYWRITER_SHIELD}

        ADDITIONAL BANNED WORDS (replace with simple human language if found): ${bannedWordsList}

        PLATFORM RULES (${platform.toUpperCase()}): ${platformRule}
        Enforce this platform restriction completely.

        STYLED DRAFT:
        ${styledDraft}

        Output strictly in the expected JSON Schema format.
    `;

    const finalRes = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: agent3Prompt,
        config: {
            responseSchema: finalSchema,
            responseMimeType: "application/json"
        }
    });

    console.log("[Multi-Agent] Pipeline Complete.");
    return finalRes.text || "{}";
};
