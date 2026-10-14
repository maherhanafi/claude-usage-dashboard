import type { UserStats } from "../types";
import { compactNumber, fullNumber, usd } from "../format";
import { InfoTip } from "./InfoTip";

interface Tile {
  label: string;
  value: string;
  sub: string;
  info: string;
}

export function UserStatsPanel({ stats }: { stats: UserStats }) {
  const tiles: Tile[] = [
    {
      label: "Avg cost / user",
      value: usd(stats.avgCostUsd),
      sub: `across ${stats.userCount} active`,
      info: "Total cost in this range ÷ number of active users.",
    },
    {
      label: "Median cost / user",
      value: stats.medianCostUsd != null ? usd(stats.medianCostUsd) : "—",
      sub: `${stats.userCount} active users`,
      info: "Middle per-user cost in this range after sorting users by spend. Less sensitive to outliers than the average.",
    },
    {
      label: "Top cost / user",
      value: usd(stats.maxCostUsd),
      sub: stats.topCostUser ?? "—",
      info: "Highest single-user spend in this range.",
    },
    {
      label: "Avg tokens / user",
      value: compactNumber(stats.avgTokens),
      sub: fullNumber(stats.avgTokens),
      info: "Total tokens in this range ÷ number of active users.",
    },
  ];

  return (
    <div className="panel">
      <h2>
        Per-User Usage <span className="panel-note">{stats.userCount} active</span>
        <InfoTip text="Average and maximum usage per active user (seat) over the selected range. Enterprise Analytics source only." />
      </h2>
      <div className="cards cards-inset">
        {tiles.map((t) => (
          <div className="card" key={t.label}>
            <div className="card-label">
              {t.label}
              <InfoTip text={t.info} />
            </div>
            <div className="card-value">{t.value}</div>
            <div className="card-sub">{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
