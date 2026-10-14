import { config } from "./config.js";
import type {
  AnalysisHealth,
  DashboardPayload,
  MetricComparison,
  ModelBreakdown,
  MonthlyCostAnalysis,
  ProductBreakdown,
  UserBreakdown,
} from "./types.js";

interface AnalysisResponseShape {
  headline?: string;
  summary?: string;
  drivers?: Array<{ title?: string; detail?: string }>;
  primaryDrivers?: Array<{ title?: string; detail?: string }>;
  secondarySignals?: Array<{ title?: string; detail?: string }>;
  nonMaterialFactors?: Array<{ title?: string; detail?: string }>;
  caveats?: string[];
}

interface ChatCompletionsResponse {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

type ChatMessageContent = string | Array<{ type?: string; text?: string }> | undefined;
type ChatCompletionChoice = {
  delta?: {
    content?: ChatMessageContent;
  };
  message?: {
    content?: ChatMessageContent;
  };
};

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

const ANALYSIS_TIMEOUT_MS = 45_000;
const ANALYSIS_MAX_ATTEMPTS = 2;

export interface MonthlyCostAnalysisStreamHandlers {
  onDelta?: (delta: string, fullText: string) => void;
}

interface AnalysisRequestOptions {
  mode: "json" | "text";
  handlers?: MonthlyCostAnalysisStreamHandlers;
}

function unavailable(summary: string, caveats: string[] = []): MonthlyCostAnalysis {
  return {
    status: "unavailable",
    headline: "AI month-over-month analysis unavailable",
    summary,
    primaryDrivers: [],
    secondarySignals: [],
    nonMaterialFactors: [],
    caveats,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeDrivers(
  drivers: Array<{ title?: string; detail?: string }> | undefined,
  limit: number,
): Array<{ title: string; detail: string }> {
  return (drivers ?? [])
    .filter((driver) => driver.title && driver.detail)
    .slice(0, limit)
    .map((driver) => ({ title: driver.title!, detail: driver.detail! }));
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

function summarizeComparison(comparison: MetricComparison | undefined): string | null {
  if (!comparison) return null;
  const direction = comparison.direction === "up" ? "up" : comparison.direction === "down" ? "down" : "flat";
  return `${direction} ${formatPercent(comparison.deltaPercent)} from ${formatCurrency(comparison.previousValue)} to ${formatCurrency(comparison.previousValue + comparison.deltaValue)}`;
}

function topDrivers<T extends { costUsd: number; costComparison?: MetricComparison }>(
  rows: T[] | undefined,
  label: (row: T) => string,
  limit: number,
): Array<{ name: string; costUsd: number; deltaUsd: number; deltaPercent: number; direction: string }> {
  return (rows ?? [])
    .filter((row) => row.costComparison && Math.abs(row.costComparison.deltaValue) > 0)
    .sort((left, right) => Math.abs(right.costComparison!.deltaValue) - Math.abs(left.costComparison!.deltaValue))
    .slice(0, limit)
    .map((row) => ({
      name: label(row),
      costUsd: row.costUsd,
      deltaUsd: row.costComparison!.deltaValue,
      deltaPercent: row.costComparison!.deltaPercent,
      direction: row.costComparison!.direction,
    }));
}

function buildCostTypeShare(costUsd: number, totalCostUsd: number): number {
  if (!totalCostUsd) return 0;
  return Number(((costUsd / totalCostUsd) * 100).toFixed(2));
}

function buildAnalysisContext(payload: DashboardPayload): string {
  const totalCostComparison = payload.summary.comparisons?.totalCostUsd;
  const totalTokenComparison = payload.summary.comparisons?.totalTokens;
  const outputTokenComparison = payload.summary.comparisons?.outputTokens;
  const cacheHitComparison = payload.summary.comparisons?.cacheHitRate;
  const webSearchComparison = payload.summary.comparisons?.webSearchRequests;

  const topModelDrivers = topDrivers<ModelBreakdown>(payload.byModel, (row) => row.model, 5);
  const topProductDrivers = topDrivers<ProductBreakdown>(payload.byProduct, (row) => row.product, 5);
  const topUserDrivers = topDrivers<UserBreakdown>(payload.byUser, (row) => row.name || row.email || row.userId, 5);

  const costTypeMap = new Map(payload.costByType.map((row) => [row.costType, row.costUsd]));
  const topCostTypes = payload.costByType.slice(0, 5).map((row) => ({
    costType: row.costType,
    costUsd: row.costUsd,
    sharePercent: buildCostTypeShare(row.costUsd, payload.summary.totalCostUsd),
  }));
  const webSearchCostUsd = costTypeMap.get("web_search") ?? 0;
  const webSearchCostSharePercent = buildCostTypeShare(webSearchCostUsd, payload.summary.totalCostUsd);

  const activity = payload.activity
    ? {
        assignedSeats: payload.activity.assignedSeats,
        dailyActiveUsers: payload.activity.dailyActiveUsers,
        weeklyActiveUsers: payload.activity.weeklyActiveUsers,
        monthlyActiveUsers: payload.activity.monthlyActiveUsers,
        assignedSeatsComparison: payload.activity.comparisons?.assignedSeats,
        dailyActiveUsersComparison: payload.activity.comparisons?.dailyActiveUsers,
        weeklyActiveUsersComparison: payload.activity.comparisons?.weeklyActiveUsers,
        monthlyActiveUsersComparison: payload.activity.comparisons?.monthlyActiveUsers,
      }
    : null;

  return JSON.stringify(
    {
      source: payload.source,
      currentMonth: {
        totalCostUsd: payload.summary.totalCostUsd,
        totalTokens: payload.summary.totalTokens,
        outputTokens: payload.summary.outputTokens,
        cacheHitRate: payload.summary.cacheHitRate,
      },
      costComparisons: {
        totalCost: totalCostComparison,
        totalTokens: totalTokenComparison,
        outputTokens: outputTokenComparison,
      },
      efficiencySignals: {
        cacheHitRate: cacheHitComparison,
      },
      operationalSignals: {
        webSearchRequests: webSearchComparison,
      },
      summaryHints: {
        totalCost: summarizeComparison(totalCostComparison),
        totalTokens: summarizeComparison(totalTokenComparison),
      },
      pricingContext: {
        totalCostUsd: payload.summary.totalCostUsd,
        webSearchCostUsd,
        webSearchCostSharePercent,
        note:
          "web_search cost share is more important than raw webSearchRequests when judging whether search affected spend.",
      },
      topModelDrivers,
      topProductDrivers,
      topUserDrivers,
      topCostTypes,
      activity,
    },
    null,
    2,
  );
}

function buildStructuredPrompt(payload: DashboardPayload): string {
  const context = buildAnalysisContext(payload);
  return JSON.stringify(
    {
      task:
        "Explain why total cost was higher or lower last month versus the previous month. Focus on cost drivers visible in the data. Prioritize absolute dollar contribution over percentage change. Do not invent causes outside the provided metrics. Return strict JSON with keys headline, summary, primaryDrivers, secondarySignals, nonMaterialFactors, caveats. Do not wrap JSON in markdown fences.",
      pricingRules: [
        "Rank evidence by absolute dollar impact first, not by percent change.",
        "A very large percentage move on a tiny baseline is secondary unless it materially changes dollars.",
        "Treat webSearchRequests as an operational signal, not a primary spend driver, unless web_search cost itself is a meaningful share of total cost.",
        "Use costByType, model cost deltas, product cost deltas, and user cost deltas as primary evidence for why spend changed.",
        "Mention cache hit rate or web search request changes only as supporting context when they help explain dollar movement.",
      ],
      responseContract: {
        primaryDrivers:
          "Array of up to 3 items. These are the largest visible dollar drivers of the month-over-month cost change.",
        secondarySignals:
          "Array of up to 3 items. These are operational or efficiency signals that add context but are not the main dollar explanation.",
        nonMaterialFactors:
          "Array of up to 3 items. These are changes that might look dramatic in percentage terms but did not materially affect spend.",
      },
      context,
    },
    null,
    2,
  );
}

function buildStreamingPrompt(payload: DashboardPayload): string {
  const context = buildAnalysisContext(payload);
  return [
    "Write a short live draft for a dashboard widget that explains why last month's cost changed versus the previous month.",
    "Return plain text only. Do not return JSON. Do not describe the schema or the prompt. Do not say 'This is a JSON object'.",
    "Use this format:",
    "Headline: <one sentence>",
    "",
    "Drivers:",
    "- <largest dollar driver with numbers>",
    "- <second driver with numbers>",
    "",
    "Signals:",
    "- <supporting operational signal>",
    "",
    "Not material:",
    "- <large percent change that did not move spend much>",
    "",
    "Keep it concise and readable. Preserve normal spaces and punctuation.",
    "Prioritize absolute dollar impact over percentage change.",
    "",
    "Context:",
    context,
  ].join("\n");
}

function extractResponseText(content: ChatMessageContent, trim = true): string {
  if (typeof content === "string") return trim ? content.trim() : content;
  if (!Array.isArray(content)) return "";
  const text = content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n");
  return trim ? text.trim() : text;
}

function extractChoiceText(choice: ChatCompletionChoice, trim = true): string {
  return extractResponseText(choice.delta?.content ?? choice.message?.content, trim);
}

function stripMarkdownFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

function extractBalancedJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start !== -1) return text.slice(start, index + 1);
    }
  }

  return null;
}

function parseAnalysis(text: string): AnalysisResponseShape | null {
  const cleaned = stripMarkdownFences(text);
  const direct = cleaned.trim();
  try {
    return JSON.parse(direct) as AnalysisResponseShape;
  } catch {
    const extracted = extractBalancedJsonObject(cleaned);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted) as AnalysisResponseShape;
    } catch {
      return null;
    }
  }
}

async function readChatCompletionStream(
  response: Response,
  handlers?: MonthlyCostAnalysisStreamHandlers,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let fullText = "";
  let bufferedDelta = "";

  const flushDelta = (force = false) => {
    if (!bufferedDelta) return;
    const shouldFlush = force || bufferedDelta.length >= 48 || /[\n.!?:]\s*$/.test(bufferedDelta);
    if (!shouldFlush) return;
    handlers?.onDelta?.(bufferedDelta, fullText);
    bufferedDelta = "";
  };

  const handleEventBlock = (block: string) => {
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const chunk = JSON.parse(data) as ChatCompletionsResponse;
        const delta = chunk.choices?.map((choice) => extractChoiceText(choice, false)).join("") ?? "";
        if (!delta) continue;
        fullText += delta;
        bufferedDelta += delta;
        flushDelta();
      } catch {
        continue;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = pending.indexOf("\n\n");
    while (boundary !== -1) {
      handleEventBlock(pending.slice(0, boundary));
      pending = pending.slice(boundary + 2);
      boundary = pending.indexOf("\n\n");
    }

    if (done) break;
  }

  if (pending.trim()) handleEventBlock(pending);
  flushDelta(true);
  return fullText.trim();
}

async function requestAnalysisText(
  prompt: string,
  options: AnalysisRequestOptions,
): Promise<{ text: string; failure: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.analysisApiKey) headers.authorization = `Bearer ${config.analysisApiKey}`;

  let lastFailure = "The AI analysis returned an unreadable response. The dashboard metrics are still available.";

  for (let attempt = 1; attempt <= ANALYSIS_MAX_ATTEMPTS; attempt += 1) {
    const streaming = Boolean(options.handlers?.onDelta);
    const jsonMode = options.mode === "json";
    const response = await fetch(`${config.analysisBaseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      body: JSON.stringify({
        model: config.analysisModel,
        max_tokens: 700,
        temperature: 0,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        stream: streaming,
        messages: [
          {
            role: "system",
            content:
              jsonMode
                ? "You explain cost movements for engineering dashboards. Use only the provided data. Be concise, concrete, and skeptical. Return one valid JSON object only, with no markdown fences or prose outside the JSON."
                : "You explain cost movements for engineering dashboards. Use only the provided data. Be concise, concrete, and skeptical. Return readable plain text only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      lastFailure = "The AI analysis request failed. The dashboard data is still available without the narrative explanation.";
      console.warn(`[analysis] month-over-month analysis failed with ${response.status} on attempt ${attempt}: ${body.slice(0, 240)}`);
      if (attempt < ANALYSIS_MAX_ATTEMPTS) continue;
      return { text: "", failure: lastFailure };
    }

    if (streaming) {
      const text = await readChatCompletionStream(response, options.handlers);
      if (text) return { text, failure: null };
      console.warn(`[analysis] unreadable model response on attempt ${attempt}: ${text.slice(0, 240)}`);
      if (attempt < ANALYSIS_MAX_ATTEMPTS) continue;
      return { text, failure: lastFailure };
    }

    const body = (await response.json()) as ChatCompletionsResponse;
    const text = body.choices?.map((choice) => extractChoiceText(choice, true)).join("\n").trim() ?? "";
    if (text) {
      if (jsonMode && !parseAnalysis(text)) {
        console.warn(`[analysis] unreadable JSON response on attempt ${attempt}: ${text.slice(0, 240)}`);
        if (attempt < ANALYSIS_MAX_ATTEMPTS) continue;
        return { text: "", failure: lastFailure };
      }
      return { text, failure: null };
    }

    console.warn(`[analysis] unreadable model response on attempt ${attempt}: ${text.slice(0, 240)}`);
  }

  return { text: "", failure: lastFailure };
}

function finalizeAnalysis(text: string, failureSummary?: string | null): MonthlyCostAnalysis {
  const parsed = text ? parseAnalysis(text) : null;
  if (!parsed?.headline || !parsed.summary) {
    return unavailable(failureSummary ?? "The AI analysis returned an unreadable response. The dashboard metrics are still available.");
  }

  return {
    status: "ready",
    headline: parsed.headline,
    summary: parsed.summary,
    primaryDrivers: normalizeDrivers(parsed.primaryDrivers ?? parsed.drivers, 3),
    secondarySignals: normalizeDrivers(parsed.secondarySignals, 3),
    nonMaterialFactors: normalizeDrivers(parsed.nonMaterialFactors, 3),
    caveats: (parsed.caveats ?? []).filter(Boolean).slice(0, 3),
    generatedAt: new Date().toISOString(),
  };
}

export async function getMonthlyCostAnalysisHealth(): Promise<AnalysisHealth> {
  const configured = Boolean(config.analysisBaseUrl && config.analysisModel);
  const lastCheckedAt = new Date().toISOString();

  if (!configured) {
    return {
      configured,
      baseUrl: config.analysisBaseUrl,
      model: config.analysisModel,
      reachable: false,
      modelAvailable: false,
      lastCheckedAt,
      error: "Analysis provider is not configured.",
    };
  }

  try {
    const headers: Record<string, string> = {};
    if (config.analysisApiKey) headers.authorization = `Bearer ${config.analysisApiKey}`;

    const response = await fetch(`${config.analysisBaseUrl}/models`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        configured,
        baseUrl: config.analysisBaseUrl,
        model: config.analysisModel,
        reachable: false,
        modelAvailable: false,
        lastCheckedAt,
        error: `Analysis endpoint returned ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
      };
    }

    const body = (await response.json()) as ModelsResponse;
    const modelAvailable = (body.data ?? []).some((entry) => entry.id === config.analysisModel);
    return {
      configured,
      baseUrl: config.analysisBaseUrl,
      model: config.analysisModel,
      reachable: true,
      modelAvailable,
      lastCheckedAt,
      error: modelAvailable ? undefined : "Configured analysis model is not currently loaded by the provider.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      configured,
      baseUrl: config.analysisBaseUrl,
      model: config.analysisModel,
      reachable: false,
      modelAvailable: false,
      lastCheckedAt,
      error: message,
    };
  }
}

export async function maybeBuildMonthlyCostAnalysis(
  payload: DashboardPayload,
  period: string,
  userId?: string,
  groupId?: string,
): Promise<MonthlyCostAnalysis | undefined> {
  if (period !== "last_month" || userId || groupId) return undefined;
  if (!payload.summary.comparisons?.totalCostUsd) {
    return unavailable("The dashboard does not have a previous-month comparison to analyze yet.");
  }

  const prompt = buildStructuredPrompt(payload);

  try {
    const { text, failure } = await requestAnalysisText(prompt, { mode: "json" });
    return finalizeAnalysis(text, failure);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[analysis] month-over-month analysis failed: ${message}`);
    return unavailable("The AI analysis request could not be completed. The dashboard metrics are still available.");
  }
}

export async function streamMonthlyCostAnalysis(
  payload: DashboardPayload,
  period: string,
  handlers?: MonthlyCostAnalysisStreamHandlers,
  userId?: string,
  groupId?: string,
): Promise<string | undefined> {
  if (period !== "last_month" || userId || groupId) return undefined;
  if (!payload.summary.comparisons?.totalCostUsd) {
    return "The dashboard does not have a previous-month comparison to analyze yet.";
  }

  const prompt = buildStreamingPrompt(payload);

  try {
    const { text } = await requestAnalysisText(prompt, { mode: "text", handlers });
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[analysis] month-over-month analysis failed: ${message}`);
    return "";
  }
}