import { describe, expect, it } from "vitest";
import { buildAnalyticsComparisonSnapshot, buildAnalyticsDashboard } from "./aggregateAnalytics.js";

describe("buildAnalyticsDashboard", () => {
  it("attaches live group memberships to users and aggregates active usage by group", () => {
    const payload = buildAnalyticsDashboard(
      {
        usageByModel: [
          {
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            results: [
              {
                uncached_input_tokens: 40,
                cache_read_input_tokens: 10,
                cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
                output_tokens: 50,
                requests: 2,
                server_tool_use: { web_search_requests: 0 },
                context_window: null,
                inference_geo: null,
                model: "claude-sonnet",
                product: null,
                speed: null,
              },
            ],
          },
        ],
        usageByProduct: [],
        costByModel: [
          {
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            results: [
              {
                amount: "10000",
                list_amount: "10000",
                currency: "USD" as const,
                cost_type: "tokens" as const,
                token_type: null,
                context_window: null,
                inference_geo: null,
                model: "claude-sonnet",
                product: null,
                speed: null,
                requests: null,
              },
            ],
          },
        ],
        costByProduct: [],
        costByTypeBuckets: [],
        userUsage: [
          {
            actor: { user_id: "u1", email: "ada@example.com", name: "Ada" },
            total_tokens: 100,
            output_tokens: 50,
            requests: 2,
            uncached_input_tokens: 40,
            cache_read_input_tokens: 10,
            cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
            server_tool_use: { web_search_requests: 0 },
            context_window: null,
            inference_geo: null,
            model: null,
            product: null,
            speed: null,
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
          },
        ],
        userCost: [
          {
            actor: { user_id: "u1", email: "ada@example.com", name: "Ada" },
            amount: "10000",
            list_amount: "10000",
            currency: "USD" as const,
            cost_type: "tokens" as const,
            token_type: null,
            model: null,
            product: null,
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            requests: null,
          },
        ],
        summaries: [],
        groupConfig: [
          {
            groupId: "rbac_group_1",
            name: "Engineering",
            members: [{ userId: "u1", email: "ada@example.com" }],
            roleNames: ["Builder", "Approver"],
          },
        ],
      },
      { startingAt: "2026-01-10T00:00:00Z", endingAt: "2026-01-11T00:00:00Z" },
    );

    expect(payload.byUser?.[0]?.groups).toEqual([{ groupId: "rbac_group_1", name: "Engineering", roleNames: ["Builder", "Approver"] }]);
    expect(payload.byUser?.[0]?.effectiveRoles).toEqual([
      { roleId: "Approver", name: "Approver" },
      { roleId: "Builder", name: "Builder" },
    ]);
    expect(payload.byGroup?.[0]).toMatchObject({
      groupId: "rbac_group_1",
      name: "Engineering",
      roleNames: ["Builder", "Approver"],
      memberCount: 1,
      totalTokens: 100,
      outputTokens: 50,
      costUsd: 100,
      requests: 2,
    });
  });

  it("ignores user rows without a valid starting date instead of crashing", () => {
    const payload = buildAnalyticsDashboard(
      {
          usageByModel: [],
          usageByProduct: [],
          costByModel: [],
          costByProduct: [],
          costByTypeBuckets: [],
          userUsage: [
            {
              actor: { user_id: "u1", email: "u1@example.com", name: "Ada" },
              total_tokens: 100,
              output_tokens: 50,
              requests: 2,
              uncached_input_tokens: 50,
              cache_read_input_tokens: 0,
              cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
              server_tool_use: { web_search_requests: 0 },
              context_window: null,
              inference_geo: null,
              model: null,
              product: null,
              speed: null,
              starting_at: null as unknown as string,
              ending_at: null as unknown as string,
            },
          ],
          userCost: [],
          summaries: [],
      },
      { startingAt: "2026-01-10T00:00:00Z", endingAt: "2026-01-11T00:00:00Z" },
    );

    expect(payload.byUser?.length).toBe(1);
  });

  it("adds a per-user cost comparison against the previous range", () => {
    const current = {
      usageByModel: [],
      usageByProduct: [
        {
          starting_at: "2026-01-10T00:00:00Z",
          ending_at: "2026-01-11T00:00:00Z",
          results: [
            {
              uncached_input_tokens: 50,
              cache_read_input_tokens: 0,
              cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
              output_tokens: 50,
              requests: 2,
              server_tool_use: { web_search_requests: 0 },
              context_window: null,
              inference_geo: null,
              model: null,
              product: "claude_code",
              speed: null,
            },
          ],
        },
      ],
      costByModel: [
        {
          starting_at: "2026-01-10T00:00:00Z",
          ending_at: "2026-01-11T00:00:00Z",
          results: [
            {
              amount: "10000",
              list_amount: "10000",
              currency: "USD" as const,
              cost_type: "tokens" as const,
              token_type: null,
              context_window: null,
              inference_geo: null,
              model: "claude-sonnet",
              product: null,
              speed: null,
              requests: null,
            },
          ],
        },
      ],
      costByProduct: [
        {
          starting_at: "2026-01-10T00:00:00Z",
          ending_at: "2026-01-11T00:00:00Z",
          results: [
            {
              amount: "10000",
              list_amount: "10000",
              currency: "USD" as const,
              cost_type: "tokens" as const,
              token_type: null,
              context_window: null,
              inference_geo: null,
              model: null,
              product: "claude_code",
              speed: null,
              requests: null,
            },
          ],
        },
      ],
      costByTypeBuckets: [],
      userUsage: [],
      userCost: [
        {
          actor: { user_id: "u1", email: "u1@example.com", name: "Ada" },
          amount: "10000",
          list_amount: "10000",
          currency: "USD" as const,
          cost_type: "tokens" as const,
          token_type: null,
          model: null,
          product: null,
          starting_at: "2026-01-10T00:00:00Z",
          ending_at: "2026-01-11T00:00:00Z",
          requests: null,
        },
      ],
      summaries: [
        {
          starting_at: "2026-01-10T00:00:00Z",
          ending_at: "2026-01-11T00:00:00Z",
          assigned_seat_count: 10,
          pending_invite_count: 1,
          daily_active_user_count: 4,
          weekly_active_user_count: 6,
          monthly_active_user_count: 8,
          daily_adoption_rate: 40,
          weekly_adoption_rate: 60,
          monthly_adoption_rate: 80,
        },
      ],
    };

    const previous = buildAnalyticsComparisonSnapshot(
      {
        ...current,
        usageByProduct: current.usageByProduct.map((bucket) => ({
          ...bucket,
          starting_at: "2026-01-09T00:00:00Z",
          ending_at: "2026-01-10T00:00:00Z",
        })),
        costByModel: [
          {
            starting_at: "2026-01-09T00:00:00Z",
            ending_at: "2026-01-10T00:00:00Z",
            results: [
              {
                amount: "5000",
                list_amount: "5000",
                currency: "USD" as const,
                cost_type: "tokens" as const,
                token_type: null,
                context_window: null,
                inference_geo: null,
                model: "claude-sonnet",
                product: null,
                speed: null,
                requests: null,
              },
            ],
          },
        ],
        costByProduct: [
          {
            starting_at: "2026-01-09T00:00:00Z",
            ending_at: "2026-01-10T00:00:00Z",
            results: [
              {
                amount: "5000",
                list_amount: "5000",
                currency: "USD" as const,
                cost_type: "tokens" as const,
                token_type: null,
                context_window: null,
                inference_geo: null,
                model: null,
                product: "claude_code",
                speed: null,
                requests: null,
              },
            ],
          },
        ],
        userCost: [
          {
            actor: { user_id: "u1", email: "u1@example.com", name: "Ada" },
            amount: "5000",
            list_amount: "5000",
            currency: "USD" as const,
            cost_type: "tokens" as const,
            token_type: null,
            model: null,
            product: null,
            starting_at: "2026-01-09T00:00:00Z",
            ending_at: "2026-01-10T00:00:00Z",
            requests: null,
          },
        ],
        summaries: [
          {
            starting_at: "2026-01-09T00:00:00Z",
            ending_at: "2026-01-10T00:00:00Z",
            assigned_seat_count: 8,
            pending_invite_count: 1,
            daily_active_user_count: 2,
            weekly_active_user_count: 5,
            monthly_active_user_count: 7,
            daily_adoption_rate: 25,
            weekly_adoption_rate: 62.5,
            monthly_adoption_rate: 87.5,
          },
        ],
      },
      { startingAt: "2026-01-09T00:00:00Z", endingAt: "2026-01-10T00:00:00Z" },
    );

    const payload = buildAnalyticsDashboard(
      current,
      { startingAt: "2026-01-10T00:00:00Z", endingAt: "2026-01-11T00:00:00Z" },
      previous,
    );

    const user = payload.byUser?.[0];
    expect(user?.costComparison).toBeDefined();
    expect(user?.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(user?.totalTokensComparison?.deltaPercent).toBe(0);
    expect(user?.costComparison?.deltaValue).toBe(50);
    expect(user?.costComparison?.direction).toBe("up");
    expect(payload.byModel[0]?.costComparison?.deltaValue).toBe(50);
    expect(payload.byModel[0]?.costComparison?.direction).toBe("up");
    expect(payload.byProduct?.[0]?.costComparison?.deltaValue).toBe(50);
    expect(payload.byProduct?.[0]?.costComparison?.direction).toBe("up");
    expect(payload.activity?.comparisons?.dailyActiveUsers?.deltaPercent).toBe(100);
    expect(payload.activity?.comparisons?.assignedSeats?.direction).toBe("up");
  });

  it("reconciles filtered user and product costs to the filtered model total", () => {
    const payload = buildAnalyticsDashboard(
      {
        usageByModel: [
          {
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            results: [
              {
                uncached_input_tokens: 40,
                cache_read_input_tokens: 0,
                cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
                output_tokens: 60,
                requests: 5,
                server_tool_use: { web_search_requests: 0 },
                context_window: null,
                inference_geo: null,
                model: "claude-sonnet",
                product: null,
                speed: null,
              },
            ],
          },
        ],
        usageByProduct: [
          {
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            results: [
              {
                uncached_input_tokens: 24,
                cache_read_input_tokens: 0,
                cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
                output_tokens: 36,
                requests: 3,
                server_tool_use: { web_search_requests: 0 },
                context_window: null,
                inference_geo: null,
                model: null,
                product: "claude_code",
                speed: null,
              },
              {
                uncached_input_tokens: 16,
                cache_read_input_tokens: 0,
                cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
                output_tokens: 24,
                requests: 2,
                server_tool_use: { web_search_requests: 0 },
                context_window: null,
                inference_geo: null,
                model: null,
                product: "claude_design",
                speed: null,
              },
            ],
          },
        ],
        costByModel: [
          {
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            results: [
              {
                amount: "10000",
                list_amount: "10000",
                currency: "USD" as const,
                cost_type: "tokens" as const,
                token_type: null,
                context_window: null,
                inference_geo: null,
                model: "claude-sonnet",
                product: null,
                speed: null,
                requests: null,
              },
            ],
          },
        ],
        costByProduct: [
          {
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            results: [
              {
                amount: "45609871",
                list_amount: "45609871",
                currency: "USD" as const,
                cost_type: "tokens" as const,
                token_type: null,
                context_window: null,
                inference_geo: null,
                model: null,
                product: "claude_code",
                speed: null,
                requests: null,
              },
            ],
          },
        ],
        costByTypeBuckets: [],
        userUsage: [
          {
            actor: { user_id: "u1", email: "u1@example.com", name: "Ada" },
            total_tokens: 100,
            output_tokens: 60,
            requests: 5,
            uncached_input_tokens: 40,
            cache_read_input_tokens: 0,
            cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
            server_tool_use: { web_search_requests: 0 },
            context_window: null,
            inference_geo: null,
            model: null,
            product: null,
            speed: null,
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
          },
        ],
        userCost: [
          {
            actor: { user_id: "u1", email: "u1@example.com", name: "Ada" },
            amount: "45609871",
            list_amount: "45609871",
            currency: "USD" as const,
            cost_type: "tokens" as const,
            token_type: null,
            model: null,
            product: null,
            starting_at: "2026-01-10T00:00:00Z",
            ending_at: "2026-01-11T00:00:00Z",
            requests: null,
          },
        ],
        summaries: [],
      },
      { startingAt: "2026-01-10T00:00:00Z", endingAt: "2026-01-11T00:00:00Z" },
      undefined,
      "u1",
    );

    expect(payload.summary.totalCostUsd).toBe(100);
    expect(payload.byUser?.[0]?.costUsd).toBe(100);
    expect(payload.byProduct?.map((row) => [row.product, row.costUsd])).toEqual([
      ["Claude Code", 60],
      ["Claude Design", 40],
    ]);
  });
});
