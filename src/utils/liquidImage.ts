const KEY = "flowget_liquid_image";
const IMAGE_URL = /\.(png|jpe?g|gif|webp|bmp|avif|svg)(\?|#|$)/i;
export const LIQUID_IMAGE_EVENT = "flowget-liquid-image";

/** The picture the user chose for the liquid background (a small data URL), or null for the built-in one. */
export function getLiquidImage(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLiquidImage(dataUrl: string | null): void {
  try {
    if (dataUrl) localStorage.setItem(KEY, dataUrl);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: the built-in picture is used */
  }
  window.dispatchEvent(new Event(LIQUID_IMAGE_EVENT));
}

/** Shrink a chosen image to at most 1024px and re-encode it, so it is small enough to keep. */
export function fileToLiquidDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file is not a readable image."));
    };
    img.src = url;
  });
}

/**
 * Built-in picture: smooth, flowing ribbons of purple, teal, pink and blue on a deep base.
 * Colours stay saturated (nothing blows out to white) so the liquid surface looks rich.
 */
export function makeDefaultLiquidTexture(): string {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  const base = g.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#1b1245");
  base.addColorStop(0.5, "#3a1670");
  base.addColorStop(1, "#0c3a52");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  const colors = ["#8b5cf6", "#2dd4bf", "#ec4899", "#3b82f6", "#a855f7", "#14b8a6", "#f472b6", "#60a5fa"];

  // broad flowing ribbons (normal blending keeps the colours deep)
  g.lineCap = "round";
  for (let i = 0; i < 18; i++) {
    g.filter = `blur(${rnd(10, 24)}px)`;
    g.strokeStyle = colors[i % colors.length];
    g.globalAlpha = rnd(0.5, 0.85);
    g.lineWidth = rnd(70, 190);
    g.beginPath();
    g.moveTo(rnd(-150, size + 150), rnd(-150, size + 150));
    g.bezierCurveTo(rnd(0, size), rnd(0, size), rnd(0, size), rnd(0, size), rnd(-150, size + 150), rnd(-150, size + 150));
    g.stroke();
  }

  // a few bright soft glows, blended with "screen" so they brighten without clipping to white
  g.globalCompositeOperation = "screen";
  for (let i = 0; i < 7; i++) {
    const x = rnd(0, size), y = rnd(0, size), r = rnd(120, 280);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colors[(i * 2) % colors.length] + "aa");
    grad.addColorStop(1, "#00000000");
    g.filter = "none";
    g.globalAlpha = 0.7;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // a few thin, soft threads for fine detail
  g.globalCompositeOperation = "source-over";
  for (let i = 0; i < 12; i++) {
    g.filter = "blur(1.5px)";
    g.strokeStyle = colors[(i * 3) % colors.length];
    g.globalAlpha = rnd(0.3, 0.5);
    g.lineWidth = rnd(2, 4);
    g.beginPath();
    g.moveTo(rnd(0, size), rnd(0, size));
    g.bezierCurveTo(rnd(0, size), rnd(0, size), rnd(0, size), rnd(0, size), rnd(0, size), rnd(0, size));
    g.stroke();
  }

  // fine grain so the shine does not look flat
  g.filter = "none";
  g.globalAlpha = 0.05;
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000";
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  g.globalAlpha = 1;
  return c.toDataURL("image/jpeg", 0.92);
}

export type DropResult = { dataUrl: string } | { error: string } | null;

/** The web address carried by a drag, if any. */
export function droppedUrl(dt: DataTransfer): string {
  const raw = (dt.getData("text/uri-list") || dt.getData("text/plain")).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const html = dt.getData("text/html");
  const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return m ? m[1] : "";
}

/** True when the drag is a picture: an image file, or (strict) a link that ends in an image extension. */
export function isImageDrop(dt: DataTransfer): boolean {
  if (Array.from(dt.files).some((f) => f.type.startsWith("image/"))) return true;
  const url = droppedUrl(dt);
  return !!url && IMAGE_URL.test(url);
}

/**
 * Turn a dropped picture into the small data URL used by the liquid background.
 * Returns null when nothing was dropped that looks like a picture (nothing is downloaded either way).
 * `anyLink` also tries links that do not end in an image extension (used inside Settings).
 */
export async function liquidImageFromDrop(dt: DataTransfer, anyLink = false): Promise<DropResult> {
  const file = Array.from(dt.files).find((f) => f.type.startsWith("image/"));
  try {
    if (file) return { dataUrl: await fileToLiquidDataUrl(file) };
    const url = droppedUrl(dt);
    if (url && (anyLink || IMAGE_URL.test(url))) {
      const blob = await (await fetch(url)).blob();
      if (!blob.type.startsWith("image/")) throw new Error("not an image");
      return { dataUrl: await fileToLiquidDataUrl(new File([blob], "dropped-image", { type: blob.type })) };
    }
  } catch (e) {
    const web = !file;
    return {
      error: web
        ? "Could not read that picture from the web page. Save it first, then drop the file."
        : (e as Error).message,
    };
  }
  if (dt.files.length > 0) return { error: "Only image files can be dropped here." };
  return null;
}
