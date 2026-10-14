import type { ProductBreakdown as ProductRow } from "../types";
import { getProductColor } from "../chartColors";
import { compactNumber, formatComparisonText, usd } from "../format";
import { InfoTip } from "./InfoTip";

export function ProductBreakdown({ data }: { data: ProductRow[] }) {
  return (
    <ProductBreakdownPanel data={data} />
  );
}

export function ProductBreakdownPanel({
  data,
  onShowCostTypes,
}: {
  data: ProductRow[];
  onShowCostTypes?: () => void;
}) {
  const rows = data.filter((d) => d.costUsd > 0 || d.totalTokens > 0);
  const maxCost = Math.max(...rows.map((d) => d.costUsd), 0.0001);
  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          Usage &amp; Cost By Product
          <InfoTip text="Where usage happens — Claude.ai chat, Claude Code, Cowork, Office, etc. — by cost (bar) and tokens. Enterprise Analytics source only." />
        </h2>
        {onShowCostTypes && (
          <button className="panel-action" onClick={onShowCostTypes}>
            Cost types
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="empty">No product activity in this window.</p>
      ) : (
        <ul className="product-list">
          {rows.map((p) => {
            const color = getProductColor(p.product);
            return (
            <li key={p.product}>
              <div className="product-head">
                <span className="swatch" style={{ background: color }} />
                <span className="product-name">{p.product}</span>
                <span className="product-metrics">
                  {p.costComparison && (
                    <span
                      className={`cost-comparison ${p.costComparison.direction === "up" ? "positive" : p.costComparison.direction === "down" ? "negative" : "neutral"}`}
                    >
                      {formatComparisonText(p.costComparison, "currency", undefined, "compact")}
                    </span>
                  )}
                  <span className="product-cost">{usd(p.costUsd)}</span>
                </span>
              </div>
              <div className="product-bar-track">
                <span
                  className="product-bar"
                  style={{ width: `${(p.costUsd / maxCost) * 100}%`, background: color }}
                />
              </div>
              <div className="product-sub">
                {compactNumber(p.totalTokens)} tokens • {totalCost > 0 ? `${((p.costUsd / totalCost) * 100).toFixed(1)}%` : "0.0%"} of cost
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
