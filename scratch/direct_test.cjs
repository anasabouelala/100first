const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    tools: [{ googleSearch: {} }] 
});

async function testSearch() {
    console.log("Testing direct Gemini Search...");
    const prompt = "What are the best times to post on Reddit for the Indie Hackers niche in 2024? Give me a timing heatmap.";
    
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log("SUCCESS!");
        console.log("Response:", text);
    } catch (error) {
        console.error("FAILED!");
        console.error(error);
    }
}

testSearch();
