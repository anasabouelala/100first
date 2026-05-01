
export interface StrategyStep {
  id: string;
  title: string;
  description: string;
  impact: 'High' | 'Medium' | 'Low';
  effort: 'High' | 'Medium' | 'Low';
  channel: string;
}

export interface LaunchPhase {
  phaseName: string;
  steps: StrategyStep[];
}

export interface StrategyPlan {
  productName: string;
  targetAudience: string;
  phases: LaunchPhase[];
}

export interface CompetitorData {
  name: string;
  url: string;
  tagline: string;
  similarityScore: number; // 0-100
  threatLevel: 'High' | 'Medium' | 'Low';
}

export interface ChannelMetric {
  name: string; // e.g. "Twitter", "Reddit /r/SaaS"
  kpi: string; // e.g. "12.5k Followers", "Top #3 of Month"
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  link?: string;
}

export interface LaunchEvent {
  timeframe: string; // e.g. "Month 1", "Launch Day"
  action: string; // "Launched on Product Hunt"
  result: string; // "Got 500 upvotes, ~200 signups"
  details?: string; // Richer context
}

export interface VideoContent {
  title: string;
  channelName: string;
  views: string; // e.g. "12K views"
  url: string;
  type: 'Review' | 'Interview' | 'Tutorial';
}

export interface CommunityBehavior {
  platform: string;
  persona: string; // e.g. "The Builder in Public"
  actionFrequency: string; // e.g. "Daily updates", "Weekly deep dives"
  engagementMetrics: string; // e.g. "~50 upvotes/post", "High comment ratio"
  tone: string; // e.g. "Humble", "Aggressive", "Data-driven"
  keyTactic: string; // e.g. "Uses salary transparency to get clicks"
}

export interface CompetitorDeepDive {
  summary: string;
  trafficSources: ChannelMetric[];
  first100UsersStrategy: LaunchEvent[];
  marketingHooks: string[]; // "No credit card required", "Open Source"
  weakness: string; // "Expensive", "Bad UI"
  // New Fields
  videoMentions: VideoContent[];
  founderQuote?: string; // Inspirational or strategic quote
  techStack?: string[]; // e.g. "Next.js", "Supabase"
  pricingModel?: string; // e.g. "Freemium ($10/mo)"
  communityBehaviors: CommunityBehavior[];
}

export interface RoastResult {
  score: number;
  roast: string;
  improvements: string[];
}

export interface DistributionChannel {
  name: string;
  url: string;
  type: 'Directory' | 'Community' | 'Social' | 'Newsletter' | 'Launchpad';
  category: 'Organic' | 'Ads'; // New field
  tier: 'Tier 1 (Viral)' | 'Tier 2 (Niche)' | 'Tier 3 (SEO)';
  reason: string;
  // Enhanced Data
  matchScore: number; // 0-100
  audienceSize: string; // e.g. "2.4M Members"
  engagementLevel: 'High' | 'Medium' | 'Low';
  cost: 'Free' | 'Paid' | 'Freemium';
  minEntryCost?: string; // New field for Ads
  avgCPC?: string; // New field for Ads
  successCase: string; // e.g. "Similar tool 'X' got 500 upvotes here"
  bestTime: string; // e.g. "Tuesday 9am EST"
  opportunityCount: number; // Estimated active weekly opportunities
}

export interface GrowthMetric {
  label: string; // e.g. "Avg CPC", "Viral Coeff", "Organic Reach"
  value: string; // e.g. "$1.50", "1.2", "15%"
  trend: 'Up' | 'Down' | 'Stable';
  context: string; // e.g. "High compared to FB"
}

export interface AlgorithmSecret {
  trigger: string; // e.g. "Dwell Time"
  tactic: string; // e.g. "Write long threads (10+ tweets)"
  impact: string; // "Boosts reach by 3x"
}

export interface ChannelAnalysis {
  summary: string;
  rules: string[]; 
  audienceVibe: string; 
  successfulPostTypes: string[]; 
  moderationStrictness: 'Low' | 'Medium' | 'High' | 'Brutal';
  verdict: string;
  saasKpis: GrowthMetric[];
  algorithmSecrets: AlgorithmSecret[];
  contentHooks: string[]; // Specific phrases/formats that convert
}

export interface GeneratedContent {
  subject: string;
  body: string;
  firstComment?: string;
  postingTips?: string[];
}

export interface OutreachMessage {
  angle: string; // e.g. "The Flattery", "The Problem Solver", "The Beta Invite"
  subject: string;
  body: string;
  whyItWorks: string;
}

export interface OutreachResponse {
  prospectAnalysis: string;
  messages: OutreachMessage[];
}

export interface SearchDork {
  label: string; // e.g. "Find complainers"
  query: string; // e.g. "site:reddit.com inurl:marketing 'hate it' after:2024-01-01"
  explanation: string;
}

export interface MarketOpportunity {
  type: 'Thread' | 'Comment' | 'Post'; // Removed 'Dork' - we only want real links now
  headline: string;
  url: string; // Must be a direct link to the content
  context: string; 
  relevanceScore: number;
}

export interface ReplyDraft {
  text: string;
  explanation: string;
  safetyCheck: string; // e.g. "Low Risk: Complies with 'No Link Spam' rule"
}

export interface IndustryBenchmark {
  metric: string; // e.g. "CAC", "Churn", "Conversion Rate"
  avgValue: string; // "15%"
  top10Value: string; // "35%"
  unit: string; // "%", "$"
  insight: string;
}

// Gemini Types helper
export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export enum AppMode {
  RECON = 'RECON',
  STRATEGY = 'STRATEGY',
  ROAST = 'ROAST',
  DISTRIBUTION = 'DISTRIBUTION',
  OUTREACH = 'OUTREACH',
  PERSONA = 'PERSONA',
  ICP_RECON = 'ICP_RECON',
  ANSWERLY_RADAR = 'ANSWERLY_RADAR',
  PIPELINE = 'PIPELINE',
  FORUM_LEADS = 'FORUM_LEADS',
  CONTENT_ENGINE = 'CONTENT_ENGINE',
  PLATFORM_INSIGHTS = 'PLATFORM_INSIGHTS',
  TRIAGE = 'TRIAGE'
}

export interface ICPReconCampaign {
  id: string;
  name: string;
  roles: string[];
  industries: string[];
  painPoints: string[];
  interests: string[];
  negativeKeywords: string[];
  platforms: string[];
  originalBrief?: string;
  lastRun?: string;
  queries?: ICPTrackingKeyword[];
  stats?: any;
}

export interface ICPTrackingKeyword {
  platform: string;
  query: string;
  intent: string;
  campaignId?: string;
  campaignName?: string;
}

export interface SmartComment {
  options: { body: string; why: string }[];
}

export interface LeadInteraction {
  type: 'comment' | 'like' | 'note';
  content?: string;
  timestamp: string;
}

export interface PipelineLead {
  id: string;
  name: string;
  title?: string; // Legacy fallback
  handle?: string;
  url: string;
  platform: string;
  avatar?: string;
  bio?: string;
  headline?: string;
  status: 'new' | 'engaging' | 'qualified' | 'converted';
  interactions: LeadInteraction[];
  notes?: string;
  postUrl?: string;
  postText?: string;
  why?: string;
  relevance?: number;
  
  // V5 Intelligence Fields
  intelligenceScore?: number;
  intelligenceTier?: 'Buy Now' | 'Warm Opportunity' | 'Nurture';
  intelligenceSignals?: string[];
  intelligencePipeline?: Array<{ step: string; status: 'pass' | 'fail' | 'blocked' | 'neutral' | 'weak' | 'none'; detail: string }>;
  detectedNeed?: string;
  detectedPain?: string;
  whyNowReasoning?: string;
  bestOutreachAngle?: string;
  authorityLevel?: string;
  companyQuality?: string;

  timestamp?: string;
  scannedAt?: string;
  campaignId?: string;
  campaignName?: string;
  intent?: string;
}

export interface ForumOpportunity {
  id: string;
  source: 'HackerNews' | 'Reddit' | 'ProductHunt';
  title: string;
  url: string;
  content: string;
  author: string;
  engagement: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  relevanceScore: number;
  reason: string;
  timestamp: string;
}

export interface PlatformInsight {
  platform: string;
  trend: string;
  intensity: number;
  opportunities: string[];
  threats: string[];
}

export interface ContentEnginePost {
  title: string;
  hook: string;
  body: string;
  imagePrompt?: string;
  tags: string[];
}

export interface BuyerPersona {
  name: string;
  role: string;
  demographics: string;
  realWorldQuote?: string;
  painPoints: string[];
  goals: string[];
  whereTheyHangOut: string[];
  contentTheyConsume: string[];
}

export interface BuyerPersonaAnalysis {
  marketOverview: string;
  personas: BuyerPersona[];
}
