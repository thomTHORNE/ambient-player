/**
 * Accent colour from artwork.
 *
 * Samples the current channel's thumbnail, finds its most prevalent vivid hue
 * and returns a version of it that reads well on the dark panels. Returns null
 * when the artwork is too dark, too grey or has no colour that stands out, so
 * the caller can fall back to amber.
 */

/** Used when there is no artwork or it has no usable colour. */
export const FALLBACK_ACCENT = '#FFB24A';

/** The darkest surface accent text sits on (panel over the backdrop). */
const PANEL_RGB: [number, number, number] = [0x16, 0x1b, 0x1c];
const MIN_CONTRAST = 4.5;

// Fine enough that thin coloured lettering (logos on black) survives the downscale.
const SAMPLE_W = 96;
const SAMPLE_H = 54;
const HUE_BINS = 36; // 10° each

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHue(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Returns a hex accent colour, or null when the image has no usable colour
 * (too dark, too grey, too little of any one hue) or cannot be read.
 */
export function extractAccent(img: HTMLImageElement): string | null {
  if (!img.complete || img.naturalWidth === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  let data: Uint8ClampedArray;
  // Sample the 16:9 picture: a 4:3 fallback thumbnail has black bars top and bottom.
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const sh = Math.min(nh, (nw * 9) / 16);
  const sy = (nh - sh) / 2;
  try {
    ctx.drawImage(img, 0, sy, nw, sh, 0, 0, SAMPLE_W, SAMPLE_H);
    data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  } catch {
    return null; // Image not readable (no CORS): use the fallback.
  }

  const weight = new Float64Array(HUE_BINS);
  const satSum = new Float64Array(HUE_BINS);
  const hueX = new Float64Array(HUE_BINS);
  const hueY = new Float64Array(HUE_BINS);
  const total = SAMPLE_W * SAMPLE_H;
  let vivid = 0;
  let lit = 0; // pixels that aren't near-black

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const sat = max === 0 ? 0 : chroma / max;

    // Skip near-black, near-white and greyish pixels: they carry no accent.
    if (max < 0.2) continue;
    lit++;
    if ((min > 0.88 && sat < 0.15) || sat < 0.25 || chroma < 0.12) continue;

    const h = rgbToHue(r, g, b, max, min);
    const bin = Math.floor(h / (360 / HUE_BINS)) % HUE_BINS;
    // Vivid, bright pixels count more than dull ones.
    const w = chroma * (0.5 + 0.5 * max);
    weight[bin] += w;
    satSum[bin] += sat * w;
    const rad = (h * Math.PI) / 180;
    hueX[bin] += Math.cos(rad) * w;
    hueY[bin] += Math.sin(rad) * w;
    vivid++;
  }

  // Judge colour against the visible (non-black) part of the picture, so a
  // bright logo on a black background still counts. Too little colour there,
  // or almost none in the whole frame: a dark or monochrome image.
  if (lit === 0 || vivid / lit < 0.1 || vivid / total < 0.015) return null;

  // Most prevalent hue, smoothed over neighbouring bins.
  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < HUE_BINS; i++) {
    const w =
      weight[(i + HUE_BINS - 1) % HUE_BINS] * 0.5 +
      weight[i] +
      weight[(i + 1) % HUE_BINS] * 0.5;
    if (w > bestWeight) {
      bestWeight = w;
      best = i;
    }
  }
  // The winning hue must be a real share of the colour, not a stray tint.
  let allWeight = 0;
  for (let i = 0; i < HUE_BINS; i++) allWeight += weight[i];
  if (best < 0 || bestWeight / allWeight < 0.25 || bestWeight / total < 0.004) return null;

  let x = 0, y = 0, sw = 0, ss = 0;
  for (const i of [best - 1, best, best + 1]) {
    const k = (i + HUE_BINS) % HUE_BINS;
    x += hueX[k];
    y += hueY[k];
    sw += weight[k];
    ss += satSum[k];
  }
  let hue = (Math.atan2(y, x) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  const sat = sw > 0 ? ss / sw : 0.6;

  // Normalise for a dark UI: keep the hue, give it enough saturation and
  // lightness to read as text on the panels.
  const s = Math.min(0.85, Math.max(0.5, sat));
  let l = 0.66;
  let rgb = hslToRgb(hue, s, l);
  while (contrast(rgb, PANEL_RGB) < MIN_CONTRAST && l < 0.86) {
    l += 0.02;
    rgb = hslToRgb(hue, s, l);
  }
  if (contrast(rgb, PANEL_RGB) < MIN_CONTRAST) return null;
  return toHex(rgb);
}

/**
 * True when the thumbnail is square album art with flat bars at the sides
 * (how YouTube publishes "Topic" music uploads), so the player can crop it
 * to the square instead of showing the bars.
 *
 * The 16:9 picture is sampled first: a 4:3 fallback thumbnail carries extra
 * letterbox bars top and bottom, which are skipped.
 */
export function isSquareArt(img: HTMLImageElement): boolean {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!img.complete || nw === 0 || nh === 0) return false;

  const W = 96;
  const H = 54;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  const sh = Math.min(nh, (nw * 9) / 16);
  const sy = (nh - sh) / 2;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, sy, nw, sh, 0, 0, W, H);
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return false;
  }

  // Square art in a 16:9 frame leaves bars of ~22% each side.
  const stats = (x0: number, x1: number) => {
    let n = 0;
    const sum = [0, 0, 0];
    const sq = [0, 0, 0];
    for (let y = 2; y < H - 2; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          sum[c] += data[i + c];
          sq[c] += data[i + c] * data[i + c];
        }
        n++;
      }
    }
    const mean = sum.map((v) => v / n);
    const std = sq.map((v, c) => Math.sqrt(Math.max(0, v / n - mean[c] * mean[c])));
    return { mean, std: Math.max(...std) };
  };

  const left = stats(1, Math.floor(W * 0.19));
  const right = stats(Math.ceil(W * 0.81), W - 1);
  const centre = stats(Math.floor(W * 0.3), Math.ceil(W * 0.7));
  const sidesMatch = left.mean.every((v, c) => Math.abs(v - right.mean[c]) < 14);

  return left.std < 9 && right.std < 9 && sidesMatch && centre.std > Math.max(left.std, right.std) * 2 + 6;
}
