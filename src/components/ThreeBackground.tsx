import React, { useEffect, useRef } from "react";
import { getLiquidImage, makeDefaultLiquidTexture, LIQUID_IMAGE_EVENT } from "../utils/liquidImage";

export type ThreeKind = "liquid" | "neon" | "starfield" | "tunnel" | "bokeh";

/**
 * The animated backgrounds chosen in Settings, drawn on a plain 2D canvas (no external libraries):
 * Liquid (a flowing picture), Neon (glowing ribbons), Starfield (flying through stars),
 * Tunnel (rings rushing past) and Bokeh (soft drifting lights).
 * Theme aware, paused while the window is hidden, and still (one painted frame) when the user
 * prefers reduced motion.
 */

interface Scene {
  /** 0 = repaint the whole canvas every frame; otherwise how strongly the previous frame is faded (leaves trails). */
  trail: number;
  /** Frame-rate cap (default 60). */
  fps?: number;
  /** Called on start and whenever the window is resized. */
  resize(w: number, h: number): void;
  /** Draw one frame. `t` is seconds since the background started. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, light: boolean): void;
  dispose?(): void;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------------------------
// Starfield: stars fly out of the centre towards the viewer, leaving short streaks.
// ---------------------------------------------------------------------------------------------
function starfield(): Scene {
  interface Star { x: number; y: number; z: number; pz: number; hue: number }
  let stars: Star[] = [];
  const respawn = (s: Star, anywhere: boolean) => {
    s.x = rnd(-1, 1);
    s.y = rnd(-1, 1);
    s.z = anywhere ? rnd(0.05, 1) : 1;
    s.pz = s.z;
    s.hue = rnd(45, 140); // amber to green, like the rest of the app
  };
  return {
    trail: 0.3,
    resize(w, h) {
      const n = clamp(Math.round((w * h) / 5000), 120, 420);
      stars = Array.from({ length: n }, () => {
        const s: Star = { x: 0, y: 0, z: 1, pz: 1, hue: 60 };
        respawn(s, true);
        return s;
      });
    },
    draw(ctx, w, h, _t, light) {
      const cx = w / 2;
      const cy = h / 2;
      const f = Math.max(w, h) * 0.18;
      ctx.lineCap = "round";
      for (const s of stars) {
        s.pz = s.z;
        s.z -= 0.006;
        if (s.z <= 0.02) {
          respawn(s, false);
          continue;
        }
        const x = cx + (s.x / s.z) * f;
        const y = cy + (s.y / s.z) * f;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) {
          respawn(s, false);
          continue;
        }
        const px = cx + (s.x / s.pz) * f;
        const py = cy + (s.y / s.pz) * f;
        const near = 1 - s.z;
        const a = 0.25 + 0.75 * near;
        ctx.lineWidth = 0.4 + near * 2.2;
        ctx.strokeStyle = light ? `hsla(${s.hue}, 45%, 32%, ${a * 0.8})` : `hsla(${s.hue}, 70%, 86%, ${a})`;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Neon: glowing ribbons that swim across the window.
// ---------------------------------------------------------------------------------------------
function neon(): Scene {
  const ribbons = [
    { hue: 75, y: 0.2, amp: 0.1, freq: 1.2, speed: 0.35, phase: 0 },
    { hue: 140, y: 0.38, amp: 0.12, freq: 1.7, speed: -0.28, phase: 1.7 },
    { hue: 48, y: 0.55, amp: 0.09, freq: 1.0, speed: 0.22, phase: 3.1 },
    { hue: 170, y: 0.7, amp: 0.13, freq: 1.5, speed: -0.34, phase: 4.4 },
    { hue: 98, y: 0.86, amp: 0.1, freq: 1.9, speed: 0.3, phase: 5.6 },
  ];
  return {
    trail: 0.16,
    resize() {},
    draw(ctx, w, h, t, light) {
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      ctx.lineJoin = "round";
      for (const r of ribbons) {
        ctx.beginPath();
        for (let x = 0; x <= w + 8; x += 8) {
          const u = x / w;
          const y =
            h * r.y +
            Math.sin(u * Math.PI * 2 * r.freq + t * r.speed + r.phase) * h * r.amp +
            Math.sin(u * Math.PI * 5 + t * r.speed * 1.7 + r.phase * 2) * h * r.amp * 0.35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = light ? `hsla(${r.hue}, 60%, 34%, 0.5)` : `hsla(${r.hue}, 100%, 62%, 0.85)`;
        ctx.shadowColor = `hsl(${r.hue}, 100%, 55%)`;
        ctx.shadowBlur = light ? 0 : 16;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tunnel: hexagonal rings rush towards the viewer while slowly turning.
// ---------------------------------------------------------------------------------------------
function tunnel(): Scene {
  const RINGS = 18;
  const SIDES = 6;
  return {
    trail: 0.34,
    resize() {},
    draw(ctx, w, h, t, light) {
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(w, h) / 2;
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      ctx.lineJoin = "round";
      for (let i = 0; i < RINGS; i++) {
        const d = (i / RINGS + t * 0.12) % 1; // 0 = far away, 1 = right in front of you
        const r = Math.max(3, maxR * Math.pow(d, 2.2));
        const a = Math.sin(d * Math.PI) * 0.65;
        const rot = t * 0.25 + d * 1.2;
        const hue = (60 + d * 80 + t * 6) % 360;
        ctx.beginPath();
        for (let k = 0; k <= SIDES; k++) {
          const ang = rot + (k * Math.PI * 2) / SIDES;
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r * 0.9;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 0.6 + d * 2.6;
        ctx.strokeStyle = light ? `hsla(${hue}, 55%, 34%, ${a * 0.7})` : `hsla(${hue}, 90%, 60%, ${a})`;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Bokeh: soft out-of-focus lights drifting upwards.
// ---------------------------------------------------------------------------------------------
function bokeh(): Scene {
  interface Light { x: number; y: number; r: number; vx: number; vy: number; hue: number; a: number; ph: number }
  let lights: Light[] = [];
  let last = 0;
  const make = (w: number, h: number, anywhere: boolean): Light => ({
    x: rnd(0, w),
    y: anywhere ? rnd(0, h) : h + 90,
    r: rnd(18, 88),
    vx: rnd(-6, 6),
    vy: -rnd(8, 26), // pixels per second, upwards
    hue: rnd(45, 145),
    a: rnd(0.05, 0.17),
    ph: rnd(0, Math.PI * 2),
  });
  return {
    trail: 0,
    fps: 40,
    resize(w, h) {
      const n = clamp(Math.round((w * h) / 45000), 14, 40);
      lights = Array.from({ length: n }, () => make(w, h, true));
    },
    draw(ctx, w, h, t, light) {
      const dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      for (const b of lights) {
        b.x += b.vx * dt + Math.sin(t * 0.3 + b.ph) * 0.15;
        b.y += b.vy * dt;
        if (b.y + b.r < 0) Object.assign(b, make(w, h, false));
        const a = b.a * (0.7 + 0.3 * Math.sin(t * 0.8 + b.ph));
        const l = light ? 45 : 68;
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, `hsla(${b.hue}, 90%, ${l}%, ${a * 1.5})`);
        g.addColorStop(0.7, `hsla(${b.hue}, 90%, ${l}%, ${a})`);
        g.addColorStop(1, `hsla(${b.hue}, 90%, ${l}%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `hsla(${b.hue}, 90%, ${l}%, ${a * 1.3})`;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Liquid: the chosen picture (or the built-in one) rippling like a liquid surface.
// ---------------------------------------------------------------------------------------------
function liquid(): Scene {
  let img: HTMLImageElement | null = null;
  const load = () => {
    const i = new Image();
    i.onload = () => {
      img = i;
    };
    i.src = getLiquidImage() ?? makeDefaultLiquidTexture();
  };
  load();
  window.addEventListener(LIQUID_IMAGE_EVENT, load);
  return {
    trail: 0,
    fps: 30,
    resize() {},
    draw(ctx, w, h, t, light) {
      const im = img;
      if (!im) return;
      const s = Math.max(w / im.width, h / im.height) * 1.2; // cover, with room to drift and ripple
      const dw = im.width * s;
      const dh = im.height * s;
      const ox = (w - dw) / 2 + Math.sin(t * 0.12) * w * 0.04;
      const oy = (h - dh) / 2 + Math.cos(t * 0.09) * h * 0.04;
      const slice = 6;
      for (let y = 0; y < h; y += slice) {
        const dx = Math.sin(y * 0.011 + t * 0.9) * 14 + Math.sin(y * 0.027 - t * 1.3) * 6;
        const sy = clamp((y - oy) / s, 0, im.height - 1);
        const sh = Math.min(slice / s, im.height - sy);
        if (sh <= 0) continue;
        ctx.drawImage(im, 0, sy, im.width, sh, ox + dx, y, dw, slice + 1);
      }
      // Calm it down so the download list stays easy to read.
      ctx.fillStyle = light ? "rgba(248,249,250,0.72)" : "rgba(0,0,0,0.62)";
      ctx.fillRect(0, 0, w, h);
    },
    dispose() {
      window.removeEventListener(LIQUID_IMAGE_EVENT, load);
    },
  };
}

const makeScene = (kind: ThreeKind): Scene => {
  switch (kind) {
    case "starfield":
      return starfield();
    case "neon":
      return neon();
    case "tunnel":
      return tunnel();
    case "bokeh":
      return bokeh();
    case "liquid":
      return liquid();
  }
};

/** Ambient animated canvas background. */
export const ThreeBackground: React.FC<{ kind: ThreeKind }> = ({ kind }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scene = makeScene(kind);
    const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let settle = 0;

    const isLight = () => document.documentElement.classList.contains("light");
    const bg = (a: number) => (isLight() ? `rgba(248,249,250,${a})` : `rgba(0,0,0,${a})`);

    const paint = (t: number) => {
      ctx.fillStyle = bg(scene.trail > 0 ? scene.trail : 1);
      ctx.fillRect(0, 0, w, h);
      scene.draw(ctx, w, h, t, isLight());
    };

    // Reduced motion: no animation, just a settled picture of the scene.
    const paintStill = () => {
      ctx.fillStyle = bg(1);
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) paint(i * 0.05);
    };

    const size = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      scene.resize(w, h);
      ctx.fillStyle = bg(1);
      ctx.fillRect(0, 0, w, h);
      if (reduced) paintStill();
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (now - last < 1000 / (scene.fps ?? 60) - 2) return;
      last = now;
      paint((now - started) / 1000);
    };

    size();
    if (reduced) {
      // The picture for Liquid arrives a moment later: paint again once it has loaded.
      settle = window.setTimeout(paintStill, 600);
    } else {
      raf = requestAnimationFrame(frame);
    }
    window.addEventListener("resize", size);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("resize", size);
      scene.dispose?.();
    };
  }, [kind]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="flow-bg fixed inset-0 w-full h-full pointer-events-none"
      // Neon and Tunnel are drawn with bright, wide strokes: dim them so text on top stays readable.
      style={{ zIndex: -1, opacity: kind === "neon" || kind === "tunnel" ? 0.5 : undefined }}
    />
  );
};
