# Data Schemas

This document captures the main data structures used by the dashboard pipeline.

- Source-of-truth types: [server/src/types.ts](../server/src/types.ts)
- Frontend mirror types: [client/src/types.ts](../client/src/types.ts)

## Aggregated dashboard payload

```mermaid
classDiagram
direction TB

class DashboardPayload {
  +DashboardSource source
  +Range range
  +DashboardSummary summary
  +string[] warnings
  +TimePoint[] timeseries
  +ModelBreakdown[] byModel
  +ModelTimePoint[] modelTimeseries
  +string[] modelKeys
  +CostTypeBreakdown[] costByType
  +UserBreakdown[] byUser
  +UserStats userStats
  +ProductBreakdown[] byProduct
  +GroupBreakdown[] byGroup
  +ActivitySnapshot activity
  +string dataRefreshedAt
  +string generatedAt
}

class Range {
  +string startingAt
  +string endingAt
  +string bucketWidth
}

class DashboardSummary {
  +number totalCostUsd
  +number totalTokens
  +number uncachedInputTokens
  +number cacheReadTokens
  +number cacheCreationTokens
  +number outputTokens
  +number webSearchRequests
  +number cacheHitRate
  +SummaryComparisons comparisons
}

class SummaryComparisons {
  +MetricComparison totalCostUsd
  +MetricComparison totalTokens
  +MetricComparison outputTokens
  +MetricComparison cacheHitRate
  +MetricComparison webSearchRequests
}

class MetricComparison {
  +number previousValue
  +number deltaValue
  +number deltaPercent
  +string direction
  +string label
}

class TimePoint {
  +string date
  +number uncachedInputTokens
  +number cacheReadTokens
  +number cacheCreationTokens
  +number outputTokens
  +number totalTokens
  +number costUsd
}

class ModelBreakdown {
  +string model
  +number uncachedInputTokens
  +number cacheReadTokens
  +number cacheCreationTokens
  +number outputTokens
  +number totalTokens
  +number costUsd
  +MetricComparison costComparison
}

class ModelTimePoint {
  +string date
  +Record~string,number~ values
}

class CostTypeBreakdown {
  +string costType
  +number costUsd
}

class UserBreakdown {
  +string userId
  +string name
  +string email
  +boolean deleted
  +number totalTokens
  +number outputTokens
  +number costUsd
  +number requests
  +MetricComparison totalTokensComparison
  +MetricComparison costComparison
}

class UserStats {
  +number userCount
  +number avgTokens
  +number maxTokens
  +string topTokensUser
  +number avgCostUsd
  +number maxCostUsd
  +string topCostUser
}

class ProductBreakdown {
  +string product
  +number totalTokens
  +number costUsd
  +MetricComparison costComparison
}

class GroupBreakdown {
  +string groupId
  +string name
  +number memberCount
  +number totalTokens
  +number outputTokens
  +number costUsd
  +number requests
}

class ActivitySnapshot {
  +string date
  +number assignedSeats
  +number pendingInvites
  +number dailyActiveUsers
  +number weeklyActiveUsers
  +number monthlyActiveUsers
  +number dailyAdoptionRate
  +number weeklyAdoptionRate
  +number monthlyAdoptionRate
  +ActivityComparisons comparisons
}

class ActivityComparisons {
  +MetricComparison assignedSeats
  +MetricComparison dailyActiveUsers
  +MetricComparison weeklyActiveUsers
  +MetricComparison monthlyActiveUsers
}

DashboardPayload --> Range
DashboardPayload --> DashboardSummary
DashboardPayload --> TimePoint
DashboardPayload --> ModelBreakdown
DashboardPayload --> ModelTimePoint
DashboardPayload --> CostTypeBreakdown
DashboardPayload --> UserBreakdown
DashboardPayload --> UserStats
DashboardPayload --> ProductBreakdown
DashboardPayload --> GroupBreakdown
DashboardPayload --> ActivitySnapshot

DashboardSummary --> SummaryComparisons
SummaryComparisons --> MetricComparison
ModelBreakdown --> MetricComparison
UserBreakdown --> MetricComparison
ProductBreakdown --> MetricComparison
ActivitySnapshot --> ActivityComparisons
ActivityComparisons --> MetricComparison
```

## Source API schemas

```mermaid
classDiagram
direction TB

class CacheCreation {
  +number ephemeral_1h_input_tokens
  +number ephemeral_5m_input_tokens
}

class WebToolUse {
  +number web_search_requests
}

class UsageBucket {
  +string starting_at
  +string ending_at
  +UsageResult[] results
}

class UsageResult {
  +CacheCreation cache_creation
  +number cache_read_input_tokens
  +number uncached_input_tokens
  +number output_tokens
  +WebToolUse server_tool_use
  +string model
  +string context_window
  +string inference_geo
}

class CostBucket {
  +string starting_at
  +string ending_at
  +CostResult[] results
}

class CostResult {
  +string amount
  +string cost_type
  +string currency
  +string description
  +string model
}

class AnalyticsUserActor {
  +string user_id
  +string email
  +string name
  +boolean deleted
}

class AnalyticsUsageBucket {
  +string starting_at
  +string ending_at
  +AnalyticsUsageResult[] results
}

class AnalyticsUsageResult {
  +CacheCreation cache_creation
  +number cache_read_input_tokens
  +number uncached_input_tokens
  +number output_tokens
  +number requests
  +WebToolUse server_tool_use
  +string model
  +string product
  +string speed
}

class AnalyticsCostBucket {
  +string starting_at
  +string ending_at
  +AnalyticsCostResult[] results
}

class AnalyticsCostResult {
  +string amount
  +string list_amount
  +string currency
  +string cost_type
  +string token_type
  +string model
  +string product
  +number requests
}

class AnalyticsUserUsageRow {
  +AnalyticsUserActor actor
  +number total_tokens
  +string starting_at
  +string ending_at
}

class AnalyticsUserCostRow {
  +AnalyticsUserActor actor
  +string amount
  +string list_amount
  +string currency
  +string cost_type
  +string model
  +string product
  +string starting_at
  +string ending_at
}

class AnalyticsSummary {
  +string starting_at
  +string ending_at
  +number assigned_seat_count
  +number pending_invite_count
  +number daily_active_user_count
  +number weekly_active_user_count
  +number monthly_active_user_count
  +number daily_adoption_rate
  +number weekly_adoption_rate
  +number monthly_adoption_rate
}

UsageBucket --> UsageResult
UsageResult --> CacheCreation
UsageResult --> WebToolUse
CostBucket --> CostResult
AnalyticsUsageBucket --> AnalyticsUsageResult
AnalyticsUsageResult --> CacheCreation
AnalyticsUsageResult --> WebToolUse
AnalyticsCostBucket --> AnalyticsCostResult
AnalyticsUserUsageRow --> AnalyticsUserActor
AnalyticsUserCostRow --> AnalyticsUserActor
```

## Data flow

```mermaid
flowchart LR
  A[Admin API\nUsageBucket / CostBucket] --> D[Aggregation Layer]
  B[Analytics API\nUsage / Cost / User / Summary] --> D
  C[Group Config / Membership Data] --> D
  D --> E[DashboardPayload]
  E --> F[React client]
```