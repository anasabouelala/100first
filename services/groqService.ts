
import { ICPReconCampaign } from "../types";

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

export const filterProfilesWithAI = async (
  profiles: any[],
  campaign: ICPReconCampaign
): Promise<{ validProfiles: any[] }> => {
  if (!GROQ_API_KEY) {
    console.error("GROQ_API_KEY is missing!");
    return { validProfiles: [] };
  }

  // Llama-3-70b is excellent for logic and classification
  const model = "llama3-70b-8192";

  const prompt = `
    Analyze these social media profiles for the campaign: "${campaign.name}".
    
    TARGET ICP:
    - Roles: ${campaign.roles.join(', ')}
    - Industries: ${campaign.industries.join(', ')}
    - Pain Points: ${campaign.painPoints.join(', ')}
    
    AUDIT LIST:
    ${JSON.stringify(profiles.map(p => ({
      handle: p.handle,
      name: p.name,
      bio: p.bio,
      followers: p.followers
    })), null, 2)}

    TASK:
    Identify all profiles that are likely business owners, founders, product builders, or key decision makers.
    Distinguish between professionals (service providers like Dentists) and consumers (Patients).
    
    IDENTIFICATION RULES:
    1. A "Founder/Professional" can be described as: "CEO", "Owner", "Builder", "Maker", "Founder of [site]", "Building [site]", "Founder @ [site]", "Founder @ [X]", "Entrepreneur", "Solopreneur", "Indie Hacker", "Professional [Role]".
    2. If their bio contains a link to a specific product, project, or company website, they are almost certainly a founder/owner.
    3. If they describe a professional role in or related to the target industries (${campaign.industries.join(', ')}), they are a match.
    4. **IF IN DOUBT, MARK AS TARGET.** We want to see everyone who might be relevant. It is better to have 10 extra "maybe" leads than to miss 1 real founder.
    
    Return a JSON object with a "validProfiles" array. 
    Each object must have:
    - handle: The unique handle.
    - relevanceScore: 0-100 (Give at least 60 if they show ANY sign of building or owning a business).
    - reasoning: Very brief explanation (e.g., "Has link to SaaS in bio").
    - isTarget: Boolean (True if Score >= 50).
    
    Example Output:
    {
      "validProfiles": [
        { "handle": "johndoe", "relevanceScore": 85, "reasoning": "SaaS founder in bio", "isTarget": true }
      ]
    }
  `;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are an elite lead generation specialist. You filter out the noise and find the gold in social data. Always respond in valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) throw new Error("No filtering response from Groq");
    return JSON.parse(content);
  } catch (error) {
    console.error("Groq AI Filtering Error:", error);
    return { validProfiles: [] };
  }
};
