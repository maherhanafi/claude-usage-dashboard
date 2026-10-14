# System Architecture

This document shows the major parts of the dashboard system and how they interact.

## High-level architecture

```mermaid
flowchart LR
    U[User in Browser]
    C[React Client<br/>Vite app]
    S[Express Server<br/>dashboardService]
    DB[(Postgres<br/>dashboard_snapshots)]
    A1[Anthropic Analytics API]
    A2[Anthropic Admin API]
    W[Startup Warmup<br/>Last 180 completed days]
    H[Hourly Current-Day Refresh]
    DD[/api/dashboard]
    HE[/api/health]

    U --> C
    C -->|GET dashboard data| DD
    C -->|GET sync status| HE

    DD --> S
    HE --> S

    S -->|read persisted snapshots| DB
    S -->|write daily snapshots| DB

    W --> S
    H --> S

    S -->|live source = analytics| A1
    S -->|live source = admin| A2
```

## Request and refresh flow

```mermaid
sequenceDiagram
    participant User
    participant Client
    participant Server
    participant Postgres
    participant AnalyticsAPI as Anthropic Analytics API
    participant AdminAPI as Anthropic Admin API

    Note over Server,Postgres: On startup
    Server->>Postgres: Check persisted history
    alt live source = analytics
        Server->>AnalyticsAPI: Backfill missing completed days
        Server->>Postgres: Persist analytics daily snapshots
        Note over Server: Start hourly current-day refresh loop
    else live source = admin
        Server->>AdminAPI: Fetch usage and cost for missing completed days
        Server->>Postgres: Persist admin daily snapshots
        Note over Server: Start hourly current-day refresh loop
    end

    User->>Client: Open dashboard or change period
    Client->>Server: GET /api/dashboard?period=...
    Server->>Postgres: Load persisted snapshots for range
    Postgres-->>Server: Daily payloads
    alt persisted range is complete
        Server-->>Client: Aggregated dashboard payload
    else persisted range is missing and live source = analytics
        Server->>AnalyticsAPI: Fetch live range data
        Server->>Postgres: Persist daily snapshots
        Server-->>Client: Aggregated dashboard payload
    else persisted range is missing and live source = admin
        Server->>AdminAPI: Fetch live range data
        Server-->>Client: Aggregated dashboard payload
    end

    User->>Client: Open settings
    Client->>Server: GET /api/health
    Server-->>Client: Warmup and refresh status

    alt hourly refresh in analytics mode
        Server->>AnalyticsAPI: Fetch current-day live data
        Server->>Postgres: Update current-day snapshot
    else hourly refresh in admin mode
        Server->>AdminAPI: Fetch current-day live data
        Server->>Postgres: Update current-day snapshot
    end
```

## Component view

```mermaid
flowchart TD
    App[Client App]
    ApiClient[client/api.ts]
    Settings[Settings Modal]
    Health[Health Status UI]

    Index[server/index.ts]
    DashboardService[server/dashboardService.ts]
    Aggregate[server/aggregateAnalytics.ts<br/>server/aggregate.ts]
    Persistence[server/postgres.ts]
    Backfill[server/backfillHistory.ts]
    Config[server/config.ts]
    AnalyticsClient[server/anthropicAnalytics.ts]
    AdminClient[server/anthropicAdmin.ts]

    App --> ApiClient
    Settings --> Health
    ApiClient --> Index

    Index --> DashboardService
    Index --> Config

    DashboardService --> Persistence
    DashboardService --> Aggregate
    DashboardService --> AnalyticsClient
    DashboardService --> AdminClient

    Backfill --> DashboardService
```

## Responsibility split

- The client only talks to the backend and never calls Anthropic directly.
- The server owns orchestration: persisted reads, warmup, hourly refresh, aggregation, and health reporting.
- Postgres is the persisted store for historical daily snapshots and reused range reads.
- Anthropic APIs are upstream sources used only by the server.
- Current-day live refresh and completed-day historical backfill are separate paths.