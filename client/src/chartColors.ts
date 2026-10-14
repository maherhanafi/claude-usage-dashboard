import { getModelFamily } from "./components/ModelFamilyIcon";

const PALETTE = {
  clay: "#A45A54",
  terracotta: "#D1713E",
  amber: "#E09549",
  sand: "#E0B667",
  sage: "#8AA494",
  seaGlass: "#6C9796",
} as const;

const DISTINCT_PALETTE = [PALETTE.clay, PALETTE.terracotta, PALETTE.amber, PALETTE.sand, PALETTE.sage, PALETTE.seaGlass];
const BREAKDOWN_PALETTE = [
  "#A64E4A",
  "#D97732",
  "#D9B14A",
  "#5F8F7B",
  "#4E7FA6",
  "#8B6FB3",
  "#B65F86",
  "#6E7C8F",
] as const;

const PRODUCT_COLORS: Record<string, string> = {
  "claude.ai chat": PALETTE.seaGlass,
  "claude code": PALETTE.clay,
  cowork: PALETTE.sage,
  "office agent": PALETTE.terracotta,
  "claude in chrome": PALETTE.sand,
  "claude design": PALETTE.amber,
  other: PALETTE.seaGlass,
};

const COST_TYPE_COLORS: Record<string, string> = {
  tokens: PALETTE.seaGlass,
  web_search: PALETTE.clay,
  code_execution: PALETTE.sage,
  session_usage: PALETTE.terracotta,
  other: PALETTE.sand,
};

const MODEL_FAMILY_COLORS: Record<string, string> = {
  fable: "#6FA7E8",
  opus: "#F39A78",
  sonnet: "#E9E5DA",
  haiku: "#AFCBC4",
};

const TOKEN_SERIES_COLORS = {
  uncachedInputTokens: PALETTE.seaGlass,
  cacheReadTokens: PALETTE.sage,
  cacheCreationTokens: PALETTE.amber,
  outputTokens: PALETTE.clay,
} as const;

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function hashString(input: string): number {
  let hash = 5381;
  for (const ch of input) hash = (hash * 33) ^ ch.charCodeAt(0);
  return Math.abs(hash >>> 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mixHex(base: string, target: string, amount: number): string {
  const ratio = clamp(amount, 0, 1);
  const baseRed = Number.parseInt(base.slice(1, 3), 16);
  const baseGreen = Number.parseInt(base.slice(3, 5), 16);
  const baseBlue = Number.parseInt(base.slice(5, 7), 16);
  const targetRed = Number.parseInt(target.slice(1, 3), 16);
  const targetGreen = Number.parseInt(target.slice(3, 5), 16);
  const targetBlue = Number.parseInt(target.slice(5, 7), 16);

  const red = Math.round(baseRed + (targetRed - baseRed) * ratio);
  const green = Math.round(baseGreen + (targetGreen - baseGreen) * ratio);
  const blue = Math.round(baseBlue + (targetBlue - baseBlue) * ratio);

  return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

function getModelVersion(model: string): { major: number; minor: number } | null {
  const normalized = normalizeKey(model);
  const dottedMatch = normalized.match(/(\d+)\.(\d+)/);
  if (dottedMatch) return { major: Number(dottedMatch[1]), minor: Number(dottedMatch[2]) };

  const dashedMatches = [...normalized.matchAll(/(?:^|[^0-9])(\d+)-(\d+)(?:$|[^0-9])/g)];
  const dashedMatch = dashedMatches[dashedMatches.length - 1];
  if (dashedMatch) return { major: Number(dashedMatch[1]), minor: Number(dashedMatch[2]) };

  const integerMatches = [...normalized.matchAll(/(?:^|[^0-9])(\d+)(?:$|[^0-9])/g)];
  const integerMatch = integerMatches[integerMatches.length - 1];
  if (integerMatch) return { major: Number(integerMatch[1]), minor: 0 };

  return null;
}

function getVersionedFamilyColor(baseColor: string, model: string): string {
  const version = getModelVersion(model);
  if (!version) return baseColor;

  const versionValue = version.major + version.minor / 10;
  const position = clamp((versionValue - 3) / 1.8, 0, 1);
  return mixHex(baseColor, "#ffffff", (1 - position) * 0.72);
}

export function getModelColor(model: string): string {
  const family = getModelFamily(model);
  if (!family) return DISTINCT_PALETTE[hashString(normalizeKey(model)) % DISTINCT_PALETTE.length];

  return getVersionedFamilyColor(MODEL_FAMILY_COLORS[family], model);
}

export function getProductColor(product: string): string {
  const known = PRODUCT_COLORS[normalizeKey(product)];
  return known ?? DISTINCT_PALETTE[hashString(normalizeKey(product)) % DISTINCT_PALETTE.length];
}

export function getCostTypeColor(costType: string): string {
  const known = COST_TYPE_COLORS[normalizeKey(costType)];
  return known ?? DISTINCT_PALETTE[hashString(normalizeKey(costType)) % DISTINCT_PALETTE.length];
}

export function getCostChartColor(): string {
  return PALETTE.seaGlass;
}

export function getBreakdownColor(label: string): string {
  return BREAKDOWN_PALETTE[hashString(normalizeKey(label)) % BREAKDOWN_PALETTE.length];
}

export function getBreakdownPaletteColor(index: number): string {
  return BREAKDOWN_PALETTE[index % BREAKDOWN_PALETTE.length];
}

export function getTokenSeriesColor(seriesKey: keyof typeof TOKEN_SERIES_COLORS): string {
  return TOKEN_SERIES_COLORS[seriesKey];
}

export function gradientId(prefix: string, key: string): string {
  return `${prefix}-${normalizeKey(key).replace(/[^a-z0-9]+/g, "-") || "item"}`;
}