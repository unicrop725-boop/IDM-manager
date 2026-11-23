import React, { useMemo } from "react";
import type { DownloadInfo } from "../types";
import { formatBytes, isUnbounded } from "../format";

const TICKS = 60;
const COLS = 64;
const ROWS = 9;
const PALETTE = ["#FED24F", "#B2D959", "#7EC151"];

/** Cheap stable pseudo-random number in [0, 1) for an index. */
const rand = (i: number, salt = 0) => {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Teal at the start of the filled part, fading to green at its head. */
const tickColor = (i: number, lit: number) => {
  const t = lit <= 1 ? 1 : i / (lit - 1);
  const hue = 172 - t * 34; // 172 (teal) -> 138 (green)
  const light = 58 + t * 12;
  return `hsl(${hue.toFixed(0)} 72% ${light.toFixed(0)}%)`;
};

interface TickProps {
  pct: number;
  ticks?: number;
  /** animate (wave + pulsing head) while data is flowing */
  active?: boolean;
  done?: boolean;
  size?: "md" | "sm";
}

/** Progress as a row of vertical ticks (used in the dialog and in the table rows). */
export const TickProgress: React.FC<TickProps> = ({ pct, ticks = TICKS, active = false, done = false, size = "md" }) => {
  const lit = done ? ticks : Math.floor((Math.max(0, Math.min(100, pct)) / 100) * ticks);
  return (
    <div
      className={`dl-ticks ${size === "sm" ? "dl-ticks--sm" : ""} ${active ? "dl-viz--active" : ""}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: ticks }, (_, i) => (
        <span
          key={i}
          className={`dl-tick ${i < lit ? "dl-tick--on" : ""} ${i === lit - 1 && !done ? "dl-tick--head" : ""}`}
          style={
            { ["--i" as string]: i, ...(i < lit ? { ["--tc" as string]: tickColor(i, lit) } : {}) } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

interface Props {
  d: DownloadInfo;
  pct: number;
  /** true while bytes are actually flowing (drives all the animation) */
  active: boolean;
}

/**
 * Live picture of a download: a bar of ticks (overall progress), one pill per connection and a
 * grid of dots where every dot is a piece of the file that lights up once it has been written.
 */
export const DownloadViz: React.FC<Props> = ({ d, pct, active }) => {
  const total = d.totalSize && d.totalSize > 0 ? d.totalSize : 0;
  const done = d.state === "completed";

  // ---- dot grid: which pieces of the file are on disk ----
  const cells = useMemo(() => {
    const n = COLS * ROWS;
    const seg = d.segments.filter((s) => s.downloaded >= 0);
    return Array.from({ length: n }, (_, i) => {
      const brightness = 0.6 + rand(i) * 0.4;
      const delay = rand(i, 3) * 1.4;
      if (done) return { state: "on" as const, brightness, delay };
      if (!total) return { state: "off" as const, brightness, delay };
      const cell = total / n;
      const mid = (i + 0.5) * cell;
      let state: "on" | "fresh" | "next" | "off" = "off";
      if (seg.length === 0) {
        const edge = (pct / 100) * total;
        state = mid < edge ? "on" : mid - edge < cell * 2.5 ? "next" : "off";
      } else {
        const s = seg.find((x) => mid >= x.start && (isUnbounded(x.end) || mid <= x.end));
        if (s) {
          const edge = s.start + s.downloaded;
          const span = isUnbounded(s.end) ? total - s.start : s.end - s.start + 1;
          const finished = s.downloaded >= span;
          if (mid < edge) state = !finished && edge - mid < cell * 3 ? "fresh" : "on";
          else if (!finished && mid - edge < cell * 2.5) state = "next";
        }
      }
      return { state, brightness, delay };
    });
  }, [d.segments, total, pct, done]);

  return (
    <div className={`dl-viz space-y-4 ${active ? "dl-viz--active" : ""} ${done ? "dl-viz--complete" : ""}`}>
      {/* Overall progress: a row of ticks */}
      <TickProgress pct={pct} active={active} done={done} />

      {/* One pill per connection */}
      <div className="dl-pills">
        {d.segments.length === 0 ? (
          <div className="dl-pill dl-pill--empty">Preparing connections...</div>
        ) : (
          d.segments.map((s, idx) => {
            const span = isUnbounded(s.end) ? Math.max(1, total - s.start) : Math.max(1, s.end - s.start + 1);
            const got = Math.min(span, s.downloaded);
            const p = (got / span) * 100;
            const color = PALETTE[idx % PALETTE.length];
            const finished = got >= span;
            return (
              <div
                key={idx}
                className="dl-pill"
                style={
                  { flex: `${span} 1 0`, ["--c" as string]: color, ["--pi" as string]: idx, ["--pn" as string]: d.segments.length } as React.CSSProperties
                }
                title={`Connection #${s.index + 1}: ${formatBytes(got)} / ${formatBytes(span)} (${p.toFixed(1)}%)`}
              >
                <div className={`dl-pill-fill ${active && !finished ? "dl-pill-fill--live" : ""}`} style={{ width: `${p}%` }} />
              </div>
            );
          })
        )}
      </div>

      {/* Dot map of the file */}
      <div className="dl-dots" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {cells.map((c, i) => (
          <span
            key={i}
            className={`dl-dot dl-dot--${c.state}`}
            style={
              { ["--b" as string]: c.brightness, ["--d" as string]: `${c.delay}s`, ["--col" as string]: i % COLS } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
};
