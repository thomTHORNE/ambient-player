/**
 * Layout behaviour that CSS can't do alone.
 *
 * Vertical screens (portrait): the stage (artwork, numbered strip, title) is
 * pinned to the top of the scroller and shrinks as you scroll, from its full
 * size down to a minimum height; after that the panels scroll under it. The
 * panels (deck, channels, status + mixes) sit side by side and swipe
 * horizontally; their box takes the height of the panel in view.
 *
 * Horizontal screens (landscape): the stage stays still on the left and the
 * panels swipe vertically on the right, one screen each.
 *
 * In both, the pager bars show which panel is in view and jump on tap.
 */

import { prefersReducedMotion } from './ui.js';

const portraitQuery = window.matchMedia('(orientation: portrait)');

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const lScroller = byId<HTMLElement>('scroller');
const lStageWrap = byId<HTMLElement>('stageWrap');
const lStage = byId<HTMLElement>('stage');
const lArt = byId<HTMLElement>('art');
const lSlides = byId<HTMLElement>('slides');
const lPager = byId<HTMLElement>('pager');
const lSlideEls = Array.from(lSlides.querySelectorAll<HTMLElement>('.slide'));
const lBars = Array.from(lPager.querySelectorAll<HTMLButtonElement>('.pager__bar'));

let activeSlide = 0;
let artMaxH = 0;
let artMinH = 0;
let collapseFrame = 0;

function isPortrait(): boolean {
  return portraitQuery.matches;
}

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------

function setActive(index: number): void {
  if (index === activeSlide) return;
  activeSlide = index;
  lBars.forEach((bar, i) => bar.setAttribute('aria-current', String(i === index)));
  lSlideEls.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
  syncSlidesHeight();
}

function currentIndex(): number {
  if (isPortrait()) {
    const w = lSlides.clientWidth || 1;
    return Math.max(0, Math.min(lSlideEls.length - 1, Math.round(lSlides.scrollLeft / w)));
  }
  const h = lSlides.clientHeight || 1;
  return Math.max(0, Math.min(lSlideEls.length - 1, Math.round(lSlides.scrollTop / h)));
}

/** Show a panel: 0 deck, 1 channels, 2 status and saved mixes. */
export function goToSlide(index: number): void {
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (isPortrait()) lSlides.scrollTo({ left: index * lSlides.clientWidth, behavior });
  else lSlides.scrollTo({ top: index * lSlides.clientHeight, behavior });
}

// ---------------------------------------------------------------------------
// Portrait: the panels' box follows the panel in view, and is always tall
// enough to scroll the stage all the way down to its minimum size.
// ---------------------------------------------------------------------------

function syncSlidesHeight(): void {
  if (!isPortrait()) {
    lSlides.style.height = '';
    return;
  }
  const panel = lSlideEls[activeSlide];
  if (!panel) return;
  const stageMin = lStageWrap.offsetHeight - (lArt.offsetHeight - artMinH);
  const fill = Math.max(0, lScroller.clientHeight - stageMin);
  lSlides.style.height = `${Math.max(panel.scrollHeight, fill)}px`;
}

// ---------------------------------------------------------------------------
// Portrait: the collapsing stage
// ---------------------------------------------------------------------------

/** Re-measure the artwork's full and minimum heights (after resize or a new shape). */
export function refreshLayout(): void {
  if (!isPortrait()) {
    lArt.style.height = '';
    lScroller.style.removeProperty('--collapse');
    artMaxH = artMinH = 0;
    syncSlidesHeight();
    return;
  }
  lArt.style.height = '';
  const ratio = lStage.dataset.shape === 'square' ? 1 : 16 / 9;
  const width = lArt.clientWidth;
  artMaxH = Math.round(Math.min(width / ratio, window.innerHeight * 0.6));
  artMinH = Math.round(Math.min(artMaxH, Math.max(84, window.innerHeight * 0.12)));
  applyCollapse();
  syncSlidesHeight();
}

function applyCollapse(): void {
  collapseFrame = 0;
  if (!isPortrait() || !artMaxH) return;
  const range = artMaxH - artMinH;
  const c = Math.max(0, Math.min(range, lScroller.scrollTop));
  lArt.style.height = `${artMaxH - c}px`;
  // A spacer of the same size keeps the panels' place, so they follow the
  // shrinking stage instead of jumping.
  lScroller.style.setProperty('--collapse', `${c}px`);
  lStageWrap.classList.toggle('is-collapsed', c >= range - 1);
}

function onScrollerScroll(): void {
  if (!collapseFrame) collapseFrame = requestAnimationFrame(applyCollapse);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export function setupLayout(): void {
  lBars.forEach((bar, i) => bar.addEventListener('click', () => goToSlide(i)));
  lSlideEls.forEach((slide, i) => slide.classList.toggle('is-active', i === 0));

  let slideFrame = 0;
  lSlides.addEventListener(
    'scroll',
    () => {
      if (slideFrame) return;
      slideFrame = requestAnimationFrame(() => {
        slideFrame = 0;
        setActive(currentIndex());
      });
    },
    { passive: true }
  );

  lScroller.addEventListener('scroll', onScrollerScroll, { passive: true });

  // Panels change height as channels load, drawers open and so on.
  const observer = new ResizeObserver(() => syncSlidesHeight());
  lSlideEls.forEach((slide) => observer.observe(slide));

  const relayout = () => {
    refreshLayout();
    goToSlideInstant(activeSlide);
  };
  window.addEventListener('resize', relayout);
  portraitQuery.addEventListener('change', relayout);

  refreshLayout();
}

/** After a resize or rotation, keep the same panel in view without animating. */
function goToSlideInstant(index: number): void {
  if (isPortrait()) lSlides.scrollLeft = index * lSlides.clientWidth;
  else lSlides.scrollTop = index * lSlides.clientHeight;
}
