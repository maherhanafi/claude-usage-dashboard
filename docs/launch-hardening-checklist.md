# Launch Hardening Checklist

This checklist tracks the security and production-readiness work needed before turning this repo into a hosted product.

## Access Control

- [ ] Add authentication in front of `/api/dashboard`, `/api/dashboard-analysis`, `/api/dashboard-analysis/stream`, and `/api/health`.
- [ ] Add tenant scoping to every request path that reads analytics, cached payloads, or persisted snapshots.
- [ ] Restrict `/api/health` to internal admins only, or disable it in production.

## Data Exposure

- [ ] Remove raw upstream `err.body` values from browser and SSE responses.
- [ ] Replace broad `cors()` usage with an allowlist of trusted frontend origins.
- [ ] Remove or reduce sensitive fields from the frontend health payload.
- [ ] Hide Anthropic key metadata, visible scopes, missing scopes, and backend diagnostic details from non-admin users.

## Logging And Secrets

- [ ] Redact or hash `user_ids`, `rbac_group_ids`, and similar identifiers in Claude API request logs.
- [ ] Review all server logs to ensure Anthropic credentials, user emails, and upstream diagnostics are never emitted.
- [ ] Confirm all Anthropic keys are only read server-side and never exposed to the client bundle.

## Persistence And Privacy

- [ ] Decide whether user email addresses are required in persisted dashboard payloads.
- [ ] If email addresses are not required, strip them before persistence and before API responses where possible.
- [ ] Add retention and deletion rules for persisted dashboard snapshots.
- [ ] Document what analytics data is stored, how long it is retained, and who can access it.

## Rate Limiting And Stability

- [ ] Add rate limiting on public API endpoints to protect shared Anthropic org limits.
- [ ] Add monitoring for upstream `429`, `401`, and `403` errors.
- [ ] Verify retry behavior and cache behavior under repeated dashboard refreshes.

## Product Limitations

- [ ] Document unsupported Anthropic deployment modes and plan-specific coverage gaps.
- [ ] Document data freshness limitations for Admin API, Claude Code Analytics, and Claude Enterprise Analytics.
- [ ] Avoid product claims that imply complete real-time visibility across all Claude deployments.

## Release Gate

- [ ] Authentication and tenant isolation reviewed.
- [ ] Health/debug endpoints reviewed for production exposure.
- [ ] Persistence and retention reviewed.
- [ ] Logging redaction reviewed.
- [ ] Customer-facing privacy and limitations docs reviewed.