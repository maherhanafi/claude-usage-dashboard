import { Pool } from "pg";
import { config } from "./config.js";
import type { DashboardPayload } from "./types.js";

interface SnapshotLookup {
  source: DashboardPayload["source"];
  requestKey: string;
  userId?: string;
  rangeStart: string;
  rangeEnd: string;
}

interface SnapshotWrite {
  source: DashboardPayload["source"];
  requestKey: string;
  userId?: string;
  payload: DashboardPayload;
}

interface SnapshotRangeLookup {
  source: DashboardPayload["source"];
  userId?: string;
  rangeStart: string;
  rangeEnd: string;
}

interface ExactRangeLookup {
  source: DashboardPayload["source"];
  userId?: string;
  rangeStart: string;
  rangeEnd: string;
}

const schemaSql = `
create table if not exists dashboard_snapshots (
  id bigserial primary key,
  source text not null,
  request_key text not null,
  user_id text not null default '',
  range_start timestamptz not null,
  range_end timestamptz not null,
  generated_at timestamptz not null,
  persisted_at timestamptz not null default now(),
  payload jsonb not null,
  unique (source, request_key, user_id, range_start, range_end)
);

create index if not exists idx_dashboard_snapshots_lookup
  on dashboard_snapshots (source, request_key, user_id, range_start desc, persisted_at desc);
`;

const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      max: 4,
    })
  : null;

let schemaReady: Promise<void> | null = null;

export function isPersistenceEnabled(): boolean {
  return Boolean(pool) && config.persistHistory;
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (!isPersistenceEnabled() || !pool) return;
  if (!schemaReady) {
    schemaReady = pool.query(schemaSql).then(() => undefined);
  }
  await schemaReady;
}

export async function loadDashboardSnapshot(params: SnapshotLookup): Promise<DashboardPayload | null> {
  if (!isPersistenceEnabled() || !pool) return null;
  await ensureDatabaseSchema();
  const result = await pool.query<{ payload: DashboardPayload }>(
    `
      select payload
      from dashboard_snapshots
      where source = $1
        and request_key = $2
        and user_id = $3
        and range_start = $4::timestamptz
        and range_end = $5::timestamptz
      order by persisted_at desc
      limit 1
    `,
    [params.source, params.requestKey, params.userId ?? "", params.rangeStart, params.rangeEnd],
  );
  return result.rows[0]?.payload ?? null;
}

export async function loadDailyDashboardSnapshots(params: SnapshotRangeLookup): Promise<DashboardPayload[]> {
  if (!isPersistenceEnabled() || !pool) return [];
  await ensureDatabaseSchema();
  const result = await pool.query<{ payload: DashboardPayload }>(
    `
      select payload
      from dashboard_snapshots
      where source = $1
        and user_id = $2
        and request_key like 'day:%'
        and range_start >= $3::timestamptz
        and range_end <= $4::timestamptz
      order by range_start asc
    `,
    [params.source, params.userId ?? "", params.rangeStart, params.rangeEnd],
  );
  return result.rows.map((row) => row.payload);
}

export async function loadDashboardSnapshotForRange(params: ExactRangeLookup): Promise<DashboardPayload | null> {
  if (!isPersistenceEnabled() || !pool) return null;
  await ensureDatabaseSchema();
  const result = await pool.query<{ payload: DashboardPayload }>(
    `
      select payload
      from dashboard_snapshots
      where source = $1
        and user_id = $2
        and range_start = $3::timestamptz
        and range_end = $4::timestamptz
      order by persisted_at desc
      limit 1
    `,
    [params.source, params.userId ?? "", params.rangeStart, params.rangeEnd],
  );
  return result.rows[0]?.payload ?? null;
}

export async function persistDashboardSnapshot(params: SnapshotWrite): Promise<void> {
  if (!isPersistenceEnabled() || !pool) return;
  await ensureDatabaseSchema();
  await pool.query(
    `
      insert into dashboard_snapshots (
        source,
        request_key,
        user_id,
        range_start,
        range_end,
        generated_at,
        payload
      )
      values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7::jsonb)
      on conflict (source, request_key, user_id, range_start, range_end)
      do update set
        generated_at = excluded.generated_at,
        payload = excluded.payload,
        persisted_at = now()
    `,
    [
      params.source,
      params.requestKey,
      params.userId ?? "",
      params.payload.range.startingAt,
      params.payload.range.endingAt,
      params.payload.generatedAt,
      JSON.stringify(params.payload),
    ],
  );
}

export async function closeDatabase(): Promise<void> {
  if (!pool) return;
  await pool.end();
}
