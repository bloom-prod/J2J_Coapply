"use client";

import { useMemo } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

// Layout depth for cycle-safe forward edges; terminal outcomes share a depth.
const ORDER: Record<string, number> = {
  Start: -1,
  "Want to Apply": 0,
  Applied: 1,
  OA: 2,
  "Phone Screen": 3,
  Interview: 4,
  Offer: 5,
  Rejected: 6,
  Ghosted: 6,
  Withdrawn: 6,
};

// [light, dark] node colors.
const COLORS: Record<string, [string, string]> = {
  Start: ["#C9C3D6", "#6E6A82"],
  "Want to Apply": ["#D8B97A", "#8A6D3B"],
  Applied: ["#78AEDE", "#185FA5"],
  OA: ["#E0B46A", "#B98A2F"],
  "Phone Screen": ["#7BB87B", "#3F7D3F"],
  Interview: ["#E07BA0", "#B23A6B"],
  Offer: ["#7BC47B", "#3B6D11"],
  Rejected: ["#D48AA6", "#A32059"],
  Ghosted: ["#B7B3C4", "#6B7280"],
  Withdrawn: ["#B7B3C4", "#6B7280"],
};

function colorFor(id: string, dark: boolean): string {
  const c = COLORS[id];
  if (!c) return dark ? "#7B7B8C" : "#B9B9C6";
  return dark ? c[1] : c[0];
}

function depthOf(id: string): number {
  return ORDER[id] ?? 0;
}

function buildSankeyData(links: SankeyLink[]) {
  const usable = links.filter((l) => l.source !== l.target && l.value > 0 && depthOf(l.target) >= depthOf(l.source));
  if (!usable.length) return null;

  const names: string[] = [];
  const index = new Map<string, number>();
  const ensure = (name: string) => {
    let i = index.get(name);
    if (i === undefined) {
      i = names.length;
      names.push(name);
      index.set(name, i);
    }
    return i;
  };

  // Prefer funnel order so Recharts depths align with status progression.
  [...new Set(usable.flatMap((l) => [l.source, l.target]))]
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
    .forEach(ensure);

  return {
    nodes: names.map((name) => ({ name })),
    links: usable.map((l) => ({
      source: ensure(l.source),
      target: ensure(l.target),
      value: l.value,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SankeyNode(props: any) {
  const { x, y, width, height, payload, dark } = props;
  const name: string = payload?.name ?? "";
  const value: number = payload?.value ?? 0;
  const fill = colorFor(name, dark);
  const labelColor = dark ? "#C9C4D6" : "#5B5564";
  const countColor = dark ? "#8E8AA0" : "#9B94A6";
  const isLeftish = (payload?.depth ?? 0) <= 1;
  const labelX = isLeftish ? x - 6 : x + width + 6;
  const anchor = isLeftish ? "end" : "start";

  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} rx={3} fill={fill} />
      <text x={labelX} y={y + height / 2} textAnchor={anchor} dominantBaseline="central" fontSize={11} fill={labelColor} style={{ pointerEvents: "none" }}>
        {name}
        <tspan fill={countColor}>{`  ${value}`}</tspan>
      </text>
    </g>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SankeyLinkPath(props: any) {
  const {
    sourceX,
    targetX,
    sourceY,
    targetY,
    sourceControlX,
    targetControlX,
    linkWidth,
    payload,
    dark,
  } = props;
  const sourceName: string = payload?.source?.name ?? "";
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={colorFor(sourceName, dark)}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={0.35}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TipProps { active?: boolean; payload?: any[]; dark: boolean }
function SankeyTip({ active, payload, dark }: TipProps) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const name = String(item.name ?? "").replace(" - ", " → ");
  return (
    <div
      style={{
        background: dark ? "#2D2A3C" : "#1a1a1a",
        color: dark ? "#F0EBF8" : "#fff",
        fontSize: 12,
        borderRadius: 6,
        padding: "5px 9px",
        boxShadow: "0 2px 8px rgba(0,0,0,.35)",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 2 }}>{name}</div>
      <div>
        <strong>{item.value}</strong>
      </div>
    </div>
  );
}

export function StatusSankey({ links, dark, height = 360 }: { links: SankeyLink[]; dark: boolean; height?: number }) {
  const data = useMemo(() => buildSankeyData(links), [links]);

  if (!data) {
    return <div style={{ color: "var(--text-light)", fontSize: 13 }}>No status history yet — status changes will show here.</div>;
  }

  return (
    <div style={{ width: "100%", height }} role="img" aria-label="Application status flow">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={data}
          nodeWidth={14}
          nodePadding={22}
          linkCurvature={0.5}
          margin={{ top: 12, right: 110, bottom: 12, left: 110 }}
          node={<SankeyNode dark={dark} />}
          link={<SankeyLinkPath dark={dark} />}
        >
          <Tooltip content={(p) => <SankeyTip {...p} dark={dark} />} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
