import React, { useEffect, useRef } from "react";

/**
 * Flow-field particle background (port of the p5.js sketch). Thousands of short lines drift along a
 * Perlin-noise field and leave fading trails. Click an empty spot to change the colours.
 * Theme aware (dark = black canvas, light = pale canvas), paused when hidden, off when the user
 * prefers reduced motion.
 */

// ---- 3D Perlin noise (returns 0..1, like p5's noise()) ----
const makeNoise = () => {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, a: number, b: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    const r = lerp(w,
      lerp(v, lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
              lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
              lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1))));
    return (r + 1) / 2;
  };
};

const rand = (a: number, b: number) => Math.floor(a + Math.random() * (b - a));
const deg = (a: number) => (Math.PI / 180) * a;

interface Palette {
  h1: number; h2: number; s1: number; s2: number; l1: number; l2: number;
}
const newPalette = (): Palette => ({
  // Hues stay in the brand range, amber to green.
  h1: rand(20, 90), h2: rand(20, 90), s1: rand(45, 85), s2: rand(45, 85), l1: rand(45, 70), l2: rand(45, 70),
});

interface P {
  x: number; y: number; lx: number; ly: number; vx: number; vy: number; group: 0 | 1;
}

export const FlowBackground: React.FC = () => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noise = makeNoise();
    const NOISE_SCALE = 0.009;
    const TAIL = 82; // like the original: higher = longer trails
    let angle = deg(-90);
    let palette = newPalette();
    let time = 0;
    let width = 0;
    let height = 0;
    let particles: P[] = [];
    let raf = 0;

    const isLight = () => document.documentElement.classList.contains("light");
    const bgColor = (alpha: number) => (isLight() ? `rgba(248,249,250,${alpha})` : `rgba(0,0,0,${alpha})`);

    const size = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      const count = Math.max(300, Math.min(900, Math.round((width * height) / 2400)));
      particles = Array.from({ length: count }, () => {
        const x = Math.random() * width, y = Math.random() * height;
        return { x, y, lx: x, ly: y, vx: 0, vy: 0, group: Math.random() > 0.5 ? 1 : 0 } as P;
      });
      ctx.fillStyle = bgColor(1);
      ctx.fillRect(0, 0, width, height);
    };

    const color = (group: 0 | 1) => {
      const hue = 20 + (group ? palette.h1 : palette.h2);
      const sat = group ? palette.s1 : palette.s2;
      let light = group ? palette.l1 : palette.l2;
      if (isLight()) light = Math.max(22, light - 28); // darker lines on a pale canvas
      return `hsla(${hue}, ${sat}%, ${light}%, ${isLight() ? 0.55 : 0.5})`;
    };

    const frame = () => {
      time++;
      ctx.fillStyle = bgColor((100 - TAIL) / 255);
      ctx.fillRect(0, 0, width, height);

      const paths = [new Path2D(), new Path2D()];
      for (const p of particles) {
        const a = noise(p.x * NOISE_SCALE, p.y * NOISE_SCALE, time * NOISE_SCALE) * Math.PI * 0.5 + angle;
        p.vx += Math.cos(a);
        p.vy += Math.sin(a);
        const max = p.group ? 3 : 2;
        const speed = Math.hypot(p.vx, p.vy);
        const dir = Math.atan2(p.vy, p.vx);
        const m = Math.min(max, speed);
        p.vx = Math.cos(dir) * m;
        p.vy = Math.sin(dir) * m;
        p.x += p.vx;
        p.y += p.vy;

        let wrapped = false;
        if (p.x < 0) { p.x = width; wrapped = true; }
        if (p.x > width) { p.x = 0; wrapped = true; }
        if (p.y < 0) { p.y = height; wrapped = true; }
        if (p.y > height) { p.y = 0; wrapped = true; }
        if (wrapped) { p.lx = p.x; p.ly = p.y; }

        paths[p.group].moveTo(p.x, p.y);
        paths[p.group].lineTo(p.lx, p.ly);
        p.lx = p.x;
        p.ly = p.y;
      }
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = color(0);
      ctx.stroke(paths[0]);
      ctx.strokeStyle = color(1);
      ctx.stroke(paths[1]);
      raf = requestAnimationFrame(frame);
    };

    // clicking an empty spot (not a button / field) changes the colours and the flow direction
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("button, input, select, textarea, a, label, [role='button'], [role='option']")) return;
      palette = newPalette();
      angle += deg(60) * (Math.random() > 0.5 ? 1 : -1);
    };

    const onTheme = () => {
      ctx.fillStyle = bgColor(1);
      ctx.fillRect(0, 0, width, height);
    };
    const observer = new MutationObserver(onTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    size();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", size);
    window.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", size);
      window.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="flow-bg fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: -1 }}
    />
  );
};
