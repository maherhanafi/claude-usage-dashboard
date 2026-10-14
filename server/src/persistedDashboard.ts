import type {
  ActivitySnapshot,
  CostTypeBreakdown,
  DashboardPayload,
  GroupBreakdown,
  MetricComparison,
  ModelBreakdown,
  ModelTimePoint,
  ProductBreakdown,
  TimePoint,
  UserBreakdown,
} from "./types.js";
import { DASHBOARD_SNAPSHOT_VERSION } from "./types.js";
import { computeUserStats } from "./userStats.js";

interface RangeBounds {
  startingAt: string;
  endingAt: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const buildComparison = (currentValue: number, previousValue: number, label: string): MetricComparison => {
  const deltaValue = currentValue - previousValue;
  const deltaPercent = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : (deltaValue / previousValue) * 100;
  const direction = deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "same";
  return { previousValue, deltaValue, deltaPercent, direction, label };
};

function mergeTimeseries(points: TimePoint[]): TimePoint[] {
  const merged = new Map<string, TimePoint>();
  for (const point of points) {
    const current = merged.get(point.date) ?? {
      date: point.date,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    current.uncachedInputTokens += point.uncachedInputTokens;
    current.cacheReadTokens += point.cacheReadTokens;
    current.cacheCreationTokens += point.cacheCreationTokens;
    current.outputTokens += point.outputTokens;
    current.totalTokens += point.totalTokens;
    current.costUsd += point.costUsd;
    merged.set(point.date, current);
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).map((point) => ({
    ...point,
    costUsd: round2(point.costUsd),
  }));
}

function mergeByModel(rows: ModelBreakdown[]): ModelBreakdown[] {
  const merged = new Map<string, ModelBreakdown>();
  for (const row of rows) {
    const current = merged.get(row.model) ?? {
      model: row.model,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    current.uncachedInputTokens += row.uncachedInputTokens;
    current.cacheReadTokens += row.cacheReadTokens;
    current.cacheCreationTokens += row.cacheCreationTokens;
    current.outputTokens += row.outputTokens;
    current.totalTokens += row.totalTokens;
    current.costUsd += row.costUsd;
    merged.set(row.model, current);
  }
  return [...merged.values()]
    .map((row) => ({ ...row, costUsd: round2(row.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

function mergeByModelWithComparison(rows: ModelBreakdown[], previousRows?: ModelBreakdown[]): ModelBreakdown[] {
  const merged = mergeByModel(rows);
  const previousByModel = new Map((previousRows ? mergeByModel(previousRows) : []).map((row) => [row.model, row]));
  return merged.map((row) => {
    const previous = previousByModel.get(row.model);
    return {
      ...row,
      costComparison: previous ? buildComparison(row.costUsd, previous.costUsd, "the previous period") : undefined,
    };
  });
}

function mergeModelTimeseries(points: ModelTimePoint[]): ModelTimePoint[] {
  const merged = new Map<string, Record<string, number>>();
  for (const point of points) {
    const current = merged.get(point.date) ?? {};
    for (const [model, value] of Object.entries(point.values)) {
      current[model] = (current[model] ?? 0) + value;
    }
    merged.set(point.date, current);
  }
  return [...merged.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({ date, values }));
}

function mergeCostByType(rows: CostTypeBreakdown[]): CostTypeBreakdown[] {
  const merged = new Map<string, number>();
  for (const row of rows) merged.set(row.costType, (merged.get(row.costType) ?? 0) + row.costUsd);
  return [...merged.entries()]
    .map(([costType, costUsd]) => ({ costType, costUsd: round2(costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function mergeByProduct(rows: ProductBreakdown[]): ProductBreakdown[] {
  const merged = new Map<string, ProductBreakdown>();
  for (const row of rows) {
    const current = merged.get(row.product) ?? { product: row.product, totalTokens: 0, costUsd: 0 };
    current.totalTokens += row.totalTokens;
    current.costUsd += row.costUsd;
    merged.set(row.product, current);
  }
  return [...merged.values()]
    .map((row) => ({ ...row, costUsd: round2(row.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

function mergeByProductWithComparison(rows: ProductBreakdown[], previousRows?: ProductBreakdown[]): ProductBreakdown[] {
  const merged = mergeByProduct(rows);
  const previousByProduct = new Map((previousRows ? mergeByProduct(previousRows) : []).map((row) => [row.product, row]));
  return merged.map((row) => {
    const previous = previousByProduct.get(row.product);
    return {
      ...row,
      costComparison: previous ? buildComparison(round2(row.costUsd), round2(previous.costUsd), "the previous period") : undefined,
    };
  });
}

function mergeByUser(rows: UserBreakdown[], previousRows?: UserBreakdown[]): UserBreakdown[] {
  const merged = new Map<string, UserBreakdown>();
  for (const row of rows) {
    const current = merged.get(row.userId) ?? {
      userId: row.userId,
      name: row.name,
      email: row.email,
      deleted: row.deleted,
      groups: row.groups,
      effectiveRoles: row.effectiveRoles,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      totalTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requests: 0,
    };
    current.uncachedInputTokens = (current.uncachedInputTokens ?? 0) + (row.uncachedInputTokens ?? 0);
    current.cacheReadTokens = (current.cacheReadTokens ?? 0) + (row.cacheReadTokens ?? 0);
    current.totalTokens += row.totalTokens;
    current.outputTokens += row.outputTokens;
    current.costUsd += row.costUsd;
    current.requests += row.requests;
    current.deleted = current.deleted && row.deleted;
    current.email = current.email ?? row.email;
    current.groups = current.groups ?? row.groups;
    current.effectiveRoles = current.effectiveRoles ?? row.effectiveRoles;
    merged.set(row.userId, current);
  }

  const previousByUser = new Map((previousRows ?? []).map((row) => [row.userId, row]));
  return [...merged.values()]
    .map((row) => {
      const previous = previousByUser.get(row.userId);
      return {
        ...row,
        cacheHitRate:
          (row.uncachedInputTokens ?? 0) + (row.cacheReadTokens ?? 0) > 0
            ? round2(((row.cacheReadTokens ?? 0) / ((row.uncachedInputTokens ?? 0) + (row.cacheReadTokens ?? 0))) * 100)
            : 0,
        costUsd: round2(row.costUsd),
        totalTokensComparison: previous
          ? buildComparison(row.totalTokens, previous.totalTokens, "the previous period")
          : undefined,
        costComparison: previous ? buildComparison(round2(row.costUsd), round2(previous.costUsd), "the previous period") : undefined,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

function mergeByGroup(rows: GroupBreakdown[]): GroupBreakdown[] {
  const merged = new Map<string, GroupBreakdown>();
  for (const row of rows) {
    const current = merged.get(row.groupId) ?? {
      groupId: row.groupId,
      name: row.name,
      roleNames: row.roleNames,
      memberCount: 0,
      totalTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requests: 0,
    };
    current.memberCount = Math.max(current.memberCount, row.memberCount);
    current.totalTokens += row.totalTokens;
    current.outputTokens += row.outputTokens;
    current.costUsd += row.costUsd;
    current.requests += row.requests;
    current.roleNames = current.roleNames ?? row.roleNames;
    merged.set(row.groupId, current);
  }
  return [...merged.values()]
    .map((row) => ({ ...row, costUsd: round2(row.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

function mergeByGroupWithComparison(rows: GroupBreakdown[], previousRows?: GroupBreakdown[]): GroupBreakdown[] {
  const merged = mergeByGroup(rows);
  const previousByGroup = new Map((previousRows ? mergeByGroup(previousRows) : []).map((row) => [row.groupId, row]));
  return merged.map((row) => {
    const previous = previousByGroup.get(row.groupId);
    return {
      ...row,
      costComparison: previous ? buildComparison(round2(row.costUsd), round2(previous.costUsd), "the previous period") : undefined,
    };
  });
}

function pickLatestActivity(items: ActivitySnapshot[]): ActivitySnapshot | undefined {
  return [...items].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}

function buildActivityWithComparison(current: ActivitySnapshot | undefined, previous: ActivitySnapshot | undefined): ActivitySnapshot | undefined {
  if (!current) return undefined;
  if (!previous) return current;
  return {
    ...current,
    comparisons: {
      assignedSeats: buildComparison(current.assignedSeats, previous.assignedSeats, "the previous period"),
      dailyActiveUsers: buildComparison(current.dailyActiveUsers, previous.dailyActiveUsers, "the previous period"),
      weeklyActiveUsers: buildComparison(current.weeklyActiveUsers, previous.weeklyActiveUsers, "the previous period"),
      monthlyActiveUsers: buildComparison(current.monthlyActiveUsers, previous.monthlyActiveUsers, "the previous period"),
    },
  };
}

function mergeWarnings(payloads: DashboardPayload[]): string[] | undefined {
  const merged = [...new Set(payloads.flatMap((payload) => payload.warnings ?? []).filter(Boolean))];
  return merged.length > 0 ? merged : undefined;
}

function mergeRangePayload(payloads: DashboardPayload[], previousPayloads?: DashboardPayload[]): DashboardPayload | null {
  if (payloads.length === 0) return null;

  const timeseries = mergeTimeseries(payloads.flatMap((payload) => payload.timeseries));
  const previousByModel = previousPayloads?.flatMap((payload) => payload.byModel ?? []);
  const byModel = mergeByModelWithComparison(payloads.flatMap((payload) => payload.byModel), previousByModel);
  const modelTimeseries = mergeModelTimeseries(payloads.flatMap((payload) => payload.modelTimeseries));
  const costByType = mergeCostByType(payloads.flatMap((payload) => payload.costByType));
  const previousByUser = previousPayloads?.flatMap((payload) => payload.byUser ?? []);
  const byUser = payloads.some((payload) => payload.byUser)
    ? mergeByUser(payloads.flatMap((payload) => payload.byUser ?? []), previousByUser)
    : undefined;
  const previousByProduct = previousPayloads?.flatMap((payload) => payload.byProduct ?? []);
  const byProduct = payloads.some((payload) => payload.byProduct)
    ? mergeByProductWithComparison(payloads.flatMap((payload) => payload.byProduct ?? []), previousByProduct)
    : undefined;
  const previousByGroup = previousPayloads?.flatMap((payload) => payload.byGroup ?? []);
  const byGroup = payloads.some((payload) => payload.byGroup)
    ? mergeByGroupWithComparison(payloads.flatMap((payload) => payload.byGroup ?? []), previousByGroup)
    : undefined;
  const activity = buildActivityWithComparison(
    pickLatestActivity(payloads.flatMap((payload) => (payload.activity ? [payload.activity] : []))),
    previousPayloads ? pickLatestActivity(previousPayloads.flatMap((payload) => (payload.activity ? [payload.activity] : []))) : undefined,
  );

  const summary = {
    totalCostUsd: round2(timeseries.reduce((sum, point) => sum + point.costUsd, 0)),
    totalTokens: timeseries.reduce((sum, point) => sum + point.totalTokens, 0),
    uncachedInputTokens: timeseries.reduce((sum, point) => sum + point.uncachedInputTokens, 0),
    cacheReadTokens: timeseries.reduce((sum, point) => sum + point.cacheReadTokens, 0),
    cacheCreationTokens: timeseries.reduce((sum, point) => sum + point.cacheCreationTokens, 0),
    outputTokens: timeseries.reduce((sum, point) => sum + point.outputTokens, 0),
    webSearchRequests: timeseries.reduce((sum, point) => sum + (point as TimePoint).totalTokens * 0 + 0, 0),
    cacheHitRate: 0,
  };
  summary.webSearchRequests = payloads.reduce((sum, payload) => sum + payload.summary.webSearchRequests, 0);
  const cacheDenominator = summary.cacheReadTokens + summary.uncachedInputTokens;
  summary.cacheHitRate = cacheDenominator > 0 ? round2((summary.cacheReadTokens / cacheDenominator) * 100) : 0;

  const previous = previousPayloads ? mergeRangePayload(previousPayloads) : null;

  return {
    snapshotVersion: DASHBOARD_SNAPSHOT_VERSION,
    source: payloads[0].source,
    range: payloads[0].range,
    summary: {
      ...summary,
      comparisons: previous
        ? {
            totalCostUsd: buildComparison(summary.totalCostUsd, previous.summary.totalCostUsd, "the previous period"),
            totalTokens: buildComparison(summary.totalTokens, previous.summary.totalTokens, "the previous period"),
            outputTokens: buildComparison(summary.outputTokens, previous.summary.outputTokens, "the previous period"),
            cacheHitRate: buildComparison(summary.cacheHitRate, previous.summary.cacheHitRate, "the previous period"),
            webSearchRequests: buildComparison(summary.webSearchRequests, previous.summary.webSearchRequests, "the previous period"),
          }
        : undefined,
    },
    timeseries,
    byModel,
    modelTimeseries,
    modelKeys: byModel.map((row) => row.model),
    costByType,
    byUser,
    userStats: byUser ? computeUserStats(byUser) : undefined,
    byProduct,
    byGroup,
    activity,
    warnings: mergeWarnings(payloads),
    dataRefreshedAt: payloads.map((payload) => payload.dataRefreshedAt).filter((value): value is string => Boolean(value)).sort().at(-1),
    generatedAt: new Date().toISOString(),
  };
}

export function composePersistedDashboard(
  currentPayloads: DashboardPayload[],
  range: RangeBounds,
  previousPayloads?: DashboardPayload[],
): DashboardPayload | null {
  const composed = mergeRangePayload(currentPayloads, previousPayloads);
  if (!composed) return null;
  return {
    ...composed,
    range: {
      ...composed.range,
      startingAt: range.startingAt,
      endingAt: range.endingAt,
      bucketWidth: "1d",
    },
  };
}