// Mirror of the server's DashboardPayload (server/src/types.ts).
export interface TimePoint {
  date: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  isFuture?: boolean;
  displayCostUsd?: number | null;
  projectedBarCostUsd?: number | null;
  projectedCostUsd?: number | null;
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

export interface CostTypeBreakdown {
  costType: string;
  costUsd: number;
}

export interface ModelTimePoint {
  date: string;
  values: Record<string, number>; // model -> total tokens that day
  isFuture?: boolean;
}

// How the multi-series time charts are drawn.
export type ChartType = "area" | "bar";

// Time-series bucket size shown in charts.
export type Granularity = "daily" | "weekly" | "monthly";

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

export interface RoleBreakdown {
  roleId: string;
  name: string;
  userCount: number;
  totalTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
  costComparison?: MetricComparison;
}

export interface UserStats {
  userCount: number;
  avgTokens: number;
  maxTokens: number;
  topTokensUser: string | null;
  avgCostUsd: number;
  medianCostUsd?: number;
  maxCostUsd: number;
  topCostUser: string | null;
}

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

export interface ActivitySnapshot {
  date: string;
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
  cacheHitRate: number;
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

export interface SyncRunState {
  inProgress: boolean;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastError?: string;
}

export interface HistorySyncStatus {
  recentHistory: SyncRunState & {
    requestedDays: number;
    fetchedDays: number;
    concurrency: number;
    bounds?: {
      startingAt: string;
      endingAt: string;
    };
  };
  currentDay: SyncRunState & {
    intervalMs: number;
    lastSnapshotDate?: string;
  };
}

export interface HistorySyncSummary {
  healthy: boolean;
  inProgress: boolean;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  lastSnapshotDate?: string;
  warmupFetchedDays: number;
  warmupRequestedDays: number;
}

export interface ApiKeyHealth {
  envVar: string;
  configured: boolean;
  keyType: string;
  visibleScopes: string[];
  missingScopes: string[];
  lastCheckedAt: string;
  error?: string;
}

export interface HealthPayload {
  ok: boolean;
  source: DashboardSource;
  adminKeyConfigured: boolean;
  analyticsKeyConfigured: boolean;
  apiKeys: {
    admin: ApiKeyHealth;
    analytics: ApiKeyHealth;
  };
  persistenceEnabled: boolean;
  analysis: AnalysisHealth;
  historySyncSummary: HistorySyncSummary;
  historySync: HistorySyncStatus;
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

export interface DashboardPayload {
  source: DashboardSource;
  range: { startingAt: string; endingAt: string; bucketWidth: string };
  summary: DashboardSummary;
  warnings?: string[];
  timeseries: TimePoint[];
  byModel: ModelBreakdown[];
  modelTimeseries: ModelTimePoint[];
  modelKeys: string[];
  costByType: CostTypeBreakdown[];
  byUser?: UserBreakdown[];
  userStats?: UserStats;
  byProduct?: ProductBreakdown[];
  pluginUsage?: PluginUsageBreakdown[];
  skillUsage?: SkillUsageBreakdown[];
  connectorUsage?: ConnectorUsageBreakdown[];
  byGroup?: GroupBreakdown[];
  activity?: ActivitySnapshot;
  monthlyCostAnalysis?: MonthlyCostAnalysis;
  dataRefreshedAt?: string;
  generatedAt: string;
}
