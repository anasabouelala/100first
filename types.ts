
export interface StrategyStep {
  id: string;
  title: string;
  description: string;
  impact: 'High' | 'Medium' | 'Low';
  effort: 'High' | 'Medium' | 'Low';
  channel: string;
  aiAngle?: string;            // 2026 — how AI accelerates this step
}

export interface LaunchPhase {
  phaseName: string;
  weekRange?: string;          // e.g. "Week 1-2"
  goal?: string;               // e.g. "First 10 design-partner users"
  successMetric?: string;      // e.g. "10 PoC convos booked"
  steps: StrategyStep[];
}

export interface NorthStarMetric {
  name: string;                // e.g. "Weekly Active Sessions"
  target: string;              // e.g. "200 by week 12"
  rationale: string;
}

export interface WedgeDoctrine {
  useCase: string;             // The smallest possible problem
  idealUser: string;           // The narrowest user
  whyNow: string;              // Why 2026 makes this possible
  expansionPath: string[];     // 3-4 steps from wedge to broader market
}

export interface GrowthLoop {
  name: string;                // e.g. "Content → SEO → Users"
  type: 'Content' | 'Network' | 'Product' | 'Community' | 'Data' | 'Sales';
  trigger: string;             // What kicks off one cycle
  action: string;              // What the user does
  output: string;              // What gets created
  reinvestment: string;        // How the output feeds the trigger again
  velocityWeeks: number;       // weeks until first compounding return
  leverage: 'High' | 'Medium' | 'Low';
}

export interface AINativeTactic {
  tactic: string;              // e.g. "Publish llm.txt with structured product info"
  category: 'GEO' | 'MCP' | 'Agent-Distribution' | 'AI-Directory' | 'Eval-as-Marketing' | 'API-First';
  rationale: string;
  impact: 'High' | 'Medium' | 'Low';
  timeframe: string;           // e.g. "Week 1" or "Month 2"
}

export interface First72Block {
  timeBlock: string;           // e.g. "Hour 0-3" or "Day 1, AM"
  action: string;
  channel: string;
  successMetric: string;
}

export interface AntiPattern {
  pattern: string;             // What founders still do that's broken
  whyItFails2026: string;
  instead: string;             // The 2026 alternative
}

export interface TrustLever {
  lever: string;               // e.g. "Open-source the core engine"
  mechanism: string;           // Why it builds trust now
  timeToInstall: string;       // e.g. "Week 1"
}

export interface LaunchRisk {
  risk: string;
  impact: 'High' | 'Medium' | 'Low';
  probability: 'High' | 'Medium' | 'Low';
  mitigation: string;
}

export interface FounderActivity {
  activity: string;            // e.g. "Daily writing on X / LinkedIn"
  hoursPerWeek: number;
  rationale: string;
}

// Clear-English summary of the whole plan in 5-7 short bullets
export interface PlanSummary {
  oneSentence: string;          // "Get your first 100 paying users in 12 weeks by..."
  bullets: string[];            // 5-7 plain-language bullets
}

// Customer journey funnel — how someone goes from "never heard of you" to "paying"
export interface JourneyStage {
  stage: string;                // "Never heard of you" | "Curious" | "Trying it" | "Paying"
  whatTheyThink: string;        // First-person thought
  yourMove: string;             // What YOU do at this stage
  channel: string;              // Where it happens
  example: string;              // Concrete real-world example
  typicalDays: number;          // Avg days at this stage
}

export interface StrategyPlan {
  productName: string;
  targetAudience: string;
  phases: LaunchPhase[];
  // 2026 AI-era additions
  summary?: PlanSummary;              // NEW — TL;DR at top
  customerJourney?: JourneyStage[];   // NEW — visual funnel
  northStarMetric?: NorthStarMetric;
  wedge?: WedgeDoctrine;
  growthLoops?: GrowthLoop[];
  aiNativeDiscovery?: AINativeTactic[];
  first72Hours?: First72Block[];
  antiPatterns?: AntiPattern[];
  trustLevers?: TrustLever[];
  risks?: LaunchRisk[];
  founderOperatingModel?: FounderActivity[];
  compoundingMoats?: string[]; // What gets harder for competitors to copy each week
  pricingThesis?: string;      // One-liner pricing recommendation for 2026
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
  TRIAGE = 'TRIAGE',
  ACCOUNT_FINDER = 'ACCOUNT_FINDER',
  FEED_WATCHER = 'FEED_WATCHER',
  CONTENT_PARAMETERS = 'CONTENT_PARAMETERS'
}

// =====================================================================
// ACCOUNT DISCOVERY ENGINE
// =====================================================================

export type DiscoveryPlatform = 'X' | 'LinkedIn' | 'Reddit';
export type DiscoveryMode = 'surgical' | 'volume' | 'deep';
export type AuthorityLevel = 'nano' | 'micro' | 'mid' | 'macro' | 'mega' | 'all';
export type AccountTier = 'S' | 'A' | 'B' | 'C';
export type MissionStatus = 'idle' | 'preparing' | 'scanning' | 'paused' | 'cooldown' | 'completed' | 'failed' | 'aborted';

// Engagement-bar preset. Maps to per-platform numeric thresholds inside
// the engine (ENGAGEMENT_THRESHOLDS) — see discovery_engine.js. The preset
// shape hides the asymmetry between platforms (50 likes on X is solid;
// 50 reactions on LinkedIn is OK; 50 upvotes in r/SaaS is great but
// trivial in r/AskReddit).
export type EngagementFloor = 'any' | 'some' | 'real' | 'viral';

// Time window for "posts within the last N days". null = no recency filter.
export type PostRecencyDays = 7 | 30 | 90 | null;

// Per-platform seed inputs. Strongest signal we have: hand-picked accounts
// the user already knows are good in their niche. Engine fans out from
// each seed via the engagement graph (repliers / reactors / commenters).
export interface DiscoverySeeds {
  X?: string[];        // list URLs (x.com/i/lists/<id>) or @handles
  LinkedIn?: string[]; // hashtags or /in/<handle> profile URLs
  Reddit?: string[];   // subreddit names (e.g. "r/SaaS" or just "SaaS")
}

// =====================================================================
// FEED WATCHER
// =====================================================================
// Activate per-platform inside the Account Finder. When enabled, the extension
// polls the user's HOME FEED on that platform on a user-defined timer, scrapes
// what's currently visible, and buffers it for the panel to score against
// `prompt` with Gemini. Posts that meet `minRelevancy` are promoted to the
// Posts Tracker (social_radar_history) with `relevancyScore` + `relevancyReason`
// attached. Author info comes ONLY from what is visible on the feed card itself
// — no profile visits.
export interface FeedWatcherConfig {
  enabled: { X: boolean; LinkedIn: boolean; Reddit: boolean };
  prompt: string;             // free-text: "what I'm looking for in my feed"
  minRelevancy: number;       // 0..100 — global threshold across all enabled platforms
  pollIntervalMinutes: number; // user-configured timer (e.g. 15)
  maxPostsPerSweep?: number;   // target posts to scrape & surface per sweep (1..100, default 50)
  // Engagement layer — the Feed Watcher behaves like a selective human: for the
  // best posts it DRAFTS a value-adding reply (or flags a repost) in the user's
  // voice and queues it for approval. NOTHING posts automatically.
  engagement?: {
    enabled?: boolean;       // default true — draft suggestions during sweeps
    maxPerSweep?: number;    // cap drafts per single sweep (default 3)
    maxPerDay?: number;      // rolling-24h ceiling (default 14 — "casual but frequent")
  };
  lastSweepAt?: string;        // ISO of last completed sweep (any platform)
  lastSweepFound?: number;     // count promoted to the Posts Tracker in the last sweep
  lastSweepDrafted?: number;   // engagement drafts queued in the last sweep
}

// Raw post item produced by the in-page home-feed scrapers, sitting in the
// buffer between scrape and AI scoring. Author fields ONLY include what we
// could read off the feed card (no profile fetch).
export interface FeedWatchPostRaw {
  uuid: string;                    // stable id (urn / status id) so dedup survives multi-sweep
  platform: DiscoveryPlatform;
  postUrl: string;                 // permalink (used by the Tracker as the canonical url)
  text: string;                    // post body text as visible on the card (trimmed)
  scrapedAt: string;               // ISO timestamp of the scrape
  postTimestamp?: number;          // epoch ms if the card exposed an "Xh ago" / datetime
  // Author provenance from the feed card only:
  author: {
    handle: string;
    displayName?: string;
    profileUrl: string;
    verified?: boolean;
    bylineSubtitle?: string;       // e.g. LinkedIn role headline shown under the actor name
    avatarUrl?: string;
  };
  cardEngagement?: {
    likes?: number; retweets?: number; replies?: number;  // X
    reactions?: number; comments?: number;                // LinkedIn
    upvotes?: number;                                     // Reddit
    total?: number;
  };
}

export interface DiscoveryFilters {
  platforms: DiscoveryPlatform[];
  keywords: string[];
  hashtags: string[];
  excludeKeywords: string[];

  // Engagement bar (Block 2 in the panel). engagementFloor is the headline
  // filter; postRecencyDays gates how far back we look; minEngagementRate
  // is the audience-engagement ratio filter (engagement / followers).
  engagementFloor: EngagementFloor;
  postRecencyDays: PostRecencyDays;
  minEngagementRate?: number;

  // Seeds (Block 3). Optional but high-leverage when supplied.
  seeds?: DiscoverySeeds;

  // Feed watcher (Block 5). Independent of a discovery mission — when enabled
  // for a platform, the extension polls that platform's HOME FEED on a timer.
  feedWatcher?: FeedWatcherConfig;

  // Audience refinement (Block 4 — collapsed by default).
  authorityLevel: AuthorityLevel;
  minFollowers?: number;
  maxFollowers?: number;
  language?: string;
  location?: string;
  industry?: string;
  verifiedOnly: boolean;
  excludeAlreadyTracked: boolean;

  // Deprecated. Kept optional so persisted missions don't break their type
  // contract — engine ignores it. Removed from the panel; use postRecencyDays.
  postingFrequency?: 'daily' | 'weekly' | 'any';
  recentActivityDays?: number;
}

export interface DiscoveredAccount {
  id: string;
  platform: DiscoveryPlatform;
  handle: string;
  url: string;
  displayName: string;
  bio?: string;
  avatar?: string;
  followers: number;
  following?: number;
  posts?: number;
  avgEngagement?: number;
  engagementRate?: number;
  verified: boolean;
  authorityScore: number;
  nicheMatch: number;
  finalScore: number;
  postingCadence?: string;
  topTopics?: string[];
  lastActive?: string;
  matchedSignals: string[];
  tier: AccountTier;
  crossPlatform?: boolean;
  discoveredAt: string;
  trackingStatus: 'untracked' | 'tracking' | 'dismissed';
  sampleHooks?: string[];
  // Verification lifecycle: 'preliminary' = score from search-card only;
  // 'verified' = post-profile-visit; 'incomplete' = visited but post data unreadable.
  // Absent = legacy entries that always went through full verification (treat as 'verified').
  // 'card-only' = X/LinkedIn author scored purely from post-card engagement,
  // no profile visit (the profile-free path); 'commenter-signal' = LinkedIn
  // account surfaced via deep-mode commenter expansion.
  verificationStatus?: 'preliminary' | 'verified' | 'incomplete' | 'card-only' | 'commenter-signal';
  // LinkedIn post signals (only populated after verification)
  recentPostCount?: number;            // posts in last 7d
  maturePostMedianEngagement?: number; // median (reactions+comments) on posts ≥3d old
  postsSeen?: number;                  // how many of this author's posts surfaced in the search (consistency signal)
  daysSinceLastPost?: number;
  filterMismatchReasons?: string[];    // why this account doesn't match filters (informational, not gating)

  // How this candidate was found. 'search' = keyword feed; 'post' = author of a
  // matched post; 'seed-expand' = graph-traversal from a user-provided seed;
  // 'commenter' = active commenter on top niche posts (deep mode).
  discoveredVia?: 'search' | 'seed-expand' | 'fallback' | 'post' | 'commenter';

  // Engagement read directly off the search-feed card (likes/RTs/reactions/
  // upvotes etc.). Populated at discovery time, BEFORE any profile visit,
  // so we can rank by real engagement during the cheap pass.
  cardEngagement?: {
    likes?: number;       // X
    retweets?: number;    // X
    replies?: number;     // X
    reactions?: number;   // LinkedIn
    upvotes?: number;     // Reddit
    comments?: number;    // LinkedIn / Reddit
    total?: number;       // sum used for sorting
  };

  // Subreddit-only: median engagement (ups + num_comments) on top posts
  // of the past week. The "is this community alive" signal — much better
  // than raw subscriber count for deciding where to engage.
  subredditWeeklyMedianEngagement?: number;

  // ── "Wow" KPIs — reframe vanity numbers (followers, engagement) into
  //    numbers the user can act on (their ICP, their time, their window). ──

  // Reachable Audience Score — how many people in YOUR ICP this account
  // can put in front of you per post. Roughly:
  //   followers × icpMatchRate% × engagementVisibility
  // Surfaced as a single big number on the row card.
  reachableAudience?: number;

  // ICP Match Rate — % of this account's recent commenters whose bios fit
  // the user's targetAudience. 0-100. When AI-supplied, comes with 2-3
  // sample handles for hover-proof.
  icpMatchRate?: number;
  icpMatchSamples?: string[];

  // Spotlight Window — median minutes from post-published until ~50% of
  // total engagement has been collected. After that window, replies are
  // largely invisible. Lower number = faster you must show up.
  spotlightWindowMin?: number;
}

export interface MissionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'stealth';
  message: string;
  platform?: DiscoveryPlatform;
}

export interface StealthState {
  actionsThisMinute: number;
  actionsThisSession: number;
  rateLimit: number;
  cooldownUntil?: number;
  detected: boolean;
  detectionReason?: string;
  nextActionInMs: number;
  sessionStartedAt: number;
  humanizedBehaviorScore: number;
  patternsDetected: string[];
}

export interface MissionProgress {
  currentPlatform?: DiscoveryPlatform;
  phase: string;
  candidatesScanned: number;
  profilesAnalyzed: number;
  matched: number;
  rejected: number;
  estimatedRemainingMs?: number;
  totalQueriesPlanned: number;
  queriesCompleted: number;
}

export interface DiscoveryMission {
  id: string;
  name: string;
  status: MissionStatus;
  mode: DiscoveryMode;
  filters: DiscoveryFilters;
  startedAt?: string;
  completedAt?: string;
  progress: MissionProgress;
  stealth: StealthState;
  logs: MissionLog[];
  results: DiscoveredAccount[];
  campaignId?: string;
}

export type DiscoveryCampaignStatus = 'active' | 'paused' | 'completed' | 'aborted';

export interface DiscoveryCampaign {
  id: string;
  name: string;
  mode: DiscoveryMode;
  filters: DiscoveryFilters;
  status: DiscoveryCampaignStatus;
  // Schedule
  intervalHours: number;     // tick frequency (e.g. 3 = every 3h)
  intervalJitter: number;    // ± random jitter in hours
  durationDays: number;      // total campaign length
  startedAt: string;
  endsAt: string;
  lastTickAt?: string;
  nextTickAt?: string;
  ticksCompleted: number;
  ticksFailed: number;
  // Aggregated state
  results: DiscoveredAccount[];
  totalCandidatesScanned: number;
  knownHandles: string[];    // dedupe across ticks
  // Diagnostics
  recentLogs: MissionLog[];  // last 50 across all ticks
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
  customParameters?: Record<string, string>;
  reconDepth?: 'surface' | 'engagement';
  campaignType?: 'intent' | 'pain' | 'growth' | 'engagement';
  funnelStage?: 'tofu' | 'mofu' | 'bofu' | 'all';
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

export interface PersonaRadar {
  priceSensitive: number;   // 0 = bargain hunter, 100 = premium buyer
  techSavvy: number;        // 0 = beginner, 100 = power user
  riskAverse: number;       // 0 = early adopter, 100 = risk averse
  collaborative: number;    // 0 = lone wolf, 100 = team-oriented
  pragmatic: number;        // 0 = trend-driven, 100 = pragmatic
  vocal: number;            // 0 = quiet, 100 = vocal/influencer
}

export interface PersonaSource {
  painIndex: number;        // which painPoints index this proves
  platform: string;         // 'Reddit' | 'Twitter' | 'HackerNews' | 'LinkedIn' | 'IndieHackers'
  snippet: string;          // short quote/excerpt from the source
  url: string;              // direct link to the source
}

// ─── B2B SaaS founder-grade persona data ──────────────────────────────
export interface PersonaCompanyProfile {
  industries: string[];          // e.g. ["B2B SaaS", "Vertical AI", "DevTools"]
  companySize: string;           // "50-200 employees" or "Solo founders" or "Mid-market 200-1000"
  stage: string;                 // "Pre-seed to Seed" or "Series A-B" or "Bootstrap profitable"
  arrRange: string;              // "$100K-$2M ARR" or "$10M-$50M ARR" or "Pre-revenue"
  techStackSignals: string[];    // ["HubSpot", "Stripe", "Linear", "Notion"]  → searchable on Crunchbase / BuiltWith
  estimatedTAM: string;          // "~18,000 companies in US + EU" — a number the founder can defend in a pitch
}

export type BuyerRoleType = 'Champion' | 'Economic Buyer' | 'End User' | 'Influencer' | 'Founder';
export type DecisionPower = 'Solo decision' | 'Strong recommender' | 'Committee member' | 'Final approver' | 'Blocker risk';

export interface PersonaBuyerRole {
  type: BuyerRoleType;
  decisionPower: DecisionPower;
  typicalBudget: string;         // "$500-$5K/mo discretionary"
  procurementFriction: string;   // "Self-serve under $200/mo, legal review over $5K/yr"
}

export interface PersonaTrigger {
  event: string;                 // "Just raised Series A"
  detectionSignal: string;       // "TechCrunch funding announcement, LinkedIn 'Excited to share' post"
  urgencyDays: number;           // 30 = founders should act within 30 days of detecting
}

export interface PersonaStackItem {
  tool: string;                  // "Mailchimp"
  rolePlayed: string;            // "Email automation"
  painWithIt: string;            // "Hits limit at 50K contacts, no behavior-based triggers"
  switchingFriction: 'Low' | 'Medium' | 'High';
}

export interface PersonaWateringHole {
  name: string;                  // "r/SaaS" or "Demand Curve Slack" or "MarketingOps Community"
  type: 'Subreddit' | 'Slack' | 'Discord' | 'Newsletter' | 'Podcast' | 'Conference' | 'Twitter' | 'LinkedIn group' | 'Forum';
  memberCount: string;           // "187K members" or "12K subscribers"
  activityLevel: string;         // "Posts daily" | "Lurks" | "Comments weekly"
  bestPostFormat: string;        // "Build-in-public threads with metrics"
  url?: string;
}

export interface PersonaOutreach {
  bestChannel: string;           // "LinkedIn DM, NOT cold email"
  worstChannel: string;          // "Cold email — 0.3% reply rate at this segment"
  bestTimeToReach: string;       // "Tue-Thu, 9-11am their timezone"
  openingAngle: string;          // "Reference their recent LinkedIn post about [trigger]. Lead with a metric you helped a similar company achieve."
  avgSalesCycleDays: number;     // 14 = self-serve, 60 = mid-market, 180+ = enterprise
}

export interface PersonaObjection {
  objection: string;             // "We're already locked in with [competitor]"
  counter: string;               // "Acknowledge the switching cost, offer migration credit + parallel run for 30 days"
}

export interface BuyerPersona {
  name: string;
  role: string;                  // Job title pattern, NOT niche label (e.g. "Head of Demand Gen")
  demographics: string;          // Years experience, location bias, reporting structure
  realWorldQuote?: string;
  painPoints: string[];
  goals: string[];
  whereTheyHangOut: string[];    // Legacy — kept for back-compat. Use wateringHoles for new UI.
  contentTheyConsume: string[];
  // Sprint 2
  personalityRadar?: PersonaRadar;
  painSources?: PersonaSource[];
  tagline?: string;
  avatarSeed?: string;
  // SaaS founder layer (Sprint 3)
  companyProfile?: PersonaCompanyProfile;
  buyerRole?: PersonaBuyerRole;
  triggerEvents?: PersonaTrigger[];
  currentStack?: PersonaStackItem[];
  wateringHoles?: PersonaWateringHole[];
  outreach?: PersonaOutreach;
  objections?: PersonaObjection[];
}

export interface BuyerPersonaAnalysis {
  marketOverview: string;
  personas: BuyerPersona[];
}
