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
const byId = (id) => document.getElementById(id);
const lScroller = byId('scroller');
const lStageWrap = byId('stageWrap');
const lStage = byId('stage');
const lArt = byId('art');
const lSlides = byId('slides');
const lPager = byId('pager');
const lSlideEls = Array.from(lSlides.querySelectorAll('.slide'));
const lBars = Array.from(lPager.querySelectorAll('.pager__bar'));
let activeSlide = 0;
let artMaxH = 0;
let artMinH = 0;
let collapseFrame = 0;
function isPortrait() {
    return portraitQuery.matches;
}
// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------
function setActive(index) {
    if (index === activeSlide)
        return;
    activeSlide = index;
    lBars.forEach((bar, i) => bar.setAttribute('aria-current', String(i === index)));
    lSlideEls.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
    syncSlidesHeight();
}
function currentIndex() {
    if (isPortrait()) {
        const w = lSlides.clientWidth || 1;
        return Math.max(0, Math.min(lSlideEls.length - 1, Math.round(lSlides.scrollLeft / w)));
    }
    const h = lSlides.clientHeight || 1;
    return Math.max(0, Math.min(lSlideEls.length - 1, Math.round(lSlides.scrollTop / h)));
}
/** Show a panel: 0 deck, 1 channels, 2 status and saved mixes. */
export function goToSlide(index) {
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (isPortrait())
        lSlides.scrollTo({ left: index * lSlides.clientWidth, behavior });
    else
        lSlides.scrollTo({ top: index * lSlides.clientHeight, behavior });
}
// ---------------------------------------------------------------------------
// Portrait: the panels' box takes exactly the height of the panel in view,
// so scrolling stops when its bottom is reached.
// ---------------------------------------------------------------------------
function syncSlidesHeight() {
    if (!isPortrait()) {
        lSlides.style.height = '';
        return;
    }
    const panel = lSlideEls[activeSlide];
    if (panel)
        lSlides.style.height = `${panel.scrollHeight}px`;
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
export function refreshLayout() {
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
    const meta = lStage.querySelector('.now__meta')?.offsetHeight ?? 0;
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
function applyCollapse() {
    collapseFrame = 0;
    if (!isPortrait() || !artMaxH)
        return;
    const c = Math.max(0, Math.min(range, lScroller.scrollTop));
    lArt.style.height = `${artMaxH - c}px`;
    lStage.style.transform = c ? `translate3d(0, ${c}px, 0)` : '';
    lStageWrap.classList.toggle('is-collapsed', c >= range - 1);
}
function onScrollerScroll() {
    if (!collapseFrame)
        collapseFrame = requestAnimationFrame(applyCollapse);
}
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
export function setupLayout() {
    lBars.forEach((bar, i) => bar.addEventListener('click', () => goToSlide(i)));
    lSlideEls.forEach((slide, i) => slide.classList.toggle('is-active', i === 0));
    let slideFrame = 0;
    lSlides.addEventListener('scroll', () => {
        if (slideFrame)
            return;
        slideFrame = requestAnimationFrame(() => {
            slideFrame = 0;
            setActive(currentIndex());
        });
    }, { passive: true });
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
function goToSlideInstant(index) {
    if (isPortrait())
        lSlides.scrollLeft = index * lSlides.clientWidth;
    else
        lSlides.scrollTop = index * lSlides.clientHeight;
}
