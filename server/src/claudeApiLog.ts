interface QueryParams {
  [key: string]: string | string[] | number | undefined;
}

function sanitizeValue(value: string | number): string | number {
  if (typeof value === "number") return value;
  if (value.length > 80) return `${value.slice(0, 24)}…${value.slice(-12)}`;
  return value;
}

function summarizeParams(params: QueryParams): string {
  const compact = Object.entries(params)
    .filter((entry): entry is [string, string | string[] | number] => entry[1] !== undefined)
    .map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.map((item) => sanitizeValue(item))];
      return [key, sanitizeValue(value)];
    });
  return compact.length > 0 ? JSON.stringify(Object.fromEntries(compact)) : "{}";
}

export function logClaudeApiStart(api: "analytics" | "admin", path: string, params: QueryParams): number {
  const startedAt = Date.now();
  console.log(`[claude-api:${api}] GET ${path} params=${summarizeParams(params)}`);
  return startedAt;
}

export function logClaudeApiEnd(
  api: "analytics" | "admin",
  path: string,
  params: QueryParams,
  startedAt: number,
  status: number,
): void {
  console.log(
    `[claude-api:${api}] ${status} GET ${path} ${Date.now() - startedAt}ms params=${summarizeParams(params)}`,
  );
}

export function logClaudeApiError(
  api: "analytics" | "admin",
  path: string,
  params: QueryParams,
  startedAt: number,
  status: number,
): void {
  console.warn(
    `[claude-api:${api}] ${status} GET ${path} ${Date.now() - startedAt}ms params=${summarizeParams(params)}`,
  );
}
