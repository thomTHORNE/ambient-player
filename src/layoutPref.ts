/**
 * Layout choice: Auto (the layout follows the screen) or Stacked (the
 * vertical phone layout on any screen, out of preference).
 *
 * The choice is remembered per screen, keyed by the screen's physical size,
 * which doesn't change when it rotates. A Fold's cover and inner displays
 * have different sizes, so Stacked on one leaves the other on Auto.
 *
 * src/layout.ts turns the choice and the screen into the page's layout
 * markers; the inline script in index.html does the same before the first
 * paint (keep the two in sync).
 */

export type LayoutChoice = 'auto' | 'stacked';

const LAYOUT_KEY = 'ambient-player:layout';
/** Fired on window when the choice changes. */
export const LAYOUT_CHOICE_EVENT = 'ambient:layout-choice';

/** This screen's size, the same in either orientation. */
function screenKey(): string {
  const a = window.screen.width;
  const b = window.screen.height;
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
}

/** Loaded once; kept here too, so a choice holds even where storage fails. */
let choiceCache: Record<string, string> | null = null;

function readChoices(): Record<string, string> {
  if (choiceCache) return choiceCache;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    choiceCache = value && typeof value === 'object' ? (value as Record<string, string>) : {};
  } catch {
    choiceCache = {};
  }
  return choiceCache;
}

export function layoutChoice(): LayoutChoice {
  return readChoices()[screenKey()] === 'stacked' ? 'stacked' : 'auto';
}

export function setLayoutChoice(choice: LayoutChoice): void {
  const choices = readChoices();
  if (choice === 'auto') delete choices[screenKey()];
  else choices[screenKey()] = choice;
  try {
    if (Object.keys(choices).length) localStorage.setItem(LAYOUT_KEY, JSON.stringify(choices));
    else localStorage.removeItem(LAYOUT_KEY);
  } catch {
    // Not saved; it still applies for this visit.
  }
  window.dispatchEvent(new Event(LAYOUT_CHOICE_EVENT));
}
