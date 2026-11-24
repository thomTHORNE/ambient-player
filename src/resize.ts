/**
 * Resizable artwork column on large horizontal screens with a mouse or
 * trackpad (an ultrawide monitor, a desktop, a laptop). Touch screens, the
 * Fold and phones never get the divider; src/layout.ts decides where it
 * applies (data-resizable on <html>).
 *
 * The width is kept as a share of the app's width in --stage-pref, which
 * styles.css clamps: at least 300px, at most what the artwork can use at
 * the screen's height, and never so wide that the panels drop under 560px.
 * It is saved per device and applied before the first paint by the inline
 * script in index.html.
 */

import { appZoom } from './scale.js';
import { LAYOUT_CHOICE_EVENT } from './layoutPref.js';

const RESIZE_KEY = 'ambient-player:stage-width';

/** src/layout.ts decides where the divider applies and marks it on <html>. */
function resizable(): boolean {
  return document.documentElement.dataset.resizable === 'true';
}
/** One arrow-key step, as a share of the width. */
const RESIZE_STEP = 0.02;

const rzRoot = document.documentElement;
const rzApp = document.querySelector<HTMLElement>('.app')!;
const rzStage = document.getElementById('stageWrap') as HTMLElement;
const rzHandle = document.getElementById('stageSplitter') as HTMLElement;

/** The app's content box (inside its padding), in viewport pixels. */
function contentBox(): { left: number; width: number } {
  const rect = rzApp.getBoundingClientRect();
  const style = getComputedStyle(rzApp);
  // The desktop UI scale zooms the app: its padding is reported unzoomed.
  const z = appZoom();
  const left = rect.left + parseFloat(style.paddingLeft) * z;
  const width = rect.width - (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) * z;
  return { left, width: Math.max(1, width) };
}

/** The artwork column's share of the width as laid out (after clamping). */
function effectiveRatio(): number {
  return rzStage.getBoundingClientRect().width / contentBox().width;
}

function setPreferred(ratio: number): void {
  const r = Math.min(0.95, Math.max(0.05, ratio));
  rzRoot.style.setProperty('--stage-pref', `calc(${r.toFixed(4)} * 100%)`);
}

/** Save the width as laid out, so the stored value is one the layout can show. */
function commit(): void {
  const r = effectiveRatio();
  setPreferred(r);
  try {
    localStorage.setItem(RESIZE_KEY, r.toFixed(4));
  } catch {
    // Not saved; it still applies for this visit.
  }
  updateAria();
}

function reset(): void {
  rzRoot.style.removeProperty('--stage-pref');
  try {
    localStorage.removeItem(RESIZE_KEY);
  } catch {
    // Nothing stored.
  }
  updateAria();
}

function updateAria(): void {
  if (!resizable()) return;
  const pct = Math.round(effectiveRatio() * 100);
  rzHandle.setAttribute('aria-valuenow', String(pct));
  rzHandle.setAttribute('aria-valuetext', `Artwork column ${pct}% of the width`);
}

export function setupStageResize(): void {
  let dragFrame = 0;
  let lastX = 0;

  const follow = () => {
    dragFrame = 0;
    const box = contentBox();
    const half = rzHandle.getBoundingClientRect().width / 2;
    setPreferred((lastX - box.left - half) / box.width);
  };

  rzHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !resizable()) return;
    e.preventDefault();
    rzHandle.setPointerCapture(e.pointerId);
    rzRoot.classList.add('is-resizing');
    lastX = e.clientX;
  });

  rzHandle.addEventListener('pointermove', (e) => {
    if (!rzHandle.hasPointerCapture(e.pointerId)) return;
    lastX = e.clientX;
    if (!dragFrame) dragFrame = requestAnimationFrame(follow);
  });

  const endDrag = (e: PointerEvent) => {
    if (!rzHandle.hasPointerCapture(e.pointerId)) return;
    rzHandle.releasePointerCapture(e.pointerId);
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      follow();
    }
    rzRoot.classList.remove('is-resizing');
    commit();
  };
  rzHandle.addEventListener('pointerup', endDrag);
  rzHandle.addEventListener('pointercancel', endDrag);

  rzHandle.addEventListener('dblclick', reset);

  rzHandle.addEventListener('keydown', (e) => {
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = effectiveRatio() - RESIZE_STEP;
    else if (e.key === 'ArrowRight') next = effectiveRatio() + RESIZE_STEP;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return;
    e.preventDefault();
    setPreferred(next);
    commit();
  });

  // The clamps follow the window, so the reported width does too.
  let ariaFrame = 0;
  window.addEventListener('resize', () => {
    if (!ariaFrame) ariaFrame = requestAnimationFrame(() => ((ariaFrame = 0), updateAria()));
  });
  window.addEventListener(LAYOUT_CHOICE_EVENT, updateAria);
  updateAria();
}
