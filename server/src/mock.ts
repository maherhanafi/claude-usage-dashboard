import type {
  ActivitySnapshot,
  CostBucket,
  CostResult,
  DashboardPayload,
  GroupBreakdown,
  ProductBreakdown,
  UsageBucket,
  UsageResult,
  UserBreakdown,
} from "./types.js";
import { computeUserStats } from "./userStats.js";

// Approximate list pricing (USD per million tokens) used to keep mock cost
// numbers consistent with mock token counts.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const MODELS = Object.keys(PRICING);

// Deterministic PRNG so the dashboard shows stable numbers across refreshes
// for a given day/model rather than re-rolling on every request.
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function eachDay(startingAt: string, endingAt: string): Date[] {
  const days: Date[] = [];
  const start = new Date(startingAt);
  const end = new Date(endingAt);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cursor < end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const dayStart = (d: Date): string =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
const nextDayStart = (d: Date): string => {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + 1);
  return dayStart(n);
};

export function generateMockData(
  startingAt: string,
  endingAt: string,
): { usage: UsageBucket[]; cost: CostBucket[] } {
  const usage: UsageBucket[] = [];
  const cost: CostBucket[] = [];

  for (const date of eachDay(startingAt, endingAt)) {
    const start = dayStart(date);
    const end = nextDayStart(date);
    const dow = date.getUTCDay(); // 0 Sun .. 6 Sat
    const weekendFactor = dow === 0 || dow === 6 ? 0.45 : 1; // quieter weekends

    const usageResults: UsageResult[] = [];
    const costResults: CostResult[] = [];

    for (const model of MODELS) {
      const rand = mulberry32(hashSeed(`${start}:${model}`));
      // Spread volume across models: haiku highest count, opus lowest.
      const base =
        model === "claude-haiku-4-5" ? 9_000_000 : model === "claude-sonnet-4-6" ? 4_500_000 : 1_400_000;
      const scale = (0.6 + rand() * 0.9) * weekendFactor;

      const totalInput = Math.round(base * scale * (1.55 + rand() * 0.35));
      const lowHitDay = rand() < 0.14;
      const missRate = lowHitDay
        ? 0.008 + rand() * 0.012
        : 0.0003 + rand() * 0.0012;
      const uncachedInput = Math.max(1, Math.round(totalInput * missRate));
      const cacheRead = Math.max(0, totalInput - uncachedInput);
      const cacheCreation = Math.max(1, Math.round(totalInput * (0.001 + rand() * 0.004)));
      const output = Math.round(totalInput * (0.18 + rand() * 0.22));
      const webSearch = model === "claude-opus-4-8" ? Math.round(rand() * 40) : Math.round(rand() * 12);

      usageResults.push({
        account_id: null,
        api_key_id: null,
        cache_creation: {
          ephemeral_1h_input_tokens: Math.round(cacheCreation * 0.3),
          ephemeral_5m_input_tokens: Math.round(cacheCreation * 0.7),
        },
        cache_read_input_tokens: cacheRead,
        context_window: "0-200k",
        inference_geo: null,
        model,
        output_tokens: output,
        server_tool_use: { web_search_requests: webSearch },
        service_account_id: null,
        service_tier: "standard",
        uncached_input_tokens: uncachedInput,
        workspace_id: null,
      });

      // Cost lines per token type (amounts in cents = dollars * 100).
      const price = PRICING[model];
      const line = (tokenType: string, tokens: number, perMTokUsd: number) => {
        const usd = (tokens / 1_000_000) * perMTokUsd;
        costResults.push({
          amount: (usd * 100).toFixed(5),
          context_window: "0-200k",
          cost_type: "tokens",
          currency: "USD",
          description: `${model} - ${tokenType}`,
          inference_geo: null,
          model,
          service_tier: "standard",
          token_type: tokenType,
          workspace_id: null,
        });
      };
      line("uncached_input_tokens", uncachedInput, price.input);
      line("cache_read_input_tokens", cacheRead, price.input * 0.1);
      line("cache_creation.ephemeral_5m_input_tokens", cacheCreation, price.input * 1.25);
      line("output_tokens", output, price.output);

      if (webSearch > 0) {
        // Web search billed ~$10 per 1k requests.
        costResults.push({
          amount: ((webSearch / 1000) * 10 * 100).toFixed(5),
          context_window: null,
          cost_type: "web_search",
          currency: "USD",
          description: "Web Search Usage",
          inference_geo: null,
          model: null,
          service_tier: null,
          token_type: null,
          workspace_id: null,
        });
      }
    }

    usage.push({ starting_at: start, ending_at: end, results: usageResults });
    cost.push({ starting_at: start, ending_at: end, results: costResults });
  }

  return { usage, cost };
}

// ── Analytics-style extras (per-user / per-product / activity) ────────────────
// These mirror the Claude.ai Enterprise Analytics API sections. They're derived
// from the already-aggregated base dashboard so totals reconcile.

const round2 = (n: number): number => Math.round(n * 100) / 100;

const MOCK_USERS: { name: string; email: string }[] = [
  { name: "Ava Chen", email: "ava.chen@example.com" },
  { name: "Liam Patel", email: "liam.patel@example.com" },
  { name: "Sofia Rossi", email: "sofia.rossi@example.com" },
  { name: "Noah Kim", email: "noah.kim@example.com" },
  { name: "Maya Johnson", email: "maya.johnson@example.com" },
  { name: "Ethan Müller", email: "ethan.muller@example.com" },
  { name: "Priya Nair", email: "priya.nair@example.com" },
  { name: "Lucas Silva", email: "lucas.silva@example.com" },
  { name: "Hannah Cohen", email: "hannah.cohen@example.com" },
  { name: "Omar Haddad", email: "omar.haddad@example.com" },
  { name: "Grace Liu", email: "grace.liu@example.com" },
  { name: "Daniel Fox", email: "daniel.fox@example.com" },
];

const MOCK_PRODUCTS = ["chat", "claude_code", "cowork"];
const PRODUCT_LABELS: Record<string, string> = {
  chat: "Claude.ai chat",
  claude_code: "Claude Code",
  cowork: "Cowork",
};

const MOCK_GROUPS = [
  { id: "grp_01", name: "Engineering", roleNames: ["Engineering base", "Claude Code"] },
  { id: "grp_02", name: "Product", roleNames: ["Product planning"] },
  { id: "grp_03", name: "Sales", roleNames: ["Revenue ops"] },
  { id: "grp_04", name: "Design", roleNames: ["Design studio"] },
];
// Group assignment by user index (matches MOCK_USERS order).
// Engineering: 0–3, Product: 4–6, Sales: 7–9, Design: 10–11
const MOCK_USER_GROUP_IDX: number[] = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];

/** Distribute a total across `n` deterministic weights seeded by `seed`. */
function weights(seed: string, n: number): number[] {
  const rand = mulberry32(hashSeed(seed));
  // Skew toward a few heavy users (power-law-ish), then normalize.
  const raw = Array.from({ length: n }, () => Math.pow(rand(), 2.2) + 0.02);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

export function generateMockExtras(
  startingAt: string,
  _endingAt: string,
  base: DashboardPayload,
): Pick<DashboardPayload, "byUser" | "userStats" | "byProduct" | "byGroup" | "activity" | "dataRefreshedAt"> {
  const { totalTokens, totalCostUsd, outputTokens } = base.summary;

  const uw = weights(`${startingAt}:users`, MOCK_USERS.length);
  const byUser: UserBreakdown[] = MOCK_USERS.map((u, i) => {
    const group = MOCK_GROUPS[MOCK_USER_GROUP_IDX[i]];
    return {
      userId: `user_${(i + 1).toString().padStart(2, "0")}`,
      name: u.name,
      email: u.email,
      deleted: false,
      groups: group ? [{ groupId: group.id, name: group.name, roleNames: group.roleNames }] : [],
      effectiveRoles: group ? group.roleNames.map((roleName) => ({ roleId: roleName, name: roleName })) : [],
      uncachedInputTokens: Math.round(base.summary.uncachedInputTokens * uw[i]),
      cacheReadTokens: Math.round(base.summary.cacheReadTokens * uw[i]),
      totalTokens: Math.round(totalTokens * uw[i]),
      outputTokens: Math.round(outputTokens * uw[i]),
      costUsd: round2(totalCostUsd * uw[i]),
      requests: Math.round((totalTokens * uw[i]) / 5200),
      cacheHitRate: 0,
    };
  })
    .map((user) => ({
      ...user,
      cacheHitRate:
        (user.uncachedInputTokens ?? 0) + (user.cacheReadTokens ?? 0) > 0
          ? round2(((user.cacheReadTokens ?? 0) / ((user.uncachedInputTokens ?? 0) + (user.cacheReadTokens ?? 0))) * 100)
          : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const pw = weights(`${startingAt}:products`, MOCK_PRODUCTS.length);
  const byProduct: ProductBreakdown[] = MOCK_PRODUCTS.map((p, i) => ({
    product: PRODUCT_LABELS[p] ?? p,
    totalTokens: Math.round(totalTokens * pw[i]),
    costUsd: round2(totalCostUsd * pw[i]),
  })).sort((a, b) => b.costUsd - a.costUsd);

  const rand = mulberry32(hashSeed(`${startingAt}:activity`));
  const assignedSeats = 40;
  const dailyActiveUsers = 8 + Math.round(rand() * 4);
  const weeklyActiveUsers = Math.min(assignedSeats, MOCK_USERS.length);
  const monthlyActiveUsers = Math.min(assignedSeats, MOCK_USERS.length);
  const activity: ActivitySnapshot = {
    date: startingAt.slice(0, 10),
    assignedSeats,
    pendingInvites: 3,
    dailyActiveUsers,
    weeklyActiveUsers,
    monthlyActiveUsers,
    dailyAdoptionRate: round2((dailyActiveUsers / assignedSeats) * 100),
    weeklyAdoptionRate: round2((weeklyActiveUsers / assignedSeats) * 100),
    monthlyAdoptionRate: round2((monthlyActiveUsers / assignedSeats) * 100),
  };

  const byGroup: GroupBreakdown[] = MOCK_GROUPS.map((g, gi) => {
    const memberUserIds = MOCK_USER_GROUP_IDX
      .map((groupIdx, userIdx) => (groupIdx === gi ? `user_${(userIdx + 1).toString().padStart(2, "0")}` : null))
      .filter((id): id is string => id !== null);
    const groupUsers = byUser.filter((u) => memberUserIds.includes(u.userId));
    return {
      groupId: g.id,
      name: g.name,
      roleNames: g.roleNames,
      memberCount: memberUserIds.length,
      totalTokens: groupUsers.reduce((s, u) => s + u.totalTokens, 0),
      outputTokens: groupUsers.reduce((s, u) => s + u.outputTokens, 0),
      costUsd: round2(groupUsers.reduce((s, u) => s + u.costUsd, 0)),
      requests: groupUsers.reduce((s, u) => s + u.requests, 0),
    };
  }).sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  return { byUser, userStats: computeUserStats(byUser), byProduct, byGroup, activity, dataRefreshedAt: new Date().toISOString() };
}

/**
 * Re-scope a full mock dashboard to a single user by their share of the totals.
 * Approximation for preview only — real per-user filtering uses the Analytics
 * API's `user_ids` filter. Activity (org-level) is dropped when filtered.
 */
export function filterMockForUser(
  full: DashboardPayload,
  _startingAt: string,
  userId: string,
): DashboardPayload {
  const u = (full.byUser ?? []).find((x) => x.userId === userId);
  if (!u) return { ...full, byUser: [], byProduct: [], activity: undefined };

  const wTokens = full.summary.totalTokens > 0 ? u.totalTokens / full.summary.totalTokens : 0;
  const wCost = full.summary.totalCostUsd > 0 ? u.costUsd / full.summary.totalCostUsd : 0;
  const tok = (n: number): number => Math.round(n * wTokens);
  const cost = (n: number): number => round2(n * wCost);

  return {
    ...full,
    summary: {
      ...full.summary,
      totalCostUsd: u.costUsd,
      totalTokens: tok(full.summary.totalTokens),
      uncachedInputTokens: tok(full.summary.uncachedInputTokens),
      cacheReadTokens: tok(full.summary.cacheReadTokens),
      cacheCreationTokens: tok(full.summary.cacheCreationTokens),
      outputTokens: u.outputTokens,
      webSearchRequests: Math.round(full.summary.webSearchRequests * wTokens),
    },
    timeseries: full.timeseries.map((p) => ({
      ...p,
      uncachedInputTokens: tok(p.uncachedInputTokens),
      cacheReadTokens: tok(p.cacheReadTokens),
      cacheCreationTokens: tok(p.cacheCreationTokens),
      outputTokens: tok(p.outputTokens),
      totalTokens: tok(p.totalTokens),
      costUsd: cost(p.costUsd),
    })),
    byModel: full.byModel.map((m) => ({
      ...m,
      uncachedInputTokens: tok(m.uncachedInputTokens),
      cacheReadTokens: tok(m.cacheReadTokens),
      cacheCreationTokens: tok(m.cacheCreationTokens),
      outputTokens: tok(m.outputTokens),
      totalTokens: tok(m.totalTokens),
      costUsd: cost(m.costUsd),
    })),
    modelTimeseries: full.modelTimeseries.map((p) => ({
      date: p.date,
      values: Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, tok(v)])),
    })),
    costByType: full.costByType.map((c) => ({ ...c, costUsd: cost(c.costUsd) })),
    byProduct: (full.byProduct ?? []).map((p) => ({
      ...p,
      totalTokens: tok(p.totalTokens),
      costUsd: cost(p.costUsd),
    })),
    byUser: [u],
    userStats: undefined, // per-user aggregate stats are meaningless when filtered to one user
    activity: undefined,
  };
}

export function filterMockForGroup(full: DashboardPayload, groupId: string): DashboardPayload {
  const users = (full.byUser ?? []).filter((user) => (user.groups ?? []).some((group) => group.groupId === groupId));
  const selectedGroup = (full.byGroup ?? []).find((group) => group.groupId === groupId);
  if (!selectedGroup || users.length === 0) {
    return { ...full, byUser: [], byGroup: [], byProduct: [], activity: undefined };
  }

  const totalTokens = users.reduce((sum, user) => sum + user.totalTokens, 0);
  const totalCostUsd = round2(users.reduce((sum, user) => sum + user.costUsd, 0));
  const outputTokens = users.reduce((sum, user) => sum + user.outputTokens, 0);
  const uncachedInputTokens = users.reduce((sum, user) => sum + (user.uncachedInputTokens ?? 0), 0);
  const cacheReadTokens = users.reduce((sum, user) => sum + (user.cacheReadTokens ?? 0), 0);
  const cacheHitRate = uncachedInputTokens + cacheReadTokens > 0 ? round2((cacheReadTokens / (uncachedInputTokens + cacheReadTokens)) * 100) : 0;
  const tokenWeight = full.summary.totalTokens > 0 ? totalTokens / full.summary.totalTokens : 0;
  const costWeight = full.summary.totalCostUsd > 0 ? totalCostUsd / full.summary.totalCostUsd : 0;
  const tok = (n: number): number => Math.round(n * tokenWeight);
  const cost = (n: number): number => round2(n * costWeight);

  return {
    ...full,
    summary: {
      ...full.summary,
      totalCostUsd,
      totalTokens,
      uncachedInputTokens,
      cacheReadTokens,
      cacheCreationTokens: tok(full.summary.cacheCreationTokens),
      outputTokens,
      webSearchRequests: Math.round(full.summary.webSearchRequests * tokenWeight),
      cacheHitRate,
    },
    timeseries: full.timeseries.map((point) => ({
      ...point,
      uncachedInputTokens: tok(point.uncachedInputTokens),
      cacheReadTokens: tok(point.cacheReadTokens),
      cacheCreationTokens: tok(point.cacheCreationTokens),
      outputTokens: tok(point.outputTokens),
      totalTokens: tok(point.totalTokens),
      costUsd: cost(point.costUsd),
    })),
    byModel: full.byModel.map((model) => ({
      ...model,
      uncachedInputTokens: tok(model.uncachedInputTokens),
      cacheReadTokens: tok(model.cacheReadTokens),
      cacheCreationTokens: tok(model.cacheCreationTokens),
      outputTokens: tok(model.outputTokens),
      totalTokens: tok(model.totalTokens),
      costUsd: cost(model.costUsd),
    })),
    modelTimeseries: full.modelTimeseries.map((point) => ({
      date: point.date,
      values: Object.fromEntries(Object.entries(point.values).map(([key, value]) => [key, tok(value)])),
    })),
    costByType: full.costByType.map((entry) => ({ ...entry, costUsd: cost(entry.costUsd) })),
    byProduct: (full.byProduct ?? []).map((product) => ({
      ...product,
      totalTokens: tok(product.totalTokens),
      costUsd: cost(product.costUsd),
    })),
    byUser: users,
    byGroup: [selectedGroup],
    userStats: computeUserStats(users),
    activity: undefined,
  };
}
