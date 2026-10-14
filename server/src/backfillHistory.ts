import { closeDatabase, ensureDatabaseSchema, isPersistenceEnabled, persistDashboardSnapshot } from "./postgres.js";
import { config } from "./config.js";
import { getDashboardForBounds } from "./dashboardService.js";

interface CliOptions {
  start: string;
  end: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUtc(): string {
  return addDays(todayUtc(), -1);
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (key && value) values.set(key, value);
  }

  const today = new Date();
  const requestedEnd = values.get("end") ?? today.toISOString().slice(0, 10);
  const end = config.source === "analytics" && requestedEnd >= todayUtc() ? yesterdayUtc() : requestedEnd;
  const start = values.get("start") ?? (config.source === "analytics" ? "2026-01-01" : end);
  return { start, end };
}

function isoDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS;
  return new Date(next).toISOString().slice(0, 10);
}

async function main() {
  if (!isPersistenceEnabled()) {
    throw new Error("Persistence is disabled. Set DATABASE_URL and leave PERSIST_HISTORY=true.");
  }

  const { start, end } = parseArgs(process.argv.slice(2));
  if (start > end) {
    console.log(`[backfill-history] nothing to do: requested range resolves to ${start}..${end}`);
    return;
  }
  await ensureDatabaseSchema();

  let currentDate = start;
  let count = 0;
  while (currentDate <= end) {
    const nextDate = addDays(currentDate, 1);
    const payload = await getDashboardForBounds(
      { startingAt: isoDay(currentDate), endingAt: isoDay(nextDate) },
      undefined,
      { analytics: { sequentialReports: true } },
    );
    await persistDashboardSnapshot({
      source: payload.source,
      requestKey: `day:${currentDate}`,
      payload,
    });
    count += 1;
    if (count % 7 === 0) {
      console.log(`Persisted ${count} daily snapshots through ${currentDate}`);
    }
    currentDate = nextDate;
  }

  console.log(`Persisted ${count} daily snapshots from ${start} through ${end}.`);
}

main()
  .catch((err) => {
    console.error("[backfill-history] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
