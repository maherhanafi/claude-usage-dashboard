import { useCallback, useState, type ReactNode } from "react";

/**
 * Clickable-legend state for multi-series charts. Click a legend item to
 * hide/show that series; hidden items render dimmed + struck-through.
 * Series are keyed by their Recharts `dataKey`.
 */
export function useLegendToggle() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onLegendClick = useCallback(
    (o: any) => {
      const key = String(o?.dataKey ?? o?.value ?? "");
      if (key) toggle(key);
    },
    [toggle],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legendFormatter = useCallback(
    (value: ReactNode, entry?: any): ReactNode => {
      const key = String(entry?.dataKey ?? value ?? "");
      const off = hidden.has(key);
      return (
        <span
          style={{
            cursor: "pointer",
            color: off ? "var(--text-dim)" : "var(--text)",
            textDecoration: off ? "line-through" : "none",
          }}
        >
          {value}
        </span>
      );
    },
    [hidden],
  );

  return { hidden, toggle, onLegendClick, legendFormatter };
}
