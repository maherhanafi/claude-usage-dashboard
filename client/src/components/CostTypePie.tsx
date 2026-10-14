import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CostTypeBreakdown } from "../types";
import { getCostTypeColor } from "../chartColors";
import { usd } from "../format";
import { InfoTip } from "./InfoTip";

const LABELS: Record<string, string> = {
  tokens: "Tokens",
  web_search: "Web search",
  code_execution: "Code execution",
  session_usage: "Session usage",
  other: "Other",
};

export function CostTypePie({ data }: { data: CostTypeBreakdown[] }) {
  const rows = data.filter((d) => d.costUsd > 0);
  return (
    <div className="panel">
      <h2>
        Cost By Type
        <InfoTip text="How spend splits across cost types — model tokens vs. server tools like web search and code execution." />
      </h2>
      {rows.length === 0 ? (
        <p className="empty">No cost recorded in this window.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={rows}
              dataKey="costUsd"
              nameKey="costType"
              cx="50%"
              cy="50%"
              outerRadius={90}
              innerRadius={50}
              paddingAngle={2}
            >
              {rows.map((row) => (
                <Cell key={row.costType} fill={getCostTypeColor(row.costType)} />
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
              formatter={(value: number, name: string) => [usd(value), LABELS[name] ?? name]}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      <ul className="legend-list">
        {rows.map((d) => (
          <li key={d.costType}>
            <span className="swatch" style={{ background: getCostTypeColor(d.costType) }} />
            {LABELS[d.costType] ?? d.costType}
            <span className="legend-value">{usd(d.costUsd)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
