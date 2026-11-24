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
     * Replace every track (a remote mirroring the main device): no players.
     */
    replaceTracks(tracks) {
        this.clearTracks();
        this.state.tracks = tracks.map((t) => ({ ...t }));
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
        createPlayer(trackId, containerElement, videoId, onMeta, onState, onError, startSeconds) {
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
                        ...(startSeconds && startSeconds > 0 ? { start: Math.floor(startSeconds) } : {}),
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
        // Standard youtube.com URLs, including the mobile and YouTube Music sites
        if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(urlObj.hostname)) {
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
 * Share links: a mix's YouTube URLs encoded into the page URL's hash
 * (#pl=<base64url JSON>), read back on load or pasted into Import.
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
    return decodePayload(hash.slice(4));
}
/** The URL list inside a share link's #pl= payload, or null if it isn't one. */
function decodePayload(payload) {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    try {
        const urls = JSON.parse(atob(base64));
        if (!Array.isArray(urls))
            return null;
        return urls.filter((u) => typeof u === 'string');
    }
    catch {
        return null;
    }
}
/**
 * The mix in pasted text: a share link, or else any YouTube links in it
 * (one or several, separated by spaces, commas or new lines). Null when
 * there is nothing to import.
 */
function decodePlaylistFromText(text) {
    const share = text.match(/#pl=([A-Za-z0-9_-]+)/);
    const urls = share
        ? decodePayload(share[1]) ?? []
        : text.match(/https?:\/\/[^\s,;"'<>]+/g) ?? [];
    const valid = urls.filter(isValidYouTubeUrl);
    return valid.length > 0 ? valid : null;
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
/** One thumbnail in the large-screen strip: jumps to that channel (no play
 *  button, so the main display stays the place to play and pause). */
function thumbItemHtml(track, index, focused) {
    const title = esc(trackTitle(track));
    const { label, tone } = stateInfo(track);
    const n = pad2(index + 1);
    const thumb = track.meta?.thumbnailUrl
        ? `<img src="${esc(track.meta.thumbnailUrl)}" alt="" loading="lazy" decoding="async" />`
        : '';
    return `
    <li class="thumbs__item is-${track.state}${focused ? ' is-focus' : ''}" data-track-id="${esc(track.id)}">
      <button class="thumbs__btn" type="button" data-action="focus" aria-current="${focused ? 'true' : 'false'}" aria-label="Channel ${n}: ${title}, ${label}" title="${n} · ${title}">
        <span class="thumbs__img">${thumb}${track.meta?.thumbnailUrl ? `<canvas class="crt-canvas" data-crt-src="${esc(track.meta.thumbnailUrl)}" aria-hidden="true"></canvas>` : ''}<span class="thumbs__num">${n}</span></span>
        <span class="thumbs__state tone-${tone}">${label}</span>
      </button>
    </li>`;
}
/** Update the live parts of a row in place, so focus and slider drags survive. */
function patchChannelRow(li, track) {
    const playing = track.state === 'playing';
    for (const state of ['loading', 'playing', 'paused', 'error'])
        li.classList.toggle(`is-${state}`, track.state === state);
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
        <li class="mix" data-mix-name="${name}">
          <span class="mix__text">
            <span class="mix__name">${name}</span>
            <span class="mix__count">${p.urls.length} channel${p.urls.length === 1 ? '' : 's'}<span class="mix__tag"> · Current</span></span>
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


// ===== crt.js =====
/**
 * Screen effect: the artwork shown on a simulated CRT / LED wall.
 *
 * The picture is drawn into a canvas phosphor by phosphor, in device pixels:
 * - it is sampled into cells, one colour per cell (the "pixels" of the screen);
 * - each cell is a triad of red, green and blue phosphor stripes, brightest
 *   in the middle, with some light bleeding into the neighbouring stripes;
 * - cells stack in columns with a thin dark gap between them, and every
 *   other column is offset by half a cell (a slot mask);
 * - the result glows a little (a blurred copy screened on top), and CSS
 *   softens it slightly, like a photo of a screen.
 * Before sampling, the picture is graded towards a cold, desaturated
 * blue-grey.
 *
 * Every setting is a --crt-* custom property, read on each render. The
 * Screen effect panel (src/screenFx.ts) sets them and fires FX_CHANGE_EVENT
 * on window to re-render. Rendering happens only when the picture or
 * the frame's size changes, never per frame.
 */
/** Fire on window after changing a --crt-* property to re-render. */
const FX_CHANGE_EVENT = 'ambient:fx-change';
function crtNum(style, name, fallback) {
    const v = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
}
function crtColor(style, name, fallback) {
    const m = style.getPropertyValue(name).trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
}
function readCrtParams() {
    const s = getComputedStyle(document.documentElement);
    return {
        pitch: crtNum(s, '--crt-pitch', 6),
        cell: crtNum(s, '--crt-cell', 7),
        gap: crtNum(s, '--crt-gap', 1),
        gapDark: crtNum(s, '--crt-gap-dark', 0.35),
        stagger: crtNum(s, '--crt-stagger', 1) >= 0.5,
        bleed: crtNum(s, '--crt-bleed', 0.55),
        edge: crtNum(s, '--crt-edge', 0.85),
        boost: crtNum(s, '--crt-boost', 2.1),
        glow: crtNum(s, '--crt-glow', 0.3),
        glowRadius: crtNum(s, '--crt-glow-radius', 2),
        srcBlur: crtNum(s, '--crt-src-blur', 1.5),
        gray: crtNum(s, '--crt-gray', 0.55),
        tint: crtNum(s, '--crt-tint', 0.5),
        tintRgb: crtColor(s, '--crt-tint-color', [80, 102, 122]),
        contrast: crtNum(s, '--crt-contrast', 0.9),
        bright: crtNum(s, '--crt-bright', 1),
    };
}
/** The part of a w×h picture that object-fit: cover shows in a frame, zoomed in by `zoom`. */
function crtCover(w, h, aspect, zoom) {
    let sw = w;
    let sh = h;
    if (w / h > aspect)
        sw = h * aspect;
    else
        sh = w / aspect;
    sw /= zoom;
    sh /= zoom;
    return [(w - sw) / 2, (h - sh) / 2, sw, sh];
}
let crtSampler = null;
/**
 * Render `source` onto `canvas` as a screen of cssW×cssH CSS pixels,
 * cropped like object-fit: cover and zoomed in by `zoom`.
 *
 * `magnify`: the canvas will be shown scaled up by this much (a CSS
 * transform), so it is rendered with that many more pixels and the cells
 * still come out at their set size on screen.
 *
 * False when the picture can't be read (a cross-origin image without CORS).
 */
function paintCrt(source, sourceW, sourceH, canvas, cssW, cssH, zoom = 1, magnify = 1) {
    if (!sourceW || !sourceH || cssW < 2 || cssH < 2)
        return false;
    const p = readCrtParams();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(cssW * dpr * magnify);
    const H = Math.round(cssH * dpr * magnify);
    // Screen geometry in device pixels.
    const stripe = Math.max(1, Math.round((p.pitch * dpr) / 3));
    const triad = stripe * 3;
    const cellH = Math.max(3, Math.round(p.cell * dpr));
    const gap = Math.min(cellH - 2, Math.max(0, Math.round(p.gap * dpr)));
    const lit = cellH - gap;
    const half = p.stagger ? Math.floor(cellH / 2) : 0;
    const cols = Math.ceil(W / triad) + 1;
    const rows = Math.ceil((H + half) / cellH) + 1;
    // 1. Sample the picture: one colour per cell.
    crtSampler = crtSampler || document.createElement('canvas');
    crtSampler.width = cols;
    crtSampler.height = rows;
    const sctx = crtSampler.getContext('2d', { willReadFrequently: true });
    if (!sctx)
        return false;
    const [sx, sy, sw, sh] = crtCover(sourceW, sourceH, (cols * triad) / (rows * cellH), zoom);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.filter = 'none';
    sctx.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows);
    if (p.srcBlur > 0 && 'filter' in sctx) {
        // Defocus; drawn over the sharp copy so the blur's soft edges never show.
        sctx.filter = `blur(${p.srcBlur}px)`;
        sctx.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows);
        sctx.filter = 'none';
    }
    let pixels;
    try {
        pixels = sctx.getImageData(0, 0, cols, rows).data;
    }
    catch {
        return false;
    }
    // 2. Grade each cell: desaturate, tint towards the cold blue-grey, contrast, brightness.
    const n = cols * rows;
    const cr = new Float32Array(n);
    const cg = new Float32Array(n);
    const cb = new Float32Array(n);
    const [tr, tg, tb] = p.tintRgb;
    const tl = Math.max(1, 0.299 * tr + 0.587 * tg + 0.114 * tb);
    for (let i = 0; i < n; i++) {
        let r = pixels[i * 4] / 255;
        let g = pixels[i * 4 + 1] / 255;
        let b = pixels[i * 4 + 2] / 255;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r += (l - r) * p.gray;
        g += (l - g) * p.gray;
        b += (l - b) * p.gray;
        r += ((l * tr) / tl - r) * p.tint;
        g += ((l * tg) / tl - g) * p.tint;
        b += ((l * tb) / tl - b) * p.tint;
        cr[i] = Math.max(0, ((r - 0.5) * p.contrast + 0.5) * p.bright);
        cg[i] = Math.max(0, ((g - 0.5) * p.contrast + 0.5) * p.bright);
        cb[i] = Math.max(0, ((b - 0.5) * p.contrast + 0.5) * p.bright);
    }
    // 3. Lay out the phosphors. Per column of device pixels: which cell column,
    // which stripe (R, G or B) and how bright across the stripe.
    const colOf = new Int32Array(W);
    const subOf = new Uint8Array(W);
    const across = new Float32Array(W);
    for (let x = 0; x < W; x++) {
        const tx = Math.floor(x / triad);
        const within = x - tx * triad;
        const sub = Math.min(2, Math.floor(within / stripe));
        const t = ((within - sub * stripe + 0.5) / stripe) * 2 - 1;
        colOf[x] = Math.min(cols - 1, tx);
        subOf[x] = sub;
        across[x] = 1 - p.edge * t * t;
    }
    // Per row: which cell row and how bright along the cell, for even and odd
    // (offset) columns.
    const rowOf = [new Int32Array(H), new Int32Array(H)];
    const along = [new Float32Array(H), new Float32Array(H)];
    for (let parity = 0; parity < 2; parity++) {
        const shift = parity ? half : 0;
        for (let y = 0; y < H; y++) {
            const yy = y + shift;
            const ry = Math.floor(yy / cellH);
            const within = yy - ry * cellH;
            rowOf[parity][y] = Math.min(rows - 1, ry);
            if (within >= lit) {
                along[parity][y] = p.gapDark;
            }
            else {
                const t = ((within + 0.5) / lit) * 2 - 1;
                along[parity][y] = 1 - 0.35 * p.edge * t * t;
            }
        }
    }
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return false;
    const out = ctx.createImageData(W, H);
    const o = out.data;
    const bleed = p.bleed;
    const k = 255 * p.boost;
    let i = 0;
    for (let y = 0; y < H; y++) {
        const rowEven = rowOf[0][y] * cols;
        const rowOdd = rowOf[1][y] * cols;
        const alongEven = along[0][y];
        const alongOdd = along[1][y];
        for (let x = 0; x < W; x++) {
            const tx = colOf[x];
            const odd = tx & 1;
            const si = (odd ? rowOdd : rowEven) + tx;
            const m = across[x] * (odd ? alongOdd : alongEven) * k;
            const sub = subOf[x];
            o[i] = cr[si] * (sub === 0 ? 1 : bleed) * m;
            o[i + 1] = cg[si] * (sub === 1 ? 1 : bleed) * m;
            o[i + 2] = cb[si] * (sub === 2 ? 1 : bleed) * m;
            o[i + 3] = 255;
            i += 4;
        }
    }
    ctx.putImageData(out, 0, 0);
    // 4. Glow: a blurred copy screened over the phosphors.
    if (p.glow > 0 && 'filter' in ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.min(1, p.glow);
        ctx.filter = `blur(${p.glowRadius * dpr}px)`;
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
    }
    return true;
}
// ---------------------------------------------------------------------------
// The main artwork
// ---------------------------------------------------------------------------
/**
 * Keep `canvas` showing `img` as a screen, lined up with it exactly: the
 * canvas holds the whole picture at the size object-fit: cover gives it in
 * the frame, and styles.css gives it the picture's zoom, so the plain picture
 * underneath and the screen on top match for --crt-mix.
 *
 * Re-renders when the picture loads, the frame grows or changes width, or the
 * settings change. The frame shrinking (the collapsing artwork on vertical
 * screens) only crops, so scrolling never re-renders.
 */
function setupArtCrt(img, canvas, frame) {
    let renderedW = 0;
    let renderedH = 0;
    let lastSrc = '';
    let timer = 0;
    const paint = () => {
        timer = 0;
        // YouTube's 120×90 "no artwork" placeholder: src/main.ts swaps in the fallback.
        if (!img.complete || img.naturalWidth <= 120)
            return;
        const rect = frame.getBoundingClientRect();
        if (rect.width < 2)
            return;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        // The picture's size in the frame (object-fit: cover), and its zoom.
        const fit = Math.max(rect.width / iw, rect.height / ih);
        const transform = getComputedStyle(img).transform;
        const zoom = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).a : 1;
        const ok = paintCrt(img, iw, ih, canvas, iw * fit, ih * fit, 1, zoom);
        frame.classList.toggle('has-crt', ok);
        if (!ok)
            return;
        renderedW = rect.width;
        renderedH = rect.height;
        const src = img.currentSrc || img.src;
        if (src !== lastSrc) {
            lastSrc = src;
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const mix = parseFloat(getComputedStyle(canvas).getPropertyValue('--crt-mix')) || 1;
                canvas.animate([{ opacity: 0.25 * mix }, { opacity: mix }], { duration: 360, easing: 'ease-out' });
            }
        }
    };
    const schedule = (delay = 120) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(paint, delay);
    };
    img.addEventListener('load', () => schedule(0));
    new ResizeObserver(() => {
        const rect = frame.getBoundingClientRect();
        if (Math.abs(rect.width - renderedW) > 1 || rect.height > renderedH + 1)
            schedule();
    }).observe(frame);
    window.addEventListener(FX_CHANGE_EVENT, () => schedule(30));
    if (img.complete && img.naturalWidth)
        schedule(0);
}
// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------
/** Rendered thumbnails by URL and size, so rebuilding the strip is instant. */
const crtThumbCache = new Map();
const crtThumbImages = new Map();
function crtLoad(url) {
    let pending = crtThumbImages.get(url);
    if (!pending) {
        pending = new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = url;
        });
        crtThumbImages.set(url, pending);
    }
    return pending;
}
/** Render every `canvas[data-crt-src]` under `root` that is on screen. */
function paintCrtThumbs(root) {
    root.querySelectorAll('canvas[data-crt-src]').forEach(async (canvas) => {
        const box = canvas.parentElement;
        const url = canvas.dataset.crtSrc;
        if (!box || !url)
            return;
        const rect = box.getBoundingClientRect();
        if (rect.width < 2)
            return;
        const key = `${url}|${Math.round(rect.width)}x${Math.round(rect.height)}|${window.devicePixelRatio}`;
        let rendered = crtThumbCache.get(key);
        if (!rendered) {
            try {
                const image = await crtLoad(url);
                const fresh = document.createElement('canvas');
                if (!paintCrt(image, image.naturalWidth, image.naturalHeight, fresh, rect.width, rect.height))
                    return;
                crtThumbCache.set(key, fresh);
                rendered = fresh;
            }
            catch {
                return;
            }
        }
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.getContext('2d')?.drawImage(rendered, 0, 0);
        box.classList.add('has-crt');
    });
}
/** Forget rendered thumbnails (after the settings change). */
function clearCrtThumbs() {
    crtThumbCache.clear();
}


// ===== screenFx.js =====
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

const SCREEN_KEY = 'ambient-player:screen';
const sfxStyle = (pitch, cell, gap, gapDark, stagger, bleed, edge, boost, glow, glowRadius, srcBlur, gray, tint, tintColor, contrast, bright, soft) => ({
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
const SCREEN_STYLES = [
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
const SCREEN_CONTROLS = [
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
function loadScreenState() {
    const fallback = { style: SCREEN_STYLES[0].name, mix: 1, tuned: {} };
    try {
        const raw = JSON.parse(localStorage.getItem(SCREEN_KEY) || 'null');
        if (!raw || typeof raw !== 'object')
            return fallback;
        const style = SCREEN_STYLES.some((s) => s.name === raw.style) ? raw.style : fallback.style;
        const mix = typeof raw.mix === 'number' && raw.mix >= 0 && raw.mix <= 1 ? raw.mix : 1;
        const tuned = raw.tuned && typeof raw.tuned === 'object' ? raw.tuned : {};
        return { style, mix, tuned };
    }
    catch {
        return fallback;
    }
}
function saveScreenState(state) {
    try {
        localStorage.setItem(SCREEN_KEY, JSON.stringify(state));
    }
    catch {
        // Not saved; it still applies for this visit.
    }
}
function setupScreenControl() {
    const root = document.documentElement;
    const byId = (id) => document.getElementById(id);
    const dial = byId('screenDial');
    const ticks = byId('screenTicks');
    const styleName = byId('screenStyle');
    const step = byId('screenStep');
    const note = byId('screenNote');
    const mixInput = byId('mixInput');
    const mixReadout = byId('mixReadout');
    const mixCaption = byId('mixCaption');
    const meter = byId('mixMeter');
    const toggle = byId('screenMoreToggle');
    const more = byId('screenMore');
    const sliders = byId('screenSliders');
    const reset = byId('screenReset');
    if (!dial || !mixInput || !sliders)
        return;
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
    const inputs = new Map();
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
        }
        else {
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
    function apply(rerender) {
        const v = values();
        Object.entries(v).forEach(([name, value]) => root.style.setProperty(name, value));
        root.style.setProperty('--crt-mix', String(state.mix));
        render();
        if (rerender)
            window.dispatchEvent(new Event(FX_CHANGE_EVENT));
    }
    function render() {
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
        if (document.activeElement !== mixInput)
            mixInput.value = String(pct);
        mixInput.style.setProperty('--v', `${pct}%`);
        mixInput.setAttribute('aria-valuetext', `${pct} percent of the effect`);
        mixReadout.textContent = `${pct} %`;
        mixCaption.textContent = pct === 0 ? 'Plain picture' : pct === 100 ? 'Full screen' : 'Blended';
        const lit = Math.round(state.mix * MIX_TRIADS);
        Array.from(meter.children).forEach((triad, n) => triad.classList.toggle('is-on', n < lit));
        const v = values();
        inputs.forEach(({ input, out }, name) => {
            const value = v[name] ?? '';
            if (document.activeElement !== input)
                input.value = input.type === 'color' ? value : String(parseFloat(value));
            if (input.type === 'range') {
                const pctOf = ((parseFloat(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
                input.style.setProperty('--v', `${pctOf}%`);
            }
            out.textContent = value;
        });
        reset.disabled = !tuned;
    }
    /** Turn the dial by `dir` styles (wrapping), dropping any fine-tuning. */
    function turn(dir) {
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
        }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
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


// ===== commands.js =====
/**
 * Commands: every change to playback or the mix, as plain data.
 *
 * The interface never calls the players directly; it calls dispatch() with a
 * command. Today every command runs here, on this device. Remote control
 * (docs/remote-control-plan.md) adds a route that sends commands to the main
 * device instead, and the same data travels over the wire, so each command
 * must stay JSON-serialisable and self-contained: it carries the values to
 * apply ("pause this channel"), never a toggle that depends on the state the
 * sender happened to see.
 *
 * Purely local actions are not commands: opening a row's drawer, the remove
 * confirmation, saving mixes on this device, share links, and the layout,
 * scale and screen settings.
 */
let cmdRunLocally = null;
let cmdRoute = null;
/** The local implementation (src/main.ts registers it at start-up). */
function setCommandRunner(runner) {
    cmdRunLocally = runner;
}
/** Remote control's hook: send commands elsewhere instead of running them. */
function setCommandRoute(next) {
    cmdRoute = next;
}
/**
 * Apply a command: on this device, or wherever the route sends it.
 * True when it was applied here or handed on; false when it failed here.
 */
function dispatch(command) {
    if (cmdRoute && cmdRoute(command))
        return true;
    return cmdRunLocally ? cmdRunLocally(command) : false;
}


// ===== pairing.js =====
/**
 * Pairing: this device's identity, the room it's paired into, and the
 * relay's HTTP calls (docs/remote-control-plan.md).
 *
 * - The relay's address comes from <meta name="ambient-relay"> in
 *   index.html (empty until the relay is deployed). For development,
 *   ?relay=http://127.0.0.1:8787 points this browser at a local relay; only
 *   localhost addresses are accepted that way, so a link can't redirect a
 *   device to someone else's relay.
 * - The room (ID and secret) is kept in localStorage. The secret is sent
 *   only to the relay, never in a link: pairing links carry a short-lived,
 *   single-use code instead.
 */
const ROOM_KEY = 'ambient-player:room';
const DEVICE_KEY = 'ambient-player:device';
const RELAY_KEY = 'ambient-player:relay';
const LOCAL_RELAY = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
function pairingToken(bytes) {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function readJson(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    }
    catch {
        return null;
    }
}
function writeJson(key, value) {
    try {
        if (value === null)
            localStorage.removeItem(key);
        else
            localStorage.setItem(key, JSON.stringify(value));
    }
    catch {
        // Not kept; works for this visit.
    }
}
// ---------------------------------------------------------------------------
// Relay address
// ---------------------------------------------------------------------------
/** Take ?relay=<localhost address> from the URL (development), then drop it. */
function takeRelayOverride() {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('relay');
    if (value === null)
        return;
    try {
        if (value === '' || value === 'off')
            localStorage.removeItem(RELAY_KEY);
        else if (LOCAL_RELAY.test(value.replace(/\/$/, '')))
            localStorage.setItem(RELAY_KEY, value.replace(/\/$/, ''));
    }
    catch {
        // Ignore.
    }
    params.delete('relay');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
}
/** The relay's base URL, or '' when remote control isn't set up. */
function relayUrl() {
    let override = '';
    try {
        override = localStorage.getItem(RELAY_KEY) || '';
    }
    catch {
        // Ignore.
    }
    if (override && LOCAL_RELAY.test(override))
        return override;
    const meta = document.querySelector('meta[name="ambient-relay"]')?.content.trim() || '';
    return /^https:\/\//.test(meta) ? meta.replace(/\/$/, '') : '';
}
// ---------------------------------------------------------------------------
// This device and its room
// ---------------------------------------------------------------------------
/** A readable default name, e.g. "Brave on Android". */
function defaultDeviceName() {
    const ua = navigator.userAgent;
    const brave = navigator.brave !== undefined;
    const browser = brave
        ? 'Brave'
        : /Edg\//.test(ua)
            ? 'Edge'
            : /Firefox\//.test(ua)
                ? 'Firefox'
                : /Chrome\//.test(ua)
                    ? 'Chrome'
                    : /Safari\//.test(ua)
                        ? 'Safari'
                        : 'Browser';
    const system = /Android/.test(ua)
        ? 'Android'
        : /iPhone/.test(ua)
            ? 'iPhone'
            : /iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1
                ? 'iPad'
                : /Mac OS X|Macintosh/.test(ua)
                    ? 'Mac'
                    : /Windows/.test(ua)
                        ? 'Windows'
                        : /Linux/.test(ua)
                            ? 'Linux'
                            : 'this device';
    return `${browser} on ${system}`;
}
function thisDevice() {
    const stored = readJson(DEVICE_KEY);
    if (stored && typeof stored.id === 'string' && typeof stored.name === 'string')
        return stored;
    const device = { id: pairingToken(12), name: defaultDeviceName() };
    writeJson(DEVICE_KEY, device);
    return device;
}
function renameThisDevice(name) {
    const device = { ...thisDevice(), name: name.trim().slice(0, 40) || defaultDeviceName() };
    writeJson(DEVICE_KEY, device);
    return device;
}
function storedRoom() {
    const room = readJson(ROOM_KEY);
    return room && typeof room.roomId === 'string' && typeof room.secret === 'string' ? room : null;
}
function saveRoom(room) {
    writeJson(ROOM_KEY, room);
}
// ---------------------------------------------------------------------------
// Relay calls
// ---------------------------------------------------------------------------
async function relayPost(path, body) {
    const base = relayUrl();
    if (!base)
        throw new Error('Remote control is not set up on this copy of the player.');
    let response;
    try {
        response = await fetch(base + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }
    catch {
        throw new Error("Couldn't reach the relay. Check the connection and try again.");
    }
    const data = (await response.json().catch(() => ({})));
    if (!response.ok) {
        const reason = data.error;
        throw new Error(reason === 'code'
            ? "That code doesn't work. Codes last 10 minutes and work once."
            : reason === 'slow'
                ? 'Too many tries. Wait a minute and try again.'
                : reason === 'unpaired'
                    ? 'This device is no longer paired.'
                    : 'The relay had a problem. Try again.');
    }
    return data;
}
function createRoom() {
    return relayPost('/rooms');
}
function requestPairingCode(room) {
    return relayPost(`/rooms/${encodeURIComponent(room.roomId)}/codes`, { secret: room.secret });
}
function redeemPairingCode(code) {
    return relayPost(`/pair/${encodeURIComponent(code)}`);
}
/** Forget all devices: the room gets a new secret; only this device keeps it. */
async function rotateRoom(room) {
    const { secret } = await relayPost(`/rooms/${encodeURIComponent(room.roomId)}/rotate`, {
        secret: room.secret,
    });
    return { roomId: room.roomId, secret };
}
// ---------------------------------------------------------------------------
// Pairing links
// ---------------------------------------------------------------------------
/** The link a QR code carries: opening it pairs the device. */
function pairingLink(code) {
    return `${window.location.origin}${window.location.pathname}#pair=${code}`;
}
/** A pairing code from a link or typed text ("ABC 123", "abc123"), or null. */
function pairCodeFromText(text) {
    const fromLink = text.match(/#pair=([A-Za-z0-9]{6})\b/);
    if (fromLink)
        return fromLink[1].toUpperCase();
    const typed = text.replace(/[\s-]/g, '');
    return /^[A-Za-z0-9]{6}$/.test(typed) ? typed.toUpperCase() : null;
}
/** A pairing code in the page URL (#pair=…), removed from the URL once read. */
function takePairCodeFromLocation() {
    const match = window.location.hash.match(/^#pair=([A-Za-z0-9]{6})$/);
    if (!match)
        return null;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return match[1].toUpperCase();
}


// ===== remote.js =====
/**
 * The connection to the paired room (docs/remote-control-plan.md).
 *
 * While this device is paired, it keeps one WebSocket open to its room on
 * the relay: it says `hello` with the room secret, gets the device list in
 * `welcome`, and hears `devices` whenever someone joins, leaves, renames or
 * goes offline. It reconnects on its own (1, 2, 5, 10, then every 30
 * seconds, and right away when the page becomes visible or the network comes
 * back) and sends a heartbeat every 20 seconds, which the relay answers
 * without waking the room.
 *
 * Roles: one device in the room is the main device (it plays the audio).
 * While the main device is online, every other device is a remote: it
 * mirrors the main device's `state` and sends it commands. When no main
 * device is online, every device is idle and plays on its own; the first to
 * play claims main.
 */

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_MS = 20000;
const COMMAND_TIMEOUT_MS = 5000;
let rcSocket = null;
let rcStatus = { state: 'off', devices: [], unpaired: false, mainId: null, role: 'idle', mainName: '' };
/** Room clock minus this device's clock, from `welcome`. */
let rcClockOffset = 0;
/** The main device's latest snapshot and when the room received it (room clock). */
let rcLastState = null;
let rcCommandSeq = 0;
const rcPending = new Map();
const rcStateListeners = new Set();
let rcCommandHandler = null;
let rcReleaseHandler = null;
/** When this remote lost its connection (it stays a remote for a grace period). */
let rcOfflineSince = 0;
let rcGraceTimer = 0;
/** How long a disconnected remote waits before standing on its own. */
const REMOTE_GRACE_MS = 30000;
let rcAttempt = 0;
let rcRetryTimer = 0;
let rcHeartbeat = 0;
let rcWanted = false;
const rcListeners = new Set();
function rcEmit(patch) {
    const next = { ...rcStatus, ...patch };
    // The role follows from who is main and whether it is online.
    const me = thisDevice().id;
    const main = next.devices.find((d) => d.id === next.mainId);
    next.mainName = main?.name ?? '';
    if (next.mainId && next.mainId === me)
        next.role = 'main';
    else if (next.state === 'online')
        next.role = main?.online ? 'remote' : 'idle';
    // A remote stays one through a dropped connection for a grace period while
    // it reconnects; after that (relay unreachable) it stands on its own.
    else if (next.state === 'off' || rcStatus.role !== 'remote')
        next.role = 'idle';
    else {
        if (!rcOfflineSince) {
            rcOfflineSince = Date.now();
            window.clearTimeout(rcGraceTimer);
            rcGraceTimer = window.setTimeout(() => rcEmit({}), REMOTE_GRACE_MS + 100);
        }
        next.role = Date.now() - rcOfflineSince < REMOTE_GRACE_MS ? 'remote' : 'idle';
    }
    if (next.state === 'online') {
        rcOfflineSince = 0;
        window.clearTimeout(rcGraceTimer);
    }
    rcStatus = next;
    rcListeners.forEach((listener) => listener(rcStatus));
}
function rcStateAge(receivedAt) {
    return Math.max(0, Date.now() + rcClockOffset - receivedAt);
}
function rcFailPending(error) {
    rcPending.forEach(({ resolve, timer }) => {
        window.clearTimeout(timer);
        resolve({ ok: false, error });
    });
    rcPending.clear();
}
function onConnection(listener) {
    rcListeners.add(listener);
    listener(rcStatus);
}
function connectionStatus() {
    return rcStatus;
}
function rcSend(message) {
    if (rcSocket?.readyState !== WebSocket.OPEN)
        return false;
    rcSocket.send(JSON.stringify(message));
    return true;
}
function rcClear() {
    window.clearTimeout(rcRetryTimer);
    window.clearInterval(rcHeartbeat);
    rcRetryTimer = 0;
    rcHeartbeat = 0;
}
function rcScheduleRetry() {
    if (!rcWanted || rcRetryTimer)
        return;
    const delay = RECONNECT_DELAYS[Math.min(rcAttempt, RECONNECT_DELAYS.length - 1)];
    rcAttempt++;
    rcRetryTimer = window.setTimeout(() => {
        rcRetryTimer = 0;
        rcOpen();
    }, delay);
}
function rcOpen() {
    const room = storedRoom();
    const base = relayUrl();
    if (!rcWanted || !room || !base)
        return;
    if (rcSocket && (rcSocket.readyState === WebSocket.OPEN || rcSocket.readyState === WebSocket.CONNECTING))
        return;
    rcEmit({ state: rcStatus.state === 'online' ? 'offline' : 'connecting', unpaired: false });
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${encodeURIComponent(room.roomId)}/ws`);
    rcSocket = socket;
    socket.addEventListener('open', () => {
        const device = thisDevice();
        socket.send(JSON.stringify({ type: 'hello', protocol: 1, deviceId: device.id, name: device.name, secret: room.secret }));
        window.clearInterval(rcHeartbeat);
        rcHeartbeat = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN)
                socket.send('ping');
        }, HEARTBEAT_MS);
    });
    socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || event.data === 'pong')
            return;
        let msg;
        try {
            msg = JSON.parse(event.data);
        }
        catch {
            return;
        }
        switch (msg.type) {
            case 'welcome':
                rcAttempt = 0;
                rcClockOffset = (msg.serverTime ?? Date.now()) - Date.now();
                rcLastState = msg.state ? { state: msg.state, receivedAt: msg.receivedAt ?? 0 } : null;
                rcEmit({ state: 'online', devices: msg.devices ?? [], mainId: msg.mainId ?? null });
                if (rcLastState)
                    rcStateListeners.forEach((l) => l(rcLastState.state, rcStateAge(rcLastState.receivedAt)));
                break;
            case 'devices':
                if (msg.mainId !== rcStatus.mainId)
                    rcLastState = null;
                rcEmit({ devices: msg.devices ?? [], mainId: msg.mainId ?? null });
                break;
            case 'state':
                rcLastState = { state: msg.state, receivedAt: msg.receivedAt ?? Date.now() + rcClockOffset };
                rcStateListeners.forEach((l) => l(rcLastState.state, rcStateAge(rcLastState.receivedAt)));
                break;
            case 'command': {
                const id = msg.id;
                const from = msg.from;
                if (!id || !from || !msg.command || !rcCommandHandler)
                    break;
                rcCommandHandler(msg.command, (ok, error) => rcSend({ type: 'ack', id, to: from, ok, error }));
                break;
            }
            case 'release':
                rcReleaseHandler?.();
                break;
            case 'ack': {
                const pending = msg.id ? rcPending.get(msg.id) : undefined;
                if (!pending || !msg.id)
                    break;
                window.clearTimeout(pending.timer);
                rcPending.delete(msg.id);
                pending.resolve({ ok: msg.ok === true, error: msg.error });
                break;
            }
        }
    });
    socket.addEventListener('close', (event) => {
        if (rcSocket !== socket)
            return;
        rcSocket = null;
        window.clearInterval(rcHeartbeat);
        rcFailPending('offline');
        if (event.code === 4001) {
            // The room no longer knows this device: it was unpaired elsewhere.
            saveRoom(null);
            rcWanted = false;
            rcEmit({ state: 'off', devices: [], unpaired: true, mainId: null });
            return;
        }
        if (event.code === 4000 || !rcWanted) {
            // Replaced by a newer connection from this device, or closed on purpose.
            if (!rcWanted)
                rcEmit({ state: 'off', devices: [] });
            return;
        }
        rcEmit({ state: 'offline' });
        rcScheduleRetry();
    });
}
/** Connect to the stored room (if any) and stay connected. */
function connectRoom() {
    if (!storedRoom() || !relayUrl())
        return;
    rcWanted = true;
    rcAttempt = 0;
    rcClear();
    rcOpen();
}
/** Close the connection (after unpairing). */
function disconnectRoom() {
    rcWanted = false;
    rcClear();
    const socket = rcSocket;
    rcSocket = null;
    socket?.close(1000, 'bye');
    rcLastState = null;
    rcFailPending('offline');
    rcEmit({ state: 'off', devices: [], unpaired: false, mainId: null });
}
/** Reconnect from scratch (after the room's secret changed). */
function reconnectRoom() {
    disconnectRoom();
    connectRoom();
}
function sendRename(name) {
    rcSend({ type: 'rename', name });
}
/** Tell the room this device is leaving it (unpair). */
function sendLeave() {
    rcSend({ type: 'leave' });
}
// ---------------------------------------------------------------------------
// Roles, state and commands
// ---------------------------------------------------------------------------
/**
 * Ask to become the main device: granted when no main device is online.
 * With `force` ("Play here"), the current main device hands over to this one.
 */
function claimMain(force = false) {
    return rcSend({ type: 'claim_main', force });
}
/** Main device: share the current state; `final` ends a handover. */
function sendState(state, final = false) {
    if (rcStatus.role === 'main')
        rcSend({ type: 'state', state, final });
}
/** Main device: another device asked to play here; stop and hand over. */
function onRelease(handler) {
    rcReleaseHandler = handler;
}
/** Remote: ask the relay to check who is still there (the main device may be asleep). */
function sendProbe() {
    rcSend({ type: 'probe' });
}
/** Remote: send a command to the main device; resolves with its answer. */
function sendCommand(command) {
    const id = `c${Date.now().toString(36)}${(rcCommandSeq++).toString(36)}`;
    if (!rcSend({ type: 'command', id, command }))
        return Promise.resolve({ ok: false, error: 'offline' });
    return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
            rcPending.delete(id);
            resolve({ ok: false, error: 'timeout' });
        }, COMMAND_TIMEOUT_MS);
        rcPending.set(id, { resolve, timer });
    });
}
/** Commands in flight (for a pending indicator). */
function pendingCommands() {
    return rcPending.size;
}
/** Main device: run commands from remotes. */
function onRemoteCommand(handler) {
    rcCommandHandler = handler;
}
/** Remote: hear the main device's snapshots, with how old each is (ms). */
function onRoomState(listener) {
    rcStateListeners.add(listener);
}
/** The latest snapshot and its current age, if any. */
function lastRoomState() {
    return rcLastState ? { state: rcLastState.state, ageMs: rcStateAge(rcLastState.receivedAt) } : null;
}
/** Retry straight away when the page comes back or the network returns. */
function setupReconnectTriggers() {
    const retryNow = () => {
        if (!rcWanted || rcSocket)
            return;
        rcAttempt = 0;
        rcClear();
        rcOpen();
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible')
            retryNow();
    });
    window.addEventListener('online', retryNow);
}


// ===== qr.js =====
/**
 * A small QR code encoder: byte mode, error correction level M, versions 1–10
 * (up to 213 bytes), drawn as SVG. Enough for pairing links.
 *
 * Follows the QR code specification (ISO/IEC 18004); the structure mirrors
 * Project Nayuki's reference implementation (MIT): data and error correction
 * codewords, function patterns, zig-zag placement, one fixed mask.
 */
/** Error correction codewords per block and number of blocks, level M, by version (index 0 unused). */
const QR_ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const QR_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format information for level M is 0b00. */
const QR_LEVEL_BITS = 0;
const QR_MASK = 0;
function qrRawModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const align = Math.floor(ver / 7) + 2;
        result -= (25 * align - 10) * align - 55;
        if (ver >= 7)
            result -= 36;
    }
    return result;
}
function qrDataCodewords(ver) {
    return Math.floor(qrRawModules(ver) / 8) - QR_ECC_PER_BLOCK[ver] * QR_BLOCKS[ver];
}
function qrMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}
function qrDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = qrMultiply(result[j], root);
            if (j + 1 < result.length)
                result[j] ^= result[j + 1];
        }
        root = qrMultiply(root, 0x02);
    }
    return result;
}
function qrRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        divisor.forEach((coef, i) => (result[i] ^= qrMultiply(coef, factor)));
    }
    return result;
}
/** The modules of a QR code for `text` (true is dark), or null if it is too long. */
function qrEncode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    // Smallest version that fits: mode (4 bits) + count (8 or 16 bits) + data.
    let ver = 1;
    for (; ver <= 10; ver++) {
        const countBits = ver <= 9 ? 8 : 16;
        if (4 + countBits + bytes.length * 8 <= qrDataCodewords(ver) * 8)
            break;
    }
    if (ver > 10)
        return null;
    const capacity = qrDataCodewords(ver) * 8;
    // Data bits, terminator, padding.
    const bits = [];
    const push = (value, length) => {
        for (let i = length - 1; i >= 0; i--)
            bits.push((value >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11)
        push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8)
        data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    // Error correction, split into blocks and interleaved.
    const numBlocks = QR_BLOCKS[ver];
    const eccLen = QR_ECC_PER_BLOCK[ver];
    const rawCodewords = Math.floor(qrRawModules(ver) / 8);
    const numShort = numBlocks - (rawCodewords % numBlocks);
    const shortLen = Math.floor(rawCodewords / numBlocks);
    const divisor = qrDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
        k += dat.length;
        const ecc = qrRemainder(dat, divisor);
        if (i < numShort)
            dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => {
            if (i !== shortLen - eccLen || j >= numShort)
                codewords.push(block[i]);
        });
    }
    // The grid.
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
        modules[y][x] = dark;
        isFunction[y][x] = true;
    };
    // Timing patterns.
    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    // Finder patterns.
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size)
                    set(x, y, dist !== 2 && dist !== 4);
            }
        }
    }
    // Alignment patterns.
    const align = [];
    if (ver > 1) {
        const count = Math.floor(ver / 7) + 2;
        const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
        align.push(6);
        for (let pos = size - 7; align.length < count; pos -= step)
            align.splice(1, 0, pos);
    }
    align.forEach((ay, i) => align.forEach((ax, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
        if (corner)
            return;
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++)
                set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }));
    // Format information (level and mask), twice, plus the dark module.
    const formatData = (QR_LEVEL_BITS << 3) | QR_MASK;
    let rem = formatData;
    for (let i = 0; i < 10; i++)
        rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((formatData << 10) | rem) ^ 0x5412;
    const bit = (value, i) => ((value >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++)
        set(8, i, bit(format, i));
    set(8, 7, bit(format, 6));
    set(8, 8, bit(format, 7));
    set(7, 8, bit(format, 8));
    for (let i = 9; i < 15; i++)
        set(14 - i, 8, bit(format, i));
    for (let i = 0; i < 8; i++)
        set(size - 1 - i, 8, bit(format, i));
    for (let i = 8; i < 15; i++)
        set(8, size - 15 + i, bit(format, i));
    set(8, size - 8, true);
    // Version information (version 7 and up).
    if (ver >= 7) {
        let vrem = ver;
        for (let i = 0; i < 12; i++)
            vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
        const versionBits = (ver << 12) | vrem;
        for (let i = 0; i < 18; i++) {
            const dark = bit(versionBits, i);
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            set(a, b, dark);
            set(b, a, dark);
        }
    }
    // Data, in the zig-zag order, then the mask.
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6)
            right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!isFunction[y][x] && index < codewords.length * 8) {
                    modules[y][x] = bit(codewords[index >>> 3], 7 - (index & 7));
                    index++;
                }
            }
        }
    }
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!isFunction[y][x] && (x + y) % 2 === 0)
                modules[y][x] = !modules[y][x];
        }
    }
    return modules;
}
/** An SVG QR code for `text`: dark modules in `currentColor`, with the quiet zone. */
function qrSvg(text, label) {
    const modules = qrEncode(text);
    if (!modules)
        return '';
    const size = modules.length;
    const quiet = 4;
    let path = '';
    modules.forEach((row, y) => row.forEach((dark, x) => {
        if (dark)
            path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }));
    const full = size + quiet * 2;
    return `<svg viewBox="0 0 ${full} ${full}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#08090A"/></svg>`;
}


// ===== devices.js =====
/**
 * The Devices section (last panel): pairing devices for remote control
 * (docs/remote-control-plan.md, phase 2).
 *
 * - Connect a device: creates the room if this device has none, then shows
 *   a single-use pairing code and a QR code of its link for 10 minutes.
 * - Join: a code typed here, a #pair= link opened in the browser, or a
 *   pairing link pasted into Import pairs this device into that room.
 * - Paired: the device list (online or last seen), renaming this device,
 *   unpairing it, and forgetting all devices (a new room secret).
 */



const dvById = (id) => document.getElementById(id);
let dvExpiryTimer = 0;
let dvKnownIds = new Set();
function dvMessage(text, ok = false) {
    const el = dvById('devicesMessage');
    el.textContent = text;
    el.classList.toggle('is-ok', ok);
}
function dvEsc(value) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function dvSeen(device) {
    if (device.online)
        return 'Online';
    const minutes = Math.round((Date.now() - device.lastSeen) / 60000);
    if (minutes < 1)
        return 'Seen just now';
    if (minutes < 60)
        return `Seen ${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return `Seen ${hours} h ago`;
    return `Seen ${Math.round(hours / 24)} d ago`;
}
function dvHidePairBox() {
    window.clearInterval(dvExpiryTimer);
    dvExpiryTimer = 0;
    dvById('pairBox').hidden = true;
}
function dvRender(status) {
    const paired = !!storedRoom();
    const configured = !!relayUrl();
    const me = thisDevice();
    const pill = dvById('devicesState');
    const intro = dvById('devicesIntro');
    const list = dvById('deviceList');
    const manage = dvById('devicesManage');
    const connect = dvById('connectDevice');
    const join = dvById('joinButton');
    const joinInput = dvById('joinCode');
    // While disconnected, nobody is known to be online.
    const live = status.state === 'online';
    const devices = status.devices.map((d) => ({ ...d, online: live && d.online }));
    const others = devices.filter((d) => d.id !== me.id);
    const onlineOthers = others.filter((d) => d.online).length;
    let label = 'Not paired';
    let tone = 'idle';
    if (paired) {
        if (status.state === 'online') {
            label = onlineOthers ? `${onlineOthers + 1} online` : 'Paired';
            tone = onlineOthers ? 'live' : 'idle';
        }
        else if (status.state === 'connecting') {
            label = 'Connecting';
            tone = 'busy';
        }
        else {
            label = 'Offline';
            tone = 'warn';
        }
    }
    pill.textContent = label;
    pill.className = `pill tone-${tone}`;
    intro.textContent = !configured
        ? "Remote control isn't set up on this copy of the player yet."
        : paired
            ? others.length
                ? 'Paired devices. Open Ambient Player on any of them to use it as a remote.'
                : 'Paired. Connect another device to use it as a remote.'
            : 'Pair another device, such as your phone, to control this player from it like a remote.';
    list.hidden = !paired || devices.length === 0;
    list.innerHTML = devices
        .slice()
        .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : Number(b.online) - Number(a.online)))
        .map((d) => `
      <li class="device${d.online ? ' is-online' : ''}">
        <span class="device__dot" aria-hidden="true"></span>
        <span>
          <span class="device__name">${dvEsc(d.name)}</span>
          <span class="device__seen">${dvSeen(d)}</span>
        </span>
        <span>
          ${d.id === status.mainId ? '<span class="device__tag device__tag--main">Plays</span>' : ''}
          ${d.id === me.id ? '<span class="device__tag">This device</span>' : ''}
        </span>
      </li>`)
        .join('');
    manage.hidden = !paired;
    connect.textContent = paired ? 'Connect another device' : 'Connect a device';
    connect.disabled = !configured;
    join.disabled = !configured;
    joinInput.disabled = !configured;
    const nameInput = dvById('deviceName');
    if (document.activeElement !== nameInput)
        nameInput.value = me.name;
    // A device that just joined while the code was showing: done.
    const ids = new Set(status.devices.map((d) => d.id));
    const newcomer = status.devices.find((d) => !dvKnownIds.has(d.id) && d.id !== me.id && d.online);
    if (newcomer && dvKnownIds.size > 0 && !dvById('pairBox').hidden) {
        dvHidePairBox();
        dvMessage(`${newcomer.name} is paired.`, true);
    }
    if (status.state === 'online')
        dvKnownIds = ids;
    if (status.unpaired)
        dvMessage('This device was unpaired from another device.');
}
/** Show a fresh pairing code and its QR code, counting down to expiry. */
async function dvShowCode() {
    let room = storedRoom();
    if (!room) {
        room = await createRoom();
        saveRoom(room);
        connectRoom();
    }
    const { code, expiresAt } = await requestPairingCode(room);
    const box = dvById('pairBox');
    dvById('pairQr').innerHTML = qrSvg(pairingLink(code), `QR code for pairing code ${code}`);
    dvById('pairCode').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
    const expiry = dvById('pairExpiry');
    const tick = () => {
        const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
        if (left === 0) {
            dvHidePairBox();
            dvMessage('The pairing code expired. Connect again for a new one.');
            return;
        }
        expiry.textContent = `Works once · expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    };
    window.clearInterval(dvExpiryTimer);
    dvExpiryTimer = window.setInterval(tick, 1000);
    tick();
    box.hidden = false;
}
/**
 * Pair this device using a code (typed, from a #pair= link, or pasted into
 * Import). Resolves to an error message, or null when paired.
 */
async function joinWithCode(code) {
    if (!relayUrl())
        return "Remote control isn't set up on this copy of the player yet.";
    const current = storedRoom();
    try {
        const room = await redeemPairingCode(code);
        if (current && current.roomId === room.roomId) {
            dvMessage('This device is already paired with them.', true);
            return null;
        }
        if (current)
            sendLeave();
        disconnectRoom();
        saveRoom(room);
        connectRoom();
        dvMessage('Paired. Your other devices are listed above.', true);
        return null;
    }
    catch (error) {
        const message = error.message;
        dvMessage(message);
        return message;
    }
}
function setupDevicesPanel() {
    const connect = dvById('connectDevice');
    const joinInput = dvById('joinCode');
    const join = dvById('joinButton');
    onConnection(dvRender);
    connect.addEventListener('click', async () => {
        dvMessage('');
        connect.disabled = true;
        try {
            await dvShowCode();
        }
        catch (error) {
            dvMessage(error.message);
        }
        finally {
            connect.disabled = !relayUrl();
        }
    });
    dvById('pairCancel').addEventListener('click', dvHidePairBox);
    const submitJoin = async () => {
        const code = pairCodeFromText(joinInput.value);
        if (!code) {
            dvMessage('Enter the 6-character code shown on the other device.');
            joinInput.focus();
            return;
        }
        join.disabled = true;
        const error = await joinWithCode(code);
        join.disabled = false;
        if (!error)
            joinInput.value = '';
    };
    join.addEventListener('click', () => void submitJoin());
    joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            void submitJoin();
    });
    const nameInput = dvById('deviceName');
    const rename = () => {
        const device = renameThisDevice(nameInput.value);
        nameInput.value = device.name;
        sendRename(device.name);
        dvMessage('Renamed.', true);
    };
    dvById('renameDevice').addEventListener('click', rename);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            rename();
    });
    dvById('unpairDevice').addEventListener('click', () => {
        if (!confirm('Unpair this device? It stops being a remote, and pairing again needs a new code.'))
            return;
        sendLeave();
        window.setTimeout(() => {
            disconnectRoom();
            saveRoom(null);
            dvHidePairBox();
            dvKnownIds = new Set();
            dvRender(connectionStatus());
            dvMessage('This device is unpaired.', true);
        }, 150);
    });
    dvById('forgetDevices').addEventListener('click', async () => {
        const room = storedRoom();
        if (!room)
            return;
        if (!confirm('Forget all devices? Every other device is unpaired and needs a new code to pair again. This cannot be undone.'))
            return;
        try {
            saveRoom(await rotateRoom(room));
            dvHidePairBox();
            reconnectRoom();
            dvMessage('All other devices are unpaired.', true);
        }
        catch (error) {
            dvMessage(error.message);
        }
    });
    // Last seen times move on even when nothing else changes.
    window.setInterval(() => {
        if (storedRoom())
            dvRender(connectionStatus());
    }, 60000);
}


// ===== layoutPref.js =====
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
const LAYOUT_KEY = 'ambient-player:layout';
/** Fired on window when the choice changes. */
const LAYOUT_CHOICE_EVENT = 'ambient:layout-choice';
/** This screen's size, the same in either orientation. */
function screenKey() {
    const a = window.screen.width;
    const b = window.screen.height;
    return `${Math.min(a, b)}x${Math.max(a, b)}`;
}
/** Loaded once; kept here too, so a choice holds even where storage fails. */
let choiceCache = null;
function readChoices() {
    if (choiceCache)
        return choiceCache;
    try {
        const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
        choiceCache = value && typeof value === 'object' ? value : {};
    }
    catch {
        choiceCache = {};
    }
    return choiceCache;
}
function layoutChoice() {
    return readChoices()[screenKey()] === 'stacked' ? 'stacked' : 'auto';
}
function setLayoutChoice(choice) {
    const choices = readChoices();
    if (choice === 'auto')
        delete choices[screenKey()];
    else
        choices[screenKey()] = choice;
    try {
        if (Object.keys(choices).length)
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(choices));
        else
            localStorage.removeItem(LAYOUT_KEY);
    }
    catch {
        // Not saved; it still applies for this visit.
    }
    window.dispatchEvent(new Event(LAYOUT_CHOICE_EVENT));
}


// ===== layout.js =====
/**
 * Layout behaviour that CSS can't do alone.
 *
 * Vertical screens (portrait): the stage (artwork, numbered strip, title) is
 * pinned to the top of the scroller and shrinks as you scroll, from its full
 * size down to a minimum height; after that the panels (deck, channels,
 * mixes + status, devices + screen effect) scroll up under it and snap one at a time, like the
 * horizontal layout's pages.
 *
 * Horizontal screens (landscape): the stage stays still on the left and the
 * panels swipe vertically on the right, one screen each.
 *
 * Both move between panels with a vertical swipe (a sideways swipe too
 * easily caught the timeline or volume sliders). The pager bars show which
 * panel is in view and jump on tap.
 *
 * Which layout applies is decided here, from the screen and the Layout
 * setting (src/layoutPref.ts), and marked on <html> for styles.css:
 *   data-layout="stacked" | "columns"   vertical or side-by-side layout
 *   data-layout-forced="true"           Stacked chosen on a horizontal screen
 *   data-merged="true"                  deck and channels share a panel
 *   data-resizable="true"               the artwork column can be resized
 * The inline script in index.html sets the same markers before the first
 * paint; keep its queries in sync with these.
 */


const portraitQuery = window.matchMedia('(orientation: portrait)');
/** Large horizontal screens (a Fold's inner display at 4:3 and up) have room
 *  for the deck and the channel list on one panel. */
const mergeQuery = window.matchMedia('(orientation: landscape) and (min-width: 960px) and (min-height: 680px)');
/** Large horizontal screens with a mouse or trackpad: the artwork column can be resized. */
const resizeQuery = window.matchMedia('(orientation: landscape) and (min-width: 1280px) and (min-height: 680px) and (hover: hover) and (pointer: fine)');
const byId = (id) => document.getElementById(id);
const lScroller = byId('scroller');
const lStageWrap = byId('stageWrap');
const lStage = byId('stage');
const lArt = byId('art');
const lSlides = byId('slides');
const lPager = byId('pager');
const lSlideEls = Array.from(lSlides.querySelectorAll('.slide'));
const lBars = Array.from(lPager.querySelectorAll('.pager__bar'));
const lDeckSlide = byId('slideDeck');
const lChannelsSlide = byId('slideChannels');
const lChannelsPanel = lChannelsSlide.querySelector('.panel.channels');
/** Index into lSlideEls of the panel in view. */
let activeSlide = 0;
let artMaxH = 0;
let artMinH = 0;
let collapseFrame = 0;
const lRoot = document.documentElement;
/** The vertical layout: on upright screens, or wherever Stacked is chosen. */
function isStacked() {
    return lRoot.dataset.layout === 'stacked';
}
/** Mark the layout on <html>. True when it changed. */
function decideLayout() {
    const before = lRoot.dataset.layout;
    const stacked = portraitQuery.matches || layoutChoice() === 'stacked';
    lRoot.dataset.layout = stacked ? 'stacked' : 'columns';
    lRoot.dataset.layoutForced = String(stacked && !portraitQuery.matches);
    lRoot.dataset.resizable = String(!stacked && resizeQuery.matches);
    return before !== lRoot.dataset.layout;
}
// ---------------------------------------------------------------------------
// Merged panel on large horizontal screens
// ---------------------------------------------------------------------------
/** Put the channel list on the deck's panel (large screens) or its own (others). */
function applyMerge() {
    const merged = !isStacked() && mergeQuery.matches;
    lRoot.dataset.merged = String(merged);
    const home = merged ? lDeckSlide : lChannelsSlide;
    if (lChannelsPanel.parentElement !== home)
        home.appendChild(lChannelsPanel);
    // The channels bar leads to the merged panel, like the deck's.
    lBars.forEach((bar) => {
        bar.hidden = merged && bar.dataset.slide === '1';
    });
    if (merged && activeSlide === 1)
        activeSlide = 0;
}
/** The panels that currently take a page each (the merged one is hidden). */
function visibleSlides() {
    return lSlideEls.filter((slide) => getComputedStyle(slide).display !== 'none');
}
// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------
function setActive(index) {
    if (index === activeSlide)
        return;
    activeSlide = index;
    lBars.forEach((bar) => bar.setAttribute('aria-current', String(Number(bar.dataset.slide) === index)));
}
/** The panel in view, as an index into lSlideEls. */
function currentIndex() {
    const pages = visibleSlides();
    if (!pages.length)
        return 0;
    if (isStacked()) {
        // Scrolled to the very end: the last panel, even if it's too short to
        // reach the top.
        const atEnd = lScroller.scrollTop > 0 && lScroller.scrollTop + lScroller.clientHeight >= lScroller.scrollHeight - 4;
        if (atEnd)
            return lSlideEls.indexOf(pages[pages.length - 1]);
        // Otherwise the last panel whose top has passed a line a third of the
        // way down the space under the stage.
        const stageBottom = lStageWrap.getBoundingClientRect().bottom;
        const line = stageBottom + (lScroller.getBoundingClientRect().bottom - stageBottom) / 3;
        let found = pages[0];
        for (const page of pages)
            if (page.getBoundingClientRect().top <= line)
                found = page;
        return lSlideEls.indexOf(found);
    }
    const size = lSlides.clientHeight || 1;
    const page = Math.max(0, Math.min(pages.length - 1, Math.round(lSlides.scrollTop / size)));
    return lSlideEls.indexOf(pages[page]);
}
/** Portrait: the scroller position that puts a panel just under the collapsed stage. */
function portraitTop(index) {
    const pages = visibleSlides();
    const slide = lSlideEls[index];
    if (!slide || pages.indexOf(slide) <= 0)
        return 0;
    const top = slide.getBoundingClientRect().top - lScroller.getBoundingClientRect().top + lScroller.scrollTop;
    const pinned = lStageWrap.offsetHeight - range;
    return Math.max(0, Math.round(top - pinned));
}
/** Show a panel: 0 deck, 1 channels, 2 saved mixes and status, 3 devices and screen effect. */
function goToSlide(index) {
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (isStacked()) {
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
function refreshLayout() {
    // Resting at the top (artwork at full size) stays there: re-measuring moves
    // the snap stops, and the browser would otherwise re-snap to the collapsed one.
    const atTop = isStacked() && lScroller.scrollTop < 1;
    lArt.style.height = '';
    lStage.style.transform = '';
    lStageWrap.style.height = '';
    lStageWrap.style.top = '';
    ['--deck-snap', '--pinned-h', '--page-h'].forEach((name) => lScroller.style.removeProperty(name));
    if (!isStacked()) {
        artMaxH = artMinH = range = 0;
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
    const stageH = artMaxH + meta + gap + padY;
    // Stacked by choice on a short horizontal screen: if the collapsed stage
    // would leave the panels under half the space, it also scrolls the title
    // away, leaving only a slim band of artwork.
    if (lRoot.dataset.layoutForced === 'true' && lScroller.clientHeight - (stageH - range) < lScroller.clientHeight * 0.5) {
        range += meta + gap;
    }
    lStageWrap.style.height = `${stageH}px`;
    lStageWrap.style.top = `${-range}px`;
    // Snapping (styles.css): each panel fills the space under the collapsed
    // stage; the deck also stops with the artwork at full size (scrollTop 0).
    const slidesGap = parseFloat(getComputedStyle(lSlides).marginTop) || 0;
    lScroller.style.setProperty('--deck-snap', `${range + slidesGap}px`);
    lScroller.style.setProperty('--pinned-h', `${stageH - range}px`);
    lScroller.style.setProperty('--page-h', `${lScroller.clientHeight - (stageH - range)}px`);
    if (atTop) {
        lScroller.scrollTop = 0;
        requestAnimationFrame(() => {
            if (isStacked() && lScroller.scrollTop !== 0)
                lScroller.scrollTop = 0;
        });
    }
    applyCollapse();
}
function applyCollapse() {
    collapseFrame = 0;
    if (!isStacked() || !artMaxH)
        return;
    const c = Math.max(0, Math.min(range, lScroller.scrollTop));
    lArt.style.height = `${Math.max(artMinH, artMaxH - c)}px`;
    lStage.style.transform = c ? `translate3d(0, ${c}px, 0)` : '';
    lStageWrap.classList.toggle('is-collapsed', c >= range - 1);
}
/**
 * Until the user first touches, scrolls or presses a key, a vertical page
 * rests at the top with the artwork at full size. Content arriving on load
 * (fonts, the channel's title) moves the snap stops, and the browser would
 * otherwise re-snap to the collapsed one.
 */
let userMoved = false;
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach((type) => window.addEventListener(type, () => (userMoved = true), { capture: true, passive: true, once: true }));
function onScrollerScroll() {
    if (collapseFrame)
        return;
    collapseFrame = requestAnimationFrame(() => {
        if (!userMoved && isStacked() && lScroller.scrollTop !== 0)
            lScroller.scrollTop = 0;
        applyCollapse();
        if (isStacked())
            setActive(currentIndex());
    });
}
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function setupLayout() {
    decideLayout();
    applyMerge();
    lBars.forEach((bar) => bar.addEventListener('click', () => goToSlide(Number(bar.dataset.slide))));
    let slideFrame = 0;
    lSlides.addEventListener('scroll', () => {
        if (slideFrame)
            return;
        slideFrame = requestAnimationFrame(() => {
            slideFrame = 0;
            if (!isStacked())
                setActive(currentIndex());
        });
    }, { passive: true });
    lScroller.addEventListener('scroll', onScrollerScroll, { passive: true });
    // A plain resize keeps the page where it is on vertical screens (moving it
    // would scroll on its own); horizontal panels re-align to their page, and
    // a change of layout (rotation, the Layout setting) brings the same panel
    // back into view.
    const relayout = () => {
        const changed = decideLayout();
        applyMerge();
        refreshLayout();
        if (changed || !isStacked())
            goToSlideInstant(activeSlide);
        // Right after a switch to the vertical layout the browser re-snaps to
        // the nearest stop once the new layout settles; put the panel back then.
        if (changed && isStacked())
            requestAnimationFrame(() => goToSlideInstant(activeSlide));
    };
    window.addEventListener('resize', relayout);
    window.addEventListener(LAYOUT_CHOICE_EVENT, relayout);
    // The space under the brand can change without a window resize (the
    // brand's status line wrapping, fonts loading), and the stage's text with
    // the channel; the snap sizes follow.
    let measured = '';
    const remeasure = new ResizeObserver(() => {
        const key = `${lScroller.clientWidth}x${lScroller.clientHeight}:${lStage.querySelector('.now__meta')?.offsetHeight}`;
        if (key !== measured) {
            measured = key;
            refreshLayout();
        }
    });
    remeasure.observe(lScroller);
    const metaEl = lStage.querySelector('.now__meta');
    if (metaEl)
        remeasure.observe(metaEl);
    portraitQuery.addEventListener('change', relayout);
    mergeQuery.addEventListener('change', relayout);
    resizeQuery.addEventListener('change', relayout);
    refreshLayout();
}
/** After a resize or rotation, keep the same panel in view without animating. */
function goToSlideInstant(index) {
    if (isStacked()) {
        lScroller.scrollTop = portraitTop(index);
        return;
    }
    const page = Math.max(0, visibleSlides().indexOf(lSlideEls[index]));
    lSlides.scrollTop = page * lSlides.clientHeight;
}


// ===== scale.js =====
/**
 * UI scale: a user setting that makes the whole interface smaller or larger.
 *
 * On touch devices (phones, a Fold) it changes the page's viewport scale, so
 * the layout sees more (or fewer) CSS pixels: at 90% the app lays out as if
 * the screen were about 11% bigger, which can move it into the large-screen
 * layout. On desktop the browser ignores the viewport meta tag, so the page
 * is zoomed instead (the browser's own Ctrl/Cmd +/- does the same thing).
 *
 * The saved value is also applied by a small inline script in index.html
 * before the first paint, so the page never flashes at the wrong size.
 */
const SCALE_KEY = 'ambient-player:ui-scale';
const SCALE_MIN = 0.7;
const SCALE_MAX = 1.3;
const SCALE_STEP = 0.05;
const roundScale = (s) => Number((Math.round(s / SCALE_STEP) * SCALE_STEP).toFixed(2));
/** Viewport scaling works where the browser honours the viewport meta tag. */
function usesViewportScale() {
    return window.matchMedia('(pointer: coarse)').matches;
}
function storedScale() {
    try {
        const v = Number(localStorage.getItem(SCALE_KEY));
        if (v >= SCALE_MIN && v <= SCALE_MAX)
            return roundScale(v);
    }
    catch {
        // Storage unavailable: use the default.
    }
    return 1;
}
/** Desktop: zoom the app shell (styles.css resizes it to still fill the window). */
function setAppZoom(s) {
    const root = document.documentElement;
    root.classList.toggle('is-zoomed', s !== 1);
    if (s === 1)
        root.style.removeProperty('--ui-zoom');
    else
        root.style.setProperty('--ui-zoom', String(s));
}
/** The desktop zoom in effect (1 on touch devices, which scale the viewport). */
function appZoom() {
    return parseFloat(document.documentElement.style.getPropertyValue('--ui-zoom')) || 1;
}
function applyScale(scale) {
    const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, roundScale(scale)));
    const meta = document.querySelector('meta[name="viewport"]');
    if (usesViewportScale() && meta) {
        // Minimum and maximum pinned to the scale: some browsers otherwise keep
        // their current zoom when the tag changes, cutting the wider layout off.
        meta.content =
            s === 1
                ? 'width=device-width, initial-scale=1.0, viewport-fit=cover'
                : `width=device-width, initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, viewport-fit=cover`;
        setAppZoom(1);
    }
    else {
        setAppZoom(s);
    }
    try {
        if (s === 1)
            localStorage.removeItem(SCALE_KEY);
        else
            localStorage.setItem(SCALE_KEY, String(s));
    }
    catch {
        // Not saved; it still applies for this visit.
    }
    return s;
}


// ===== resize.js =====
/**
 * Resizable artwork column on large horizontal screens with a mouse or
 * trackpad (an ultrawide monitor, a desktop, a laptop). Touch screens, the
 * Fold and phones never get the divider; src/layout.ts decides where it
 * applies (data-resizable on <html>).
 *
 * The width is kept as a share of the app's width in --stage-pref, which
 * styles.css clamps: at least 300px, at most what the artwork can use at
 * the screen's height, and never so wide that the panels drop under 560px.
 * It is saved per device and applied before the first paint by the inline
 * script in index.html.
 */


const RESIZE_KEY = 'ambient-player:stage-width';
/** src/layout.ts decides where the divider applies and marks it on <html>. */
function resizable() {
    return document.documentElement.dataset.resizable === 'true';
}
/** One arrow-key step, as a share of the width. */
const RESIZE_STEP = 0.02;
const rzRoot = document.documentElement;
const rzApp = document.querySelector('.app');
const rzStage = document.getElementById('stageWrap');
const rzHandle = document.getElementById('stageSplitter');
/** The app's content box (inside its padding), in viewport pixels. */
function contentBox() {
    const rect = rzApp.getBoundingClientRect();
    const style = getComputedStyle(rzApp);
    // The desktop UI scale zooms the app: its padding is reported unzoomed.
    const z = appZoom();
    const left = rect.left + parseFloat(style.paddingLeft) * z;
    const width = rect.width - (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) * z;
    return { left, width: Math.max(1, width) };
}
/** The artwork column's share of the width as laid out (after clamping). */
function effectiveRatio() {
    return rzStage.getBoundingClientRect().width / contentBox().width;
}
function setPreferred(ratio) {
    const r = Math.min(0.95, Math.max(0.05, ratio));
    rzRoot.style.setProperty('--stage-pref', `calc(${r.toFixed(4)} * 100%)`);
}
/** Save the width as laid out, so the stored value is one the layout can show. */
function commit() {
    const r = effectiveRatio();
    setPreferred(r);
    try {
        localStorage.setItem(RESIZE_KEY, r.toFixed(4));
    }
    catch {
        // Not saved; it still applies for this visit.
    }
    updateAria();
}
function reset() {
    rzRoot.style.removeProperty('--stage-pref');
    try {
        localStorage.removeItem(RESIZE_KEY);
    }
    catch {
        // Nothing stored.
    }
    updateAria();
}
function updateAria() {
    if (!resizable())
        return;
    const pct = Math.round(effectiveRatio() * 100);
    rzHandle.setAttribute('aria-valuenow', String(pct));
    rzHandle.setAttribute('aria-valuetext', `Artwork column ${pct}% of the width`);
}
function setupStageResize() {
    let dragFrame = 0;
    let lastX = 0;
    const follow = () => {
        dragFrame = 0;
        const box = contentBox();
        const half = rzHandle.getBoundingClientRect().width / 2;
        setPreferred((lastX - box.left - half) / box.width);
    };
    rzHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !resizable())
            return;
        e.preventDefault();
        rzHandle.setPointerCapture(e.pointerId);
        rzRoot.classList.add('is-resizing');
        lastX = e.clientX;
    });
    rzHandle.addEventListener('pointermove', (e) => {
        if (!rzHandle.hasPointerCapture(e.pointerId))
            return;
        lastX = e.clientX;
        if (!dragFrame)
            dragFrame = requestAnimationFrame(follow);
    });
    const endDrag = (e) => {
        if (!rzHandle.hasPointerCapture(e.pointerId))
            return;
        rzHandle.releasePointerCapture(e.pointerId);
        if (dragFrame) {
            cancelAnimationFrame(dragFrame);
            follow();
        }
        rzRoot.classList.remove('is-resizing');
        commit();
    };
    rzHandle.addEventListener('pointerup', endDrag);
    rzHandle.addEventListener('pointercancel', endDrag);
    rzHandle.addEventListener('dblclick', reset);
    rzHandle.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowLeft')
            next = effectiveRatio() - RESIZE_STEP;
        else if (e.key === 'ArrowRight')
            next = effectiveRatio() + RESIZE_STEP;
        else if (e.key === 'Home')
            next = 0;
        else if (e.key === 'End')
            next = 1;
        if (next === null)
            return;
        e.preventDefault();
        setPreferred(next);
        commit();
    });
    // The clamps follow the window, so the reported width does too.
    let ariaFrame = 0;
    window.addEventListener('resize', () => {
        if (!ariaFrame)
            ariaFrame = requestAnimationFrame(() => ((ariaFrame = 0), updateAria()));
    });
    window.addEventListener(LAYOUT_CHOICE_EVENT, updateAria);
    updateAria();
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
const mixesMessage = $('mixesMessage');
const importInput = $('importInput');
const importButton = $('importButton');
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
const statDur = $('statDur');
const backdropImg = $('backdropImg');
const stage = $('stage');
const art = $('art');
const artImg = $('artImg');
const artPlay = $('artPlay');
const mixStrip = $('mixStrip');
const thumbStrip = $('thumbStrip');
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
/** The numbered strip beside the artwork and, on large horizontal screens,
 *  the thumbnail strip under the title (CSS shows one of them). */
const strips = [mixStrip, thumbStrip];
/** Scroll a strip (never the page) just enough to show a tile. */
function keepTileVisible(strip, tile) {
    if (strip.scrollHeight <= strip.clientHeight + 1)
        return;
    const view = strip.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (r.top < view.top)
        strip.scrollBy({ top: r.top - view.top - 6, behavior });
    else if (r.bottom > view.bottom)
        strip.scrollBy({ top: r.bottom - view.bottom + 6, behavior });
}
/** Both strips: only what's playing, each numbered by its position in the mix. */
function renderStrip() {
    const tracks = playlistManager.getTracks();
    const active = document.activeElement;
    const hadFocus = strips.find((strip) => strip.contains(active));
    const focusId = hadFocus && active?.closest('[data-track-id]')?.dataset.trackId;
    mixStrip.innerHTML = tracks
        .map((t, i) => (t.state === 'playing' ? stripItemHtml(t, i, t.id === focusedId) : ''))
        .join('');
    thumbStrip.innerHTML = tracks
        .map((t, i) => (t.state === 'playing' ? thumbItemHtml(t, i, t.id === focusedId) : ''))
        .join('');
    paintCrtThumbs(thumbStrip);
    if (hadFocus && focusId) {
        hadFocus.querySelector(`[data-track-id="${CSS.escape(focusId)}"] button`)?.focus();
    }
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
    renderStrip();
}
/**
 * The panel that scrolls the channel rows (a horizontal screen's page).
 * Null on vertical screens, where only the whole scroller moves.
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
    renderStrip();
}
/** The saved mixes list, with the mix that's open marked as current. */
function renderMixList() {
    renderSavedPlaylists(getAllPlaylists(), savedPlaylistsList);
    markActiveMix();
}
/** Mark the saved mix that's open now (by name), if it's in the list. */
function markActiveMix() {
    savedPlaylistsList.querySelectorAll('.mix[data-mix-name]').forEach((li) => {
        const active = !!mixName && li.dataset.mixName === mixName;
        li.classList.toggle('is-active', active);
        if (active)
            li.setAttribute('aria-current', 'true');
        else
            li.removeAttribute('aria-current');
    });
}
function renderStatus() {
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
    shareButton.disabled = tracks.length === 0;
    scheduleBroadcast();
}
// ---------------------------------------------------------------------------
// Screen takeover
// ---------------------------------------------------------------------------
/** Keep the screen on while something plays in fullscreen or in the installed app. */
function updateKeepAwake() {
    // A remote plays nothing, so it has no reason to keep the screen on.
    void setKeepAwake(mcRole !== 'remote' && liveCount() > 0 && (isFullscreen() || runningAsApp()));
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
// ---------------------------------------------------------------------------
// UI scale (Status panel)
// ---------------------------------------------------------------------------
let uiScale = storedScale();
/** Show the scale, and the layout size it produces, so the right step is easy to find. */
function updateScaleReadout() {
    const valueEl = document.getElementById('scaleValue');
    const readout = document.getElementById('layoutReadout');
    const down = document.getElementById('scaleDown');
    const up = document.getElementById('scaleUp');
    if (valueEl)
        valueEl.textContent = `${Math.round(uiScale * 100)}%`;
    if (down)
        down.disabled = uiScale <= SCALE_MIN + 0.001;
    if (up)
        up.disabled = uiScale >= SCALE_MAX - 0.001;
    if (readout) {
        const zoom = appZoom();
        const w = Math.round(window.innerWidth / zoom);
        const h = Math.round(window.innerHeight / zoom);
        const root = document.documentElement;
        const mode = root.dataset.merged === 'true'
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
function setupLayoutControl() {
    const buttons = Array.from(document.querySelectorAll('[data-layout-choice]'));
    const show = () => {
        const choice = layoutChoice();
        buttons.forEach((b) => {
            const on = b.dataset.layoutChoice === choice;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        updateScaleReadout();
    };
    const choose = (choice) => {
        if (choice !== layoutChoice())
            setLayoutChoice(choice);
        show();
    };
    buttons.forEach((b) => {
        b.addEventListener('click', () => choose(b.dataset.layoutChoice));
        // A radio group: the arrow keys move the choice.
        b.addEventListener('keydown', (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
                return;
            e.preventDefault();
            const next = buttons[(buttons.indexOf(b) + 1) % buttons.length];
            choose(next.dataset.layoutChoice);
            next.focus();
        });
    });
    show();
}
function setupScaleControl() {
    const step = (dir) => {
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
    strips.forEach((strip) => strip.querySelectorAll('[data-track-id]').forEach((tile) => {
        const on = tile.dataset.trackId === id;
        tile.classList.toggle('is-focus', on);
        tile.querySelector('button')?.setAttribute('aria-current', String(on));
        if (on)
            keepTileVisible(strip, tile);
    }));
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
        // Taking over a mix from another device: it was created at that time
        // (the player's start), paused; seeking would start playback.
        if (keep?.time)
            playlistManager.updateTrack(id, { currentTime: Math.floor(keep.time) });
        if (mcAutoplay.delete(id))
            playTrack(id);
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
    }, keep?.time);
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
    if (id === focusedId)
        renderStage(true);
    return true;
}
function playTrack(id) {
    const track = playlistManager.getTrack(id);
    const controller = playlistManager.getController(id);
    if (!track || !controller || track.state !== 'paused')
        return false;
    controller.play();
    startPolling();
    return true;
}
function pauseTrack(id) {
    const track = playlistManager.getTrack(id);
    const controller = playlistManager.getController(id);
    if (!track || !controller || track.state !== 'playing')
        return false;
    controller.pause();
    return true;
}
function playAll() {
    playlistManager.getTracks().forEach((t) => t.state === 'paused' && playlistManager.getController(t.id)?.play());
    startPolling();
    return true;
}
function pauseAll() {
    playlistManager.getTracks().forEach((t) => t.state === 'playing' && playlistManager.getController(t.id)?.pause());
    return true;
}
/** Jump within a channel. */
function seekTrack(id, time) {
    const controller = playlistManager.getController(id);
    if (!controller)
        return false;
    controller.seekTo(time);
    playlistManager.updateTrack(id, { currentTime: time });
    const row = rowFor(id);
    const track = playlistManager.getTrack(id);
    if (row && track)
        patchChannelRow(row, track);
    if (id === focusedId)
        renderTime();
    return true;
}
/** The deck's Stop: pause and go back to the start. */
function stopTrack(id) {
    const controller = playlistManager.getController(id);
    if (!controller)
        return false;
    controller.pause();
    return seekTrack(id, 0);
}
function setLoop(id, on) {
    if (!playlistManager.getTrack(id))
        return false;
    playlistManager.updateTrack(id, { loop: on });
    if (id === focusedId)
        renderStage(false);
    return true;
}
/** Add a channel from a link; renders the result. */
function addChannel(url) {
    const wasEmpty = playlistManager.getTracks().length === 0;
    if (!addTrackFromUrl(url))
        return false;
    renderAll(wasEmpty);
    return true;
}
/** Replace the mix with these links (taking `name`) or add them to it. */
function loadMix(urls, name, mode) {
    if (mode === 'replace')
        mixName = name;
    loadTracksFromUrls(urls, mode);
    return true;
}
/** Every command, applied on this device. Registered with src/commands.ts. */
function runCommand(command) {
    switch (command.type) {
        case 'play':
            return playTrack(command.trackId);
        case 'pause':
            return pauseTrack(command.trackId);
        case 'play_all':
            return playAll();
        case 'pause_all':
            return pauseAll();
        case 'focus':
            if (!playlistManager.getTrack(command.trackId))
                return false;
            setFocus(command.trackId);
            return true;
        case 'step':
            stepFocus(command.dir);
            return true;
        case 'seek':
            return seekTrack(command.trackId, command.time);
        case 'stop':
            return stopTrack(command.trackId);
        case 'volume':
            if (!playlistManager.getTrack(command.trackId))
                return false;
            setVolume(command.trackId, Math.min(1, Math.max(0, command.volume)));
            return true;
        case 'loop':
            return setLoop(command.trackId, command.on);
        case 'add':
            return addChannel(command.url);
        case 'remove':
            if (!playlistManager.getTrack(command.trackId))
                return false;
            removeTrack(command.trackId);
            return true;
        case 'relink':
            return reloadTrack(command.trackId, command.url);
        case 'load_mix':
            return loadMix(command.urls, command.name, command.mode);
    }
}
/** Play or pause a channel, from what this device shows (UI helper). */
function togglePlay(id) {
    const track = playlistManager.getTrack(id);
    if (track?.state === 'playing')
        dispatch({ type: 'pause', trackId: id });
    else if (track?.state === 'paused')
        dispatch({ type: 'play', trackId: id });
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
/** Load a mix, asking to replace or add when channels are open. False if cancelled. */
async function handleLoadPlaylist(urls, name) {
    const open = playlistManager.getTracks().length;
    if (open === 0)
        return dispatch({ type: 'load_mix', urls, name, mode: 'replace' });
    const choice = await showReplaceAppendModal(`This mix has ${urls.length} channel${urls.length === 1 ? '' : 's'}. Replace the ${open} you have open, or add them to the current mix?`);
    if (choice === 'cancel')
        return false;
    return dispatch({ type: 'load_mix', urls, name, mode: choice });
}
/** Briefly swap a button's label; a second flash restarts it, never sticks. */
const flashTimers = new WeakMap();
function flash(button, text) {
    const running = flashTimers.get(button);
    if (running !== undefined)
        clearTimeout(running);
    else
        button.dataset.label = button.textContent ?? '';
    button.textContent = text;
    flashTimers.set(button, window.setTimeout(() => {
        button.textContent = button.dataset.label ?? '';
        flashTimers.delete(button);
    }, 1800));
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
        if (dispatch({ type: 'add', url })) {
            urlInput.value = '';
            inputError.textContent = '';
        }
    };
    addButton.addEventListener('click', submitUrl);
    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            submitUrl();
    });
    globalPlayPauseButton.addEventListener('click', () => {
        dispatch({ type: playlistManager.hasPlayingTracks() ? 'pause_all' : 'play_all' });
    });
    loopSwitch.addEventListener('click', () => {
        const track = focusedTrack();
        if (track)
            dispatch({ type: 'loop', trackId: track.id, on: !track.loop });
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
            showError(mixesMessage, 'Name the mix before saving it.');
            playlistNameInput.focus();
            return;
        }
        const urls = playlistManager.getTrackUrls();
        if (urls.length === 0)
            return showError(mixesMessage, 'Add a channel before saving a mix.');
        mixesMessage.textContent = '';
        saveOrUpdatePlaylist(name, urls);
        mixName = name;
        playlistNameInput.value = '';
        renderMixList();
        renderStatus();
        flash(savePlaylistButton, 'Saved');
    });
    playlistNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            savePlaylistButton.click();
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
            if (error)
                showError(mixesMessage, error);
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
        if (!(await handleLoadPlaylist(urls, null)))
            return;
        importInput.value = '';
        flash(importButton, urls.length === 1 ? 'Imported 1' : `Imported ${urls.length}`);
    };
    importButton.addEventListener('click', () => void importMix());
    importInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            void importMix();
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
            renderMixList();
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
            dispatch({ type: 'focus', trackId: id });
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
        }
        else if (el.dataset.action === 'relink') {
            const input = rowFor(id)?.querySelector('.ch__link-input');
            const url = input?.value.trim();
            if (url)
                dispatch({ type: 'relink', trackId: id, url });
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
            dispatch({ type: 'remove', trackId: id });
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
    channelList.addEventListener('input', (e) => {
        const input = e.target;
        const id = input.closest('[data-track-id]')?.dataset.trackId;
        if (id && input.dataset.action === 'volume')
            dispatch({ type: 'volume', trackId: id, volume: Number(input.value) / 100 });
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
    strips.forEach((strip) => strip.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        const id = el?.closest('[data-track-id]')?.dataset.trackId;
        if (el?.dataset.action === 'focus' && id)
            dispatch({ type: 'focus', trackId: id });
    }));
    // Deck
    playButton.addEventListener('click', () => focusedId && togglePlay(focusedId));
    prevButton.addEventListener('click', () => dispatch({ type: 'step', dir: -1 }));
    nextButton.addEventListener('click', () => dispatch({ type: 'step', dir: 1 }));
    resetButton.addEventListener('click', () => {
        if (focusedId)
            dispatch({ type: 'stop', trackId: focusedId });
    });
    const endSeek = () => (seeking = false);
    seekInput.addEventListener('pointerdown', () => (seeking = true));
    seekInput.addEventListener('pointerup', endSeek);
    seekInput.addEventListener('pointercancel', endSeek);
    seekInput.addEventListener('change', endSeek);
    seekInput.addEventListener('input', () => {
        const track = focusedTrack();
        if (!track || !track.duration)
            return;
        dispatch({ type: 'seek', trackId: track.id, time: (Number(seekInput.value) / 1000) * track.duration });
    });
    volumeInput.addEventListener('input', () => {
        if (focusedId)
            dispatch({ type: 'volume', trackId: focusedId, volume: Number(volumeInput.value) / 100 });
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
            dispatch({ type: 'step', dir: -1 });
        }
        else if (e.key === ']') {
            dispatch({ type: 'step', dir: 1 });
        }
    });
}
// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
/** The screen effect on the artwork and the thumbnail strip (src/crt.ts). */
function setupScreenEffect() {
    // The settings first, so the first render already uses the chosen style.
    setupScreenControl();
    setupArtCrt(artImg, $('artCrt'), art);
    // Thumbnails render when they come into view (the strip shows only on
    // large screens) and again after the settings change.
    let frame = 0;
    const repaint = () => {
        if (!frame)
            frame = requestAnimationFrame(() => ((frame = 0), paintCrtThumbs(thumbStrip)));
    };
    window.addEventListener('resize', repaint);
    window.addEventListener(LAYOUT_CHOICE_EVENT, repaint);
    window.addEventListener(FX_CHANGE_EVENT, () => {
        clearCrtThumbs();
        repaint();
    });
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
let mcRole = 'idle';
let mcStatus = null;
let mcBroadcastTimer = 0;
let mcSeq = 0;
let mcLastClaim = 0;
let mcTicker = 0;
/** Remote: each mirrored channel's time and when it was true (performance.now()). */
const mcBases = new Map();
/** Remote: slider commands waiting to be sent (at most ~10 per second each). */
const mcThrottle = new Map();
let mcNoticeTimer = 0;
/** "Play here" asked for: when this device becomes main, play what was playing. */
let mcWantPlayHere = false;
let mcWantTimer = 0;
/** Handing over to another device: stop sharing state (the final one has gone). */
let mcReleasing = false;
/** Channels that were playing on a main device that went offline (offered by Play here). */
const mcResumeIds = new Set();
/** Channels to start as soon as their player is ready (after taking over). */
const mcAutoplay = new Set();
/** Every command run on this device goes through here (registered with src/commands.ts). */
function runLocalCommand(command) {
    const ok = !!runCommand(command);
    if (ok && (command.type === 'play' || command.type === 'play_all')) {
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
function maybeClaimMain() {
    if (mcRole !== 'idle' || mcStatus?.state !== 'online')
        return;
    if (Date.now() - mcLastClaim < 3000)
        return;
    mcLastClaim = Date.now();
    claimMain();
}
function buildRoomState() {
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
            };
        }),
    };
}
/** Main device: share the state soon (changes close together go as one). */
function scheduleBroadcast() {
    if (mcRole !== 'main' || mcReleasing || mcBroadcastTimer)
        return;
    mcBroadcastTimer = window.setTimeout(broadcastNow, 150);
}
function broadcastNow() {
    window.clearTimeout(mcBroadcastTimer);
    mcBroadcastTimer = 0;
    if (mcRole === 'main' && !mcReleasing)
        sendState(buildRoomState());
}
/**
 * Main device: another device asked to play here. Send the final state
 * (with what is playing, and where), then stop; the relay makes the other
 * device main, and this one becomes its remote.
 */
function releaseMain() {
    if (mcRole !== 'main')
        return;
    window.clearTimeout(mcBroadcastTimer);
    mcBroadcastTimer = 0;
    sendState(buildRoomState(), true);
    mcReleasing = true;
    for (const t of playlistManager.getTracks()) {
        if (t.state === 'playing')
            playlistManager.getController(t.id)?.pause();
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
function playHere() {
    if (mcRole === 'remote') {
        if (!claimMain(true))
            return showRemoteNotice('Not connected. Try again in a moment.');
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
function resumeHere(ids) {
    for (const id of ids) {
        const track = playlistManager.getTrack(id);
        if (track?.state === 'paused')
            dispatch({ type: 'play', trackId: id });
        else if (track?.state === 'loading')
            mcAutoplay.add(id);
    }
}
/** Remote: show the main device's snapshot. */
function applyRoomState(raw, ageMs) {
    if (mcRole !== 'remote' || !raw || typeof raw !== 'object')
        return;
    const state = raw;
    if (!Array.isArray(state.tracks))
        return;
    const before = playlistManager.getTracks();
    // Rows are patched in place only when nothing structural changed (loading
    // and error rows are drawn differently, so a change there redraws).
    const settled = (st) => st === 'playing' || st === 'paused';
    const sameShape = before.length === state.tracks.length &&
        before.every((t, i) => t.id === state.tracks[i].id &&
            t.url === state.tracks[i].url &&
            t.meta?.title === state.tracks[i].meta?.title &&
            settled(t.state) === settled(state.tracks[i].state));
    const focusChanged = focusedId !== state.focusedId;
    const now = performance.now();
    mcBases.clear();
    const tracks = state.tracks.map((t) => {
        mcBases.set(t.id, { t: t.currentTime, at: now - ageMs });
        const elapsed = t.state === 'playing' ? ageMs / 1000 : 0;
        const currentTime = t.duration ? Math.min(t.duration, t.currentTime + elapsed) : t.currentTime + elapsed;
        return { ...t, currentTime, isMuted: false };
    });
    playlistManager.replaceTracks(tracks);
    mixName = state.mixName;
    focusedId = state.focusedId;
    if (sameShape) {
        tracks.forEach((t) => {
            const row = rowFor(t.id);
            if (row)
                patchChannelRow(row, t);
        });
        renderStrip();
        renderStatus();
        renderStage(focusChanged);
        if (focusChanged)
            setFocusMarks(focusedId);
    }
    else {
        renderAll(focusChanged);
    }
}
/** Remote: move playing channels' times on between snapshots. */
function remoteTick() {
    if (mcRole !== 'remote')
        return;
    const now = performance.now();
    for (const track of playlistManager.getTracks()) {
        if (track.state !== 'playing')
            continue;
        const base = mcBases.get(track.id);
        if (!base)
            continue;
        let t = base.t + (now - base.at) / 1000;
        if (track.duration)
            t = track.loop ? t % track.duration : Math.min(track.duration, t);
        playlistManager.updateTrack(track.id, { currentTime: t });
        const row = rowFor(track.id);
        if (row)
            patchChannelRow(row, playlistManager.getTrack(track.id));
    }
    renderTime();
}
/** Mark the focused row and strip tiles without re-rendering them. */
function setFocusMarks(id) {
    channelList.querySelectorAll('[data-track-id]').forEach((row) => {
        const on = row.dataset.trackId === id;
        row.classList.toggle('is-focus', on);
        row.querySelector('.ch__focus')?.setAttribute('aria-current', String(on));
    });
    strips.forEach((strip) => strip.querySelectorAll('[data-track-id]').forEach((tile) => {
        const on = tile.dataset.trackId === id;
        tile.classList.toggle('is-focus', on);
        tile.querySelector('button')?.setAttribute('aria-current', String(on));
    }));
}
/** Remote: send a command to the main device, with immediate local feedback. */
function routeToMain(command) {
    if (mcRole !== 'remote')
        return false;
    // Feedback straight away; the main device's next snapshot confirms it.
    if (command.type === 'focus')
        setFocus(command.trackId);
    else if (command.type === 'step')
        stepFocus(command.dir);
    else if (command.type === 'volume')
        setVolume(command.trackId, command.volume);
    else if (command.type === 'seek') {
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
                    if (slot.command)
                        sendToMain(slot.command);
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
function sendToMain(command) {
    void sendCommand(command).then((reply) => {
        renderRemoteBadge();
        if (reply.ok)
            return;
        const main = mcStatus?.mainName || 'The main device';
        const text = reply.error === 'timeout'
            ? `${main} didn't respond.`
            : reply.error === 'no_main' || reply.error === 'offline'
                ? `${main} is offline.`
                : command.type === 'add' || command.type === 'relink'
                    ? 'That link has no YouTube video in it.'
                    : `${main} couldn't do that.`;
        if (command.type === 'add' || command.type === 'relink')
            showError(inputError, text);
        showRemoteNotice(text);
    });
    renderRemoteBadge();
}
/** Main device: run a command from a remote and answer it. */
function handleRemoteCommand(command, reply) {
    if (mcRole !== 'main' || !command || typeof command !== 'object' || typeof command.type !== 'string') {
        reply(false, 'not_main');
        return;
    }
    const ok = runLocalCommand(command);
    reply(ok, ok ? undefined : 'failed');
    if (ok)
        broadcastNow();
}
/** Become a remote: stop playing here and mirror the main device. */
function becomeRemote() {
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
    if (last)
        applyRoomState(last.state, last.ageMs);
    else
        renderAll(true);
    updateKeepAwake();
}
/** Stop being a remote: take over the mirrored mix here, paused, at the same positions. */
function leaveRemote() {
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
    }
    else {
        // The main device went away: take the mix over paused, and offer Play here.
        wasPlaying.forEach((id) => mcResumeIds.add(id));
    }
    playlistManager.replaceTracks(mirrored.map((t) => ({ ...t, state: 'loading', meta: t.meta })));
    for (const t of mirrored)
        createPlayerFor(t.id, t.videoId, { volume: t.volume, loop: t.loop, time: t.currentTime });
    renderAll(false);
}
function onConnectionChange(status) {
    const previous = mcRole;
    const wasOnline = mcStatus?.state === 'online';
    mcStatus = status;
    mcRole = status.role;
    if (previous !== mcRole) {
        if (mcRole === 'remote')
            becomeRemote();
        else if (previous === 'remote')
            leaveRemote();
        if (mcRole === 'main')
            broadcastNow();
    }
    else if (mcRole === 'main' && status.state === 'online' && !wasOnline) {
        broadcastNow();
    }
    if (mcRole === 'idle' && status.state === 'online' && liveCount() > 0)
        maybeClaimMain();
    renderRemoteBadge();
}
/** The header badge: "Remote · Laptop", or "Playing here · 1 remote". */
function renderRemoteBadge() {
    const badge = $('remoteBadge');
    const text = $('remoteBadgeText');
    const button = $('playHereButton');
    if (!badge || !text || mcNoticeTimer)
        return;
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
    }
    else if (offerResume) {
        // The main device left, or this device lost the connection to it.
        text.textContent = status.state === 'online' ? `${mainName} offline` : 'Disconnected';
        showButton = true;
    }
    else if (mcRole === 'remote') {
        text.textContent = status.state === 'online' ? `Remote · ${mainName}` : 'Remote · reconnecting';
        showButton = status.state === 'online';
    }
    else if (status.state !== 'online') {
        text.textContent = 'Playing here · reconnecting';
    }
    else {
        text.textContent = remotes ? `Playing here · ${remotes} remote${remotes === 1 ? '' : 's'}` : 'Playing here';
    }
    if (button)
        button.hidden = !showButton;
}
/** A short message in the badge (a command that failed on the main device). */
function showRemoteNotice(message) {
    const badge = $('remoteBadge');
    const text = $('remoteBadgeText');
    if (!badge || !text)
        return;
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
async function setupRemoteControl() {
    takeRelayOverride();
    onConnection(onConnectionChange);
    onRoomState(applyRoomState);
    onRemoteCommand(handleRemoteCommand);
    onRelease(releaseMain);
    $('playHereButton')?.addEventListener('click', playHere);
    // The main device refreshes everyone's times every 15 seconds while playing.
    window.setInterval(() => {
        if (mcRole === 'main' && liveCount() > 0)
            broadcastNow();
    }, 15000);
    // A remote that hasn't heard from the main device for a while asks the relay
    // to check: a phone asleep with its connection half open gets dropped.
    window.setInterval(() => {
        if (mcRole !== 'remote' || mcStatus?.state !== 'online')
            return;
        const last = lastRoomState();
        if (!last || last.ageMs > 35000)
            sendProbe();
    }, 30000);
    setupDevicesPanel();
    setupReconnectTriggers();
    // A pairing link opened while the app is already open on this page.
    window.addEventListener('hashchange', () => {
        const code = takePairCodeFromLocation();
        if (code)
            void joinWithCode(code);
    });
    const pairCode = takePairCodeFromLocation();
    if (pairCode)
        await joinWithCode(pairCode);
    else
        connectRoom();
}
async function initialize() {
    setCommandRunner(runLocalCommand);
    void setupRemoteControl();
    setupScreenTakeover();
    setupScreenEffect();
    setupLayout();
    setupScaleControl();
    setupLayoutControl();
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
        runLocalCommand({ type: 'load_mix', urls: lastPlaylist.urls, name: lastPlaylist.name, mode: 'replace' });
    }
}
initialize().catch(console.error);


})();