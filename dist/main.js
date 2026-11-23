/**
 * Main entry point.
 *
 * The app mixes several YouTube streams at once. One channel at a time is
 * "focused": it fills the centre of the screen and the deck controls it.
 * Every channel stays playable from the channel list.
 */
import { PlaylistManager } from './playlist.js';
import { waitForYouTubeAPI, createYouTubePlayerFactory, extractVideoId, isValidYouTubeUrl, } from './youtubePlayer.js';
import { saveOrUpdatePlaylist, deletePlaylist, getLastPlaylist, getAllPlaylists, } from './storage.js';
import { encodePlaylistToUrl, decodePlaylistFromLocation, clearPlaylistHash, } from './shareLinks.js';
import { channelRowHtml, patchChannelRow, stripItemHtml, patchStripItem, setRowDrawerOpen, setRowConfirm, renderSavedPlaylists, showReplaceAppendModal, showError, copyToClipboard, swapText, formatHMS, formatDb, pad2, icons, prefersReducedMotion, stateInfo, trackTitle, } from './ui.js';
import { extractAccent, isSquareArt, FALLBACK_ACCENT } from './accent.js';
import { setupLayout, refreshLayout } from './layout.js';
import { fullscreenSupported, isFullscreen, runningAsApp, runningAsFullscreenApp, enterFullscreen, exitFullscreen, onFullscreenChange, setKeepAwake, } from './screen.js';
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const playlistManager = new PlaylistManager();
let playerFactory;
let pollTimer = null;
let focusedId = null;
let mixName = null;
let seeking = false;
/** Channels whose settings drawer is open in the list. */
const openDrawers = new Set();
const VOLUME_BARS = 14;
// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const urlInput = $('urlInput');
const addButton = $('addButton');
const inputError = $('inputError');
const globalPlayPauseButton = $('globalPlayPause');
const loopSwitch = $('loopSwitch');
const shareButton = $('shareButton');
const playlistNameInput = $('playlistNameInput');
const savePlaylistButton = $('savePlaylistButton');
const savedPlaylistsList = $('savedPlaylistsList');
const channelList = $('playlist');
const channelCount = $('channelCount');
const playerBay = $('playerBay');
const fullscreenButton = $('fullscreenButton');
const statusCode = $('statusCode');
const statusLine = $('statusLine');
const telChannels = $('telChannels');
const telLive = $('telLive');
const statPlayback = $('statPlayback');
const statDur = $('statDur');
const backdropImg = $('backdropImg');
const stage = $('stage');
const art = $('art');
const artImg = $('artImg');
const artPlay = $('artPlay');
const mixStrip = $('mixStrip');
const stageIndex = $('stageIndex');
const stageState = $('stageState');
const stageArtist = $('stageArtist');
const stageTitle = $('stageTitle');
const scrub = $('scrub');
const seekInput = $('seekInput');
const scrubTime = $('scrubTime');
const scrubTicks = Array.from(document.querySelectorAll('[data-tick]'));
const prevButton = $('prevButton');
const playButton = $('playButton');
const nextButton = $('nextButton');
const resetButton = $('resetButton');
const volumeInput = $('volumeInput');
const volumeBars = $('volumeBars');
const volumeReadout = $('volumeReadout');
const volumeDb = $('volumeDb');
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function focusedTrack() {
    return focusedId ? playlistManager.getTrack(focusedId) : undefined;
}
function stripFor(id) {
    return mixStrip.querySelector(`[data-track-id="${CSS.escape(id)}"]`);
}
/** Scroll the strip sideways (never the page) just enough to show a tile. */
function keepTileVisible(tile) {
    const view = mixStrip.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (r.left < view.left)
        mixStrip.scrollBy({ left: r.left - view.left - 6, behavior });
    else if (r.right > view.right)
        mixStrip.scrollBy({ left: r.right - view.right + 6, behavior });
}
/** The mix strip under the title: rebuilt with the list, patched in place on state changes. */
function renderStrip() {
    const tracks = playlistManager.getTracks();
    const hadFocus = mixStrip.contains(document.activeElement)
        ? document.activeElement.closest('[data-track-id]')?.dataset.trackId
        : undefined;
    mixStrip.innerHTML = tracks.map((t, i) => stripItemHtml(t, i, t.id === focusedId)).join('');
    if (hadFocus)
        stripFor(hadFocus)?.querySelector('.strip__btn')?.focus();
}
function rowFor(id) {
    return channelList.querySelector(`[data-track-id="${CSS.escape(id)}"]`);
}
function liveCount() {
    return playlistManager.getTracks().filter((t) => t.state === 'playing').length;
}
function setPill(el, label, tone, extra = '') {
    el.textContent = label;
    el.className = `pill${extra} tone-${tone}`;
}
/** Accent and shape per artwork URL, so switching back to a channel needs no new sampling. */
const artCache = new Map();
/** Set the page accent; null means "no usable colour" and uses the amber fallback. */
function setAccent(color) {
    document.documentElement.style.setProperty('--accent', color || FALLBACK_ACCENT);
}
function setArtShape(square) {
    const shape = square ? 'square' : 'wide';
    if (stage.dataset.shape === shape)
        return;
    stage.dataset.shape = shape;
    refreshLayout();
}
function applyArtworkAnalysis() {
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
function buildStaticMeters() {
    volumeBars.innerHTML = Array.from({ length: VOLUME_BARS }, (_, i) => `<span style="--i:${i};--n:${VOLUME_BARS}"></span>`).join('');
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderChannels() {
    const tracks = playlistManager.getTracks();
    channelList.innerHTML = tracks
        .map((t, i) => channelRowHtml(t, i, t.id === focusedId, openDrawers.has(t.id)))
        .join('');
    channelCount.textContent = String(tracks.length);
    document.documentElement.dataset.empty = String(tracks.length === 0);
    updateListScroll();
    renderStrip();
}
/** Mark whether the channel list overflows, and whether it is scrolled to the end. */
function updateListScroll() {
    const panel = channelList.closest('.channels');
    if (!panel)
        return;
    const scrollable = channelList.scrollHeight > channelList.clientHeight + 1;
    panel.classList.toggle('is-scrollable', scrollable);
    panel.classList.toggle('is-at-end', channelList.scrollTop + channelList.clientHeight >= channelList.scrollHeight - 2);
}
/**
 * The box that scrolls the channel rows: the list itself on phones, the
 * controls pane in the pinned layout. Null when only the page scrolls.
 */
function rowScroller(row) {
    for (let el = row.parentElement; el && el !== document.body; el = el.parentElement) {
        const overflow = getComputedStyle(el).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1)
            return el;
    }
    return null;
}
/** Scroll that box (never the page) just enough to show a row. */
function keepRowVisible(row) {
    const box = rowScroller(row);
    if (!box)
        return;
    const view = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (r.top < view.top) {
        box.scrollBy({ top: r.top - view.top - 8, behavior });
    }
    else if (r.bottom > view.bottom) {
        box.scrollBy({ top: r.bottom - view.bottom + 8, behavior });
    }
}
function renderRow(id) {
    const tracks = playlistManager.getTracks();
    const index = tracks.findIndex((t) => t.id === id);
    const row = rowFor(id);
    if (index < 0 || !row)
        return;
    const hadFocus = row.contains(document.activeElement);
    row.outerHTML = channelRowHtml(tracks[index], index, id === focusedId, openDrawers.has(id));
    if (hadFocus)
        rowFor(id)?.querySelector('.ch__focus')?.focus();
    updateListScroll();
    renderStrip();
}
function renderStatus() {
    const tracks = playlistManager.getTracks();
    const live = liveCount();
    telChannels.textContent = String(tracks.length);
    telLive.textContent = String(live);
    document.documentElement.dataset.live = String(live > 0);
    statusCode.textContent = mixName || 'Unsaved mix';
    statusLine.textContent =
        tracks.length === 0
            ? 'No channels'
            : live > 0
                ? `${live} of ${tracks.length} playing`
                : `${tracks.length} channel${tracks.length === 1 ? '' : 's'} on hold`;
    if (tracks.length === 0)
        setPill(statPlayback, 'Standby', 'idle');
    else if (live > 0)
        setPill(statPlayback, 'Playing', 'live');
    else
        setPill(statPlayback, 'On hold', 'idle');
    updateKeepAwake();
    globalPlayPauseButton.textContent = live > 0 ? 'Pause all' : 'Play all';
    globalPlayPauseButton.disabled = tracks.length === 0;
    shareButton.disabled = tracks.length === 0;
}
// ---------------------------------------------------------------------------
// Screen takeover
// ---------------------------------------------------------------------------
/** Keep the screen on while something plays in fullscreen or in the installed app. */
function updateKeepAwake() {
    void setKeepAwake(liveCount() > 0 && (isFullscreen() || runningAsApp()));
}
function updateFullscreenButton() {
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
function setupScreenTakeover() {
    updateFullscreenButton();
    onFullscreenChange(() => {
        updateFullscreenButton();
        updateKeepAwake();
    });
    // The installed app already runs without browser UI; where the browser
    // can't do fullscreen (iPhone Safari), there is nothing to offer.
    if (!fullscreenSupported() || runningAsFullscreenApp())
        return;
    fullscreenButton.hidden = false;
    fullscreenButton.addEventListener('click', () => {
        if (isFullscreen())
            void exitFullscreen();
        else
            void enterFullscreen();
    });
    const takeover = (e) => {
        document.removeEventListener('click', takeover, true);
        if (e.target.closest('#fullscreenButton'))
            return;
        if (!isFullscreen())
            void enterFullscreen();
    };
    // Capture phase: the tap still reaches whatever it was aimed at.
    document.addEventListener('click', takeover, true);
}
/** Fill the centre from the focused channel. changed=true fades the new channel in. */
function renderStage(changed) {
    const track = focusedTrack();
    const tracks = playlistManager.getTracks();
    const index = track ? tracks.indexOf(track) : -1;
    const usable = !!track && (track.state === 'playing' || track.state === 'paused');
    art.dataset.state = track ? track.state : 'empty';
    stageIndex.textContent = track ? `Channel ${pad2(index + 1)} of ${pad2(tracks.length)}` : 'No channel selected';
    if (track) {
        const { label, tone } = stateInfo(track);
        setPill(stageState, label, tone);
    }
    else {
        setPill(stageState, 'Standby', 'idle');
    }
    const title = track ? trackTitle(track) : 'Nothing playing yet';
    const artist = track
        ? track.meta?.author || (track.state === 'error' ? 'Check the link or try another video' : 'YouTube')
        : 'Each YouTube link becomes a channel with its own volume.';
    if (changed) {
        swapText(stageTitle, title);
        swapText(stageArtist, artist, 60);
    }
    else {
        stageTitle.textContent = title;
        stageArtist.textContent = artist;
    }
    // Artwork: maxresdefault is true 16:9; hqdefault always exists but carries letterbox bars.
    const src = track?.meta ? `https://img.youtube.com/vi/${track.meta.id}/maxresdefault.jpg` : '';
    if (artImg.dataset.src !== src) {
        artImg.dataset.src = src;
        artImg.dataset.fallback = track?.meta?.thumbnailUrl || '';
        artImg.classList.remove('is-letterboxed');
        backdropImg.classList.remove('is-letterboxed');
        if (src) {
            artImg.src = src;
            backdropImg.src = src;
        }
        else {
            artImg.removeAttribute('src');
            backdropImg.removeAttribute('src');
            setAccent(null);
            setArtShape(false);
        }
        if (changed && src && !prefersReducedMotion()) {
            art.animate([{ opacity: 0.4, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
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
    playButton.querySelector('svg').outerHTML = playing ? icons.pause : icons.play;
    playButton.querySelector('span').textContent = playing ? 'Pause' : 'Play';
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
function renderTime() {
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
    if (!seeking)
        seekInput.value = String(Math.round(p * 1000));
    seekInput.setAttribute('aria-valuetext', `${formatHMS(t)} of ${d ? formatHMS(d) : 'unknown'}`);
}
function renderVolume() {
    const track = focusedTrack();
    const v = track ? track.volume : 0;
    const pct = Math.round(v * 100);
    if (document.activeElement !== volumeInput)
        volumeInput.value = String(pct);
    volumeInput.style.setProperty('--v', `${pct}%`);
    volumeInput.setAttribute('aria-valuetext', `${pct} percent`);
    volumeReadout.textContent = track ? `${pct} %` : '—';
    volumeDb.textContent = track ? formatDb(v) : 'No channel';
    const lit = Math.round(v * VOLUME_BARS);
    Array.from(volumeBars.children).forEach((bar, i) => {
        bar.classList.toggle('is-on', i < lit);
    });
}
function renderAll(changed = false) {
    renderChannels();
    renderStatus();
    renderStage(changed);
}
function setFocus(id) {
    if (id === focusedId)
        return;
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
    mixStrip.querySelectorAll('.strip__item').forEach((tile) => {
        const on = tile.dataset.trackId === id;
        tile.classList.toggle('is-focus', on);
        tile.querySelector('.strip__btn')?.setAttribute('aria-current', String(on));
        if (on)
            keepTileVisible(tile);
    });
    renderStage(true);
}
function stepFocus(dir) {
    const tracks = playlistManager.getTracks();
    if (tracks.length === 0)
        return;
    const i = tracks.findIndex((t) => t.id === focusedId);
    setFocus(tracks[(i + dir + tracks.length) % tracks.length].id);
}
// ---------------------------------------------------------------------------
// Playback loop
// ---------------------------------------------------------------------------
function poll() {
    let anyPlaying = false;
    for (const track of playlistManager.getTracks()) {
        if (track.state !== 'playing')
            continue;
        anyPlaying = true;
        const controller = playlistManager.getController(track.id);
        if (!controller)
            continue;
        const duration = controller.getDuration();
        playlistManager.updateTrack(track.id, {
            currentTime: controller.getCurrentTime(),
            duration: duration > 0 ? duration : track.duration,
        });
        if (track.meta && !track.meta.author)
            fillAuthor(track.id);
        const row = rowFor(track.id);
        const updated = playlistManager.getTrack(track.id);
        if (row && updated)
            patchChannelRow(row, updated);
    }
    renderTime();
    if (!anyPlaying)
        stopPolling();
}
/** YouTube reports the channel name only after playback starts: fill it in when it arrives. */
function fillAuthor(id) {
    const track = playlistManager.getTrack(id);
    const author = playlistManager.getController(id)?.getAuthor();
    if (!track?.meta || !author)
        return;
    playlistManager.updateTrack(id, { meta: { ...track.meta, author } });
    renderRow(id);
    if (id === focusedId)
        swapText(stageArtist, author);
}
function startPolling() {
    if (pollTimer === null)
        pollTimer = window.setInterval(poll, 250);
}
function stopPolling() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
function createPlayerFor(trackId, videoId, keep) {
    playerBay.querySelector(`[data-slot="${CSS.escape(trackId)}"]`)?.remove();
    const slot = document.createElement('div');
    slot.dataset.slot = trackId;
    const inner = document.createElement('div');
    slot.appendChild(inner);
    playerBay.appendChild(slot);
    const controller = playerFactory.createPlayer(trackId, inner, videoId, (id, meta) => {
        playlistManager.updateTrack(id, {
            meta,
            state: 'paused',
            duration: meta.durationSeconds,
            ...(keep ? { volume: keep.volume, loop: keep.loop } : {}),
        });
        const track = playlistManager.getTrack(id);
        if (track)
            playlistManager.getController(id)?.setVolume(track.volume);
        renderRow(id);
        renderStatus();
        if (id === focusedId)
            renderStage(true);
    }, (id, state) => onTrackState(id, state), (id, error) => {
        playlistManager.updateTrack(id, { state: 'error', error });
        renderRow(id);
        renderStatus();
        if (id === focusedId)
            renderStage(true);
    });
    playlistManager.setController(trackId, controller);
}
function onTrackState(id, state) {
    const before = playlistManager.getTrack(id);
    if (!before || before.state === 'error')
        return;
    playlistManager.updateTrack(id, { state });
    const controller = playlistManager.getController(id);
    if (controller)
        playlistManager.updateTrack(id, { currentTime: controller.getCurrentTime() });
    const track = playlistManager.getTrack(id);
    const row = rowFor(id);
    if (row)
        patchChannelRow(row, track);
    const tile = stripFor(id);
    if (tile)
        patchStripItem(tile, track, playlistManager.getTracks().indexOf(track));
    renderStatus();
    if (id === focusedId)
        renderStage(false);
    if (state === 'playing')
        startPolling();
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
function addTrackFromUrl(url) {
    const videoId = isValidYouTubeUrl(url) ? extractVideoId(url) : null;
    if (!videoId) {
        showError(inputError, 'That link has no YouTube video in it. Use a youtube.com/watch or youtu.be link.');
        return false;
    }
    const track = playlistManager.addTrack(url, videoId);
    createPlayerFor(track.id, videoId);
    if (!focusedId)
        focusedId = track.id;
    return true;
}
function removeTrack(id) {
    const index = playlistManager.getTracks().findIndex((t) => t.id === id);
    playlistManager.removeTrack(id);
    openDrawers.delete(id);
    playerBay.querySelector(`[data-slot="${CSS.escape(id)}"]`)?.remove();
    if (focusedId === id) {
        const rest = playlistManager.getTracks();
        focusedId = rest.length ? rest[Math.min(index, rest.length - 1)].id : null;
        renderAll(true);
    }
    else {
        renderAll(false);
    }
}
function reloadTrack(id, newUrl) {
    const track = playlistManager.getTrack(id);
    const newVideoId = isValidYouTubeUrl(newUrl) ? extractVideoId(newUrl) : null;
    if (!track || !newVideoId) {
        showError(inputError, 'That link has no YouTube video in it. The channel was not changed.');
        return;
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
    if (id === focusedId)
        renderStage(true);
}
function togglePlay(id) {
    const track = playlistManager.getTrack(id);
    const controller = playlistManager.getController(id);
    if (!track || !controller)
        return;
    if (track.state === 'playing')
        controller.pause();
    else if (track.state === 'paused') {
        controller.play();
        startPolling();
    }
}
function setVolume(id, volume) {
    playlistManager.getController(id)?.setVolume(volume);
    playlistManager.updateTrack(id, { volume });
    const row = rowFor(id);
    const track = playlistManager.getTrack(id);
    if (row && track)
        patchChannelRow(row, track);
    if (id === focusedId)
        renderVolume();
}
function loadTracksFromUrls(urls, mode) {
    if (mode === 'replace') {
        playlistManager.clearTracks();
        openDrawers.clear();
        playerBay.innerHTML = '';
        focusedId = null;
    }
    for (const url of urls)
        addTrackFromUrl(url);
    renderAll(true);
}
async function handleLoadPlaylist(urls, name) {
    const open = playlistManager.getTracks().length;
    if (open === 0) {
        mixName = name;
        loadTracksFromUrls(urls, 'replace');
        return;
    }
    const choice = await showReplaceAppendModal(`This mix has ${urls.length} channel${urls.length === 1 ? '' : 's'}. Replace the ${open} you have open, or add them to the current mix?`);
    if (choice === 'cancel')
        return;
    if (choice === 'replace')
        mixName = name;
    loadTracksFromUrls(urls, choice);
}
function flash(button, text) {
    const original = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = original), 1800);
}
// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function initializeEventListeners() {
    const submitUrl = () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError(inputError, 'Paste a YouTube link first.');
            urlInput.focus();
            return;
        }
        const wasEmpty = playlistManager.getTracks().length === 0;
        if (addTrackFromUrl(url)) {
            urlInput.value = '';
            inputError.textContent = '';
            renderAll(wasEmpty);
        }
    };
    addButton.addEventListener('click', submitUrl);
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            submitUrl();
    });
    globalPlayPauseButton.addEventListener('click', () => {
        const tracks = playlistManager.getTracks();
        if (playlistManager.hasPlayingTracks()) {
            tracks.forEach((t) => t.state === 'playing' && playlistManager.getController(t.id)?.pause());
        }
        else {
            tracks.forEach((t) => t.state === 'paused' && playlistManager.getController(t.id)?.play());
            startPolling();
        }
    });
    loopSwitch.addEventListener('click', () => {
        const track = focusedTrack();
        if (!track)
            return;
        playlistManager.updateTrack(track.id, { loop: !track.loop });
        renderStage(false);
    });
    shareButton.addEventListener('click', async () => {
        const urls = playlistManager.getTrackUrls();
        if (urls.length === 0)
            return showError(inputError, 'Add a channel before sharing the mix.');
        const ok = await copyToClipboard(encodePlaylistToUrl(urls));
        if (ok)
            flash(shareButton, 'Link copied');
        else
            showError(inputError, 'The browser blocked the clipboard, so the link was not copied.');
    });
    savePlaylistButton.addEventListener('click', () => {
        const name = playlistNameInput.value.trim();
        if (!name) {
            showError(inputError, 'Name the mix before saving it.');
            playlistNameInput.focus();
            return;
        }
        const urls = playlistManager.getTrackUrls();
        if (urls.length === 0)
            return showError(inputError, 'Add a channel before saving a mix.');
        saveOrUpdatePlaylist(name, urls);
        mixName = name;
        playlistNameInput.value = '';
        renderSavedPlaylists(getAllPlaylists(), savedPlaylistsList);
        renderStatus();
        flash(savePlaylistButton, 'Saved');
    });
    playlistNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            savePlaylistButton.click();
    });
    savedPlaylistsList.addEventListener('click', async (e) => {
        const button = e.target.closest('[data-mix-action]');
        const name = button?.dataset.playlistName;
        if (!button || !name)
            return;
        const playlist = getAllPlaylists().find((p) => p.name === name);
        if (button.dataset.mixAction === 'load' && playlist) {
            await handleLoadPlaylist(playlist.urls, playlist.name);
        }
        else if (button.dataset.mixAction === 'delete' && confirm(`Delete the mix "${name}"? This cannot be undone.`)) {
            deletePlaylist(name);
            if (mixName === name)
                mixName = null;
            renderSavedPlaylists(getAllPlaylists(), savedPlaylistsList);
            renderStatus();
        }
    });
    // Channel list: one delegated listener for every row.
    channelList.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        const id = el?.closest('[data-track-id]')?.dataset.trackId;
        if (!el || !id)
            return;
        if (el.dataset.action === 'focus')
            setFocus(id);
        else if (el.dataset.action === 'toggle')
            togglePlay(id);
        else if (el.dataset.action === 'drawer') {
            const open = !openDrawers.has(id);
            if (open)
                openDrawers.add(id);
            else
                openDrawers.delete(id);
            const row = rowFor(id);
            if (row) {
                setRowDrawerOpen(row, open);
                if (open)
                    keepRowVisible(row);
            }
            updateListScroll();
        }
        else if (el.dataset.action === 'relink') {
            const input = rowFor(id)?.querySelector('.ch__link-input');
            const url = input?.value.trim();
            if (url)
                reloadTrack(id, url);
        }
        else if (el.dataset.action === 'remove-ask') {
            const row = rowFor(id);
            if (row) {
                setRowConfirm(row, true);
                row.querySelector('[data-action="remove-no"]')?.focus();
            }
        }
        else if (el.dataset.action === 'remove-no') {
            const row = rowFor(id);
            if (row) {
                setRowConfirm(row, false);
                row.querySelector('[data-action="remove-ask"]')?.focus();
            }
        }
        else if (el.dataset.action === 'remove-yes') {
            const tracks = playlistManager.getTracks();
            const next = tracks[tracks.findIndex((t) => t.id === id) + 1] ?? tracks[tracks.findIndex((t) => t.id === id) - 1];
            removeTrack(id);
            // Keep keyboard users in the list rather than dropping focus to the page.
            (next ? rowFor(next.id)?.querySelector('.ch__focus') : urlInput)?.focus();
        }
    });
    channelList.addEventListener('keydown', (e) => {
        const target = e.target;
        const row = target.closest('[data-track-id]');
        if (!row)
            return;
        if (e.key === 'Enter' && target.matches('.ch__link-input')) {
            row.querySelector('[data-action="relink"]')?.click();
        }
        else if (e.key === 'Escape' && target.closest('.ch__confirm')) {
            e.preventDefault();
            setRowConfirm(row, false);
            row.querySelector('[data-action="remove-ask"]')?.focus();
        }
    });
    channelList.addEventListener('scroll', updateListScroll, { passive: true });
    window.addEventListener('resize', updateListScroll);
    channelList.addEventListener('input', (e) => {
        const input = e.target;
        const id = input.closest('[data-track-id]')?.dataset.trackId;
        if (id && input.dataset.action === 'volume')
            setVolume(id, Number(input.value) / 100);
    });
    /** Switch to the always-present thumbnail; false when already on it. */
    const useFallback = () => {
        const fallback = artImg.dataset.fallback;
        if (fallback && !artImg.classList.contains('is-letterboxed')) {
            artImg.classList.add('is-letterboxed');
            backdropImg.classList.add('is-letterboxed');
            artImg.src = fallback;
            backdropImg.src = fallback;
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
        if (artImg.naturalWidth <= 120 && useFallback())
            return;
        applyArtworkAnalysis();
    });
    // Main display: tap the artwork to play or pause; the strip focuses or toggles channels.
    artPlay.addEventListener('click', () => focusedId && togglePlay(focusedId));
    mixStrip.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        const id = el?.closest('[data-track-id]')?.dataset.trackId;
        if (!el || !id)
            return;
        if (el.dataset.action === 'focus')
            setFocus(id);
        else if (el.dataset.action === 'toggle')
            togglePlay(id);
    });
    // Deck
    playButton.addEventListener('click', () => focusedId && togglePlay(focusedId));
    prevButton.addEventListener('click', () => stepFocus(-1));
    nextButton.addEventListener('click', () => stepFocus(1));
    resetButton.addEventListener('click', () => {
        const track = focusedTrack();
        const controller = track && playlistManager.getController(track.id);
        if (!track || !controller)
            return;
        controller.pause();
        controller.seekTo(0);
        playlistManager.updateTrack(track.id, { currentTime: 0 });
        const row = rowFor(track.id);
        if (row)
            patchChannelRow(row, playlistManager.getTrack(track.id));
        renderTime();
    });
    const endSeek = () => (seeking = false);
    seekInput.addEventListener('pointerdown', () => (seeking = true));
    seekInput.addEventListener('pointerup', endSeek);
    seekInput.addEventListener('pointercancel', endSeek);
    seekInput.addEventListener('change', endSeek);
    seekInput.addEventListener('input', () => {
        const track = focusedTrack();
        const controller = track && playlistManager.getController(track.id);
        if (!track || !controller || !track.duration)
            return;
        const target = (Number(seekInput.value) / 1000) * track.duration;
        controller.seekTo(target);
        playlistManager.updateTrack(track.id, { currentTime: target });
        const row = rowFor(track.id);
        if (row)
            patchChannelRow(row, playlistManager.getTrack(track.id));
        renderTime();
    });
    volumeInput.addEventListener('input', () => {
        if (focusedId)
            setVolume(focusedId, Number(volumeInput.value) / 100);
    });
    // Keyboard: Space plays the focused channel, [ and ] step between channels.
    document.addEventListener('keydown', (e) => {
        const target = e.target;
        if (e.metaKey || e.ctrlKey || e.altKey)
            return;
        if (target.closest('input, textarea, select, button, summary, [contenteditable], .modal-overlay'))
            return;
        if (e.key === ' ' && focusedId) {
            e.preventDefault();
            togglePlay(focusedId);
        }
        else if (e.key === '[') {
            stepFocus(-1);
        }
        else if (e.key === ']') {
            stepFocus(1);
        }
    });
}
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function initialize() {
    setupScreenTakeover();
    setupLayout();
    buildStaticMeters();
    renderSavedPlaylists(getAllPlaylists(), savedPlaylistsList);
    renderAll(false);
    await waitForYouTubeAPI();
    playerFactory = createYouTubePlayerFactory();
    initializeEventListeners();
    document.documentElement.dataset.ready = 'true';
    const sharedUrls = decodePlaylistFromLocation();
    if (sharedUrls && sharedUrls.length > 0) {
        clearPlaylistHash();
        await handleLoadPlaylist(sharedUrls, null);
        return;
    }
    const lastPlaylist = getLastPlaylist();
    if (lastPlaylist && lastPlaylist.urls.length > 0) {
        mixName = lastPlaylist.name;
        loadTracksFromUrls(lastPlaylist.urls, 'replace');
    }
}
initialize().catch(console.error);
