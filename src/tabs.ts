/**
 * Tabs: a tab list that shows one of its panels at a time (the Settings
 * page: Devices, Screen effect, Skins, Layout).
 *
 * Markup (index.html): a [role="tablist"][data-tabs="<name>"] of
 * [role="tab"] buttons, each with aria-controls naming a .tabpanel that is
 * a sibling of the tab list. styles.css hides the panels that aren't
 * .is-active, only while they sit in the tab list's parent, so a skin that
 * moves them elsewhere (Windows XP's task pane, src/skinLayout.ts) shows
 * them all; syncTabs() then drops their tab panel semantics, and puts them
 * back when the panels return.
 *
 * Keyboard: Left / Right move between tabs (and show them), Home / End go
 * to the first and last. The chosen tab is kept on this device.
 */

const TABS_KEY = (name: string) => `ambient-player:tabs:${name}`;

interface TabSet {
  name: string;
  list: HTMLElement;
  tabs: HTMLButtonElement[];
}

const tabSets: TabSet[] = [];

function tabPanel(tab: HTMLElement): HTMLElement | null {
  const id = tab.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

function selectTab(set: TabSet, chosen: HTMLButtonElement, save = true): void {
  set.tabs.forEach((tab) => {
    const on = tab === chosen;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    tabPanel(tab)?.classList.toggle('is-active', on);
  });
  if (save) {
    try {
      localStorage.setItem(TABS_KEY(set.name), chosen.id);
    } catch {
      // Not kept; it still shows for this visit.
    }
  }
}

/**
 * Tab panel semantics for the panels that sit with their tab list; none for
 * those a skin has moved elsewhere (their own heading labels them then).
 */
export function syncTabs(): void {
  for (const set of tabSets) {
    const host = set.list.parentElement;
    for (const tab of set.tabs) {
      const panel = tabPanel(tab);
      if (!panel) continue;
      if (panel.dataset.ownLabel === undefined) panel.dataset.ownLabel = panel.getAttribute('aria-labelledby') ?? '';
      if (panel.parentElement === host) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
      } else {
        panel.removeAttribute('role');
        if (panel.dataset.ownLabel) panel.setAttribute('aria-labelledby', panel.dataset.ownLabel);
        else panel.removeAttribute('aria-labelledby');
      }
    }
  }
}

export function setupTabs(): void {
  document.querySelectorAll<HTMLElement>('[role="tablist"][data-tabs]').forEach((list) => {
    const set: TabSet = {
      name: list.dataset.tabs!,
      list,
      tabs: Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]')),
    };
    if (!set.tabs.length) return;
    tabSets.push(set);

    set.tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(set, tab)));
    list.addEventListener('keydown', (e) => {
      const i = set.tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      const last = set.tabs.length - 1;
      const next =
        e.key === 'ArrowRight' ? (i + 1) % set.tabs.length
        : e.key === 'ArrowLeft' ? (i - 1 + set.tabs.length) % set.tabs.length
        : e.key === 'Home' ? 0
        : e.key === 'End' ? last
        : -1;
      if (next < 0) return;
      e.preventDefault();
      selectTab(set, set.tabs[next]);
      set.tabs[next].focus();
    });

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(TABS_KEY(set.name));
    } catch {
      // The first tab, then.
    }
    selectTab(set, set.tabs.find((t) => t.id === saved) ?? set.tabs[0], false);
  });
  syncTabs();
}

/** Show a tab by its id (for links into a section). */
export function showTab(tabId: string): void {
  for (const set of tabSets) {
    const tab = set.tabs.find((t) => t.id === tabId);
    if (tab) selectTab(set, tab);
  }
}
