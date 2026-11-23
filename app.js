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
/** Elapsed and remaining time, shown faintly under each channel. */
function rowClock(track) {
    const t = track.currentTime;
    const d = track.duration || 0;
    if (!d)
        return formatTime(t);
    return `${formatTime(t)} <span class="ch__clock-sep">/</span> −${formatTime(Math.max(0, d - t))}`;
}
/**
 * Markup for one channel row. Its settings drawer (volume, change link,
 * remove) stays closed behind a toggle (drawerOpen), so scrolling the list
 * can't nudge a slider and the row stays compact.
 */
function channelRowHtml(track, index, focused, drawerOpen = false) {
    const title = esc(trackTitle(track));
    const author = esc(track.meta?.author || 'YouTube');
    const thumb = track.meta?.thumbnailUrl
        ? `<img class="ch__thumb" src="${esc(track.meta.thumbnailUrl)}" alt="" loading="lazy" />`
        : '<span class="ch__thumb ch__thumb--empty" aria-hidden="true"></span>';
    const playing = track.state === 'playing';
    const usable = track.state === 'playing' || track.state === 'paused';
    const { label, tone } = stateInfo(track);
    const vol = Math.round(track.volume * 100);
    const id = esc(track.id);
    return `
    <li class="ch is-${track.state}${focused ? ' is-focus' : ''}${drawerOpen ? ' is-open' : ''}" data-track-id="${id}">
      <div class="ch__main">
        <button class="ch__focus" type="button" data-action="focus" aria-current="${focused ? 'true' : 'false'}" aria-label="Show ${title} in the player">
          ${thumb}
          <span class="ch__text">
            <span class="ch__title">${title}</span>
            <span class="ch__meta">
              <span class="ch__state tone-${tone}">${label}</span>
              <span class="ch__time">${pad2(index + 1)} · ${author}</span>
            </span>
            <span class="ch__clock">${rowClock(track)}</span>
          </span>
        </button>
        <button class="vol-toggle${drawerOpen ? ' is-open' : ''}" type="button" data-action="drawer" aria-expanded="${drawerOpen}" aria-controls="drawer-${id}" aria-label="Settings for ${title}: volume ${vol} percent">
          ${icons.volume}<span class="vol-toggle__num">${vol}</span>
        </button>
        <button class="round-btn ch__toggle${playing ? ' is-on' : ''}" type="button" data-action="toggle" aria-label="${playing ? 'Pause' : 'Play'} ${title}"${usable ? '' : ' disabled'}>${playing ? icons.pause : icons.play}</button>
      </div>
      <div class="ch__drawer" id="drawer-${id}"${drawerOpen ? '' : ' hidden'}>
        <label class="ch__vol">
          <span class="visually-hidden">Volume for ${title}</span>
          <span class="ch__vol-icon" aria-hidden="true">${icons.volume}</span>
          <input class="slider" type="range" min="0" max="100" step="1" value="${vol}" style="--v:${vol}%" data-action="volume"${usable ? '' : ' disabled'} />
          <span class="ch__volnum" aria-hidden="true">${vol}</span>
        </label>
        <div class="ch__link">
          <label class="visually-hidden" for="link-${id}">YouTube link for ${title}</label>
          <input id="link-${id}" class="ch__link-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(track.url)}" data-action="link-input" />
          <button class="btn btn--small" type="button" data-action="relink">Load link</button>
        </div>
        <div class="ch__remove">
          <button class="text-btn text-btn--danger" type="button" data-action="remove-ask">${icons.trash}Remove channel</button>
          <div class="ch__confirm" role="group" aria-label="Confirm removing ${title}" hidden>
            <span class="remove__question">Remove from this mix?</span>
            <button class="btn btn--danger btn--small" type="button" data-action="remove-yes">Remove</button>
            <button class="btn btn--quiet btn--small" type="button" data-action="remove-no">Keep</button>
          </div>
        </div>
      </div>
    </li>`;
}
/** One number in the strip: jumps to that channel; marks playing and selected. */
function stripItemHtml(track, index, focused) {
    const title = esc(trackTitle(track));
    const { label } = stateInfo(track);
    const n = pad2(index + 1);
    return `
    <li class="strip__item is-${track.state}${focused ? ' is-focus' : ''}" data-track-id="${esc(track.id)}">
      <button class="strip__btn" type="button" data-action="focus" aria-current="${focused ? 'true' : 'false'}" aria-label="Channel ${n}: ${title}, ${label}" title="${n} · ${title}">${n}</button>
    </li>`;
}
/** Update a strip number in place. */
function patchStripItem(li, track, index) {
    li.classList.toggle('is-playing', track.state === 'playing');
    li.classList.toggle('is-paused', track.state === 'paused');
    const btn = li.querySelector('.strip__btn');
    if (btn)
        btn.setAttribute('aria-label', `Channel ${pad2(index + 1)}: ${trackTitle(track)}, ${stateInfo(track).label}`);
}
/** Update the live parts of a row in place, so focus and slider drags survive. */
function patchChannelRow(li, track) {
    const playing = track.state === 'playing';
    li.classList.toggle('is-playing', playing);
    li.classList.toggle('is-paused', track.state === 'paused');
    const clock = li.querySelector('.ch__clock');
    if (clock) {
        const html = rowClock(track);
        if (clock.innerHTML !== html)
            clock.innerHTML = html;
    }
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
        volToggle.setAttribute('aria-label', `Settings for ${trackTitle(track)}: volume ${v} percent`);
    }
}
/** Open or close a row's settings drawer. */
function setRowDrawerOpen(li, open) {
    const toggle = li.querySelector('.vol-toggle');
    const drawer = li.querySelector('.ch__drawer');
    if (!toggle || !drawer)
        return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
    li.classList.toggle('is-open', open);
    drawer.hidden = !open;
    if (!open)
        setRowConfirm(li, false);
}
/** Show or hide a row's "Remove from this mix?" question. */
function setRowConfirm(li, open) {
    const ask = li.querySelector('[data-action="remove-ask"]');
    const confirm = li.querySelector('.ch__confirm');
    if (!ask || !confirm)
        return;
    ask.hidden = open;
    confirm.hidden = !open;
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
// Fine enough that thin coloured lettering (logos on black) survives the downscale.
const SAMPLE_W = 96;
const SAMPLE_H = 54;
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
    // Sample the 16:9 picture: a 4:3 fallback thumbnail has black bars top and bottom.
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const sh = Math.min(nh, (nw * 9) / 16);
    const sy = (nh - sh) / 2;
    try {
        ctx.drawImage(img, 0, sy, nw, sh, 0, 0, SAMPLE_W, SAMPLE_H);
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
    let lit = 0; // pixels that aren't near-black
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const chroma = max - min;
        const sat = max === 0 ? 0 : chroma / max;
        // Skip near-black, near-white and greyish pixels: they carry no accent.
        if (max < 0.2)
            continue;
        lit++;
        if ((min > 0.88 && sat < 0.15) || sat < 0.25 || chroma < 0.12)
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
    // Judge colour against the visible (non-black) part of the picture, so a
    // bright logo on a black background still counts. Too little colour there,
    // or almost none in the whole frame: a dark or monochrome image.
    if (lit === 0 || vivid / lit < 0.1 || vivid / total < 0.015)
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
    // The winning hue must be a real share of the colour, not a stray tint.
    let allWeight = 0;
    for (let i = 0; i < HUE_BINS; i++)
        allWeight += weight[i];
    if (best < 0 || bestWeight / allWeight < 0.25 || bestWeight / total < 0.004)
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
/**
 * True when the thumbnail is square album art with flat bars at the sides
 * (how YouTube publishes "Topic" music uploads), so the player can crop it
 * to the square instead of showing the bars.
 *
 * The 16:9 picture is sampled first: a 4:3 fallback thumbnail carries extra
 * letterbox bars top and bottom, which are skipped.
 */
function isSquareArt(img) {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!img.complete || nw === 0 || nh === 0)
        return false;
    const W = 96;
    const H = 54;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx)
        return false;
    const sh = Math.min(nh, (nw * 9) / 16);
    const sy = (nh - sh) / 2;
    let data;
    try {
        ctx.drawImage(img, 0, sy, nw, sh, 0, 0, W, H);
        data = ctx.getImageData(0, 0, W, H).data;
    }
    catch {
        return false;
    }
    // Square art in a 16:9 frame leaves bars of ~22% each side.
    const stats = (x0, x1) => {
        let n = 0;
        const sum = [0, 0, 0];
        const sq = [0, 0, 0];
        for (let y = 2; y < H - 2; y++) {
            for (let x = x0; x < x1; x++) {
                const i = (y * W + x) * 4;
                for (let c = 0; c < 3; c++) {
                    sum[c] += data[i + c];
                    sq[c] += data[i + c] * data[i + c];
                }
                n++;
            }
        }
        const mean = sum.map((v) => v / n);
        const std = sq.map((v, c) => Math.sqrt(Math.max(0, v / n - mean[c] * mean[c])));
        return { mean, std: Math.max(...std) };
    };
    const left = stats(1, Math.floor(W * 0.19));
    const right = stats(Math.ceil(W * 0.81), W - 1);
    const centre = stats(Math.floor(W * 0.3), Math.ceil(W * 0.7));
    const sidesMatch = left.mean.every((v, c) => Math.abs(v - right.mean[c]) < 14);
    return left.std < 9 && right.std < 9 && sidesMatch && centre.std > Math.max(left.std, right.std) * 2 + 6;
}


// ===== screen.js =====
/**
 * Screen takeover: fullscreen and keeping the screen awake.
 *
 * Browsers only enter fullscreen from a user gesture (a tap, a click, a key),
 * and the user can always leave it; nothing here can or tries to prevent that.
 * Installed from the home screen, the manifest's "display": "fullscreen"
 * launches the app without any browser UI at all.
 */
const doc = document;
/** True where a page may go fullscreen (not iPhone Safari, for one). */
function fullscreenSupported() {
    return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}
function isFullscreen() {
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}
/** Launched from the home screen with no browser UI. */
function runningAsFullscreenApp() {
    return window.matchMedia('(display-mode: fullscreen)').matches;
}
/** Launched from the home screen at all (fullscreen or standalone). */
function runningAsApp() {
    return (runningAsFullscreenApp() ||
        window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true);
}
async function enterFullscreen() {
    const el = document.documentElement;
    try {
        if (el.requestFullscreen)
            await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen)
            await el.webkitRequestFullscreen();
        else
            return false;
        return true;
    }
    catch {
        return false;
    }
}
async function exitFullscreen() {
    try {
        if (doc.exitFullscreen)
            await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen)
            await doc.webkitExitFullscreen();
    }
    catch {
        // Already out of fullscreen.
    }
}
function onFullscreenChange(listener) {
    document.addEventListener('fullscreenchange', listener);
    document.addEventListener('webkitfullscreenchange', listener);
}
let lock = null;
let wanted = false;
/**
 * Ask the screen to stay on (or let it sleep again). The browser drops the
 * lock whenever the page is hidden, so this re-requests it when the page
 * becomes visible while it is still wanted.
 */
async function setKeepAwake(on) {
    wanted = on;
    const nav = navigator;
    if (!nav.wakeLock)
        return;
    if (on && !lock && document.visibilityState === 'visible') {
        try {
            const sentinel = await nav.wakeLock.request('screen');
            lock = sentinel;
            sentinel.addEventListener('release', () => {
                if (lock === sentinel)
                    lock = null;
            });
            if (!wanted)
                await releaseLock();
        }
        catch {
            lock = null; // Refused (battery saver, permissions): the screen may dim.
        }
    }
    else if (!on) {
        await releaseLock();
    }
}
async function releaseLock() {
    const current = lock;
    lock = null;
    if (current) {
        try {
            await current.release();
        }
        catch {
            // Already released.
        }
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted)
        void setKeepAwake(true);
});


// ===== layout.js =====
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
function goToSlide(index) {
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
function refreshLayout() {
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
function setupLayout() {
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
    // Only what's playing, each numbered by its position in the mix.
    mixStrip.innerHTML = tracks
        .map((t, i) => (t.state === 'playing' ? stripItemHtml(t, i, t.id === focusedId) : ''))
        .join('');
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
    stage.dataset.shape = square ? 'square' : 'wide';
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
        // Moving the main scroller would scroll the whole page (and collapse the
        // artwork) whenever the channel changes; only inner panels may follow.
        if (el.id === 'scroller')
            return null;
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
    const prevState = before.state;
    playlistManager.updateTrack(id, { state });
    const controller = playlistManager.getController(id);
    if (controller)
        playlistManager.updateTrack(id, { currentTime: controller.getCurrentTime() });
    const track = playlistManager.getTrack(id);
    const row = rowFor(id);
    if (row)
        patchChannelRow(row, track);
    if (prevState !== track.state)
        renderStrip();
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


})();