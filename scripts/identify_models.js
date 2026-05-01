import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error("Discovery Error:", data.error.message);
      return;
    }

    console.log("GENERATE_CONTENT COMPATIBLE MODELS:");
    data.models.forEach(m => {
      if (m.supportedGenerationMethods.includes('generateContent')) {
        const shortName = m.name.replace('models/', '');
        console.log(`- ${shortName} (${m.displayName})`);
      }
    });
  } catch (error) {
    console.error("Fetch Error:", error);
  }
}

listModels();
