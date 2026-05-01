import { GoogleGenAI } from "@google/genai";


const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function testGeminiSearch() {
    console.log("Testing Gemini Search for Product Hunt Discussions...");
    try {
        const prompt = `Search Google for "site:producthunt.com/discussions saas" and return the URLs of the top 3 results.`;
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            }
        });

        console.log("Response text:");
        console.log(response.text);

        // Also check the raw grounding chunks to see what Google Search actually returned
        if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
            console.log("\nGrounding Chunks (Actual Search Results):");
            response.candidates[0].groundingMetadata.groundingChunks.forEach(chunk => {
                if (chunk.web) {
                    console.log(`- ${chunk.web.title}: ${chunk.web.uri}`);
                }
            });
        } else {
            console.log("\nNo grounding chunks found.");
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

testGeminiSearch();
