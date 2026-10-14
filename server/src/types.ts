// ── Raw Anthropic Admin API shapes ───────────────────────────────────────────
// Mirrors the documented response of:
//   GET /v1/organizations/usage_report/messages
//   GET /v1/organizations/cost_report

export interface CacheCreation {
  ephemeral_1h_input_tokens: number;
  ephemeral_5m_input_tokens: number;
}

export interface UsageResult {
  account_id: string | null;
  api_key_id: string | null;
  cache_creation: CacheCreation;
  cache_read_input_tokens: number;
  context_window: "0-200k" | "200k-1M" | null;
  inference_geo: string | null;
  model: string | null;
  output_tokens: number;
  server_tool_use: { web_search_requests: number };
  service_account_id: string | null;
  service_tier: string | null;
  uncached_input_tokens: number;
  workspace_id: string | null;
}

export interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: UsageResult[];
}

export interface UsageReport {
  data: UsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

export interface CostResult {
  amount: string; // decimal string in lowest currency units (cents)
  context_window: "0-200k" | "200k-1M" | null;
  cost_type: "tokens" | "web_search" | "code_execution" | "session_usage" | null;
  currency: string;
  description: string | null;
  inference_geo: string | null;
  model: string | null;
  service_tier: string | null;
  token_type: string | null;
  workspace_id: string | null;
}

export interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: CostResult[];
}

export interface CostReport {
  data: CostBucket[];
  has_more: boolean;
  next_page: string | null;
}

// ── Raw Claude.ai Enterprise Analytics API shapes ────────────────────────────
// Mirrors the documented response of (Authorization: Bearer <analytics key>):
//   GET /v1/organizations/analytics/usage_report
//   GET /v1/organizations/analytics/cost_report
//   GET /v1/organizations/analytics/user_usage_report
//   GET /v1/organizations/analytics/user_cost_report
//   GET /v1/organizations/analytics/summaries
// Docs: https://platform.claude.com/docs/en/api/admin/analytics

export interface AnalyticsUserActor {
  user_id: string;
  email: string | null;
  name: string | null;
  deleted?: boolean;
  type?: "user_actor";
}

// Token usage row — shared by usage_report buckets and user_usage_report rows.
export interface AnalyticsUsageResult {
  cache_creation: CacheCreation;
  cache_read_input_tokens: number;
  uncached_input_tokens: number;
  output_tokens: number;
  requests: number;
  server_tool_use: { web_search_requests: number };
  context_window: "0-200k" | "200k-1M" | null;
  inference_geo: string | null;
  model: string | null;
  product: string | null;
  speed: string | null;
}

export interface AnalyticsUsageBucket {
  starting_at: string;
  ending_at: string;
  results: AnalyticsUsageResult[];
}

export interface AnalyticsUsageReport {
  data: AnalyticsUsageBucket[];
  has_more: boolean;
  next_page: string | null;
  organization_id: string;
  data_refreshed_at: string;
}

export interface AnalyticsUserUsageRow extends AnalyticsUsageResult {
  actor: AnalyticsUserActor;
  total_tokens: number;
  starting_at: string;
  ending_at: string;
}

export interface AnalyticsUserUsageReport {
  data: AnalyticsUserUsageRow[];
  has_more: boolean;
  next_page: string | null;
  organization_id: string;
  data_refreshed_at: string;
}

// Cost row — amount is a decimal string in fractional cents (divide by 100 → USD).
export interface AnalyticsCostResult {
  amount: string;
  list_amount: string;
  currency: "USD";
  cost_type: "tokens" | "web_search" | "code_execution" | null;
  token_type: string | null;
  context_window: "0-200k" | "200k-1M" | null;
  inference_geo: string | null;
  model: string | null;
  product: string | null;
  speed: string | null;
  requests: number | null;
}

export interface AnalyticsCostBucket {
  starting_at: string;
  ending_at: string;
  results: AnalyticsCostResult[];
}

export interface AnalyticsCostReport {
  data: AnalyticsCostBucket[];
  has_more: boolean;
  next_page: string | null;
  organization_id: string;
  data_refreshed_at: string;
}

export interface AnalyticsUserCostRow {
  actor: AnalyticsUserActor;
  amount: string;
  list_amount: string;
  currency: "USD";
  cost_type: "tokens" | "web_search" | "code_execution" | null;
  token_type: string | null;
  model: string | null;
  product: string | null;
  starting_at: string;
  ending_at: string;
  requests: number | null;
}

export interface AnalyticsUserCostReport {
  data: AnalyticsUserCostRow[];
  has_more: boolean;
  next_page: string | null;
  organization_id: string;
  data_refreshed_at: string;
}

export interface AnalyticsSummary {
  starting_at: string;
  ending_at: string;
  assigned_seat_count: number;
  pending_invite_count: number;
  daily_active_user_count: number;
  weekly_active_user_count: number;
  monthly_active_user_count: number;
  daily_adoption_rate: number;
  weekly_adoption_rate: number;
  monthly_adoption_rate: number;
}

export interface AnalyticsSummariesReport {
  summaries: AnalyticsSummary[];
}

export interface AnalyticsPluginUsageMetrics {
  distinct_session_plugin_used_count: number | null;
}

export interface AnalyticsPluginUsageRow {
  plugin_name: string;
  plugin_id?: string | null;
  distinct_user_count: number;
  install_count: number | null;
  invocation_count: number;
  claude_code_metrics?: AnalyticsPluginUsageMetrics;
  cowork_metrics?: AnalyticsPluginUsageMetrics;
}

export interface AnalyticsPluginUsageReport {
  data: AnalyticsPluginUsageRow[];
  next_page: string | null;
}

export interface AnalyticsSkillUsageMetrics {
  distinct_conversation_skill_used_count?: number | null;
  distinct_session_skill_used_count?: number | null;
}

export interface AnalyticsSkillUsageRow {
  skill_name: string;
  skill_display_name?: string | null;
  distinct_user_count: number;
  invocation_count?: number | null;
  enable_count?: number | null;
  estimated_overage_spend?: string | null;
  attributed_list_price?: string | null;
  currency?: "USD" | null;
  chat_metrics?: AnalyticsSkillUsageMetrics;
  claude_code_metrics?: AnalyticsSkillUsageMetrics;
  cowork_metrics?: AnalyticsSkillUsageMetrics;
}

export interface AnalyticsSkillUsageReport {
  data: AnalyticsSkillUsageRow[];
  next_page: string | null;
}

export interface AnalyticsConnectorUsageMetrics {
  distinct_conversation_connector_used_count?: number | null;
  distinct_session_connector_used_count?: number | null;
}

export interface AnalyticsConnectorUsageRow {
  connector_name: string;
  connector_display_name?: string | null;
  distinct_user_count: number;
  read_call_count?: number | null;
  write_call_count?: number | null;
  unclassified_call_count?: number | null;
  managed_auth_distinct_user_count?: number | null;
  individual_auth_distinct_user_count?: number | null;
  chat_metrics?: AnalyticsConnectorUsageMetrics;
  claude_code_metrics?: AnalyticsConnectorUsageMetrics;
  cowork_metrics?: AnalyticsConnectorUsageMetrics;
}

export interface AnalyticsConnectorUsageReport {
  data: AnalyticsConnectorUsageRow[];
  next_page: string | null;
}

// ── Aggregated dashboard payload (what the frontend consumes) ─────────────────

export interface TimePoint {
  date: string; // YYYY-MM-DD
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ModelBreakdown {
  model: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costComparison?: MetricComparison;
}

// Per-day total tokens split by model (for the stacked "by model over time" chart).
export interface ModelTimePoint {
  date: string; // YYYY-MM-DD
  values: Record<string, number>; // model -> total tokens that day
}

export interface CostTypeBreakdown {
  costType: string;
  costUsd: number;
}

// Per-user (seat) breakdown — Analytics API only.
export interface MetricComparison {
  previousValue: number;
  deltaValue: number;
  deltaPercent: number;
  direction: "up" | "down" | "same";
  label: string;
}

export interface UserGroupMembership {
  groupId: string;
  name: string;
  roleNames?: string[];
}

export interface UserRoleAssignment {
  roleId: string;
  name: string;
}

export interface UserBreakdown {
  userId: string;
  name: string;
  email: string | null;
  deleted: boolean;
  groups?: UserGroupMembership[];
  effectiveRoles?: UserRoleAssignment[];
  uncachedInputTokens?: number;
  cacheReadTokens?: number;
  cacheHitRate?: number;
  totalTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
  totalTokensComparison?: MetricComparison;
  costComparison?: MetricComparison;
}

// Per-group breakdown — requires both Analytics key (for per-user data) and
// Admin key (to fetch group memberships from /v1/organizations/rbac_groups).
export interface GroupBreakdown {
  groupId: string;
  name: string;
  roleNames?: string[];
  memberCount: number;
  totalTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
  costComparison?: MetricComparison;
}

// Average / maximum usage across active users — Analytics API only.
export interface UserStats {
  userCount: number;
  avgTokens: number;
  maxTokens: number;
  topTokensUser: string | null;
  avgCostUsd: number;
  medianCostUsd: number;
  maxCostUsd: number;
  topCostUser: string | null;
}

// Per-product (chat / claude_code / cowork / …) breakdown — Analytics API only.
export interface ProductBreakdown {
  product: string;
  totalTokens: number;
  costUsd: number;
  costComparison?: MetricComparison;
}

export interface PluginUsageBreakdown {
  pluginName: string;
  pluginId: string | null;
  distinctUserCount: number;
  installCount: number | null;
  invocationCount: number;
  claudeCodeSessionCount: number | null;
  coworkSessionCount: number | null;
}

export interface SkillUsageBreakdown {
  skillName: string;
  displayName: string | null;
  distinctUserCount: number;
  invocationCount: number | null;
  enableCount: number | null;
  estimatedOverageSpendUsd: number | null;
  attributedListPriceUsd: number | null;
  chatConversationCount: number | null;
  claudeCodeSessionCount: number | null;
  coworkSessionCount: number | null;
}

export interface ConnectorUsageBreakdown {
  connectorName: string;
  displayName: string | null;
  distinctUserCount: number;
  readCallCount: number | null;
  writeCallCount: number | null;
  unclassifiedCallCount: number | null;
  managedAuthDistinctUserCount: number | null;
  individualAuthDistinctUserCount: number | null;
  chatConversationCount: number | null;
  claudeCodeSessionCount: number | null;
  coworkSessionCount: number | null;
}

// Organization activity snapshot (most recent finalized day) — Analytics API only.
export interface ActivitySnapshot {
  date: string; // YYYY-MM-DD of the snapshot
  assignedSeats: number;
  pendingInvites: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  dailyAdoptionRate: number;
  weeklyAdoptionRate: number;
  monthlyAdoptionRate: number;
  comparisons?: {
    assignedSeats?: MetricComparison;
    dailyActiveUsers?: MetricComparison;
    weeklyActiveUsers?: MetricComparison;
    monthlyActiveUsers?: MetricComparison;
  };
}

export interface MetricComparison {
  previousValue: number;
  deltaValue: number;
  deltaPercent: number;
  direction: "up" | "down" | "same";
  label: string;
}

export interface DashboardSummary {
  totalCostUsd: number;
  totalTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  cacheHitRate: number; // cache_read / (cache_read + uncached_input)
  comparisons?: {
    totalCostUsd?: MetricComparison;
    totalTokens?: MetricComparison;
    outputTokens?: MetricComparison;
    cacheHitRate?: MetricComparison;
    webSearchRequests?: MetricComparison;
  };
}

export type DashboardSource = "analytics" | "admin" | "mock";

export interface AnalysisHealth {
  configured: boolean;
  baseUrl: string;
  model: string;
  reachable: boolean;
  modelAvailable: boolean;
  lastCheckedAt: string;
  error?: string;
}

export interface MonthlyCostAnalysisDriver {
  title: string;
  detail: string;
}

export interface MonthlyCostAnalysis {
  status: "ready" | "unavailable";
  headline: string;
  summary: string;
  primaryDrivers: MonthlyCostAnalysisDriver[];
  secondarySignals: MonthlyCostAnalysisDriver[];
  nonMaterialFactors: MonthlyCostAnalysisDriver[];
  caveats?: string[];
  generatedAt: string;
}

export const DASHBOARD_SNAPSHOT_VERSION = 2;

export interface DashboardPayload {
  snapshotVersion?: number;
  source: DashboardSource;
  range: { startingAt: string; endingAt: string; bucketWidth: string };
  summary: DashboardSummary;
  warnings?: string[];
  timeseries: TimePoint[];
  byModel: ModelBreakdown[];
  modelTimeseries: ModelTimePoint[]; // per-day tokens split by model
  modelKeys: string[]; // model names present, ranked by total tokens
  costByType: CostTypeBreakdown[];
  // Analytics-only sections (omitted for the Admin API, which can't attribute usage to users).
  byUser?: UserBreakdown[];
  userStats?: UserStats;
  byProduct?: ProductBreakdown[];
  pluginUsage?: PluginUsageBreakdown[];
  skillUsage?: SkillUsageBreakdown[];
  connectorUsage?: ConnectorUsageBreakdown[];
  byGroup?: GroupBreakdown[];
  activity?: ActivitySnapshot;
  monthlyCostAnalysis?: MonthlyCostAnalysis;
  dataRefreshedAt?: string; // Analytics watermark — data beyond this is incomplete.
  generatedAt: string;
}
