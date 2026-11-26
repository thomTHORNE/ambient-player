/**
 * Screen takeover: fullscreen and keeping the screen awake.
 *
 * Browsers only enter fullscreen from a user gesture (a tap, a click, a key),
 * and the user can always leave it; nothing here can or tries to prevent that.
 * Installed from the home screen, the manifest's "display": "fullscreen"
 * launches the app without any browser UI at all.
 */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const doc = document as FullscreenDocument;

/** True where a page may go fullscreen (not iPhone Safari, for one). */
export function fullscreenSupported(): boolean {
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** Launched from the home screen with no browser UI. */
export function runningAsFullscreenApp(): boolean {
  return window.matchMedia('(display-mode: fullscreen)').matches;
}

/** Launched from the home screen at all (fullscreen or standalone). */
export function runningAsApp(): boolean {
  return (
    runningAsFullscreenApp() ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as FullscreenElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
  } catch {
    // Already out of fullscreen.
  }
}

export function onFullscreenChange(listener: () => void): void {
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
}

// ---------------------------------------------------------------------------
// The installed app: reclaim space the browser keeps after the status bar
// ---------------------------------------------------------------------------
//
// Seen on Android (Brave, a Galaxy Fold): pulling the notification shade
// down in the fullscreen app shrinks the window by the status bar's height,
// and when the shade goes the browser doesn't always give that space back.
// A page can't resize its window, but asking for fullscreen again hides the
// bars and restores it. That needs a tap, so the next tap does it, when the
// window is shorter than it has been at this width (and this UI scale).

/** Shorter than this (CSS px) is the browser holding space, not rounding. */
const SHORT_BY_PX = 20;

/** The tallest the window has been, per width and viewport setting. */
const tallest = new Map<string, number>();

function windowKey(): string {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '';
  return `${Math.round(window.innerWidth)}|${viewport}`;
}

/** Typing: the on-screen keyboard can shorten the window, and fullscreen would close it. */
function typing(target: EventTarget | null): boolean {
  const el = (target instanceof Element ? target : document.activeElement) as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

/** The window is shorter than it was at this width: the browser kept the space. */
export function windowShortened(): boolean {
  const h = window.innerHeight;
  const key = windowKey();
  const most = Math.max(tallest.get(key) ?? 0, h);
  tallest.set(key, most);
  return most - h >= SHORT_BY_PX;
}

export function setupReclaimSpace(): void {
  if (!runningAsFullscreenApp() || !fullscreenSupported()) return;
  const note = () => {
    if (!typing(null)) windowShortened();
  };
  note();
  window.addEventListener('resize', note);
  // Capture phase: the tap still reaches whatever it was aimed at.
  document.addEventListener(
    'click',
    (e) => {
      if (isFullscreen() || typing(e.target) || typing(null)) return;
      if (windowShortened()) void enterFullscreen();
    },
    true
  );
}

// ---------------------------------------------------------------------------
// Keep the screen on
// ---------------------------------------------------------------------------

interface ScreenLock {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<ScreenLock> };
};

let lock: ScreenLock | null = null;
let wanted = false;

/**
 * Ask the screen to stay on (or let it sleep again). The browser drops the
 * lock whenever the page is hidden, so this re-requests it when the page
 * becomes visible while it is still wanted.
 */
export async function setKeepAwake(on: boolean): Promise<void> {
  wanted = on;
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock) return;
  if (on && !lock && document.visibilityState === 'visible') {
    try {
      const sentinel = await nav.wakeLock.request('screen');
      lock = sentinel;
      sentinel.addEventListener('release', () => {
        if (lock === sentinel) lock = null;
      });
      if (!wanted) await releaseLock();
    } catch {
      lock = null; // Refused (battery saver, permissions): the screen may dim.
    }
  } else if (!on) {
    await releaseLock();
  }
}

async function releaseLock(): Promise<void> {
  const current = lock;
  lock = null;
  if (current) {
    try {
      await current.release();
    } catch {
      // Already released.
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) void setKeepAwake(true);
});
