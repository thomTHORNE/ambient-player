/**
 * Screen takeover: fullscreen and keeping the screen awake.
 *
 * Browsers only enter fullscreen from a user gesture (a tap, a click, a key),
 * and the user can always leave it; nothing here can or tries to prevent that.
 * Installed from the home screen, the manifest's "display": "fullscreen"
 * launches the app without any browser UI at all.
 */
const doc = document;
/** True where a page may go fullscreen (not iPhone Safari, for one). */
export function fullscreenSupported() {
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}
export function isFullscreen() {
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}
/** Launched from the home screen with no browser UI. */
export function runningAsFullscreenApp() {
    return window.matchMedia('(display-mode: fullscreen)').matches;
}
/** Launched from the home screen at all (fullscreen or standalone). */
export function runningAsApp() {
    return (runningAsFullscreenApp() ||
        window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true);
}
export async function enterFullscreen() {
    const el = document.documentElement;
    try {
        if (el.requestFullscreen)
            await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen)
            await el.webkitRequestFullscreen();
        else
            return false;
        return true;
    }
    catch {
        return false;
    }
}
export async function exitFullscreen() {
    try {
        if (doc.exitFullscreen)
            await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen)
            await doc.webkitExitFullscreen();
    }
    catch {
        // Already out of fullscreen.
    }
}
export function onFullscreenChange(listener) {
    document.addEventListener('fullscreenchange', listener);
    document.addEventListener('webkitfullscreenchange', listener);
}
let lock = null;
let wanted = false;
/**
 * Ask the screen to stay on (or let it sleep again). The browser drops the
 * lock whenever the page is hidden, so this re-requests it when the page
 * becomes visible while it is still wanted.
 */
export async function setKeepAwake(on) {
    wanted = on;
    const nav = navigator;
    if (!nav.wakeLock)
        return;
    if (on && !lock && document.visibilityState === 'visible') {
        try {
            const sentinel = await nav.wakeLock.request('screen');
            lock = sentinel;
            sentinel.addEventListener('release', () => {
                if (lock === sentinel)
                    lock = null;
            });
            if (!wanted)
                await releaseLock();
        }
        catch {
            lock = null; // Refused (battery saver, permissions): the screen may dim.
        }
    }
    else if (!on) {
        await releaseLock();
    }
}
async function releaseLock() {
    const current = lock;
    lock = null;
    if (current) {
        try {
            await current.release();
        }
        catch {
            // Already released.
        }
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted)
        void setKeepAwake(true);
});
