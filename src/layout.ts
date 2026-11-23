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
/** Large horizontal screens (a Fold's inner display at 4:3 and up) have room
 *  for the deck and the channel list on one panel. Keep in sync with styles.css. */
const mergeQuery = window.matchMedia('(orientation: landscape) and (min-width: 960px) and (min-height: 680px)');

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const lScroller = byId<HTMLElement>('scroller');
const lStageWrap = byId<HTMLElement>('stageWrap');
const lStage = byId<HTMLElement>('stage');
const lArt = byId<HTMLElement>('art');
const lSlides = byId<HTMLElement>('slides');
const lPager = byId<HTMLElement>('pager');
const lSlideEls = Array.from(lSlides.querySelectorAll<HTMLElement>('.slide'));
const lBars = Array.from(lPager.querySelectorAll<HTMLButtonElement>('.pager__bar'));
const lDeckSlide = byId<HTMLElement>('slideDeck');
const lChannelsSlide = byId<HTMLElement>('slideChannels');
const lChannelsPanel = lChannelsSlide.querySelector<HTMLElement>('.panel.channels')!;

/** Index into lSlideEls of the panel in view. */
let activeSlide = 0;
let artMaxH = 0;
let artMinH = 0;
let collapseFrame = 0;

function isPortrait(): boolean {
  return portraitQuery.matches;
}

// ---------------------------------------------------------------------------
// Merged panel on large horizontal screens
// ---------------------------------------------------------------------------

/** Put the channel list on the deck's panel (large screens) or its own (others). */
function applyMerge(): void {
  const merged = mergeQuery.matches;
  document.documentElement.dataset.merged = String(merged);
  const home = merged ? lDeckSlide : lChannelsSlide;
  if (lChannelsPanel.parentElement !== home) home.appendChild(lChannelsPanel);
  // The channels bar leads to the merged panel, like the deck's.
  lBars.forEach((bar) => {
    bar.hidden = merged && bar.dataset.slide === '1';
  });
  if (merged && activeSlide === 1) activeSlide = 0;
}

/** The panels that currently take a page each (the merged one is hidden). */
function visibleSlides(): HTMLElement[] {
  return lSlideEls.filter((slide) => getComputedStyle(slide).display !== 'none');
}

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------

function setActive(index: number): void {
  if (index === activeSlide) return;
  activeSlide = index;
  lBars.forEach((bar) => bar.setAttribute('aria-current', String(Number(bar.dataset.slide) === index)));
  lSlideEls.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
  syncSlidesHeight();
}

/** The panel in view, as an index into lSlideEls. */
function currentIndex(): number {
  const pages = visibleSlides();
  const size = isPortrait() ? lSlides.clientWidth || 1 : lSlides.clientHeight || 1;
  const pos = isPortrait() ? lSlides.scrollLeft : lSlides.scrollTop;
  const page = Math.max(0, Math.min(pages.length - 1, Math.round(pos / size)));
  return lSlideEls.indexOf(pages[page]);
}

/** Show a panel: 0 deck, 1 channels, 2 status and saved mixes. */
export function goToSlide(index: number): void {
  const page = Math.max(0, visibleSlides().indexOf(lSlideEls[index]));
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (isPortrait()) lSlides.scrollTo({ left: page * lSlides.clientWidth, behavior });
  else lSlides.scrollTo({ top: page * lSlides.clientHeight, behavior });
}

// ---------------------------------------------------------------------------
// Portrait: the panels' box takes exactly the height of the panel in view,
// so scrolling stops when its bottom is reached.
// ---------------------------------------------------------------------------

function syncSlidesHeight(): void {
  if (!isPortrait()) {
    lSlides.style.height = '';
    return;
  }
  const panel = lSlideEls[activeSlide];
  if (panel) lSlides.style.height = `${panel.scrollHeight}px`;
}

// ---------------------------------------------------------------------------
// Portrait: the collapsing stage
//
// The stage keeps one fixed height in the flow and is pinned with a negative
// top of `range`, so the page below it never moves out of step. While
// scrolling through that range only two things change: the artwork's height
// (a small layout inside the stage) and a translate that keeps the shrinking
// artwork at the top of the screen (composited). The frame size never depends
// on the channel's thumbnail, so switching channels doesn't resize it.
// ---------------------------------------------------------------------------

let range = 0;

/** Re-measure the stage (after a resize or rotation). */
export function refreshLayout(): void {
  lArt.style.height = '';
  lStage.style.transform = '';
  lStageWrap.style.height = '';
  lStageWrap.style.top = '';
  if (!isPortrait()) {
    artMaxH = artMinH = range = 0;
    syncSlidesHeight();
    return;
  }
  const wrapStyle = getComputedStyle(lStageWrap);
  const padY = parseFloat(wrapStyle.paddingTop) + parseFloat(wrapStyle.paddingBottom);
  const gap = parseFloat(getComputedStyle(lStage).rowGap) || 0;
  const meta = lStage.querySelector<HTMLElement>('.now__meta')?.offsetHeight ?? 0;
  // The upper part may take at most half of the space under the brand.
  const stageMax = lScroller.clientHeight * 0.5;
  const width = lArt.clientWidth;
  artMaxH = Math.round(Math.max(120, Math.min(width, stageMax - padY - gap - meta)));
  artMinH = Math.round(Math.min(artMaxH, Math.max(72, window.innerHeight * 0.1)));
  range = artMaxH - artMinH;
  lStageWrap.style.height = `${artMaxH + meta + gap + padY}px`;
  lStageWrap.style.top = `${-range}px`;
  applyCollapse();
  syncSlidesHeight();
}

function applyCollapse(): void {
  collapseFrame = 0;
  if (!isPortrait() || !artMaxH) return;
  const c = Math.max(0, Math.min(range, lScroller.scrollTop));
  lArt.style.height = `${artMaxH - c}px`;
  lStage.style.transform = c ? `translate3d(0, ${c}px, 0)` : '';
  lStageWrap.classList.toggle('is-collapsed', c >= range - 1);
}

function onScrollerScroll(): void {
  if (!collapseFrame) collapseFrame = requestAnimationFrame(applyCollapse);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export function setupLayout(): void {
  applyMerge();
  lBars.forEach((bar) => bar.addEventListener('click', () => goToSlide(Number(bar.dataset.slide))));
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
    applyMerge();
    refreshLayout();
    goToSlideInstant(activeSlide);
  };
  window.addEventListener('resize', relayout);
  portraitQuery.addEventListener('change', relayout);
  mergeQuery.addEventListener('change', relayout);

  refreshLayout();
}

/** After a resize or rotation, keep the same panel in view without animating. */
function goToSlideInstant(index: number): void {
  const page = Math.max(0, visibleSlides().indexOf(lSlideEls[index]));
  if (isPortrait()) lSlides.scrollLeft = page * lSlides.clientWidth;
  else lSlides.scrollTop = page * lSlides.clientHeight;
}
