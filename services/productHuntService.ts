import { ProductHuntPost, MarketOpportunity, PHAnalysisResult, PHRawDiscussion, ForumFilters } from '../types';
import { evaluatePHOpportunities } from './geminiService';
// @ts-ignore
import scrapedPHData from '../ph_discussions_dataset.json';

export const fetchProductHuntOpportunities = async (appDesc: string, category: string, filters?: ForumFilters): Promise<PHAnalysisResult | null> => {
  try {
    console.log("Loading perfectly scraped local ProductHunt data...");

    // We already have the 100% accurate data saved locally from our scraper!
    const searchData = scrapedPHData;

    return await evaluatePHOpportunities(appDesc, category, searchData, filters);
  } catch (error) {
    console.error("Error formatting local PH data:", error);
    return null;
  }
};
