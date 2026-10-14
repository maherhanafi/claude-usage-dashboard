import type { ApiKeyHealth, ChartType, Granularity, HealthPayload } from "../types";
import { Modal } from "./Modal";

interface Props {
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
  granularity: Granularity;
  onGranularity: (g: Granularity) => void;
  cumulativeChartsEnabled: boolean;
  onCumulativeChartsEnabled: (enabled: boolean) => void;
  monthForecastEnabled: boolean;
  onMonthForecastEnabled: (enabled: boolean) => void;
  showLastMonthAnalysis: boolean;
  onShowLastMonthAnalysis: (enabled: boolean) => void;
  health: HealthPayload | null;
  healthLoading: boolean;
  healthError: string | null;
  onRefreshHealth: () => void;
  onClose: () => void;
}

export function SettingsModal({
  chartType,
  onChartType,
  granularity,
  onGranularity,
  cumulativeChartsEnabled,
  onCumulativeChartsEnabled,
  monthForecastEnabled,
  onMonthForecastEnabled,
  showLastMonthAnalysis,
  onShowLastMonthAnalysis,
  health,
  healthLoading,
  healthError,
  onRefreshHealth,
  onClose,
}: Props) {
  const formatDateTime = (value?: string): string => (value ? new Date(value).toLocaleString() : "Not available");
  const formatAnalysisModel = (value: string): string => {
    const parts = value.split("/");
    return parts[parts.length - 1] || value;
  };
  const renderKeyHealth = (label: string, keyHealth: ApiKeyHealth) => (
    <div className="health-key-card">
      <div className="health-key-head">
        <div>
          <div className="health-item-label">{label}</div>
          <div className="health-item-value">{keyHealth.configured ? keyHealth.keyType : "Not configured"}</div>
        </div>
        <span className={`health-scope-badge ${keyHealth.visibleScopes.length ? "healthy" : "degraded"}`}>
          {keyHealth.visibleScopes.length ? `${keyHealth.visibleScopes.length} visible` : "No scopes visible"}
        </span>
      </div>

      <div className="health-key-meta">{keyHealth.envVar}</div>

      <div className="health-scope-section">
        <div className="health-scope-label">Visible scopes</div>
        <div className="health-scope-list">
          {keyHealth.visibleScopes.length ? (
            keyHealth.visibleScopes.map((scope) => (
              <span key={scope} className="health-scope-pill">
                {scope}
              </span>
            ))
          ) : (
            <span className="health-scope-empty">None detected yet</span>
          )}
        </div>
      </div>

      {keyHealth.missingScopes.length > 0 && (
        <div className="health-scope-section">
          <div className="health-scope-label">Missing scopes reported by Anthropic</div>
          <div className="health-scope-list">
            {keyHealth.missingScopes.map((scope) => (
              <span key={scope} className="health-scope-pill missing">
                {scope}
              </span>
            ))}
          </div>
        </div>
      )}

      {keyHealth.error && <div className="health-key-error">{keyHealth.error}</div>}
    </div>
  );

  return (
    <Modal onClose={onClose} maxWidth={700}>
      <div className="panel">
        <h2>Settings</h2>
        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">Time-series chart type</div>
            <div className="setting-desc">
              How time-series widgets — Token usage over time, Token usage by model over time, and Daily cost — are drawn.
            </div>
          </div>
          <div className="range-toggle">
            <button className={chartType === "bar" ? "active" : ""} onClick={() => onChartType("bar")}>
              Bars
            </button>
            <button className={chartType === "area" ? "active" : ""} onClick={() => onChartType("area")}>
              Lines
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">Aggregation</div>
            <div className="setting-desc">
              How data points are grouped in time-series charts.
            </div>
          </div>
          <div className="range-toggle">
            <button className={granularity === "daily" ? "active" : ""} onClick={() => onGranularity("daily")}>
              Daily
            </button>
            <button className={granularity === "weekly" ? "active" : ""} onClick={() => onGranularity("weekly")}>
              Weekly
            </button>
            <button className={granularity === "monthly" ? "active" : ""} onClick={() => onGranularity("monthly")}>
              Monthly
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">Cumulative time-series</div>
            <div className="setting-desc">
              Show running totals instead of per-period values for Daily Cost, Token Usage Over Time, and Token Usage By Model Over Time.
            </div>
          </div>
          <div className="range-toggle">
            <button className={!cumulativeChartsEnabled ? "active" : ""} onClick={() => onCumulativeChartsEnabled(false)}>
              Off
            </button>
            <button className={cumulativeChartsEnabled ? "active" : ""} onClick={() => onCumulativeChartsEnabled(true)}>
              On
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">Month-end cost forecast</div>
            <div className="setting-desc">
              Show a predicted total cost for the current month using the trailing 30 days of daily cost and weekday-aware seasonality.
            </div>
          </div>
          <div className="range-toggle">
            <button className={!monthForecastEnabled ? "active" : ""} onClick={() => onMonthForecastEnabled(false)}>
              Off
            </button>
            <button className={monthForecastEnabled ? "active" : ""} onClick={() => onMonthForecastEnabled(true)}>
              On
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">Last-month cost analysis</div>
            <div className="setting-desc">
              Show the AI-generated “Why Cost Changed Last Month” section at the top of the page when the selected range is last month.
            </div>
          </div>
          <div className="range-toggle">
            <button className={!showLastMonthAnalysis ? "active" : ""} onClick={() => onShowLastMonthAnalysis(false)}>
              Off
            </button>
            <button className={showLastMonthAnalysis ? "active" : ""} onClick={() => onShowLastMonthAnalysis(true)}>
              On
            </button>
          </div>
        </div>

        <div className="settings-section-divider" />

        <div className="settings-health">
          <div className="settings-health-head">
            <div>
              <div className="setting-label">Backend health</div>
              <div className="setting-desc">Live status from the server health endpoint, including persistence and sync state.</div>
            </div>
            <div className="settings-health-actions">
              {health && (
                <span className={`health-badge ${health.historySyncSummary.healthy ? "healthy" : "degraded"}`}>
                  {health.historySyncSummary.healthy ? "Healthy" : "Degraded"}
                </span>
              )}
              <button className={healthLoading ? "refresh refresh-loading" : "refresh"} onClick={onRefreshHealth} disabled={healthLoading}>
                {healthLoading ? (
                  <>
                    <span className="refresh-spinner" aria-hidden="true" />
                    Loading…
                  </>
                ) : (
                  "↻ Refresh"
                )}
              </button>
            </div>
          </div>

            {healthLoading && !health && <div className="settings-health-note">Loading backend health…</div>}
            {healthError && !healthLoading && <div className="settings-health-error">Couldn&apos;t load health: {healthError}</div>}

            {health && (
            <>
              <div className="health-grid">
                <div className="health-item">
                  <div className="health-item-label">Source</div>
                  <div className="health-item-value">{health.source}</div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Persistence</div>
                  <div className="health-item-value">{health.persistenceEnabled ? "Enabled" : "Disabled"}</div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Sync activity</div>
                  <div className="health-item-value">{health.historySyncSummary.inProgress ? "In progress" : "Idle"}</div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Last successful sync</div>
                  <div className="health-item-value">{formatDateTime(health.historySyncSummary.lastSuccessfulSyncAt)}</div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Current day snapshot</div>
                  <div className="health-item-value">{health.historySyncSummary.lastSnapshotDate ?? "Not available"}</div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Warmup progress</div>
                  <div className="health-item-value">
                    {health.historySyncSummary.warmupFetchedDays} fetched of {health.historySyncSummary.warmupRequestedDays}
                  </div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Analysis endpoint</div>
                  <div className="health-item-value">
                    {health.analysis.reachable ? "Reachable" : "Unreachable"}
                    <br />
                    <span className="health-item-subvalue">{health.analysis.baseUrl}</span>
                  </div>
                </div>
                <div className="health-item">
                  <div className="health-item-label">Analysis model</div>
                  <div className="health-item-value">
                    {health.analysis.modelAvailable ? "Loaded" : "Missing"}
                    <br />
                    <span className="health-item-subvalue">{formatAnalysisModel(health.analysis.model)}</span>
                  </div>
                </div>
              </div>

              {health.historySyncSummary.lastError && (
                <div className="settings-health-error">Last sync error: {health.historySyncSummary.lastError}</div>
              )}

              {health.analysis.error && (
                <div className="settings-health-error">Analysis health: {health.analysis.error}</div>
              )}

              <div className="health-key-grid">
                {renderKeyHealth("Group / RBAC key scopes", health.apiKeys.admin)}
                {renderKeyHealth("Analytics key scopes", health.apiKeys.analytics)}
              </div>

              <details className="health-details">
                <summary>Detailed health payload</summary>
                <pre className="health-json">{JSON.stringify(health, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
