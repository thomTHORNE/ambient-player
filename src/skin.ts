/**
 * Skins: the whole look of the player, chosen per device in the Skins panel.
 *
 * A skin is a stylesheet scoped to html[data-skin="<id>"]. Every behaviour
 * stays the same in all skins (a skin may only move panels around), so
 * switching is instant and never touches playback or the connection to the
 * paired room.
 *
 *   modern  Modern Warfare: the tactical console (styles.css, the base)
 *   xp      Windows XP: the player as a desktop window (skins/xp.css)
 *
 * A skin can also lay the page out differently (`arrange`): "pages" is the
 * base layout (panels that page past the stage); "window" moves the panels
 * into a window with a toolbar, a task pane and a main view
 * (src/skinLayout.ts). It is marked on <html> as data-arrange.
 *
 * The choice is kept in this browser only (localStorage), like the UI scale
 * and the layout: it is never part of the mix that remote control shares,
 * so a phone used as a remote can wear a different skin from the laptop it
 * controls. A small inline script in index.html applies the saved skin
 * before the first paint; keep its key and ids in sync with these.
 */

export type SkinId = 'modern' | 'xp';

export interface SkinInfo {
  id: SkinId;
  /** What the Skins panel calls it. */
  name: string;
  /** The family it is listed under in the Skins panel. */
  group: string;
  /** The browser bar's colour (meta theme-color) while it is on. */
  themeColor: string;
  /** How the page is laid out: the base pages, or a window (src/skinLayout.ts). */
  arrange: 'pages' | 'window';
}

export const SKINS: readonly SkinInfo[] = [
  { id: 'modern', name: 'Modern Warfare', group: 'Modern', themeColor: '#08090A', arrange: 'pages' },
  { id: 'xp', name: 'Windows XP', group: 'Frutiger Aero', themeColor: '#0054E3', arrange: 'window' },
];

export const DEFAULT_SKIN: SkinId = 'modern';
export const SKIN_KEY = 'ambient-player:skin';
/** Fired on window after the skin changes (layouts re-measure, canvases repaint). */
export const SKIN_EVENT = 'ambient:skin-change';

function skinInfo(id: string | null | undefined): SkinInfo | undefined {
  return SKINS.find((s) => s.id === id);
}

/** The skin saved on this device, or the default. */
export function storedSkin(): SkinId {
  try {
    return skinInfo(localStorage.getItem(SKIN_KEY))?.id ?? DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** The skin on screen now. */
export function currentSkin(): SkinId {
  return skinInfo(document.documentElement.dataset.skin)?.id ?? DEFAULT_SKIN;
}

/** Wear a skin (and keep it on this device). */
export function applySkin(id: SkinId): void {
  const info = skinInfo(id) ?? skinInfo(DEFAULT_SKIN)!;
  const changed = currentSkin() !== info.id || document.documentElement.dataset.skin !== info.id;
  document.documentElement.dataset.skin = info.id;
  document.documentElement.dataset.arrange = info.arrange;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', info.themeColor);
  try {
    if (info.id === DEFAULT_SKIN) localStorage.removeItem(SKIN_KEY);
    else localStorage.setItem(SKIN_KEY, info.id);
  } catch {
    // Not saved; it still applies for this visit.
  }
  if (changed) window.dispatchEvent(new CustomEvent(SKIN_EVENT, { detail: info.id }));
}

/** The Skins panel: one radio button per skin, grouped by family (index.html). */
export function setupSkinPanel(): void {
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="skin"]'));
  const show = () => {
    const id = currentSkin();
    radios.forEach((r) => {
      r.checked = r.value === id;
      r.closest('.skin')?.classList.toggle('is-current', r.checked);
    });
  };
  radios.forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked && skinInfo(r.value)) applySkin(r.value as SkinId);
      show();
    })
  );
  // The inline script set data-skin already; this also covers storage it
  // couldn't read and an unknown saved value.
  applySkin(storedSkin());
  show();
}
