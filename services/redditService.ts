import { PHAnalysisResult, ForumFilters } from '../types';
import { evaluateRedditOpportunities } from './geminiService';

export const fetchRedditOpportunities = async (appDesc: string, category: string, filters?: ForumFilters): Promise<PHAnalysisResult | null> => {
    try {
        const TAVILY_API_KEY = "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";
        const query = `site:reddit.com ${category}`;

        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                api_key: TAVILY_API_KEY,
                query: query,
                search_depth: "advanced",
                max_results: 15
            })
        });

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            console.warn("No results from Tavily Search (Reddit).");
            return null;
        }

        const searchData = data.results.map((res: any) => ({
            title: res.title,
            url: res.url,
            content: res.content
        }));

        return await evaluateRedditOpportunities(appDesc, category, searchData, filters);

    } catch (error) {
        console.error("Error fetching Reddit via Tavily Search:", error);
        return null;
    }
};
