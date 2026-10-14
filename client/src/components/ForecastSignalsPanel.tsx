import type { DashboardPayload } from "../types";
import { formatComparisonText, fullNumber, modelLabel, usd } from "../format";
import { InfoTip } from "./InfoTip";

interface SignalCard {
  label: string;
  value: string;
  sub?: string;
  comparison?: string;
  comparisonTone?: "positive" | "negative" | "neutral";
  info: string;
}

function buildCostComparison(currentValue: number, previousValue: number, label = "the previous period") {
  const deltaValue = currentValue - previousValue;
  const deltaPercent = previousValue === 0 ? (currentValue > 0 ? 100 : 0) : (deltaValue / previousValue) * 100;
  const direction = deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "same";
  return { previousValue, deltaValue, deltaPercent, direction, label } as const;
}

function averageDailyCost(payload: DashboardPayload | null): number | null {
  if (!payload || payload.timeseries.length === 0) return null;
  return payload.summary.totalCostUsd / payload.timeseries.length;
}

function buildModelMixSignal(current: DashboardPayload, previousMonth: DashboardPayload | null, selectedModel: string | null): SignalCard {
  if (selectedModel) {
    return {
      label: "Model Mix Shifts",
      value: modelLabel(selectedModel),
      sub: "Unavailable while filtered to a single model.",
      comparison: "Mix context removed by model filter",
      comparisonTone: "neutral",
      info: "Model-mix analysis needs multiple models so it can compare spend-share shifts across the portfolio.",
    };
  }

  if (!previousMonth || current.summary.totalCostUsd <= 0 || previousMonth.summary.totalCostUsd <= 0) {
    return {
      label: "Model Mix Shifts",
      value: "—",
      sub: "Previous month model-share baseline unavailable.",
      comparisonTone: "neutral",
      info: "Highlights the model with the largest change in spend share versus last month.",
    };
  }

  const currentCost = new Map(current.byModel.map((row) => [row.model, row.costUsd]));
  const previousCost = new Map(previousMonth.byModel.map((row) => [row.model, row.costUsd]));
  const allModels = new Set<string>([...currentCost.keys(), ...previousCost.keys()]);

  let strongest:
    | { model: string; deltaShare: number; currentShare: number; previousShare: number }
    | null = null;

  for (const model of allModels) {
    const currentShare = (currentCost.get(model) ?? 0) / current.summary.totalCostUsd;
    const previousShare = (previousCost.get(model) ?? 0) / previousMonth.summary.totalCostUsd;
    const deltaShare = currentShare - previousShare;
    if (!strongest || Math.abs(deltaShare) > Math.abs(strongest.deltaShare)) {
      strongest = { model, deltaShare, currentShare, previousShare };
    }
  }

  if (!strongest) {
    return {
      label: "Model Mix Shifts",
      value: "—",
      sub: "No comparable model mix data.",
      comparisonTone: "neutral",
      info: "Highlights the model with the largest change in spend share versus last month.",
    };
  }

  const shareDeltaPoints = Math.abs(strongest.deltaShare * 100).toFixed(1);
  const directionLabel = strongest.deltaShare > 0 ? "Gained spend share" : strongest.deltaShare < 0 ? "Lost spend share" : "No share change";

  return {
    label: "Model Mix Shifts",
    value: `${modelLabel(strongest.model)} ${strongest.deltaShare >= 0 ? "+" : "-"}${shareDeltaPoints} pts`,
    sub: `${(strongest.currentShare * 100).toFixed(1)}% now vs ${(strongest.previousShare * 100).toFixed(1)}% last month`,
    comparison: directionLabel,
    comparisonTone: "neutral",
    info: "Largest change in model spend share versus last month. Big mix moves can change forecast accuracy even when total tokens stay similar.",
  };
}

export function ForecastSignalsPanel({
  current,
  previousMonth,
  selectedModel,
}: {
  current: DashboardPayload;
  previousMonth: DashboardPayload | null;
  selectedModel: string | null;
}) {
  const currentDailyCost = averageDailyCost(current);
  const previousDailyCost = averageDailyCost(previousMonth);
  const costPaceComparison =
    currentDailyCost != null && previousDailyCost != null
      ? buildCostComparison(currentDailyCost, previousDailyCost, "previous month daily average")
      : undefined;

  const cards: SignalCard[] = [
    {
      label: "Cost Pace",
      value: currentDailyCost != null ? `${usd(currentDailyCost)}/day` : "—",
      sub: previousDailyCost != null ? `${usd(previousDailyCost)}/day last month avg` : "Previous month daily average unavailable",
      comparison: costPaceComparison ? formatComparisonText(costPaceComparison, "currency", "previous month daily average") : undefined,
      comparisonTone:
        costPaceComparison?.direction === "up"
          ? "negative"
          : costPaceComparison?.direction === "down"
            ? "positive"
            : "neutral",
      info: "Current month average daily spend pace versus the previous month's full-month daily average.",
    },
    {
      label: "Active User Growth",
      value: current.activity ? fullNumber(current.activity.dailyActiveUsers) : "—",
      sub: current.activity ? `Daily active on ${current.activity.date}` : "Not available for this filtered view",
      comparison: current.activity ? formatComparisonText(current.activity.comparisons?.dailyActiveUsers, "number") : undefined,
      comparisonTone: "neutral",
      info: "Latest finalized daily active users. Rising activity can push demand above a pure weekday-based forecast.",
    },
    buildModelMixSignal(current, previousMonth, selectedModel),
    {
      label: "Cache Hit Rate",
      value: `${current.summary.cacheHitRate.toFixed(1)}%`,
      sub: `${fullNumber(current.summary.cacheReadTokens)} cached read tokens`,
      comparison: formatComparisonText(current.summary.comparisons?.cacheHitRate, "percent"),
      comparisonTone:
        current.summary.comparisons?.cacheHitRate?.direction === "up"
          ? "positive"
          : current.summary.comparisons?.cacheHitRate?.direction === "down"
            ? "negative"
            : "neutral",
      info: "Prompt-cache efficiency signal. Falling hit rate usually raises effective input cost for the rest of the month.",
    },
  ];

  return (
    <section className="panel">
      <h2>
        Forecast Signals <span className="panel-note">informational only</span>
        <InfoTip text="These signals are shown as inputs worth watching for month-end forecasting. They are not yet folded into the predicted-cost algorithm itself." />
      </h2>
      <div className="cards cards-inset">
        {cards.map((card) => (
          <div className="card" key={card.label}>
            <div className="card-label">
              <span className="card-label-text">{card.label}</span>
              <InfoTip text={card.info} />
            </div>
            <div className="card-value">{card.value}</div>
            {card.sub && <div className="card-sub">{card.sub}</div>}
            {card.comparison && <div className={`card-comparison ${card.comparisonTone ?? "neutral"}`}>{card.comparison}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}