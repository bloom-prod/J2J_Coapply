"use client";

// TODO: maybe add @nivo/sankey if rendering is still shit

import { useMemo } from "react";

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

// Layout columns follow the funnel order; terminal outcomes share a column.
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

export function StatusSankey({ links, dark, height = 360 }: { links: SankeyLink[]; dark: boolean; height?: number }) {
  const { nodes, paths, width } = useMemo(() => {
    const total = links.reduce((s, l) => s + l.value, 0);
    if (!total) return { nodes: [], paths: [], width: 0 };

    const nodeValue: Record<string, number> = {};
    links.forEach((l) => {
      nodeValue[l.source] = (nodeValue[l.source] || 0) + l.value;
      nodeValue[l.target] = (nodeValue[l.target] || 0) + l.value;
    });
    const ids = Object.keys(nodeValue);

    const col = (id: string) => ORDER[id] ?? 0;
    const colsUsed = [...new Set(ids.map(col))].sort((a, b) => a - b);

    const PAD = 96;
    const W = 720;
    const H = height - 16;
    const NODE_W = 46;
    const GAP = 18;

    const colX = new Map<number, number>();
    if (colsUsed.length === 1) colX.set(colsUsed[0], PAD + (W - PAD) / 2 - NODE_W);
    else colsUsed.forEach((c, i) => colX.set(c, PAD + (i / (colsUsed.length - 1)) * (W - PAD)));

    // Group node ids per column, ordered by value desc.
    const byCol: Record<number, string[]> = {};
    ids.forEach((id) => (byCol[col(id)] = byCol[col(id)] || []).push(id));

    // Per-column vertical layout scaled to fill the full height H.
    const y = new Map<string, number>();
    const nodeH = new Map<string, number>();
    colsUsed.forEach((c) => {
      const list = (byCol[c] || []).sort((a, b) => nodeValue[b] - nodeValue[a]);
      const n = list.length;
      const sum = list.reduce((s, id) => s + Math.max(1, nodeValue[id]), 0);
      const avail = H - (n - 1) * GAP;
      const scale = avail / sum;
      const heights = list.map((id) => Math.max(6, Math.min(Math.max(1, nodeValue[id]) * scale, H * 0.55)));
      const totalH = heights.reduce((s, h) => s + h, 0) + (n - 1) * GAP;
      const startY = Math.max(0, (H - totalH) / 2); // center the column if capped
      let cursor = startY;
      list.forEach((id, i) => {
        nodeH.set(id, heights[i]);
        y.set(id, cursor);
        cursor += heights[i] + GAP;
      });
    });

    const maxLink = Math.max(1, ...links.map((l) => l.value));
    const paths = links.map((l) => {
      const x0 = colX.get(col(l.source))! + NODE_W;
      const x1 = colX.get(col(l.target))!;
      const y0 = y.get(l.source)! + nodeH.get(l.source)! / 2;
      const y1 = y.get(l.target)! + nodeH.get(l.target)! / 2;
      const w = Math.max(2, (l.value / maxLink) * 24);
      const mid = (x0 + x1) / 2;
      return {
        key: `${l.source}>${l.target}`,
        d: `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
        w,
      };
    });

    const nodes = ids.map((id) => ({
      id,
      x: colX.get(col(id))!,
      y: y.get(id)!,
      w: NODE_W,
      h: nodeH.get(id)!,
      value: nodeValue[id],
    }));

    return { nodes, paths, width: W + 24 };
  }, [links, height]);

  if (!width) return <div style={{ color: "var(--text-light)", fontSize: 13 }}>No status history yet — status changes will show here.</div>;

  const colorFor = (id: string) => {
    const c = COLORS[id];
    if (!c) return dark ? "#7B7B8C" : "#B9B9C6";
    return dark ? c[1] : c[0];
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Application status flow">
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill="none" stroke={colorFor(p.key.split(">")[0])} strokeWidth={p.w} strokeOpacity={0.32} />
      ))}
      {nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} fill={colorFor(n.id)} />
          <text x={n.x - 6} y={n.y + n.h / 2 + 4} textAnchor="end" fontSize={11} fill={dark ? "#C9C4D6" : "#5B5564"} style={{ pointerEvents: "none" }}>
            {n.id}
          </text>
          <text x={n.x + n.w + 5} y={n.y + n.h / 2 + 4} fontSize={10} fill={dark ? "#8E8AA0" : "#9B94A6"}>
            {n.value}
          </text>
        </g>
      ))}
    </svg>
  );
}