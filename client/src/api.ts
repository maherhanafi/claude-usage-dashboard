import type { DashboardPayload, HealthPayload, MonthlyCostAnalysis } from "./types";

const ANALYSIS_REQUEST_TIMEOUT_MS = 30_000;
const ANALYSIS_REQUEST_MAX_ATTEMPTS = 2;
const ANALYSIS_RETRY_DELAY_MS = 750;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableAnalysisError(status: number | null, error: unknown): boolean {
  if (status !== null) return status >= 500 || status === 429;
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof TypeError;
}

interface AnalysisStreamHandlers {
  onDelta?: (delta: string) => void;
  onStatus?: (state: string) => void;
  onResult?: (analysis: MonthlyCostAnalysis | null) => void;
  onError?: (error: Error) => void;
}

export interface ApiError {
  error: string;
  message: string;
  status?: number;
  detail?: string;
}

export async function fetchDashboard(period: string, userId?: string, groupId?: string, force = false): Promise<DashboardPayload> {
  let qs = `period=${encodeURIComponent(period)}`;
  if (userId) qs += `&user=${encodeURIComponent(userId)}`;
  if (groupId) qs += `&group=${encodeURIComponent(groupId)}`;
  if (force) qs += "&force=true";
  const res = await fetch(`/api/dashboard?${qs}`);
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* ignore parse failure */
    }
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return (await res.json()) as DashboardPayload;
}

export async function fetchHealth(): Promise<HealthPayload> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      /* ignore parse failure */
    }
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return (await res.json()) as HealthPayload;
}

export async function fetchDashboardAnalysis(period: string, userId?: string, groupId?: string): Promise<MonthlyCostAnalysis | null> {
  let qs = `period=${encodeURIComponent(period)}`;
  if (userId) qs += `&user=${encodeURIComponent(userId)}`;
  if (groupId) qs += `&group=${encodeURIComponent(groupId)}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= ANALYSIS_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ANALYSIS_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/dashboard-analysis?${qs}`, { signal: controller.signal });
      if (!res.ok) {
        let body: ApiError | undefined;
        try {
          body = (await res.json()) as ApiError;
        } catch {
          /* ignore parse failure */
        }

        const error = new Error(body?.message || `Request failed (${res.status})`);
        if (attempt < ANALYSIS_REQUEST_MAX_ATTEMPTS && isRetryableAnalysisError(res.status, error)) {
          await wait(ANALYSIS_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }

      return (await res.json()) as MonthlyCostAnalysis | null;
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Analysis request timed out."
        : error instanceof Error
          ? error.message
          : String(error);
      lastError = new Error(message);
      if (attempt < ANALYSIS_REQUEST_MAX_ATTEMPTS && isRetryableAnalysisError(null, error)) {
        await wait(ANALYSIS_RETRY_DELAY_MS);
        continue;
      }
      throw lastError;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Analysis request failed.");
}

export function streamDashboardAnalysis(
  period: string,
  handlers: AnalysisStreamHandlers,
  userId?: string,
  groupId?: string,
): () => void {
  let qs = `period=${encodeURIComponent(period)}`;
  if (userId) qs += `&user=${encodeURIComponent(userId)}`;
  if (groupId) qs += `&group=${encodeURIComponent(groupId)}`;

  const source = new EventSource(`/api/dashboard-analysis/stream?${qs}`);
  let settled = false;

  source.addEventListener("status", (event) => {
    if (settled) return;
    const payload = JSON.parse((event as MessageEvent).data) as { state?: string };
    if (payload.state) handlers.onStatus?.(payload.state);
  });

  source.addEventListener("delta", (event) => {
    if (settled) return;
    const payload = JSON.parse((event as MessageEvent).data) as { text?: string };
    if (payload.text) handlers.onDelta?.(payload.text);
  });

  source.addEventListener("heartbeat", () => {
    if (settled) return;
  });

  source.addEventListener("result", (event) => {
    if (settled) return;
    settled = true;
    source.close();
    handlers.onResult?.(JSON.parse((event as MessageEvent).data) as MonthlyCostAnalysis | null);
  });

  source.addEventListener("error", (event) => {
    if (settled) return;
    const messageEvent = event as MessageEvent;
    if (messageEvent.data) {
      try {
        const payload = JSON.parse(messageEvent.data) as { message?: string };
        settled = true;
        source.close();
        handlers.onError?.(new Error(payload.message || "Analysis stream failed."));
        return;
      } catch {
        /* ignore parse failure */
      }
    }
    settled = true;
    source.close();
    handlers.onError?.(new Error("Analysis stream disconnected."));
  });

  return () => {
    settled = true;
    source.close();
  };
}
