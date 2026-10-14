import { config } from "./config.js";
import { logClaudeApiEnd, logClaudeApiError, logClaudeApiStart } from "./claudeApiLog.js";
import { HttpApiError } from "./httpError.js";
import type {
  AnalyticsConnectorUsageReport,
  AnalyticsConnectorUsageRow,
  AnalyticsCostBucket,
  AnalyticsCostReport,
  AnalyticsPluginUsageReport,
  AnalyticsPluginUsageRow,
  AnalyticsSkillUsageReport,
  AnalyticsSkillUsageRow,
  AnalyticsSummariesReport,
  AnalyticsSummary,
  AnalyticsUsageBucket,
  AnalyticsUsageReport,
  AnalyticsUserCostReport,
  AnalyticsUserCostRow,
  AnalyticsUserUsageReport,
  AnalyticsUserUsageRow,
} from "./types.js";

export class AnalyticsApiError extends HttpApiError {
  constructor(status: number, body: string) {
    super("analytics", status, body);
    this.name = "AnalyticsApiError";
  }
}

type GroupBy = "product" | "model" | "context_window" | "inference_geo" | "speed" | "cost_type" | "token_type";

interface QueryParams {
  [key: string]: string | string[] | number | undefined;
}

interface AnalyticsDateRange {
  startingDate: string;
  endingDate?: string;
}

const MAX_ANALYTICS_RETRIES = 2;

function buildQuery(params: QueryParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) qs.append(`${key}[]`, String(item));
    } else {
      qs.append(key, String(value));
    }
  }
  return qs.toString();
}

/**
 * The Analytics API authenticates with the org's Analytics API key
 * (`read:analytics` scope) sent in the `x-api-key` header — the same header
 * scheme as the Admin API. (The docs' `Authorization: Bearer` example is for
 * OAuth tokens, a different credential type.)
 */
async function analyticsGet<T>(path: string, params: QueryParams): Promise<T> {
  const url = `${config.anthropicBaseUrl}${path}?${buildQuery(params)}`;
  for (let attempt = 0; ; attempt += 1) {
    const startedAt = logClaudeApiStart("analytics", path, params);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": config.analyticsKey,
        "anthropic-version": config.anthropicVersion,
        "User-Agent": "claude-usage-dashboard/1.0.0",
      },
    });
    if (res.ok) {
      logClaudeApiEnd("analytics", path, params, startedAt, res.status);
      return (await res.json()) as T;
    }

    if (res.status === 429 && attempt < MAX_ANALYTICS_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * (attempt + 1);
      console.warn(
        `[claude-api:analytics] 429 GET ${path} ${Date.now() - startedAt}ms params=${buildQuery(params) || "{}"} retrying_in_ms=${delayMs}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    logClaudeApiError("analytics", path, params, startedAt, res.status);
    const body = await res.text().catch(() => "");
    throw new AnalyticsApiError(res.status, body.slice(0, 1000));
  }
}

/** Follow `next_page` until `has_more` is false, accumulating `data` rows. */
async function fetchAll<TRow, TReport extends { data: TRow[]; has_more: boolean; next_page: string | null }>(
  path: string,
  params: QueryParams,
  maxPages = 50,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  let page: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const report = await analyticsGet<TReport>(path, { ...params, page });
    rows.push(...report.data);
    if (!report.has_more || !report.next_page) break;
    page = report.next_page;
  }
  return rows;
}

async function fetchAllCursorRows<TRow, TReport extends { data: TRow[]; next_page: string | null }>(
  path: string,
  params: QueryParams,
  maxPages = 50,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  let page: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const report = await analyticsGet<TReport>(path, { ...params, page });
    rows.push(...report.data);
    if (!report.next_page) break;
    page = report.next_page;
  }
  return rows;
}

export interface AnalyticsRange {
  startingAt: string; // RFC 3339
  endingAt: string; // RFC 3339
}

const userIdsParam = (userId?: string): string[] | undefined => (userId ? [userId] : undefined);
const groupIdsParam = (groupId?: string): string[] | undefined => (groupId ? [groupId] : undefined);
const analyticsFilters = (userId?: string, groupId?: string): string[] | undefined => {
  const filters = [userId ? `user_id:${userId}` : undefined, groupId ? `rbac_group_id:${groupId}` : undefined].filter(
    (value): value is string => Boolean(value),
  );
  return filters.length > 0 ? filters : undefined;
};

export function getUsageBuckets(range: AnalyticsRange, groupBy: GroupBy[], userId?: string, groupId?: string): Promise<AnalyticsUsageBucket[]> {
  return fetchAll<AnalyticsUsageBucket, AnalyticsUsageReport>("/v1/organizations/analytics/usage_report", {
    starting_at: range.startingAt,
    ending_at: range.endingAt,
    bucket_width: "1d",
    group_by: groupBy,
    user_ids: userIdsParam(userId),
    rbac_group_ids: groupIdsParam(groupId),
    limit: 31,
  });
}

export function getCostBuckets(range: AnalyticsRange, groupBy: GroupBy[], userId?: string, groupId?: string): Promise<AnalyticsCostBucket[]> {
  return fetchAll<AnalyticsCostBucket, AnalyticsCostReport>("/v1/organizations/analytics/cost_report", {
    starting_at: range.startingAt,
    ending_at: range.endingAt,
    bucket_width: "1d",
    group_by: groupBy,
    user_ids: userIdsParam(userId),
    rbac_group_ids: groupIdsParam(groupId),
    limit: 31,
  });
}

export function getUserUsage(range: AnalyticsRange, userId?: string, groupId?: string, limit = 100): Promise<AnalyticsUserUsageRow[]> {
  return fetchAll<AnalyticsUserUsageRow, AnalyticsUserUsageReport>("/v1/organizations/analytics/user_usage_report", {
    starting_at: range.startingAt,
    ending_at: range.endingAt,
    bucket_width: "1d",
    order_by: "total_tokens",
    order: "desc",
    user_ids: userIdsParam(userId),
    rbac_group_ids: groupIdsParam(groupId),
    limit: Math.max(limit, 1000),
  });
}

export function getUserCost(range: AnalyticsRange, userId?: string, groupId?: string, limit = 100): Promise<AnalyticsUserCostRow[]> {
  return fetchAll<AnalyticsUserCostRow, AnalyticsUserCostReport>("/v1/organizations/analytics/user_cost_report", {
    starting_at: range.startingAt,
    ending_at: range.endingAt,
    bucket_width: "1d",
    order_by: "amount",
    order: "desc",
    user_ids: userIdsParam(userId),
    rbac_group_ids: groupIdsParam(groupId),
    limit: Math.max(limit, 1000),
  });
}

/** Summaries are date-based (YYYY-MM-DD) and not paginated. */
export async function getSummaries(startingDate: string, endingDate?: string): Promise<AnalyticsSummary[]> {
  const report = await analyticsGet<AnalyticsSummariesReport>("/v1/organizations/analytics/summaries", {
    starting_date: startingDate,
    ending_date: endingDate,
  });
  return report.summaries ?? [];
}

export function getPluginUsage(range: AnalyticsDateRange, userId?: string, groupId?: string): Promise<AnalyticsPluginUsageRow[]> {
  return fetchAllCursorRows<AnalyticsPluginUsageRow, AnalyticsPluginUsageReport>("/v1/organizations/analytics/plugins", {
    starting_date: range.startingDate,
    ending_date: range.endingDate,
    filter: analyticsFilters(userId, groupId),
    limit: 1000,
  });
}

export function getSkillUsage(range: AnalyticsDateRange, userId?: string, groupId?: string): Promise<AnalyticsSkillUsageRow[]> {
  return fetchAllCursorRows<AnalyticsSkillUsageRow, AnalyticsSkillUsageReport>("/v1/organizations/analytics/skills", {
    starting_date: range.startingDate,
    ending_date: range.endingDate,
    filter: analyticsFilters(userId, groupId),
    limit: 1000,
  });
}

export function getConnectorUsage(range: AnalyticsDateRange, userId?: string, groupId?: string): Promise<AnalyticsConnectorUsageRow[]> {
  return fetchAllCursorRows<AnalyticsConnectorUsageRow, AnalyticsConnectorUsageReport>("/v1/organizations/analytics/connectors", {
    starting_date: range.startingDate,
    ending_date: range.endingDate,
    filter: analyticsFilters(userId, groupId),
    limit: 1000,
  });
}

