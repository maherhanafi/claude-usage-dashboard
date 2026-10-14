import { useState } from "react";
import type { GroupBreakdown } from "../types";
import { compactNumber, formatComparisonText, fullNumber, usd } from "../format";
import { BreakdownPieModal } from "./BreakdownPieModal";
import { InfoTip } from "./InfoTip";

interface DisplayGroupRow extends GroupBreakdown {
  selectable?: boolean;
}

interface Props {
  data: DisplayGroupRow[];
  selectedGroupId: string | null;
  onSelectGroup: (group: { id: string; name: string } | null) => void;
}

export function GroupBreakdownTable({ data, selectedGroupId, onSelectGroup }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.0001);

  const toggle = (group: DisplayGroupRow) => {
    if (group.selectable === false) return;
    onSelectGroup(selectedGroupId === group.groupId ? null : { id: group.groupId, name: group.name });
  };

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>
            Usage &amp; Cost By Group <span className="panel-note">{data.length} groups</span>
            {selectedGroupId && <span className="panel-note">filtered</span>}
            <InfoTip text="Usage aggregated by org group for the selected range. Groups and memberships come from Claude org admin (Organization Settings → People → Groups). Requires both an Analytics key and an Admin key." />
          </h2>
          {data.length > 0 && (
            <div className="panel-actions">
              <button className="panel-action" onClick={() => setShowBreakdown(true)}>
                Breakdown chart
              </button>
            </div>
          )}
        </div>
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Roles</th>
              <th className="num">Members</th>
              <th className="num">Requests</th>
              <th className="num">Output</th>
              <th className="num">Total tokens</th>
              <th className="num">Cost / User</th>
              <th className="num">Trend</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.map((g) => (
              <tr
                key={g.groupId}
                className={g.selectable === false ? undefined : `row-clickable${selectedGroupId === g.groupId ? " row-selected" : ""}`}
                onClick={() => toggle(g)}
                title={g.selectable === false ? undefined : "Filter dashboard to this group"}
              >
                <td>
                  <span className="user-name">{g.name}</span>
                </td>
                <td>{g.roleNames && g.roleNames.length > 0 ? g.roleNames.join(", ") : "—"}</td>
                <td className="num">{fullNumber(g.memberCount)}</td>
                <td className="num">{fullNumber(g.requests)}</td>
                <td className="num">{compactNumber(g.outputTokens)}</td>
                <td className="num">{compactNumber(g.totalTokens)}</td>
                <td className="num">{g.memberCount > 0 ? usd(g.costUsd / g.memberCount) : "—"}</td>
                <td className="num comparison-cell">
                  {g.costComparison && (
                    <span className={`cost-comparison ${g.costComparison.direction === "up" ? "positive" : g.costComparison.direction === "down" ? "negative" : "neutral"}`}>
                      {formatComparisonText(g.costComparison, "currency", undefined, "compact")}
                    </span>
                  )}
                </td>
                <td className="num cost-cell">
                  <span className="cost-bar" style={{ width: `${(g.costUsd / maxCost) * 100}%` }} />
                  <span className="cost-text">{usd(g.costUsd)}</span>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  No group data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      {showBreakdown && (
        <BreakdownPieModal
          title="Group Breakdown"
          infoText="Break down the currently visible group table rows by requests, output tokens, total tokens, cost, or cost per user."
          rows={data.map((group) => ({
            key: group.groupId,
            label: group.name,
            requests: group.requests,
            outputTokens: group.outputTokens,
            totalTokens: group.totalTokens,
            costUsd: group.costUsd,
            userCount: group.memberCount,
          }))}
          onClose={() => setShowBreakdown(false)}
        />
      )}
    </>
  );
}
