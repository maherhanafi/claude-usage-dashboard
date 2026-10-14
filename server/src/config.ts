import dotenv from "dotenv";
import type { DashboardSource } from "./types.js";

dotenv.config();

const adminKey = process.env.ANTHROPIC_ADMIN_KEY?.trim() || "";
const analyticsKey = process.env.ANTHROPIC_ANALYTICS_KEY?.trim() || "";
const analysisApiKey = process.env.ANALYSIS_API_KEY?.trim() || "";
const analysisModel =
  process.env.ANALYSIS_MODEL?.trim() ||
  "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf";
const forceMock = (process.env.USE_MOCK || "").trim().toLowerCase() === "true";
const databaseUrl = process.env.DATABASE_URL?.trim() || "";
const persistHistory = databaseUrl.length > 0 && (process.env.PERSIST_HISTORY || "true").trim().toLowerCase() !== "false";
const historyWarmupConcurrency = Math.min(
  16,
  Math.max(1, Number.parseInt(process.env.HISTORY_WARMUP_CONCURRENCY || "4", 10) || 4),
);
const anthropicBaseUrl = (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/$/, "");
const analysisBaseUrl = (process.env.ANALYSIS_BASE_URL?.trim() || "http://localhost:1234/v1").replace(/\/$/, "");
const mockCurrentDayOfMonthRaw = (process.env.MOCK_CURRENT_DAY_OF_MONTH || "").trim();

function parseMockCurrentDayOfMonth(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 31) return null;
  return parsed;
}

// Optional explicit override: analytics | admin | mock | auto (default auto).
const dataSourceEnv = (process.env.DATA_SOURCE || "auto").trim().toLowerCase();

/**
 * Decide where dashboard data comes from.
 *
 * Priority when DATA_SOURCE=auto (the default):
 *   1. USE_MOCK=true            → mock
 *   2. Analytics key present    → analytics (Claude.ai Enterprise per-user analytics)
 *   3. Admin key present        → admin (Claude Platform usage/cost)
 *   4. nothing configured       → mock
 *
 * DATA_SOURCE can force a specific source; it falls back to mock if the
 * required key for that source is missing.
 */
function resolveSource(): DashboardSource {
  if (forceMock) return "mock";
  switch (dataSourceEnv) {
    case "analytics":
      return analyticsKey ? "analytics" : "mock";
    case "admin":
      return adminKey ? "admin" : "mock";
    case "mock":
      return "mock";
    default: // auto
      if (analyticsKey) return "analytics";
      if (adminKey) return "admin";
      return "mock";
  }
}

const source = resolveSource();

export const config = {
  port: Number(process.env.PORT) || 8787,
  adminKey,
  analyticsKey,
  analysisApiKey,
  analysisModel,
  databaseUrl,
  persistHistory,
  anthropicVersion: process.env.ANTHROPIC_VERSION?.trim() || "2023-06-01",
  anthropicBaseUrl,
  analysisBaseUrl,
  source,
  useMock: source === "mock",
  mockCurrentDayOfMonth: parseMockCurrentDayOfMonth(mockCurrentDayOfMonthRaw),
  historyWarmupConcurrency,
};

export type AppConfig = typeof config;
