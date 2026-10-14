import type { ActivitySnapshot } from "../types";
import { formatComparisonText, fullNumber } from "../format";
import { InfoTip } from "./InfoTip";

interface Card {
  label: string;
  value: string;
  sub?: string;
  comparison?: string;
  comparisonTone?: "positive" | "negative" | "neutral";
  accent: string;
  info: string;
}

export function ActivityCards({ activity, rangeSubLabel }: { activity: ActivitySnapshot; rangeSubLabel: string }) {
  const cards: Card[] = [
    {
      label: "Assigned Seats",
      value: fullNumber(activity.assignedSeats),
      sub: `${activity.pendingInvites} pending invite${activity.pendingInvites === 1 ? "" : "s"}`,
      comparison: formatComparisonText(activity.comparisons?.assignedSeats, "number", rangeSubLabel),
      comparisonTone:
        activity.comparisons?.assignedSeats?.direction === "up"
          ? "positive"
          : activity.comparisons?.assignedSeats?.direction === "down"
            ? "negative"
            : "neutral",
      accent: "var(--accent-1)",
      info: "Seats currently assigned to members, plus invitations not yet accepted.",
    },
    {
      label: "Daily Active",
      value: fullNumber(activity.dailyActiveUsers),
      sub: `${activity.dailyAdoptionRate.toFixed(1)}% adoption`,
      comparison: formatComparisonText(activity.comparisons?.dailyActiveUsers, "number", rangeSubLabel),
      comparisonTone:
        activity.comparisons?.dailyActiveUsers?.direction === "up"
          ? "positive"
          : activity.comparisons?.dailyActiveUsers?.direction === "down"
            ? "negative"
            : "neutral",
      accent: "var(--accent-2)",
      info: "Users with activity on the most recent finalized day. Adoption = daily active ÷ assigned seats.",
    },
    {
      label: "Weekly Active",
      value: fullNumber(activity.weeklyActiveUsers),
      sub: `${activity.weeklyAdoptionRate.toFixed(1)}% adoption`,
      comparison: formatComparisonText(activity.comparisons?.weeklyActiveUsers, "number", rangeSubLabel),
      comparisonTone:
        activity.comparisons?.weeklyActiveUsers?.direction === "up"
          ? "positive"
          : activity.comparisons?.weeklyActiveUsers?.direction === "down"
            ? "negative"
            : "neutral",
      accent: "var(--accent-3)",
      info: "Distinct users active in the trailing 7-day window. Adoption = weekly active ÷ assigned seats.",
    },
    {
      label: "Monthly Active",
      value: fullNumber(activity.monthlyActiveUsers),
      sub: `${activity.monthlyAdoptionRate.toFixed(1)}% adoption`,
      comparison: formatComparisonText(activity.comparisons?.monthlyActiveUsers, "number", rangeSubLabel),
      comparisonTone:
        activity.comparisons?.monthlyActiveUsers?.direction === "up"
          ? "positive"
          : activity.comparisons?.monthlyActiveUsers?.direction === "down"
            ? "negative"
            : "neutral",
      accent: "var(--accent-4)",
      info: "Distinct users active in the trailing 30-day window. Adoption = monthly active ÷ assigned seats.",
    },
  ];

  return (
    <div className="panel">
      <h2>
        Organization Activity <span className="panel-note">as of {activity.date}</span>
        <InfoTip text="Seat and active-user counts for the most recent finalized day (engagement data has a ~3-day lag). Enterprise Analytics source only." />
      </h2>
      <div className="cards cards-inset">
        {cards.map((c) => (
          <div className="card" key={c.label}>
            <div className="card-label">
              {c.label}
              <InfoTip text={c.info} />
            </div>
            <div className="card-value">{c.value}</div>
            {c.sub && <div className="card-sub">{c.sub}</div>}
            {c.comparison && <div className={`card-comparison ${c.comparisonTone ?? "neutral"}`}>{c.comparison}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
