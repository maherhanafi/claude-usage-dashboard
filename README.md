# Claude Usage Dashboard

A fullstack dashboard for your organization's **Claude API usage and cost**, powered by Anthropic's [Usage & Cost Admin API](https://platform.claude.com/docs/en/api/usage-cost-api).

- **Backend** (`server/`) — Node + Express + TypeScript. Calls the Admin API server-side, paginates, and aggregates usage + cost into a single payload. Your Admin key never reaches the browser.
- **Frontend** (`client/`) — React + Vite + Recharts. Summary cards, a stacked token-usage chart, a daily-cost chart, a per-model table, and a cost-by-type breakdown.

Runs out of the box with **realistic mock data**, so you can explore the UI before wiring up a real key.

<br />

## Quick start

```bash
# from the repo root
npm install            # installs the root tooling (concurrently)
npm run install:all    # installs server + client dependencies
npm run dev            # starts API (:8787) and UI (:5173) together
```

Open **http://localhost:5173**. With no Admin key set, you'll see mock data and a "● Mock data" badge.

> First run? `npm run install:all` runs `npm install` in the root, `server/`, and `client/`.

<br />

## Connecting your real usage data

The dashboard reads from Anthropic's **Usage & Cost Admin API**, which requires an **Admin API key** — distinct from a regular API key.

1. **Generate an Admin key.** As an organization admin, go to the [Claude Console](https://console.anthropic.com) → **Settings → API keys → Admin keys** and create one. It looks like `sk-ant-admin01-…`. See [Create an Admin API key](https://platform.claude.com/docs/en/manage-claude/admin-api-keys).
   - The Admin API is **not available for individual accounts** — your org must be set up in Console → Settings → Organization.
   - Claude **Enterprise** (claude.ai) orgs use a different Analytics API key instead; this dashboard targets the standard Claude Platform Admin API.
2. **Add it to the backend env.**
   ```bash
   cp server/.env.example server/.env
   # edit server/.env and set:
   #   ANTHROPIC_ADMIN_KEY=sk-ant-admin01-...
   ```
3. **Restart** `npm run dev`. The badge flips to "● Live" and the server logs `mode: LIVE Anthropic Admin API`.

That's it — no frontend changes needed. The backend automatically switches from mock to live when a key is present (unless `USE_MOCK=true`).

<br />

## What you get

| Panel | Source | Notes |
|---|---|---|
| Summary cards | usage + cost | Total cost, total tokens, output tokens, cache hit rate, web searches |
| Token usage over time | `usage_report/messages` | Stacked: uncached input / cache read / cache creation / output |
| Daily cost | `cost_report` | USD per day (amounts are converted from the API's cents) |
| Usage & cost by model | both, joined | Tokens grouped by `model`; cost grouped by `description` |
| Cost by type | `cost_report` | tokens vs. web_search vs. code_execution, etc. |

Range selector: **7 / 14 / 30 days** (daily buckets — the Cost API only supports daily granularity, so the unified view aligns on `1d`).

<br />

## How it works

```
Browser (React)  ──/api/dashboard?days=7──▶  Express server  ──x-api-key──▶  api.anthropic.com
     ▲                                            │                          /v1/organizations/usage_report/messages
     └──────────── unified JSON payload ──────────┘                          /v1/organizations/cost_report
```

- `server/src/anthropicAdmin.ts` — typed Admin API client; follows `next_page` until `has_more` is false.
- `server/src/aggregate.ts` — merges raw usage + cost buckets into the dashboard shape (token totals per day/model, USD per day/model/type, cache-hit rate). **Cost `amount` is a decimal string in cents** — divided by 100 here.
- `server/src/mock.ts` — emits the *same raw API shapes* as the live endpoints (seeded so numbers are stable across refreshes), so mock and live flow through the identical aggregator.
- `server/src/dashboardService.ts` — computes the date window and chooses live vs. mock.

Schema diagrams: see [docs/data-schemas.md](docs/data-schemas.md) for the API and aggregated payload structure.

Architecture diagrams: see [docs/architecture.md](docs/architecture.md) for the system components, request flow, and runtime interactions.

Launch hardening checklist: see [docs/launch-hardening-checklist.md](docs/launch-hardening-checklist.md) for the production-readiness items discussed during review.

<br />

## Configuration (`server/.env`)

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_ADMIN_KEY` | _(empty)_ | Admin key. Empty → mock data. |
| `DATABASE_URL` | _(empty)_ | Optional Postgres connection string for persisted dashboard snapshots. |
| `PERSIST_HISTORY` | `true` | Enable or disable Postgres reads/writes when `DATABASE_URL` is set. |
| `HISTORY_WARMUP_CONCURRENCY` | `4` | Max parallel missing-day fetches during the 180-day startup warmup. Clamped to `1..16`. |
| `USE_MOCK` | `false` | Force mock data even with a key set. |
| `MOCK_CURRENT_DAY_OF_MONTH` | unset | When `USE_MOCK=true`, override the mock current UTC day-of-month for previews like `this_month`; invalid or out-of-range values fall back to the real current day. |
| `ANTHROPIC_VERSION` | `2023-06-01` | `anthropic-version` header. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | API base (override for proxies). |
| `PORT` | `8787` | Backend port. |

<br />

## Optional Postgres persistence

If you want the server to retain dashboard history across restarts, set `DATABASE_URL` in `server/.env`.

```bash
createdb claude_usage_dashboard
# then in server/.env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/claude_usage_dashboard
PERSIST_HISTORY=true
```

What gets stored:

- The unified dashboard payload returned by the server
- A snapshot format version so stale persisted rows are automatically ignored after aggregation changes
- The exact date range, source, user filter, and request key used to build it
- Automatic fallback to the persisted snapshot when the upstream API is unavailable for the same window
- On startup, the server fills any missing org-wide daily snapshots across the last 180 days with bounded parallelism, then refreshes the current day every hour

Operational note:

- `GET /api/dashboard?force=true` bypasses the server's in-memory response cache and rebuilds the payload from live data and compatible persisted snapshots

Operational visibility:

- `/api/health` includes a compact `historySyncSummary` block for monitors and a detailed `historySync` block for debugging
- `/api/health` includes recent-history warmup status and current-day refresh status, including timestamps and any last error

To backfill daily history into Postgres:

```bash
npm --prefix server run sync:history -- --start=2026-01-01 --end=2026-08-27
```

This writes one persisted org snapshot per day, which is a practical baseline for retaining historical usage, per-user cost, and summary data on the server.

<br />

## Scripts

| Command | Effect |
|---|---|
| `npm run dev` | Run API + UI together (hot reload) |
| `npm run dev:server` / `npm run dev:client` | Run one side only |
| `npm run build` | Type-check + build server (`tsc`) and client (`vite build`) |
| `npm run typecheck` | Type-check both packages |
| `npm start` | Run the built server; if `client/dist` exists it's served on the same port |
| `npm --prefix server run sync:history -- --start=YYYY-MM-DD --end=YYYY-MM-DD` | Backfill daily dashboard snapshots into Postgres |

### Single-port production

```bash
npm run build
npm start          # serves API + built UI on http://localhost:8787
```

<br />

## Notes & limits

- **Data freshness:** usage/cost data typically appears within ~5 minutes of a request completing.
- **Polling:** browsers only call the backend. The backend caches dashboard responses and owns upstream synchronization for persistence warmup and hourly current-day refresh.
- **Priority Tier** costs are not in the cost endpoint — track them via the usage endpoint's `service_tier`.
- **Default workspace / Workbench** usage reports `null` for `workspace_id` / `api_key_id`; the dashboard labels unattributed model usage as `unattributed`.
- The Admin Usage/Cost API is **not available on Claude Platform on AWS** — use the Console's Usage/Cost pages there.
