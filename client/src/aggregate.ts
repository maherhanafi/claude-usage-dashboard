import type { DashboardPayload, Granularity, ModelTimePoint, TimePoint } from "./types";

function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  const monday = new Date(d.getTime() - (day === 0 ? 6 : day - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === "weekly") return weekStart(date);
  if (granularity === "monthly") return monthStart(date);
  return date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateTimeseries(points: TimePoint[], granularity: Granularity): TimePoint[] {
  if (granularity === "daily") return points;
  const buckets = new Map<string, TimePoint>();
  for (const p of points) {
    const key = bucketKey(p.date, granularity);
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, { ...p, date: key });
    } else {
      b.uncachedInputTokens += p.uncachedInputTokens;
      b.cacheReadTokens += p.cacheReadTokens;
      b.cacheCreationTokens += p.cacheCreationTokens;
      b.outputTokens += p.outputTokens;
      b.totalTokens += p.totalTokens;
      b.costUsd = round2(b.costUsd + p.costUsd);
      b.isFuture = Boolean(b.isFuture && p.isFuture);
    }
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function cumulativeTimeseries(points: TimePoint[]): TimePoint[] {
  let uncachedInputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;

  return points.map((point) => {
    uncachedInputTokens += point.uncachedInputTokens;
    cacheReadTokens += point.cacheReadTokens;
    cacheCreationTokens += point.cacheCreationTokens;
    outputTokens += point.outputTokens;
    totalTokens += point.totalTokens;
    costUsd = round2(costUsd + point.costUsd);

    return {
      ...point,
      uncachedInputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      outputTokens,
      totalTokens,
      costUsd,
    };
  });
}

export function aggregateModelTimeseries(points: ModelTimePoint[], granularity: Granularity, allDates: string[] = []): ModelTimePoint[] {
  const buckets = new Map<string, ModelTimePoint>();
  for (const p of points) {
    const key = bucketKey(p.date, granularity);
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, { date: key, values: { ...p.values }, isFuture: p.isFuture });
    } else {
      for (const [model, v] of Object.entries(p.values)) {
        b.values[model] = (b.values[model] ?? 0) + v;
      }
      b.isFuture = Boolean(b.isFuture && p.isFuture);
    }
  }

  for (const date of allDates) {
    const key = bucketKey(date, granularity);
    if (!buckets.has(key)) buckets.set(key, { date: key, values: {} });
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function cumulativeModelTimeseries(points: ModelTimePoint[]): ModelTimePoint[] {
  const runningTotals: Record<string, number> = {};

  return points.map((point) => {
    const values: Record<string, number> = {};
    for (const [model, value] of Object.entries(point.values)) {
      runningTotals[model] = (runningTotals[model] ?? 0) + value;
    }
    for (const [model, total] of Object.entries(runningTotals)) {
      values[model] = total;
    }
    return { date: point.date, values, isFuture: point.isFuture };
  });
}

export function filterDashboardByModel(payload: DashboardPayload, model: string | null): DashboardPayload {
  if (!model) return payload;

  const filteredByModel = payload.byModel.filter((row) => row.model === model);
  const modelCost = filteredByModel.reduce((sum, row) => sum + row.costUsd, 0);
  const modelTokens = filteredByModel.reduce((sum, row) => sum + row.totalTokens, 0);
  const modelInputTokens = filteredByModel.reduce((sum, row) => sum + row.uncachedInputTokens, 0);
  const modelCacheReadTokens = filteredByModel.reduce((sum, row) => sum + row.cacheReadTokens, 0);
  const modelCacheCreationTokens = filteredByModel.reduce((sum, row) => sum + row.cacheCreationTokens, 0);
  const modelOutputTokens = filteredByModel.reduce((sum, row) => sum + row.outputTokens, 0);

  const summary = {
    ...payload.summary,
    comparisons: undefined,
    totalTokens: modelTokens,
    totalCostUsd: modelCost,
    uncachedInputTokens: modelInputTokens,
    cacheReadTokens: modelCacheReadTokens,
    cacheCreationTokens: modelCacheCreationTokens,
    outputTokens: modelOutputTokens,
    cacheHitRate: modelInputTokens + modelCacheReadTokens > 0 ? (modelCacheReadTokens / (modelInputTokens + modelCacheReadTokens)) * 100 : 0,
  };

  const filteredTimeseries = payload.timeseries.map((point) => {
    const modelPoint = payload.modelTimeseries.find((entry) => entry.date === point.date);
    const modelDayTokens = modelPoint?.values[model] ?? 0;
    const sharedCost = point.totalTokens > 0 && modelDayTokens > 0 ? point.costUsd * (modelDayTokens / point.totalTokens) : 0;
    return {
      ...point,
      uncachedInputTokens: modelDayTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      totalTokens: modelDayTokens,
      costUsd: sharedCost,
    };
  });

  return {
    ...payload,
    summary,
    timeseries: filteredTimeseries,
    byModel: filteredByModel,
    modelTimeseries: payload.modelTimeseries
      .map((point) => ({
        ...point,
        values: Object.fromEntries(Object.entries(point.values).filter(([name]) => name === model)),
      }))
      .filter((point) => Object.keys(point.values).length > 0),
    modelKeys: filteredByModel.map((row) => row.model),
    costByType: [{ costType: "Selected model", costUsd: modelCost }],
    byProduct: [],
    byUser: [],
  };
}
