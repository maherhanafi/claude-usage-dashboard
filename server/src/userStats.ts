import type { UserBreakdown, UserStats } from "./types.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Average / maximum tokens and cost across the given users (one row per user). */
export function computeUserStats(users: UserBreakdown[]): UserStats | undefined {
  if (users.length === 0) return undefined;
  const n = users.length;
  const sortedCosts = [...users].map((user) => user.costUsd).sort((left, right) => left - right);

  let totalTokens = 0;
  let totalCost = 0;
  let maxTokens = 0;
  let maxCost = 0;
  let topTokensUser: string | null = null;
  let topCostUser: string | null = null;

  for (const u of users) {
    totalTokens += u.totalTokens;
    totalCost += u.costUsd;
    if (u.totalTokens >= maxTokens) {
      maxTokens = u.totalTokens;
      topTokensUser = u.name;
    }
    if (u.costUsd >= maxCost) {
      maxCost = u.costUsd;
      topCostUser = u.name;
    }
  }

  const medianCostUsd =
    n % 2 === 1
      ? sortedCosts[(n - 1) / 2]
      : (sortedCosts[n / 2 - 1] + sortedCosts[n / 2]) / 2;

  return {
    userCount: n,
    avgTokens: Math.round(totalTokens / n),
    maxTokens,
    topTokensUser,
    avgCostUsd: round2(totalCost / n),
    medianCostUsd: round2(medianCostUsd),
    maxCostUsd: round2(maxCost),
    topCostUser,
  };
}
