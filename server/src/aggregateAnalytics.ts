import type {
  ActivitySnapshot,
  AnalyticsCostBucket,
  AnalyticsSummary,
  AnalyticsUsageBucket,
  AnalyticsUsageResult,
  AnalyticsUserCostRow,
  AnalyticsUserUsageRow,
  CostTypeBreakdown,
  DashboardPayload,
  GroupBreakdown,
  MetricComparison,
  ModelBreakdown,
  ModelTimePoint,
  ProductBreakdown,
  TimePoint,
  UserBreakdown,
  UserRoleAssignment,
} from "./types.js";
import { computeUserStats } from "./userStats.js";
import type { GroupConfigEntry } from "./groupConfig.js";

interface GroupReference {
  groupId: string;
  name: string;
  roleNames?: string[];
}

const day = (rfc3339: string | null | undefined): string => {
  if (typeof rfc3339 !== "string") return "";
  return rfc3339.slice(0, 10);
};

/** Cost amounts are decimal strings in fractional cents; convert to dollars. */
const centsToUsd = (amount: string | null | undefined): number => {
  const n = Number.parseFloat(amount ?? "");
  return Number.isFinite(n) ? n / 100 : 0;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
const COST_TOLERANCE_USD = 0.01;

const buildCacheHitRate = (uncachedInputTokens: number, cacheReadTokens: number): number => {
  const denominator = uncachedInputTokens + cacheReadTokens;
  return denominator > 0 ? round2((cacheReadTokens / denominator) * 100) : 0;
};

const sumValues = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

const hasCostMismatch = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) > COST_TOLERANCE_USD;

function allocateCosts(weights: Map<string, number>, totalCostUsd: number): Map<string, number> {
  const entries = [...weights.entries()];
  if (entries.length === 0) return new Map();
  if (totalCostUsd <= 0) return new Map(entries.map(([key]) => [key, 0]));

  const positiveWeightEntries = entries.filter(([, weight]) => weight > 0);
  const weightedEntries = positiveWeightEntries.length > 0 ? positiveWeightEntries : entries.map(([key]) => [key, 1] as const);
  const totalWeight = weightedEntries.reduce((sum, [, weight]) => sum + weight, 0);
  const allocated = weightedEntries.map(([key, weight]) => ({
    key,
    weight,
    costUsd: round2((totalCostUsd * weight) / totalWeight),
  }));

  const roundingDeltaUsd = round2(totalCostUsd - allocated.reduce((sum, row) => sum + row.costUsd, 0));
  if (roundingDeltaUsd !== 0) {
    allocated.sort((left, right) => right.weight - left.weight || left.key.localeCompare(right.key));
    allocated[0] = { ...allocated[0], costUsd: round2(allocated[0].costUsd + roundingDeltaUsd) };
  }

  const zeroEntries: Array<readonly [string, number]> = entries.map(([key]) => [key, 0] as const);
  const allocatedEntries: Array<readonly [string, number]> = allocated.map(({ key, costUsd }) => [key, costUsd] as const);
  return new Map([...zeroEntries, ...allocatedEntries]);
}

interface TokenTotals {
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

interface RangeBounds {
  startingAt: string;
  endingAt: string;
}

interface RangeAggregate {
  summary: Omit<DashboardPayload["summary"], "comparisons">;
  timeseries: TimePoint[];
  byModel: ModelBreakdown[];
  modelTimeseries: ModelTimePoint[];
  modelKeys: string[];
  costByType: CostTypeBreakdown[];
  byProduct: ProductBreakdown[];
  byUser: UserBreakdown[];
  byGroup?: GroupBreakdown[];
  activity?: ActivitySnapshot;
}

const emptyTokens = (): TokenTotals => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  webSearchRequests: 0,
});

const tokenSum = (t: TokenTotals): number =>
  t.uncachedInputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens;

const addUsage = (t: TokenTotals, r: AnalyticsUsageResult): void => {
  t.uncachedInputTokens += r.uncached_input_tokens;
  t.cacheReadTokens += r.cache_read_input_tokens;
  t.cacheCreationTokens +=
    r.cache_creation.ephemeral_1h_input_tokens + r.cache_creation.ephemeral_5m_input_tokens;
  t.outputTokens += r.output_tokens;
  t.webSearchRequests += r.server_tool_use?.web_search_requests ?? 0;
};

const PRODUCT_LABELS: Record<string, string> = {
  chat: "Claude.ai chat",
  claude_code: "Claude Code",
  cowork: "Cowork",
  office_agent: "Office agent",
  claude_in_chrome: "Claude in Chrome",
  claude_design: "Claude Design",
  other: "Other",
};

export interface AnalyticsInputs {
  usageByModel: AnalyticsUsageBucket[];
  usageByProduct: AnalyticsUsageBucket[];
  costByModel: AnalyticsCostBucket[];
  costByProduct: AnalyticsCostBucket[];
  costByTypeBuckets: AnalyticsCostBucket[];
  userUsage: AnalyticsUserUsageRow[];
  userCost: AnalyticsUserCostRow[];
  summaries: AnalyticsSummary[];
  groupConfig?: GroupConfigEntry[];
  dataRefreshedAt?: string;
}

function appendGroupReference(map: Map<string, GroupReference[]>, key: string | undefined, group: GroupReference): void {
  if (!key) return;
  const existing = map.get(key) ?? [];
  if (existing.some((entry) => entry.groupId === group.groupId)) return;
  existing.push(group);
  map.set(key, existing);
}

export interface AnalyticsComparisonSnapshot {
  summary: DashboardPayload["summary"];
  byModel?: ModelBreakdown[];
  byProduct?: ProductBreakdown[];
  byUser?: UserBreakdown[];
  byGroup?: GroupBreakdown[];
  activity?: ActivitySnapshot;
}

function buildRangeAggregate(
  inputs: AnalyticsInputs,
  bounds?: RangeBounds,
  filteredUserId?: string,
): RangeAggregate {
  const tokensByDay = new Map<string, TokenTotals>();
  const tokensByModel = new Map<string, TokenTotals>();
  const tokensByDayModel = new Map<string, Map<string, number>>();
  const overall = emptyTokens();

  const inRange = (date: string): boolean => {
    if (!bounds) return true;
    const start = day(bounds.startingAt || "");
    const end = day(bounds.endingAt || "");
    if (!start || !end) return true;
    return date >= start && date < end;
  };

  for (const bucket of inputs.usageByModel) {
    const date = day(bucket.starting_at);
    if (date && !inRange(date)) continue;
    const dayTotals = tokensByDay.get(date) ?? emptyTokens();
    for (const r of bucket.results) {
      addUsage(dayTotals, r);
      addUsage(overall, r);
      const key = r.model ?? "other";
      const modelTotals = tokensByModel.get(key) ?? emptyTokens();
      addUsage(modelTotals, r);
      tokensByModel.set(key, modelTotals);

      const rTokens =
        r.uncached_input_tokens +
        r.cache_read_input_tokens +
        r.cache_creation.ephemeral_1h_input_tokens +
        r.cache_creation.ephemeral_5m_input_tokens +
        r.output_tokens;
      let dayModel = tokensByDayModel.get(date);
      if (!dayModel) {
        dayModel = new Map();
        tokensByDayModel.set(date, dayModel);
      }
      dayModel.set(key, (dayModel.get(key) ?? 0) + rTokens);
    }
    tokensByDay.set(date, dayTotals);
  }

  const costByDay = new Map<string, number>();
  const costByModel = new Map<string, number>();
  let totalCostUsd = 0;
  for (const bucket of inputs.costByModel) {
    const date = day(bucket.starting_at);
    if (date && !inRange(date)) continue;
    for (const r of bucket.results) {
      const usd = centsToUsd(r.amount);
      totalCostUsd += usd;
      costByDay.set(date, (costByDay.get(date) ?? 0) + usd);
      const key = r.model ?? "other";
      costByModel.set(key, (costByModel.get(key) ?? 0) + usd);
    }
  }

  const costTypeMap = new Map<string, number>();
  for (const bucket of inputs.costByTypeBuckets) {
    for (const r of bucket.results) {
      const type = r.cost_type ?? "other";
      costTypeMap.set(type, (costTypeMap.get(type) ?? 0) + centsToUsd(r.amount));
    }
  }

  const productTokens = new Map<string, number>();
  for (const bucket of inputs.usageByProduct) {
    for (const r of bucket.results) {
      const key = r.product ?? "other";
      const t = emptyTokens();
      addUsage(t, r);
      productTokens.set(key, (productTokens.get(key) ?? 0) + tokenSum(t));
    }
  }
  let productCost = new Map<string, number>();
  for (const bucket of inputs.costByProduct) {
    for (const r of bucket.results) {
      const key = r.product ?? "other";
      productCost.set(key, (productCost.get(key) ?? 0) + centsToUsd(r.amount));
    }
  }
  if (filteredUserId && hasCostMismatch(sumValues(productCost.values()), totalCostUsd)) {
    const productWeights = productTokens.size > 0 ? productTokens : new Map([...productCost.keys()].map((key) => [key, productCost.get(key) ?? 0]));
    productCost = allocateCosts(productWeights, totalCostUsd);
  }

  const allDates = new Set<string>([...tokensByDay.keys(), ...costByDay.keys()]);
  const timeseries: TimePoint[] = [...allDates].sort().map((date) => {
    const t = tokensByDay.get(date) ?? emptyTokens();
    return {
      date,
      uncachedInputTokens: t.uncachedInputTokens,
      cacheReadTokens: t.cacheReadTokens,
      cacheCreationTokens: t.cacheCreationTokens,
      outputTokens: t.outputTokens,
      totalTokens: tokenSum(t),
      costUsd: round2(costByDay.get(date) ?? 0),
    };
  });

  const modelKeys = new Set<string>([...tokensByModel.keys(), ...costByModel.keys()]);
  const byModel: ModelBreakdown[] = [...modelKeys]
    .map((model) => {
      const t = tokensByModel.get(model) ?? emptyTokens();
      return {
        model,
        uncachedInputTokens: t.uncachedInputTokens,
        cacheReadTokens: t.cacheReadTokens,
        cacheCreationTokens: t.cacheCreationTokens,
        outputTokens: t.outputTokens,
        totalTokens: tokenSum(t),
        costUsd: round2(costByModel.get(model) ?? 0),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const costByType: CostTypeBreakdown[] = [...costTypeMap.entries()]
    .map(([costType, costUsd]) => ({ costType, costUsd: round2(costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const modelOrder = [...tokensByModel.entries()]
    .sort((a, b) => tokenSum(b[1]) - tokenSum(a[1]))
    .map(([model]) => model);
  const modelTimeseries: ModelTimePoint[] = [...allDates].sort().map((date) => {
    const values: Record<string, number> = {};
    const dm = tokensByDayModel.get(date);
    if (dm) for (const [model, v] of dm) values[model] = v;
    return { date, values };
  });

  const productKeys = new Set<string>([...productTokens.keys(), ...productCost.keys()]);
  const byProduct: ProductBreakdown[] = [...productKeys]
    .map((product) => ({
      product: PRODUCT_LABELS[product] ?? product,
      totalTokens: productTokens.get(product) ?? 0,
      costUsd: round2(productCost.get(product) ?? 0),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const users = new Map<string, UserBreakdown>();
  const ensureUser = (userId: string, name: string | null, email: string | null, deleted: boolean): UserBreakdown => {
    let u = users.get(userId);
    if (!u) {
      u = {
        userId,
        name: name || email || userId,
        email: email ?? null,
        deleted,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        cacheHitRate: 0,
        totalTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        requests: 0,
      };
      users.set(userId, u);
    }
    return u;
  };
  for (const row of inputs.userUsage) {
    const date = day(row.starting_at);
    if (date && !inRange(date)) continue;
    const u = ensureUser(row.actor.user_id, row.actor.name, row.actor.email, row.actor.deleted ?? false);
    u.uncachedInputTokens = (u.uncachedInputTokens ?? 0) + row.uncached_input_tokens;
    u.cacheReadTokens = (u.cacheReadTokens ?? 0) + row.cache_read_input_tokens;
    u.totalTokens += row.total_tokens;
    u.outputTokens += row.output_tokens;
    u.requests += row.requests ?? 0;
  }
  for (const row of inputs.userCost) {
    const date = day(row.starting_at);
    if (date && !inRange(date)) continue;
    const u = ensureUser(row.actor.user_id, row.actor.name, row.actor.email, row.actor.deleted ?? false);
    u.costUsd += centsToUsd(row.amount);
  }
  if (filteredUserId && hasCostMismatch(sumValues([...users.values()].map((user) => user.costUsd)), totalCostUsd)) {
    const userWeights = new Map(
      [...users.values()].map((user) => [user.userId, user.totalTokens > 0 ? user.totalTokens : user.requests]),
    );
    const allocatedUserCost = allocateCosts(userWeights, totalCostUsd);
    for (const user of users.values()) user.costUsd = allocatedUserCost.get(user.userId) ?? 0;
  }
  const byUser: UserBreakdown[] = [...users.values()]
    .map((u) => ({
      ...u,
      cacheHitRate: buildCacheHitRate(u.uncachedInputTokens ?? 0, u.cacheReadTokens ?? 0),
      costUsd: round2(u.costUsd),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const groupsByUserId = new Map<string, GroupReference[]>();
  const groupsByEmail = new Map<string, GroupReference[]>();
  const groupMemberCounts = new Map<string, number>();
  const groupDirectory = new Map<string, GroupReference>();

  if (inputs.groupConfig && inputs.groupConfig.length > 0) {
    for (const group of inputs.groupConfig) {
      const reference = { groupId: group.groupId, name: group.name, roleNames: group.roleNames ?? [] };
      groupDirectory.set(group.groupId, reference);

      const memberIds = new Set<string>();
      const memberEmails = new Set<string>();
      for (const member of group.members) {
        if (member.userId) {
          memberIds.add(member.userId);
          appendGroupReference(groupsByUserId, member.userId, reference);
        }
        if (member.email) {
          const emailKey = member.email.toLowerCase();
          memberEmails.add(emailKey);
          appendGroupReference(groupsByEmail, emailKey, reference);
        }
      }
      groupMemberCounts.set(group.groupId, memberIds.size > 0 ? memberIds.size : memberEmails.size);
    }
  }

  for (const user of byUser) {
    const assignedGroups = [
      ...(groupsByUserId.get(user.userId) ?? []),
      ...((user.email ? groupsByEmail.get(user.email.toLowerCase()) : []) ?? []),
    ];
    if (assignedGroups.length === 0) continue;

    const uniqueGroups = [...new Map(assignedGroups.map((group) => [group.groupId, group])).values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    user.groups = uniqueGroups;
    user.effectiveRoles = [
      ...new Map<string, UserRoleAssignment>(
        uniqueGroups.flatMap((group) =>
          (group.roleNames ?? []).map((roleName) => [roleName, { roleId: roleName, name: roleName }] as const),
        ),
      ).values(),
    ].sort((left, right) => left.name.localeCompare(right.name));
  }

  let byGroup: GroupBreakdown[] | undefined;
  if (groupDirectory.size > 0) {
    const groups = new Map<string, GroupBreakdown>();
    for (const [groupId, group] of groupDirectory) {
      groups.set(groupId, {
        groupId,
        name: group.name,
        roleNames: group.roleNames ?? [],
        memberCount: groupMemberCounts.get(groupId) ?? 0,
        totalTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        requests: 0,
      });
    }

    for (const u of byUser) {
      for (const group of u.groups ?? []) {
        let g = groups.get(group.groupId);
        if (!g) {
          g = {
            groupId: group.groupId,
            name: group.name,
            roleNames: group.roleNames ?? [],
            memberCount: 0,
            totalTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            requests: 0,
          };
          groups.set(group.groupId, g);
        }
        g.totalTokens += u.totalTokens;
        g.outputTokens += u.outputTokens;
        g.costUsd += u.costUsd;
        g.requests += u.requests;
      }
    }

    const activeGroups = [...groups.values()].filter(
      (group) => group.totalTokens > 0 || group.outputTokens > 0 || group.costUsd > 0 || group.requests > 0,
    );

    if (activeGroups.length > 0) {
      byGroup = activeGroups
        .map((g) => ({ ...g, costUsd: round2(g.costUsd) }))
        .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
    }
  }

  let activity: ActivitySnapshot | undefined;
  if (inputs.summaries.length > 0) {
    const latest = [...inputs.summaries].sort((a, b) => a.starting_at.localeCompare(b.starting_at)).at(-1)!;
    activity = {
      date: day(latest.starting_at),
      assignedSeats: latest.assigned_seat_count,
      pendingInvites: latest.pending_invite_count,
      dailyActiveUsers: latest.daily_active_user_count,
      weeklyActiveUsers: latest.weekly_active_user_count,
      monthlyActiveUsers: latest.monthly_active_user_count,
      dailyAdoptionRate: round2(latest.daily_adoption_rate),
      weeklyAdoptionRate: round2(latest.weekly_adoption_rate),
      monthlyAdoptionRate: round2(latest.monthly_adoption_rate),
    };
  }

  const cacheDenominator = overall.cacheReadTokens + overall.uncachedInputTokens;

  return {
    summary: {
      totalCostUsd: round2(totalCostUsd),
      totalTokens: tokenSum(overall),
      uncachedInputTokens: overall.uncachedInputTokens,
      cacheReadTokens: overall.cacheReadTokens,
      cacheCreationTokens: overall.cacheCreationTokens,
      outputTokens: overall.outputTokens,
      webSearchRequests: overall.webSearchRequests,
      cacheHitRate: cacheDenominator > 0 ? round2((overall.cacheReadTokens / cacheDenominator) * 100) : 0,
    },
    timeseries,
    byModel,
    modelTimeseries,
    modelKeys: modelOrder,
    costByType,
    byProduct,
    byUser,
    byGroup,
    activity,
  };
}

const buildComparison = (currentValue: number, previousValue: number, label: string): MetricComparison => {
  const deltaValue = currentValue - previousValue;
  const deltaPercent = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : (deltaValue / previousValue) * 100;
  const direction = deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "same";
  return {
    previousValue,
    deltaValue,
    deltaPercent,
    direction,
    label,
  };
};

export function buildAnalyticsComparisonSnapshot(
  inputs: AnalyticsInputs,
  bounds: RangeBounds,
  filteredUserId?: string,
): AnalyticsComparisonSnapshot {
  const aggregate = buildRangeAggregate(inputs, bounds, filteredUserId);
  return {
    summary: aggregate.summary,
    byModel: aggregate.byModel,
    byProduct: aggregate.byProduct,
    byUser: aggregate.byUser,
    byGroup: aggregate.byGroup,
    activity: aggregate.activity,
  };
}

export function buildAnalyticsDashboard(
  inputs: AnalyticsInputs,
  meta: { startingAt: string; endingAt: string },
  previousSnapshot?: AnalyticsComparisonSnapshot,
  filteredUserId?: string,
): DashboardPayload {
  const current = buildRangeAggregate(inputs, {
    startingAt: meta.startingAt,
    endingAt: meta.endingAt,
  }, filteredUserId);

  const buildComparison = (currentValue: number, previousValue: number, label: string): MetricComparison => {
    const deltaValue = currentValue - previousValue;
    const deltaPercent = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : (deltaValue / previousValue) * 100;
    const direction = deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "same";
    return { previousValue, deltaValue, deltaPercent, direction, label };
  };

  const previousByUser = new Map((previousSnapshot?.byUser ?? []).map((user) => [user.userId, user]));
  const previousByModel = new Map((previousSnapshot?.byModel ?? []).map((model) => [model.model, model]));
  const previousByProduct = new Map((previousSnapshot?.byProduct ?? []).map((product) => [product.product, product]));
  const previousByGroup = new Map((previousSnapshot?.byGroup ?? []).map((group) => [group.groupId, group]));
  const byModel = current.byModel.map((model) => {
    const previousModel = previousByModel.get(model.model);
    return previousModel
      ? { ...model, costComparison: buildComparison(model.costUsd, previousModel.costUsd, "the previous period") }
      : model;
  });
  const byProduct = current.byProduct.map((product) => {
    const previousProduct = previousByProduct.get(product.product);
    return previousProduct
      ? { ...product, costComparison: buildComparison(product.costUsd, previousProduct.costUsd, "the previous period") }
      : product;
  });
  const byUser = current.byUser.map((user) => {
    const previousUser = previousByUser.get(user.userId);
    return previousUser
      ? {
          ...user,
          totalTokensComparison: buildComparison(user.totalTokens, previousUser.totalTokens, "the previous period"),
          costComparison: buildComparison(user.costUsd, previousUser.costUsd, "the previous period"),
        }
      : user;
  });
  const byGroup = (current.byGroup ?? []).map((group) => {
    const previousGroup = previousByGroup.get(group.groupId);
    return previousGroup
      ? { ...group, costComparison: buildComparison(group.costUsd, previousGroup.costUsd, "the previous period") }
      : group;
  });

  const activity = current.activity
    ? {
        ...current.activity,
        comparisons: previousSnapshot?.activity
          ? {
              assignedSeats: buildComparison(current.activity.assignedSeats, previousSnapshot.activity.assignedSeats, "the previous period"),
              dailyActiveUsers: buildComparison(current.activity.dailyActiveUsers, previousSnapshot.activity.dailyActiveUsers, "the previous period"),
              weeklyActiveUsers: buildComparison(current.activity.weeklyActiveUsers, previousSnapshot.activity.weeklyActiveUsers, "the previous period"),
              monthlyActiveUsers: buildComparison(current.activity.monthlyActiveUsers, previousSnapshot.activity.monthlyActiveUsers, "the previous period"),
            }
          : undefined,
      }
    : undefined;

  const summary = {
    ...current.summary,
    comparisons: previousSnapshot
      ? {
          totalCostUsd: buildComparison(current.summary.totalCostUsd, previousSnapshot.summary.totalCostUsd, "the previous period"),
          totalTokens: buildComparison(current.summary.totalTokens, previousSnapshot.summary.totalTokens, "the previous period"),
          outputTokens: buildComparison(current.summary.outputTokens, previousSnapshot.summary.outputTokens, "the previous period"),
          cacheHitRate: buildComparison(current.summary.cacheHitRate, previousSnapshot.summary.cacheHitRate, "the previous period"),
          webSearchRequests: buildComparison(
            current.summary.webSearchRequests,
            previousSnapshot.summary.webSearchRequests,
            "the previous period",
          ),
        }
      : undefined,
  };

  return {
    source: "analytics",
    range: { startingAt: meta.startingAt, endingAt: meta.endingAt, bucketWidth: "1d" },
    summary,
    timeseries: current.timeseries,
    byModel,
    modelTimeseries: current.modelTimeseries,
    modelKeys: current.modelKeys,
    costByType: current.costByType,
    byUser,
    userStats: computeUserStats(byUser),
    byProduct,
    byGroup,
    activity,
    dataRefreshedAt: inputs.dataRefreshedAt,
    generatedAt: new Date().toISOString(),
  };
}
