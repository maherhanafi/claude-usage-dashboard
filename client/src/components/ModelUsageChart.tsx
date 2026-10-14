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
import type { ChartType, ModelTimePoint } from "../types";
import { compactNumber, fullNumber, modelLabel, shortDate } from "../format";
import { getModelColor, gradientId } from "../chartColors";
import { ExpandableChartPanel } from "./ExpandableChartPanel";
import { ModelFamilyIcon } from "./ModelFamilyIcon";
import { useLegendToggle } from "./useLegendToggle";

interface Props {
  data: ModelTimePoint[];
  models: string[];
  chartType?: ChartType;
}

const INFO_TEXT = "Total tokens per day, stacked by Claude model. The height of each band shows how much of that day's usage ran on each model. Click a legend item to show/hide that model. Reflects the current range and any user filter.";
const CUMULATIVE_INFO_TEXT = "Running total of tokens across the visible range, stacked by Claude model. Each band shows cumulative usage attributed to that model. Click a legend item to show/hide that model. Reflects the current range and any user filter.";

export function ModelUsageChart({ data, models, chartType = "area", cumulative = false }: Props & { cumulative?: boolean }) {
  const { hidden, toggle } = useLegendToggle();
  const orderedModels = [...models].sort((left, right) => modelLabel(left).localeCompare(modelLabel(right), undefined, { sensitivity: "base" }));
  // Flatten { date, values: {model: n} } → { date, [model]: n }, filling gaps with 0.
  const rows = data.map((p) => {
    const row: Record<string, number | string | null> = { date: p.date };
    for (const m of orderedModels) row[m] = p.isFuture ? null : (p.values[m] ?? 0);
    return row;
  });
  const visiblePointCount = rows.filter((row) => orderedModels.some((model) => row[model] != null)).length;

  return (
    <ExpandableChartPanel title={cumulative ? "Cumulative Token Usage By Model Over Time" : "Token Usage By Model Over Time"} infoText={cumulative ? CUMULATIVE_INFO_TEXT : INFO_TEXT}>
      {(expanded) =>
        models.length === 0 ? (
          <p className="empty">No usage in this window.</p>
        ) : (
          <div className="chart-with-legend">
            <div className={`chart-frame${expanded ? " chart-frame-expanded" : ""}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <defs>
              {orderedModels.map((m) => {
                const color = getModelColor(m);
                return (
                <linearGradient id={gradientId("grad-model", m)} key={m} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.7} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
                );
              })}
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
            {orderedModels.map((m) => {
              const color = getModelColor(m);
              return chartType === "bar" ? (
                <Bar
                  key={m}
                  dataKey={m}
                  name={modelLabel(m)}
                  stackId="models"
                  fill={color}
                  maxBarSize={48}
                  hide={hidden.has(m)}
                />
              ) : (
                <Area
                  key={m}
                  type="monotone"
                  dataKey={m}
                  name={modelLabel(m)}
                  stackId="models"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#${gradientId("grad-model", m)})`}
                  dot={visiblePointCount === 1 ? { r: 3.5, fill: color, stroke: "#ffffff", strokeWidth: 1.25 } : false}
                  hide={hidden.has(m)}
                />
              );
            })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend-scroll" role="group" aria-label="Token usage by model legend">
              {orderedModels.map((model) => {
                const off = hidden.has(model);
                return (
                  <button
                    key={model}
                    type="button"
                    className={`chart-legend-chip${off ? " off" : ""}`}
                    onClick={() => toggle(model)}
                  >
                    <span className="model-legend-item">
                      <ModelFamilyIcon model={model} />
                      <span>{modelLabel(model)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )
      }
    </ExpandableChartPanel>
  );
}
