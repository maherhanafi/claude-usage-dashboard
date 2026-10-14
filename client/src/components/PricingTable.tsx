import { InfoTip } from "./InfoTip";

// Reference list prices in USD per million tokens (MTok), from Anthropic's
// pricing page: https://platform.claude.com/docs/en/about-claude/pricing
// (as of September 2026). Static reference — not used to compute the dashboard's
// cost figures, which come directly from the Analytics API.
interface PriceRow {
  model: string;
  ids: string[]; // usage model-id prefixes that map to this row
  input: PriceValue;
  cacheWrite5m: PriceValue;
  cacheWrite1h: PriceValue;
  cacheRead: PriceValue;
  output: PriceValue;
}

type PriceValue = number | string[];

const PRICING: PriceRow[] = [
  { model: "Claude Fable 5.1", ids: ["claude-fable-5-1"], input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
  { model: "Claude Mythos 5.1", ids: ["claude-mythos-5-1"], input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
  { model: "Claude Fable 5", ids: ["claude-fable-5"], input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
  { model: "Claude Mythos 5", ids: ["claude-mythos-5"], input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
  { model: "Claude Opus 5.5", ids: ["claude-opus-5-5"], input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  { model: "Claude Opus 5", ids: ["claude-opus-5"], input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { model: "Claude Opus 4.8", ids: ["claude-opus-4-8"], input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { model: "Claude Opus 4.7", ids: ["claude-opus-4-7"], input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { model: "Claude Opus 4.6", ids: ["claude-opus-4-6"], input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { model: "Claude Opus 4.5", ids: ["claude-opus-4-5"], input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { model: "Claude Opus 4.1", ids: ["claude-opus-4-1"], input: 15, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5, output: 75 },
  { model: "Claude Opus 4", ids: ["claude-opus-4"], input: 15, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5, output: 75 },
  { model: "Claude Sonnet 5.5", ids: ["claude-sonnet-5-5"], input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  { model: "Claude Sonnet 5", ids: ["claude-sonnet-5"], input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  { model: "Claude Sonnet 4.6", ids: ["claude-sonnet-4-6"], input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  { model: "Claude Sonnet 4.5", ids: ["claude-sonnet-4-5"], input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  { model: "Claude Sonnet 4", ids: ["claude-sonnet-4"], input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
  {
    model: "Claude Haiku 5.5",
    ids: ["claude-haiku-5-5"],
    input: ["$0.10 / MTok for prompts up to 100,000 tokens", "$0.50 / MTok for prompts over 100,000 tokens"],
    cacheWrite5m: ["$0.125 / MTok", "$0.625 / MTok"],
    cacheWrite1h: ["$0.20 / MTok", "$1 / MTok"],
    cacheRead: ["$0.01 / MTok", "$0.05 / MTok"],
    output: ["$0.50 / MTok", "$2.50 / MTok"],
  },
  { model: "Claude Haiku 4.5", ids: ["claude-haiku-4-5"], input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
  { model: "Claude Haiku 3.5", ids: ["claude-haiku-3-5"], input: 0.8, cacheWrite5m: 1, cacheWrite1h: 1.6, cacheRead: 0.08, output: 4 },
];

const price = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

function renderPrice(value: PriceValue) {
  if (Array.isArray(value)) {
    return (
      <div className="price-lines">
        {value.map((line) => (
          <span key={line} className="price-line">
            {line}
          </span>
        ))}
      </div>
    );
  }

  return price(value);
}

export function PricingTable({ usedModels = [] }: { usedModels?: string[] }) {
  const isUsed = (row: PriceRow) =>
    usedModels.some((u) => row.ids.some((id) => u.startsWith(id)));
  const sortedPricing = [...PRICING].sort((left, right) => Number(isUsed(right)) - Number(isUsed(left)));

  return (
    <div className="panel">
      <h2>
        Model Pricing Reference <span className="panel-note">USD per million tokens</span>
        <InfoTip text="Official Anthropic list prices, for reference. These are NOT used to compute the dashboard's cost figures — those come directly from the Analytics API. Most models use cache read = 0.1× input, 5-minute cache write = 1.25× input, and 1-hour cache write = 2× input. Exceptions: Fable 5.1 and Mythos 5.1 use 0.025× cache-read pricing; Opus 5.5 and Sonnet 5/5.5 use 0.05×." />
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Input</th>
              <th className="num">Cache write (5m)</th>
              <th className="num">Cache write (1h)</th>
              <th className="num">Cache read</th>
              <th className="num">Output</th>
            </tr>
          </thead>
          <tbody>
            {sortedPricing.map((row) => (
              <tr key={row.model}>
                <td>
                  <span className="model-name">{row.model}</span>
                  {isUsed(row) && <span className="tag-inuse">in use</span>}
                </td>
                <td className="num">{renderPrice(row.input)}</td>
                <td className="num">{renderPrice(row.cacheWrite5m)}</td>
                <td className="num">{renderPrice(row.cacheWrite1h)}</td>
                <td className="num">{renderPrice(row.cacheRead)}</td>
                <td className="num">{renderPrice(row.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pricing-note">
        Batch API: 50% off input &amp; output · Web search: $10 / 1,000 searches · 1M-token context at
        standard pricing · cache-read exceptions apply for Fable 5.1, Mythos 5.1, Opus 5.5, and Sonnet 5/5.5.{" "}
        <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noreferrer">
          Source ↗
        </a>
      </p>
    </div>
  );
}
