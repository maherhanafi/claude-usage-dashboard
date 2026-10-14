import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Granularity, TimePoint } from "../types";
import { gradientId, getTokenSeriesColor } from "../chartColors";
import { shortDate } from "../format";
import { ExpandableChartPanel } from "./ExpandableChartPanel";

const CACHE_HIT_TITLES: Record<Granularity, string> = {
  daily: "Daily Cache Hit Rate",
  weekly: "Weekly Cache Hit Rate",
  monthly: "Monthly Cache Hit Rate",
};

const INFO_TEXT = "Share of input served from cache over time: cache reads ÷ (cache reads + uncached input). Higher values mean more prompt-cache reuse. Hidden when filtering to a single model because the current dataset does not attribute cache reads by model.";

function buildCacheHitRate(uncachedInputTokens: number | null | undefined, cacheReadTokens: number | null | undefined): number | null {
  if (uncachedInputTokens == null || cacheReadTokens == null) return null;
  const denominator = uncachedInputTokens + cacheReadTokens;
  return denominator > 0 ? (cacheReadTokens / denominator) * 100 : null;
}

export function CacheHitRateChart({
  data,
  granularity = "daily",
}: {
  data: TimePoint[];
  granularity?: Granularity;
}) {
  const color = getTokenSeriesColor("cacheReadTokens");
  const chartData = data.map((point) => ({
    date: point.date,
    cacheHitRate: buildCacheHitRate(point.uncachedInputTokens, point.cacheReadTokens),
  }));
  const visiblePointCount = chartData.filter((point) => point.cacheHitRate != null).length;

  return (
    <ExpandableChartPanel title={CACHE_HIT_TITLES[granularity]} infoText={INFO_TEXT}>
      {(expanded) => (
        <div className={`chart-frame${expanded ? " chart-frame-expanded" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={gradientId("grad", "cache-hit-rate")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.7} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#e9e6de" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} stroke="#dcd8cf" tickLine={false} fontSize={12} />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value: number) => `${value.toFixed(0)}%`}
            stroke="#dcd8cf"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={48}
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
            formatter={(value) => {
              const numericValue = typeof value === "number" ? value : Number(value);
              return [Number.isFinite(numericValue) ? `${numericValue.toFixed(1)}%` : "—", "Cache hit rate"];
            }}
            cursor={{ fill: "rgba(138, 164, 148, 0.12)" }}
          />
          <Area
            type="monotone"
            dataKey="cacheHitRate"
            name="Cache hit rate"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId("grad", "cache-hit-rate")})`}
            dot={visiblePointCount === 1 ? { r: 3.5, fill: color, stroke: "#ffffff", strokeWidth: 1.25 } : false}
            connectNulls={false}
          />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ExpandableChartPanel>
  );
}