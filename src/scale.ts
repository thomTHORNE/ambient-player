/**
 * UI scale: a user setting that makes the whole interface smaller or larger.
 *
 * On touch devices (phones, a Fold) it changes the page's viewport scale, so
 * the layout sees more (or fewer) CSS pixels: at 90% the app lays out as if
 * the screen were about 11% bigger, which can move it into the large-screen
 * layout. On desktop the browser ignores the viewport meta tag, so the page
 * is zoomed instead (the browser's own Ctrl/Cmd +/- does the same thing).
 *
 * The saved value is also applied by a small inline script in index.html
 * before the first paint, so the page never flashes at the wrong size.
 */

export const SCALE_KEY = 'ambient-player:ui-scale';
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.3;
export const SCALE_STEP = 0.05;

const roundScale = (s: number) => Number((Math.round(s / SCALE_STEP) * SCALE_STEP).toFixed(2));

/** Viewport scaling works where the browser honours the viewport meta tag. */
function usesViewportScale(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function storedScale(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    if (v >= SCALE_MIN && v <= SCALE_MAX) return roundScale(v);
  } catch {
    // Storage unavailable: use the default.
  }
  return 1;
}

/** Desktop: zoom the app shell (styles.css resizes it to still fill the window). */
function setAppZoom(s: number): void {
  const root = document.documentElement;
  root.classList.toggle('is-zoomed', s !== 1);
  if (s === 1) root.style.removeProperty('--ui-zoom');
  else root.style.setProperty('--ui-zoom', String(s));
}

/** The desktop zoom in effect (1 on touch devices, which scale the viewport). */
export function appZoom(): number {
  return parseFloat(document.documentElement.style.getPropertyValue('--ui-zoom')) || 1;
}

export function applyScale(scale: number): number {
  const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, roundScale(scale)));
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (usesViewportScale() && meta) {
    // Minimum and maximum pinned to the scale: some browsers otherwise keep
    // their current zoom when the tag changes, cutting the wider layout off.
    meta.content =
      s === 1
        ? 'width=device-width, initial-scale=1.0, viewport-fit=cover'
        : `width=device-width, initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, viewport-fit=cover`;
    setAppZoom(1);
  } else {
    setAppZoom(s);
  }
  try {
    if (s === 1) localStorage.removeItem(SCALE_KEY);
    else localStorage.setItem(SCALE_KEY, String(s));
  } catch {
    // Not saved; it still applies for this visit.
  }
  return s;
}
