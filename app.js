(function() {
"use strict";

// ===== storage.js =====
/**
 * Storage module for localStorage operations
 */
const STORAGE_KEY = 'yt_audio_playlists';
/**
 * Load stored data from localStorage
 */
function loadStoredData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
        return { playlists: [] };
    try {
        return JSON.parse(raw);
    }
    catch {
        return { playlists: [] };
    }
}
/**
 * Save stored data to localStorage
 */
function saveStoredData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
/**
 * Save or update a playlist
 */
function saveOrUpdatePlaylist(name, urls) {
    const data = loadStoredData();
    const existing = data.playlists.find(p => p.name === name);
    if (existing) {
        existing.urls = urls;
    }
    else {
        data.playlists.push({ name, urls });
    }
    data.lastPlaylistName = name;
    saveStoredData(data);
}
/**
 * Delete a playlist by name
 */
function deletePlaylist(name) {
    const data = loadStoredData();
    data.playlists = data.playlists.filter(p => p.name !== name);
    if (data.lastPlaylistName === name) {
        delete data.lastPlaylistName;
    }
    saveStoredData(data);
}
/**
 * Get the last used playlist
 */
function getLastPlaylist() {
    const data = loadStoredData();
    if (!data.lastPlaylistName)
        return;
    return data.playlists.find(p => p.name === data.lastPlaylistName);
}
/**
 * Get all saved playlists
 */
function getAllPlaylists() {
    return loadStoredData().playlists;
}


// ===== playlist.js =====
/**
 * Playlist manager module
 */
/**
 * Manages the playlist state and track controllers
 */
class PlaylistManager {
    constructor() {
        this.state = { tracks: [] };
        this.controllers = new Map();
    }
    /**
     * Add a new track to the playlist
     */
    addTrack(url, videoId) {
        const track = {
            id: crypto.randomUUID(),
            url,
            videoId,
            state: 'loading',
            currentTime: 0,
            volume: 1,
            isMuted: false,
            loop: true,
        };
        this.state.tracks.push(track);
        return track;
    }
    /**
     * Update a track with partial data
     */
    updateTrack(id, partial) {
        const track = this.state.tracks.find(t => t.id === id);
        if (!track)
            return;
        Object.assign(track, partial);
    }
    /**
     * Remove a track from the playlist
     */
    removeTrack(id) {
        this.state.tracks = this.state.tracks.filter(t => t.id !== id);
        const controller = this.controllers.get(id);
        if (controller) {
            controller.destroy();
            this.controllers.delete(id);
        }
    }
    /**
     * Get all tracks (read-only)
     */
    getTracks() {
        return this.state.tracks;
    }
    /**
     * Get a specific track by ID
     */
    getTrack(id) {
        return this.state.tracks.find(t => t.id === id);
    }
    /**
     * Set the controller for a track
     */
    setController(id, controller) {
        this.controllers.set(id, controller);
    }
    /**
     * Get the controller for a track
     */
    getController(id) {
        return this.controllers.get(id);
    }
    /**
     * Clear all tracks
     */
    clearTracks() {
        // Destroy all controllers
        for (const controller of this.controllers.values()) {
            controller.destroy();
        }
        this.controllers.clear();
        this.state.tracks = [];
    }
    /**
     * Get all track URLs in order
     */
    getTrackUrls() {
        return this.state.tracks.map(t => t.url);
    }
    /**
     * Check if any track is currently playing
     */
    hasPlayingTracks() {
        return this.state.tracks.some(t => t.state === 'playing');
    }
}


// ===== youtubePlayer.js =====
/**
 * YouTube IFrame API wrapper
 */
/**
 * Wait for YouTube IFrame API to be ready
 */
function waitForYouTubeAPI() {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            resolve();
        }
        else {
            window.onYouTubeIframeAPIReady = () => {
                resolve();
            };
        }
    });
}
/**
 * Create a YouTube player controller
 */
function createYouTubePlayerFactory() {
    return {
        createPlayer(trackId, containerElement, videoId, onMeta, onState, onError) {
            let player = null;
            let isReady = false;
            let timeoutId = null;
            const controller = {
                play() {
                    if (isReady && player) {
                        player.playVideo();
                    }
                },
                pause() {
                    if (isReady && player) {
                        player.pauseVideo();
                    }
                },
                seekTo(seconds) {
                    if (isReady && player) {
                        player.seekTo(seconds, true);
                    }
                },
                setVolume(volume) {
                    if (isReady && player) {
                        player.setVolume(volume * 100);
                    }
                },
                getCurrentTime() {
                    if (isReady && player) {
                        return player.getCurrentTime();
                    }
                    return 0;
                },
                getDuration() {
                    if (isReady && player) {
                        return player.getDuration();
                    }
                    return 0;
                },
                getAuthor() {
                    if (isReady && player) {
                        try {
                            return player.getVideoData().author || '';
                        }
                        catch {
                            return '';
                        }
                    }
                    return '';
                },
                destroy() {
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    if (player) {
                        player.destroy();
                        player = null;
                    }
                },
            };
            // Set a timeout to detect if the player fails to initialize
            timeoutId = window.setTimeout(() => {
                if (!isReady) {
                    onError(trackId, {
                        code: 'TIMEOUT',
                        message: 'Failed to load video (timeout)',
                    });
                }
            }, 10000); // 10 second timeout
            try {
                // Create the YouTube player
                player = new YT.Player(containerElement, {
                    videoId,
                    width: 1,
                    height: 1,
                    playerVars: {
                        autoplay: 0,
                        controls: 0,
                        enablejsapi: 1,
                        origin: window.location.origin,
                    },
                    events: {
                        onReady(event) {
                            isReady = true;
                            if (timeoutId !== null) {
                                clearTimeout(timeoutId);
                                timeoutId = null;
                            }
                            try {
                                const videoData = event.target.getVideoData();
                                const duration = event.target.getDuration();
                                const meta = {
                                    id: videoData.video_id,
                                    title: videoData.title || 'Unknown Title',
                                    author: videoData.author || undefined,
                                    thumbnailUrl: `https://img.youtube.com/vi/${videoData.video_id}/hqdefault.jpg`,
                                    durationSeconds: duration > 0 ? duration : undefined,
                                };
                                onMeta(trackId, meta);
                                onState(trackId, 'paused');
                            }
                            catch (error) {
                                onError(trackId, {
                                    code: 'METADATA_ERROR',
                                    message: 'Failed to load video metadata',
                                });
                            }
                        },
                        onStateChange(event) {
                            const state = event.data;
                            if (state === YT.PlayerState.PLAYING) {
                                onState(trackId, 'playing');
                            }
                            else if (state === YT.PlayerState.PAUSED) {
                                onState(trackId, 'paused');
                            }
                            else if (state === YT.PlayerState.ENDED) {
                                // Mark as ended by setting paused state
                                // The loop logic in main.ts will handle restarting if needed
                                onState(trackId, 'paused');
                            }
                        },
                        onError(event) {
                            if (timeoutId !== null) {
                                clearTimeout(timeoutId);
                                timeoutId = null;
                            }
                            const errorCode = event.data;
                            let errorMessage = 'Cannot load this video';
                            let code = 'UNKNOWN_ERROR';
                            switch (errorCode) {
                                case 2:
                                    errorMessage = 'Invalid video ID';
                                    code = 'INVALID_PARAM';
                                    break;
                                case 5:
                                    errorMessage = 'HTML5 player error';
                                    code = 'HTML5_ERROR';
                                    break;
                                case 100:
                                    errorMessage = 'Video not found or private';
                                    code = 'NOT_FOUND';
                                    break;
                                case 101:
                                case 150:
                                    errorMessage = 'Cannot load this video (embedding disabled)';
                                    code = 'EMBED_BLOCKED';
                                    break;
                            }
                            onError(trackId, { code, message: errorMessage });
                        },
                    },
                });
            }
            catch (error) {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                onError(trackId, {
                    code: 'PLAYER_CREATION_ERROR',
                    message: 'Failed to create YouTube player',
                });
            }
            return controller;
        },
    };
}
/**
 * Extract YouTube video ID from URL
 */
function extractVideoId(url) {
    try {
        const urlObj = new URL(url);
        // Standard youtube.com URLs
        if (urlObj.hostname === 'www.youtube.com' || urlObj.hostname === 'youtube.com') {
            const videoId = urlObj.searchParams.get('v');
            if (videoId)
                return videoId;
        }
        // youtu.be short URLs
        if (urlObj.hostname === 'youtu.be') {
            const videoId = urlObj.pathname.slice(1);
            if (videoId)
                return videoId;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Validate if a URL is a valid YouTube URL
 */
function isValidYouTubeUrl(url) {
    return extractVideoId(url) !== null;
}


// ===== shareLinks.js =====
/**
 * Share links module for encoding/decoding playlist URLs
 */
/**
 * Encode a list of URLs into a shareable URL
 */
function encodePlaylistToUrl(urls) {
    const json = JSON.stringify(urls);
    const base64 = btoa(json)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const url = new URL(window.location.href);
    url.hash = `pl=${base64}`;
    return url.toString();
}
/**
 * Decode playlist URLs from the current location hash
 */
function decodePlaylistFromLocation() {
    const hash = window.location.hash;
    if (!hash.startsWith('#pl='))
        return null;
    const base64 = hash.slice(4)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    try {
        const json = atob(base64);
        const urls = JSON.parse(json);
        if (!Array.isArray(urls))
            return null;
        return urls;
    }
    catch {
        return null;
    }
}
/**
 * Clear the playlist hash from the URL
 */
function clearPlaylistHash() {
    if (window.location.hash.startsWith('#pl=')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}


// ===== ui.js =====
/**
 * UI module: formatting, icons, channel row markup and dialogs.
 * Every string that came from outside (video titles, channel names, mix names)
 * passes through esc() before it reaches innerHTML.
 */
/** Escape text for safe use inside HTML markup and attributes. */
function esc(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function pad2(n) {
    return Math.floor(n).toString().padStart(2, '0');
}
/** Seconds to HH:MM:SS. */
function formatHMS(seconds) {
    return clockParts(seconds).join(':');
}
/** Short form for lists: M:SS under an hour, H:MM:SS above. */
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
/** Seconds to the three clock fields: hours, minutes, seconds. */
function clockParts(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        seconds = 0;
    return [
        pad2(seconds / 3600),
        pad2((seconds % 3600) / 60),
        pad2(seconds % 60),
    ];
}
/** Volume 0..1 to a decibel readout. */
function formatDb(volume) {
    if (volume <= 0.001)
        return '−∞ dB';
    const db = 20 * Math.log10(volume);
    return `${db <= -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}
function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Replace text with a short fade-up, used when the focused channel changes. */
function swapText(el, text, delay = 0) {
    if (el.textContent === text)
        return;
    el.textContent = text;
    if (prefersReducedMotion())
        return;
    el.animate([
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
    ], { duration: 320, delay, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
}
/** Line icons on a 24px grid, 1.6px stroke, round joins. */
const line = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.9-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/></svg>',
    prev: line('<path d="M18 6v12l-9-6z"/><path d="M6 6v12"/>'),
    next: line('<path d="M6 6v12l9-6z"/><path d="M18 6v12"/>'),
    stop: line('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    repeat: line('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    plus: line('<path d="M12 5v14M5 12h14"/>'),
    trash: line('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 12.5h9l1-12.5"/>'),
    clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    timer: line('<path d="M10 2.5h4"/><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5 15 10.5"/>'),
    layers: line('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
    live: line('<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>'),
    activity: line('<path d="M21 12h-4l-3 8-4-16-3 8H3"/>'),
    link: line('<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>'),
    volume: line('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
    source: line('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>'),
    bookmark: line('<path d="M18 20.5 12 16l-6 4.5V5.5A2 2 0 0 1 8 3.5h8a2 2 0 0 1 2 2z"/>'),
    hourglass: line('<path d="M6.5 3h11M6.5 21h11"/><path d="M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"/>'),
};
function stateInfo(track) {
    switch (track.state) {
        case 'playing': return { label: 'Playing', tone: 'live' };
        case 'paused': return { label: 'On hold', tone: 'idle' };
        case 'loading': return { label: 'Loading', tone: 'busy' };
        case 'error': return { label: 'Unavailable', tone: 'warn' };
    }
}
function trackTitle(track) {
    if (track.state === 'error')
        return track.error?.message || 'This video cannot play here';
    if (track.state === 'loading' && !track.meta)
        return 'Loading channel';
    return track.meta?.title || 'Untitled video';
}
/**
 * Markup for one channel row. The row's own volume slider stays hidden behind
 * a toggle (volumeOpen) so scrolling the list cannot nudge it by accident.
 */
function channelRowHtml(track, index, focused, volumeOpen = false) {
    const title = esc(trackTitle(track));
    const author = esc(track.meta?.author || 'YouTube');
    const thumb = track.meta?.thumbnailUrl
        ? `<img class="ch__thumb" src="${esc(track.meta.thumbnailUrl)}" alt="" loading="lazy" />`
        : '<span class="ch__thumb ch__thumb--empty" aria-hidden="true"></span>';
    const playing = track.state === 'playing';
    const usable = track.state === 'playing' || track.state === 'paused';
    const { label, tone } = stateInfo(track);
    const vol = Math.round(track.volume * 100);
    return `
    <li class="ch is-${track.state}${focused ? ' is-focus' : ''}" data-track-id="${esc(track.id)}">
      <div class="ch__main">
        <button class="ch__focus" type="button" data-action="focus" aria-current="${focused ? 'true' : 'false'}" aria-label="Show ${title} in the player">
          ${thumb}
          <span class="ch__text">
            <span class="ch__title">${title}</span>
            <span class="ch__meta">
              <span class="ch__state tone-${tone}">${label}</span>
              <span class="ch__time">${pad2(index + 1)} · ${author}</span>
            </span>
          </span>
        </button>
        <button class="vol-toggle${volumeOpen ? ' is-open' : ''}" type="button" data-action="vol-toggle" aria-expanded="${volumeOpen}" aria-controls="vol-${esc(track.id)}" aria-label="Volume for ${title}: ${vol} percent"${usable ? '' : ' disabled'}>
          ${icons.volume}<span class="vol-toggle__num">${vol}</span>
        </button>
        <button class="round-btn ch__toggle${playing ? ' is-on' : ''}" type="button" data-action="toggle" aria-label="${playing ? 'Pause' : 'Play'} ${title}"${usable ? '' : ' disabled'}>${playing ? icons.pause : icons.play}</button>
      </div>
      <label class="ch__vol" id="vol-${esc(track.id)}"${volumeOpen && usable ? '' : ' hidden'}>
        <span class="visually-hidden">Volume for ${title}</span>
        <span class="ch__vol-icon" aria-hidden="true">${icons.volume}</span>
        <input class="slider" type="range" min="0" max="100" step="1" value="${vol}" style="--v:${vol}%" data-action="volume"${usable ? '' : ' disabled'} />
        <span class="ch__volnum" aria-hidden="true">${vol}</span>
      </label>
    </li>`;
}
/** Update the live parts of a row in place, so focus and slider drags survive. */
function patchChannelRow(li, track) {
    const playing = track.state === 'playing';
    li.classList.toggle('is-playing', playing);
    li.classList.toggle('is-paused', track.state === 'paused');
    const state = li.querySelector('.ch__state');
    if (state) {
        const { label, tone } = stateInfo(track);
        state.textContent = label;
        state.className = `ch__state tone-${tone}`;
    }
    const toggle = li.querySelector('.ch__toggle');
    if (toggle && toggle.classList.contains('is-on') !== playing) {
        toggle.classList.toggle('is-on', playing);
        toggle.innerHTML = playing ? icons.pause : icons.play;
        toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${trackTitle(track)}`);
    }
    const vol = li.querySelector('input[data-action="volume"]');
    const volNum = li.querySelector('.ch__volnum');
    const v = Math.round(track.volume * 100);
    if (vol) {
        if (document.activeElement !== vol)
            vol.value = String(v);
        vol.style.setProperty('--v', `${v}%`);
    }
    if (volNum)
        volNum.textContent = String(v);
    const volToggle = li.querySelector('.vol-toggle');
    const volToggleNum = volToggle?.querySelector('.vol-toggle__num');
    if (volToggle && volToggleNum) {
        volToggleNum.textContent = String(v);
        volToggle.setAttribute('aria-label', `Volume for ${trackTitle(track)}: ${v} percent`);
    }
}
/** Show or hide a row's own volume slider. */
function setRowVolumeOpen(li, open) {
    const toggle = li.querySelector('.vol-toggle');
    const panel = li.querySelector('.ch__vol');
    if (!toggle || !panel)
        return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
    panel.hidden = !open;
}
/** Render the saved mixes list. */
function renderSavedPlaylists(playlists, container) {
    if (playlists.length === 0) {
        container.innerHTML = '<li class="mix mix--empty">Saved mixes appear here.</li>';
        return;
    }
    container.innerHTML = playlists
        .map((p) => {
        const name = esc(p.name);
        return `
        <li class="mix">
          <span class="mix__text">
            <span class="mix__name">${name}</span>
            <span class="mix__count">${p.urls.length} channel${p.urls.length === 1 ? '' : 's'}</span>
          </span>
          <button class="btn btn--quiet btn--small" type="button" data-mix-action="load" data-playlist-name="${name}" aria-label="Load mix ${name}">Load</button>
          <button class="icon-btn" type="button" data-mix-action="delete" data-playlist-name="${name}" aria-label="Delete mix ${name}">${icons.trash}</button>
        </li>`;
    })
        .join('');
}
/** Ask whether a loaded mix replaces or joins the current channels. */
function showReplaceAppendModal(message) {
    return new Promise((resolve) => {
        const opener = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
      <div class="modal panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalBody">
        <h2 id="modalTitle" class="modal__title">Load this mix?</h2>
        <p id="modalBody" class="modal__body">${esc(message)}</p>
        <div class="modal__actions">
          <button class="btn btn--quiet" type="button" data-choice="cancel">Cancel</button>
          <button class="btn" type="button" data-choice="append">Add to current</button>
          <button class="btn btn--primary" type="button" data-choice="replace">Replace current</button>
        </div>
      </div>`;
        document.body.appendChild(overlay);
        const finish = (choice) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            opener?.focus();
            resolve(choice);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                finish('cancel');
            }
            else if (e.key === 'Tab') {
                const buttons = Array.from(overlay.querySelectorAll('button'));
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', (e) => {
            const target = e.target;
            if (target === overlay)
                return finish('cancel');
            const choice = target.closest('[data-choice]')?.dataset.choice;
            if (choice === 'replace' || choice === 'append' || choice === 'cancel')
                finish(choice);
        });
        overlay.querySelector('[data-choice="replace"]')?.focus();
    });
}
let errorTimer = null;
/** Show a message in the status line for five seconds. */
function showError(element, message) {
    element.textContent = message;
    if (errorTimer !== null)
        clearTimeout(errorTimer);
    errorTimer = window.setTimeout(() => {
        element.textContent = '';
        errorTimer = null;
    }, 5000);
}
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        return false;
    }
}


// ===== accent.js =====
/**
 * Accent colour from artwork.
 *
 * Samples the current channel's thumbnail, finds its most prevalent vivid hue
 * and returns a version of it that reads well on the dark panels. Returns null
 * when the artwork is too dark, too grey or has no colour that stands out, so
 * the caller can fall back to amber.
 */
/** Used when there is no artwork or it has no usable colour. */
const FALLBACK_ACCENT = '#FFB24A';
/** The darkest surface accent text sits on (panel over the backdrop). */
const PANEL_RGB = [0x16, 0x1b, 0x1c];
const MIN_CONTRAST = 4.5;
const SAMPLE_W = 64;
const SAMPLE_H = 36;
const HUE_BINS = 36; // 10° each
function luminance([r, g, b]) {
    const lin = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function rgbToHue(r, g, b, max, min) {
    const d = max - min;
    if (d === 0)
        return 0;
    let h;
    if (max === r)
        h = ((g - b) / d) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
}
function toHex([r, g, b]) {
    return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
/**
 * Returns a hex accent colour, or null when the image has no usable colour
 * (too dark, too grey, too little of any one hue) or cannot be read.
 */
function extractAccent(img) {
    if (!img.complete || img.naturalWidth === 0)
        return null;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx)
        return null;
    let data;
    try {
        ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
        data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    }
    catch {
        return null; // Image not readable (no CORS): use the fallback.
    }
    const weight = new Float64Array(HUE_BINS);
    const satSum = new Float64Array(HUE_BINS);
    const hueX = new Float64Array(HUE_BINS);
    const hueY = new Float64Array(HUE_BINS);
    const total = SAMPLE_W * SAMPLE_H;
    let vivid = 0;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const chroma = max - min;
        const sat = max === 0 ? 0 : chroma / max;
        // Skip near-black, near-white and greyish pixels: they carry no accent.
        if (max < 0.2 || (min > 0.88 && sat < 0.15) || sat < 0.25 || chroma < 0.12)
            continue;
        const h = rgbToHue(r, g, b, max, min);
        const bin = Math.floor(h / (360 / HUE_BINS)) % HUE_BINS;
        // Vivid, bright pixels count more than dull ones.
        const w = chroma * (0.5 + 0.5 * max);
        weight[bin] += w;
        satSum[bin] += sat * w;
        const rad = (h * Math.PI) / 180;
        hueX[bin] += Math.cos(rad) * w;
        hueY[bin] += Math.sin(rad) * w;
        vivid++;
    }
    // Too few coloured pixels: a dark or monochrome image.
    if (vivid / total < 0.05)
        return null;
    // Most prevalent hue, smoothed over neighbouring bins.
    let best = -1;
    let bestWeight = 0;
    for (let i = 0; i < HUE_BINS; i++) {
        const w = weight[(i + HUE_BINS - 1) % HUE_BINS] * 0.5 +
            weight[i] +
            weight[(i + 1) % HUE_BINS] * 0.5;
        if (w > bestWeight) {
            bestWeight = w;
            best = i;
        }
    }
    if (best < 0 || bestWeight / total < 0.02)
        return null;
    let x = 0, y = 0, sw = 0, ss = 0;
    for (const i of [best - 1, best, best + 1]) {
        const k = (i + HUE_BINS) % HUE_BINS;
        x += hueX[k];
        y += hueY[k];
        sw += weight[k];
        ss += satSum[k];
    }
    let hue = (Math.atan2(y, x) * 180) / Math.PI;
    if (hue < 0)
        hue += 360;
    const sat = sw > 0 ? ss / sw : 0.6;
    // Normalise for a dark UI: keep the hue, give it enough saturation and
    // lightness to read as text on the panels.
    const s = Math.min(0.85, Math.max(0.5, sat));
    let l = 0.66;
    let rgb = hslToRgb(hue, s, l);
    while (contrast(rgb, PANEL_RGB) < MIN_CONTRAST && l < 0.86) {
        l += 0.02;
        rgb = hslToRgb(hue, s, l);
    }
    if (contrast(rgb, PANEL_RGB) < MIN_CONTRAST)
        return null;
    return toHex(rgb);
}


// ===== main.js =====
/**
 * Main entry point.
 *
 * The app mixes several YouTube streams at once. One channel at a time is
 * "focused": it fills the centre of the screen and the deck controls it.
 * Every channel stays playable from the channel list.
 */






// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const playlistManager = new PlaylistManager();
let playerFactory;
let pollTimer = null;
let focusedId = null;
let mixName = null;
let seeking = false;
/** Channels whose own volume slider is open in the list. */
const openVolumes = new Set();
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
const statusCode = $('statusCode');
const statusLine = $('statusLine');
const telChannels = $('telChannels');
const telLive = $('telLive');
const statPlayback = $('statPlayback');
const statDur = $('statDur');
const backdropImg = $('backdropImg');
const art = $('art');
const artImg = $('artImg');
const stageIndex = $('stageIndex');
const stageState = $('stageState');
const stageArtist = $('stageArtist');
const stageTitle = $('stageTitle');
const retaskInput = $('retaskInput');
const retaskButton = $('retaskButton');
const retaskBox = $('retask');
const removeButton = $('removeButton');
const clockEl = $('stageClock');
const clockFields = Array.from(clockEl.querySelectorAll('[data-clock]'));
const statRem = $('statRem');
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
/** Accent per artwork URL, so switching back to a channel needs no new sampling. */
const accentCache = new Map();
/** Set the page accent; null means "no usable colour" and uses the amber fallback. */
function setAccent(color) {
    document.documentElement.style.setProperty('--accent', color || FALLBACK_ACCENT);
}
function applyAccentFromArtwork() {
    const key = artImg.currentSrc || artImg.src;
    if (!key)
        return setAccent(null);
    if (!accentCache.has(key))
        accentCache.set(key, extractAccent(artImg));
    setAccent(accentCache.get(key) ?? null);
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
        .map((t, i) => channelRowHtml(t, i, t.id === focusedId, openVolumes.has(t.id)))
        .join('');
    channelCount.textContent = String(tracks.length);
    document.documentElement.dataset.empty = String(tracks.length === 0);
}
function renderRow(id) {
    const tracks = playlistManager.getTracks();
    const index = tracks.findIndex((t) => t.id === id);
    const row = rowFor(id);
    if (index < 0 || !row)
        return;
    const hadFocus = row.contains(document.activeElement);
    row.outerHTML = channelRowHtml(tracks[index], index, id === focusedId, openVolumes.has(id));
    if (hadFocus)
        rowFor(id)?.querySelector('.ch__focus')?.focus();
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
    globalPlayPauseButton.textContent = live > 0 ? 'Pause all' : 'Play all';
    globalPlayPauseButton.disabled = tracks.length === 0;
    shareButton.disabled = tracks.length === 0;
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
    retaskInput.disabled = !track;
    retaskButton.disabled = !track;
    removeButton.disabled = !track;
    if (track && document.activeElement !== retaskInput)
        retaskInput.value = track.url;
    if (!track)
        retaskBox.open = false;
    const playing = track?.state === 'playing';
    playButton.querySelector('svg').outerHTML = playing ? icons.pause : icons.play;
    playButton.querySelector('span').textContent = playing ? 'Pause' : 'Play';
    playButton.classList.toggle('is-on', !!playing);
    playButton.setAttribute('aria-label', playing ? 'Pause this channel' : 'Play this channel');
    const loopOn = !!track?.loop;
    loopSwitch.disabled = !track;
    loopSwitch.setAttribute('aria-pressed', String(loopOn));
    setPill(loopSwitch, track ? (loopOn ? 'On' : 'Off') : '—', loopOn ? 'live' : 'idle', ' pill--btn');
    renderVolume();
    renderTime();
}
/** Clock, timeline and remaining time for the focused channel. */
function renderTime() {
    const track = focusedTrack();
    const t = track ? track.currentTime : 0;
    const d = track?.duration || 0;
    const p = d > 0 ? Math.min(1, t / d) : 0;
    const parts = clockParts(t);
    clockFields.forEach((el, i) => {
        if (el.textContent !== parts[i])
            el.textContent = parts[i];
    });
    clockEl.setAttribute('aria-label', `Elapsed ${formatHMS(t)}`);
    clockEl.classList.toggle('is-live', track?.state === 'playing');
    statDur.textContent = d ? formatHMS(d) : '—';
    statRem.textContent = formatHMS(d ? Math.max(0, d - t) : 0);
    scrubTime.textContent = d ? `${formatHMS(t)} / ${formatHMS(d)}` : '— / —';
    scrubTicks.forEach((el) => {
        el.textContent = d ? formatHMS(d * Number(el.dataset.tick)) : '—';
    });
    scrub.style.setProperty('--p', p.toFixed(5));
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
    }
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
    openVolumes.delete(id);
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
        openVolumes.clear();
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
        else if (el.dataset.action === 'vol-toggle') {
            const open = !openVolumes.has(id);
            if (open)
                openVolumes.add(id);
            else
                openVolumes.delete(id);
            const row = rowFor(id);
            if (row)
                setRowVolumeOpen(row, open);
        }
    });
    channelList.addEventListener('input', (e) => {
        const input = e.target;
        const id = input.closest('[data-track-id]')?.dataset.trackId;
        if (id && input.dataset.action === 'volume')
            setVolume(id, Number(input.value) / 100);
    });
    // Now playing
    removeButton.addEventListener('click', () => focusedId && removeTrack(focusedId));
    retaskButton.addEventListener('click', () => {
        const url = retaskInput.value.trim();
        if (focusedId && url)
            reloadTrack(focusedId, url);
    });
    retaskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            retaskButton.click();
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
        if (!useFallback())
            setAccent(null);
    });
    artImg.addEventListener('load', () => {
        // A missing HD thumbnail comes back as a 120x90 grey placeholder rather than an error.
        if (artImg.naturalWidth <= 120 && useFallback())
            return;
        applyAccentFromArtwork();
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


})();