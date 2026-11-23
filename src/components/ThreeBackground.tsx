import React, { useEffect, useRef } from "react";

export type ThreeKind = "liquid" | "neon" | "starfield" | "tunnel" | "bokeh";

/** Ambient animated canvas background. */
export const ThreeBackground: React.FC<{ kind: ThreeKind }> = ({ kind }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let t = 0;
    const render = () => {
      t += 0.01;
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
      const grad = ctx.createRadialGradient(
        canvas.width / 2 + Math.sin(t) * 100,
        canvas.height / 2 + Math.cos(t) * 100,
        50,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width
      );
      grad.addColorStop(0, "rgba(254, 210, 79, 0.05)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animId);
  }, [kind]);

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none opacity-50" />;
};
