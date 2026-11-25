/**
 * The backdrop: the focused channel's artwork, blurred, desaturated and
 * dimmed, drifting slowly behind everything.
 *
 * Two things keep it cheap, since every frame of the drift redraws the
 * whole screen:
 * - The picture is blurred and graded once, onto a small canvas, whenever it
 *   or the window's size changes. The canvas is what drifts, so a frame only
 *   moves a finished picture. A CSS `filter: blur()` on the drifting element
 *   would be redone by the GPU on every frame, on a surface larger than the
 *   screen.
 * - The drift runs at 10 frames a second, not 60 (below).
 */

/** The look, as the CSS filter it replaces: blur(26px) saturate(0.7) brightness(0.6). */
const BD_BLUR_CSS_PX = 26;
const BD_SATURATE = 0.7;
const BD_BRIGHTNESS = 0.6;
/** The canvas's longer side. Blurred this much, the picture holds no more detail than this. */
const BD_LONG_SIDE = 320;

const bdCanvas = document.getElementById('backdropCanvas') as HTMLCanvasElement | null;
const bdImage = new Image();
bdImage.crossOrigin = 'anonymous';
bdImage.decoding = 'async';
let bdSrc = '';
let bdResizeTimer = 0;

/** Draw the loaded picture onto the canvas, blurred and graded. */
function bdPaint(): void {
  if (!bdCanvas || !bdSrc || !bdImage.complete || !bdImage.naturalWidth) return;
  const iw = bdImage.naturalWidth;
  const ih = bdImage.naturalHeight;
  const k = BD_LONG_SIDE / Math.max(iw, ih);
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  // The canvas is shown with object-fit: cover over the window, so one canvas
  // pixel spans `cover` CSS pixels. Blur by the same amount on screen.
  const cover = Math.max(window.innerWidth / w, window.innerHeight / h) || 1;
  const r = BD_BLUR_CSS_PX / cover;

  bdCanvas.width = w;
  bdCanvas.height = h;
  const ctx = bdCanvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Overscan by the blur's reach, so the blur never pulls in transparent edges.
  const pad = Math.ceil(r * 3);
  if (typeof (ctx as { filter?: unknown }).filter === 'string') {
    ctx.filter = `blur(${r.toFixed(2)}px) saturate(${BD_SATURATE}) brightness(${BD_BRIGHTNESS})`;
    ctx.drawImage(bdImage, -pad, -pad, w + pad * 2, h + pad * 2);
    ctx.filter = 'none';
  } else {
    // No canvas filters (older Safari): blur by shrinking and enlarging again,
    // then desaturate and dim with blend modes. Close to the same look.
    const tiny = document.createElement('canvas');
    tiny.width = Math.max(1, Math.round(w / (r * 1.5)));
    tiny.height = Math.max(1, Math.round(h / (r * 1.5)));
    const tctx = tiny.getContext('2d');
    if (!tctx) return;
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(bdImage, 0, 0, tiny.width, tiny.height);
    ctx.drawImage(tiny, 0, 0, w, h);
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 1 - BD_SATURATE;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1 - BD_BRIGHTNESS;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  bdCanvas.classList.add('is-ready');
}

bdImage.addEventListener('load', () => {
  if (bdImage.src === bdSrc) bdPaint();
});

/**
 * The drift is slow enough (under a pixel per tenth of a second, on a picture
 * blurred by 26px) that 10 frames a second look the same as 60. Left to
 * itself, a CSS animation redraws the whole screen 60 times a second, so its
 * clock is advanced here by hand instead. The keyframes and easing stay in
 * styles.css; with reduce motion there is no animation and nothing to do.
 */
const BD_DRIFT_FPS = 10;
const bdDriftStart = performance.now();

window.setInterval(() => {
  if (!bdCanvas || document.hidden) return;
  for (const a of bdCanvas.getAnimations()) {
    if ((a as CSSAnimation).animationName !== 'backdrop-drift') continue;
    if (a.playState === 'running') a.pause();
    a.currentTime = performance.now() - bdDriftStart;
  }
}, 1000 / BD_DRIFT_FPS);

window.addEventListener('resize', () => {
  window.clearTimeout(bdResizeTimer);
  bdResizeTimer = window.setTimeout(bdPaint, 200);
});

/**
 * Show `src` as the backdrop, or fade it out with ''. `letterboxed`: the
 * picture carries letterbox bars (YouTube's hqdefault), so it is zoomed further.
 */
export function setBackdrop(src: string, letterboxed = false): void {
  if (!bdCanvas) return;
  bdCanvas.classList.toggle('is-letterboxed', letterboxed);
  if (!src) {
    bdSrc = '';
    bdCanvas.classList.remove('is-ready');
    return;
  }
  // Resolve it the way the image does, so the load check compares like with like.
  const href = new URL(src, document.baseURI).href;
  if (href === bdSrc) return;
  bdSrc = href;
  bdImage.src = bdSrc;
  if (bdImage.complete && bdImage.naturalWidth) bdPaint();
}
