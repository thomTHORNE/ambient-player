/**
 * Main entry point.
 *
 * The app mixes several YouTube streams at once. One channel at a time is
 * "focused": it fills the centre of the screen and the deck controls it.
 * Every channel stays playable from the channel list.
 */

import { PlaylistManager } from './playlist.js';
import type { Track, TrackId, YouTubeVideoMeta, TrackState, TrackError } from './playlist.js';
import {
  waitForYouTubeAPI,
  createYouTubePlayerFactory,
  extractVideoId,
  isValidYouTubeUrl,
} from './youtubePlayer.js';
import type { YouTubePlayerFactory } from './youtubePlayer.js';
import {
  saveOrUpdatePlaylist,
  saveMixResume,
  deletePlaylist,
  getLastPlaylist,
  getAllPlaylists,
} from './storage.js';
import {
  encodePlaylistToUrl,
  decodePlaylistFromLocation,
  decodePlaylistFromText,
  clearPlaylistHash,
} from './shareLinks.js';
import {
  channelRowHtml,
  patchChannelRow,
  stripItemHtml,
  thumbItemHtml,
  setRowDrawerOpen,
  setRowConfirm,
  renderSavedPlaylists,
  showReplaceAppendModal,
  showError,
  copyToClipboard,
  swapText,
  formatHMS,
  formatDb,
  pad2,
  icons,
  prefersReducedMotion,
  stateInfo,
  trackTitle,
} from './ui.js';
import type { StateTone } from './ui.js';
import { extractAccent, isSquareArt, FALLBACK_ACCENT } from './accent.js';
import { setupArtCrt, paintCrtThumbs, clearCrtThumbs, FX_CHANGE_EVENT } from './crt.js';
import { setBackdrop } from './backdrop.js';
import { setupScreenControl } from './screenFx.js';
import { dispatch, setCommandRunner, setCommandRoute } from './commands.js';
import { takeRelayOverride, takePairCodeFromLocation, pairCodeFromText } from './pairing.js';
import {
  connectRoom,
  setupReconnectTriggers,
  onConnection,
  claimMain,
  sendState,
  sendCommand,
  pendingCommands,
  onRemoteCommand,
  onRoomState,
  lastRoomState,
  onRelease,
  sendProbe,
} from './remote.js';
import type { ConnectionStatus, Role } from './remote.js';
import { setupDevicesPanel, joinWithCode } from './devices.js';
import type { Command } from './commands.js';
import { setupLayout } from './layout.js';
import { setupSkinPanel, SKIN_EVENT } from './skin.js';
import { setupSkinLayout } from './skinLayout.js';
import { setupTabs, showTab } from './tabs.js';
import { storedScale, applyScale, appZoom, SCALE_MIN, SCALE_MAX, SCALE_STEP } from './scale.js';
import { setupStageResize } from './resize.js';
import { layoutChoice, setLayoutChoice, LAYOUT_CHOICE_EVENT } from './layoutPref.js';
import type { LayoutChoice } from './layoutPref.js';
import {
  fullscreenSupported,
  isFullscreen,
  runningAsApp,
  runningAsFullscreenApp,
  enterFullscreen,
  exitFullscreen,
  onFullscreenChange,
  setKeepAwake,
} from './screen.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const playlistManager = new PlaylistManager();
let playerFactory: YouTubePlayerFactory;
let pollTimer: number | null = null;
let focusedId: TrackId | null = null;
let mixName: string | null = null;
let seeking = false;
/** Channels whose settings drawer is open in the list. */
const openDrawers = new Set<TrackId>();

const VOLUME_BARS = 14;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const urlInput = $<HTMLInputElement>('urlInput');
const addButton = $<HTMLButtonElement>('addButton');
const inputError = $<HTMLElement>('inputError');
const mixesMessage = $<HTMLElement>('mixesMessage');
const importInput = $<HTMLInputElement>('importInput');
const importButton = $<HTMLButtonElement>('importButton');
const globalPlayPauseButton = $<HTMLButtonElement>('globalPlayPause');
const resumeButton = $<HTMLButtonElement>('resumeButton');
const loopSwitch = $<HTMLButtonElement>('loopSwitch');
const shareButton = $<HTMLButtonElement>('shareButton');
const playlistNameInput = $<HTMLInputElement>('playlistNameInput');
const savePlaylistButton = $<HTMLButtonElement>('savePlaylistButton');
const savedPlaylistsList = $<HTMLElement>('savedPlaylistsList');
const channelList = $<HTMLOListElement>('playlist');
const channelCount = $<HTMLElement>('channelCount');
const playerBay = $<HTMLElement>('playerBay');

const fullscreenButton = $<HTMLButtonElement>('fullscreenButton');
const statusCode = $<HTMLElement>('statusCode');
const statusLine = $<HTMLElement>('statusLine');
const statDur = $<HTMLElement>('statDur');

const stage = $<HTMLElement>('stage');
const art = $<HTMLElement>('art');
const artImg = $<HTMLImageElement>('artImg');
const artPlay = $<HTMLButtonElement>('artPlay');
const mixStrip = $<HTMLOListElement>('mixStrip');
const thumbStrip = $<HTMLOListElement>('thumbStrip');
const stageIndex = $<HTMLElement>('stageIndex');
const stageState = $<HTMLElement>('stageState');
const stageArtist = $<HTMLElement>('stageArtist');
const stageTitle = $<HTMLElement>('stageTitle');

const scrub = $<HTMLElement>('scrub');
const seekInput = $<HTMLInputElement>('seekInput');
const scrubTime = $<HTMLElement>('scrubTime');
const scrubTicks = Array.from(document.querySelectorAll<HTMLElement>('[data-tick]'));

const prevButton = $<HTMLButtonElement>('prevButton');
const playButton = $<HTMLButtonElement>('playButton');
const nextButton = $<HTMLButtonElement>('nextButton');
const resetButton = $<HTMLButtonElement>('resetButton');

const volumeInput = $<HTMLInputElement>('volumeInput');
const volumeBars = $<HTMLElement>('volumeBars');
const volumeReadout = $<HTMLElement>('volumeReadout');
const volumeDb = $<HTMLElement>('volumeDb');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function focusedTrack(): Track | undefined {
  return focusedId ? playlistManager.getTrack(focusedId) : undefined;
}

/** The numbered strip beside the artwork and, on large horizontal screens,
 *  the thumbnail strip under the title (CSS shows one of them). */
const strips = [mixStrip, thumbStrip];

/** Scroll a strip (never the page) just enough to show a tile. */
function keepTileVisible(strip: HTMLElement, tile: HTMLElement): void {
  if (strip.scrollHeight <= strip.clientHeight + 1) return;
  const view = strip.getBoundingClientRect();
  const r = tile.getBoundingClientRect();
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (r.top < view.top) strip.scrollBy({ top: r.top - view.top - 6, behavior });
  else if (r.bottom > view.bottom) strip.scrollBy({ top: r.bottom - view.bottom + 6, behavior });
}

/** Both strips: only what's playing, each numbered by its position in the mix. */
function renderStrip(): void {
  const tracks = playlistManager.getTracks();
  const active = document.activeElement as HTMLElement | null;
  const hadFocus = strips.find((strip) => strip.contains(active));
  const focusId = hadFocus && active?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
  mixStrip.innerHTML = tracks
    .map((t, i) => (t.state === 'playing' ? stripItemHtml(t, i, t.id === focusedId) : ''))
    .join('');
  thumbStrip.innerHTML = tracks
    .map((t, i) => (t.state === 'playing' ? thumbItemHtml(t, i, t.id === focusedId) : ''))
    .join('');
  paintCrtThumbs(thumbStrip);
  if (hadFocus && focusId) {
    hadFocus.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(focusId)}"] button`)?.focus();
  }
}

function rowFor(id: TrackId): HTMLElement | null {
  return channelList.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(id)}"]`);
}

function liveCount(): number {
  return playlistManager.getTracks().filter((t) => t.state === 'playing').length;
}

function setPill(el: HTMLElement, label: string, tone: StateTone, extra = ''): void {
  el.textContent = label;
  el.className = `pill${extra} tone-${tone}`;
}

/** Accent and shape per artwork URL, so switching back to a channel needs no new sampling. */
const artCache = new Map<string, { accent: string | null; square: boolean }>();

/** Set the page accent; null means "no usable colour" and uses the amber fallback. */
function setAccent(color: string | null): void {
  document.documentElement.style.setProperty('--accent', color || FALLBACK_ACCENT);
}

function setArtShape(square: boolean): void {
  stage.dataset.shape = square ? 'square' : 'wide';
}

function applyArtworkAnalysis(): void {
  const key = artImg.currentSrc || artImg.src;
  if (!key) {
    setArtShape(false);
    return setAccent(null);
  }
  let info = artCache.get(key);
  if (!info) {
    info = { accent: extractAccent(artImg), square: isSquareArt(artImg) };
    artCache.set(key, info);
  }
  setArtShape(info.square);
  setAccent(info.accent);
}

function buildStaticMeters(): void {
  volumeBars.innerHTML = Array.from({ length: VOLUME_BARS }, (_, i) =>
    `<span style="--i:${i};--n:${VOLUME_BARS}"></span>`
  ).join('');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderChannels(): void {
  const tracks = playlistManager.getTracks();
  channelList.innerHTML = tracks
    .map((t, i) => channelRowHtml(t, i, t.id === focusedId, openDrawers.has(t.id)))
    .join('');
  channelCount.textContent = String(tracks.length);
  document.documentElement.dataset.empty = String(tracks.length === 0);
  renderStrip();
}

/**
 * The panel that scrolls the channel rows (a horizontal screen's page).
 * Null on vertical screens, where only the whole scroller moves.
 */
function rowScroller(row: HTMLElement): HTMLElement | null {
  for (let el = row.parentElement; el && el !== document.body; el = el.parentElement) {
    // Moving the main scroller would scroll the whole page (and collapse the
    // artwork) whenever the channel changes; only inner panels may follow.
    if (el.id === 'scroller' || el.classList.contains('xp-shell')) return null;
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return null;
}

/** Scroll that box (never the page) just enough to show a row. */
function keepRowVisible(row: HTMLElement): void {
  const box = rowScroller(row);
  if (!box) return;
  const view = box.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (r.top < view.top) {
    box.scrollBy({ top: r.top - view.top - 8, behavior });
  } else if (r.bottom > view.bottom) {
    box.scrollBy({ top: r.bottom - view.bottom + 8, behavior });
  }
}

function renderRow(id: TrackId): void {
  const tracks = playlistManager.getTracks();
  const index = tracks.findIndex((t) => t.id === id);
  const row = rowFor(id);
  if (index < 0 || !row) return;
  const hadFocus = row.contains(document.activeElement);
  row.outerHTML = channelRowHtml(tracks[index], index, id === focusedId, openDrawers.has(id));
  if (hadFocus) rowFor(id)?.querySelector<HTMLElement>('.ch__focus')?.focus();
  renderStrip();
}

/** The saved mixes list, with the mix that's open marked as current. */
function renderMixList(): void {
  renderSavedPlaylists(getAllPlaylists(), savedPlaylistsList);
  markActiveMix();
}

/** Mark the saved mix that's open now (by name), if it's in the list. */
function markActiveMix(): void {
  savedPlaylistsList.querySelectorAll<HTMLElement>('.mix[data-mix-name]').forEach((li) => {
    const active = !!mixName && li.dataset.mixName === mixName;
    li.classList.toggle('is-active', active);
    if (active) li.setAttribute('aria-current', 'true');
    else li.removeAttribute('aria-current');
  });
}

function renderStatus(): void {
  const tracks = playlistManager.getTracks();
  const live = liveCount();
  statusCode.textContent = mixName || 'Unsaved mix';
  markActiveMix();
  statusLine.textContent =
    tracks.length === 0
      ? 'No channels'
      : live > 0
        ? `${live} of ${tracks.length} playing`
        : `${tracks.length} channel${tracks.length === 1 ? '' : 's'} on hold`;

  updateKeepAwake();

  globalPlayPauseButton.textContent = live > 0 ? 'Pause all' : 'Play all';
  globalPlayPauseButton.disabled = tracks.length === 0;
  // Resume: while nothing plays, the channels that were playing last.
  const picked = tracks.filter((t) => t.selected).length;
  resumeButton.hidden = live > 0 || picked === 0;
  resumeButton.disabled = !tracks.some((t) => t.selected && (t.state === 'paused' || t.state === 'loading'));
  resumeButton.textContent = `Resume ${picked}`;
  resumeButton.setAttribute(
    'aria-label',
    `Resume the ${picked === 1 ? 'channel' : `${picked} channels`} played last`
  );
  shareButton.disabled = tracks.length === 0;
  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// Screen takeover
// ---------------------------------------------------------------------------

/** Keep the screen on while something plays in fullscreen or in the installed app. */
function updateKeepAwake(): void {
  // A remote plays nothing, so it has no reason to keep the screen on.
  void setKeepAwake(mcRole !== 'remote' && liveCount() > 0 && (isFullscreen() || runningAsApp()));
}

function updateFullscreenButton(): void {
  const on = isFullscreen();
  fullscreenButton.setAttribute('aria-pressed', String(on));
  fullscreenButton.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenButton.title = on ? 'Exit fullscreen' : 'Fullscreen';
  document.documentElement.dataset.fullscreen = String(on || runningAsFullscreenApp());
}

/**
 * Fullscreen needs a user gesture, so the page takes over on the first tap or
 * click of a visit. If the user leaves fullscreen it is not forced back; the
 * header button re-enters it.
 */
function setupScreenTakeover(): void {
  // Without browser bars the page reaches the very top of the screen, where
  // a camera cutout can sit (styles.css keeps the brand clear of it).
  const markFullscreen = () => {
    document.documentElement.dataset.fullscreen = String(isFullscreen() || runningAsFullscreenApp());
  };
  markFullscreen();
  updateFullscreenButton();
  onFullscreenChange(() => {
    markFullscreen();
    updateFullscreenButton();
    updateKeepAwake();
  });

  // The installed app already runs without browser UI; where the browser
  // can't do fullscreen (iPhone Safari), there is nothing to offer.
  if (!fullscreenSupported() || runningAsFullscreenApp()) return;
  fullscreenButton.hidden = false;

  fullscreenButton.addEventListener('click', () => {
    if (isFullscreen()) void exitFullscreen();
    else void enterFullscreen();
  });

  const takeover = (e: Event) => {
    document.removeEventListener('click', takeover, true);
    if ((e.target as HTMLElement).closest('#fullscreenButton')) return;
    if (!isFullscreen()) void enterFullscreen();
  };
  // Capture phase: the tap still reaches whatever it was aimed at.
  document.addEventListener('click', takeover, true);
}

// ---------------------------------------------------------------------------
// UI scale (Status panel)
// ---------------------------------------------------------------------------

let uiScale = storedScale();

/** Show the scale, and the layout size it produces, so the right step is easy to find. */
function updateScaleReadout(): void {
  const valueEl = document.getElementById('scaleValue');
  const readout = document.getElementById('layoutReadout');
  const down = document.getElementById('scaleDown') as HTMLButtonElement | null;
  const up = document.getElementById('scaleUp') as HTMLButtonElement | null;
  if (valueEl) valueEl.textContent = `${Math.round(uiScale * 100)}%`;
  if (down) down.disabled = uiScale <= SCALE_MIN + 0.001;
  if (up) up.disabled = uiScale >= SCALE_MAX - 0.001;
  if (readout) {
    const zoom = appZoom();
    const w = Math.round(window.innerWidth / zoom);
    const h = Math.round(window.innerHeight / zoom);
    const root = document.documentElement;
    const mode =
      root.dataset.merged === 'true'
        ? 'large-screen layout'
        : root.dataset.layout === 'stacked'
          ? 'vertical layout'
          : 'horizontal layout';
    const chosen = root.dataset.layoutForced === 'true' ? ' · Stacked on this screen' : '';
    readout.textContent = `Layout ${w} × ${h} · ${mode}${chosen}`;
  }
}

/** Layout setting (Status panel): Auto follows the screen, Stacked keeps the
 *  vertical layout on this screen whatever its shape. */
function setupLayoutControl(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-layout-choice]'));
  const show = () => {
    const choice = layoutChoice();
    buttons.forEach((b) => {
      const on = b.dataset.layoutChoice === choice;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    updateScaleReadout();
  };
  const choose = (choice: LayoutChoice) => {
    if (choice !== layoutChoice()) setLayoutChoice(choice);
    show();
  };
  buttons.forEach((b) => {
    b.addEventListener('click', () => choose(b.dataset.layoutChoice as LayoutChoice));
    // A radio group: the arrow keys move the choice.
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const next = buttons[(buttons.indexOf(b) + 1) % buttons.length];
      choose(next.dataset.layoutChoice as LayoutChoice);
      next.focus();
    });
  });
  show();
}

function setupScaleControl(): void {
  const step = (dir: 1 | -1) => {
    uiScale = applyScale(uiScale + dir * SCALE_STEP);
    updateScaleReadout();
  };
  document.getElementById('scaleDown')?.addEventListener('click', () => step(-1));
  document.getElementById('scaleUp')?.addEventListener('click', () => step(1));
  // The new scale arrives as a resize; the readout follows once the layout has settled.
  window.addEventListener('resize', () => requestAnimationFrame(updateScaleReadout));
  updateScaleReadout();
}

/** Fill the centre from the focused channel. changed=true fades the new channel in. */
function renderStage(changed: boolean): void {
  const track = focusedTrack();
  const tracks = playlistManager.getTracks();
  const index = track ? tracks.indexOf(track) : -1;
  const usable = !!track && (track.state === 'playing' || track.state === 'paused');

  art.dataset.state = track ? track.state : 'empty';
  stageIndex.textContent = track ? `Channel ${pad2(index + 1)} of ${pad2(tracks.length)}` : 'No channel selected';
  if (track) {
    const { label, tone } = stateInfo(track);
    setPill(stageState, label, tone);
  } else {
    setPill(stageState, 'Standby', 'idle');
  }

  const title = track ? trackTitle(track) : 'Nothing playing yet';
  const artist = track
    ? track.meta?.author || (track.state === 'error' ? 'Check the link or try another video' : 'YouTube')
    : 'Each YouTube link becomes a channel with its own volume.';

  if (changed) {
    swapText(stageTitle, title);
    swapText(stageArtist, artist, 60);
  } else {
    stageTitle.textContent = title;
    stageArtist.textContent = artist;
  }

  // Artwork: maxresdefault is true 16:9; hqdefault always exists but carries letterbox bars.
  const src = track?.meta ? `https://img.youtube.com/vi/${track.meta.id}/maxresdefault.jpg` : '';
  if (artImg.dataset.src !== src) {
    artImg.dataset.src = src;
    artImg.dataset.fallback = track?.meta?.thumbnailUrl || '';
    artImg.classList.remove('is-letterboxed');
    setBackdrop(src);
    if (src) {
      artImg.src = src;
    } else {
      artImg.removeAttribute('src');
      setAccent(null);
      setArtShape(false);
    }
    if (changed && src && !prefersReducedMotion()) {
      artImg.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
    }
  }

  // Controls
  playButton.disabled = !usable;
  resetButton.disabled = !usable;
  prevButton.disabled = tracks.length < 2;
  nextButton.disabled = tracks.length < 2;
  seekInput.disabled = !usable || !track?.duration;
  volumeInput.disabled = !track || !usable;

  const playing = track?.state === 'playing';
  playButton.querySelector('svg')!.outerHTML = playing ? icons.pause : icons.play;
  playButton.querySelector('span')!.textContent = playing ? 'Pause' : 'Play';
  playButton.classList.toggle('is-on', !!playing);
  playButton.setAttribute('aria-label', playing ? 'Pause this channel' : 'Play this channel');
  artPlay.disabled = !usable;
  artPlay.setAttribute('aria-label', playing ? 'Pause this channel' : 'Play this channel');
  art.classList.toggle('is-playing', !!playing);

  const loopOn = !!track?.loop;
  loopSwitch.disabled = !track;
  loopSwitch.setAttribute('aria-pressed', String(loopOn));
  setPill(loopSwitch, track ? (loopOn ? 'On' : 'Off') : '—', loopOn ? 'live' : 'idle', ' pill--btn');

  renderVolume();
  renderTime();
}

/** Timeline for the focused channel. Elapsed / remaining per channel live in the list rows. */
function renderTime(): void {
  const track = focusedTrack();
  const t = track ? track.currentTime : 0;
  const d = track?.duration || 0;
  const p = d > 0 ? Math.min(1, t / d) : 0;

  statDur.textContent = d ? formatHMS(d) : '—';
  scrubTime.textContent = d ? `${formatHMS(t)} / ${formatHMS(d)}` : '— / —';
  scrubTicks.forEach((el) => {
    el.textContent = d ? formatHMS(d * Number(el.dataset.tick)) : '—';
  });

  scrub.style.setProperty('--p', p.toFixed(5));
  art.style.setProperty('--p', p.toFixed(5));
  scrub.classList.toggle('is-live', track?.state === 'playing');
  if (!seeking) seekInput.value = String(Math.round(p * 1000));
  seekInput.setAttribute('aria-valuetext', `${formatHMS(t)} of ${d ? formatHMS(d) : 'unknown'}`);
}

function renderVolume(): void {
  const track = focusedTrack();
  const v = track ? track.volume : 0;
  const pct = Math.round(v * 100);
  if (document.activeElement !== volumeInput) volumeInput.value = String(pct);
  volumeInput.style.setProperty('--v', `${pct}%`);
  volumeInput.setAttribute('aria-valuetext', `${pct} percent`);
  volumeReadout.textContent = track ? `${pct} %` : '—';
  volumeDb.textContent = track ? formatDb(v) : 'No channel';
  const lit = Math.round(v * VOLUME_BARS);
  Array.from(volumeBars.children).forEach((bar, i) => {
    (bar as HTMLElement).classList.toggle('is-on', i < lit);
  });
}

function renderAll(changed = false): void {
  renderChannels();
  renderStatus();
  renderStage(changed);
}

function setFocus(id: TrackId | null): void {
  if (id === focusedId) return;
  const old = focusedId ? rowFor(focusedId) : null;
  focusedId = id;
  if (old) {
    old.classList.remove('is-focus');
    old.querySelector('.ch__focus')?.setAttribute('aria-current', 'false');
  }
  const row = id ? rowFor(id) : null;
  if (row) {
    row.classList.add('is-focus');
    row.querySelector('.ch__focus')?.setAttribute('aria-current', 'true');
    keepRowVisible(row);
  }
  strips.forEach((strip) =>
    strip.querySelectorAll<HTMLElement>('[data-track-id]').forEach((tile) => {
      const on = tile.dataset.trackId === id;
      tile.classList.toggle('is-focus', on);
      tile.querySelector('button')?.setAttribute('aria-current', String(on));
      if (on) keepTileVisible(strip, tile);
    })
  );
  renderStage(true);
}

function stepFocus(dir: 1 | -1): void {
  const tracks = playlistManager.getTracks();
  if (tracks.length === 0) return;
  const i = tracks.findIndex((t) => t.id === focusedId);
  setFocus(tracks[(i + dir + tracks.length) % tracks.length].id);
}

// ---------------------------------------------------------------------------
// Playback loop
// ---------------------------------------------------------------------------

function poll(): void {
  let anyPlaying = false;
  for (const track of playlistManager.getTracks()) {
    if (track.state !== 'playing') continue;
    anyPlaying = true;
    const controller = playlistManager.getController(track.id);
    if (!controller) continue;
    const duration = controller.getDuration();
    playlistManager.updateTrack(track.id, {
      currentTime: controller.getCurrentTime(),
      duration: duration > 0 ? duration : track.duration,
    });
    if (track.meta && !track.meta.author) fillAuthor(track.id);
    const row = rowFor(track.id);
    const updated = playlistManager.getTrack(track.id);
    if (row && updated) patchChannelRow(row, updated);
  }
  renderTime();
  if (!anyPlaying) stopPolling();
}

/** YouTube reports the channel name only after playback starts: fill it in when it arrives. */
function fillAuthor(id: TrackId): void {
  const track = playlistManager.getTrack(id);
  const author = playlistManager.getController(id)?.getAuthor();
  if (!track?.meta || !author) return;
  playlistManager.updateTrack(id, { meta: { ...track.meta, author } });
  renderRow(id);
  if (id === focusedId) swapText(stageArtist, author);
}

function startPolling(): void {
  if (pollTimer === null) pollTimer = window.setInterval(poll, 250);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Resume: the channels played last
//
// Each channel carries `selected`, the mark Resume plays. It follows what
// plays: a channel that starts playing is marked; playing one channel while
// nothing plays starts a new set (the others lose the mark); pausing one
// while others keep playing drops it. Pause all keeps the marks, so they are
// exactly what was playing. The mark can also be set by hand on each row.
//
// The marked channels move to the top of the list when playback comes to
// rest through Pause all or Resume, when a mix loads, and when the app comes
// back into view with nothing playing: never while you tap a row, so a row
// can't jump away under your finger.
//
// The marks travel in the room snapshot (so remotes, the relay and a device
// taking over see them) and are kept with the saved mix on this device.
// ---------------------------------------------------------------------------

/** Mark or unmark one channel for Resume; true when it changed. */
function setSelected(id: TrackId, on: boolean): boolean {
  const track = playlistManager.getTrack(id);
  if (!track || track.selected === on) return false;
  playlistManager.updateTrack(id, { selected: on });
  const row = rowFor(id);
  if (row) patchChannelRow(row, track);
  return true;
}

/** Mark only this channel (playing it while nothing plays starts a new set). */
function selectOnly(id: TrackId): boolean {
  let changed = false;
  for (const t of playlistManager.getTracks()) changed = setSelected(t.id, t.id === id) || changed;
  return changed;
}

/** The links Resume plays, in mix order. */
function resumeUrls(): string[] {
  return playlistManager.getTracks().filter((t) => t.selected).map((t) => t.url);
}

let resumeSaveTimer = 0;

/** The marks changed: update the header and, soon, the saved mix. */
function selectionChanged(): void {
  renderStatus();
  // A remote mirrors the main device's mix; only the device that plays it
  // keeps its marks with the saved mix.
  if (mcRole === 'remote' || resumeSaveTimer) return;
  resumeSaveTimer = window.setTimeout(saveResumeNow, 400);
}

function saveResumeNow(): void {
  window.clearTimeout(resumeSaveTimer);
  resumeSaveTimer = 0;
  if (mcRole !== 'remote' && mixName) saveMixResume(mixName, resumeUrls());
}

/** Put the marked channels at the top of the list. Not on a remote (the main device orders the mix). */
function sortResumeFirst(): void {
  if (mcRole === 'remote' || !playlistManager.sortSelectedFirst()) return;
  renderAll(false);
}

/** Mark the channels of a saved mix that Resume plays, by link (a link listed twice marks two). */
function applyResumeUrls(urls: string[]): void {
  const wanted = new Map<string, number>();
  for (const url of urls) wanted.set(url, (wanted.get(url) ?? 0) + 1);
  for (const t of playlistManager.getTracks()) {
    const left = wanted.get(t.url) ?? 0;
    playlistManager.updateTrack(t.id, { selected: left > 0 });
    if (left > 0) wanted.set(t.url, left - 1);
  }
}

/** Resume: play the marked channels, now if ready or as soon as their player is. */
function resumeSelected(): boolean {
  const picked = playlistManager.getTracks().filter((t) => t.selected);
  if (!picked.some((t) => t.state === 'paused' || t.state === 'loading')) return false;
  for (const t of picked) {
    if (t.state === 'paused') playlistManager.getController(t.id)?.play();
    else if (t.state === 'loading') mcAutoplay.add(t.id);
  }
  startPolling();
  sortResumeFirst();
  // Show a channel that is about to play on the main display.
  if (!focusedTrack()?.selected) setFocus(picked[0].id);
  return true;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

function createPlayerFor(trackId: TrackId, videoId: string, keep?: { volume: number; loop: boolean; time?: number }): void {
  playerBay.querySelector(`[data-slot="${CSS.escape(trackId)}"]`)?.remove();
  const slot = document.createElement('div');
  slot.dataset.slot = trackId;
  const inner = document.createElement('div');
  slot.appendChild(inner);
  playerBay.appendChild(slot);

  const controller = playerFactory.createPlayer(
    trackId,
    inner,
    videoId,
    (id: TrackId, meta: YouTubeVideoMeta) => {
      playlistManager.updateTrack(id, {
        meta,
        state: 'paused',
        duration: meta.durationSeconds,
        ...(keep ? { volume: keep.volume, loop: keep.loop } : {}),
      });
      const track = playlistManager.getTrack(id);
      if (track) playlistManager.getController(id)?.setVolume(track.volume);
      // Taking over a mix from another device: it was created at that time
      // (the player's start), paused; seeking would start playback.
      if (keep?.time) playlistManager.updateTrack(id, { currentTime: Math.floor(keep.time) });
      if (mcAutoplay.delete(id)) playTrack(id);
      renderRow(id);
      renderStatus();
      if (id === focusedId) renderStage(true);
    },
    (id: TrackId, state: TrackState) => onTrackState(id, state),
    (id: TrackId, error: TrackError) => {
      playlistManager.updateTrack(id, { state: 'error', error });
      renderRow(id);
      renderStatus();
      if (id === focusedId) renderStage(true);
    },
    keep?.time
  );
  playlistManager.setController(trackId, controller);
}

function onTrackState(id: TrackId, state: TrackState): void {
  const before = playlistManager.getTrack(id);
  if (!before || before.state === 'error') return;
  const prevState = before.state;
  playlistManager.updateTrack(id, { state });
  const controller = playlistManager.getController(id);
  if (controller) playlistManager.updateTrack(id, { currentTime: controller.getCurrentTime() });
  const track = playlistManager.getTrack(id)!;
  // Whatever starts playing is part of what Resume picks up later.
  const marked = state === 'playing' && !track.selected;
  if (marked) playlistManager.updateTrack(id, { selected: true });

  const row = rowFor(id);
  if (row) patchChannelRow(row, track);
  if (prevState !== track.state) renderStrip();
  if (marked) selectionChanged();
  renderStatus();
  if (id === focusedId) renderStage(false);

  if (state === 'playing') startPolling();

  // The player reports the end of a video as a pause: restart it when repeat is on.
  if (state === 'paused' && track.loop && controller) {
    const duration = controller.getDuration();
    if (duration > 0 && controller.getCurrentTime() >= duration - 1) {
      setTimeout(() => {
        controller.seekTo(0);
        controller.play();
      }, 100);
    }
  }
}

function addTrackFromUrl(url: string): boolean {
  const videoId = isValidYouTubeUrl(url) ? extractVideoId(url) : null;
  if (!videoId) {
    showError(inputError, 'That link has no YouTube video in it. Use a youtube.com/watch or youtu.be link.');
    return false;
  }
  const track = playlistManager.addTrack(url, videoId);
  createPlayerFor(track.id, videoId);
  if (!focusedId) focusedId = track.id;
  return true;
}

function removeTrack(id: TrackId): void {
  const index = playlistManager.getTracks().findIndex((t) => t.id === id);
  playlistManager.removeTrack(id);
  openDrawers.delete(id);
  playerBay.querySelector(`[data-slot="${CSS.escape(id)}"]`)?.remove();
  if (focusedId === id) {
    const rest = playlistManager.getTracks();
    focusedId = rest.length ? rest[Math.min(index, rest.length - 1)].id : null;
    renderAll(true);
  } else {
    renderAll(false);
  }
}

function reloadTrack(id: TrackId, newUrl: string): boolean {
  const track = playlistManager.getTrack(id);
  const newVideoId = isValidYouTubeUrl(newUrl) ? extractVideoId(newUrl) : null;
  if (!track || !newVideoId) {
    showError(inputError, 'That link has no YouTube video in it. The channel was not changed.');
    return false;
  }
  const keep = { volume: track.volume, loop: track.loop };
  playlistManager.getController(id)?.destroy();
  playlistManager.updateTrack(id, {
    url: newUrl,
    videoId: newVideoId,
    state: 'loading',
    currentTime: 0,
    meta: undefined,
    duration: undefined,
    error: undefined,
  });
  createPlayerFor(id, newVideoId, keep);
  renderRow(id);
  renderStatus();
  if (id === focusedId) renderStage(true);
  return true;
}

function playTrack(id: TrackId): boolean {
  const track = playlistManager.getTrack(id);
  const controller = playlistManager.getController(id);
  if (!track || !controller || track.state !== 'paused') return false;
  controller.play();
  startPolling();
  return true;
}

function pauseTrack(id: TrackId): boolean {
  const track = playlistManager.getTrack(id);
  const controller = playlistManager.getController(id);
  if (!track || !controller || track.state !== 'playing') return false;
  controller.pause();
  return true;
}

function playAll(): boolean {
  playlistManager.getTracks().forEach((t) => t.state === 'paused' && playlistManager.getController(t.id)?.play());
  startPolling();
  return true;
}

function pauseAll(): boolean {
  playlistManager.getTracks().forEach((t) => t.state === 'playing' && playlistManager.getController(t.id)?.pause());
  // Channels still loading that were asked to start (Resume, Play here) stay paused too.
  mcAutoplay.clear();
  // What was playing keeps its mark: bring it to the top, ready for Resume.
  sortResumeFirst();
  return true;
}

/** Jump within a channel. */
function seekTrack(id: TrackId, time: number): boolean {
  const controller = playlistManager.getController(id);
  if (!controller) return false;
  controller.seekTo(time);
  playlistManager.updateTrack(id, { currentTime: time });
  const row = rowFor(id);
  const track = playlistManager.getTrack(id);
  if (row && track) patchChannelRow(row, track);
  if (id === focusedId) renderTime();
  return true;
}

/** The deck's Stop: pause and go back to the start. */
function stopTrack(id: TrackId): boolean {
  const controller = playlistManager.getController(id);
  if (!controller) return false;
  controller.pause();
  return seekTrack(id, 0);
}

function setLoop(id: TrackId, on: boolean): boolean {
  if (!playlistManager.getTrack(id)) return false;
  playlistManager.updateTrack(id, { loop: on });
  if (id === focusedId) renderStage(false);
  return true;
}

/** Add a channel from a link; renders the result. */
function addChannel(url: string): boolean {
  const wasEmpty = playlistManager.getTracks().length === 0;
  if (!addTrackFromUrl(url)) return false;
  renderAll(wasEmpty);
  return true;
}

/** Replace the mix with these links (taking `name`) or add them to it. */
function loadMix(urls: string[], name: string | null, mode: 'replace' | 'append', resume?: string[]): boolean {
  // Keep the marks of the mix that's open now before it goes.
  if (resumeSaveTimer) saveResumeNow();
  if (mode === 'replace') mixName = name;
  loadTracksFromUrls(urls, mode, mode === 'replace' && Array.isArray(resume) ? resume : undefined);
  return true;
}

/** Every command, applied on this device. Registered with src/commands.ts. */
function runCommand(command: Command): boolean {
  switch (command.type) {
    case 'play': {
      const fresh = liveCount() === 0;
      if (!playTrack(command.trackId)) return false;
      // From silence, this channel starts a new set for Resume.
      if (fresh ? selectOnly(command.trackId) : setSelected(command.trackId, true)) selectionChanged();
      return true;
    }
    case 'pause': {
      const others = othersPlaying(command.trackId);
      if (!pauseTrack(command.trackId)) return false;
      // Paused while the mix plays on: no longer part of what Resume plays.
      if (others && setSelected(command.trackId, false)) selectionChanged();
      return true;
    }
    case 'play_all':
      return playAll();
    case 'pause_all':
      return pauseAll();
    case 'resume':
      return resumeSelected();
    case 'select':
      if (!playlistManager.getTrack(command.trackId)) return false;
      if (setSelected(command.trackId, command.on === true)) selectionChanged();
      return true;
    case 'focus':
      if (!playlistManager.getTrack(command.trackId)) return false;
      setFocus(command.trackId);
      return true;
    case 'step':
      stepFocus(command.dir);
      return true;
    case 'seek':
      return seekTrack(command.trackId, command.time);
    case 'stop': {
      const others = othersPlaying(command.trackId) && playlistManager.getTrack(command.trackId)?.state === 'playing';
      if (!stopTrack(command.trackId)) return false;
      if (others && setSelected(command.trackId, false)) selectionChanged();
      return true;
    }
    case 'volume':
      if (!playlistManager.getTrack(command.trackId)) return false;
      setVolume(command.trackId, Math.min(1, Math.max(0, command.volume)));
      return true;
    case 'loop':
      return setLoop(command.trackId, command.on);
    case 'add':
      return addChannel(command.url);
    case 'remove':
      if (!playlistManager.getTrack(command.trackId)) return false;
      removeTrack(command.trackId);
      return true;
    case 'relink':
      return reloadTrack(command.trackId, command.url);
    case 'load_mix':
      return loadMix(command.urls, command.name, command.mode, command.resume);
  }
}

/** Whether any channel other than this one is playing. */
function othersPlaying(id: TrackId): boolean {
  return playlistManager.getTracks().some((t) => t.id !== id && t.state === 'playing');
}

/** Play or pause a channel, from what this device shows (UI helper). */
function togglePlay(id: TrackId): void {
  const track = playlistManager.getTrack(id);
  if (track?.state === 'playing') dispatch({ type: 'pause', trackId: id });
  else if (track?.state === 'paused') dispatch({ type: 'play', trackId: id });
}

function setVolume(id: TrackId, volume: number): void {
  playlistManager.getController(id)?.setVolume(volume);
  playlistManager.updateTrack(id, { volume });
  const row = rowFor(id);
  const track = playlistManager.getTrack(id);
  if (row && track) patchChannelRow(row, track);
  if (id === focusedId) renderVolume();
}

function loadTracksFromUrls(urls: string[], mode: 'replace' | 'append', resume?: string[]): void {
  if (mode === 'replace') {
    playlistManager.clearTracks();
    openDrawers.clear();
    playerBay.innerHTML = '';
    focusedId = null;
  }
  for (const url of urls) addTrackFromUrl(url);
  if (resume) {
    // A saved mix: mark the channels played last and start the list with them.
    applyResumeUrls(resume);
    playlistManager.sortSelectedFirst();
    focusedId = playlistManager.getTracks()[0]?.id ?? null;
  }
  renderAll(true);
}

/** Load a mix, asking to replace or add when channels are open. False if cancelled. */
async function handleLoadPlaylist(urls: string[], name: string | null, resume?: string[]): Promise<boolean> {
  const open = playlistManager.getTracks().length;
  if (open === 0) return dispatch({ type: 'load_mix', urls, name, mode: 'replace', resume });
  const choice = await showReplaceAppendModal(
    `This mix has ${urls.length} channel${urls.length === 1 ? '' : 's'}. Replace the ${open} you have open, or add them to the current mix?`
  );
  if (choice === 'cancel') return false;
  return dispatch({ type: 'load_mix', urls, name, mode: choice, resume: choice === 'replace' ? resume : undefined });
}

/** Briefly swap a button's label; a second flash restarts it, never sticks. */
const flashTimers = new WeakMap<HTMLButtonElement, number>();
function flash(button: HTMLButtonElement, text: string): void {
  const running = flashTimers.get(button);
  if (running !== undefined) clearTimeout(running);
  else button.dataset.label = button.textContent ?? '';
  button.textContent = text;
  flashTimers.set(
    button,
    window.setTimeout(() => {
      button.textContent = button.dataset.label ?? '';
      flashTimers.delete(button);
    }, 1800)
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function initializeEventListeners(): void {
  const submitUrl = () => {
    const url = urlInput.value.trim();
    if (!url) {
      showError(inputError, 'Paste a YouTube link first.');
      urlInput.focus();
      return;
    }
    if (dispatch({ type: 'add', url })) {
      urlInput.value = '';
      inputError.textContent = '';
    }
  };
  addButton.addEventListener('click', submitUrl);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitUrl();
  });

  globalPlayPauseButton.addEventListener('click', () => {
    dispatch({ type: playlistManager.hasPlayingTracks() ? 'pause_all' : 'play_all' });
  });
  resumeButton.addEventListener('click', () => dispatch({ type: 'resume' }));
  // Coming back to the app with nothing playing: the channels played last on top.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (liveCount() === 0) sortResumeFirst();
    } else if (resumeSaveTimer) {
      saveResumeNow();
    }
  });
  window.addEventListener('pagehide', () => resumeSaveTimer && saveResumeNow());

  loopSwitch.addEventListener('click', () => {
    const track = focusedTrack();
    if (track) dispatch({ type: 'loop', trackId: track.id, on: !track.loop });
  });

  shareButton.addEventListener('click', async () => {
    const urls = playlistManager.getTrackUrls();
    if (urls.length === 0) return showError(inputError, 'Add a channel before sharing the mix.');
    const ok = await copyToClipboard(encodePlaylistToUrl(urls));
    if (ok) flash(shareButton, 'Link copied');
    else showError(inputError, 'The browser blocked the clipboard, so the link was not copied.');
  });

  savePlaylistButton.addEventListener('click', () => {
    const name = playlistNameInput.value.trim();
    if (!name) {
      showError(mixesMessage, 'Name the mix before saving it.');
      playlistNameInput.focus();
      return;
    }
    const urls = playlistManager.getTrackUrls();
    if (urls.length === 0) return showError(mixesMessage, 'Add a channel before saving a mix.');
    mixesMessage.textContent = '';
    saveOrUpdatePlaylist(name, urls, resumeUrls());
    mixName = name;
    playlistNameInput.value = '';
    renderMixList();
    renderStatus();
    flash(savePlaylistButton, 'Saved');
  });
  playlistNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') savePlaylistButton.click();
  });

  // Import: a share link (or plain YouTube links) pasted in, for the
  // installed app, which has no address bar to open the link in.
  const importMix = async () => {
    const text = importInput.value.trim();
    if (!text) {
      showError(mixesMessage, 'Paste a share link first.');
      importInput.focus();
      return;
    }
    // A pairing link (the installed app has no address bar to open it in).
    const pairCode = text.includes('#pair=') ? pairCodeFromText(text) : null;
    if (pairCode) {
      const error = await joinWithCode(pairCode);
      if (error) showError(mixesMessage, error);
      else {
        mixesMessage.textContent = '';
        importInput.value = '';
        flash(importButton, 'Paired');
      }
      return;
    }
    const urls = decodePlaylistFromText(text);
    if (!urls) {
      showError(mixesMessage, 'That is not a share link or a YouTube link, so there is nothing to import.');
      return;
    }
    mixesMessage.textContent = '';
    // Cancelled in the replace-or-add dialog: keep the text for another try.
    if (!(await handleLoadPlaylist(urls, null))) return;
    importInput.value = '';
    flash(importButton, urls.length === 1 ? 'Imported 1' : `Imported ${urls.length}`);
  };
  importButton.addEventListener('click', () => void importMix());
  importInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void importMix();
  });

  savedPlaylistsList.addEventListener('click', async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mix-action]');
    const name = button?.dataset.playlistName;
    if (!button || !name) return;
    const playlist = getAllPlaylists().find((p) => p.name === name);
    if (button.dataset.mixAction === 'load' && playlist) {
      await handleLoadPlaylist(playlist.urls, playlist.name, playlist.resume ?? []);
    } else if (button.dataset.mixAction === 'delete' && confirm(`Delete the mix "${name}"? This cannot be undone.`)) {
      deletePlaylist(name);
      if (mixName === name) mixName = null;
      renderMixList();
      renderStatus();
    }
  });

  // Channel list: one delegated listener for every row.
  channelList.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const id = el?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
    if (!el || !id) return;
    if (el.dataset.action === 'focus') dispatch({ type: 'focus', trackId: id });
    else if (el.dataset.action === 'toggle') togglePlay(id);
    else if (el.dataset.action === 'pick') {
      const track = playlistManager.getTrack(id);
      if (track) dispatch({ type: 'select', trackId: id, on: !track.selected });
    }
    else if (el.dataset.action === 'drawer') {
      const open = !openDrawers.has(id);
      if (open) openDrawers.add(id);
      else openDrawers.delete(id);
      const row = rowFor(id);
      if (row) {
        setRowDrawerOpen(row, open);
        if (open) keepRowVisible(row);
      }
    } else if (el.dataset.action === 'relink') {
      const input = rowFor(id)?.querySelector<HTMLInputElement>('.ch__link-input');
      const url = input?.value.trim();
      if (url) dispatch({ type: 'relink', trackId: id, url });
    } else if (el.dataset.action === 'remove-ask') {
      const row = rowFor(id);
      if (row) {
        setRowConfirm(row, true);
        row.querySelector<HTMLElement>('[data-action="remove-no"]')?.focus();
      }
    } else if (el.dataset.action === 'remove-no') {
      const row = rowFor(id);
      if (row) {
        setRowConfirm(row, false);
        row.querySelector<HTMLElement>('[data-action="remove-ask"]')?.focus();
      }
    } else if (el.dataset.action === 'remove-yes') {
      const tracks = playlistManager.getTracks();
      const next = tracks[tracks.findIndex((t) => t.id === id) + 1] ?? tracks[tracks.findIndex((t) => t.id === id) - 1];
      dispatch({ type: 'remove', trackId: id });
      // Keep keyboard users in the list rather than dropping focus to the page.
      (next ? rowFor(next.id)?.querySelector<HTMLElement>('.ch__focus') : urlInput)?.focus();
    }
  });
  channelList.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-track-id]');
    if (!row) return;
    if (e.key === 'Enter' && target.matches('.ch__link-input')) {
      row.querySelector<HTMLButtonElement>('[data-action="relink"]')?.click();
    } else if (e.key === 'Escape' && target.closest('.ch__confirm')) {
      e.preventDefault();
      setRowConfirm(row, false);
      row.querySelector<HTMLElement>('[data-action="remove-ask"]')?.focus();
    }
  });
  channelList.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const id = input.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
    if (id && input.dataset.action === 'volume') dispatch({ type: 'volume', trackId: id, volume: Number(input.value) / 100 });
  });


  /** Switch to the always-present thumbnail; false when already on it. */
  const useFallback = (): boolean => {
    const fallback = artImg.dataset.fallback;
    if (fallback && !artImg.classList.contains('is-letterboxed')) {
      artImg.classList.add('is-letterboxed');
      artImg.src = fallback;
      setBackdrop(fallback, true);
      return true;
    }
    return false;
  };
  artImg.addEventListener('error', () => {
    if (!useFallback()) {
      setAccent(null);
      setArtShape(false);
    }
  });
  artImg.addEventListener('load', () => {
    // A missing HD thumbnail comes back as a 120x90 grey placeholder rather than an error.
    if (artImg.naturalWidth <= 120 && useFallback()) return;
    applyArtworkAnalysis();
  });

  // Main display: tap the artwork to play or pause; the strip focuses or toggles channels.
  artPlay.addEventListener('click', () => focusedId && togglePlay(focusedId));
  strips.forEach((strip) =>
    strip.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      const id = el?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
      if (el?.dataset.action === 'focus' && id) dispatch({ type: 'focus', trackId: id });
    })
  );

  // Deck
  playButton.addEventListener('click', () => focusedId && togglePlay(focusedId));
  prevButton.addEventListener('click', () => dispatch({ type: 'step', dir: -1 }));
  nextButton.addEventListener('click', () => dispatch({ type: 'step', dir: 1 }));
  resetButton.addEventListener('click', () => {
    if (focusedId) dispatch({ type: 'stop', trackId: focusedId });
  });

  const endSeek = () => (seeking = false);
  seekInput.addEventListener('pointerdown', () => (seeking = true));
  seekInput.addEventListener('pointerup', endSeek);
  seekInput.addEventListener('pointercancel', endSeek);
  seekInput.addEventListener('change', endSeek);
  seekInput.addEventListener('input', () => {
    const track = focusedTrack();
    if (!track || !track.duration) return;
    dispatch({ type: 'seek', trackId: track.id, time: (Number(seekInput.value) / 1000) * track.duration });
  });

  volumeInput.addEventListener('input', () => {
    if (focusedId) dispatch({ type: 'volume', trackId: focusedId, volume: Number(volumeInput.value) / 100 });
  });

  // Keyboard: Space plays the focused channel, [ and ] step between channels.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (target.closest('input, textarea, select, button, summary, [contenteditable], .modal-overlay')) return;
    if (e.key === ' ' && focusedId) {
      e.preventDefault();
      togglePlay(focusedId);
    } else if (e.key === '[') {
      dispatch({ type: 'step', dir: -1 });
    } else if (e.key === ']') {
      dispatch({ type: 'step', dir: 1 });
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** The screen effect on the artwork and the thumbnail strip (src/crt.ts). */
function setupScreenEffect(): void {
  // The settings first, so the first render already uses the chosen style.
  setupScreenControl();
  setupArtCrt(artImg, $<HTMLCanvasElement>('artCrt'), art);
  // Thumbnails render when they come into view (the strip shows only on
  // large screens) and again after the settings change.
  let frame = 0;
  const repaint = () => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), paintCrtThumbs(thumbStrip)));
  };
  window.addEventListener('resize', repaint);
  window.addEventListener(LAYOUT_CHOICE_EVENT, repaint);
  window.addEventListener(FX_CHANGE_EVENT, () => {
    clearCrtThumbs();
    repaint();
  });
  // A new skin resizes the thumbnails.
  window.addEventListener(SKIN_EVENT, repaint);
}

// ---------------------------------------------------------------------------
// Remote control: roles and sync (docs/remote-control-plan.md, phase 3)
//
// main:   plays; shares a snapshot of the mix after every change (and every
//         15 seconds while playing); runs commands from remotes.
// remote: no players; mirrors the snapshots, moving playing channels' times
//         on by itself between them; sends every command to the main device.
// idle:   on its own, as without pairing. The first to play claims main.
// ---------------------------------------------------------------------------

/** This device's role (src/remote.ts decides it). */
let mcRole: Role = 'idle';
let mcStatus: ConnectionStatus | null = null;
let mcBroadcastTimer = 0;
let mcSeq = 0;
let mcLastClaim = 0;
let mcTicker = 0;
/** Remote: each mirrored channel's time and when it was true (performance.now()). */
const mcBases = new Map<TrackId, { t: number; at: number }>();
/** Remote: slider commands waiting to be sent (at most ~10 per second each). */
const mcThrottle = new Map<string, { last: number; timer: number; command: Command | null }>();
let mcNoticeTimer = 0;
/** "Play here" asked for: when this device becomes main, play what was playing. */
let mcWantPlayHere = false;
let mcWantTimer = 0;
/** Handing over to another device: stop sharing state (the final one has gone). */
let mcReleasing = false;
/** Channels that were playing on a main device that went offline (offered by Play here). */
const mcResumeIds = new Set<TrackId>();
/** Channels to start as soon as their player is ready (after taking over). */
const mcAutoplay = new Set<TrackId>();

/** Every command run on this device goes through here (registered with src/commands.ts). */
function runLocalCommand(command: Command): boolean {
  const ok = !!runCommand(command);
  if (ok && (command.type === 'play' || command.type === 'play_all' || command.type === 'resume')) {
    maybeClaimMain();
    if (mcResumeIds.size) {
      mcResumeIds.clear();
      renderRemoteBadge();
    }
  }
  scheduleBroadcast();
  return ok;
}

/** Playing while paired and no main device online: become the main device. */
function maybeClaimMain(): void {
  if (mcRole !== 'idle' || mcStatus?.state !== 'online') return;
  if (Date.now() - mcLastClaim < 3000) return;
  mcLastClaim = Date.now();
  claimMain();
}

interface MirroredTrack {
  id: string;
  url: string;
  videoId: string;
  meta?: YouTubeVideoMeta;
  state: TrackState;
  error?: TrackError;
  currentTime: number;
  duration?: number;
  volume: number;
  loop: boolean;
  /** Marked for Resume (missing from devices without Resume: false). */
  selected?: boolean;
}

interface RoomState {
  v: 1;
  seq: number;
  sentAt: number;
  mixName: string | null;
  focusedId: string | null;
  tracks: MirroredTrack[];
}

function buildRoomState(): RoomState {
  return {
    v: 1,
    seq: ++mcSeq,
    sentAt: Date.now(),
    mixName,
    focusedId,
    tracks: playlistManager.getTracks().map((t) => {
      const controller = playlistManager.getController(t.id);
      const live = t.state === 'playing' && controller ? controller.getCurrentTime() : t.currentTime;
      return {
        id: t.id,
        url: t.url,
        videoId: t.videoId,
        meta: t.meta,
        state: t.state,
        error: t.error,
        currentTime: live,
        duration: t.duration,
        volume: t.volume,
        loop: t.loop,
        selected: t.selected,
      };
    }),
  };
}

/** Main device: share the state soon (changes close together go as one). */
function scheduleBroadcast(): void {
  if (mcRole !== 'main' || mcReleasing || mcBroadcastTimer) return;
  mcBroadcastTimer = window.setTimeout(broadcastNow, 150);
}

function broadcastNow(): void {
  window.clearTimeout(mcBroadcastTimer);
  mcBroadcastTimer = 0;
  if (mcRole === 'main' && !mcReleasing) sendState(buildRoomState());
}

/**
 * Main device: another device asked to play here. Send the final state
 * (with what is playing, and where), then stop; the relay makes the other
 * device main, and this one becomes its remote.
 */
function releaseMain(): void {
  if (mcRole !== 'main') return;
  window.clearTimeout(mcBroadcastTimer);
  mcBroadcastTimer = 0;
  sendState(buildRoomState(), true);
  mcReleasing = true;
  for (const t of playlistManager.getTracks()) {
    if (t.state === 'playing') playlistManager.getController(t.id)?.pause();
  }
  stopPolling();
  // If the handover never completes, carry on as the main device (paused).
  window.setTimeout(() => {
    if (mcReleasing && mcRole === 'main') {
      mcReleasing = false;
      broadcastNow();
    }
  }, 6000);
}

/**
 * "Play here". On a remote: ask the main device to hand over, then play what
 * it was playing. After the main device went offline: play what it was
 * playing, from the positions it had reached.
 */
function playHere(): void {
  if (mcRole === 'remote') {
    if (!claimMain(true)) return showRemoteNotice('Not connected. Try again in a moment.');
    mcWantPlayHere = true;
    renderRemoteBadge();
    window.clearTimeout(mcWantTimer);
    mcWantTimer = window.setTimeout(() => {
      if (mcWantPlayHere && mcRole === 'remote') {
        mcWantPlayHere = false;
        showRemoteNotice(`${mcStatus?.mainName || 'The main device'} didn't hand over.`);
      }
    }, 8000);
    return;
  }
  if (mcResumeIds.size) {
    resumeHere([...mcResumeIds]);
    mcResumeIds.clear();
    renderRemoteBadge();
  }
}

/** Play these channels here: now if ready, or as soon as their player is. */
function resumeHere(ids: TrackId[]): void {
  for (const id of ids) {
    const track = playlistManager.getTrack(id);
    if (track?.state === 'paused') dispatch({ type: 'play', trackId: id });
    else if (track?.state === 'loading') mcAutoplay.add(id);
  }
}

/** Remote: show the main device's snapshot. */
function applyRoomState(raw: unknown, ageMs: number): void {
  if (mcRole !== 'remote' || !raw || typeof raw !== 'object') return;
  const state = raw as RoomState;
  if (!Array.isArray(state.tracks)) return;
  const before = playlistManager.getTracks();
  // Rows are patched in place only when nothing structural changed (loading
  // and error rows are drawn differently, so a change there redraws).
  const settled = (st: TrackState) => st === 'playing' || st === 'paused';
  const sameShape =
    before.length === state.tracks.length &&
    before.every(
      (t, i) =>
        t.id === state.tracks[i].id &&
        t.url === state.tracks[i].url &&
        t.meta?.title === state.tracks[i].meta?.title &&
        settled(t.state) === settled(state.tracks[i].state)
    );
  const focusChanged = focusedId !== state.focusedId;
  const now = performance.now();
  mcBases.clear();
  const tracks: Track[] = state.tracks.map((t) => {
    mcBases.set(t.id, { t: t.currentTime, at: now - ageMs });
    const elapsed = t.state === 'playing' ? ageMs / 1000 : 0;
    const currentTime = t.duration ? Math.min(t.duration, t.currentTime + elapsed) : t.currentTime + elapsed;
    return { ...t, currentTime, isMuted: false, selected: t.selected === true };
  });
  playlistManager.replaceTracks(tracks);
  mixName = state.mixName;
  focusedId = state.focusedId;

  if (sameShape) {
    tracks.forEach((t) => {
      const row = rowFor(t.id);
      if (row) patchChannelRow(row, t);
    });
    renderStrip();
    renderStatus();
    renderStage(focusChanged);
    if (focusChanged) setFocusMarks(focusedId);
  } else {
    renderAll(focusChanged);
  }
}

/** Remote: move playing channels' times on between snapshots. */
function remoteTick(): void {
  if (mcRole !== 'remote') return;
  const now = performance.now();
  for (const track of playlistManager.getTracks()) {
    if (track.state !== 'playing') continue;
    const base = mcBases.get(track.id);
    if (!base) continue;
    let t = base.t + (now - base.at) / 1000;
    if (track.duration) t = track.loop ? t % track.duration : Math.min(track.duration, t);
    playlistManager.updateTrack(track.id, { currentTime: t });
    const row = rowFor(track.id);
    if (row) patchChannelRow(row, playlistManager.getTrack(track.id)!);
  }
  renderTime();
}

/** Mark the focused row and strip tiles without re-rendering them. */
function setFocusMarks(id: TrackId | null): void {
  channelList.querySelectorAll<HTMLElement>('[data-track-id]').forEach((row) => {
    const on = row.dataset.trackId === id;
    row.classList.toggle('is-focus', on);
    row.querySelector('.ch__focus')?.setAttribute('aria-current', String(on));
  });
  strips.forEach((strip) =>
    strip.querySelectorAll<HTMLElement>('[data-track-id]').forEach((tile) => {
      const on = tile.dataset.trackId === id;
      tile.classList.toggle('is-focus', on);
      tile.querySelector('button')?.setAttribute('aria-current', String(on));
    })
  );
}

/** Remote: send a command to the main device, with immediate local feedback. */
function routeToMain(command: Command): boolean {
  if (mcRole !== 'remote') return false;
  // Feedback straight away; the main device's next snapshot confirms it.
  if (command.type === 'focus') setFocus(command.trackId);
  else if (command.type === 'step') stepFocus(command.dir);
  else if (command.type === 'volume') setVolume(command.trackId, command.volume);
  else if (command.type === 'select') {
    if (setSelected(command.trackId, command.on)) renderStatus();
  } else if (command.type === 'seek') {
    playlistManager.updateTrack(command.trackId, { currentTime: command.time });
    mcBases.set(command.trackId, { t: command.time, at: performance.now() });
    renderTime();
  }

  // Slider drags: at most ~10 messages a second, and always the final value.
  if (command.type === 'volume' || command.type === 'seek') {
    const key = `${command.type}:${command.trackId}`;
    const slot = mcThrottle.get(key) ?? { last: 0, timer: 0, command: null };
    mcThrottle.set(key, slot);
    const wait = 100 - (Date.now() - slot.last);
    if (wait > 0) {
      slot.command = command;
      if (!slot.timer) {
        slot.timer = window.setTimeout(() => {
          slot.timer = 0;
          slot.last = Date.now();
          if (slot.command) sendToMain(slot.command);
          slot.command = null;
        }, wait);
      }
      return true;
    }
    slot.last = Date.now();
  }
  sendToMain(command);
  return true;
}

function sendToMain(command: Command): void {
  void sendCommand(command).then((reply) => {
    renderRemoteBadge();
    if (reply.ok) return;
    const main = mcStatus?.mainName || 'The main device';
    const text =
      reply.error === 'timeout'
        ? `${main} didn't respond.`
        : reply.error === 'no_main' || reply.error === 'offline'
          ? `${main} is offline.`
          : command.type === 'add' || command.type === 'relink'
            ? 'That link has no YouTube video in it.'
            : `${main} couldn't do that.`;
    if (command.type === 'add' || command.type === 'relink') showError(inputError, text);
    showRemoteNotice(text);
  });
  renderRemoteBadge();
}

/** Main device: run a command from a remote and answer it. */
function handleRemoteCommand(command: Command, reply: (ok: boolean, error?: string) => void): void {
  if (mcRole !== 'main' || !command || typeof command !== 'object' || typeof command.type !== 'string') {
    reply(false, 'not_main');
    return;
  }
  const ok = runLocalCommand(command);
  reply(ok, ok ? undefined : 'failed');
  if (ok) broadcastNow();
}

/** Become a remote: stop playing here and mirror the main device. */
function becomeRemote(): void {
  mcReleasing = false;
  mcResumeIds.clear();
  mcAutoplay.clear();
  stopPolling();
  playlistManager.clearTracks();
  playerBay.innerHTML = '';
  setCommandRoute(routeToMain);
  window.clearInterval(mcTicker);
  mcTicker = window.setInterval(remoteTick, 500);
  const last = lastRoomState();
  if (last) applyRoomState(last.state, last.ageMs);
  else renderAll(true);
  updateKeepAwake();
}

/** Stop being a remote: take over the mirrored mix here, paused, at the same positions. */
function leaveRemote(): void {
  setCommandRoute(null);
  window.clearInterval(mcTicker);
  mcTicker = 0;
  const mirrored = playlistManager.getTracks().map((t) => ({ ...t }));
  const wasPlaying = mirrored.filter((t) => t.state === 'playing').map((t) => t.id);
  mcResumeIds.clear();
  if (mcWantPlayHere) {
    // Play here: carry on with what was playing, as soon as the players are ready.
    mcWantPlayHere = false;
    window.clearTimeout(mcWantTimer);
    wasPlaying.forEach((id) => mcAutoplay.add(id));
  } else {
    // The main device went away: take the mix over paused, and offer Play here.
    wasPlaying.forEach((id) => mcResumeIds.add(id));
  }
  playlistManager.replaceTracks(mirrored.map((t) => ({ ...t, state: 'loading' as TrackState, meta: t.meta })));
  for (const t of mirrored) createPlayerFor(t.id, t.videoId, { volume: t.volume, loop: t.loop, time: t.currentTime });
  renderAll(false);
}

function onConnectionChange(status: ConnectionStatus): void {
  const previous = mcRole;
  const wasOnline = mcStatus?.state === 'online';
  mcStatus = status;
  mcRole = status.role;
  if (previous !== mcRole) {
    if (mcRole === 'remote') becomeRemote();
    else if (previous === 'remote') leaveRemote();
    if (mcRole === 'main') broadcastNow();
  } else if (mcRole === 'main' && status.state === 'online' && !wasOnline) {
    broadcastNow();
  }
  if (mcRole === 'idle' && status.state === 'online' && liveCount() > 0) maybeClaimMain();
  renderRemoteBadge();
}

/** The header badge: "Remote · Laptop", or "Playing here · 1 remote". */
function renderRemoteBadge(): void {
  const badge = $<HTMLElement>('remoteBadge');
  const text = $<HTMLElement>('remoteBadgeText');
  const button = $<HTMLButtonElement>('playHereButton');
  if (!badge || !text || mcNoticeTimer) return;
  const status = mcStatus;
  const offerResume = mcRole === 'idle' && mcResumeIds.size > 0;
  if (!status || status.state === 'off' || (mcRole === 'idle' && !offerResume)) {
    badge.hidden = true;
    return;
  }
  const remotes = status.devices.filter((d) => d.online && d.id !== status.mainId).length;
  const mainName = status.mainName || 'Main device';
  badge.hidden = false;
  badge.classList.toggle('is-offline', status.state !== 'online' || offerResume);
  badge.classList.toggle('is-pending', pendingCommands() > 0 || mcWantPlayHere);
  let showButton = false;
  if (mcWantPlayHere) {
    text.textContent = 'Moving playback here…';
  } else if (offerResume) {
    // The main device left, or this device lost the connection to it.
    text.textContent = status.state === 'online' ? `${mainName} offline` : 'Disconnected';
    showButton = true;
  } else if (mcRole === 'remote') {
    text.textContent = status.state === 'online' ? `Remote · ${mainName}` : 'Remote · reconnecting';
    showButton = status.state === 'online';
  } else if (status.state !== 'online') {
    text.textContent = 'Playing here · reconnecting';
  } else {
    text.textContent = remotes ? `Playing here · ${remotes} remote${remotes === 1 ? '' : 's'}` : 'Playing here';
  }
  if (button) button.hidden = !showButton;
}

/** A short message in the badge (a command that failed on the main device). */
function showRemoteNotice(message: string): void {
  const badge = $<HTMLElement>('remoteBadge');
  const text = $<HTMLElement>('remoteBadgeText');
  if (!badge || !text) return;
  window.clearTimeout(mcNoticeTimer);
  badge.hidden = false;
  badge.classList.add('is-notice');
  text.textContent = message;
  mcNoticeTimer = window.setTimeout(() => {
    mcNoticeTimer = 0;
    badge.classList.remove('is-notice');
    renderRemoteBadge();
  }, 4000);
}

/** Remote control: the Devices section and the connection to the paired room. */
async function setupRemoteControl(): Promise<void> {
  takeRelayOverride();
  onConnection(onConnectionChange);
  onRoomState(applyRoomState);
  onRemoteCommand(handleRemoteCommand);
  onRelease(releaseMain);
  $<HTMLButtonElement>('playHereButton')?.addEventListener('click', playHere);
  // The main device refreshes everyone's times every 15 seconds while playing.
  window.setInterval(() => {
    if (mcRole === 'main' && liveCount() > 0) broadcastNow();
  }, 15000);
  // A remote that hasn't heard from the main device for a while asks the relay
  // to check: a phone asleep with its connection half open gets dropped.
  window.setInterval(() => {
    if (mcRole !== 'remote' || mcStatus?.state !== 'online') return;
    const last = lastRoomState();
    if (!last || last.ageMs > 35000) sendProbe();
  }, 30000);
  setupDevicesPanel();
  setupReconnectTriggers();
  // A pairing link opened while the app is already open on this page.
  // Pairing shows its result in the Devices tab: bring it forward.
  window.addEventListener('hashchange', () => {
    const code = takePairCodeFromLocation();
    if (code) {
      showTab('settingsTabDevices');
      void joinWithCode(code);
    }
  });
  const pairCode = takePairCodeFromLocation();
  if (pairCode) showTab('settingsTabDevices');
  if (pairCode) await joinWithCode(pairCode);
  else connectRoom();
}

async function initialize(): Promise<void> {
  setCommandRunner(runLocalCommand);
  // Before remote control: a pairing link opens the Devices tab.
  setupTabs();
  void setupRemoteControl();
  setupScreenTakeover();
  setupScreenEffect();
  setupLayout();
  setupScaleControl();
  setupLayoutControl();
  setupSkinPanel();
  setupSkinLayout();
  window.addEventListener(SKIN_EVENT, () => requestAnimationFrame(updateScaleReadout));
  setupStageResize();
  buildStaticMeters();
  renderMixList();
  renderAll(false);

  await waitForYouTubeAPI();
  playerFactory = createYouTubePlayerFactory();
  initializeEventListeners();

  const sharedUrls = decodePlaylistFromLocation();
  if (sharedUrls && sharedUrls.length > 0) {
    clearPlaylistHash();
    await handleLoadPlaylist(sharedUrls, null);
    return;
  }

  const lastPlaylist = getLastPlaylist();
  // This device's own last mix: restored here only, never sent to a main
  // device (a remote that connected quickly shows the main device's mix).
  if (lastPlaylist && lastPlaylist.urls.length > 0 && mcRole !== 'remote') {
    runLocalCommand({
      type: 'load_mix',
      urls: lastPlaylist.urls,
      name: lastPlaylist.name,
      mode: 'replace',
      resume: lastPlaylist.resume ?? [],
    });
  }
}

initialize().catch(console.error);
