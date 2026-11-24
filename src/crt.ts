/**
 * Screen effect: the artwork shown on a simulated CRT / LED wall.
 *
 * The picture is drawn into a canvas phosphor by phosphor, in device pixels:
 * - it is sampled into cells, one colour per cell (the "pixels" of the screen);
 * - each cell is a triad of red, green and blue phosphor stripes, brightest
 *   in the middle, with some light bleeding into the neighbouring stripes;
 * - cells stack in columns with a thin dark gap between them, and every
 *   other column is offset by half a cell (a slot mask);
 * - the result glows a little (a blurred copy screened on top), and CSS
 *   softens it slightly, like a photo of a screen.
 * Before sampling, the picture is graded towards a cold, desaturated
 * blue-grey.
 *
 * Every setting is a --crt-* custom property, read on each render. The
 * Screen effect panel (src/screenFx.ts) sets them and fires FX_CHANGE_EVENT
 * on window to re-render. Rendering happens only when the picture or
 * the frame's size changes, never per frame.
 */

/** Fire on window after changing a --crt-* property to re-render. */
export const FX_CHANGE_EVENT = 'ambient:fx-change';

interface CrtParams {
  pitch: number;
  cell: number;
  gap: number;
  gapDark: number;
  stagger: boolean;
  bleed: number;
  edge: number;
  boost: number;
  glow: number;
  glowRadius: number;
  srcBlur: number;
  gray: number;
  tint: number;
  tintRgb: [number, number, number];
  contrast: number;
  bright: number;
}

function crtNum(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const v = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

function crtColor(style: CSSStyleDeclaration, name: string, fallback: [number, number, number]): [number, number, number] {
  const m = style.getPropertyValue(name).trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
}

function readCrtParams(): CrtParams {
  const s = getComputedStyle(document.documentElement);
  return {
    pitch: crtNum(s, '--crt-pitch', 6),
    cell: crtNum(s, '--crt-cell', 7),
    gap: crtNum(s, '--crt-gap', 1),
    gapDark: crtNum(s, '--crt-gap-dark', 0.35),
    stagger: crtNum(s, '--crt-stagger', 1) >= 0.5,
    bleed: crtNum(s, '--crt-bleed', 0.55),
    edge: crtNum(s, '--crt-edge', 0.85),
    boost: crtNum(s, '--crt-boost', 2.1),
    glow: crtNum(s, '--crt-glow', 0.3),
    glowRadius: crtNum(s, '--crt-glow-radius', 2),
    srcBlur: crtNum(s, '--crt-src-blur', 1.5),
    gray: crtNum(s, '--crt-gray', 0.55),
    tint: crtNum(s, '--crt-tint', 0.5),
    tintRgb: crtColor(s, '--crt-tint-color', [80, 102, 122]),
    contrast: crtNum(s, '--crt-contrast', 0.9),
    bright: crtNum(s, '--crt-bright', 1),
  };
}

/** The part of a w×h picture that object-fit: cover shows in a frame, zoomed in by `zoom`. */
function crtCover(w: number, h: number, aspect: number, zoom: number): [number, number, number, number] {
  let sw = w;
  let sh = h;
  if (w / h > aspect) sw = h * aspect;
  else sh = w / aspect;
  sw /= zoom;
  sh /= zoom;
  return [(w - sw) / 2, (h - sh) / 2, sw, sh];
}

let crtSampler: HTMLCanvasElement | null = null;

/**
 * Render `source` onto `canvas` as a screen of cssW×cssH CSS pixels,
 * cropped like object-fit: cover and zoomed in by `zoom`.
 *
 * `magnify`: the canvas will be shown scaled up by this much (a CSS
 * transform), so it is rendered with that many more pixels and the cells
 * still come out at their set size on screen.
 *
 * False when the picture can't be read (a cross-origin image without CORS).
 */
export function paintCrt(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  zoom = 1,
  magnify = 1
): boolean {
  if (!sourceW || !sourceH || cssW < 2 || cssH < 2) return false;
  const p = readCrtParams();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(cssW * dpr * magnify);
  const H = Math.round(cssH * dpr * magnify);

  // Screen geometry in device pixels.
  const stripe = Math.max(1, Math.round((p.pitch * dpr) / 3));
  const triad = stripe * 3;
  const cellH = Math.max(3, Math.round(p.cell * dpr));
  const gap = Math.min(cellH - 2, Math.max(0, Math.round(p.gap * dpr)));
  const lit = cellH - gap;
  const half = p.stagger ? Math.floor(cellH / 2) : 0;
  const cols = Math.ceil(W / triad) + 1;
  const rows = Math.ceil((H + half) / cellH) + 1;

  // 1. Sample the picture: one colour per cell.
  crtSampler = crtSampler || document.createElement('canvas');
  crtSampler.width = cols;
  crtSampler.height = rows;
  const sctx = crtSampler.getContext('2d', { willReadFrequently: true });
  if (!sctx) return false;
  const [sx, sy, sw, sh] = crtCover(sourceW, sourceH, (cols * triad) / (rows * cellH), zoom);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.filter = 'none';
  sctx.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows);
  if (p.srcBlur > 0 && 'filter' in sctx) {
    // Defocus; drawn over the sharp copy so the blur's soft edges never show.
    sctx.filter = `blur(${p.srcBlur}px)`;
    sctx.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows);
    sctx.filter = 'none';
  }
  let pixels: Uint8ClampedArray;
  try {
    pixels = sctx.getImageData(0, 0, cols, rows).data;
  } catch {
    return false;
  }

  // 2. Grade each cell: desaturate, tint towards the cold blue-grey, contrast, brightness.
  const n = cols * rows;
  const cr = new Float32Array(n);
  const cg = new Float32Array(n);
  const cb = new Float32Array(n);
  const [tr, tg, tb] = p.tintRgb;
  const tl = Math.max(1, 0.299 * tr + 0.587 * tg + 0.114 * tb);
  for (let i = 0; i < n; i++) {
    let r = pixels[i * 4] / 255;
    let g = pixels[i * 4 + 1] / 255;
    let b = pixels[i * 4 + 2] / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r += (l - r) * p.gray;
    g += (l - g) * p.gray;
    b += (l - b) * p.gray;
    r += ((l * tr) / tl - r) * p.tint;
    g += ((l * tg) / tl - g) * p.tint;
    b += ((l * tb) / tl - b) * p.tint;
    cr[i] = Math.max(0, ((r - 0.5) * p.contrast + 0.5) * p.bright);
    cg[i] = Math.max(0, ((g - 0.5) * p.contrast + 0.5) * p.bright);
    cb[i] = Math.max(0, ((b - 0.5) * p.contrast + 0.5) * p.bright);
  }

  // 3. Lay out the phosphors. Per column of device pixels: which cell column,
  // which stripe (R, G or B) and how bright across the stripe.
  const colOf = new Int32Array(W);
  const subOf = new Uint8Array(W);
  const across = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const tx = Math.floor(x / triad);
    const within = x - tx * triad;
    const sub = Math.min(2, Math.floor(within / stripe));
    const t = ((within - sub * stripe + 0.5) / stripe) * 2 - 1;
    colOf[x] = Math.min(cols - 1, tx);
    subOf[x] = sub;
    across[x] = 1 - p.edge * t * t;
  }
  // Per row: which cell row and how bright along the cell, for even and odd
  // (offset) columns.
  const rowOf = [new Int32Array(H), new Int32Array(H)];
  const along = [new Float32Array(H), new Float32Array(H)];
  for (let parity = 0; parity < 2; parity++) {
    const shift = parity ? half : 0;
    for (let y = 0; y < H; y++) {
      const yy = y + shift;
      const ry = Math.floor(yy / cellH);
      const within = yy - ry * cellH;
      rowOf[parity][y] = Math.min(rows - 1, ry);
      if (within >= lit) {
        along[parity][y] = p.gapDark;
      } else {
        const t = ((within + 0.5) / lit) * 2 - 1;
        along[parity][y] = 1 - 0.35 * p.edge * t * t;
      }
    }
  }

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const out = ctx.createImageData(W, H);
  const o = out.data;
  const bleed = p.bleed;
  const k = 255 * p.boost;
  let i = 0;
  for (let y = 0; y < H; y++) {
    const rowEven = rowOf[0][y] * cols;
    const rowOdd = rowOf[1][y] * cols;
    const alongEven = along[0][y];
    const alongOdd = along[1][y];
    for (let x = 0; x < W; x++) {
      const tx = colOf[x];
      const odd = tx & 1;
      const si = (odd ? rowOdd : rowEven) + tx;
      const m = across[x] * (odd ? alongOdd : alongEven) * k;
      const sub = subOf[x];
      o[i] = cr[si] * (sub === 0 ? 1 : bleed) * m;
      o[i + 1] = cg[si] * (sub === 1 ? 1 : bleed) * m;
      o[i + 2] = cb[si] * (sub === 2 ? 1 : bleed) * m;
      o[i + 3] = 255;
      i += 4;
    }
  }
  ctx.putImageData(out, 0, 0);

  // 4. Glow: a blurred copy screened over the phosphors.
  if (p.glow > 0 && 'filter' in ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(1, p.glow);
    ctx.filter = `blur(${p.glowRadius * dpr}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------------------
// The main artwork
// ---------------------------------------------------------------------------

/**
 * Keep `canvas` showing `img` as a screen, lined up with it exactly: the
 * canvas holds the whole picture at the size object-fit: cover gives it in
 * the frame, and styles.css gives it the picture's zoom, so the plain picture
 * underneath and the screen on top match for --crt-mix.
 *
 * Re-renders when the picture loads, the frame grows or changes width, or the
 * settings change. The frame shrinking (the collapsing artwork on vertical
 * screens) only crops, so scrolling never re-renders.
 */
export function setupArtCrt(img: HTMLImageElement, canvas: HTMLCanvasElement, frame: HTMLElement): void {
  let renderedW = 0;
  let renderedH = 0;
  let lastSrc = '';
  let timer = 0;

  const paint = () => {
    timer = 0;
    // YouTube's 120×90 "no artwork" placeholder: src/main.ts swaps in the fallback.
    if (!img.complete || img.naturalWidth <= 120) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width < 2) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // The picture's size in the frame (object-fit: cover), and its zoom.
    const fit = Math.max(rect.width / iw, rect.height / ih);
    const transform = getComputedStyle(img).transform;
    const zoom = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).a : 1;
    const ok = paintCrt(img, iw, ih, canvas, iw * fit, ih * fit, 1, zoom);
    frame.classList.toggle('has-crt', ok);
    if (!ok) return;
    renderedW = rect.width;
    renderedH = rect.height;
    const src = img.currentSrc || img.src;
    if (src !== lastSrc) {
      lastSrc = src;
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const mix = parseFloat(getComputedStyle(canvas).getPropertyValue('--crt-mix')) || 1;
        canvas.animate([{ opacity: 0.25 * mix }, { opacity: mix }], { duration: 360, easing: 'ease-out' });
      }
    }
  };
  const schedule = (delay = 120) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(paint, delay);
  };

  img.addEventListener('load', () => schedule(0));
  new ResizeObserver(() => {
    const rect = frame.getBoundingClientRect();
    if (Math.abs(rect.width - renderedW) > 1 || rect.height > renderedH + 1) schedule();
  }).observe(frame);
  window.addEventListener(FX_CHANGE_EVENT, () => schedule(30));
  if (img.complete && img.naturalWidth) schedule(0);
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

/** Rendered thumbnails by URL and size, so rebuilding the strip is instant. */
const crtThumbCache = new Map<string, HTMLCanvasElement>();
const crtThumbImages = new Map<string, Promise<HTMLImageElement>>();

function crtLoad(url: string): Promise<HTMLImageElement> {
  let pending = crtThumbImages.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    crtThumbImages.set(url, pending);
  }
  return pending;
}

/** Render every `canvas[data-crt-src]` under `root` that is on screen. */
export function paintCrtThumbs(root: HTMLElement): void {
  root.querySelectorAll<HTMLCanvasElement>('canvas[data-crt-src]').forEach(async (canvas) => {
    const box = canvas.parentElement;
    const url = canvas.dataset.crtSrc;
    if (!box || !url) return;
    const rect = box.getBoundingClientRect();
    if (rect.width < 2) return;
    const key = `${url}|${Math.round(rect.width)}x${Math.round(rect.height)}|${window.devicePixelRatio}`;
    let rendered = crtThumbCache.get(key);
    if (!rendered) {
      try {
        const image = await crtLoad(url);
        const fresh = document.createElement('canvas');
        if (!paintCrt(image, image.naturalWidth, image.naturalHeight, fresh, rect.width, rect.height)) return;
        crtThumbCache.set(key, fresh);
        rendered = fresh;
      } catch {
        return;
      }
    }
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    canvas.getContext('2d')?.drawImage(rendered, 0, 0);
    box.classList.add('has-crt');
  });
}

/** Forget rendered thumbnails (after the settings change). */
export function clearCrtThumbs(): void {
  crtThumbCache.clear();
}
