/**
 * Window layout for skins that arrange the page as a desktop window
 * (data-arrange="window"; Windows XP).
 *
 * The panels are moved, never copied, so every listener, id and piece of
 * state stays with them; leaving the skin puts each one back where it was
 * (a comment marks its place). In the window (#xpShell, index.html):
 *
 *   toolbar     the deck's transport buttons, the repeat switch, the volume
 *   task pane   "Mix tasks" (links to the main actions), then the saved
 *               mixes, mix status, devices, screen effect and skins panels,
 *               each a group that collapses (kept on this device)
 *   main view   the stage (artwork beside "Now playing", the timeline and
 *               "Playing now", the thumbnails in a box of their own) and
 *               the channel list
 *
 * src/layout.ts stands aside while the window is up: no pages, pager or
 * collapsing stage. skins/xp.css lays it all out, wide (toolbar on top, the
 * task pane beside the main view) or narrow (one column, as on a phone).
 */

import { SKIN_EVENT } from './skin.js';

const slById = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** Where each moved node lives in the base layout (a comment at that spot). */
const slHomes = new Map<Node, Comment>();
/** Collapsed task pane groups, by the id of their heading. */
const SL_GROUPS_KEY = 'ambient-player:xp-groups';
/** Collapsed until opened, the first time (the longest group). */
const SL_COLLAPSED_BY_DEFAULT = ['screenTitle'];

function slMove(node: Element | null, into: Element | null, before: Node | null = null): void {
  if (!node || !into) return;
  if (!slHomes.has(node)) {
    const home = document.createComment(` home of ${node.id || node.className} `);
    node.before(home);
    slHomes.set(node, home);
  }
  into.insertBefore(node, before);
}

/** Put every moved node back at its place in the base layout. */
function slRestoreAll(): void {
  for (const [node, home] of [...slHomes.entries()].reverse()) home.replaceWith(node);
  slHomes.clear();
}

function slArranged(): boolean {
  return document.documentElement.dataset.arrange === 'window';
}

// ---------------------------------------------------------------------------
// Task pane groups: collapse and expand
// ---------------------------------------------------------------------------

function slReadCollapsed(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(SL_GROUPS_KEY) || 'null');
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // Unreadable: the defaults.
  }
  return Object.fromEntries(SL_COLLAPSED_BY_DEFAULT.map((id) => [id, true]));
}

function slSaveCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(SL_GROUPS_KEY, JSON.stringify(state));
  } catch {
    // Not kept; it still applies for this visit.
  }
}

/** The heading's id names the group. */
function slGroupKey(panel: HTMLElement): string {
  return panel.querySelector<HTMLElement>('.panel__title')?.id || panel.id;
}

function slSetCollapsed(panel: HTMLElement, collapsed: boolean, save = true): void {
  panel.classList.toggle('is-collapsed', collapsed);
  const toggle = panel.querySelector<HTMLButtonElement>('.xp-group__toggle');
  const title = panel.querySelector('.panel__title')?.textContent?.trim() || 'group';
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
    toggle.title = collapsed ? 'Expand' : 'Collapse';
  }
  if (save) {
    const state = slReadCollapsed();
    state[slGroupKey(panel)] = collapsed;
    slSaveCollapsed(state);
  }
}

/** Give a task pane group its collapse button (once) and its saved state. */
function slPrepareGroup(panel: HTMLElement): void {
  const head = panel.querySelector<HTMLElement>('.panel__head');
  if (!head) return;
  if (!panel.id) panel.id = `${slGroupKey(panel)}Group`;
  if (!head.querySelector('.xp-group__toggle')) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'xp-group__toggle';
    toggle.setAttribute('aria-controls', panel.id);
    toggle.addEventListener('click', () => slSetCollapsed(panel, !panel.classList.contains('is-collapsed')));
    head.appendChild(toggle);
  }
  slSetCollapsed(panel, slReadCollapsed()[slGroupKey(panel)] === true, false);
}

// ---------------------------------------------------------------------------
// Mix tasks: links to actions that live elsewhere
// ---------------------------------------------------------------------------

/**
 * A task link mirrors a button (its label, hidden and disabled) and presses
 * it, or brings a field into view in its group and focuses it.
 */
function slWireTasks(pane: HTMLElement): void {
  pane.querySelectorAll<HTMLButtonElement>('[data-proxy]').forEach((link) => {
    const source = slById<HTMLButtonElement>(link.dataset.proxy!);
    if (!source) {
      link.hidden = true;
      return;
    }
    const sync = () => {
      link.textContent = source.textContent?.trim() || '';
      link.hidden = source.hidden;
      link.disabled = source.disabled;
    };
    new MutationObserver(sync).observe(source, { attributes: true, childList: true, characterData: true, subtree: true });
    link.addEventListener('click', () => source.click());
    sync();
  });
  pane.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((link) => {
    link.addEventListener('click', () => {
      const field = slById<HTMLElement>(link.dataset.focus!);
      if (!field) return;
      const group = field.closest<HTMLElement>('.xp-pane > .panel');
      if (group?.classList.contains('is-collapsed')) slSetCollapsed(group, false);
      field.scrollIntoView({ block: 'nearest' });
      field.focus();
    });
  });
}

// ---------------------------------------------------------------------------
// Arranging
// ---------------------------------------------------------------------------

function slArrange(): void {
  const shell = slById('xpShell');
  const toolbar = slById('xpToolbar');
  const pane = slById('xpPane');
  const main = slById('xpMain');
  const stage = slById('stage');
  if (!shell || !toolbar || !pane || !main || !stage) return;

  // Toolbar: transport first, then the repeat switch and the volume.
  slMove(document.querySelector('.deck .transport'), toolbar, toolbar.firstChild);
  slMove(slById('loopSwitch'), slById('xpRepeat'));
  slMove(document.querySelector('.deck .output'), toolbar);

  // Main view: the stage, with the timeline under "Now playing", then the channels.
  slMove(slById('stageWrap'), main);
  slMove(slById('scrub'), stage, stage.querySelector('.now__meta')?.nextSibling ?? null);
  const playing = slById('xpPlaying');
  slMove(slById('thumbStrip'), playing);
  if (playing) playing.hidden = false;
  slMove(document.querySelector('.panel.channels'), main);

  // Task pane: after Mix tasks, the other panels as groups.
  for (const selector of ['.panel.mixes', '.panel.status', '.panel.devices', '.panel.screen', '.panel.skins']) {
    slMove(document.querySelector(selector), pane);
  }
  pane.querySelectorAll<HTMLElement>(':scope > .panel').forEach(slPrepareGroup);

  shell.hidden = false;
}

function slUnarrange(): void {
  const shell = slById('xpShell');
  if (shell) shell.hidden = true;
  const playing = slById('xpPlaying');
  if (playing) playing.hidden = true;
  slRestoreAll();
}

function slApply(): void {
  if (slArranged()) slArrange();
  else if (slHomes.size) slUnarrange();
}

export function setupSkinLayout(): void {
  const pane = slById('xpPane');
  if (pane) slWireTasks(pane);
  slApply();
  // Runs before src/layout.ts re-measures (it waits a frame), so it measures
  // the page as it will be.
  window.addEventListener(SKIN_EVENT, slApply);
}
