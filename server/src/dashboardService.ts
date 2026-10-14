import { getCostBuckets as getAdminCostBuckets, getUsageBuckets as getAdminUsageBuckets } from "./anthropicAdmin.js";
import {
  getConnectorUsage,
  getCostBuckets as getAnalyticsCostBuckets,
  getPluginUsage,
  getSkillUsage,
  getSummaries,
  getUsageBuckets as getAnalyticsUsageBuckets,
  getUserCost,
  getUserUsage,
  type AnalyticsRange,
} from "./anthropicAnalytics.js";
import { buildDashboard } from "./aggregate.js";
import { buildAnalyticsComparisonSnapshot, buildAnalyticsDashboard, type AnalyticsInputs } from "./aggregateAnalytics.js";
import { loadGroupConfig } from "./groupConfig.js";
import { config } from "./config.js";
import { filterMockForGroup, filterMockForUser, generateMockData, generateMockExtras } from "./mock.js";
import {
  isPersistenceEnabled,
  loadDailyDashboardSnapshots,
  loadDashboardSnapshot,
  loadDashboardSnapshotForRange,
  persistDashboardSnapshot,
} from "./postgres.js";
import { composePersistedDashboard } from "./persistedDashboard.js";
import { maybeBuildMonthlyCostAnalysis, streamMonthlyCostAnalysis, type MonthlyCostAnalysisStreamHandlers } from "./monthlyCostAnalysis.js";
import { DASHBOARD_SNAPSHOT_VERSION } from "./types.js";
import type {
  AnalyticsConnectorUsageRow,
  AnalyticsPluginUsageRow,
  AnalyticsSkillUsageRow,
  ConnectorUsageBreakdown,
  DashboardPayload,
  MetricComparison,
  MonthlyCostAnalysis,
  PluginUsageBreakdown,
  SkillUsageBreakdown,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Analytics data only exists on or after this date.
const ANALYTICS_MIN_MS = Date.UTC(2026, 0, 1);
// Engagement summaries are finalized with a ~2–3 day lag.
const SUMMARY_LAG_MS = 2 * DAY_MS;
export const RECENT_HISTORY_DAYS = 180;
export const CURRENT_DAY_REFRESH_MS = HOUR_MS;
const HISTORY_WARMUP_CONCURRENCY = config.historyWarmupConcurrency;

const daySpan = (bounds: Bounds): number =>
  Math.max(1, Math.round((new Date(bounds.endingAt).getTime() - new Date(bounds.startingAt).getTime()) / DAY_MS));

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const currentUtcNow = (): Date => {
  const now = new Date();
  if (!config.useMock) return now;

  const overrideDay = config.mockCurrentDayOfMonth;
  if (overrideDay == null) return now;

  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  if (overrideDay > daysInMonth) return now;

  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    overrideDay,
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  ));
};

const currentUtcDayStart = (): number => {
  const now = currentUtcNow();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const latestAnalyticsDayStart = (): number => currentUtcDayStart() - SUMMARY_LAG_MS;

const isOngoingRange = (bounds: Bounds): boolean => {
  const todayStart = currentUtcDayStart();
  return new Date(bounds.endingAt).getTime() > todayStart;
};

function takeContiguousDailySnapshots(rows: DashboardPayload[], bounds: Bounds): DashboardPayload[] {
  const contiguous: DashboardPayload[] = [];
  let expectedDate = bounds.startingAt.slice(0, 10);

  for (const row of rows) {
    const rowDate = row.range.startingAt.slice(0, 10);
    if (rowDate !== expectedDate) break;
    contiguous.push(row);
    expectedDate = isoDay(Date.parse(`${rowDate}T00:00:00.000Z`) + DAY_MS);
  }

  return contiguous;
}

function takeLatestContiguousDailySnapshots(rows: DashboardPayload[], bounds: Bounds): DashboardPayload[] {
  const contiguous: DashboardPayload[] = [];
  let expectedEndingAt = bounds.endingAt;

  for (const row of [...rows].sort((left, right) => right.range.startingAt.localeCompare(left.range.startingAt))) {
    if (row.range.endingAt !== expectedEndingAt) break;
    contiguous.unshift(row);
    expectedEndingAt = row.range.startingAt;
  }

  return contiguous;
}

interface Bounds {
  startingAt: string; // ISO, inclusive
  endingAt: string; // ISO, exclusive
}

interface SnapshotKey {
  requestKey: string;
  userId?: string;
}

interface DashboardScope {
  userId?: string;
  groupId?: string;
}

interface SyncRunState {
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
    bounds?: Bounds;
  };
  currentDay: SyncRunState & {
    intervalMs: number;
    lastSnapshotDate?: string;
  };
}

interface AnalyticsFetchOptions {
  includeUsageByModel?: boolean;
  includeUsageByProduct?: boolean;
  includeCostByModel?: boolean;
  includeCostByProduct?: boolean;
  includeCostByType?: boolean;
  includeUserUsage?: boolean;
  includeUserCost?: boolean;
  includeSummaries?: boolean;
  includeGroupConfig?: boolean;
  sequentialWindows?: boolean;
  sequentialReports?: boolean;
}

interface DashboardFetchOptions {
  analytics?: Pick<AnalyticsFetchOptions, "sequentialWindows" | "sequentialReports">;
}

const iso = (startMs: number, endMs: number): Bounds => ({
  startingAt: new Date(startMs).toISOString(),
  endingAt: new Date(endMs).toISOString(),
});

const emptyAnalyticsInputs = (): AnalyticsInputs => ({
  usageByModel: [],
  usageByProduct: [],
  costByModel: [],
  costByProduct: [],
  costByTypeBuckets: [],
  userUsage: [],
  userCost: [],
  summaries: [],
  groupConfig: [],
});

const buildMetricComparison = (currentValue: number, previousValue: number): MetricComparison => {
  const deltaValue = currentValue - previousValue;
  const deltaPercent = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : (deltaValue / previousValue) * 100;
  const direction: MetricComparison["direction"] = deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "same";
  return {
    previousValue,
    deltaValue,
    deltaPercent,
    direction,
    label: "the previous period",
  };
};

const withSnapshotVersion = (payload: DashboardPayload): DashboardPayload => ({
  ...payload,
  snapshotVersion: DASHBOARD_SNAPSHOT_VERSION,
});

/**
 * Split a date window into contiguous, non-overlapping sub-ranges of at most
 * `maxDays` each. The Analytics usage/cost endpoints cap a single request at a
 * 31-day span, so longer ranges (e.g. "last 3 months") must be fetched in
 * chunks and merged. Day-aligned bounds keep each daily bucket in exactly one
 * chunk, so the aggregator (which sums per day/user) double-counts nothing.
 */
function splitRange(startingAt: string, endingAt: string, maxDays = 31): AnalyticsRange[] {
  const end = new Date(endingAt).getTime();
  const span = maxDays * DAY_MS;
  const windows: AnalyticsRange[] = [];
  let s = new Date(startingAt).getTime();
  while (s < end) {
    const e = Math.min(s + span, end);
    windows.push({ startingAt: new Date(s).toISOString(), endingAt: new Date(e).toISOString() });
    s = e;
  }
  return windows.length ? windows : [{ startingAt, endingAt }];
}

/**
 * Resolve a period token to a UTC date window.
 *   today | this_month | last_month | "<N>d" (trailing N days, default 7)
 * Windows longer than the usage/cost API's 31-day cap (e.g. "90d") are chunked
 * at fetch time. Trailing "<N>d" is clamped to 366 days (the Analytics floor is
 * 2026-01-01, also enforced downstream).
 */
function periodBounds(period: string): Bounds {
  const now = currentUtcNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const todayStart = Date.UTC(y, m, d);
  const tomorrow = todayStart + DAY_MS; // exclusive end that includes today

  switch (period) {
    case "today":
      return iso(todayStart, tomorrow);
    case "this_month":
      return iso(Date.UTC(y, m, 1), tomorrow);
    case "last_month":
      return iso(Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1));
    default: {
      const match = /^(\d+)d$/.exec(period);
      const days = Math.min(Math.max(match ? Number(match[1]) : 7, 1), 366);
      return iso(todayStart - (days - 1) * DAY_MS, tomorrow);
    }
  }
}

function previousBounds(period: string, current: Bounds): Bounds | undefined {
  const now = currentUtcNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const todayStart = Date.UTC(y, m, d);
  const nextMonthStart = Date.UTC(y, m + 1, 1);

  switch (period) {
    case "today":
      return iso(todayStart - DAY_MS, todayStart);
    case "this_month": {
      const previousMonthStart = Date.UTC(y, m - 1, 1);
      if (new Date(current.endingAt).getTime() >= nextMonthStart) {
        return iso(previousMonthStart, Date.UTC(y, m, 1));
      }
      const currentStart = new Date(current.startingAt).getTime();
      const currentEnd = new Date(current.endingAt).getTime();
      const elapsed = Math.max(currentEnd - currentStart, DAY_MS);
      return iso(previousMonthStart, Math.min(previousMonthStart + elapsed, Date.UTC(y, m, 1)));
    }
    case "last_month":
      return iso(Date.UTC(y, m - 2, 1), Date.UTC(y, m - 1, 1));
    default: {
      const match = /^(\d+)d$/.exec(period);
      const days = Math.min(Math.max(match ? Number(match[1]) : 7, 1), 366);
      const currentStart = new Date(current.startingAt).getTime();
      return iso(currentStart - days * DAY_MS, currentStart);
    }
  }
}

/** Run a non-critical call, swallowing errors so optional reports can't blank the dashboard. */
async function safe<T>(p: Promise<T>, fallback: T, label = "optional", warnings?: string[]): Promise<T> {
  try {
    return await p;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (warnings) warnings.push(message);
    console.warn(`[${label}] optional report failed:`, message);
    return fallback;
  }
}

function clampAnalyticsRange(bounds: Bounds | undefined): AnalyticsRange | undefined {
  if (!bounds) return undefined;
  const startingMs = Math.max(new Date(bounds.startingAt).getTime(), ANALYTICS_MIN_MS);
  const endingMs = new Date(bounds.endingAt).getTime();
  if (!Number.isFinite(startingMs) || !Number.isFinite(endingMs) || startingMs >= endingMs) return undefined;
  return {
    startingAt: new Date(startingMs).toISOString(),
    endingAt: bounds.endingAt,
  };
}

function clampAnalyticsUsageViewRange(bounds: Bounds | undefined): { startingDate: string; endingDate?: string } | undefined {
  if (!bounds) return undefined;
  const startingMs = Math.max(new Date(bounds.startingAt).getTime(), ANALYTICS_MIN_MS);
  const endingMs = Math.min(new Date(bounds.endingAt).getTime(), latestAnalyticsDayStart());
  if (!Number.isFinite(startingMs) || !Number.isFinite(endingMs) || startingMs >= endingMs) return undefined;
  return {
    startingDate: new Date(startingMs).toISOString().slice(0, 10),
    endingDate: new Date(endingMs).toISOString().slice(0, 10),
  };
}

function buildPluginUsageBreakdown(rows: AnalyticsPluginUsageRow[]): PluginUsageBreakdown[] {
  return rows
    .map((row) => ({
      pluginName: row.plugin_name,
      pluginId: row.plugin_id ?? null,
      distinctUserCount: row.distinct_user_count,
      installCount: row.install_count ?? null,
      invocationCount: row.invocation_count,
      claudeCodeSessionCount: row.claude_code_metrics?.distinct_session_plugin_used_count ?? null,
      coworkSessionCount: row.cowork_metrics?.distinct_session_plugin_used_count ?? null,
    }))
    .filter((row) => row.distinctUserCount > 0 || row.invocationCount > 0 || (row.installCount ?? 0) > 0)
    .sort(
      (left, right) =>
        right.invocationCount - left.invocationCount ||
        right.distinctUserCount - left.distinctUserCount ||
        left.pluginName.localeCompare(right.pluginName, undefined, { sensitivity: "base" }),
    );
}

function buildSkillUsageBreakdown(rows: AnalyticsSkillUsageRow[]): SkillUsageBreakdown[] {
  return rows
    .map((row) => ({
      skillName: row.skill_name,
      displayName: row.skill_display_name ?? null,
      distinctUserCount: row.distinct_user_count,
      invocationCount: row.invocation_count ?? null,
      enableCount: row.enable_count ?? null,
      estimatedOverageSpendUsd: row.estimated_overage_spend != null ? Number.parseFloat(row.estimated_overage_spend) / 100 : null,
      attributedListPriceUsd: row.attributed_list_price != null ? Number.parseFloat(row.attributed_list_price) / 100 : null,
      chatConversationCount: row.chat_metrics?.distinct_conversation_skill_used_count ?? null,
      claudeCodeSessionCount: row.claude_code_metrics?.distinct_session_skill_used_count ?? null,
      coworkSessionCount: row.cowork_metrics?.distinct_session_skill_used_count ?? null,
    }))
    .filter(
      (row) =>
        row.distinctUserCount > 0 ||
        (row.invocationCount ?? 0) > 0 ||
        (row.enableCount ?? 0) > 0 ||
        (row.estimatedOverageSpendUsd ?? 0) > 0,
    )
    .map((row) => ({
      ...row,
      estimatedOverageSpendUsd: row.estimatedOverageSpendUsd != null ? Math.round(row.estimatedOverageSpendUsd * 100) / 100 : null,
      attributedListPriceUsd: row.attributedListPriceUsd != null ? Math.round(row.attributedListPriceUsd * 100) / 100 : null,
    }))
    .sort(
      (left, right) =>
        (right.invocationCount ?? -1) - (left.invocationCount ?? -1) ||
        right.distinctUserCount - left.distinctUserCount ||
        (right.estimatedOverageSpendUsd ?? -1) - (left.estimatedOverageSpendUsd ?? -1) ||
        (left.displayName ?? left.skillName).localeCompare(right.displayName ?? right.skillName, undefined, { sensitivity: "base" }),
    );
}

function buildConnectorUsageBreakdown(rows: AnalyticsConnectorUsageRow[]): ConnectorUsageBreakdown[] {
  return rows
    .map((row) => ({
      connectorName: row.connector_name,
      displayName: row.connector_display_name ?? null,
      distinctUserCount: row.distinct_user_count,
      readCallCount: row.read_call_count ?? null,
      writeCallCount: row.write_call_count ?? null,
      unclassifiedCallCount: row.unclassified_call_count ?? null,
      managedAuthDistinctUserCount: row.managed_auth_distinct_user_count ?? null,
      individualAuthDistinctUserCount: row.individual_auth_distinct_user_count ?? null,
      chatConversationCount: row.chat_metrics?.distinct_conversation_connector_used_count ?? null,
      claudeCodeSessionCount: row.claude_code_metrics?.distinct_session_connector_used_count ?? null,
      coworkSessionCount: row.cowork_metrics?.distinct_session_connector_used_count ?? null,
    }))
    .filter(
      (row) =>
        row.distinctUserCount > 0 ||
        (row.readCallCount ?? 0) > 0 ||
        (row.writeCallCount ?? 0) > 0 ||
        (row.unclassifiedCallCount ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        ((right.readCallCount ?? 0) + (right.writeCallCount ?? 0) + (right.unclassifiedCallCount ?? 0)) -
          ((left.readCallCount ?? 0) + (left.writeCallCount ?? 0) + (left.unclassifiedCallCount ?? 0)) ||
        right.distinctUserCount - left.distinctUserCount ||
        (left.displayName ?? left.connectorName).localeCompare(right.displayName ?? right.connectorName, undefined, {
          sensitivity: "base",
        }),
    );
}

function hasAnalyticsUsageViews(payload: DashboardPayload): boolean {
  return Array.isArray(payload.pluginUsage) && Array.isArray(payload.skillUsage) && Array.isArray(payload.connectorUsage);
}

async function enrichAnalyticsUsageViews(
  payload: DashboardPayload,
  bounds: Bounds,
  scope: DashboardScope,
): Promise<DashboardPayload> {
  if (payload.source !== "analytics" || hasAnalyticsUsageViews(payload)) return payload;

  const range = clampAnalyticsUsageViewRange(bounds);
  if (!range) {
    return {
      ...payload,
      pluginUsage: payload.pluginUsage ?? [],
      skillUsage: payload.skillUsage ?? [],
      connectorUsage: payload.connectorUsage ?? [],
    };
  }

  const warnings = [...(payload.warnings ?? [])];
  const [pluginRows, skillRows, connectorRows] = await Promise.all([
    safe(getPluginUsage(range, scope.userId, scope.groupId), [] as AnalyticsPluginUsageRow[], "optional", warnings),
    safe(getSkillUsage(range, scope.userId, scope.groupId), [] as AnalyticsSkillUsageRow[], "optional", warnings),
    safe(getConnectorUsage(range, scope.userId, scope.groupId), [] as AnalyticsConnectorUsageRow[], "optional", warnings),
  ]);

  return {
    ...payload,
    pluginUsage: buildPluginUsageBreakdown(pluginRows),
    skillUsage: buildSkillUsageBreakdown(skillRows),
    connectorUsage: buildConnectorUsageBreakdown(connectorRows),
    warnings: warnings.length > 0 ? [...new Set(warnings)] : undefined,
  };
}

async function fetchAnalyticsInputs(
  range: AnalyticsRange | undefined,
  warnings: string[],
  scope: DashboardScope,
  options: AnalyticsFetchOptions,
): Promise<AnalyticsInputs> {
  if (!range) return emptyAnalyticsInputs();

  const windows = splitRange(range.startingAt, range.endingAt, 31);
  const fetchChunks = async <T>(fn: (w: AnalyticsRange) => Promise<T[]>, optional: boolean): Promise<T[]> => {
    if (!options.sequentialWindows) {
      return Promise.all(windows.map((w) => (optional ? safe(fn(w), [] as T[], "optional", warnings) : fn(w)))).then((rows) => rows.flat());
    }

    const rows: T[] = [];
    for (const window of windows) {
      const chunk = optional ? await safe(fn(window), [] as T[], "optional", warnings) : await fn(window);
      rows.push(...chunk);
    }
    return rows;
  };

  const startingDate = range.startingAt.slice(0, 10);
  const rangeStartMs = new Date(range.startingAt).getTime();
  const endMs = new Date(range.endingAt).getTime();
  const lagCutoff = Date.now() - SUMMARY_LAG_MS;
  const endingDate = endMs <= lagCutoff ? range.endingAt.slice(0, 10) : undefined;
  const includeSummaries = options.includeSummaries && !scope.userId && !scope.groupId && rangeStartMs < currentUtcDayStart();

  const fetchUsageByModel = () =>
    options.includeUsageByModel
      ? fetchChunks((w) => getAnalyticsUsageBuckets(w, ["model"], scope.userId, scope.groupId), false)
      : Promise.resolve([]);
  const fetchUsageByProduct = () =>
    options.includeUsageByProduct
      ? fetchChunks((w) => getAnalyticsUsageBuckets(w, ["product"], scope.userId, scope.groupId), true)
      : Promise.resolve([]);
  const fetchCostByModel = () =>
    options.includeCostByModel
      ? fetchChunks((w) => getAnalyticsCostBuckets(w, ["model"], scope.userId, scope.groupId), false)
      : Promise.resolve([]);
  const fetchCostByProduct = () =>
    options.includeCostByProduct
      ? fetchChunks((w) => getAnalyticsCostBuckets(w, ["product"], scope.userId, scope.groupId), true)
      : Promise.resolve([]);
  const fetchCostByType = () =>
    options.includeCostByType
      ? fetchChunks((w) => getAnalyticsCostBuckets(w, ["cost_type"], scope.userId, scope.groupId), true)
      : Promise.resolve([]);
  const fetchUserUsageRows = () =>
    options.includeUserUsage ? fetchChunks((w) => getUserUsage(w, scope.userId, scope.groupId), true) : Promise.resolve([]);
  const fetchUserCostRows = () =>
    options.includeUserCost ? fetchChunks((w) => getUserCost(w, scope.userId, scope.groupId), true) : Promise.resolve([]);
  const fetchSummaryRows = () =>
    includeSummaries ? safe(getSummaries(startingDate, endingDate), [], "optional", warnings) : Promise.resolve([]);
  const fetchGroups = () => (options.includeGroupConfig ? loadGroupConfig(warnings) : Promise.resolve([]));

  if (options.sequentialReports) {
    const usageByModel = await fetchUsageByModel();
    const usageByProduct = await fetchUsageByProduct();
    const costByModel = await fetchCostByModel();
    const costByProduct = await fetchCostByProduct();
    const costByTypeBuckets = await fetchCostByType();
    const userUsage = await fetchUserUsageRows();
    const userCost = await fetchUserCostRows();
    const summaries = await fetchSummaryRows();
    const groupConfig = await fetchGroups();

    return {
      usageByModel,
      usageByProduct,
      costByModel,
      costByProduct,
      costByTypeBuckets,
      userUsage,
      userCost,
      summaries,
      groupConfig,
    };
  }

  const [usageByModel, usageByProduct, costByModel, costByProduct, costByTypeBuckets, userUsage, userCost, summaries, groupConfig] =
    await Promise.all([
      fetchUsageByModel(),
      fetchUsageByProduct(),
      fetchCostByModel(),
      fetchCostByProduct(),
      fetchCostByType(),
      fetchUserUsageRows(),
      fetchUserCostRows(),
      fetchSummaryRows(),
      fetchGroups(),
    ]);

  return {
    usageByModel,
    usageByProduct,
    costByModel,
    costByProduct,
    costByTypeBuckets,
    userUsage,
    userCost,
    summaries,
    groupConfig,
  };
}


async function getAnalyticsDashboard(
  bounds: Bounds,
  previousBounds: Bounds | undefined,
  scope: DashboardScope = {},
  fetchOptions?: DashboardFetchOptions,
): Promise<DashboardPayload> {
  const warnings: string[] = [];
  const currentRange = clampAnalyticsRange(bounds);
  const previousRange = clampAnalyticsRange(previousBounds);

  const currentInputs = await fetchAnalyticsInputs(currentRange, warnings, scope, {
    includeUsageByModel: true,
    includeUsageByProduct: true,
    includeCostByModel: true,
    includeCostByProduct: true,
    includeCostByType: true,
    includeUserUsage: true,
    includeUserCost: true,
    includeSummaries: true,
    includeGroupConfig: true,
    ...fetchOptions?.analytics,
  });

  let previousSnapshot: ReturnType<typeof buildAnalyticsComparisonSnapshot> | undefined;
  if (previousBounds) {
    const scopeId = buildScopeId(scope);
    const persistedPrevious =
      (await loadDashboardSnapshotForRange({
        source: config.source,
        userId: scopeId,
        rangeStart: previousBounds.startingAt,
        rangeEnd: previousBounds.endingAt,
      })) ?? (await loadHistoricalDashboardFromDb(previousBounds, undefined, scopeId, scope.userId));
    if (persistedPrevious && hasConsistentAnalyticsSnapshot(persistedPrevious, scope.userId)) {
      previousSnapshot = {
        summary: persistedPrevious.summary,
        byProduct: persistedPrevious.byProduct,
        byUser: persistedPrevious.byUser,
        byModel: persistedPrevious.byModel,
        activity: persistedPrevious.activity,
      };
    } else {
      const previousInputs = await fetchAnalyticsInputs(previousRange, warnings, scope, {
        includeUsageByModel: true,
        includeCostByProduct: true,
        includeCostByModel: true,
        includeUserCost: true,
        includeSummaries: true,
        ...fetchOptions?.analytics,
      });
      previousSnapshot = buildAnalyticsComparisonSnapshot(previousInputs, previousBounds, scope.userId);
    }
  }

  const payload = buildAnalyticsDashboard(
    currentInputs,
    { startingAt: bounds.startingAt, endingAt: bounds.endingAt },
    previousSnapshot,
    scope.userId,
  );
  await persistAnalyticsDailySnapshots(currentInputs, bounds, buildScopeId(scope), scope.userId);
  return { ...payload, warnings: warnings.length > 0 ? warnings : payload.warnings };
}

async function getAdminDashboard(bounds: Bounds, previousBounds: Bounds | undefined): Promise<DashboardPayload> {
  const fetchBounds = previousBounds ? { startingAt: previousBounds.startingAt, endingAt: bounds.endingAt } : bounds;
  const [usage, cost] = await Promise.all([
    getAdminUsageBuckets({ ...fetchBounds, bucketWidth: "1d", groupBy: ["model"], limit: 31 }),
    getAdminCostBuckets({ ...fetchBounds, groupBy: ["description"], limit: 31 }),
  ]);
  return buildDashboard(usage, cost, { source: "admin", ...bounds, bucketWidth: "1d" }, previousBounds);
}

function getMockDashboard(bounds: Bounds, previousBounds: Bounds | undefined, scope: DashboardScope = {}): DashboardPayload {
  const fetchBounds = previousBounds ? { startingAt: previousBounds.startingAt, endingAt: bounds.endingAt } : bounds;
  const { usage, cost } = generateMockData(fetchBounds.startingAt, fetchBounds.endingAt);
  const base = buildDashboard(usage, cost, { source: "mock", ...bounds, bucketWidth: "1d" }, previousBounds);
  // Layer on the analytics-style extras so the mock previews the full dashboard.
  const currentExtras = generateMockExtras(bounds.startingAt, bounds.endingAt, base);
  const previousExtras = previousBounds ? generateMockExtras(previousBounds.startingAt, previousBounds.endingAt, base) : undefined;
  const full = {
    ...base,
    ...currentExtras,
    activity: currentExtras.activity
      ? {
          ...currentExtras.activity,
          comparisons: previousExtras?.activity
            ? {
                assignedSeats: buildMetricComparison(currentExtras.activity.assignedSeats, previousExtras.activity.assignedSeats),
                dailyActiveUsers: buildMetricComparison(currentExtras.activity.dailyActiveUsers, previousExtras.activity.dailyActiveUsers),
                weeklyActiveUsers: buildMetricComparison(currentExtras.activity.weeklyActiveUsers, previousExtras.activity.weeklyActiveUsers),
                monthlyActiveUsers: buildMetricComparison(currentExtras.activity.monthlyActiveUsers, previousExtras.activity.monthlyActiveUsers),
              }
            : undefined,
        }
      : undefined,
  };
  if (scope.userId) return filterMockForUser(full, bounds.startingAt, scope.userId);
  if (scope.groupId) return filterMockForGroup(full, scope.groupId);
  return full;
}

function buildScopeId(scope: DashboardScope): string | undefined {
  if (scope.userId && scope.groupId) return `group:${scope.groupId}:user:${scope.userId}`;
  if (scope.userId) return `user:${scope.userId}`;
  if (scope.groupId) return `group:${scope.groupId}`;
  return undefined;
}

function computeDashboard(
  bounds: Bounds,
  previousBounds: Bounds | undefined,
  scope: DashboardScope = {},
  fetchOptions?: DashboardFetchOptions,
): Promise<DashboardPayload> {
  switch (config.source) {
    case "analytics":
      return getAnalyticsDashboard(bounds, previousBounds, scope, fetchOptions);
    case "admin":
      // The Admin API can't attribute usage to users; ignore the filter.
      return getAdminDashboard(bounds, previousBounds);
    default:
      return Promise.resolve(getMockDashboard(bounds, previousBounds, scope));
  }
}

async function persistSnapshot(snapshotKey: SnapshotKey, payload: DashboardPayload): Promise<void> {
  await persistDashboardSnapshot({
    source: payload.source,
    requestKey: snapshotKey.requestKey,
    userId: snapshotKey.userId,
    payload: withSnapshotVersion(payload),
  });
}

function dailyBounds(bounds: Bounds): Bounds[] {
  const days: Bounds[] = [];
  let current = new Date(bounds.startingAt).getTime();
  const end = new Date(bounds.endingAt).getTime();

  while (current < end) {
    days.push({
      startingAt: new Date(current).toISOString(),
      endingAt: new Date(current + DAY_MS).toISOString(),
    });
    current += DAY_MS;
  }

  return days;
}

function mergeContiguousBounds(days: Bounds[]): Bounds[] {
  if (days.length === 0) return [];

  const sorted = [...days].sort((left, right) => left.startingAt.localeCompare(right.startingAt));
  const merged: Bounds[] = [];
  let current = { ...sorted[0] };

  for (const day of sorted.slice(1)) {
    if (day.startingAt === current.endingAt) {
      current = { startingAt: current.startingAt, endingAt: day.endingAt };
      continue;
    }
    merged.push(current);
    current = { ...day };
  }

  merged.push(current);
  return merged;
}

function currentDayBounds(now = new Date()): Bounds {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    startingAt: new Date(todayStart).toISOString(),
    endingAt: new Date(todayStart + DAY_MS).toISOString(),
  };
}

function hasConsistentAnalyticsSnapshot(payload: DashboardPayload, userId?: string): boolean {
  if (payload.snapshotVersion !== DASHBOARD_SNAPSHOT_VERSION) return false;

  if (payload.source !== "analytics") return true;

  if (payload.byUser && payload.byUser.length > 0) {
    const byUserCost = payload.byUser.reduce((sum, row) => sum + row.costUsd, 0);
    if (byUserCost > payload.summary.totalCostUsd + 0.01) return false;
  }

  if (userId && payload.byProduct && payload.byProduct.length > 0) {
    const byProductCost = payload.byProduct.reduce((sum, row) => sum + row.costUsd, 0);
    if (Math.abs(byProductCost - payload.summary.totalCostUsd) > 0.01) return false;
  }

  return true;
}

function recentHistoryBounds(days = RECENT_HISTORY_DAYS, now = new Date()): Bounds {
  const today = currentDayBounds(now);
  const span = Math.max(1, days);
  return {
    startingAt: new Date(new Date(today.startingAt).getTime() - (span - 1) * DAY_MS).toISOString(),
    endingAt: today.endingAt,
  };
}

async function fetchAndPersistDailySnapshot(dayRange: Bounds, userId?: string): Promise<DashboardPayload> {
  const payload = await getDashboardForBounds(dayRange, userId);
  await persistDashboardSnapshot({
    source: payload.source,
    requestKey: `day:${dayRange.startingAt.slice(0, 10)}`,
    userId,
    payload: withSnapshotVersion(payload),
  });
  return payload;
}

async function hydrateAndPersistRangeSnapshots(bounds: Bounds, userId?: string): Promise<number> {
  const dayCount = daySpan(bounds);

  switch (config.source) {
    case "analytics": {
      const warnings: string[] = [];
      const range = clampAnalyticsRange(bounds);
      const inputs = await fetchAnalyticsInputs(range, warnings, { userId }, {
        includeUsageByModel: true,
        includeUsageByProduct: true,
        includeCostByModel: true,
        includeCostByProduct: true,
        includeCostByType: true,
        includeUserUsage: true,
        includeUserCost: true,
        includeSummaries: true,
        includeGroupConfig: true,
        sequentialWindows: true,
        sequentialReports: true,
      });
      await persistAnalyticsDailySnapshots(inputs, bounds, userId);
      return dayCount;
    }
    case "admin": {
      const [usage, cost] = await Promise.all([
        getAdminUsageBuckets({ ...bounds, bucketWidth: "1d", groupBy: ["model"], limit: 31 }),
        getAdminCostBuckets({ ...bounds, groupBy: ["description"], limit: 31 }),
      ]);
      await Promise.all(
        dailyBounds(bounds).map(async (dayRange) => {
          const payload = buildDashboard(usage, cost, { source: "admin", ...dayRange, bucketWidth: "1d" });
          await persistDashboardSnapshot({
            source: payload.source,
            requestKey: `day:${dayRange.startingAt.slice(0, 10)}`,
            userId,
            payload: withSnapshotVersion(payload),
          });
        }),
      );
      return dayCount;
    }
    default: {
      await Promise.all(dailyBounds(bounds).map((dayRange) => fetchAndPersistDailySnapshot(dayRange, userId)));
      return dayCount;
    }
  }
}

async function persistAnalyticsDailySnapshots(inputs: AnalyticsInputs, bounds: Bounds, scopeId?: string, userId?: string): Promise<void> {
  await Promise.all(
    dailyBounds(bounds).map(async (dayRange) => {
      const payload = buildAnalyticsDashboard(inputs, dayRange, undefined, userId);
      await persistDashboardSnapshot({
        source: payload.source,
        requestKey: scopeId ? `day:${dayRange.startingAt.slice(0, 10)}:${scopeId}` : `day:${dayRange.startingAt.slice(0, 10)}`,
        userId: scopeId,
        payload: withSnapshotVersion(payload),
      });
    }),
  );
}

export async function getDashboardForBounds(
  bounds: Bounds,
  userId?: string,
  fetchOptions?: DashboardFetchOptions,
): Promise<DashboardPayload> {
  return computeDashboard(bounds, undefined, { userId }, fetchOptions);
}

export async function ensureRecentHistory(days = RECENT_HISTORY_DAYS): Promise<{ requestedDays: number; fetchedDays: number; bounds: Bounds }> {
  const bounds = recentHistoryBounds(days);
  historySyncStatus.recentHistory = {
    ...historySyncStatus.recentHistory,
    inProgress: true,
    lastStartedAt: new Date().toISOString(),
    lastError: undefined,
    requestedDays: Math.max(1, days),
    fetchedDays: 0,
    bounds,
  };

  try {
    const persisted = await loadDailyDashboardSnapshots({
      source: config.source,
      userId: undefined,
      rangeStart: bounds.startingAt,
      rangeEnd: bounds.endingAt,
    });
    const existing = new Set(
      persisted.filter((row) => hasConsistentAnalyticsSnapshot(row)).map((row) => row.range.startingAt.slice(0, 10)),
    );
    const missingDays = dailyBounds(bounds).filter((dayRange) => !existing.has(dayRange.startingAt.slice(0, 10)));
    const missingRanges = mergeContiguousBounds(missingDays);

    let fetchedDays = 0;
    await runWithConcurrency(missingRanges, HISTORY_WARMUP_CONCURRENCY, async (dayRange) => {
      fetchedDays += await hydrateAndPersistRangeSnapshots(dayRange);
    });

    if (fetchedDays > 0) cache.clear();
    historySyncStatus.recentHistory = {
      ...historySyncStatus.recentHistory,
      inProgress: false,
      lastCompletedAt: new Date().toISOString(),
      fetchedDays,
    };
    return { requestedDays: Math.max(1, days), fetchedDays, bounds };
  } catch (err) {
    historySyncStatus.recentHistory = {
      ...historySyncStatus.recentHistory,
      inProgress: false,
      lastError: err instanceof Error ? err.message : String(err),
    };
    throw err;
  }
}

export async function refreshCurrentDaySnapshot(): Promise<DashboardPayload> {
  historySyncStatus.currentDay = {
    ...historySyncStatus.currentDay,
    inProgress: true,
    lastStartedAt: new Date().toISOString(),
    lastError: undefined,
  };

  try {
    const payload = await fetchAndPersistDailySnapshot(currentDayBounds());
    cache.clear();
    historySyncStatus.currentDay = {
      ...historySyncStatus.currentDay,
      inProgress: false,
      lastCompletedAt: new Date().toISOString(),
      lastSnapshotDate: payload.range.startingAt.slice(0, 10),
    };
    return payload;
  } catch (err) {
    historySyncStatus.currentDay = {
      ...historySyncStatus.currentDay,
      inProgress: false,
      lastError: err instanceof Error ? err.message : String(err),
    };
    throw err;
  }
}

async function loadHistoricalDashboardFromDb(
  bounds: Bounds,
  previous: Bounds | undefined,
  scopeId?: string,
  userId?: string,
): Promise<DashboardPayload | null> {
  const currentDaily = (await loadDailyDashboardSnapshots({
    source: config.source,
    userId: scopeId,
    rangeStart: bounds.startingAt,
    rangeEnd: bounds.endingAt,
  })).filter((row) => hasConsistentAnalyticsSnapshot(row, userId));
  const currentRows = currentDaily.length === daySpan(bounds) ? currentDaily : [];

  if (currentRows.length === 0) return null;

  let previousRows: DashboardPayload[] | undefined;
  if (previous) {
    const previousDaily = (await loadDailyDashboardSnapshots({
      source: config.source,
      userId: scopeId,
      rangeStart: previous.startingAt,
      rangeEnd: previous.endingAt,
    })).filter((row) => hasConsistentAnalyticsSnapshot(row, userId));

    if (previousDaily.length === daySpan(previous)) {
      previousRows = previousDaily;
    } else {
      return null;
    }
  }

  return composePersistedDashboard(currentRows, bounds, previousRows);
}

// ── 1-hour response cache ─────────────────────────────────────────────────────
// Usage/cost data changes slowly (cost refreshes ~every 4h, engagement daily),
// and the Analytics API is rate-limited to ~60 req/min per org. Caching the
// assembled payload per (source, period) keeps us well under that and makes
// range-switching instant.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  payload: DashboardPayload;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DashboardPayload>>();
const historySyncStatus: HistorySyncStatus = {
  recentHistory: {
    inProgress: false,
    requestedDays: RECENT_HISTORY_DAYS,
    fetchedDays: 0,
    concurrency: HISTORY_WARMUP_CONCURRENCY,
  },
  currentDay: {
    inProgress: false,
    intervalMs: CURRENT_DAY_REFRESH_MS,
  },
};

export function getHistorySyncStatus(): HistorySyncStatus {
  return {
    recentHistory: {
      ...historySyncStatus.recentHistory,
      bounds: historySyncStatus.recentHistory.bounds ? { ...historySyncStatus.recentHistory.bounds } : undefined,
    },
    currentDay: { ...historySyncStatus.currentDay },
  };
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        await worker(item);
      }
    }),
  );
}

export async function getDashboardAnalysis(period: string, userId?: string, groupId?: string): Promise<MonthlyCostAnalysis | null> {
  const payload = await getDashboard(period, false, userId, groupId);
  return (await maybeBuildMonthlyCostAnalysis(payload, period, userId, groupId)) ?? null;
}

export async function streamDashboardAnalysis(
  period: string,
  handlers?: MonthlyCostAnalysisStreamHandlers,
  userId?: string,
  groupId?: string,
): Promise<string | null> {
  const payload = await getDashboard(period, false, userId, groupId);
  return (await streamMonthlyCostAnalysis(payload, period, handlers, userId, groupId)) ?? null;
}

export async function finalizeDashboardAnalysis(period: string, userId?: string, groupId?: string): Promise<MonthlyCostAnalysis | null> {
  const payload = await getDashboard(period, false, userId, groupId);
  return (await maybeBuildMonthlyCostAnalysis(payload, period, userId, groupId)) ?? null;
}

/**
 * Build the unified dashboard for the requested `period`, choosing the data
 * source configured in `config.source` (analytics / admin / mock).
 *
 * Served from a 1-hour cache unless `force` is set (the UI's Refresh button).
 * Concurrent identical requests share one upstream call, and if a fresh fetch
 * fails (e.g. a 429) we fall back to the last cached payload when available.
 */
export async function getDashboard(period: string, force = false, userId?: string, groupId?: string): Promise<DashboardPayload> {
  const scope: DashboardScope = { userId, groupId };
  const scopeId = buildScopeId(scope);
  const key = `${config.source}:${period}:${scopeId ?? "all"}`;
  const snapshotKey: SnapshotKey = { requestKey: period, userId: scopeId };
  const now = Date.now();

  const bounds = periodBounds(period);
  const previous = previousBounds(period, bounds);
  const preferHistorical = isOngoingRange(bounds);

  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > now) return enrichAnalyticsUsageViews(cached.payload, bounds, scope);

  if (!force) {
    const exactPersisted = await loadDashboardSnapshotForRange({
      source: config.source,
      userId: snapshotKey.userId,
      rangeStart: bounds.startingAt,
      rangeEnd: bounds.endingAt,
    });
    const historicalPersisted = await loadHistoricalDashboardFromDb(bounds, previous, scopeId, userId);
    const requestPersisted = await loadDashboardSnapshot({
      source: config.source,
      requestKey: snapshotKey.requestKey,
      userId: snapshotKey.userId,
      rangeStart: bounds.startingAt,
      rangeEnd: bounds.endingAt,
    });
    const persistedCandidates = preferHistorical
      ? [historicalPersisted, exactPersisted, requestPersisted]
      : [exactPersisted, historicalPersisted, requestPersisted];
    const persisted = persistedCandidates.find((payload) =>
      payload ? hasConsistentAnalyticsSnapshot(payload, userId) : false,
    );
    if (persisted) {
      const enriched = await enrichAnalyticsUsageViews(persisted, bounds, scope);
      cache.set(key, { payload: enriched, expiresAt: Date.now() + CACHE_TTL_MS });
      return enriched;
    }
  }

  const existing = inflight.get(key);
  if (existing) return existing; // de-dupe concurrent fetches (even forced ones)
  const task = computeDashboard(bounds, previous, scope)
    .then(async (payload) => {
      const enriched = await enrichAnalyticsUsageViews(payload, bounds, scope);
      await persistSnapshot(snapshotKey, enriched);
      cache.set(key, { payload: enriched, expiresAt: Date.now() + CACHE_TTL_MS });
      return enriched;
    })
    .catch(async (err: Error) => {
      // Stale-on-error: prefer returning slightly old data over surfacing a 429.
      const stale = cache.get(key);
      if (stale) {
        console.warn(`[cache] upstream error for ${key}; serving stale data: ${err.message}`);
        return enrichAnalyticsUsageViews(stale.payload, bounds, scope);
      }

      const exactPersisted = await loadDashboardSnapshotForRange({
        source: config.source,
        userId: snapshotKey.userId,
        rangeStart: bounds.startingAt,
        rangeEnd: bounds.endingAt,
      });
      const requestPersisted = await loadDashboardSnapshot({
        source: config.source,
        requestKey: snapshotKey.requestKey,
        userId: snapshotKey.userId,
        rangeStart: bounds.startingAt,
        rangeEnd: bounds.endingAt,
      });
      const historicalPersisted = await loadHistoricalDashboardFromDb(bounds, previous, scopeId, userId);
      const persistedCandidates = preferHistorical
        ? [historicalPersisted, exactPersisted, requestPersisted]
        : [exactPersisted, historicalPersisted, requestPersisted];
      const persisted = persistedCandidates.find((payload) =>
        payload ? hasConsistentAnalyticsSnapshot(payload, userId) : false,
      );
      if (persisted) {
        console.warn(`[db] upstream error for ${key}; serving persisted snapshot: ${err.message}`);
        const enriched = await enrichAnalyticsUsageViews(persisted, bounds, scope);
        cache.set(key, { payload: enriched, expiresAt: Date.now() + CACHE_TTL_MS });
        return enriched;
      }
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}
