import type { UserBreakdown } from "./types";

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? "" : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function buildUserCsv(rows: UserBreakdown[]): string {
  const headers = ["userId", "name", "email", "groups", "effectiveRoles", "deleted", "requests", "outputTokens", "totalTokens", "cacheHitRate", "costUsd"];
  const body = rows.map((row) =>
    headers.map((header) => {
      switch (header) {
        case "userId":
          return escapeCsvValue(row.userId);
        case "name":
          return escapeCsvValue(row.name);
        case "email":
          return escapeCsvValue(row.email);
        case "groups":
          return escapeCsvValue((row.groups ?? []).map((group) => group.name).join("; "));
        case "effectiveRoles":
          return escapeCsvValue((row.effectiveRoles ?? []).map((assignment) => assignment.name).join("; "));
        case "deleted":
          return escapeCsvValue(row.deleted);
        case "requests":
          return escapeCsvValue(row.requests);
        case "outputTokens":
          return escapeCsvValue(row.outputTokens);
        case "totalTokens":
          return escapeCsvValue(row.totalTokens);
        case "cacheHitRate":
          return escapeCsvValue(row.cacheHitRate != null ? row.cacheHitRate : "");
        case "costUsd":
          return escapeCsvValue(row.costUsd);
        default:
          return "";
      }
    }),
  );

  return [[headers.join(",")], ...body.map((row) => row.join(","))].join("\n");
}

export function downloadUserCsv(rows: UserBreakdown[], filename = "usage-cost-by-user.csv") {
  const csv = buildUserCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
