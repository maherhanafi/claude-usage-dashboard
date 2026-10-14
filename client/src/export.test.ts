import { describe, expect, it } from "vitest";
import { buildUserCsv } from "./export";
import type { UserBreakdown } from "./types";

describe("buildUserCsv", () => {
  it("serializes user rows as CSV with headers and escaped values", () => {
    const rows: UserBreakdown[] = [
      {
        userId: "u1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        groups: [{ groupId: "g1", name: "Engineering" }],
        effectiveRoles: [{ roleId: "Builder", name: "Builder" }],
        deleted: false,
        cacheHitRate: 20,
        totalTokens: 1200,
        outputTokens: 300,
        costUsd: 12.34,
        requests: 5,
      },
      {
        userId: "u2",
        name: 'Grace "Quotes"',
        email: null,
        groups: [{ groupId: "g2", name: "Product" }, { groupId: "g3", name: "Analytics" }],
        effectiveRoles: [{ roleId: "Analyst", name: "Analyst" }, { roleId: "Viewer", name: "Viewer" }],
        deleted: true,
        cacheHitRate: 50,
        totalTokens: 400,
        outputTokens: 100,
        costUsd: 3.2,
        requests: 2,
      },
    ];

    const csv = buildUserCsv(rows);

    expect(csv).toContain("userId,name,email,groups,effectiveRoles,deleted,requests,outputTokens,totalTokens,cacheHitRate,costUsd");
    expect(csv).toContain('"Grace ""Quotes"""');
    expect(csv).toContain("ada@example.com");
    expect(csv).toContain("Engineering");
    expect(csv).toContain("Builder");
    expect(csv).toContain("Analyst; Viewer");
  });
});
