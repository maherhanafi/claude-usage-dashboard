import { useCallback, useEffect, useState } from "react";
import { fetchDashboard, fetchDashboardAnalysis, fetchHealth, streamDashboardAnalysis } from "./api";
import type { ChartType, DashboardPayload, Granularity, HealthPayload, MonthlyCostAnalysis, RoleBreakdown, TimePoint, UserBreakdown } from "./types";
import {
  aggregateTimeseries,
  aggregateModelTimeseries,
  cumulativeModelTimeseries,
  cumulativeTimeseries,
  filterDashboardByModel,
} from "./aggregate";
import { SummaryCards } from "./components/SummaryCards";
import { formatComparisonText, formatRangeLabel, fullNumber, modelLabel, usd } from "./format";
import { SettingsModal } from "./components/SettingsModal";
import { toNotificationText } from "./notifications";
import { ActivityCards } from "./components/ActivityCards";
import { UsageChart } from "./components/UsageChart";
import { CostChart } from "./components/CostChart";
import { CacheHitRateChart } from "./components/CacheHitRateChart";
import { CostTypePie } from "./components/CostTypePie";
import { ModelTable } from "./components/ModelTable";
import { ModelUsageChart } from "./components/ModelUsageChart";
import { UserTable } from "./components/UserTable";
import { UserStatsPanel } from "./components/UserStatsPanel";
import { ProductBreakdownPanel } from "./components/ProductBreakdown";
import { GroupBreakdownTable } from "./components/GroupBreakdownTable";
import { RoleBreakdownTable } from "./components/RoleBreakdownTable";
import { Modal } from "./components/Modal";
import { MonthlyCostAnalysisPanel } from "./components/MonthlyCostAnalysisPanel";
import { FeatureUsageSankey } from "./components/FeatureUsageSankey";
import { ForecastSignalsPanel } from "./components/ForecastSignalsPanel";
import { UsageInsightsTable } from "./components/UsageInsightsTable";

const SOURCE_BADGE: Record<DashboardPayload["source"], string> = {
  mock: "● Mock data",
  analytics: "● Live",
  admin: "● Live · Platform Admin",
};

interface RangeOption {
  label: string; // toggle button text
  period: string; // sent to the API
  subLabel: string; // shown on the Total Cost card
}

const RANGES: RangeOption[] = [
  { label: "Today", period: "today", subLabel: "today" },
  { label: "7d", period: "7d", subLabel: "last 7 days" },
  { label: "14d", period: "14d", subLabel: "last 14 days" },
  { label: "30d", period: "30d", subLabel: "last 30 days" },
  { label: "90d", period: "90d", subLabel: "last 90 days" },
  { label: "180d", period: "180d", subLabel: "last 180 days" },
  { label: "This month", period: "this_month", subLabel: "this month" },
  { label: "Last month", period: "last_month", subLabel: "last month" },
];

type GroupBreakdownRow = NonNullable<DashboardPayload["byGroup"]>[number] & { selectable?: boolean };

function parseUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatUtcDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function addUtcDays(day: string, days: number): string {
  const date = parseUtcDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDay(date);
}

function monthEndDay(day: string): string {
  const date = parseUtcDay(day);
  return formatUtcDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function computeMonthEndCostForecast(currentMonthData: DashboardPayload | null, trailing30Data: DashboardPayload | null): number | null {
  if (!currentMonthData || !trailing30Data || currentMonthData.timeseries.length === 0 || trailing30Data.timeseries.length === 0) return null;

  const latestObservedDay = currentMonthData.timeseries[currentMonthData.timeseries.length - 1]?.date;
  if (!latestObservedDay) return null;

  const weekdayBuckets = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  let overallTotal = 0;
  let overallCount = 0;

  for (const point of trailing30Data.timeseries) {
    const weekday = parseUtcDay(point.date).getUTCDay();
    weekdayBuckets[weekday].total += point.costUsd;
    weekdayBuckets[weekday].count += 1;
    overallTotal += point.costUsd;
    overallCount += 1;
  }

  if (overallCount === 0) return null;

  const overallAverage = overallTotal / overallCount;
  const expectedWeekdayCost = (day: string): number => {
    const weekday = parseUtcDay(day).getUTCDay();
    const bucket = weekdayBuckets[weekday];
    return bucket.count > 0 ? bucket.total / bucket.count : overallAverage;
  };

  const remainingDays: string[] = [];
  const finalDay = monthEndDay(latestObservedDay);
  for (let cursor = addUtcDays(latestObservedDay, 1); cursor <= finalDay; cursor = addUtcDays(cursor, 1)) {
    remainingDays.push(cursor);
  }

  if (remainingDays.length === 0) {
    const latestObservedCost = currentMonthData.timeseries[currentMonthData.timeseries.length - 1]?.costUsd ?? 0;
    const projectedCurrentDayCost = Math.max(latestObservedCost, expectedWeekdayCost(latestObservedDay));
    return currentMonthData.summary.totalCostUsd - latestObservedCost + projectedCurrentDayCost;
  }

  const projectedRemainingCost = remainingDays.reduce((sum, day) => {
    return sum + expectedWeekdayCost(day);
  }, 0);

  return currentMonthData.summary.totalCostUsd + projectedRemainingCost;
}

function extendTimeseriesToMonthEnd(points: TimePoint[]): TimePoint[] {
  if (points.length === 0) return points;

  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const lastDate = sorted[sorted.length - 1].date;
  const finalDay = monthEndDay(lastDate);
  if (lastDate >= finalDay) return sorted;

  const extended = [...sorted];
  let cursor = addUtcDays(lastDate, 1);
  while (cursor <= finalDay) {
    extended.push({
      date: cursor,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      isFuture: true,
      projectedCostUsd: null,
    });
    cursor = addUtcDays(cursor, 1);
  }

  return extended;
}

function extendModelTimeseriesToMonthEnd(points: DashboardPayload["modelTimeseries"]): DashboardPayload["modelTimeseries"] {
  if (points.length === 0) return points;

  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const lastDate = sorted[sorted.length - 1].date;
  const finalDay = monthEndDay(lastDate);
  if (lastDate >= finalDay) return sorted;

  const extended = [...sorted];
  let cursor = addUtcDays(lastDate, 1);
  while (cursor <= finalDay) {
    extended.push({ date: cursor, values: {}, isFuture: true });
    cursor = addUtcDays(cursor, 1);
  }

  return extended;
}

function buildProjectedCumulativeCostSeries(
  points: TimePoint[],
  latestObservedDay: string | null,
  forecastTotal: number | null,
): TimePoint[] {
  if (points.length === 0 || !latestObservedDay || forecastTotal == null) {
    return points.map((point) => ({
      ...point,
      displayCostUsd: point.costUsd,
      projectedBarCostUsd: null,
      projectedCostUsd: null,
    }));
  }

  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const lastObservedIndex = sorted.findIndex((point) => point.date === latestObservedDay);
  if (lastObservedIndex === -1 || lastObservedIndex === sorted.length - 1) {
    return sorted.map((point) => ({
      ...point,
      displayCostUsd: point.costUsd,
      projectedBarCostUsd: null,
      projectedCostUsd: null,
    }));
  }

  const lastObservedValue = sorted[lastObservedIndex].costUsd;
  const remainingSteps = sorted.length - 1 - lastObservedIndex;

  return sorted.map((point, index) => {
    if (index < lastObservedIndex) {
      return { ...point, displayCostUsd: point.costUsd, projectedBarCostUsd: null, projectedCostUsd: null };
    }

    if (index === lastObservedIndex) {
      return { ...point, displayCostUsd: point.costUsd, projectedBarCostUsd: null, projectedCostUsd: point.costUsd };
    }

    const progress = (index - lastObservedIndex) / remainingSteps;
    const projectedCostUsd = Math.round((lastObservedValue + (forecastTotal - lastObservedValue) * progress) * 100) / 100;
    return { ...point, displayCostUsd: null, projectedBarCostUsd: projectedCostUsd, projectedCostUsd };
  });
}

function buildCostComparison(currentValue: number, previousValue: number) {
  const deltaValue = currentValue - previousValue;
  const deltaPercent = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : (deltaValue / previousValue) * 100;
  const direction = deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "same";
  return { previousValue, deltaValue, deltaPercent, direction, label: "the previous period" } as const;
}

function buildRoleBreakdown(users: UserBreakdown[] | undefined): RoleBreakdown[] {
  if (!users?.length) return [];

  const roles = new Map<string, RoleBreakdown & { userIds: Set<string>; previousCostUsd: number }>();
  let unassignedRoleCount = 0;
  let unassignedRoleRequests = 0;
  let unassignedRoleOutputTokens = 0;
  let unassignedRoleTotalTokens = 0;
  let unassignedRoleCostUsd = 0;
  let unassignedRolePreviousCostUsd = 0;

  for (const user of users) {
    const effectiveRoles = user.effectiveRoles ?? [];
    if (effectiveRoles.length === 0) {
      unassignedRoleCount += 1;
      unassignedRoleRequests += user.requests;
      unassignedRoleOutputTokens += user.outputTokens;
      unassignedRoleTotalTokens += user.totalTokens;
      unassignedRoleCostUsd += user.costUsd;
      unassignedRolePreviousCostUsd += user.costComparison?.previousValue ?? 0;
      continue;
    }

    for (const role of effectiveRoles) {
      const existing = roles.get(role.roleId);
      if (existing) {
        existing.userIds.add(user.userId);
        existing.userCount = existing.userIds.size;
        existing.requests += user.requests;
        existing.outputTokens += user.outputTokens;
        existing.totalTokens += user.totalTokens;
        existing.costUsd += user.costUsd;
        existing.previousCostUsd += user.costComparison?.previousValue ?? 0;
        continue;
      }

      roles.set(role.roleId, {
        roleId: role.roleId,
        name: role.name,
        userCount: 1,
        requests: user.requests,
        outputTokens: user.outputTokens,
        totalTokens: user.totalTokens,
        costUsd: user.costUsd,
        previousCostUsd: user.costComparison?.previousValue ?? 0,
        userIds: new Set([user.userId]),
      });
    }
  }

  const rows = [...roles.values()]
    .map(({ userIds: _userIds, previousCostUsd, ...role }) => ({
      ...role,
      costComparison: buildCostComparison(role.costUsd, previousCostUsd),
    }))
    .sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens || left.name.localeCompare(right.name));

  if (unassignedRoleCount > 0) {
    rows.push({
      roleId: "__no_role__",
      name: "No role",
      userCount: unassignedRoleCount,
      requests: unassignedRoleRequests,
      outputTokens: unassignedRoleOutputTokens,
      totalTokens: unassignedRoleTotalTokens,
      costUsd: unassignedRoleCostUsd,
      costComparison: buildCostComparison(unassignedRoleCostUsd, unassignedRolePreviousCostUsd),
    });
  }

  return rows.sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens || left.name.localeCompare(right.name));
}

function buildGroupBreakdown(
  groups: DashboardPayload["byGroup"] | undefined,
  users: UserBreakdown[] | undefined,
): GroupBreakdownRow[] {
  const rows: GroupBreakdownRow[] = [...(groups ?? [])];
  if (!users?.length) return rows;

  let ungroupedUsers = 0;
  let ungroupedRequests = 0;
  let ungroupedOutputTokens = 0;
  let ungroupedTotalTokens = 0;
  let ungroupedCostUsd = 0;
  let ungroupedPreviousCostUsd = 0;

  for (const user of users) {
    if ((user.groups ?? []).length > 0) continue;
    ungroupedUsers += 1;
    ungroupedRequests += user.requests;
    ungroupedOutputTokens += user.outputTokens;
    ungroupedTotalTokens += user.totalTokens;
    ungroupedCostUsd += user.costUsd;
    ungroupedPreviousCostUsd += user.costComparison?.previousValue ?? 0;
  }

  if (ungroupedUsers > 0) {
    rows.push({
      groupId: "__no_group__",
      name: "No group",
      roleNames: [],
      memberCount: ungroupedUsers,
      requests: ungroupedRequests,
      outputTokens: ungroupedOutputTokens,
      totalTokens: ungroupedTotalTokens,
      costUsd: ungroupedCostUsd,
      costComparison: buildCostComparison(ungroupedCostUsd, ungroupedPreviousCostUsd),
      selectable: false,
    });
  }

  return rows.sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens || left.name.localeCompare(right.name));
}

export function App() {
  const [period, setPeriod] = useState("180d");
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [group, setGroup] = useState<{ id: string; name: string } | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysis, setAnalysis] = useState<MonthlyCostAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisStreamText, setAnalysisStreamText] = useState("");
  const [analysisPhase, setAnalysisPhase] = useState<"idle" | "started" | "finalizing">("idle");
  const [showLastMonthAnalysis, setShowLastMonthAnalysis] = useState<boolean>(() => localStorage.getItem("dashLastMonthAnalysis") === "on");
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [showCostTypes, setShowCostTypes] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>(() =>
    localStorage.getItem("dashChartType") === "area" ? "area" : "bar",
  );
  const [granularity, setGranularity] = useState<Granularity>(() => {
    const v = localStorage.getItem("dashGranularity");
    return v === "weekly" || v === "monthly" ? v : "daily";
  });
  const [cumulativeChartsEnabled, setCumulativeChartsEnabled] = useState<boolean>(() => localStorage.getItem("dashCumulativeCharts") === "on");
  const [monthForecastEnabled, setMonthForecastEnabled] = useState<boolean>(() => localStorage.getItem("dashMonthForecast") !== "off");
  const [trailing30Data, setTrailing30Data] = useState<DashboardPayload | null>(null);
  const [previousMonthData, setPreviousMonthData] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    localStorage.setItem("dashChartType", chartType);
  }, [chartType]);

  useEffect(() => {
    localStorage.setItem("dashGranularity", granularity);
  }, [granularity]);

  useEffect(() => {
    localStorage.setItem("dashCumulativeCharts", cumulativeChartsEnabled ? "on" : "off");
  }, [cumulativeChartsEnabled]);

  useEffect(() => {
    localStorage.setItem("dashMonthForecast", monthForecastEnabled ? "on" : "off");
  }, [monthForecastEnabled]);

  useEffect(() => {
    localStorage.setItem("dashLastMonthAnalysis", showLastMonthAnalysis ? "on" : "off");
  }, [showLastMonthAnalysis]);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  const load = useCallback((p: string, userId?: string, groupId?: string, force = false) => {
    setLoading(true);
    setError(null);
    setNotification(null);
    setAnalysis(null);
    setAnalysisError(null);
    setAnalysisLoading(false);
    setAnalysisStreamText("");
    setAnalysisPhase("idle");
    fetchDashboard(p, userId, groupId, force)
      .then((payload) => {
        setData(payload);
        setNotification(toNotificationText(payload.warnings));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadHealth = useCallback(() => {
    setHealthLoading(true);
    setHealthError(null);
    fetchHealth()
      .then((payload) => {
        setHealth(payload);
      })
      .catch((e: Error) => setHealthError(e.message))
      .finally(() => setHealthLoading(false));
  }, []);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
    if (!health && !healthLoading && !healthError) loadHealth();
  }, [health, healthError, healthLoading, loadHealth]);

  useEffect(() => {
    load(period, user?.id, group?.id);
  }, [period, user, group, load]);

  useEffect(() => {
    if (!monthForecastEnabled || period !== "this_month") {
      setTrailing30Data(null);
      return;
    }

    let cancelled = false;
    fetchDashboard("30d", user?.id, group?.id)
      .then((payload) => {
        if (cancelled) return;
        setTrailing30Data(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setTrailing30Data(null);
      });

    return () => {
      cancelled = true;
    };
  }, [monthForecastEnabled, period, user, group]);

  useEffect(() => {
    if (!monthForecastEnabled || period !== "this_month") {
      setPreviousMonthData(null);
      return;
    }

    let cancelled = false;
    fetchDashboard("last_month", user?.id, group?.id)
      .then((payload) => {
        if (cancelled) return;
        setPreviousMonthData(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviousMonthData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [monthForecastEnabled, period, user, group]);

  useEffect(() => {
    if (period !== "last_month" || user || group || !data || !showLastMonthAnalysis) {
      setAnalysis(null);
      setAnalysisError(null);
      setAnalysisLoading(false);
      setAnalysisStreamText("");
      setAnalysisPhase("idle");
      return;
    }

    let cancelled = false;
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    setAnalysisStreamText("");
    setAnalysisPhase("started");

    const closeStream = streamDashboardAnalysis(
      period,
      {
        onStatus: (state) => {
          if (cancelled) return;
          if (state === "started" || state === "finalizing") {
            setAnalysisPhase(state);
          }
        },
        onDelta: (delta) => {
          if (cancelled) return;
          setAnalysisStreamText((current) => current + delta);
        },
        onResult: (payload) => {
          if (cancelled) return;
          setAnalysis(payload);
          if (payload?.status === "ready") setAnalysisStreamText("");
          setAnalysisLoading(false);
          setAnalysisPhase("idle");
        },
        onError: () => {
          if (cancelled) return;
          fetchDashboardAnalysis(period)
            .then((payload) => {
              if (cancelled) return;
              setAnalysis(payload);
              setAnalysisPhase("idle");
            })
            .catch((e: Error) => {
              if (cancelled) return;
              setAnalysisError(e.message);
              setAnalysisPhase("idle");
            })
            .finally(() => {
              if (cancelled) return;
              setAnalysisLoading(false);
            });
        },
      },
    );

    return () => {
      cancelled = true;
      closeStream();
    };
  }, [period, user, group, data, showLastMonthAnalysis]);

  const handleSelectUser = useCallback((nextUser: { id: string; name: string } | null) => {
    setUser(nextUser);
    if (nextUser) setGroup(null);
  }, []);

  const handleSelectGroup = useCallback((nextGroup: { id: string; name: string } | null) => {
    setGroup(nextGroup);
    if (nextGroup) setUser(null);
  }, []);

  const rangeSubLabel = RANGES.find((r) => r.period === period)?.subLabel ?? period;
  const dashboardData = data ? filterDashboardByModel(data, selectedModel) : null;
  const trailing30Filtered = trailing30Data ? filterDashboardByModel(trailing30Data, selectedModel) : null;
  const previousMonthFiltered = previousMonthData ? filterDashboardByModel(previousMonthData, selectedModel) : null;
  const totalCostForecast = monthForecastEnabled && period === "this_month"
    ? computeMonthEndCostForecast(dashboardData, trailing30Filtered)
    : null;
  const latestObservedDay = dashboardData?.timeseries[dashboardData.timeseries.length - 1]?.date ?? null;
  const monthExtendedTimeseries = dashboardData && period === "this_month" && granularity === "daily"
    ? extendTimeseriesToMonthEnd(dashboardData.timeseries)
    : dashboardData?.timeseries ?? [];
  const aggregatedTimeseries = dashboardData ? aggregateTimeseries(monthExtendedTimeseries, granularity) : [];
  const cumulativeDisplayedTimeseries = cumulativeTimeseries(aggregatedTimeseries);
  const projectedCumulativeCostTimeseries =
    cumulativeChartsEnabled && period === "this_month" && granularity === "daily"
      ? buildProjectedCumulativeCostSeries(cumulativeDisplayedTimeseries, latestObservedDay, totalCostForecast)
      : cumulativeDisplayedTimeseries.map((point) => ({
          ...point,
          displayCostUsd: point.costUsd,
          projectedBarCostUsd: null,
          projectedCostUsd: null,
        }));
  const displayedTimeseries = cumulativeChartsEnabled ? projectedCumulativeCostTimeseries : aggregatedTimeseries;
  const monthExtendedModelTimeseries = dashboardData && period === "this_month" && granularity === "daily"
    ? extendModelTimeseriesToMonthEnd(dashboardData.modelTimeseries)
    : dashboardData?.modelTimeseries ?? [];
  const aggregatedModelTimeseries = dashboardData
    ? aggregateModelTimeseries(
        monthExtendedModelTimeseries,
        granularity,
        monthExtendedTimeseries.map((point) => point.date),
      )
    : [];
  const displayedModelTimeseries = cumulativeChartsEnabled
    ? cumulativeModelTimeseries(aggregatedModelTimeseries)
    : aggregatedModelTimeseries;
  const totalCostForecastComparison =
    totalCostForecast != null && previousMonthFiltered
      ? { ...buildCostComparison(totalCostForecast, previousMonthFiltered.summary.totalCostUsd), label: "last month" as const }
      : undefined;
  const roleBreakdown = buildRoleBreakdown(data?.byUser);
  const groupBreakdown = buildGroupBreakdown(data?.byGroup, data?.byUser);
  const pluginRows = (data?.pluginUsage ?? []).map((plugin) => ({
    key: plugin.pluginId ?? plugin.pluginName,
    cells: [
      <div key="plugin" className="table-entity-cell">
        <span className="user-name">{plugin.pluginName}</span>
        <span className="table-subtext">
          Claude Code {fullNumber(plugin.claudeCodeSessionCount ?? 0)} · Cowork {fullNumber(plugin.coworkSessionCount ?? 0)}
        </span>
      </div>,
      fullNumber(plugin.distinctUserCount),
      fullNumber(plugin.invocationCount),
      plugin.installCount != null ? fullNumber(plugin.installCount) : "—",
    ],
  }));
  const skillRows = (data?.skillUsage ?? []).map((skill) => ({
    key: skill.skillName,
    cells: [
      <div key="skill" className="table-entity-cell">
        <span className="user-name">{skill.displayName ?? skill.skillName}</span>
        <span className="table-subtext">
          Chat {fullNumber(skill.chatConversationCount ?? 0)} · Claude Code {fullNumber(skill.claudeCodeSessionCount ?? 0)} · Cowork {fullNumber(skill.coworkSessionCount ?? 0)}
        </span>
      </div>,
      fullNumber(skill.distinctUserCount),
      skill.invocationCount != null ? fullNumber(skill.invocationCount) : "—",
      skill.attributedListPriceUsd != null ? usd(skill.attributedListPriceUsd) : "—",
      skill.estimatedOverageSpendUsd != null ? usd(skill.estimatedOverageSpendUsd) : "—",
    ],
  }));
  const connectorRows = (data?.connectorUsage ?? []).map((connector) => ({
    key: connector.connectorName,
    cells: [
      <div key="connector" className="table-entity-cell">
        <span className="user-name">{connector.displayName ?? connector.connectorName}</span>
        <span className="table-subtext">
          Managed auth {fullNumber(connector.managedAuthDistinctUserCount ?? 0)} · Individual auth {fullNumber(connector.individualAuthDistinctUserCount ?? 0)}
        </span>
      </div>,
      fullNumber(connector.distinctUserCount),
      connector.readCallCount != null ? fullNumber(connector.readCallCount) : "—",
      connector.writeCallCount != null ? fullNumber(connector.writeCallCount) : "—",
      connector.unclassifiedCallCount != null ? fullNumber(connector.unclassifiedCallCount) : "—",
    ],
  }));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="https://nikiforovall.blog/claude-code-rules/img/cc.png" alt="Claude Code logo" />
          <div>
            <h1>Claude Usage Dashboard</h1>
            <p className="subtitle">Usage, cost &amp; adoption across your organization</p>
          </div>
        </div>
        <div className="controls">
          {data && (
            <span className={`source-badge ${data.source === "mock" ? "mock" : "live"}`}>
              {SOURCE_BADGE[data.source]}
            </span>
          )}
          <div className="range-toggle">
            {RANGES.map((r) => (
              <button
                key={r.period}
                className={period === r.period ? "active" : ""}
                onClick={() => setPeriod(r.period)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className={loading ? "refresh refresh-loading" : "refresh"} onClick={() => load(period, user?.id, group?.id, true)} disabled={loading}>
            {loading ? (
              <>
                <span className="refresh-spinner" aria-hidden="true" />
                Loading…
              </>
            ) : (
              "↻ Refresh"
            )}
          </button>
          <button className="icon-btn" onClick={handleOpenSettings} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsModal
          chartType={chartType}
          onChartType={setChartType}
          granularity={granularity}
          onGranularity={setGranularity}
          cumulativeChartsEnabled={cumulativeChartsEnabled}
          onCumulativeChartsEnabled={setCumulativeChartsEnabled}
          monthForecastEnabled={monthForecastEnabled}
          onMonthForecastEnabled={setMonthForecastEnabled}
          showLastMonthAnalysis={showLastMonthAnalysis}
          onShowLastMonthAnalysis={setShowLastMonthAnalysis}
          health={health}
          healthLoading={healthLoading}
          healthError={healthError}
          onRefreshHealth={loadHealth}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showCostTypes && data && (
        <Modal onClose={() => setShowCostTypes(false)} maxWidth={620}>
          <CostTypePie data={data.costByType} />
        </Modal>
      )}

      {(user || group || selectedModel) && (
        <div className="filter-bar">
          <span className="filter-label">Filtered to</span>
          {user && (
            <span className="filter-chip">
              {user.name}
              <button className="filter-clear" onClick={() => setUser(null)} aria-label="Clear user filter">
                ✕
              </button>
            </span>
          )}
          {group && (
            <span className="filter-chip">
              {group.name}
              <button className="filter-clear" onClick={() => setGroup(null)} aria-label="Clear group filter">
                ✕
              </button>
            </span>
          )}
          {selectedModel && (
            <span className="filter-chip">
              {modelLabel(selectedModel)}
              <button className="filter-clear" onClick={() => setSelectedModel(null)} aria-label="Clear model filter">
                ✕
              </button>
            </span>
          )}
          {!user && selectedModel && <span className="filter-note">Showing only this model across charts and summary cards.</span>}
          {user && <span className="filter-note">Organization activity is hidden while filtering to a single user.</span>}
          {group && <span className="filter-note">Organization activity analysis is hidden while filtering to a single group.</span>}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <strong>Couldn't load data.</strong> {error}
        </div>
      )}

      {notification && (
        <div className="toast-banner" role="status" aria-live="polite">
          {notification}
        </div>
      )}

      {dashboardData && (
        <main>
          {period === "last_month" && !user && !group && showLastMonthAnalysis && (
            <div className="grid-1">
              <MonthlyCostAnalysisPanel
                analysis={analysis}
                loading={analysisLoading}
                error={analysisError}
                streamingText={analysisStreamText}
                phase={analysisPhase}
              />
            </div>
          )}

          <SummaryCards
            summary={dashboardData.summary}
            rangeSubLabel={rangeSubLabel}
            totalCostForecast={
              totalCostForecast != null
                ? {
                    value: totalCostForecast,
                    label: "Predicted Cost",
                    sub: "Trailing 30-day forecast",
                    comparison: formatComparisonText(totalCostForecastComparison, "currency"),
                    comparisonTone:
                      totalCostForecastComparison?.direction === "up"
                        ? "positive"
                        : totalCostForecastComparison?.direction === "down"
                          ? "negative"
                          : "neutral",
                  }
                : null
            }
          />

          {dashboardData.activity && <ActivityCards activity={dashboardData.activity} rangeSubLabel={rangeSubLabel} />}

          <div className="grid-2">
            <CostChart data={displayedTimeseries} chartType={chartType} granularity={granularity} cumulative={cumulativeChartsEnabled} />
            {!selectedModel ? (
              <CacheHitRateChart
                data={aggregatedTimeseries}
                granularity={granularity}
              />
            ) : (
              <UsageChart data={displayedTimeseries} chartType={chartType} cumulative={cumulativeChartsEnabled} />
            )}
          </div>

          <div className="grid-2">
            {!selectedModel && (
              <UsageChart data={displayedTimeseries} chartType={chartType} cumulative={cumulativeChartsEnabled} />
            )}
            <ModelUsageChart
              data={displayedModelTimeseries}
              models={dashboardData.modelKeys}
              chartType={chartType}
              cumulative={cumulativeChartsEnabled}
            />
          </div>

          <div className="grid-2-uneven">
            <ModelTable
              data={dashboardData.byModel}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
            />
            {data?.byProduct && (
              <ProductBreakdownPanel
                data={data.byProduct}
                onShowCostTypes={data.costByType.length > 0 ? () => setShowCostTypes(true) : undefined}
              />
            )}
          </div>

          {!user && !group && data?.userStats && <UserStatsPanel stats={data.userStats} />}

          {data?.byUser && (
            <div className="grid-1">
              <UserTable data={data.byUser} selectedUserId={user?.id ?? null} onSelectUser={handleSelectUser} />
            </div>
          )}

          {!user && groupBreakdown.length > 0 && (
            <div className="grid-1">
              <GroupBreakdownTable data={groupBreakdown} selectedGroupId={group?.id ?? null} onSelectGroup={handleSelectGroup} />
            </div>
          )}

          {!user && roleBreakdown.length > 0 && (
            <div className="grid-1">
              <RoleBreakdownTable data={roleBreakdown} />
            </div>
          )}

          {Boolean(data?.pluginUsage?.length || data?.skillUsage?.length || data?.connectorUsage?.length) && (
            <div className="grid-1">
              <FeatureUsageSankey
                pluginUsage={data?.pluginUsage ?? []}
                skillUsage={data?.skillUsage ?? []}
                connectorUsage={data?.connectorUsage ?? []}
              />
            </div>
          )}

          {(pluginRows.length > 0 || skillRows.length > 0) && (
            <div className="grid-2">
              {pluginRows.length > 0 && (
                <UsageInsightsTable
                  title="Plugin Usage"
                  panelNote={`${pluginRows.length} plugins`}
                  infoText="Plugin install and invocation activity across Claude Code and Cowork over the selected range. Enterprise Analytics source only."
                  emptyText="No plugin activity in this window."
                  columns={[
                    { label: "Plugin" },
                    { label: "Users", align: "right" },
                    { label: "Invocations", align: "right" },
                    { label: "Installs", align: "right" },
                  ]}
                  rows={pluginRows}
                />
              )}
              {skillRows.length > 0 && (
                <UsageInsightsTable
                  title="Skill Usage"
                  panelNote={`${skillRows.length} skills`}
                  infoText="Skill activation and attributed usage value across Claude surfaces over the selected range. Cost fields are only available for skills in the current Enterprise Analytics payload."
                  emptyText="No skill activity in this window."
                  columns={[
                    { label: "Skill" },
                    { label: "Users", align: "right" },
                    { label: "Invocations", align: "right" },
                    { label: "List Price", align: "right" },
                    { label: "Est. Overage", align: "right" },
                  ]}
                  rows={skillRows}
                />
              )}
            </div>
          )}

          {connectorRows.length > 0 && (
            <div className="grid-1">
              <UsageInsightsTable
                title="Connector Usage"
                panelNote={`${connectorRows.length} connectors`}
                infoText="Connector usage across Claude surfaces, including read/write call classification and managed-auth adoption where available. Enterprise Analytics source only."
                emptyText="No connector activity in this window."
                columns={[
                  { label: "Connector" },
                  { label: "Users", align: "right" },
                  { label: "Read", align: "right" },
                  { label: "Write", align: "right" },
                  { label: "Other", align: "right" },
                ]}
                rows={connectorRows}
              />
            </div>
          )}

          {period === "this_month" && monthForecastEnabled && dashboardData && (
            <div className="grid-1">
              <ForecastSignalsPanel
                current={dashboardData}
                previousMonth={previousMonthFiltered}
                selectedModel={selectedModel}
              />
            </div>
          )}

          <footer className="foot">
            {data?.source === "mock" && (
              <span>
                Showing realistic mock data. Add an Analytics key (Enterprise) or Admin key (Platform) to{" "}
                <code>server/.env</code> to see your organization's real usage.{" "}
              </span>
            )}
            <span>
              Range {formatRangeLabel(data?.range)} · generated {new Date(data?.generatedAt ?? Date.now()).toLocaleString()}
              {data?.dataRefreshedAt && ` · data refreshed ${new Date(data.dataRefreshedAt).toLocaleString()}`}
            </span>
          </footer>
        </main>
      )}

      {!data && loading && <div className="loading">Loading dashboard…</div>}
    </div>
  );
}
