import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { getBreakdownPaletteColor } from "../chartColors";
import { compactNumber, fullNumber, usd } from "../format";
import { Modal } from "./Modal";
import { InfoTip } from "./InfoTip";

type BreakdownMetric = "requests" | "outputTokens" | "totalTokens" | "costUsd" | "costPerUser";

interface BreakdownRow {
  key: string;
  label: string;
  requests: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  userCount?: number;
}

const METRICS: Array<{ key: BreakdownMetric; label: string }> = [
  { key: "requests", label: "Requests" },
  { key: "outputTokens", label: "Output" },
  { key: "totalTokens", label: "Tokens" },
  { key: "costUsd", label: "Cost" },
  { key: "costPerUser", label: "Cost / User" },
];

function toTitleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function formatMetricValue(metric: BreakdownMetric, value: number): string {
  if (metric === "costUsd" || metric === "costPerUser") return usd(value);
  if (metric === "requests") return fullNumber(value);
  return compactNumber(value);
}

export function BreakdownPieModal({
  title,
  infoText,
  rows,
  onClose,
}: {
  title: string;
  infoText: string;
  rows: BreakdownRow[];
  onClose: () => void;
}) {
  const [metric, setMetric] = useState<BreakdownMetric>("costUsd");
  const normalizedTitle = toTitleCase(title);

  const chartRows = rows
    .map((row) => ({
      ...row,
      value:
        metric === "costPerUser"
          ? row.userCount && row.userCount > 0
            ? row.costUsd / row.userCount
            : 0
          : row[metric],
    }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);

  const total = chartRows.reduce((sum, row) => sum + row.value, 0);

  return (
    <Modal onClose={onClose} maxWidth={920}>
      <div className="panel panel-expanded">
        <div className="panel-head">
          <h2>
            {normalizedTitle}
            <InfoTip text={infoText} />
          </h2>
        </div>

        <div className="breakdown-tabs" role="tablist" aria-label={`${normalizedTitle} Metric`}>
          {METRICS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={metric === item.key ? "active" : ""}
              onClick={() => setMetric(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {chartRows.length === 0 ? (
          <p className="empty">No values available for this breakdown.</p>
        ) : (
          <div className="breakdown-pie-layout">
            <div className="breakdown-pie-chart">
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie
                    data={chartRows}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={122}
                    innerRadius={62}
                    paddingAngle={2}
                  >
                    {chartRows.map((row, index) => (
                      <Cell key={row.key} fill={getBreakdownPaletteColor(index)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#ffffff",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      boxShadow: "0 8px 24px rgba(20,19,15,0.12)",
                      color: "var(--text)",
                    }}
                    formatter={(value: number, name: string) => [formatMetricValue(metric, value), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="breakdown-pie-side">
              <div className="breakdown-pie-summary">
                <div className="breakdown-pie-summary-label">Breakdown by {METRICS.find((item) => item.key === metric)?.label}</div>
                <div className="breakdown-pie-summary-value">{formatMetricValue(metric, total)}</div>
              </div>

              <ul className="legend-list breakdown-legend-list">
                {chartRows.map((row) => (
                  <li key={row.key}>
                    <span className="swatch" style={{ background: getBreakdownPaletteColor(chartRows.findIndex((entry) => entry.key === row.key)) }} />
                    <span className="breakdown-legend-label">{row.label}</span>
                    <span className="legend-value">
                      {formatMetricValue(metric, row.value)}
                      {total > 0 ? ` · ${((row.value / total) * 100).toFixed(1)}%` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}