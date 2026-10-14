import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartType, TimePoint } from "../types";
import { getTokenSeriesColor, gradientId } from "../chartColors";
import { compactNumber, fullNumber, shortDate } from "../format";
import { ExpandableChartPanel } from "./ExpandableChartPanel";
import { useLegendToggle } from "./useLegendToggle";

const SERIES = [
  { key: "uncachedInputTokens", name: "Uncached input", color: getTokenSeriesColor("uncachedInputTokens") },
  { key: "cacheReadTokens", name: "Cache read", color: getTokenSeriesColor("cacheReadTokens") },
  { key: "cacheCreationTokens", name: "Cache creation", color: getTokenSeriesColor("cacheCreationTokens") },
  { key: "outputTokens", name: "Output", color: getTokenSeriesColor("outputTokens") },
] as const;

const INFO_TEXT = "Total tokens processed per day, stacked by type: uncached input, cache reads, cache creation, and output. Click a legend item to show/hide that series.";
const CUMULATIVE_INFO_TEXT = "Running total of tokens processed across the visible range, stacked by type: uncached input, cache reads, cache creation, and output. Click a legend item to show/hide that series.";

export function UsageChart({ data, chartType = "area", cumulative = false }: { data: TimePoint[]; chartType?: ChartType; cumulative?: boolean }) {
  const { hidden, toggle } = useLegendToggle();
  const chartData = data.map((point) => ({
    ...point,
    uncachedInputTokens: point.isFuture ? null : point.uncachedInputTokens,
    cacheReadTokens: point.isFuture ? null : point.cacheReadTokens,
    cacheCreationTokens: point.isFuture ? null : point.cacheCreationTokens,
    outputTokens: point.isFuture ? null : point.outputTokens,
  }));
  const visiblePointCount = chartData.filter((point) => point.uncachedInputTokens != null).length;
  const totals = data.reduce<Record<(typeof SERIES)[number]["key"], number>>(
    (acc, point) => {
      for (const series of SERIES) acc[series.key] += point[series.key] ?? 0;
      return acc;
    },
    {
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    },
  );
  const orderedSeries = [...SERIES].sort((left, right) => {
    const totalDelta = totals[right.key] - totals[left.key];
    if (totalDelta !== 0) return totalDelta;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  return (
    <ExpandableChartPanel title={cumulative ? "Cumulative Token Usage Over Time" : "Token Usage Over Time"} infoText={cumulative ? CUMULATIVE_INFO_TEXT : INFO_TEXT}>
      {(expanded) => (
        <div className="chart-with-legend">
          <div className={`chart-frame${expanded ? " chart-frame-expanded" : ""}`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <defs>
            {orderedSeries.map((s) => (
              <linearGradient id={gradientId("grad", s.key)} key={s.key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.7} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#e9e6de" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} stroke="#dcd8cf" tickLine={false} fontSize={12} />
          <YAxis tickFormatter={compactNumber} stroke="#dcd8cf" tickLine={false} axisLine={false} fontSize={12} width={48} />
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
            formatter={(value: number, name: string) => [fullNumber(value), name]}
          />
          {orderedSeries.map((s) =>
            chartType === "bar" ? (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="tokens"
                fill={s.color}
                maxBarSize={48}
                hide={hidden.has(s.key)}
              />
            ) : (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stackId="tokens"
                stroke={s.color}
                strokeWidth={2}
                fill={`url(#${gradientId("grad", s.key)})`}
                dot={visiblePointCount === 1 ? { r: 3.5, fill: s.color, stroke: "#ffffff", strokeWidth: 1.25 } : false}
                hide={hidden.has(s.key)}
              />
            ),
          )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend-scroll" role="group" aria-label="Token usage legend">
            {orderedSeries.map((series) => {
              const off = hidden.has(series.key);
              return (
                <button
                  key={series.key}
                  type="button"
                  className={`chart-legend-chip${off ? " off" : ""}`}
                  onClick={() => toggle(series.key)}
                >
                  <span className="swatch" style={{ background: series.color }} />
                  <span>{series.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </ExpandableChartPanel>
  );
}
