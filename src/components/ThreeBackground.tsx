import React, { useEffect, useRef } from "react";
import { getLiquidImage, makeDefaultLiquidTexture, LIQUID_IMAGE_EVENT } from "../utils/liquidImage";

export type ThreeKind = "liquid" | "neon" | "starfield" | "tunnel" | "bokeh";

interface Handle {
  dispose?: () => void;
  loadImage?: (src: string | null) => Promise<void>;
  liquidPlane?: {
    material: { metalness: number; roughness: number };
    uniforms: { displacementScale: { value: number } };
  };
  setRain?: (on: boolean) => void;
}
type Factory = (canvas: HTMLCanvasElement) => Handle;

/** Every effect is loaded on demand, so unused ones never cost anything. */
const LOADERS: Record<ThreeKind, () => Promise<{ default: Factory }>> = {
  liquid: () => import("threejs-components/build/backgrounds/liquid1.min.js"),
  neon: () => import("threejs-components/build/backgrounds/neon1.min.js"),
  starfield: () => import("threejs-components/build/backgrounds/starfield1.min.js"),
  tunnel: () => import("threejs-components/build/backgrounds/tunnel1.min.js"),
  bokeh: () => import("threejs-components/build/backgrounds/bokeh1.min.js"),
};

/** Animated WebGL background (Three.js). Disposed cleanly when switched off or changed. */
export const ThreeBackground: React.FC<{ kind: ThreeKind }> = ({ kind }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let handle: Handle | null = null;
    let cancelled = false;

    LOADERS[kind]()
      .then(async (mod) => {
        if (cancelled) return;
        handle = mod.default(canvas);
        if (kind === "liquid" && handle) {
          await handle.loadImage?.(getLiquidImage() ?? makeDefaultLiquidTexture());
          if (handle.liquidPlane) {
            handle.liquidPlane.material.metalness = 0.75;
            handle.liquidPlane.material.roughness = 0.25;
            handle.liquidPlane.uniforms.displacementScale.value = 5;
          }
          handle.setRain?.(false);
        }
      })
      .catch((e) => console.warn("Background could not start:", e));

    // picking a new picture in Settings updates the liquid straight away
    const onImage = () => {
      if (kind === "liquid" && handle) void handle.loadImage?.(getLiquidImage() ?? makeDefaultLiquidTexture());
    };
    window.addEventListener(LIQUID_IMAGE_EVENT, onImage);

    return () => {
      window.removeEventListener(LIQUID_IMAGE_EVENT, onImage);
      cancelled = true;
      try {
        handle?.dispose?.();
      } catch {
        /* already gone */
      }
    };
  }, [kind]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="bg-layer fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: -1 }}
    />
  );
};
