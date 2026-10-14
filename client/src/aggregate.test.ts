import { describe, expect, it } from "vitest";
import { aggregateModelTimeseries, filterDashboardByModel } from "./aggregate";
import type { DashboardPayload } from "./types";

function createPayload(): DashboardPayload {
  return {
    source: "mock",
    range: { startingAt: "2024-01-01", endingAt: "2024-01-02", bucketWidth: "1d" },
    summary: {
      totalCostUsd: 20,
      totalTokens: 200,
      uncachedInputTokens: 100,
      cacheReadTokens: 50,
      cacheCreationTokens: 20,
      outputTokens: 30,
      webSearchRequests: 5,
      cacheHitRate: 33.3,
    },
    timeseries: [
      {
        date: "2024-01-01",
        uncachedInputTokens: 100,
        cacheReadTokens: 50,
        cacheCreationTokens: 20,
        outputTokens: 30,
        totalTokens: 200,
        costUsd: 20,
      },
    ],
    byModel: [
      {
        model: "claude-3.5-sonnet",
        uncachedInputTokens: 60,
        cacheReadTokens: 30,
        cacheCreationTokens: 10,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 12,
      },
      {
        model: "claude-3.7-sonnet",
        uncachedInputTokens: 40,
        cacheReadTokens: 20,
        cacheCreationTokens: 10,
        outputTokens: 10,
        totalTokens: 80,
        costUsd: 8,
      },
    ],
    modelTimeseries: [
      {
        date: "2024-01-01",
        values: {
          "claude-3.5-sonnet": 120,
          "claude-3.7-sonnet": 80,
        },
      },
    ],
    modelKeys: ["claude-3.5-sonnet", "claude-3.7-sonnet"],
    costByType: [
      { costType: "input", costUsd: 15 },
      { costType: "output", costUsd: 5 },
    ],
    generatedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("filterDashboardByModel", () => {
  it("returns a model-specific summary and series", () => {
    const filtered = filterDashboardByModel(createPayload(), "claude-3.5-sonnet");

    expect(filtered.summary.totalTokens).toBe(120);
    expect(filtered.summary.totalCostUsd).toBe(12);
    expect(filtered.byModel).toEqual([
      {
        model: "claude-3.5-sonnet",
        uncachedInputTokens: 60,
        cacheReadTokens: 30,
        cacheCreationTokens: 10,
        outputTokens: 20,
        totalTokens: 120,
        costUsd: 12,
      },
    ]);
    expect(filtered.modelKeys).toEqual(["claude-3.5-sonnet"]);
  });
});

describe("aggregateModelTimeseries", () => {
  it("fills missing dates with zero-value buckets from the main timeseries timeline", () => {
    expect(
      aggregateModelTimeseries(
        [
          {
            date: "2024-01-02",
            values: {
              "claude-3.5-sonnet": 120,
            },
          },
        ],
        "daily",
        ["2024-01-01", "2024-01-02", "2024-01-03"],
      ),
    ).toEqual([
      { date: "2024-01-01", values: {} },
      { date: "2024-01-02", values: { "claude-3.5-sonnet": 120 } },
      { date: "2024-01-03", values: {} },
    ]);
  });
});
