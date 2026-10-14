import { useState, type ReactNode } from "react";
import { InfoTip } from "./InfoTip";

const INITIAL_ROWS = 10;

interface Column {
  label: string;
  align?: "left" | "right";
}

interface Row {
  key: string;
  cells: ReactNode[];
}

interface Props {
  title: string;
  infoText: string;
  emptyText: string;
  panelNote?: string;
  columns: Column[];
  rows: Row[];
}

export function UsageInsightsTable({ title, infoText, emptyText, panelNote, columns, rows }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, INITIAL_ROWS);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          {title}
          {panelNote && <span className="panel-note">{panelNote}</span>}
          <InfoTip text={infoText} />
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="empty">{emptyText}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.label} className={column.align === "right" ? "num" : undefined}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key}>
                    {row.cells.map((cell, index) => (
                      <td key={`${row.key}:${index}`} className={columns[index]?.align === "right" ? "num" : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > INITIAL_ROWS && (
            <button className="link-btn" onClick={() => setShowAll((value) => !value)}>
              {showAll ? `Show top ${INITIAL_ROWS}` : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}