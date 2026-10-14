import { useState } from "react";
import type { UserBreakdown } from "../types";
import { compactNumber, formatComparisonText, fullNumber, usd } from "../format";
import { downloadUserCsv } from "../export";
import { InfoTip } from "./InfoTip";

const INITIAL = 10;

function costPerMillionTokens(costUsd: number, totalTokens: number): number | null {
  if (totalTokens <= 0) return null;
  return (costUsd / totalTokens) * 1_000_000;
}

type SortKey = "user" | "requests" | "outputTokens" | "totalTokens" | "cacheHitRate" | "costPerMillionTokens" | "costUsd" | "costComparison";
type SortDirection = "asc" | "desc";

const DEFAULT_SORT: { key: SortKey; direction: SortDirection } = {
  key: "costUsd",
  direction: "desc",
};

interface Props {
  data: UserBreakdown[];
  selectedUserId: string | null;
  onSelectUser: (user: { id: string; name: string } | null) => void;
}

export function UserTable({ data, selectedUserId, onSelectUser }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT.direction);
  const normalizedSearch = searchText.trim().toLowerCase();

  const rankByUserId = new Map(
    [...data]
      .sort((a, b) => {
        if (a.costUsd !== b.costUsd) return b.costUsd - a.costUsd;
        const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        if (nameCompare !== 0) return nameCompare;
        return a.userId.localeCompare(b.userId, undefined, { sensitivity: "base" });
      })
      .map((user, index) => [user.userId, index + 1] as const),
  );

  const sortedData = [...data].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;

    if (sortKey === "user") {
      const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (nameCompare !== 0) return nameCompare * direction;
      return (a.email ?? "").localeCompare(b.email ?? "", undefined, { sensitivity: "base" }) * direction;
    }

    if (sortKey === "costComparison") {
      const aValue = a.costComparison?.deltaPercent ?? Number.NEGATIVE_INFINITY;
      const bValue = b.costComparison?.deltaPercent ?? Number.NEGATIVE_INFINITY;
      if (aValue !== bValue) return (aValue - bValue) * direction;
      return (a.costUsd - b.costUsd) * -1;
    }

    if (sortKey === "cacheHitRate") {
      const aValue = a.cacheHitRate ?? Number.NEGATIVE_INFINITY;
      const bValue = b.cacheHitRate ?? Number.NEGATIVE_INFINITY;
      if (aValue !== bValue) return (aValue - bValue) * direction;
      return (a.costUsd - b.costUsd) * -1;
    }

    if (sortKey === "costPerMillionTokens") {
      const aValue = costPerMillionTokens(a.costUsd, a.totalTokens) ?? Number.NEGATIVE_INFINITY;
      const bValue = costPerMillionTokens(b.costUsd, b.totalTokens) ?? Number.NEGATIVE_INFINITY;
      if (aValue !== bValue) return (aValue - bValue) * direction;
      return (a.costUsd - b.costUsd) * -1;
    }

    const aValue = a[sortKey];
    const bValue = b[sortKey];
    if (aValue !== bValue) return (aValue - bValue) * direction;
    return (a.costUsd - b.costUsd) * -1;
  });

  const filteredData = normalizedSearch
    ? sortedData.filter((user) =>
        [
          user.name,
          user.email ?? "",
          user.userId,
          ...(user.groups?.map((group) => group.name) ?? []),
          ...(user.effectiveRoles?.map((assignment) => assignment.name) ?? []),
        ]
          .some((value) => value.toLowerCase().includes(normalizedSearch)),
      )
    : sortedData;

  const maxCost = Math.max(...filteredData.map((d) => d.costUsd), 0.0001);
  const rows = showAll ? filteredData : filteredData.slice(0, INITIAL);

  const toggle = (u: UserBreakdown) =>
    onSelectUser(selectedUserId === u.userId ? null : { id: u.userId, name: u.name });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "user" ? "asc" : "desc");
  };

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  const sortableHeader = (label: string, key: SortKey, numeric = false) => (
    <th className={numeric ? "num" : undefined}>
      <button
        type="button"
        className={`sort-button${numeric ? " sort-button-num" : ""}${sortKey === key ? " active" : ""}`}
        onClick={() => toggleSort(key)}
      >
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {sortIndicator(key)}
        </span>
      </button>
    </th>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          Usage &amp; Cost By User <span className="panel-note">{data.length} active</span>
          <InfoTip text="Per-seat usage over the selected range: requests, output tokens, total tokens, cache hit rate, cost per 1M tokens, and total cost — ranked by cost. Click a row to filter the whole dashboard to that user. Enterprise Analytics source only." />
        </h2>
        <div className="panel-actions">
          <input
            type="search"
            className="panel-search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search users"
            aria-label="Search users"
          />
          <button className="panel-action" onClick={() => downloadUserCsv(data)}>
            Download CSV
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="rank-col">Rank</th>
              {sortableHeader("User", "user")}
              {sortableHeader("Requests", "requests", true)}
              {sortableHeader("Output", "outputTokens", true)}
              {sortableHeader("Total tokens", "totalTokens", true)}
              {sortableHeader("Cache hit", "cacheHitRate", true)}
              {sortableHeader("Cost / 1M", "costPerMillionTokens", true)}
              {sortableHeader("Trend", "costComparison", true)}
              {sortableHeader("Cost", "costUsd", true)}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr
                key={u.userId}
                className={`row-clickable${selectedUserId === u.userId ? " row-selected" : ""}`}
                onClick={() => toggle(u)}
                title="Filter dashboard to this user"
              >
                <td className="rank-col">{rankByUserId.get(u.userId)}</td>
                <td>
                  <span className="user-name">
                    {u.name}
                    {u.deleted && <span className="tag-deleted">deleted</span>}
                  </span>
                </td>
                <td className="num">{fullNumber(u.requests)}</td>
                <td className="num">{compactNumber(u.outputTokens)}</td>
                <td className="num">{compactNumber(u.totalTokens)}</td>
                <td className="num">{u.cacheHitRate != null ? `${u.cacheHitRate.toFixed(1)}%` : "—"}</td>
                <td className="num">{costPerMillionTokens(u.costUsd, u.totalTokens) != null ? usd(costPerMillionTokens(u.costUsd, u.totalTokens)!) : "—"}</td>
                <td className="num comparison-cell">
                  {u.costComparison && (
                    <span
                      className={`cost-comparison ${u.costComparison.direction === "up" ? "positive" : u.costComparison.direction === "down" ? "negative" : "neutral"}`}
                    >
                      {formatComparisonText(u.costComparison, "currency", undefined, "compact")}
                    </span>
                  )}
                </td>
                <td className="num cost-cell">
                  <span className="cost-bar" style={{ width: `${(u.costUsd / maxCost) * 100}%` }} />
                  <span className="cost-text">{usd(u.costUsd)}</span>
                </td>
              </tr>
            ))}
            {filteredData.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  {data.length === 0 ? "No per-user activity in this window." : "No matching users."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filteredData.length > INITIAL && (
        <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show top 10" : `Show all ${filteredData.length}`}
        </button>
      )}
    </div>
  );
}
