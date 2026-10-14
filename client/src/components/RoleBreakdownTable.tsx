import { useState } from "react";
import type { RoleBreakdown } from "../types";
import { compactNumber, formatComparisonText, fullNumber, usd } from "../format";
import { BreakdownPieModal } from "./BreakdownPieModal";
import { InfoTip } from "./InfoTip";

interface Props {
  data: RoleBreakdown[];
}

export function RoleBreakdownTable({ data }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.0001);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>
            Usage &amp; Cost By Role <span className="panel-note">{data.length} roles</span>
            <InfoTip text="Usage aggregated by effective role across active users in the selected range. If a user has multiple roles, their activity is counted once under each assigned role, so role totals can exceed organization totals." />
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
              <th>Role</th>
              <th className="num">Users</th>
              <th className="num">Requests</th>
              <th className="num">Output</th>
              <th className="num">Total tokens</th>
              <th className="num">Cost / User</th>
              <th className="num">Trend</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.map((role) => (
              <tr key={role.roleId}>
                <td>
                  <span className="user-name">{role.name}</span>
                </td>
                <td className="num">{fullNumber(role.userCount)}</td>
                <td className="num">{fullNumber(role.requests)}</td>
                <td className="num">{compactNumber(role.outputTokens)}</td>
                <td className="num">{compactNumber(role.totalTokens)}</td>
                <td className="num">{role.userCount > 0 ? usd(role.costUsd / role.userCount) : "—"}</td>
                <td className="num comparison-cell">
                  {role.costComparison && (
                    <span className={`cost-comparison ${role.costComparison.direction === "up" ? "positive" : role.costComparison.direction === "down" ? "negative" : "neutral"}`}>
                      {formatComparisonText(role.costComparison, "currency", undefined, "compact")}
                    </span>
                  )}
                </td>
                <td className="num cost-cell">
                  <span className="cost-bar" style={{ width: `${(role.costUsd / maxCost) * 100}%` }} />
                  <span className="cost-text">{usd(role.costUsd)}</span>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No role data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      {showBreakdown && (
        <BreakdownPieModal
          title="Role Breakdown"
          infoText="Break down the currently visible role table rows by requests, output tokens, total tokens, cost, or cost per user."
          rows={data.map((role) => ({
            key: role.roleId,
            label: role.name,
            requests: role.requests,
            outputTokens: role.outputTokens,
            totalTokens: role.totalTokens,
            costUsd: role.costUsd,
            userCount: role.userCount,
          }))}
          onClose={() => setShowBreakdown(false)}
        />
      )}
    </>
  );
}