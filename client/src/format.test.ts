import { describe, expect, it } from "vitest";
import { formatComparisonText, formatRangeLabel, modelLabel } from "./format";

describe("formatComparisonText", () => {
  it("formats positive changes with the previous period label", () => {
    expect(
      formatComparisonText(
        {
          previousValue: 10,
          deltaValue: 2,
          deltaPercent: 20,
          direction: "up",
          label: "previous 7 days",
        },
        "number",
      ),
    ).toBe("↑ 20% vs the 7 days before");
  });

  it("formats negative changes for currency values", () => {
    expect(
      formatComparisonText(
        {
          previousValue: 100,
          deltaValue: -20,
          deltaPercent: -20,
          direction: "down",
          label: "the month before",
        },
        "currency",
      ),
    ).toBe("↓ 20% vs the month before");
  });

  it("compacts very large percentage deltas", () => {
    expect(
      formatComparisonText(
        {
          previousValue: 1,
          deltaValue: 1677.73,
          deltaPercent: 167773,
          direction: "up",
          label: "the previous period",
        },
        "number",
      ),
    ).toBe("↑ 167K% vs the previous period");
  });

  it("formats compact comparison text for table columns", () => {
    expect(
      formatComparisonText(
        {
          previousValue: 1,
          deltaValue: 1677.73,
          deltaPercent: 167773,
          direction: "up",
          label: "the previous period",
        },
        "number",
        undefined,
        "compact",
      ),
    ).toBe("↑ 167K%");
  });

  it("formats a fallback label when the range is missing", () => {
    expect(formatRangeLabel(undefined)).toBe("Unknown range");
  });

  it("removes trailing model date stamps from display labels", () => {
    expect(modelLabel("claude-sonnet-4-5-20251001")).toBe("Sonnet 4.5");
    expect(modelLabel("claude-opus-4-1_20241219")).toBe("Opus 4.1");
  });

  it("collapses single-digit model version parts into dotted versions", () => {
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("claude-3-7-sonnet")).toBe("3.7 Sonnet");
  });
});
