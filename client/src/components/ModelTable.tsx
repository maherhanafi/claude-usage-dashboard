import { useState } from "react";
import type { ModelBreakdown } from "../types";
import { compactNumber, formatComparisonText, modelLabel, usd } from "../format";
import { InfoTip } from "./InfoTip";
import { Modal } from "./Modal";
import { PricingTable } from "./PricingTable";

function costPerMillionTokens(costUsd: number, totalTokens: number): number | null {
  if (totalTokens <= 0) return null;
  return (costUsd / totalTokens) * 1_000_000;
}

type SortKey = "model" | "uncachedInputTokens" | "cacheReadTokens" | "outputTokens" | "totalTokens" | "costPerMillionTokens" | "costComparison" | "costUsd";
type SortDirection = "asc" | "desc";

const DEFAULT_SORT: { key: SortKey; direction: SortDirection } = {
  key: "costUsd",
  direction: "desc",
};

export function ModelTable({
  data,
  selectedModel,
  onSelectModel,
}: {
  data: ModelBreakdown[];
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
}) {
  const [showPricing, setShowPricing] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT.direction);
  const usedModels = data.map((d) => d.model);
  const sortedData = [...data].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;

    if (sortKey === "model") {
      return a.model.localeCompare(b.model, undefined, { sensitivity: "base" }) * direction;
    }

    if (sortKey === "costComparison") {
      const aValue = a.costComparison?.deltaPercent ?? Number.NEGATIVE_INFINITY;
      const bValue = b.costComparison?.deltaPercent ?? Number.NEGATIVE_INFINITY;
      if (aValue !== bValue) return (aValue - bValue) * direction;
      return (a.costUsd - b.costUsd) * -1;
    }

    if (sortKey === "costPerMillionTokens") {
      const aValue = costPerMillionTokens(a.costUsd, a.totalTokens) ?? Number.NEGATIVE_INFINITY;
      const bValue = costPerMillionTokens(b.costUsd, b.totalTokens) ?? Number.NEGATIVE_INFINITY;
      if (aValue !== bValue) return (aValue - bValue) * direction;
      return (a.costUsd - b.costUsd) * -1;
    }

    const aValue = a[sortKey];
    const bValue = b[sortKey];
    if (aValue !== bValue) return (aValue - bValue) * direction;
    return (a.costUsd - b.costUsd) * -1;
  });
  const maxCost = Math.max(...sortedData.map((d) => d.costUsd), 0.0001);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "model" ? "asc" : "desc");
  };

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  const sortableHeader = (label: string, key: SortKey, numeric = false) => (
    <th className={numeric ? "num" : undefined}>
      <button
        type="button"
        className={`sort-button${numeric ? " sort-button-num" : ""}${sortKey === key ? " active" : ""}`}
        onClick={() => toggleSort(key)}
      >
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {sortIndicator(key)}
        </span>
      </button>
    </th>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          Usage &amp; Cost By Model
          <InfoTip text="Tokens and cost grouped by Claude model over the selected range, sorted by cost. The bar shows each model's share of total spend." />
        </h2>
        <button className="panel-action" onClick={() => setShowPricing(true)}>
          Pricing
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {sortableHeader("Model", "model")}
              {sortableHeader("Input", "uncachedInputTokens", true)}
              {sortableHeader("Cache read", "cacheReadTokens", true)}
              {sortableHeader("Output", "outputTokens", true)}
              {sortableHeader("Total tokens", "totalTokens", true)}
              {sortableHeader("Cost / 1M", "costPerMillionTokens", true)}
              {sortableHeader("Trend", "costComparison", true)}
              {sortableHeader("Cost", "costUsd", true)}
            </tr>
          </thead>
          <tbody>
            {sortedData.map((m) => (
              <tr
                key={m.model}
                className={selectedModel === m.model ? "row-selected row-clickable" : "row-clickable"}
                onClick={() => onSelectModel(selectedModel === m.model ? null : m.model)}
              >
                <td>
                  <span className="model-name">{modelLabel(m.model)}</span>
                </td>
                <td className="num">{compactNumber(m.uncachedInputTokens)}</td>
                <td className="num">{compactNumber(m.cacheReadTokens)}</td>
                <td className="num">{compactNumber(m.outputTokens)}</td>
                <td className="num">{compactNumber(m.totalTokens)}</td>
                <td className="num">{costPerMillionTokens(m.costUsd, m.totalTokens) != null ? usd(costPerMillionTokens(m.costUsd, m.totalTokens)!) : "—"}</td>
                <td className="num comparison-cell">
                  {m.costComparison && (
                    <span
                      className={`cost-comparison ${m.costComparison.direction === "up" ? "positive" : m.costComparison.direction === "down" ? "negative" : "neutral"}`}
                    >
                      {formatComparisonText(m.costComparison, "currency", undefined, "compact")}
                    </span>
                  )}
                </td>
                <td className="num cost-cell">
                  <span className="cost-bar" style={{ width: `${(m.costUsd / maxCost) * 100}%` }} />
                  <span className="cost-text">{usd(m.costUsd)}</span>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No usage in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPricing && (
        <Modal onClose={() => setShowPricing(false)}>
          <PricingTable usedModels={usedModels} />
        </Modal>
      )}
    </div>
  );
}
