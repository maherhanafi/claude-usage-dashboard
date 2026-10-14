import { useMemo, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { getBreakdownColor, getProductColor } from "../chartColors";
import { fullNumber, usd } from "../format";
import type { ConnectorUsageBreakdown, PluginUsageBreakdown, SkillUsageBreakdown } from "../types";
import { ExpandableChartPanel } from "./ExpandableChartPanel";

const MAX_FEATURES = 8;
const NEUTRAL_NODE = "#b9b1a3";

type TabKey = "plugin" | "skill" | "connector";
type MetricKey = "surface" | "users" | "invocations" | "installs" | "listPrice" | "overage" | "read" | "write" | "other";

interface FlowNode {
  name: string;
  fill: string;
  category: "surface" | "feature";
  value: number;
}

interface FlowLink {
  source: number;
  target: number;
  value: number;
  fill: string;
}

interface FlowChartData {
  nodes: FlowNode[];
  links: FlowLink[];
  featureCount: number;
  totalFlow: number;
}

interface MetricOption {
  key: MetricKey;
  label: string;
  description: string;
  totalDescription: string;
  note?: string;
  formatValue: (value: number) => string;
  data: FlowChartData;
}

interface TabOption {
  key: TabKey;
  label: string;
  noun: string;
  metrics: MetricOption[];
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const chunk = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
  const red = Number.parseInt(chunk.slice(0, 2), 16);
  const green = Number.parseInt(chunk.slice(2, 4), 16);
  const blue = Number.parseInt(chunk.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildSurfaceFlowChartData<T>(
  rows: T[],
  getLabel: (row: T) => string,
  surfaceAccessors: Array<{ label: string; value: (row: T) => number }>,
): FlowChartData {
  const ranked = rows
    .map((row) => ({
      label: getLabel(row),
      values: surfaceAccessors.map((surface) => ({ label: surface.label, value: Math.max(0, surface.value(row)) })),
    }))
    .map((row) => ({
      ...row,
      total: row.values.reduce((sum, part) => sum + part.value, 0),
    }))
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, undefined, { sensitivity: "base" }))
    .slice(0, MAX_FEATURES);

  if (ranked.length === 0) return { nodes: [], links: [], featureCount: 0, totalFlow: 0 };

  const surfaces = surfaceAccessors
    .map((surface) => ({ label: surface.label, total: ranked.reduce((sum, row) => sum + (row.values.find((part) => part.label === surface.label)?.value ?? 0), 0) }))
    .filter((surface) => surface.total > 0);

  const nodes: FlowNode[] = [
    ...surfaces.map((surface) => ({
      name: surface.label,
      fill: getProductColor(surface.label),
      category: "surface" as const,
      value: surface.total,
    })),
    ...ranked.map((row) => ({
      name: row.label,
      fill: getBreakdownColor(row.label),
      category: "feature" as const,
      value: row.total,
    })),
  ];

  const surfaceIndex = new Map(surfaces.map((surface, index) => [surface.label, index]));
  const featureOffset = surfaces.length;
  const links: FlowLink[] = [];

  ranked.forEach((row, rowIndex) => {
    row.values.forEach((part) => {
      if (part.value <= 0) return;
      const source = surfaceIndex.get(part.label);
      if (source == null) return;
      links.push({
        source,
        target: featureOffset + rowIndex,
        value: part.value,
        fill: hexToRgba(getProductColor(part.label), 0.3),
      });
    });
  });

  return {
    nodes,
    links,
    featureCount: ranked.length,
    totalFlow: links.reduce((sum, link) => sum + link.value, 0),
  };
}

function buildAggregateFlowChartData<T>(
  rows: T[],
  getLabel: (row: T) => string,
  getValue: (row: T) => number,
  sourceLabel: string,
  sourceColor = NEUTRAL_NODE,
): FlowChartData {
  const ranked = rows
    .map((row) => ({ label: getLabel(row), value: Math.max(0, getValue(row)) }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, undefined, { sensitivity: "base" }))
    .slice(0, MAX_FEATURES);

  if (ranked.length === 0) return { nodes: [], links: [], featureCount: 0, totalFlow: 0 };

  const totalFlow = ranked.reduce((sum, row) => sum + row.value, 0);
  const nodes: FlowNode[] = [
    { name: sourceLabel, fill: sourceColor, category: "surface", value: totalFlow },
    ...ranked.map((row) => ({ name: row.label, fill: getBreakdownColor(row.label), category: "feature" as const, value: row.value })),
  ];
  const links: FlowLink[] = ranked.map((row, index) => ({
    source: 0,
    target: index + 1,
    value: row.value,
    fill: hexToRgba(sourceColor, 0.3),
  }));

  return { nodes, links, featureCount: ranked.length, totalFlow };
}

function SankeyTooltip({
  active,
  payload,
  nodes,
  formatValue,
}: {
  active?: boolean;
  payload?: any[];
  nodes: FlowNode[];
  formatValue: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  const datum = payload[0]?.payload;
  if (!datum) return null;

  const sourceNode = typeof datum.source === "number" ? nodes[datum.source] : undefined;
  const targetNode = typeof datum.target === "number" ? nodes[datum.target] : undefined;
  const label = sourceNode && targetNode ? `${sourceNode.name} → ${targetNode.name}` : datum.name;
  const value = typeof datum.value === "number" ? datum.value : 0;

  return (
    <div className="sankey-tooltip">
      <div className="sankey-tooltip-label">{label}</div>
      <div className="sankey-tooltip-value">{formatValue(value)}</div>
    </div>
  );
}

function SankeyNode(props: any) {
  const { x, y, width, height, payload, formatValue } = props;
  const isSurface = payload.category === "surface";
  const labelX = isSurface ? x + width + 10 : x - 10;
  const textAnchor = isSurface ? "start" : "end";
  const label = payload.name.length > 22 ? `${payload.name.slice(0, 22)}…` : payload.name;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={payload.fill} fillOpacity={0.95} />
      <text x={labelX} y={y + height / 2 - 2} textAnchor={textAnchor} fontSize={12.5} fontWeight={600} fill="#1a1814">
        {label}
      </text>
      <text x={labelX} y={y + height / 2 + 14} textAnchor={textAnchor} fontSize={12} fill="#76736a">
        {formatValue(payload.value)}
      </text>
    </g>
  );
}

function SankeyLink(props: any) {
  const { sourceX, sourceY, targetX, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
  const path = `M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  return (
    <path d={path} fill="none" stroke={payload.fill} strokeWidth={Math.max(1, linkWidth)} strokeOpacity={0.95} />
  );
}

export function FeatureUsageSankey({
  pluginUsage,
  skillUsage,
  connectorUsage,
}: {
  pluginUsage: PluginUsageBreakdown[];
  skillUsage: SkillUsageBreakdown[];
  connectorUsage: ConnectorUsageBreakdown[];
}) {
  const tabs = useMemo<TabOption[]>(() => {
    const pluginMetrics = ([
      {
        key: "surface",
        label: "Surface Activity",
        description: "surface-attributed session counts",
        totalDescription: "total surface-attributed sessions",
        formatValue: fullNumber,
        data: buildSurfaceFlowChartData(pluginUsage, (row) => row.pluginName, [
          { label: "Claude Code", value: (row) => row.claudeCodeSessionCount ?? 0 },
          { label: "Cowork", value: (row) => row.coworkSessionCount ?? 0 },
        ]),
      },
      {
        key: "users",
        label: "Users",
        description: "per-feature distinct user counts",
        totalDescription: "sum of per-feature distinct user counts",
        note: "Users can appear in multiple features, so totals may exceed organization-wide distinct users.",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(pluginUsage, (row) => row.pluginName, (row) => row.distinctUserCount, "Users"),
      },
      {
        key: "invocations",
        label: "Invocations",
        description: "plugin invocation counts",
        totalDescription: "total invocations",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(pluginUsage, (row) => row.pluginName, (row) => row.invocationCount, "Invocations"),
      },
      {
        key: "installs",
        label: "Installs",
        description: "plugin install counts",
        totalDescription: "total installs",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(pluginUsage, (row) => row.pluginName, (row) => row.installCount ?? 0, "Installs"),
      },
    ] as MetricOption[]).filter((metric) => metric.data.links.length > 0);

    const skillMetrics = ([
      {
        key: "surface",
        label: "Surface Activity",
        description: "surface-attributed conversation or session counts",
        totalDescription: "total surface-attributed events",
        formatValue: fullNumber,
        data: buildSurfaceFlowChartData(skillUsage, (row) => row.displayName ?? row.skillName, [
          { label: "Claude.ai Chat", value: (row) => row.chatConversationCount ?? 0 },
          { label: "Claude Code", value: (row) => row.claudeCodeSessionCount ?? 0 },
          { label: "Cowork", value: (row) => row.coworkSessionCount ?? 0 },
        ]),
      },
      {
        key: "users",
        label: "Users",
        description: "per-feature distinct user counts",
        totalDescription: "sum of per-feature distinct user counts",
        note: "Users can appear in multiple skills, so totals may exceed organization-wide distinct users.",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(skillUsage, (row) => row.displayName ?? row.skillName, (row) => row.distinctUserCount, "Users"),
      },
      {
        key: "invocations",
        label: "Invocations",
        description: "skill invocation counts",
        totalDescription: "total invocations",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(skillUsage, (row) => row.displayName ?? row.skillName, (row) => row.invocationCount ?? 0, "Invocations"),
      },
      {
        key: "listPrice",
        label: "List Price",
        description: "attributed list-price spend for each skill",
        totalDescription: "total attributed list-price spend",
        formatValue: usd,
        data: buildAggregateFlowChartData(
          skillUsage,
          (row) => row.displayName ?? row.skillName,
          (row) => row.attributedListPriceUsd ?? 0,
          "List Price",
        ),
      },
      {
        key: "overage",
        label: "Est. Overage",
        description: "estimated overage spend attributed to each skill",
        totalDescription: "total estimated overage spend",
        formatValue: usd,
        data: buildAggregateFlowChartData(skillUsage, (row) => row.displayName ?? row.skillName, (row) => row.estimatedOverageSpendUsd ?? 0, "Est. Overage"),
      },
    ] as MetricOption[]).filter((metric) => metric.data.links.length > 0);

    const connectorMetrics = ([
      {
        key: "surface",
        label: "Surface Activity",
        description: "surface-attributed conversation or session counts",
        totalDescription: "total surface-attributed events",
        formatValue: fullNumber,
        data: buildSurfaceFlowChartData(connectorUsage, (row) => row.displayName ?? row.connectorName, [
          { label: "Claude.ai Chat", value: (row) => row.chatConversationCount ?? 0 },
          { label: "Claude Code", value: (row) => row.claudeCodeSessionCount ?? 0 },
          { label: "Cowork", value: (row) => row.coworkSessionCount ?? 0 },
        ]),
      },
      {
        key: "users",
        label: "Users",
        description: "per-feature distinct user counts",
        totalDescription: "sum of per-feature distinct user counts",
        note: "Users can appear in multiple connectors, so totals may exceed organization-wide distinct users.",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(connectorUsage, (row) => row.displayName ?? row.connectorName, (row) => row.distinctUserCount, "Users"),
      },
      {
        key: "read",
        label: "Read Calls",
        description: "connector read call counts",
        totalDescription: "total read calls",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(connectorUsage, (row) => row.displayName ?? row.connectorName, (row) => row.readCallCount ?? 0, "Read Calls"),
      },
      {
        key: "write",
        label: "Write Calls",
        description: "connector write call counts",
        totalDescription: "total write calls",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(connectorUsage, (row) => row.displayName ?? row.connectorName, (row) => row.writeCallCount ?? 0, "Write Calls"),
      },
      {
        key: "other",
        label: "Other Calls",
        description: "connector unclassified call counts",
        totalDescription: "total other calls",
        formatValue: fullNumber,
        data: buildAggregateFlowChartData(connectorUsage, (row) => row.displayName ?? row.connectorName, (row) => row.unclassifiedCallCount ?? 0, "Other Calls"),
      },
    ] as MetricOption[]).filter((metric) => metric.data.links.length > 0);

    const allTabs: TabOption[] = [
      { key: "plugin", label: "By Plugin", noun: "plugins", metrics: pluginMetrics },
      { key: "skill", label: "By Skill", noun: "skills", metrics: skillMetrics },
      { key: "connector", label: "By Connector", noun: "connectors", metrics: connectorMetrics },
    ];

    return allTabs.filter((tab) => tab.metrics.length > 0);
  }, [connectorUsage, pluginUsage, skillUsage]);

  const [selectedTab, setSelectedTab] = useState<TabKey>(tabs[0]?.key ?? "skill");
  const [selectedMetricByTab, setSelectedMetricByTab] = useState<Record<TabKey, MetricKey>>({
    plugin: "surface",
    skill: "surface",
    connector: "surface",
  });
  const activeTab = tabs.find((tab) => tab.key === selectedTab) ?? tabs[0];
  const activeMetric = activeTab?.metrics.find((metric) => metric.key === selectedMetricByTab[activeTab.key]) ?? activeTab?.metrics[0];

  if (!activeTab || !activeMetric) return null;

  const renderNode = (props: any) => <SankeyNode {...props} formatValue={activeMetric.formatValue} />;

  return (
    <ExpandableChartPanel
      title="Feature Usage Flows"
      infoText="Flow view of where plugin, skill, and connector usage happens. Surface Activity uses attributed conversation or session counts by Claude surface. Other metrics use direct per-feature aggregates, which are shown from a single source node to avoid inventing a surface split that the API does not provide."
    >
      {(expanded) => (
        <div className={`chart-frame feature-sankey-frame${expanded ? " chart-frame-expanded" : ""}`}>
          <div className="feature-sankey-controls">
            <div className="breakdown-tabs feature-sankey-tabs">
              {tabs.map((tab) => (
                <button key={tab.key} className={tab.key === activeTab.key ? "active" : ""} onClick={() => setSelectedTab(tab.key)}>
                  {tab.label}
                </button>
              ))}
            </div>
            {activeTab.metrics.length > 1 && (
              <div className="breakdown-tabs feature-sankey-tabs feature-sankey-metrics">
                {activeTab.metrics.map((metric) => (
                  <button
                    key={metric.key}
                    className={metric.key === activeMetric.key ? "active" : ""}
                    onClick={() => setSelectedMetricByTab((current) => ({ ...current, [activeTab.key]: metric.key }))}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="feature-sankey-meta">
            <span>Showing top {tabWord(activeMetric.data.featureCount, activeTab.noun)} by {activeMetric.description}.</span>
            <span>
              {activeMetric.formatValue(activeMetric.data.totalFlow)} {activeMetric.totalDescription}
            </span>
          </div>
          <div className={`feature-sankey-note${activeMetric.note ? "" : " feature-sankey-note-empty"}`}>{activeMetric.note ?? ""}</div>
          <div className="feature-sankey-chart">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={activeMetric.data}
                nodePadding={expanded ? 22 : 18}
                nodeWidth={14}
                margin={{ top: 18, right: 120, bottom: 10, left: 120 }}
                iterations={32}
                linkCurvature={0.46}
                node={renderNode}
                link={SankeyLink}
              >
                <Tooltip content={<SankeyTooltip nodes={activeMetric.data.nodes} formatValue={activeMetric.formatValue} />} />
              </Sankey>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </ExpandableChartPanel>
  );
}

function tabWord(count: number, noun: string): string {
  return count >= MAX_FEATURES ? `${MAX_FEATURES} ${noun}` : `${count} ${noun}`;
}