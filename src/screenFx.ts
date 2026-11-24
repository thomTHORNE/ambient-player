/**
 * Screen effect settings (the last panel): which style of screen the
 * artwork is shown on, how much of it (Mix), and the fine-tune sliders.
 *
 * - The dial is a rotary switch: each tap (or arrow key) turns it to the next
 *   style. A style is a full set of --crt-* values for src/crt.ts.
 * - Mix fades the effect over the plain picture. It is CSS only (the
 *   canvas's opacity), so it never re-renders.
 * - Fine-tune shows every setting as a slider; moving one makes the style
 *   "tuned" until the dial turns or "Back to the style's settings" is tapped.
 *
 * Everything is kept on the device under ambient-player:screen.
 */

import { FX_CHANGE_EVENT } from './crt.js';

interface ScreenStyle {
  name: string;
  note: string;
  values: Record<string, string>;
}

interface ScreenState {
  style: string;
  mix: number;
  tuned: Record<string, string>;
}

const SCREEN_KEY = 'ambient-player:screen';

const sfxStyle = (
  pitch: number, cell: number, gap: number, gapDark: number, stagger: number, bleed: number, edge: number,
  boost: number, glow: number, glowRadius: number, srcBlur: number, gray: number, tint: number,
  tintColor: string, contrast: number, bright: number, soft: number
): Record<string, string> => ({
  '--crt-pitch': `${pitch}px`,
  '--crt-cell': `${cell}px`,
  '--crt-gap': `${gap}px`,
  '--crt-gap-dark': String(gapDark),
  '--crt-stagger': String(stagger),
  '--crt-bleed': String(bleed),
  '--crt-edge': String(edge),
  '--crt-boost': String(boost),
  '--crt-glow': String(glow),
  '--crt-glow-radius': `${glowRadius}px`,
  '--crt-src-blur': String(srcBlur),
  '--crt-gray': String(gray),
  '--crt-tint': String(tint),
  '--crt-tint-color': tintColor,
  '--crt-contrast': String(contrast),
  '--crt-bright': String(bright),
  '--crt-soft': `${soft}px`,
});

/** In the dial's order. The first is the default. */
const SCREEN_STYLES: ScreenStyle[] = [
  {
    name: 'Slot mask',
    note: 'A classic TV mask: short, bright cells with clear gaps and a half-cell offset.',
    values: sfxStyle(6, 6, 1.5, 0.2, 1, 0.4, 0.85, 2.5, 0.35, 2.5, 1, 0.5, 0.45, '#50667A', 0.95, 1, 0.35),
  },
  {
    name: 'Hero',
    note: 'Fine, even columns over a blurred picture: small cells, heavy defocus, a muted cold grade.',
    values: sfxStyle(4, 5, 1, 0.45, 1, 0.65, 0.8, 2, 0.3, 3, 2.5, 0.6, 0.55, '#50667A', 0.85, 1, 0.6),
  },
  {
    name: 'Close-up',
    note: 'Tall cells in staggered columns with thin dark gaps; cyan and red columns show through.',
    values: sfxStyle(7.5, 9, 1.25, 0.3, 1, 0.5, 0.9, 2.3, 0.3, 2.5, 1.25, 0.5, 0.45, '#4E7480', 0.9, 1, 0.5),
  },
  {
    name: 'LED wall',
    note: 'Discrete square emitters on a dark board: little bleed, strong gaps, more glow.',
    values: sfxStyle(6, 6, 1.75, 0.1, 0, 0.3, 0.95, 2.8, 0.45, 3, 1, 0.4, 0.4, '#50667A', 1, 1, 0.3),
  },
  {
    name: 'Photographed',
    note: 'The screen as a camera saw it: soft focus, wide glow, washed-out blacks.',
    values: sfxStyle(5, 6, 1, 0.5, 1, 0.7, 0.75, 1.9, 0.5, 5, 3, 0.65, 0.6, '#526B7E', 0.8, 1.06, 1),
  },
];

/** The fine-tune sliders. */
const SCREEN_CONTROLS: { name: string; label: string; min?: number; max?: number; step?: number; unit?: string; color?: boolean }[] = [
  { name: '--crt-pitch', label: 'Cell width (R G B)', min: 1.5, max: 12, step: 0.25, unit: 'px' },
  { name: '--crt-cell', label: 'Cell height', min: 2, max: 16, step: 0.5, unit: 'px' },
  { name: '--crt-gap', label: 'Gap between cells', min: 0, max: 4, step: 0.25, unit: 'px' },
  { name: '--crt-gap-dark', label: 'Gap brightness', min: 0, max: 1, step: 0.05 },
  { name: '--crt-stagger', label: 'Offset columns', min: 0, max: 1, step: 1 },
  { name: '--crt-bleed', label: 'Colour bleed', min: 0, max: 1, step: 0.05 },
  { name: '--crt-edge', label: 'Stripe falloff', min: 0, max: 1, step: 0.05 },
  { name: '--crt-boost', label: 'Phosphor boost', min: 0.5, max: 3.5, step: 0.05 },
  { name: '--crt-glow', label: 'Glow', min: 0, max: 1, step: 0.05 },
  { name: '--crt-glow-radius', label: 'Glow radius', min: 0, max: 10, step: 0.5, unit: 'px' },
  { name: '--crt-src-blur', label: 'Defocus', min: 0, max: 6, step: 0.25 },
  { name: '--crt-gray', label: 'Desaturate', min: 0, max: 1, step: 0.05 },
  { name: '--crt-tint', label: 'Tint', min: 0, max: 1, step: 0.05 },
  { name: '--crt-tint-color', label: 'Tint colour', color: true },
  { name: '--crt-contrast', label: 'Contrast', min: 0.4, max: 1.6, step: 0.05 },
  { name: '--crt-bright', label: 'Brightness', min: 0.4, max: 1.6, step: 0.02 },
  { name: '--crt-soft', label: 'Softness', min: 0, max: 2, step: 0.05, unit: 'px' },
];

/** Cells in the mix meter. */
const MIX_TRIADS = 14;
/** The dial's sweep: the first style at -120°, the last at +120°. */
const DIAL_SWEEP = 240;

function loadScreenState(): ScreenState {
  const fallback: ScreenState = { style: SCREEN_STYLES[0].name, mix: 1, tuned: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(SCREEN_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const style = SCREEN_STYLES.some((s) => s.name === raw.style) ? raw.style : fallback.style;
    const mix = typeof raw.mix === 'number' && raw.mix >= 0 && raw.mix <= 1 ? raw.mix : 1;
    const tuned = raw.tuned && typeof raw.tuned === 'object' ? raw.tuned : {};
    return { style, mix, tuned };
  } catch {
    return fallback;
  }
}

function saveScreenState(state: ScreenState): void {
  try {
    localStorage.setItem(SCREEN_KEY, JSON.stringify(state));
  } catch {
    // Not saved; it still applies for this visit.
  }
}

export function setupScreenControl(): void {
  const root = document.documentElement;
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const dial = byId<HTMLButtonElement>('screenDial');
  const ticks = byId<HTMLElement>('screenTicks');
  const styleName = byId<HTMLElement>('screenStyle');
  const step = byId<HTMLElement>('screenStep');
  const note = byId<HTMLElement>('screenNote');
  const mixInput = byId<HTMLInputElement>('mixInput');
  const mixReadout = byId<HTMLElement>('mixReadout');
  const mixCaption = byId<HTMLElement>('mixCaption');
  const meter = byId<HTMLElement>('mixMeter');
  const toggle = byId<HTMLButtonElement>('screenMoreToggle');
  const more = byId<HTMLElement>('screenMore');
  const sliders = byId<HTMLElement>('screenSliders');
  const reset = byId<HTMLButtonElement>('screenReset');
  if (!dial || !mixInput || !sliders) return;

  const state = loadScreenState();
  const styleIndex = () => Math.max(0, SCREEN_STYLES.findIndex((s) => s.name === state.style));
  const values = () => ({ ...SCREEN_STYLES[styleIndex()].values, ...state.tuned });

  // Dial detents and meter cells.
  ticks.innerHTML = SCREEN_STYLES.map((_, i) => {
    const angle = -DIAL_SWEEP / 2 + (DIAL_SWEEP * i) / (SCREEN_STYLES.length - 1);
    return `<span style="--t:${angle}deg"></span>`;
  }).join('');
  meter.innerHTML = Array.from({ length: MIX_TRIADS }, () => '<i><b></b><b></b><b></b></i>').join('');

  // Fine-tune sliders.
  const inputs = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>();
  sliders.innerHTML = '';
  SCREEN_CONTROLS.forEach((c) => {
    const row = document.createElement('label');
    row.className = 'screen__slider';
    const label = document.createElement('span');
    label.textContent = c.label;
    const out = document.createElement('output');
    const input = document.createElement('input');
    if (c.color) {
      input.type = 'color';
    } else {
      input.type = 'range';
      input.className = 'slider';
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = String(c.step);
    }
    input.addEventListener('input', () => {
      state.tuned[c.name] = c.color ? input.value.toUpperCase() : `${input.value}${c.unit ?? ''}`;
      saveScreenState(state);
      apply(true);
    });
    row.append(label, out, input);
    sliders.appendChild(row);
    inputs.set(c.name, { input, out });
  });

  /** Push the settings to the page; `rerender` redraws the screens. */
  function apply(rerender: boolean): void {
    const v = values();
    Object.entries(v).forEach(([name, value]) => root.style.setProperty(name, value));
    root.style.setProperty('--crt-mix', String(state.mix));
    render();
    if (rerender) window.dispatchEvent(new Event(FX_CHANGE_EVENT));
  }

  function render(): void {
    const i = styleIndex();
    const style = SCREEN_STYLES[i];
    const tuned = Object.keys(state.tuned).length > 0;
    const angle = -DIAL_SWEEP / 2 + (DIAL_SWEEP * i) / (SCREEN_STYLES.length - 1);
    dial.style.setProperty('--a', `${angle}deg`);
    Array.from(ticks.children).forEach((t, n) => t.classList.toggle('is-on', n === i));
    styleName.textContent = style.name + (tuned ? ' · tuned' : '');
    step.textContent = `${i + 1} / ${SCREEN_STYLES.length} · tap to turn`;
    dial.setAttribute('aria-label', `Screen style: ${style.name}${tuned ? ', tuned' : ''}. Tap for the next style.`);
    note.textContent = style.note;

    const pct = Math.round(state.mix * 100);
    if (document.activeElement !== mixInput) mixInput.value = String(pct);
    mixInput.style.setProperty('--v', `${pct}%`);
    mixInput.setAttribute('aria-valuetext', `${pct} percent of the effect`);
    mixReadout.textContent = `${pct} %`;
    mixCaption.textContent = pct === 0 ? 'Plain picture' : pct === 100 ? 'Full screen' : 'Blended';
    const lit = Math.round(state.mix * MIX_TRIADS);
    Array.from(meter.children).forEach((triad, n) => triad.classList.toggle('is-on', n < lit));

    const v = values();
    inputs.forEach(({ input, out }, name) => {
      const value = v[name] ?? '';
      if (document.activeElement !== input) input.value = input.type === 'color' ? value : String(parseFloat(value));
      if (input.type === 'range') {
        const pctOf = ((parseFloat(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
        input.style.setProperty('--v', `${pctOf}%`);
      }
      out.textContent = value;
    });
    reset.disabled = !tuned;
  }

  /** Turn the dial by `dir` styles (wrapping), dropping any fine-tuning. */
  function turn(dir: 1 | -1): void {
    const n = SCREEN_STYLES.length;
    state.style = SCREEN_STYLES[(styleIndex() + dir + n) % n].name;
    state.tuned = {};
    saveScreenState(state);
    apply(true);
  }

  dial.addEventListener('click', () => turn(1));
  dial.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      turn(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      turn(-1);
    }
  });

  mixInput.addEventListener('input', () => {
    state.mix = Number(mixInput.value) / 100;
    saveScreenState(state);
    apply(false);
  });

  toggle.addEventListener('click', () => {
    const open = more.hidden;
    more.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  reset.addEventListener('click', () => {
    state.tuned = {};
    saveScreenState(state);
    apply(true);
  });

  apply(true);
}
