/**
 * Layout behaviour that CSS can't do alone.
 *
 * Vertical screens (portrait): the stage (artwork, numbered strip, title) is
 * pinned to the top of the scroller and shrinks as you scroll, from its full
 * size down to a minimum height; after that the panels (deck, channels,
 * status + mixes) scroll up under it and snap one at a time, like the
 * horizontal layout's pages.
 *
 * Horizontal screens (landscape): the stage stays still on the left and the
 * panels swipe vertically on the right, one screen each.
 *
 * Both move between panels with a vertical swipe (a sideways swipe too
 * easily caught the timeline or volume sliders). The pager bars show which
 * panel is in view and jump on tap.
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
}

/** The panel in view, as an index into lSlideEls. */
function currentIndex(): number {
  const pages = visibleSlides();
  if (!pages.length) return 0;
  if (isPortrait()) {
    // Scrolled to the very end: the last panel, even if it's too short to
    // reach the top.
    const atEnd = lScroller.scrollTop > 0 && lScroller.scrollTop + lScroller.clientHeight >= lScroller.scrollHeight - 4;
    if (atEnd) return lSlideEls.indexOf(pages[pages.length - 1]);
    // Otherwise the last panel whose top has passed a line a third of the
    // way down the space under the stage.
    const stageBottom = lStageWrap.getBoundingClientRect().bottom;
    const line = stageBottom + (lScroller.getBoundingClientRect().bottom - stageBottom) / 3;
    let found = pages[0];
    for (const page of pages) if (page.getBoundingClientRect().top <= line) found = page;
    return lSlideEls.indexOf(found);
  }
  const size = lSlides.clientHeight || 1;
  const page = Math.max(0, Math.min(pages.length - 1, Math.round(lSlides.scrollTop / size)));
  return lSlideEls.indexOf(pages[page]);
}

/** Portrait: the scroller position that puts a panel just under the collapsed stage. */
function portraitTop(index: number): number {
  const pages = visibleSlides();
  const slide = lSlideEls[index];
  if (!slide || pages.indexOf(slide) <= 0) return 0;
  const top = slide.getBoundingClientRect().top - lScroller.getBoundingClientRect().top + lScroller.scrollTop;
  const pinned = lStageWrap.offsetHeight - range;
  return Math.max(0, Math.round(top - pinned));
}

/** Show a panel: 0 deck, 1 channels, 2 status and saved mixes. */
export function goToSlide(index: number): void {
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (isPortrait()) {
    lScroller.scrollTo({ top: portraitTop(index), behavior });
    return;
  }
  const page = Math.max(0, visibleSlides().indexOf(lSlideEls[index]));
  lSlides.scrollTo({ top: page * lSlides.clientHeight, behavior });
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
  ['--deck-snap', '--pinned-h', '--page-h'].forEach((name) => lScroller.style.removeProperty(name));
  if (!isPortrait()) {
    artMaxH = artMinH = range = 0;
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
  const stageH = artMaxH + meta + gap + padY;
  lStageWrap.style.height = `${stageH}px`;
  lStageWrap.style.top = `${-range}px`;
  // Snapping (styles.css): each panel fills the space under the collapsed
  // stage; the deck also stops with the artwork at full size (scrollTop 0).
  const slidesGap = parseFloat(getComputedStyle(lSlides).marginTop) || 0;
  lScroller.style.setProperty('--deck-snap', `${range + slidesGap}px`);
  lScroller.style.setProperty('--pinned-h', `${stageH - range}px`);
  lScroller.style.setProperty('--page-h', `${lScroller.clientHeight - (stageH - range)}px`);
  applyCollapse();
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
  if (collapseFrame) return;
  collapseFrame = requestAnimationFrame(() => {
    applyCollapse();
    if (isPortrait()) setActive(currentIndex());
  });
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
        if (!isPortrait()) setActive(currentIndex());
      });
    },
    { passive: true }
  );

  lScroller.addEventListener('scroll', onScrollerScroll, { passive: true });

  // A plain resize keeps the page where it is on vertical screens (moving it
  // would scroll on its own); horizontal panels re-align to their page.
  const relayout = (rotated: boolean) => {
    applyMerge();
    refreshLayout();
    if (rotated || !isPortrait()) goToSlideInstant(activeSlide);
  };
  window.addEventListener('resize', () => relayout(false));
  // The space under the brand can change without a window resize (the
  // brand's status line wrapping, fonts loading), and the stage's text with
  // the channel; the snap sizes follow.
  let measured = '';
  const remeasure = new ResizeObserver(() => {
    const key = `${lScroller.clientWidth}x${lScroller.clientHeight}:${lStage.querySelector<HTMLElement>('.now__meta')?.offsetHeight}`;
    if (key !== measured) {
      measured = key;
      refreshLayout();
    }
  });
  remeasure.observe(lScroller);
  const metaEl = lStage.querySelector<HTMLElement>('.now__meta');
  if (metaEl) remeasure.observe(metaEl);
  portraitQuery.addEventListener('change', () => relayout(true));
  mergeQuery.addEventListener('change', () => relayout(false));

  refreshLayout();
}

/** After a resize or rotation, keep the same panel in view without animating. */
function goToSlideInstant(index: number): void {
  if (isPortrait()) {
    lScroller.scrollTop = portraitTop(index);
    return;
  }
  const page = Math.max(0, visibleSlides().indexOf(lSlideEls[index]));
  lSlides.scrollTop = page * lSlides.clientHeight;
}
