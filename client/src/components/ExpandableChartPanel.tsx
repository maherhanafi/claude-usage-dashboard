import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { InfoTip } from "./InfoTip";

function toTitleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

interface Props {
  title: string;
  infoText?: string;
  children: (expanded: boolean) => ReactNode;
}

export function ExpandableChartPanel({ title, infoText, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const normalizedTitle = toTitleCase(title);

  return (
    <>
      <div className="panel">
        <div className="panel-head panel-head-chart">
          <h2>
            {normalizedTitle}
            {infoText && <InfoTip text={infoText} />}
          </h2>
          <button
            type="button"
            className="panel-expand-btn"
            aria-label={`Expand ${normalizedTitle}`}
            title="Expand"
            onClick={() => setExpanded(true)}
          >
            ⤢
          </button>
        </div>
        {children(false)}
      </div>

      {expanded && (
        <Modal onClose={() => setExpanded(false)} maxWidth={1280} fullscreen>
          <div className="panel panel-expanded">
            <div className="panel-head panel-head-chart">
              <h2>
                {normalizedTitle}
                {infoText && <InfoTip text={infoText} />}
              </h2>
            </div>
            {children(true)}
          </div>
        </Modal>
      )}
    </>
  );
}