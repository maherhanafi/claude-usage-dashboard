import type {
  CostBucket,
  CostTypeBreakdown,
  DashboardPayload,
  DashboardSource,
  MetricComparison,
  ModelBreakdown,
  ModelTimePoint,
  TimePoint,
  UsageBucket,
} from "./types.js";

const day = (rfc3339: string): string => rfc3339.slice(0, 10);

/** Cost amounts come back as decimal strings in cents; convert to dollars. */
const centsToUsd = (amount: string): number => {
  const n = Number.parseFloat(amount);
  return Number.isFinite(n) ? n / 100 : 0;
};

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

const round2 = (n: number): number => Math.round(n * 100) / 100;

const inRange = (date: string, bounds?: RangeBounds): boolean => {
  if (!bounds) return true;
  const start = day(bounds.startingAt);
  const end = day(bounds.endingAt);
  return date >= start && date < end;
};

function buildRangeAggregate(
  usageBuckets: UsageBucket[],
  costBuckets: CostBucket[],
  bounds?: RangeBounds,
): RangeAggregate {
  const tokensByDay = new Map<string, TokenTotals>();
  const tokensByModel = new Map<string, TokenTotals>();
  const tokensByDayModel = new Map<string, Map<string, number>>();
  const overall = emptyTokens();

  for (const bucket of usageBuckets) {
    const date = day(bucket.starting_at);
    if (!inRange(date, bounds)) continue;
    const dayTotals = tokensByDay.get(date) ?? emptyTokens();
    for (const r of bucket.results) {
      const cacheCreation =
        r.cache_creation.ephemeral_1h_input_tokens + r.cache_creation.ephemeral_5m_input_tokens;
      const add = (t: TokenTotals) => {
        t.uncachedInputTokens += r.uncached_input_tokens;
        t.cacheReadTokens += r.cache_read_input_tokens;
        t.cacheCreationTokens += cacheCreation;
        t.outputTokens += r.output_tokens;
        t.webSearchRequests += r.server_tool_use.web_search_requests;
      };
      add(dayTotals);
      add(overall);
      const modelKey = r.model ?? "unattributed";
      const modelTotals = tokensByModel.get(modelKey) ?? emptyTokens();
      add(modelTotals);
      tokensByModel.set(modelKey, modelTotals);

      const rTokens =
        r.uncached_input_tokens + r.cache_read_input_tokens + cacheCreation + r.output_tokens;
      let dayModel = tokensByDayModel.get(date);
      if (!dayModel) {
        dayModel = new Map();
        tokensByDayModel.set(date, dayModel);
      }
      dayModel.set(modelKey, (dayModel.get(modelKey) ?? 0) + rTokens);
    }
    tokensByDay.set(date, dayTotals);
  }

  const costByDay = new Map<string, number>();
  const costByModel = new Map<string, number>();
  const costByType = new Map<string, number>();
  let totalCostUsd = 0;

  for (const bucket of costBuckets) {
    const date = day(bucket.starting_at);
    if (!inRange(date, bounds)) continue;
    for (const r of bucket.results) {
      const usd = centsToUsd(r.amount);
      totalCostUsd += usd;
      costByDay.set(date, (costByDay.get(date) ?? 0) + usd);
      if (r.model) costByModel.set(r.model, (costByModel.get(r.model) ?? 0) + usd);
      const type = r.cost_type ?? "other";
      costByType.set(type, (costByType.get(type) ?? 0) + usd);
    }
  }

  const allDates = new Set<string>([...tokensByDay.keys(), ...costByDay.keys()]);
  const timeseries: TimePoint[] = [...allDates]
    .sort()
    .map((date) => {
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

  const costTypeBreakdown: CostTypeBreakdown[] = [...costByType.entries()]
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
    costByType: costTypeBreakdown,
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

export function buildDashboard(
  usageBuckets: UsageBucket[],
  costBuckets: CostBucket[],
  meta: { source: DashboardSource; startingAt: string; endingAt: string; bucketWidth: string },
  comparisonBounds?: RangeBounds,
): DashboardPayload {
  const current = buildRangeAggregate(usageBuckets, costBuckets, {
    startingAt: meta.startingAt,
    endingAt: meta.endingAt,
  });
  const previous = comparisonBounds
    ? buildRangeAggregate(usageBuckets, costBuckets, comparisonBounds)
    : undefined;

  const summary = {
    ...current.summary,
    comparisons: previous
      ? {
          totalCostUsd: buildComparison(current.summary.totalCostUsd, previous.summary.totalCostUsd, "the previous period"),
          totalTokens: buildComparison(current.summary.totalTokens, previous.summary.totalTokens, "the previous period"),
          outputTokens: buildComparison(current.summary.outputTokens, previous.summary.outputTokens, "the previous period"),
          cacheHitRate: buildComparison(current.summary.cacheHitRate, previous.summary.cacheHitRate, "the previous period"),
          webSearchRequests: buildComparison(
            current.summary.webSearchRequests,
            previous.summary.webSearchRequests,
            "the previous period",
          ),
        }
      : undefined,
  };

  const previousByModel = new Map((previous?.byModel ?? []).map((model) => [model.model, model]));
  const byModel = current.byModel.map((model) => {
    const previousModel = previousByModel.get(model.model);
    return previousModel
      ? { ...model, costComparison: buildComparison(model.costUsd, previousModel.costUsd, "the previous period") }
      : model;
  });

  return {
    source: meta.source,
    range: { startingAt: meta.startingAt, endingAt: meta.endingAt, bucketWidth: meta.bucketWidth },
    summary,
    timeseries: current.timeseries,
    byModel,
    modelTimeseries: current.modelTimeseries,
    modelKeys: current.modelKeys,
    costByType: current.costByType,
    generatedAt: new Date().toISOString(),
  };
}
