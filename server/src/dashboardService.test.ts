import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_SNAPSHOT_VERSION, type DashboardPayload } from "./types.js";

const configState = {
  historyWarmupConcurrency: 4,
  source: "analytics",
  persistHistory: true,
  useMock: false,
  mockCurrentDayOfMonth: null as number | null,
  anthropicBaseUrl: "https://api.anthropic.com",
  analysisBaseUrl: "http://localhost:1234/v1",
  analysisApiKey: "",
  analysisModel: "local-model",
};

const getAnalyticsUsageBuckets = vi.fn();
const getAnalyticsCostBuckets = vi.fn();
const getSummaries = vi.fn();
const getUserCost = vi.fn();
const getUserUsage = vi.fn();
const loadDailyDashboardSnapshots = vi.fn();
const loadDashboardSnapshot = vi.fn();
const loadDashboardSnapshotForRange = vi.fn();
const isPersistenceEnabled = vi.fn();
const persistDashboardSnapshot = vi.fn();
const fetchMock = vi.fn();

vi.mock("./config.js", () => ({
  config: configState,
}));

vi.mock("./anthropicAnalytics.js", () => ({
  getCostBuckets: getAnalyticsCostBuckets,
  getSummaries,
  getUsageBuckets: getAnalyticsUsageBuckets,
  getUserCost,
  getUserUsage,
}));

vi.mock("./anthropicAdmin.js", () => ({
  getCostBuckets: vi.fn(),
  getUsageBuckets: vi.fn(),
}));

vi.mock("./groupConfig.js", () => ({
  loadGroupConfig: vi.fn(),
}));

vi.mock("./mock.js", () => ({
  filterMockForUser: vi.fn(),
  filterMockForGroup: vi.fn(),
  generateMockData: vi.fn(),
  generateMockExtras: vi.fn(),
}));

vi.mock("./postgres.js", () => ({
  isPersistenceEnabled,
  loadDailyDashboardSnapshots,
  loadDashboardSnapshot,
  loadDashboardSnapshotForRange,
  persistDashboardSnapshot,
}));

function dailyPayload(date: string, costUsd = 10): DashboardPayload {
  return {
    snapshotVersion: DASHBOARD_SNAPSHOT_VERSION,
    source: "analytics",
    range: {
      startingAt: `${date}T00:00:00.000Z`,
      endingAt: new Date(`${date}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000
        ? new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : `${date}T23:59:59.999Z`,
      bucketWidth: "1d",
    },
    summary: {
      totalCostUsd: costUsd,
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
        costUsd,
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
        costUsd,
      },
    ],
    modelTimeseries: [{ date, values: { "claude-sonnet": 100 } }],
    modelKeys: ["claude-sonnet"],
    costByType: [{ costType: "tokens", costUsd }],
    byUser: [
      {
        userId: "u1",
        name: "Ada",
        email: "ada@example.com",
        deleted: false,
        totalTokens: 100,
        outputTokens: 45,
        costUsd,
        requests: 3,
      },
    ],
    byProduct: [{ product: "Claude Code", totalTokens: 100, costUsd }],
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
  };
}

describe("getDashboard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
    configState.historyWarmupConcurrency = 4;
    configState.source = "analytics";
    configState.persistHistory = true;
    configState.useMock = false;
    configState.mockCurrentDayOfMonth = null;
    configState.anthropicBaseUrl = "https://api.anthropic.com";
    configState.analysisBaseUrl = "http://localhost:1234/v1";
    configState.analysisApiKey = "";
    configState.analysisModel = "local-model";
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:1234"));
    vi.stubGlobal("fetch", fetchMock);

    getAnalyticsUsageBuckets.mockReset();
    getAnalyticsCostBuckets.mockReset();
    getSummaries.mockReset();
    getUserCost.mockReset();
    getUserUsage.mockReset();
    loadDailyDashboardSnapshots.mockReset();
    loadDashboardSnapshot.mockReset();
    loadDashboardSnapshotForRange.mockReset();
    persistDashboardSnapshot.mockReset();

    loadDashboardSnapshotForRange.mockResolvedValue(null);
    loadDashboardSnapshot.mockResolvedValue(null);
    isPersistenceEnabled.mockReturnValue(true);
    persistDashboardSnapshot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serves contiguous month-to-date persisted snapshots before any analytics API call", async () => {
    const current = [
      dailyPayload("2026-08-01"),
      dailyPayload("2026-08-02"),
      dailyPayload("2026-08-03"),
      dailyPayload("2026-08-04"),
      dailyPayload("2026-08-05"),
      dailyPayload("2026-08-06"),
      dailyPayload("2026-08-07"),
      dailyPayload("2026-08-08"),
      dailyPayload("2026-08-09"),
      dailyPayload("2026-08-10"),
    ];
    const previous = [
      dailyPayload("2026-07-01", 5),
      dailyPayload("2026-07-02", 5),
      dailyPayload("2026-07-03", 5),
      dailyPayload("2026-07-04", 5),
      dailyPayload("2026-07-05", 5),
      dailyPayload("2026-07-06", 5),
      dailyPayload("2026-07-07", 5),
      dailyPayload("2026-07-08", 5),
      dailyPayload("2026-07-09", 5),
      dailyPayload("2026-07-10", 5),
    ];

    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart }: { rangeStart: string }) =>
      rangeStart.startsWith("2026-08-") ? current : previous,
    );

    const { getDashboard } = await import("./dashboardService.js");
    const payload = await getDashboard("this_month");

    expect(loadDashboardSnapshotForRange).toHaveBeenCalledWith({
      source: "analytics",
      userId: undefined,
      rangeStart: "2026-08-01T00:00:00.000Z",
      rangeEnd: "2026-08-11T00:00:00.000Z",
    });
    expect(loadDailyDashboardSnapshots).toHaveBeenCalledTimes(2);
    expect(loadDailyDashboardSnapshots).toHaveBeenNthCalledWith(2, {
      source: "analytics",
      userId: undefined,
      rangeStart: "2026-07-01T00:00:00.000Z",
      rangeEnd: "2026-07-11T00:00:00.000Z",
    });
    expect(getAnalyticsUsageBuckets).not.toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).not.toHaveBeenCalled();
    expect(getSummaries).not.toHaveBeenCalled();
    expect(payload.range.startingAt).toBe("2026-08-01T00:00:00.000Z");
    expect(payload.range.endingAt).toBe("2026-08-11T00:00:00.000Z");
    expect(payload.summary.totalCostUsd).toBe(100);
    expect(payload.summary.comparisons?.totalCostUsd?.deltaPercent).toBe(100);
  });

  it("uses the configured mock current day of month for this_month bounds and falls back when invalid", async () => {
    const { generateMockData, generateMockExtras, filterMockForGroup, filterMockForUser } = await import("./mock.js");
    const { getDashboard } = await import("./dashboardService.js");

    configState.source = "mock";
    configState.useMock = true;

    vi.mocked(generateMockData).mockReturnValue({ usage: [], cost: [] });
    vi.mocked(generateMockExtras).mockReturnValue({
      byUser: [],
      userStats: undefined,
      byProduct: [],
      byGroup: [],
      activity: undefined,
      dataRefreshedAt: "2026-08-15T12:00:00.000Z",
    });
    vi.mocked(filterMockForUser).mockImplementation((full) => full);
    vi.mocked(filterMockForGroup).mockImplementation((full) => full);

    configState.mockCurrentDayOfMonth = 15;
    await getDashboard("this_month", true);

    expect(generateMockData).toHaveBeenLastCalledWith(
      "2026-07-01T00:00:00.000Z",
      "2026-08-16T00:00:00.000Z",
    );

    configState.mockCurrentDayOfMonth = 32;
    await getDashboard("this_month", true);

    expect(generateMockData).toHaveBeenLastCalledWith(
      "2026-07-01T00:00:00.000Z",
      "2026-08-11T00:00:00.000Z",
    );
  });

  it("compares a completed 30-day current month against the full 31-day previous month", async () => {
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));

    const current = Array.from({ length: 30 }, (_, index) => dailyPayload(`2026-09-${String(index + 1).padStart(2, "0")}`, 10));
    const previous = Array.from({ length: 31 }, (_, index) => dailyPayload(`2026-08-${String(index + 1).padStart(2, "0")}`, 5));

    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart }: { rangeStart: string }) => {
      if (rangeStart === "2026-09-01T00:00:00.000Z") return current;
      if (rangeStart === "2026-08-01T00:00:00.000Z") return previous;
      return [];
    });

    const { getDashboard } = await import("./dashboardService.js");
    const payload = await getDashboard("this_month");

    expect(loadDailyDashboardSnapshots).toHaveBeenNthCalledWith(2, {
      source: "analytics",
      userId: undefined,
      rangeStart: "2026-08-01T00:00:00.000Z",
      rangeEnd: "2026-09-01T00:00:00.000Z",
    });
    expect(payload.summary.totalCostUsd).toBe(300);
    expect(payload.summary.comparisons?.totalCostUsd?.previousValue).toBe(155);
  });

  it("prefers fresher daily snapshots over a stale exact this-month snapshot", async () => {
    const staleExact = {
      ...dailyPayload("2026-08-01", 12),
      range: {
        startingAt: "2026-08-01T00:00:00.000Z",
        endingAt: "2026-08-11T00:00:00.000Z",
        bucketWidth: "1d",
      },
      summary: {
        ...dailyPayload("2026-08-01", 12).summary,
        totalCostUsd: 12,
      },
      timeseries: [
        {
          date: "2026-08-01",
          uncachedInputTokens: 40,
          cacheReadTokens: 10,
          cacheCreationTokens: 5,
          outputTokens: 45,
          totalTokens: 100,
          costUsd: 12,
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
          costUsd: 12,
        },
      ],
      byUser: [
        {
          userId: "u1",
          name: "Ada",
          email: "ada@example.com",
          deleted: false,
          totalTokens: 100,
          outputTokens: 45,
          costUsd: 12,
          requests: 3,
        },
      ],
      byProduct: [{ product: "Claude Code", totalTokens: 100, costUsd: 12 }],
      generatedAt: "2026-08-10T01:00:00.000Z",
    };
    const current = [
      dailyPayload("2026-08-01", 10),
      dailyPayload("2026-08-02", 10),
      dailyPayload("2026-08-03", 10),
      dailyPayload("2026-08-04", 10),
      dailyPayload("2026-08-05", 10),
      dailyPayload("2026-08-06", 10),
      dailyPayload("2026-08-07", 10),
      dailyPayload("2026-08-08", 10),
      dailyPayload("2026-08-09", 10),
      dailyPayload("2026-08-10", 25),
    ];
    const previous = [
      dailyPayload("2026-07-01", 5),
      dailyPayload("2026-07-02", 5),
      dailyPayload("2026-07-03", 5),
      dailyPayload("2026-07-04", 5),
      dailyPayload("2026-07-05", 5),
      dailyPayload("2026-07-06", 5),
      dailyPayload("2026-07-07", 5),
      dailyPayload("2026-07-08", 5),
      dailyPayload("2026-07-09", 5),
      dailyPayload("2026-07-10", 5),
    ];

    loadDashboardSnapshotForRange.mockResolvedValue(staleExact);
    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart }: { rangeStart: string }) =>
      rangeStart.startsWith("2026-08-") ? current : previous,
    );

    const { getDashboard } = await import("./dashboardService.js");
    const payload = await getDashboard("this_month");

    expect(payload.summary.totalCostUsd).toBe(115);
    expect(payload.range.endingAt).toBe("2026-08-11T00:00:00.000Z");
    expect(getAnalyticsUsageBuckets).not.toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).not.toHaveBeenCalled();
  });

  it("ignores incompatible persisted snapshots and rebuilds from upstream", async () => {
    const stalePersisted: DashboardPayload = {
      ...dailyPayload("2026-08-01", 12),
      snapshotVersion: undefined,
      range: {
        startingAt: "2026-08-01T00:00:00.000Z",
        endingAt: "2026-08-11T00:00:00.000Z",
        bucketWidth: "1d",
      },
      generatedAt: "2026-08-10T01:00:00.000Z",
    };

    loadDashboardSnapshotForRange.mockResolvedValue(stalePersisted);
    loadDashboardSnapshot.mockResolvedValue(stalePersisted);
    loadDailyDashboardSnapshots.mockResolvedValue([
      { ...dailyPayload("2026-08-01", 10), snapshotVersion: undefined },
      { ...dailyPayload("2026-08-02", 10), snapshotVersion: undefined },
    ]);

    getAnalyticsUsageBuckets.mockResolvedValue([
      {
        starting_at: "2026-08-01T00:00:00.000Z",
        ending_at: "2026-08-11T00:00:00.000Z",
        results: [
          {
            model: "claude-sonnet",
            product: "claude_code",
            uncached_input_tokens: 40,
            cache_read_input_tokens: 10,
            cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
            output_tokens: 45,
            requests: 3,
            server_tool_use: { web_search_requests: 1 },
            context_window: null,
            inference_geo: null,
            speed: null,
          },
        ],
      },
    ]);
    getAnalyticsCostBuckets.mockResolvedValue([
      {
        starting_at: "2026-08-01T00:00:00.000Z",
        ending_at: "2026-08-11T00:00:00.000Z",
        results: [
          {
            amount: "1000",
            list_amount: "1000",
            currency: "USD",
            cost_type: "tokens",
            token_type: null,
            context_window: null,
            inference_geo: null,
            model: "claude-sonnet",
            product: "claude_code",
            speed: null,
            requests: 3,
          },
        ],
      },
    ]);
    getUserUsage.mockResolvedValue([
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        total_tokens: 100,
        output_tokens: 45,
        requests: 3,
        starting_at: "2026-08-01T00:00:00.000Z",
        ending_at: "2026-08-11T00:00:00.000Z",
        cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
        cache_read_input_tokens: 10,
        uncached_input_tokens: 40,
        server_tool_use: { web_search_requests: 1 },
        context_window: null,
        inference_geo: null,
        model: "claude-sonnet",
        product: "claude_code",
        speed: null,
      },
    ]);
    getUserCost.mockResolvedValue([
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        amount: "1000",
        list_amount: "1000",
        currency: "USD",
        cost_type: "tokens",
        token_type: null,
        model: "claude-sonnet",
        product: "claude_code",
        starting_at: "2026-08-01T00:00:00.000Z",
        ending_at: "2026-08-11T00:00:00.000Z",
        requests: 3,
      },
    ]);
    getSummaries.mockResolvedValue([]);

    const { getDashboard } = await import("./dashboardService.js");
    const payload = await getDashboard("this_month");

    expect(getAnalyticsUsageBuckets).toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).toHaveBeenCalled();
    expect(payload.summary.totalCostUsd).toBe(10);
    expect(persistDashboardSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ snapshotVersion: DASHBOARD_SNAPSHOT_VERSION }) }),
    );
  });

  it("falls back to upstream APIs when an ongoing persisted range is incomplete", async () => {
    const current = [
      dailyPayload("2026-02-01", 10),
      dailyPayload("2026-02-02", 10),
      dailyPayload("2026-02-03", 10),
      dailyPayload("2026-02-04", 10),
      dailyPayload("2026-02-05", 10),
      dailyPayload("2026-02-06", 10),
      dailyPayload("2026-02-07", 10),
      dailyPayload("2026-02-08", 10),
      dailyPayload("2026-02-09", 10),
      dailyPayload("2026-02-10", 10),
      dailyPayload("2026-08-02", 20),
      dailyPayload("2026-08-03", 20),
      dailyPayload("2026-08-04", 20),
      dailyPayload("2026-08-05", 20),
      dailyPayload("2026-08-06", 20),
      dailyPayload("2026-08-07", 20),
      dailyPayload("2026-08-08", 20),
      dailyPayload("2026-08-09", 20),
      dailyPayload("2026-08-10", 25),
    ];
    const previous = [
      dailyPayload("2026-02-03", 5),
      dailyPayload("2026-02-04", 5),
      dailyPayload("2026-02-05", 5),
      dailyPayload("2026-02-06", 5),
      dailyPayload("2026-02-07", 5),
      dailyPayload("2026-02-08", 5),
      dailyPayload("2026-02-09", 5),
      dailyPayload("2026-02-10", 5),
      dailyPayload("2026-02-11", 5),
    ];

    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeEnd }: { rangeEnd: string }) =>
      rangeEnd === "2026-08-11T00:00:00.000Z" ? current : previous,
    );

    getAnalyticsUsageBuckets.mockResolvedValue([
      {
        starting_at: "2026-02-12T00:00:00.000Z",
        ending_at: "2026-08-11T00:00:00.000Z",
        results: [
          {
            model: "claude-sonnet",
            product: "claude_code",
            uncached_input_tokens: 40,
            cache_read_input_tokens: 10,
            cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
            output_tokens: 45,
            requests: 3,
            server_tool_use: { web_search_requests: 1 },
            context_window: null,
            inference_geo: null,
            speed: null,
          },
        ],
      },
    ]);
    getAnalyticsCostBuckets.mockResolvedValue([
      {
        starting_at: "2026-02-12T00:00:00.000Z",
        ending_at: "2026-08-11T00:00:00.000Z",
        results: [
          {
            amount: "1000",
            list_amount: "1000",
            currency: "USD",
            cost_type: "tokens",
            token_type: null,
            context_window: null,
            inference_geo: null,
            model: "claude-sonnet",
            product: "claude_code",
            speed: null,
            requests: 3,
          },
        ],
      },
    ]);
    getUserUsage.mockResolvedValue([]);
    getUserCost.mockResolvedValue([]);
    getSummaries.mockResolvedValue([]);

    const { getDashboard } = await import("./dashboardService.js");
    const payload = await getDashboard("180d");

    expect(getAnalyticsUsageBuckets).toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).toHaveBeenCalled();
    expect(payload.summary.totalCostUsd).toBeGreaterThan(0);
    expect(payload.range.startingAt).toBe("2026-02-12T00:00:00.000Z");
    expect(payload.range.endingAt).toBe("2026-08-11T00:00:00.000Z");
    expect(payload.summary.comparisons?.totalCostUsd?.previousValue).toBeGreaterThanOrEqual(0);
  });

  it("reuses persisted daily snapshots from a longer range for a later shorter range", async () => {
    const snapshotByRequestKey = new Map<string, DashboardPayload>();
    const snapshotByRange = new Map<string, DashboardPayload>();

    const keyFor = (requestKey: string, rangeStart: string, rangeEnd: string) => `${requestKey}:${rangeStart}:${rangeEnd}`;
    const rangeKeyFor = (rangeStart: string, rangeEnd: string) => `${rangeStart}:${rangeEnd}`;

    loadDashboardSnapshot.mockImplementation(async ({ requestKey, rangeStart, rangeEnd }: { requestKey: string; rangeStart: string; rangeEnd: string }) =>
      snapshotByRequestKey.get(keyFor(requestKey, rangeStart, rangeEnd)) ?? null,
    );
    loadDashboardSnapshotForRange.mockImplementation(async ({ rangeStart, rangeEnd }: { rangeStart: string; rangeEnd: string }) =>
      snapshotByRange.get(rangeKeyFor(rangeStart, rangeEnd)) ?? null,
    );
    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart, rangeEnd }: { rangeStart: string; rangeEnd: string }) =>
      [...snapshotByRange.values()]
        .filter(
          (payload) =>
            payload.range.startingAt >= rangeStart &&
            payload.range.endingAt <= rangeEnd &&
            payload.range.bucketWidth === "1d",
        )
        .sort((left, right) => left.range.startingAt.localeCompare(right.range.startingAt)),
    );
    persistDashboardSnapshot.mockImplementation(async ({ requestKey, payload }: { requestKey: string; payload: DashboardPayload }) => {
      snapshotByRequestKey.set(keyFor(requestKey, payload.range.startingAt, payload.range.endingAt), payload);
      snapshotByRange.set(rangeKeyFor(payload.range.startingAt, payload.range.endingAt), payload);
    });

    getAnalyticsUsageBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000
            ? new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString()
            : `${current}T23:59:59.999Z`,
          results: [
            {
              model: "claude-sonnet",
              product: "claude_code",
              uncached_input_tokens: 40,
              cache_read_input_tokens: 10,
              cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
              output_tokens: 45,
              requests: 3,
              server_tool_use: { web_search_requests: 1 },
              context_window: null,
              inference_geo: null,
              speed: null,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getAnalyticsCostBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              amount: "1000",
              list_amount: "1000",
              currency: "USD",
              cost_type: "tokens",
              token_type: null,
              context_window: null,
              inference_geo: null,
              model: "claude-sonnet",
              product: "claude_code",
              speed: null,
              requests: 3,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserUsage.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
          total_tokens: 100,
          output_tokens: 45,
          requests: 3,
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
          cache_read_input_tokens: 10,
          uncached_input_tokens: 40,
          server_tool_use: { web_search_requests: 1 },
          context_window: null,
          inference_geo: null,
          model: "claude-sonnet",
          product: "claude_code",
          speed: null,
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserCost.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
          amount: "1000",
          list_amount: "1000",
          currency: "USD",
          cost_type: "tokens",
          token_type: null,
          model: "claude-sonnet",
          product: "claude_code",
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          requests: 3,
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getSummaries.mockResolvedValue([]);

    const { getDashboard } = await import("./dashboardService.js");

    const monthPayload = await getDashboard("30d", true);
    expect(monthPayload.summary.totalCostUsd).toBe(300);
    expect(persistDashboardSnapshot).toHaveBeenCalled();

    getAnalyticsUsageBuckets.mockClear();
    getAnalyticsCostBuckets.mockClear();
    getUserUsage.mockClear();
    getUserCost.mockClear();
    getSummaries.mockClear();

    const shorterPayload = await getDashboard("14d");

    expect(shorterPayload.summary.totalCostUsd).toBe(140);
    expect(loadDailyDashboardSnapshots).toHaveBeenCalled();
    expect(getAnalyticsUsageBuckets).not.toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).not.toHaveBeenCalled();
    expect(getUserUsage).not.toHaveBeenCalled();
    expect(getUserCost).not.toHaveBeenCalled();
    expect(getSummaries).not.toHaveBeenCalled();
  });

  it("refetches a later 7d request when this-month history cannot cover the previous comparison window", async () => {
    const snapshotByRequestKey = new Map<string, DashboardPayload>();
    const snapshotByRange = new Map<string, DashboardPayload>();

    const keyFor = (requestKey: string, rangeStart: string, rangeEnd: string) => `${requestKey}:${rangeStart}:${rangeEnd}`;
    const rangeKeyFor = (rangeStart: string, rangeEnd: string) => `${rangeStart}:${rangeEnd}`;

    loadDashboardSnapshot.mockImplementation(async ({ requestKey, rangeStart, rangeEnd }: { requestKey: string; rangeStart: string; rangeEnd: string }) =>
      snapshotByRequestKey.get(keyFor(requestKey, rangeStart, rangeEnd)) ?? null,
    );
    loadDashboardSnapshotForRange.mockImplementation(async ({ rangeStart, rangeEnd }: { rangeStart: string; rangeEnd: string }) =>
      snapshotByRange.get(rangeKeyFor(rangeStart, rangeEnd)) ?? null,
    );
    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart, rangeEnd }: { rangeStart: string; rangeEnd: string }) =>
      [...snapshotByRange.values()]
        .filter(
          (payload) =>
            payload.range.startingAt >= rangeStart &&
            payload.range.endingAt <= rangeEnd &&
            payload.range.bucketWidth === "1d",
        )
        .sort((left, right) => left.range.startingAt.localeCompare(right.range.startingAt)),
    );
    persistDashboardSnapshot.mockImplementation(async ({ requestKey, payload }: { requestKey: string; payload: DashboardPayload }) => {
      snapshotByRequestKey.set(keyFor(requestKey, payload.range.startingAt, payload.range.endingAt), payload);
      snapshotByRange.set(rangeKeyFor(payload.range.startingAt, payload.range.endingAt), payload);
    });

    getAnalyticsUsageBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              model: "claude-sonnet",
              product: "claude_code",
              uncached_input_tokens: 40,
              cache_read_input_tokens: 10,
              cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
              output_tokens: 45,
              requests: 3,
              server_tool_use: { web_search_requests: 1 },
              context_window: null,
              inference_geo: null,
              speed: null,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getAnalyticsCostBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              amount: "1000",
              list_amount: "1000",
              currency: "USD",
              cost_type: "tokens",
              token_type: null,
              context_window: null,
              inference_geo: null,
              model: "claude-sonnet",
              product: "claude_code",
              speed: null,
              requests: 3,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserUsage.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
          total_tokens: 100,
          output_tokens: 45,
          requests: 3,
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
          cache_read_input_tokens: 10,
          uncached_input_tokens: 40,
          server_tool_use: { web_search_requests: 1 },
          context_window: null,
          inference_geo: null,
          model: "claude-sonnet",
          product: "claude_code",
          speed: null,
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserCost.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
          amount: "1000",
          list_amount: "1000",
          currency: "USD",
          cost_type: "tokens",
          token_type: null,
          model: "claude-sonnet",
          product: "claude_code",
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          requests: 3,
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getSummaries.mockResolvedValue([]);

    const { getDashboard } = await import("./dashboardService.js");

    const thisMonthPayload = await getDashboard("this_month", true);
    expect(thisMonthPayload.summary.totalCostUsd).toBe(100);
    expect(persistDashboardSnapshot).toHaveBeenCalled();

    getAnalyticsUsageBuckets.mockClear();
    getAnalyticsCostBuckets.mockClear();
    getUserUsage.mockClear();
    getUserCost.mockClear();
    getSummaries.mockClear();

    const shorterPayload = await getDashboard("7d");

    expect(shorterPayload.summary.totalCostUsd).toBe(70);
    expect(loadDailyDashboardSnapshots).toHaveBeenCalled();
    expect(getAnalyticsUsageBuckets).toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).toHaveBeenCalled();
    expect(getUserUsage).toHaveBeenCalled();
    expect(getUserCost).toHaveBeenCalled();
  });

  it("reuses persisted 180d daily snapshots for a later 90d request", async () => {
    const snapshotByRequestKey = new Map<string, DashboardPayload>();
    const snapshotByRange = new Map<string, DashboardPayload>();

    const keyFor = (requestKey: string, rangeStart: string, rangeEnd: string) => `${requestKey}:${rangeStart}:${rangeEnd}`;
    const rangeKeyFor = (rangeStart: string, rangeEnd: string) => `${rangeStart}:${rangeEnd}`;

    loadDashboardSnapshot.mockImplementation(async ({ requestKey, rangeStart, rangeEnd }: { requestKey: string; rangeStart: string; rangeEnd: string }) =>
      snapshotByRequestKey.get(keyFor(requestKey, rangeStart, rangeEnd)) ?? null,
    );
    loadDashboardSnapshotForRange.mockImplementation(async ({ rangeStart, rangeEnd }: { rangeStart: string; rangeEnd: string }) =>
      snapshotByRange.get(rangeKeyFor(rangeStart, rangeEnd)) ?? null,
    );
    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart, rangeEnd }: { rangeStart: string; rangeEnd: string }) =>
      [...snapshotByRange.values()]
        .filter(
          (payload) =>
            payload.range.startingAt >= rangeStart &&
            payload.range.endingAt <= rangeEnd &&
            payload.range.bucketWidth === "1d",
        )
        .sort((left, right) => left.range.startingAt.localeCompare(right.range.startingAt)),
    );
    persistDashboardSnapshot.mockImplementation(async ({ requestKey, payload }: { requestKey: string; payload: DashboardPayload }) => {
      snapshotByRequestKey.set(keyFor(requestKey, payload.range.startingAt, payload.range.endingAt), payload);
      snapshotByRange.set(rangeKeyFor(payload.range.startingAt, payload.range.endingAt), payload);
    });

    getAnalyticsUsageBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              model: "claude-sonnet",
              product: "claude_code",
              uncached_input_tokens: 40,
              cache_read_input_tokens: 10,
              cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
              output_tokens: 45,
              requests: 3,
              server_tool_use: { web_search_requests: 1 },
              context_window: null,
              inference_geo: null,
              speed: null,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getAnalyticsCostBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              amount: "1000",
              list_amount: "1000",
              currency: "USD",
              cost_type: "tokens",
              token_type: null,
              context_window: null,
              inference_geo: null,
              model: "claude-sonnet",
              product: "claude_code",
              speed: null,
              requests: 3,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserUsage.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
          total_tokens: 100,
          output_tokens: 45,
          requests: 3,
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
          cache_read_input_tokens: 10,
          uncached_input_tokens: 40,
          server_tool_use: { web_search_requests: 1 },
          context_window: null,
          inference_geo: null,
          model: "claude-sonnet",
          product: "claude_code",
          speed: null,
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserCost.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
          amount: "1000",
          list_amount: "1000",
          currency: "USD",
          cost_type: "tokens",
          token_type: null,
          model: "claude-sonnet",
          product: "claude_code",
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          requests: 3,
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getSummaries.mockResolvedValue([]);

    const { getDashboard } = await import("./dashboardService.js");

    const fullPayload = await getDashboard("180d", true);
    expect(fullPayload.summary.totalCostUsd).toBe(1800);

    getAnalyticsUsageBuckets.mockClear();
    getAnalyticsCostBuckets.mockClear();
    getUserUsage.mockClear();
    getUserCost.mockClear();
    getSummaries.mockClear();

    const subsetPayload = await getDashboard("90d");

    expect(subsetPayload.summary.totalCostUsd).toBe(900);
    expect(loadDailyDashboardSnapshots).toHaveBeenCalled();
    expect(getAnalyticsUsageBuckets).not.toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).not.toHaveBeenCalled();
    expect(getUserUsage).not.toHaveBeenCalled();
    expect(getUserCost).not.toHaveBeenCalled();
    expect(getSummaries).not.toHaveBeenCalled();
  });

  it("serves last_month entirely from persisted daily snapshots after history warmup", async () => {
    const july: DashboardPayload[] = [];
    const june: DashboardPayload[] = [];

    for (let day = 1; day <= 31; day += 1) {
      july.push(dailyPayload(`2026-07-${String(day).padStart(2, "0")}`));
    }
    for (let day = 1; day <= 30; day += 1) {
      june.push(dailyPayload(`2026-06-${String(day).padStart(2, "0")}`, 5));
    }

    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart }: { rangeStart: string }) => {
      if (rangeStart === "2026-07-01T00:00:00.000Z") return july;
      if (rangeStart === "2026-06-01T00:00:00.000Z") return june;
      return [];
    });

    const { getDashboard } = await import("./dashboardService.js");
    const payload = await getDashboard("last_month");

    expect(payload.summary.totalCostUsd).toBe(310);
    expect(payload.summary.comparisons?.totalCostUsd?.previousValue).toBe(150);
    expect(loadDailyDashboardSnapshots).toHaveBeenCalledTimes(2);
    expect(getAnalyticsUsageBuckets).not.toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).not.toHaveBeenCalled();
    expect(getUserUsage).not.toHaveBeenCalled();
    expect(getUserCost).not.toHaveBeenCalled();
    expect(getSummaries).not.toHaveBeenCalled();
  });

  it("returns last-month analysis separately without persisting it on the dashboard payload", async () => {
    const current = Array.from({ length: 31 }, (_, index) => dailyPayload(`2026-07-${String(index + 1).padStart(2, "0")}`, 10));
    const previous = Array.from({ length: 30 }, (_, index) => dailyPayload(`2026-06-${String(index + 1).padStart(2, "0")}`, 8));

    loadDailyDashboardSnapshots.mockImplementation(async ({ rangeStart }: { rangeStart: string }) =>
      rangeStart.startsWith("2026-07-") ? current : previous,
    );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "not valid json",
              },
            },
          ],
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: [
                  {
                    type: "text",
                    text: "```json\n" + JSON.stringify({
                      headline: "Last month spend rose because product and user concentration increased.",
                      summary: "Most of the visible increase came from the largest product and user segments.",
                      primaryDrivers: [{ title: "Product mix", detail: "Claude Code increased the most month over month." }],
                      secondarySignals: [{ title: "Search usage", detail: "Search activity rose sharply but remained a small share of total cost." }],
                      nonMaterialFactors: [{ title: "Web search requests", detail: "Raw request growth looked large in percentage terms but did not materially move spend." }],
                      caveats: ["Generated from stored dashboard metrics only."],
                    }) + "\n```",
                  },
                ],
              },
            },
          ],
        }),
        text: async () => "",
      });

    const { getDashboard, getDashboardAnalysis } = await import("./dashboardService.js");
    const payload = await getDashboard("last_month");
    const analysis = await getDashboardAnalysis("last_month");

    expect(payload.monthlyCostAnalysis).toBeUndefined();
    expect(analysis).toBeDefined();
    expect(analysis?.status).toBe("ready");
    expect(analysis?.headline).toContain("spend rose");
    expect(analysis?.primaryDrivers).toHaveLength(1);
    expect(analysis?.secondarySignals).toHaveLength(1);
    expect(analysis?.nonMaterialFactors).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({ method: "POST", signal: expect.anything() }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loadDailyDashboardSnapshots).toHaveBeenCalledTimes(2);
    expect(persistDashboardSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ monthlyCostAnalysis: expect.anything() }) }),
    );
  });

  it("falls back to upstream APIs for org-wide reads when persisted data is missing", async () => {
    loadDailyDashboardSnapshots.mockResolvedValue([]);
    loadDashboardSnapshot.mockResolvedValue(null);
    loadDashboardSnapshotForRange.mockResolvedValue(null);

    getAnalyticsUsageBuckets.mockResolvedValue([
      {
        starting_at: "2026-07-01T00:00:00.000Z",
        ending_at: "2026-08-01T00:00:00.000Z",
        results: [
          {
            model: "claude-sonnet",
            product: "claude_code",
            uncached_input_tokens: 40,
            cache_read_input_tokens: 10,
            cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
            output_tokens: 45,
            requests: 3,
            server_tool_use: { web_search_requests: 1 },
            context_window: null,
            inference_geo: null,
            speed: null,
          },
        ],
      },
    ]);
    getAnalyticsCostBuckets.mockResolvedValue([
      {
        starting_at: "2026-07-01T00:00:00.000Z",
        ending_at: "2026-08-01T00:00:00.000Z",
        results: [
          {
            amount: "1000",
            list_amount: "1000",
            currency: "USD",
            cost_type: "tokens",
            token_type: null,
            context_window: null,
            inference_geo: null,
            model: "claude-sonnet",
            product: "claude_code",
            speed: null,
            requests: 3,
          },
        ],
      },
    ]);
    getUserUsage.mockResolvedValue([
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        total_tokens: 100,
        output_tokens: 45,
        requests: 3,
        starting_at: "2026-07-01T00:00:00.000Z",
        ending_at: "2026-08-01T00:00:00.000Z",
        cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
        cache_read_input_tokens: 10,
        uncached_input_tokens: 40,
        server_tool_use: { web_search_requests: 1 },
        context_window: null,
        inference_geo: null,
        model: "claude-sonnet",
        product: "claude_code",
        speed: null,
      },
    ]);
    getUserCost.mockResolvedValue([
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        amount: "1000",
        list_amount: "1000",
        currency: "USD",
        cost_type: "tokens",
        token_type: null,
        model: "claude-sonnet",
        product: "claude_code",
        starting_at: "2026-07-01T00:00:00.000Z",
        ending_at: "2026-08-01T00:00:00.000Z",
        requests: 3,
      },
    ]);
    getSummaries.mockResolvedValue([]);

    const { getDashboard } = await import("./dashboardService.js");

    const payload = await getDashboard("last_month");

    expect(payload.summary.totalCostUsd).toBe(10);
    expect(getAnalyticsUsageBuckets).toHaveBeenCalled();
    expect(getAnalyticsCostBuckets).toHaveBeenCalled();
    expect(getUserUsage).toHaveBeenCalled();
    expect(getUserCost).toHaveBeenCalled();
    expect(persistDashboardSnapshot).toHaveBeenCalled();
  });

  it("backfills contiguous missing days in a single range fetch when ensuring recent history", async () => {
    const existing = [dailyPayload("2026-08-08")];

    loadDailyDashboardSnapshots.mockResolvedValue(existing);

    getAnalyticsUsageBuckets.mockImplementation(async ({ startingAt }: { startingAt: string }) => [
      {
        starting_at: startingAt,
        ending_at: new Date(new Date(startingAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        results: [
          {
            model: "claude-sonnet",
            product: "claude_code",
            uncached_input_tokens: 40,
            cache_read_input_tokens: 10,
            cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
            output_tokens: 45,
            requests: 3,
            server_tool_use: { web_search_requests: 1 },
            context_window: null,
            inference_geo: null,
            speed: null,
          },
        ],
      },
    ]);
    getAnalyticsCostBuckets.mockImplementation(async ({ startingAt }: { startingAt: string }) => [
      {
        starting_at: startingAt,
        ending_at: new Date(new Date(startingAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        results: [
          {
            amount: "1000",
            list_amount: "1000",
            currency: "USD",
            cost_type: "tokens",
            token_type: null,
            context_window: null,
            inference_geo: null,
            model: "claude-sonnet",
            product: "claude_code",
            speed: null,
            requests: 3,
          },
        ],
      },
    ]);
    getUserUsage.mockImplementation(async ({ startingAt }: { startingAt: string }) => [
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        total_tokens: 100,
        output_tokens: 45,
        requests: 3,
        starting_at: startingAt,
        ending_at: new Date(new Date(startingAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
        cache_read_input_tokens: 10,
        uncached_input_tokens: 40,
        server_tool_use: { web_search_requests: 1 },
        context_window: null,
        inference_geo: null,
        model: "claude-sonnet",
        product: "claude_code",
        speed: null,
      },
    ]);
    getUserCost.mockImplementation(async ({ startingAt }: { startingAt: string }) => [
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        amount: "1000",
        list_amount: "1000",
        currency: "USD",
        cost_type: "tokens",
        token_type: null,
        model: "claude-sonnet",
        product: "claude_code",
        starting_at: startingAt,
        ending_at: new Date(new Date(startingAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        requests: 3,
      },
    ]);
    getSummaries.mockResolvedValue([]);

    const { ensureRecentHistory, getHistorySyncStatus } = await import("./dashboardService.js");
    const result = await ensureRecentHistory(3);
    const status = getHistorySyncStatus();

    expect(result.requestedDays).toBe(3);
    expect(result.fetchedDays).toBe(2);
    expect(status.recentHistory.inProgress).toBe(false);
    expect(status.recentHistory.requestedDays).toBe(3);
    expect(status.recentHistory.fetchedDays).toBe(2);
    expect(status.recentHistory.concurrency).toBe(4);
    expect(status.recentHistory.bounds?.startingAt).toBe("2026-08-08T00:00:00.000Z");
    expect(status.recentHistory.lastCompletedAt).toBeDefined();
    expect(loadDailyDashboardSnapshots).toHaveBeenCalledWith({
      source: "analytics",
      userId: undefined,
      rangeStart: "2026-08-08T00:00:00.000Z",
      rangeEnd: "2026-08-11T00:00:00.000Z",
    });
    expect(getAnalyticsUsageBuckets).toHaveBeenCalledWith(
      { startingAt: "2026-08-09T00:00:00.000Z", endingAt: "2026-08-11T00:00:00.000Z" },
      ["model"],
      undefined,
      undefined,
    );
    expect(getAnalyticsUsageBuckets).toHaveBeenCalledWith(
      { startingAt: "2026-08-09T00:00:00.000Z", endingAt: "2026-08-11T00:00:00.000Z" },
      ["product"],
      undefined,
      undefined,
    );
    expect(persistDashboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({ requestKey: "day:2026-08-09" }));
    expect(persistDashboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({ requestKey: "day:2026-08-10" }));
  });

  it("refetches persisted analytics daily snapshots with impossible by-user costs", async () => {
    loadDailyDashboardSnapshots.mockResolvedValue([
      {
        ...dailyPayload("2026-08-08", 10),
        byUser: [
          {
            userId: "u1",
            name: "Ada",
            email: "ada@example.com",
            deleted: false,
            totalTokens: 100,
            outputTokens: 45,
            costUsd: 999,
            requests: 3,
          },
        ],
      },
    ]);

    getAnalyticsUsageBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              model: "claude-sonnet",
              product: "claude_code",
              uncached_input_tokens: 40,
              cache_read_input_tokens: 10,
              cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
              output_tokens: 45,
              requests: 3,
              server_tool_use: { web_search_requests: 1 },
              context_window: null,
              inference_geo: null,
              speed: null,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getAnalyticsCostBuckets.mockImplementation(async ({ startingAt, endingAt }: { startingAt: string; endingAt: string }) => {
      const start = startingAt.slice(0, 10);
      const end = endingAt.slice(0, 10);
      const rows = [];
      let current = start;
      while (current < end) {
        rows.push({
          starting_at: `${current}T00:00:00.000Z`,
          ending_at: new Date(new Date(`${current}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          results: [
            {
              amount: "1000",
              list_amount: "1000",
              currency: "USD",
              cost_type: "tokens",
              token_type: null,
              context_window: null,
              inference_geo: null,
              model: "claude-sonnet",
              product: "claude_code",
              speed: null,
              requests: 3,
            },
          ],
        });
        current = new Date(Date.parse(`${current}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      }
      return rows;
    });
    getUserUsage.mockImplementation(async ({ startingAt }: { startingAt: string }) => [
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        total_tokens: 100,
        output_tokens: 45,
        requests: 3,
        starting_at: startingAt,
        ending_at: new Date(new Date(startingAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 },
        cache_read_input_tokens: 10,
        uncached_input_tokens: 40,
        server_tool_use: { web_search_requests: 1 },
        context_window: null,
        inference_geo: null,
        model: "claude-sonnet",
        product: "claude_code",
        speed: null,
      },
    ]);
    getUserCost.mockImplementation(async ({ startingAt }: { startingAt: string }) => [
      {
        actor: { user_id: "u1", email: "ada@example.com", name: "Ada", deleted: false },
        amount: "1000",
        list_amount: "1000",
        currency: "USD",
        cost_type: "tokens",
        token_type: null,
        model: "claude-sonnet",
        product: "claude_code",
        starting_at: startingAt,
        ending_at: new Date(new Date(startingAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
        requests: 3,
      },
    ]);
    getSummaries.mockResolvedValue([]);

    const { ensureRecentHistory } = await import("./dashboardService.js");
    const result = await ensureRecentHistory(1);

    expect(result.fetchedDays).toBe(1);
    expect(getAnalyticsUsageBuckets).toHaveBeenCalledWith(
      { startingAt: "2026-08-10T00:00:00.000Z", endingAt: "2026-08-11T00:00:00.000Z" },
      ["model"],
      undefined,
      undefined,
    );
  });
});