import { config } from "./config.js";
import { logClaudeApiEnd, logClaudeApiError, logClaudeApiStart } from "./claudeApiLog.js";
import { HttpApiError } from "./httpError.js";
import type {
  CostBucket,
  CostReport,
  UsageBucket,
  UsageReport,
} from "./types.js";


export class AdminApiError extends HttpApiError {
  constructor(status: number, body: string) {
    super("admin", status, body);
    this.name = "AdminApiError";
  }
}

interface QueryParams {
  [key: string]: string | string[] | number | undefined;
}

export interface AdminApiCredential {
  envVar: "ANTHROPIC_ADMIN_KEY" | "ANTHROPIC_ANALYTICS_KEY";
  key: string;
}

function getCredentialForPath(path: string): AdminApiCredential {
  // Claude Enterprise RBAC endpoints are scoped off the claude.ai key when present.
  if (path.startsWith("/v1/organizations/rbac_") && config.analyticsKey) {
    return {
      envVar: "ANTHROPIC_ANALYTICS_KEY",
      key: config.analyticsKey,
    };
  }

  return {
    envVar: "ANTHROPIC_ADMIN_KEY",
    key: config.adminKey,
  };
}

export function getRbacCredential(): AdminApiCredential {
  return getCredentialForPath("/v1/organizations/rbac_groups");
}

function buildQuery(params: QueryParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // Array params use the `key[]` convention, e.g. group_by[]=model
      for (const item of value) qs.append(`${key}[]`, String(item));
    } else {
      qs.append(key, String(value));
    }
  }
  return qs.toString();
}

async function adminGet<T>(path: string, params: QueryParams): Promise<T> {
  const url = `${config.anthropicBaseUrl}${path}?${buildQuery(params)}`;
  const credential = getCredentialForPath(path);
  const startedAt = logClaudeApiStart("admin", path, params);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": credential.key,
      "anthropic-version": config.anthropicVersion,
      "User-Agent": "claude-usage-dashboard/1.0.0",
    },
  });

  if (!res.ok) {
    logClaudeApiError("admin", path, params, startedAt, res.status);
    const body = await res.text().catch(() => "");
    throw new AdminApiError(res.status, body.slice(0, 1000));
  }
  logClaudeApiEnd("admin", path, params, startedAt, res.status);
  return (await res.json()) as T;
}

/**
 * Fetch every page of a paginated report endpoint, accumulating the `data`
 * buckets. The API caps buckets per request, so we follow `next_page` until
 * `has_more` is false. A hard page cap guards against runaway loops.
 */
async function fetchAllBuckets<TBucket, TReport extends { data: TBucket[]; has_more: boolean; next_page: string | null }>(
  path: string,
  params: QueryParams,
  maxPages = 50,
): Promise<TBucket[]> {
  const buckets: TBucket[] = [];
  let page: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const report = await adminGet<TReport>(path, { ...params, page });
    buckets.push(...report.data);
    if (!report.has_more || !report.next_page) break;
    page = report.next_page;
  }
  return buckets;
}

export interface UsageQuery {
  startingAt: string;
  endingAt: string;
  bucketWidth: "1d" | "1h" | "1m";
  groupBy?: string[];
  models?: string[];
  workspaceIds?: string[];
  serviceTiers?: string[];
  limit?: number;
}

export async function getUsageBuckets(q: UsageQuery): Promise<UsageBucket[]> {
  return fetchAllBuckets<UsageBucket, UsageReport>(
    "/v1/organizations/usage_report/messages",
    {
      starting_at: q.startingAt,
      ending_at: q.endingAt,
      bucket_width: q.bucketWidth,
      group_by: q.groupBy,
      models: q.models,
      workspace_ids: q.workspaceIds,
      service_tiers: q.serviceTiers,
      limit: q.limit,
    },
  );
}

export interface CostQuery {
  startingAt: string;
  endingAt: string;
  groupBy?: string[];
  limit?: number;
}

interface CursorPage<T> {
  data: T[];
  next_page: string | null;
}

interface RbacGroupRecord {
  id: string;
  name: string;
  source_type?: string;
  role_ids?: string[] | null;
}

interface RbacGroupMemberRecord {
  rbac_group_id?: string;
  group_id?: string;
  user_id: string;
  email: string | null;
}

export interface RbacGroup {
  groupId: string;
  name: string;
  sourceType: string | null;
  roleIds: string[];
}

interface RbacRoleRecord {
  id: string;
  name: string;
}

export interface RbacRole {
  roleId: string;
  name: string;
}

export interface RbacGroupMember {
  groupId: string;
  userId: string;
  email: string | null;
}

async function fetchAllCursorPages<TItem, TReport extends CursorPage<TItem>>(
  path: string,
  params: QueryParams,
  maxPages = 50,
): Promise<TItem[]> {
  const rows: TItem[] = [];
  let page: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const report = await adminGet<TReport>(path, { ...params, page });
    rows.push(...report.data);
    if (!report.next_page) break;
    page = report.next_page;
  }
  return rows;
}

export async function getCostBuckets(q: CostQuery): Promise<CostBucket[]> {
  return fetchAllBuckets<CostBucket, CostReport>(
    "/v1/organizations/cost_report",
    {
      starting_at: q.startingAt,
      ending_at: q.endingAt,
      bucket_width: "1d", // cost report supports daily granularity only
      group_by: q.groupBy,
      limit: q.limit,
    },
  );
}

export async function getRbacGroups(limit = 100): Promise<RbacGroup[]> {
  const rows = await fetchAllCursorPages<RbacGroupRecord, CursorPage<RbacGroupRecord>>(
    "/v1/organizations/rbac_groups",
    { limit },
  );

  return rows.map((row) => ({
    groupId: row.id,
    name: row.name,
    sourceType: row.source_type ?? null,
    roleIds: row.role_ids ?? [],
  }));
}

export async function getRbacGroupMembers(groupId: string, limit = 100): Promise<RbacGroupMember[]> {
  const rows = await fetchAllCursorPages<RbacGroupMemberRecord, CursorPage<RbacGroupMemberRecord>>(
    `/v1/organizations/rbac_groups/${groupId}/members`,
    { limit },
  );

  return rows.map((row) => ({
    groupId: row.rbac_group_id ?? row.group_id ?? groupId,
    userId: row.user_id,
    email: row.email ?? null,
  }));
}

export async function getRbacRoles(limit = 100): Promise<RbacRole[]> {
  const rows = await fetchAllCursorPages<RbacRoleRecord, CursorPage<RbacRoleRecord>>(
    "/v1/organizations/rbac_roles",
    { limit },
  );

  return rows.map((row) => ({
    roleId: row.id,
    name: row.name,
  }));
}

