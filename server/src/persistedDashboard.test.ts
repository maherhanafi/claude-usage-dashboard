import { describe, expect, it } from "vitest";
import { composePersistedDashboard } from "./persistedDashboard.js";
import type { DashboardPayload } from "./types.js";

function dailyPayload(date: string, overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    source: "analytics",
    range: {
      startingAt: `${date}T00:00:00.000Z`,
      endingAt: `${date}T23:59:59.999Z`,
      bucketWidth: "1d",
    },
    summary: {
      totalCostUsd: 10,
      totalTokens: 100,
      uncachedInputTokens: 40,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      outputTokens: 45,
      webSearchRequests: 2,
      cacheHitRate: 20,
    },
    timeseries: [
      {
        date,
        uncachedInputTokens: 40,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
        outputTokens: 45,
        totalTokens: 100,
        costUsd: 10,
      },
    ],
    byModel: [
      {
        model: "claude-sonnet",
        uncachedInputTokens: 40,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
        outputTokens: 45,
        totalTokens: 100,
        costUsd: 10,
      },
    ],
    modelTimeseries: [{ date, values: { "claude-sonnet": 100 } }],
    modelKeys: ["claude-sonnet"],
    costByType: [{ costType: "tokens", costUsd: 10 }],
    byUser: [
      {
        userId: "u1",
        name: "Ada",
        email: "ada@example.com",
        deleted: false,
        totalTokens: 100,
        outputTokens: 45,
        costUsd: 10,
        requests: 3,
      },
    ],
    byProduct: [{ product: "Claude Code", totalTokens: 100, costUsd: 10 }],
    activity: {
      date,
      assignedSeats: 10,
      pendingInvites: 1,
      dailyActiveUsers: 3,
      weeklyActiveUsers: 5,
      monthlyActiveUsers: 7,
      dailyAdoptionRate: 30,
      weeklyAdoptionRate: 50,
      monthlyAdoptionRate: 70,
    },
    generatedAt: `${date}T12:00:00.000Z`,
    ...overrides,
  };
}

describe("composePersistedDashboard", () => {
  it("merges daily snapshots into a historical period and compares against the previous period", () => {
    const current = [dailyPayload("2026-08-01"), dailyPayload("2026-08-02")];
    const previous = [dailyPayload("2026-07-30", { summary: { ...dailyPayload("2026-07-30").summary, totalCostUsd: 5, totalTokens: 50, outputTokens: 20, webSearchRequests: 1, cacheHitRate: 10 }, timeseries: [{ date: "2026-07-30", uncachedInputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 5, outputTokens: 20, totalTokens: 50, costUsd: 5 }], byModel: [{ model: "claude-sonnet", uncachedInputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 5, outputTokens: 20, totalTokens: 50, costUsd: 5 }], modelTimeseries: [{ date: "2026-07-30", values: { "claude-sonnet": 50 } }], costByType: [{ costType: "tokens", costUsd: 5 }], byUser: [{ userId: "u1", name: "Ada", email: "ada@example.com", deleted: false, totalTokens: 50, outputTokens: 20, costUsd: 5, requests: 2 }], byProduct: [{ product: "Claude Code", totalTokens: 50, costUsd: 5 }] }), dailyPayload("2026-07-31", { summary: { ...dailyPayload("2026-07-31").summary, totalCostUsd: 5, totalTokens: 50, outputTokens: 20, webSearchRequests: 1, cacheHitRate: 10 }, timeseries: [{ date: "2026-07-31", uncachedInputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 5, outputTokens: 20, totalTokens: 50, costUsd: 5 }], byModel: [{ model: "claude-sonnet", uncachedInputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 5, outputTokens: 20, totalTokens: 50, costUsd: 5 }], modelTimeseries: [{ date: "2026-07-31", values: { "claude-sonnet": 50 } }], costByType: [{ costType: "tokens", costUsd: 5 }], byUser: [{ userId: "u1", name: "Ada", email: "ada@example.com", deleted: false, totalTokens: 50, outputTokens: 20, costUsd: 5, requests: 2 }], byProduct: [{ product: "Claude Code", totalTokens: 50, costUsd: 5 }] })];

    const payload = composePersistedDashboard(current, { startingAt: "2026-08-01T00:00:00.000Z", endingAt: "2026-08-03T00:00:00.000Z" }, previous);

    expect(payload?.summary.totalCostUsd).toBe(20);
    expect(payload?.summary.comparisons?.totalCostUsd?.deltaPercent).toBe(100);
    expect(payload?.byModel[0].costComparison?.deltaPercent).toBe(100);
    expect(payload?.byProduct?.[0].costComparison?.deltaPercent).toBe(100);
    expect(payload?.byUser?.[0].totalTokensComparison?.deltaPercent).toBe(300);
    expect(payload?.byUser?.[0].costComparison?.deltaPercent).toBe(300);
    expect(payload?.activity?.comparisons?.assignedSeats?.deltaPercent).toBe(0);
    expect(payload?.activity?.comparisons?.dailyActiveUsers?.deltaPercent).toBe(0);
    expect(payload?.timeseries).toHaveLength(2);
  });
});