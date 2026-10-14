/** Base class for non-2xx responses from any Anthropic API client. */
export class HttpApiError extends Error {
  status: number;
  body: string;
  api: "admin" | "analytics";
  constructor(api: "admin" | "analytics", status: number, body: string) {
    super(`Anthropic ${api} API error ${status}: ${body}`);
    this.name = "HttpApiError";
    this.api = api;
    this.status = status;
    this.body = body;
  }
}
