import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartType, Granularity, TimePoint } from "../types";
import { shortDate, usd } from "../format";
import { getCostChartColor, gradientId } from "../chartColors";
import { ExpandableChartPanel } from "./ExpandableChartPanel";

const COST_TITLES: Record<Granularity, string> = {
  daily: "Daily cost (USD)",
  weekly: "Weekly cost (USD)",
  monthly: "Monthly cost (USD)",
};
const CUMULATIVE_COST_TITLES: Record<Granularity, string> = {
  daily: "Cumulative Cost (USD)",
  weekly: "Cumulative Cost (USD)",
  monthly: "Cumulative Cost (USD)",
};

const INFO_TEXT = "Estimated USD spend per day across all models and products, after any plan discounts. Converted from the API's fractional-cent amounts.";
const CUMULATIVE_INFO_TEXT = "Running total of estimated USD spend across the visible range, after any plan discounts. Converted from the API's fractional-cent amounts.";
const ACTUAL_SERIES_ANIMATION_MS = 900;
const PROJECTED_SERIES_ANIMATION_MS = 450;

export function CostChart({
  data,
  chartType = "bar",
  granularity = "daily",
  cumulative = false,
}: {
  data: TimePoint[];
  chartType?: ChartType;
  granularity?: Granularity;
  cumulative?: boolean;
}) {
  const color = getCostChartColor();
  const hasProjection = cumulative && data.some((point) => point.projectedCostUsd != null);
  const hasProjectedBars = cumulative && chartType === "bar" && data.some((point) => point.projectedBarCostUsd != null);
  const chartData = useMemo(
    () =>
      data.map((point) =>
        cumulative && !hasProjection && point.isFuture
          ? { ...point, displayCostUsd: null }
          : point,
      ),
    [cumulative, data, hasProjection],
  );
  const visiblePointCount = useMemo(
    () => chartData.filter((point) => ((cumulative ? point.displayCostUsd : point.costUsd) ?? null) != null).length,
    [chartData, cumulative],
  );
  const singlePointDot = visiblePointCount === 1 ? { r: 4, fill: color, stroke: "#ffffff", strokeWidth: 1.5 } : false;
  const shouldStageProjectedArea = hasProjection && chartType !== "bar";
  const lastPoint = chartData.length > 0 ? chartData[chartData.length - 1] : undefined;
  const projectionResetKey = useMemo(
    () => `${chartType}:${granularity}:${cumulative}:${chartData.length}:${lastPoint?.date ?? ""}:${lastPoint?.projectedCostUsd ?? ""}`,
    [chartType, cumulative, chartData.length, granularity, lastPoint?.date, lastPoint?.projectedCostUsd],
  );
  const [showProjectedArea, setShowProjectedArea] = useState(!shouldStageProjectedArea);

  useEffect(() => {
    setShowProjectedArea(!shouldStageProjectedArea);
  }, [projectionResetKey, shouldStageProjectedArea]);

  return (
    <ExpandableChartPanel title={(cumulative ? CUMULATIVE_COST_TITLES : COST_TITLES)[granularity]} infoText={cumulative ? CUMULATIVE_INFO_TEXT : INFO_TEXT}>
      {(expanded) => (
        <div className={`chart-frame${expanded ? " chart-frame-expanded" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          {(chartType === "area" || hasProjection) && (
            <defs>
              <linearGradient id={gradientId("grad", "cost")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.7} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id={gradientId("grad", "cost-forecast")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.24} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
          )}
          <CartesianGrid strokeDasharray="4 4" stroke="#e9e6de" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} stroke="#dcd8cf" tickLine={false} fontSize={12} />
          <YAxis
            tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
            stroke="#dcd8cf"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={52}
          />
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(20,19,15,0.12)",
              color: "var(--text)",
            }}
            labelStyle={{ color: "var(--text-dim)" }}
            labelFormatter={shortDate}
            formatter={(value: number, name: string) => [usd(value), name === "Projected cost" ? "Projected cost" : "Cost"]}
            cursor={{ fill: "rgba(66,141,188,0.12)" }}
          />
          {showProjectedArea && shouldStageProjectedArea && (
            <Area
              type="linear"
              dataKey="projectedCostUsd"
              name="Projected cost"
              stroke="none"
              fill={`url(#${gradientId("grad", "cost-forecast")})`}
              connectNulls
              animationDuration={PROJECTED_SERIES_ANIMATION_MS}
              animationEasing="ease-out"
            />
          )}
          {showProjectedArea && shouldStageProjectedArea && (
            <Line
              type="linear"
              dataKey="projectedCostUsd"
              name="Projected cost"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="6 6"
              dot={false}
              connectNulls
              animationDuration={PROJECTED_SERIES_ANIMATION_MS}
              animationEasing="ease-out"
            />
          )}
          {chartType === "bar" ? (
            <>
              <Bar
                dataKey={cumulative ? "displayCostUsd" : "costUsd"}
                name="Cost"
                fill={color}
                maxBarSize={48}
                stackId={cumulative ? "cumulative-cost" : undefined}
                animationDuration={ACTUAL_SERIES_ANIMATION_MS}
                animationEasing="ease-out"
              />
              {hasProjectedBars && (
                <Bar
                  dataKey="projectedBarCostUsd"
                  name="Projected cost"
                  fill={color}
                  fillOpacity={0.28}
                  maxBarSize={48}
                  stackId="cumulative-cost"
                  animationBegin={ACTUAL_SERIES_ANIMATION_MS}
                  animationDuration={PROJECTED_SERIES_ANIMATION_MS}
                  animationEasing="ease-out"
                />
              )}
            </>
          ) : (
            <Area
              type="monotone"
              dataKey={cumulative ? "displayCostUsd" : "costUsd"}
              name="Cost"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId("grad", "cost")})`}
              dot={singlePointDot}
              animationDuration={ACTUAL_SERIES_ANIMATION_MS}
              animationEasing="ease-out"
              onAnimationEnd={shouldStageProjectedArea ? () => setShowProjectedArea(true) : undefined}
            />
          )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ExpandableChartPanel>
  );
}
