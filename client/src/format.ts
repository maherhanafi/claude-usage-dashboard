export const usd = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const fullNumber = (n: number): string => n.toLocaleString("en-US");

function compactPercent(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M%`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K%`;
  return `${n.toFixed(0)}%`;
}

export interface ComparisonMeta {
  previousValue: number;
  deltaValue: number;
  deltaPercent: number;
  direction: "up" | "down" | "same";
  label: string;
}

function resolvePreviousLabel(rangeSubLabel?: string, fallback = "the previous period"): string {
  const normalized = (rangeSubLabel ?? fallback).toLowerCase();
  if (normalized.includes("today")) return "yesterday";
  if (normalized.includes("last month") || normalized.includes("this month")) return "the month before";
  const daysMatch = normalized.match(/(\d+)\s*d/);
  if (daysMatch) return `the ${daysMatch[1]} days before`;
  return fallback;
}

export function formatComparisonText(
  comparison: ComparisonMeta | undefined,
  _valueType: "currency" | "number" | "percent" = "number",
  previousLabel?: string,
  variant: "full" | "compact" = "full",
): string {
  if (!comparison) return "";

  const sign = comparison.direction === "up" ? "↑" : comparison.direction === "down" ? "↓" : "•";
  const percentText = compactPercent(Math.abs(comparison.deltaPercent));
  if (variant === "compact") return `${sign} ${percentText}`;

  const label = resolvePreviousLabel(previousLabel, comparison.label || "the previous period");
  return `${sign} ${percentText} vs ${label}`;
}

export const shortDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

export function formatRangeLabel(range?: { startingAt?: string | null; endingAt?: string | null } | null): string {
  const startingAt = range?.startingAt?.slice(0, 10);
  const endingAt = range?.endingAt?.slice(0, 10);
  if (startingAt && endingAt) return `${startingAt} → ${endingAt}`;
  if (startingAt) return startingAt;
  if (endingAt) return endingAt;
  return "Unknown range";
}

// Short, readable model labels for charts/tables.
export const modelLabel = (model: string): string =>
  model
    .replace(/^claude-/, "")
    .replace(/[-_]?20\d{6}(?=$|[-_])/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(\d) (\d)\b/g, "$1.$2");
