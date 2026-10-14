import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import cors from "cors";
import express from "express";
import { getRbacCredential, getRbacGroups, getRbacRoles, AdminApiError } from "./anthropicAdmin.js";
import { getUsageBuckets as getAnalyticsUsageBuckets, AnalyticsApiError } from "./anthropicAnalytics.js";
import { config } from "./config.js";
import {
  CURRENT_DAY_REFRESH_MS,
  ensureRecentHistory,
  finalizeDashboardAnalysis,
  getDashboardAnalysis,
  getDashboard,
  getHistorySyncStatus,
  refreshCurrentDaySnapshot,
  streamDashboardAnalysis,
} from "./dashboardService.js";
import { HttpApiError } from "./httpError.js";
import { getMonthlyCostAnalysisHealth } from "./monthlyCostAnalysis.js";
import { ensureDatabaseSchema, isPersistenceEnabled } from "./postgres.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

interface ApiKeyHealth {
  envVar: string;
  configured: boolean;
  keyType: string;
  visibleScopes: string[];
  missingScopes: string[];
  lastCheckedAt: string;
  error?: string;
}

function keyTypeFromValue(value: string): string {
  if (value.startsWith("sk-ant-admin01-")) return "Claude Console admin key";
  if (value.startsWith("sk-ant-api01-")) return "Claude Enterprise scoped key";
  return "Custom key";
}

function extractScopes(body: string, label: "Got" | "Needed one of"): string[] {
  const match = body.match(new RegExp(`${label}:\\s*\\[([^\\]]*)\\]`, "i"));
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).filter(Boolean);
}

function buildApiKeyHealthBase(envVar: string, key: string): ApiKeyHealth {
  return {
    envVar,
    configured: key.length > 0,
    keyType: key.length > 0 ? keyTypeFromValue(key) : "Not configured",
    visibleScopes: [],
    missingScopes: [],
    lastCheckedAt: new Date().toISOString(),
  };
}

async function getAdminKeyHealth(): Promise<ApiKeyHealth> {
  const credential = getRbacCredential();
  const health = buildApiKeyHealthBase(credential.envVar, credential.key);
  if (!health.configured) return health;

  const visibleScopes = new Set<string>();
  const missingScopes = new Set<string>();

  const runProbe = async (scope: string, probe: () => Promise<unknown>) => {
    try {
      await probe();
      visibleScopes.add(scope);
    } catch (error) {
      if (error instanceof AdminApiError) {
        for (const inferred of extractScopes(error.body, "Got")) visibleScopes.add(inferred);
        for (const missing of extractScopes(error.body, "Needed one of")) missingScopes.add(missing);
        if (error.status === 401 && !health.error) {
          health.error = "Anthropic rejected this admin key.";
        }
        return;
      }

      if (!health.error) {
        health.error = error instanceof Error ? error.message : String(error);
      }
    }
  };

  await Promise.all([
    runProbe("read:rbac_groups", () => getRbacGroups(1)),
    runProbe("read:members", () => getRbacRoles(1)),
  ]);

  health.visibleScopes = [...visibleScopes].sort();
  health.missingScopes = [...missingScopes].filter((scope) => !visibleScopes.has(scope)).sort();
  if (!health.error && !health.visibleScopes.length && health.missingScopes.length) {
    health.error = "This key is configured, but the app could not verify the scopes it needs.";
  }
  return health;
}

async function getAnalyticsKeyHealth(): Promise<ApiKeyHealth> {
  const health = buildApiKeyHealthBase("ANTHROPIC_ANALYTICS_KEY", config.analyticsKey);
  if (!health.configured) return health;

  const visibleScopes = new Set<string>();
  const missingScopes = new Set<string>();
  const dayEnd = new Date();
  dayEnd.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date(dayEnd);
  dayStart.setUTCDate(dayStart.getUTCDate() - 1);

  try {
    await getAnalyticsUsageBuckets(
      { startingAt: dayStart.toISOString(), endingAt: dayEnd.toISOString() },
      ["model"],
    );
    visibleScopes.add("read:analytics");
  } catch (error) {
    if (error instanceof AnalyticsApiError) {
      for (const inferred of extractScopes(error.body, "Got")) visibleScopes.add(inferred);
      for (const missing of extractScopes(error.body, "Needed one of")) missingScopes.add(missing);
      if (error.status === 401) {
        health.error = "Anthropic rejected this analytics key.";
      } else if (error.status !== 403) {
        health.error = `Anthropic Analytics API returned ${error.status}.`;
      }
    } else {
      health.error = error instanceof Error ? error.message : String(error);
    }
  }

  health.visibleScopes = [...visibleScopes].sort();
  health.missingScopes = [...missingScopes].filter((scope) => !visibleScopes.has(scope)).sort();
  if (!health.error && !health.visibleScopes.length && health.missingScopes.length) {
    health.error = "This key is configured, but the app could not verify the scopes it needs.";
  }
  return health;
}

function buildHistorySyncSummary() {
  const historySync = getHistorySyncStatus();
  const lastSuccessfulSyncAt = [historySync.recentHistory.lastCompletedAt, historySync.currentDay.lastCompletedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return {
    healthy: !historySync.recentHistory.lastError && !historySync.currentDay.lastError,
    inProgress: historySync.recentHistory.inProgress || historySync.currentDay.inProgress,
    lastSuccessfulSyncAt,
    lastError: historySync.currentDay.lastError ?? historySync.recentHistory.lastError,
    lastSnapshotDate: historySync.currentDay.lastSnapshotDate,
    warmupFetchedDays: historySync.recentHistory.fetchedDays,
    warmupRequestedDays: historySync.recentHistory.requestedDays,
  };
}

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  const [analysis, adminKeyHealth, analyticsKeyHealth] = await Promise.all([
    getMonthlyCostAnalysisHealth(),
    getAdminKeyHealth(),
    getAnalyticsKeyHealth(),
  ]);
  res.json({
    ok: true,
    source: config.source,
    adminKeyConfigured: config.adminKey.length > 0,
    analyticsKeyConfigured: config.analyticsKey.length > 0,
    apiKeys: {
      admin: adminKeyHealth,
      analytics: analyticsKeyHealth,
    },
    persistenceEnabled: isPersistenceEnabled(),
    analysis,
    historySyncSummary: buildHistorySyncSummary(),
    historySync: getHistorySyncStatus(),
  });
});

app.get("/api/dashboard", async (req, res) => {
  // Prefer the `period` token (today | this_month | last_month | "<N>d").
  // Fall back to the legacy `days` query param for back-compat.
  const period =
    typeof req.query.period === "string" && req.query.period
      ? req.query.period
      : `${Number(req.query.days) || 7}d`;
  const userId = typeof req.query.user === "string" && req.query.user ? req.query.user : undefined;
  const groupId = typeof req.query.group === "string" && req.query.group ? req.query.group : undefined;
  const force =
    typeof req.query.force === "string"
      ? ["1", "true", "yes"].includes(req.query.force.toLowerCase())
      : false;
  try {
    const payload = await getDashboard(period, force, userId, groupId);
    res.json(payload);
  } catch (err) {
    if (err instanceof HttpApiError) {
      console.error(`[${err.api}-api] ${err.message}`);
      let message: string;
      if (err.api === "analytics") {
        message =
          err.status === 401 || err.status === 403
            ? "Anthropic rejected the Analytics API key. It must be a Claude.ai Enterprise Analytics key with the read:analytics scope (created by the org's primary owner in claude.ai → Settings → API), and the org must be on a Claude Enterprise plan."
            : err.status === 429
              ? "Analytics API rate limit of 60 requests per minute has been exceeded. Retry again later."
            : `Anthropic Analytics API returned ${err.status}.`;
      } else {
        message =
          err.status === 401
            ? "Anthropic rejected the Admin API key (401). Check ANTHROPIC_ADMIN_KEY — it must be an Admin key (sk-ant-admin01-…), not a regular API key."
            : `Anthropic Admin API returned ${err.status}.`;
      }
      res.status(502).json({ error: `${err.api}_api_error`, status: err.status, message, detail: err.body });
    } else {
      console.error("[dashboard] unexpected error", err);
      res.status(500).json({ error: "internal_error", message: (err as Error).message });
    }
  }
});

app.get("/api/dashboard-analysis", async (req, res) => {
  const period =
    typeof req.query.period === "string" && req.query.period
      ? req.query.period
      : `${Number(req.query.days) || 7}d`;
  const userId = typeof req.query.user === "string" && req.query.user ? req.query.user : undefined;
  const groupId = typeof req.query.group === "string" && req.query.group ? req.query.group : undefined;
  try {
    const analysis = await getDashboardAnalysis(period, userId, groupId);
    res.json(analysis);
  } catch (err) {
    if (err instanceof HttpApiError) {
      console.error(`[${err.api}-api] ${err.message}`);
      res.status(502).json({ error: `${err.api}_api_error`, status: err.status, message: `${err.api} analysis failed`, detail: err.body });
    } else {
      console.error("[analysis] unexpected error", err);
      res.status(500).json({ error: "internal_error", message: (err as Error).message });
    }
  }
});

app.get("/api/dashboard-analysis/stream", async (req, res) => {
  const period =
    typeof req.query.period === "string" && req.query.period
      ? req.query.period
      : `${Number(req.query.days) || 7}d`;
  const userId = typeof req.query.user === "string" && req.query.user ? req.query.user : undefined;
  const groupId = typeof req.query.group === "string" && req.query.group ? req.query.group : undefined;
  let closed = false;

  req.on("close", () => {
    closed = true;
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: string, payload: unknown) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent("status", { state: "started" });

  try {
    await streamDashboardAnalysis(
      period,
      {
        onDelta: (delta) => {
          sendEvent("delta", { text: delta });
        },
      },
      userId,
      groupId,
    );

    sendEvent("status", { state: "finalizing" });
    const heartbeat = setInterval(() => {
      sendEvent("heartbeat", { state: "finalizing" });
    }, 3000);

    try {
      const analysis = await finalizeDashboardAnalysis(period, userId, groupId);
      clearInterval(heartbeat);
      sendEvent("result", analysis);
    } catch (finalizeError) {
      clearInterval(heartbeat);
      throw finalizeError;
    }

    res.end();
  } catch (err) {
    if (err instanceof HttpApiError) {
      console.error(`[${err.api}-api] ${err.message}`);
      sendEvent("error", { message: `${err.api} analysis failed`, status: err.status, detail: err.body });
    } else {
      console.error("[analysis-stream] unexpected error", err);
      sendEvent("error", { message: (err as Error).message });
    }
    res.end();
  }
});

let currentDayRefreshTimer: NodeJS.Timeout | undefined;
let currentDayRefreshTask: Promise<void> | null = null;

function startCurrentDayRefreshLoop() {
  if (currentDayRefreshTimer) return;
  currentDayRefreshTimer = setInterval(() => {
    if (currentDayRefreshTask) return;
    currentDayRefreshTask = refreshCurrentDaySnapshot()
      .then((payload) => {
        console.log(`[history-sync] refreshed current day snapshot for ${payload.range.startingAt.slice(0, 10)}`);
      })
      .catch((err) => {
        console.error("[history-sync] current day refresh failed", err);
      })
      .finally(() => {
        currentDayRefreshTask = null;
      });
  }, CURRENT_DAY_REFRESH_MS);
}

async function primeHistoricalData() {
  if (!isPersistenceEnabled() || config.source === "mock") return;

  const hydrated = await ensureRecentHistory();
  console.log(
    `[history-sync] ensured ${hydrated.requestedDays} days of history (${hydrated.bounds.startingAt.slice(0, 10)} to ${new Date(
      new Date(hydrated.bounds.endingAt).getTime() - 1,
    )
      .toISOString()
      .slice(0, 10)}), fetched ${hydrated.fetchedDays} missing day(s)`,
  );
  startCurrentDayRefreshLoop();
}

function logStartupBanner() {
  const mode =
    config.source === "analytics"
      ? "LIVE Claude.ai Enterprise Analytics API"
      : config.source === "admin"
        ? "LIVE Claude Platform Admin API"
        : "MOCK data";
  console.log(`\n  Claude Usage Dashboard API`);
  console.log(`  ▶ http://localhost:${config.port}`);
  console.log(`  ▶ mode: ${mode}`);
  console.log(`  ▶ persistence: ${isPersistenceEnabled() ? "Postgres enabled" : "disabled"}`);
  if (isPersistenceEnabled() && config.source !== "mock") {
    console.log(
      `  ▶ history sync: warm last 180 days on startup with concurrency ${config.historyWarmupConcurrency}, refresh current day hourly`,
    );
  }
  if (config.source === "mock") {
    console.log(`  ▶ no API key set — serving realistic mock data.`);
    console.log(`    Add ANTHROPIC_ANALYTICS_KEY (Enterprise) or ANTHROPIC_ADMIN_KEY (Platform) to server/.env.\n`);
  } else {
    console.log("");
  }
}

// Optionally serve the built frontend when it exists (npm run build && npm start).
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

async function start() {
  if (config.source !== "mock" && !isPersistenceEnabled()) {
    throw new Error("Postgres persistence is required for live data. Set DATABASE_URL and keep PERSIST_HISTORY=true.");
  }

  await ensureDatabaseSchema();

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, () => {
      logStartupBanner();
      resolve();
    });

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        const address = server.address() as AddressInfo | string | null;
        const port = typeof address === "object" && address ? address.port : config.port;
        reject(new Error(`Port ${port} is already in use. Stop the existing server or set PORT to a different value in server/.env.`));
        return;
      }

      reject(error);
    });
  });

  void primeHistoricalData().catch((err) => {
    console.error("[history-sync] startup warmup failed", err);
  });
}

start().catch((err) => {
  console.error("[startup] failed", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
