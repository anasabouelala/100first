import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function testGeminiSearchJson() {
    console.log("Testing Gemini Search with JSON response via prompt...");
    try {
        const prompt = `
      Search Google for "site:producthunt.com/discussions saas" and find 2 recent forum threads.
      
      Return the result STRICTLY as a JSON array of objects, with no markdown formatting.
      Each object must have "url" and "headline" fields.
      Example:
      [
        {"url": "https://www.producthunt.com/discussions/123", "headline": "Example"}
      ]
      
      Do not include \`\`\`json tags. Only raw JSON.
    `;
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
                // Intentionally omitting responseMimeType and responseSchema to avoid the 400 error!
            }
        });

        console.log("Response text:");
        console.log(response.text);

        try {
            const parsed = JSON.parse(response.text.trim());
            console.log("Parsed JSON successfully:", parsed);
        } catch (e) {
            console.error("Failed to parse JSON:", e);
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

testGeminiSearchJson();
