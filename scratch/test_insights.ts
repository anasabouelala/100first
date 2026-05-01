import { getPlatformInsights } from './services/geminiService.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    console.log("Testing Platform Intelligence (Gemini Search)...");
    try {
        const insights = await getPlatformInsights(
            "Reddit", 
            "Indie Hackers", 
            "A platform that helps founders find leads on social media using AI."
        );
        console.log("SUCCESS! Received insights:");
        console.log(JSON.stringify(insights, null, 2));
    } catch (error) {
        console.error("FAILED!");
        console.error(error);
    }
}

test();
