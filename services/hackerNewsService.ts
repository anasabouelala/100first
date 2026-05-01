import { PHAnalysisResult, ForumFilters } from '../types';
import { evaluateHNOpportunities } from './geminiService';

export const fetchHackerNewsOpportunities = async (appDesc: string, category: string, filters?: ForumFilters): Promise<PHAnalysisResult | null> => {
    try {
        // 1. Fetch recent Hacker News comments mentioning the category/niche via Algolia
        const query = encodeURIComponent(category);
        const searchUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=comment&hitsPerPage=30`;

        const res = await fetch(searchUrl);
        const data = await res.json();

        if (data && data.hits && data.hits.length > 0) {
            const rawComments = data.hits.map((hit: any) => ({
                id: hit.objectID,
                author: hit.author,
                text: hit.comment_text,
                url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
                createdAt: hit.created_at,
                parentStoryTitle: hit.story_title,
                parentStoryUrl: `https://news.ycombinator.com/item?id=${hit.story_id}`
            }));

            // 2. Evaluate through Gemini to pick out Personas & Hot Leads
            if (rawComments.length > 0) {
                return await evaluateHNOpportunities(appDesc, category, rawComments, filters);
            }
        }
    } catch (e) {
        console.error("Error fetching Hacker News posts via Algolia", e);
    }

    return null;
};
