import { describe, expect, it } from "vitest";
import { getCostChartColor, getCostTypeColor, getModelColor, getProductColor, getTokenSeriesColor } from "./chartColors";

function brightness(hex: string): number {
  const color = hex.slice(1);
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

describe("chartColors", () => {
  it("keeps model families on the same hue while only lightening older versions", () => {
    const sonnet35 = getModelColor("claude-3.5-sonnet");
    const sonnet37 = getModelColor("claude-3.7-sonnet");
    const sonnet46 = getModelColor("claude-sonnet-4-6");

    expect(sonnet35).not.toBe(sonnet37);
    expect(sonnet37).not.toBe(sonnet46);
    expect(brightness(sonnet35)).toBeGreaterThan(brightness(sonnet37));
    expect(brightness(sonnet37)).toBeGreaterThan(brightness(sonnet46));
    expect(brightness(sonnet46)).toBeGreaterThanOrEqual(brightness("#E9E5DA"));
  });

  it("uses the requested model-family palette", () => {
    expect(getModelColor("claude-fable-5-1")).toBe("#6fa7e8");
    expect(getModelColor("claude-opus-5-5")).toBe("#f39a78");
    expect(getModelColor("claude-sonnet-5-5")).toBe("#e9e5da");
    expect(getModelColor("claude-haiku-5-5")).toBe("#afcbc4");
  });

  it("uses the requested palette for known chart categories", () => {
    expect(getProductColor("Claude.ai Chat")).toBe("#6C9796");
    expect(getProductColor("Claude Code")).toBe("#A45A54");
    expect(getCostTypeColor("session_usage")).toBe("#D1713E");
    expect(getCostTypeColor("other")).toBe("#E0B667");
    expect(getCostChartColor()).toBe("#6C9796");
    expect(getTokenSeriesColor("uncachedInputTokens")).toBe("#6C9796");
    expect(getTokenSeriesColor("cacheReadTokens")).toBe("#8AA494");
    expect(getTokenSeriesColor("cacheCreationTokens")).toBe("#E09549");
    expect(getTokenSeriesColor("outputTokens")).toBe("#A45A54");
  });

  it("uses clearly separated colors for products and cost types", () => {
    const productColors = new Set([
      getProductColor("Claude.ai Chat"),
      getProductColor("Claude Code"),
      getProductColor("Cowork"),
      getProductColor("Office Agent"),
    ]);
    const costTypeColors = new Set([
      getCostTypeColor("tokens"),
      getCostTypeColor("web_search"),
      getCostTypeColor("code_execution"),
      getCostTypeColor("session_usage"),
    ]);

    expect(productColors.size).toBe(4);
    expect(costTypeColors.size).toBe(4);
  });
});