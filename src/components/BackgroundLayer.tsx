import React from "react";
import { FlowBackground } from "./FlowBackground";
import { ThreeBackground, type ThreeKind } from "./ThreeBackground";

export const BACKGROUNDS: { value: string; label: string }[] = [
  { value: "none", label: "None (plain)" },
  { value: "flow", label: "Flow lines" },
  { value: "liquid", label: "Liquid" },
  { value: "neon", label: "Neon" },
  { value: "starfield", label: "Starfield" },
  { value: "tunnel", label: "Tunnel" },
  { value: "bokeh", label: "Bokeh lights" },
];

const THREE_KINDS = new Set(["liquid", "neon", "starfield", "tunnel", "bokeh"]);

/** Picks the animated background chosen in Settings. */
export const BackgroundLayer: React.FC<{ kind?: string }> = ({ kind = "flow" }) => {
  if (kind === "none") return null;
  if (THREE_KINDS.has(kind)) return <ThreeBackground key={kind} kind={kind as ThreeKind} />;
  return <FlowBackground />;
};
