import type { MonthlyCostAnalysis } from "../types";

interface MonthlyCostAnalysisPanelProps {
  analysis: MonthlyCostAnalysis | null;
  loading?: boolean;
  error?: string | null;
  streamingText?: string;
  phase?: "idle" | "started" | "finalizing";
}

export function MonthlyCostAnalysisPanel({
  analysis,
  loading = false,
  error = null,
  streamingText = "",
  phase = "idle",
}: MonthlyCostAnalysisPanelProps) {
  if (loading) {
    return (
      <section className="panel monthly-analysis-panel monthly-analysis-panel-loading">
        <div className="panel-head monthly-analysis-head">
          <div>
            <h2>Why Cost Changed Last Month</h2>
            <p className="monthly-analysis-subtitle">AI-generated narrative based on the stored month-over-month dashboard metrics.</p>
          </div>
          <span className="analysis-status analysis-status-loading">
            <span className="analysis-spinner" aria-hidden="true" />
            {phase === "finalizing" ? "Finalizing" : "Analyzing"}
          </span>
        </div>
        <div className="monthly-analysis-skeleton" aria-hidden="true">
          {streamingText.trim() ? (
            <div className="monthly-analysis-stream">
              <p className="monthly-analysis-eyebrow">Live output</p>
              <pre className="monthly-analysis-stream-text">{streamingText}</pre>
            </div>
          ) : (
            <>
              <div className="monthly-analysis-skeleton-hero" />
              <div className="monthly-analysis-grid">
                <div className="monthly-analysis-skeleton-card" />
                <div className="monthly-analysis-skeleton-card" />
              </div>
              <div className="monthly-analysis-grid">
                <div className="monthly-analysis-skeleton-card short" />
                <div className="monthly-analysis-skeleton-card short" />
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel monthly-analysis-panel">
        <div className="panel-head monthly-analysis-head">
          <div>
            <h2>Why Cost Changed Last Month</h2>
            <p className="monthly-analysis-subtitle">AI-generated narrative based on the stored month-over-month dashboard metrics.</p>
          </div>
          <span className="analysis-status unavailable">Unavailable</span>
        </div>
        <div className="empty monthly-analysis-empty">Analysis failed to load. {error}</div>
      </section>
    );
  }

  if (!analysis) {
    return (
      <section className="panel monthly-analysis-panel">
        <div className="panel-head monthly-analysis-head">
          <div>
            <h2>Why Cost Changed Last Month</h2>
            <p className="monthly-analysis-subtitle">AI-generated narrative based on the stored month-over-month dashboard metrics.</p>
          </div>
          <span className="analysis-status unavailable">Waiting</span>
        </div>
        <div className="empty monthly-analysis-empty">Analysis will appear here when it is available for this range.</div>
      </section>
    );
  }

  const hasSections =
    analysis.primaryDrivers.length > 0 || analysis.secondarySignals.length > 0 || analysis.nonMaterialFactors.length > 0;

  return (
    <section className="panel monthly-analysis-panel">
      <div className="panel-head monthly-analysis-head">
        <div>
          <h2>Why Cost Changed Last Month</h2>
          <p className="monthly-analysis-subtitle">
            AI-generated narrative based on the stored month-over-month dashboard metrics.
          </p>
        </div>
        <span className={`analysis-status ${analysis.status}`}>
          {analysis.status === "ready" ? "AI analysis" : "Unavailable"}
        </span>
      </div>

      <div className="monthly-analysis-hero">
        <p className="monthly-analysis-eyebrow">Headline</p>
        <h3>{analysis.headline}</h3>
        <p className="monthly-analysis-summary">{analysis.summary}</p>
      </div>

      {hasSections ? (
        <div className="monthly-analysis-sections">
          <div className="monthly-analysis-section">
            <p className="monthly-analysis-eyebrow">Top Dollar Drivers</p>
            {analysis.primaryDrivers.length > 0 ? (
              <div className="monthly-analysis-grid">
                {analysis.primaryDrivers.map((driver) => (
                  <article key={driver.title} className="monthly-analysis-driver">
                    <h4>{driver.title}</h4>
                    <p>{driver.detail}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty monthly-analysis-empty">No primary dollar drivers were identified.</div>
            )}
          </div>

          <div className="monthly-analysis-section">
            <p className="monthly-analysis-eyebrow">Secondary Signals</p>
            {analysis.secondarySignals.length > 0 ? (
              <div className="monthly-analysis-grid">
                {analysis.secondarySignals.map((driver) => (
                  <article key={driver.title} className="monthly-analysis-driver monthly-analysis-driver-secondary">
                    <h4>{driver.title}</h4>
                    <p>{driver.detail}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty monthly-analysis-empty">No secondary operational signals were highlighted.</div>
            )}
          </div>

          <div className="monthly-analysis-section">
            <p className="monthly-analysis-eyebrow">What Did Not Materially Matter</p>
            {analysis.nonMaterialFactors.length > 0 ? (
              <div className="monthly-analysis-grid">
                {analysis.nonMaterialFactors.map((driver) => (
                  <article key={driver.title} className="monthly-analysis-driver monthly-analysis-driver-muted">
                    <h4>{driver.title}</h4>
                    <p>{driver.detail}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty monthly-analysis-empty">No low-impact factors were called out.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty monthly-analysis-empty">No driver breakdown is available for this response.</div>
      )}

      {analysis.caveats && analysis.caveats.length > 0 && (
        <div className="monthly-analysis-caveats">
          <p className="monthly-analysis-eyebrow">Caveats</p>
          <ul>
            {analysis.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.status !== "ready" && streamingText.trim() && (
        <div className="monthly-analysis-stream monthly-analysis-stream-fallback">
          <p className="monthly-analysis-eyebrow">Live output</p>
          <pre className="monthly-analysis-stream-text">{streamingText}</pre>
        </div>
      )}

      <p className="monthly-analysis-timestamp">Generated {new Date(analysis.generatedAt).toLocaleString()}</p>
    </section>
  );
}