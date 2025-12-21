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
 * UI module for DOM operations and event handlers
 */
/**
 * Format seconds to mm:ss
 */
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
/**
 * Create a track row element
 */
function createTrackElement(track) {
    const trackDiv = document.createElement('div');
    trackDiv.className = 'track';
    trackDiv.dataset.trackId = track.id;
    if (track.state === 'loading') {
        trackDiv.classList.add('loading');
        trackDiv.innerHTML = `
      <div class="track-main">
        <div class="track-loading">Loading...</div>
      </div>
      <div class="track-player-container"></div>
    `;
    }
    else if (track.state === 'error') {
        trackDiv.classList.add('error');
        trackDiv.innerHTML = `
      <div class="track-main">
        <div class="track-title">Error loading video</div>
        <div class="track-error-message">${track.error?.message || 'Unknown error'}</div>
        <div class="track-controls">
          <button class="track-delete" title="Delete">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="track-player-container"></div>
    `;
    }
    else {
        const isPlaying = track.state === 'playing';
        const currentTime = formatTime(track.currentTime);
        const duration = formatTime(track.duration || 0);
        const seekPercent = track.duration ? (track.currentTime / track.duration) * 100 : 0;
        trackDiv.innerHTML = `
      <img src="${track.meta?.thumbnailUrl || ''}" alt="Track thumbnail" />
      <div class="track-main">
        <div class="track-title">${track.meta?.title || 'Unknown Title'}</div>
        <div class="track-controls">
          <button class="track-play-pause ${isPlaying ? 'playing' : ''}" title="${isPlaying ? 'Pause' : 'Play'}">
            ${isPlaying ? `
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/>
              </svg>
            ` : `
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
              </svg>
            `}
          </button>
          <button class="track-stop" title="Stop">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5z"/>
            </svg>
          </button>
          <button class="track-loop-toggle ${track.loop ? 'active' : ''}" title="Loop ${track.loop ? 'ON' : 'OFF'}">Loop ${track.loop ? 'ON' : 'OFF'}</button>
          <button class="track-delete" title="Delete">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
          </button>
          <div class="track-volume-container">
            <svg class="volume-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
              <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
              <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
            </svg>
            <input type="range" class="track-volume" min="0" max="1" step="0.01" value="${track.volume}" />
          </div>
            <button class="track-seek-toggle" title="Toggle seek bar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3.5L4 7h8l-4-3.5z"/>
            </svg>
          </button>
          <div class="track-seek-container" style="display: none;">
            <input type="range" class="track-seek" min="0" max="100" value="${seekPercent}" />
            <span class="track-time">${currentTime} / ${duration}</span>
          </div>
        </div>
      </div>
      <div class="track-player-container"></div>
    `;
    }
    return trackDiv;
}
/**
 * Update an existing track element
 */
function updateTrackElement(trackElement, track) {
    const playPauseBtn = trackElement.querySelector('.track-play-pause');
    const seekBar = trackElement.querySelector('.track-seek');
    const timeDisplay = trackElement.querySelector('.track-time');
    const loopToggle = trackElement.querySelector('.track-loop-toggle');
    if (playPauseBtn) {
        const isPlaying = track.state === 'playing';
        playPauseBtn.innerHTML = isPlaying ? `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/>
      </svg>
    ` : `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
      </svg>
    `;
        playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
        playPauseBtn.classList.toggle('playing', isPlaying);
    }
    if (seekBar && track.duration) {
        // Only update the seek bar if the user is not currently interacting with it
        if (!seekBar.dataset.seeking) {
            const seekPercent = (track.currentTime / track.duration) * 100;
            seekBar.value = seekPercent.toString();
        }
    }
    if (timeDisplay) {
        const currentTime = formatTime(track.currentTime);
        const duration = formatTime(track.duration || 0);
        timeDisplay.textContent = `${currentTime} / ${duration}`;
    }
    if (loopToggle) {
        loopToggle.textContent = `Loop ${track.loop ? 'ON' : 'OFF'}`;
        loopToggle.classList.toggle('active', track.loop);
    }
}
/**
 * Render all tracks
 */
function renderTracks(playlistManager, playlistContainer) {
    playlistContainer.innerHTML = '';
    const tracks = playlistManager.getTracks();
    for (const track of tracks) {
        const trackElement = createTrackElement(track);
        playlistContainer.appendChild(trackElement);
    }
}
/**
 * Update the global play/pause button
 */
function updateGlobalPlayPauseButton(playlistManager, button) {
    const hasPlaying = playlistManager.hasPlayingTracks();
    button.textContent = hasPlaying ? 'Pause All' : 'Play All';
}
/**
 * Render saved playlists
 */
function renderSavedPlaylists(playlists, container) {
    container.innerHTML = '';
    if (playlists.length === 0) {
        container.innerHTML = '<li style="color: var(--text-muted); padding: 0.5rem;">No saved playlists</li>';
        return;
    }
    for (const playlist of playlists) {
        const li = document.createElement('li');
        li.className = 'saved-playlist-item';
        li.innerHTML = `
      <span class="saved-playlist-name">${playlist.name}</span>
      <div class="saved-playlist-actions">
        <button class="load-btn" data-playlist-name="${playlist.name}">Load</button>
        <button class="delete-btn" data-playlist-name="${playlist.name}">Delete</button>
      </div>
    `;
        container.appendChild(li);
    }
}
/**
 * Show a modal dialog for replace/append choice
 */
function showReplaceAppendModal(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
      <h3>Load Playlist</h3>
      <p>${message}</p>
      <div class="modal-actions">
        <button class="secondary cancel-btn">Cancel</button>
        <button class="secondary append-btn">Append</button>
        <button class="primary replace-btn">Replace</button>
      </div>
    `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        const cleanup = () => {
            document.body.removeChild(overlay);
        };
        modal.querySelector('.replace-btn')?.addEventListener('click', () => {
            cleanup();
            resolve('replace');
        });
        modal.querySelector('.append-btn')?.addEventListener('click', () => {
            cleanup();
            resolve('append');
        });
        modal.querySelector('.cancel-btn')?.addEventListener('click', () => {
            cleanup();
            resolve('cancel');
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve('cancel');
            }
        });
    });
}
/**
 * Show an error message
 */
function showError(element, message) {
    element.textContent = message;
    setTimeout(() => {
        element.textContent = '';
    }, 5000);
}
/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        return false;
    }
}


// ===== main.js =====
/**
 * Main entry point for the YouTube Audio Playlist application
 */





// Global state
const playlistManager = new PlaylistManager();
let playerFactory;
let updateInterval = null;
// DOM elements
const urlInput = document.getElementById('urlInput');
const addButton = document.getElementById('addButton');
const inputError = document.getElementById('inputError');
const globalPlayPauseButton = document.getElementById('globalPlayPause');
const shareButton = document.getElementById('shareButton');
const playlistNameInput = document.getElementById('playlistNameInput');
const savePlaylistButton = document.getElementById('savePlaylistButton');
const savedPlaylistsList = document.getElementById('savedPlaylistsList');
const playlistContainer = document.getElementById('playlist');
/**
 * Add a track from a URL
 */
async function addTrackFromUrl(url) {
    // Validate URL
    if (!isValidYouTubeUrl(url)) {
        showError(inputError, 'No video found for the provided URL.');
        return;
    }
    const videoId = extractVideoId(url);
    if (!videoId) {
        showError(inputError, 'No video found for the provided URL.');
        return;
    }
    // Clear input and error
    urlInput.value = '';
    inputError.textContent = '';
    // Create track
    const track = playlistManager.addTrack(url, videoId);
    // Render track
    const trackElement = createTrackElement(track);
    playlistContainer.appendChild(trackElement);
    // Get player container
    const playerContainer = trackElement.querySelector('.track-player-container');
    // Create player
    const controller = playerFactory.createPlayer(track.id, playerContainer, videoId, (trackId, meta) => {
        // On metadata loaded
        playlistManager.updateTrack(trackId, {
            meta,
            state: 'paused',
            duration: meta.durationSeconds
        });
        const updatedTrack = playlistManager.getTrack(trackId);
        if (updatedTrack) {
            const element = document.querySelector(`[data-track-id="${trackId}"]`);
            if (element) {
                // Remove loading class
                element.classList.remove('loading');
                // Get the track-main container
                const trackMain = element.querySelector('.track-main');
                if (trackMain) {
                    // Replace the loading message with full track UI
                    trackMain.innerHTML = `
              <div class="track-title">${meta.title}</div>
              <div class="track-controls">
                <button class="track-play-pause" title="Play">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
                  </svg>
                </button>
                <button class="track-stop" title="Stop">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5z"/>
                  </svg>
                </button>
                <button class="track-loop-toggle" title="Loop OFF">Loop OFF</button>
                <button class="track-delete" title="Delete">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                  </svg>
                </button>
                <div class="track-volume-container">
                  <svg class="volume-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
                    <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
                    <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
                  </svg>
                  <input type="range" class="track-volume" min="0" max="1" step="0.01" value="${updatedTrack.volume}" />
                </div>
                 <button class="track-seek-toggle" title="Toggle seek bar">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 3.5L4 7h8l-4-3.5z"/>
                  </svg>
                </button>
                <div class="track-seek-container" style="display: none;">
                  <input type="range" class="track-seek" min="0" max="100" value="0" />
                  <span class="track-time">0:00 / ${formatTime(meta.durationSeconds || 0)}</span>
                </div>
              </div>
            `;
                }
                // Add thumbnail image if it doesn't exist
                if (!element.querySelector('img')) {
                    const img = document.createElement('img');
                    img.src = meta.thumbnailUrl;
                    img.alt = 'Track thumbnail';
                    element.insertBefore(img, element.firstChild);
                }
                attachTrackEventListeners(element, trackId);
            }
        }
    }, (trackId, state) => {
        // On state change
        playlistManager.updateTrack(trackId, { state });
        updateGlobalPlayPauseButton(playlistManager, globalPlayPauseButton);
        // Update the UI immediately for this track
        const trackElement = document.querySelector(`[data-track-id="${trackId}"]`);
        if (trackElement) {
            const updatedTrack = playlistManager.getTrack(trackId);
            if (updatedTrack) {
                updateTrackElement(trackElement, updatedTrack);
            }
        }
        // Start update interval when playing
        if (state === 'playing') {
            startUpdateInterval();
        }
        // Handle loop on ended
        if (state === 'paused') {
            const track = playlistManager.getTrack(trackId);
            const controller = playlistManager.getController(trackId);
            if (track && controller && track.loop) {
                const currentTime = controller.getCurrentTime();
                const duration = controller.getDuration();
                // If at the end (within 1 second of duration), loop
                // Use a larger threshold to catch the ended state reliably
                if (duration > 0 && currentTime >= duration - 1) {
                    // Small delay to ensure YouTube player is ready
                    setTimeout(() => {
                        controller.seekTo(0);
                        controller.play();
                    }, 100);
                }
            }
        }
    }, (trackId, error) => {
        // On error
        playlistManager.updateTrack(trackId, { state: 'error', error });
        const updatedTrack = playlistManager.getTrack(trackId);
        if (updatedTrack) {
            const element = document.querySelector(`[data-track-id="${trackId}"]`);
            if (element) {
                // Update the element to show error state without replacing it
                element.classList.remove('loading');
                element.classList.add('error');
                // Get the track-main container
                const trackMain = element.querySelector('.track-main');
                if (trackMain) {
                    trackMain.innerHTML = `
              <div class="track-title">Error loading video</div>
              <div class="track-error-message">${error.message}</div>
              <div class="track-controls">
                <button class="track-delete">Delete</button>
              </div>
            `;
                }
                attachTrackEventListeners(element, trackId);
            }
        }
    });
    playlistManager.setController(track.id, controller);
    attachTrackEventListeners(trackElement, track.id);
    // Start update interval if not running
    startUpdateInterval();
}
/**
 * Attach event listeners to a track element
 */
function attachTrackEventListeners(trackElement, trackId) {
    const playPauseBtn = trackElement.querySelector('.track-play-pause');
    const stopBtn = trackElement.querySelector('.track-stop');
    const seekToggleBtn = trackElement.querySelector('.track-seek-toggle');
    const seekContainer = trackElement.querySelector('.track-seek-container');
    const seekBar = trackElement.querySelector('.track-seek');
    const volumeSlider = trackElement.querySelector('.track-volume');
    const loopToggle = trackElement.querySelector('.track-loop-toggle');
    const deleteBtn = trackElement.querySelector('.track-delete');
    const controller = playlistManager.getController(trackId);
    if (!controller)
        return;
    // Play/Pause
    playPauseBtn?.addEventListener('click', () => {
        const track = playlistManager.getTrack(trackId);
        if (!track)
            return;
        if (track.state === 'playing') {
            controller.pause();
        }
        else {
            controller.play();
        }
    });
    // Stop
    stopBtn?.addEventListener('click', () => {
        const track = playlistManager.getTrack(trackId);
        if (!track)
            return;
        controller.pause();
        controller.seekTo(0);
        playlistManager.updateTrack(trackId, { currentTime: 0 });
        // Update the UI immediately
        const updatedTrack = playlistManager.getTrack(trackId);
        if (updatedTrack) {
            updateTrackElement(trackElement, updatedTrack);
        }
    });
    // Seek bar toggle
    seekToggleBtn?.addEventListener('click', () => {
        if (seekContainer) {
            const isHidden = seekContainer.style.display === 'none';
            seekContainer.style.display = isHidden ? 'flex' : 'none';
            // Rotate the arrow icon
            const svg = seekToggleBtn.querySelector('svg');
            if (svg) {
                svg.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        }
    });
    // Seek
    // Track when user starts interacting with the seek bar
    seekBar?.addEventListener('mousedown', () => {
        if (seekBar)
            seekBar.dataset.seeking = 'true';
    });
    seekBar?.addEventListener('touchstart', () => {
        if (seekBar)
            seekBar.dataset.seeking = 'true';
    });
    // Track when user stops interacting with the seek bar
    seekBar?.addEventListener('mouseup', () => {
        if (seekBar)
            delete seekBar.dataset.seeking;
    });
    seekBar?.addEventListener('touchend', () => {
        if (seekBar)
            delete seekBar.dataset.seeking;
    });
    // Also remove on mouse leave to handle edge cases
    seekBar?.addEventListener('mouseleave', () => {
        if (seekBar)
            delete seekBar.dataset.seeking;
    });
    // Handle seeking
    seekBar?.addEventListener('input', () => {
        const track = playlistManager.getTrack(trackId);
        if (!track || !track.duration)
            return;
        const percent = parseFloat(seekBar.value);
        const targetTime = (percent / 100) * track.duration;
        controller.seekTo(targetTime);
        playlistManager.updateTrack(trackId, { currentTime: targetTime });
    });
    // Volume
    volumeSlider?.addEventListener('input', () => {
        const volume = parseFloat(volumeSlider.value);
        controller.setVolume(volume);
        playlistManager.updateTrack(trackId, { volume });
    });
    // Loop toggle
    loopToggle?.addEventListener('click', () => {
        const track = playlistManager.getTrack(trackId);
        if (!track)
            return;
        const newLoop = !track.loop;
        playlistManager.updateTrack(trackId, { loop: newLoop });
        loopToggle.textContent = `Loop ${newLoop ? 'ON' : 'OFF'}`;
        loopToggle.classList.toggle('active', newLoop);
    });
    // Delete
    deleteBtn?.addEventListener('click', () => {
        playlistManager.removeTrack(trackId);
        trackElement.remove();
        updateGlobalPlayPauseButton(playlistManager, globalPlayPauseButton);
        // Stop update interval if no tracks
        if (playlistManager.getTracks().length === 0) {
            stopUpdateInterval();
        }
    });
}
/**
 * Start the update interval for track progress
 */
function startUpdateInterval() {
    if (updateInterval !== null)
        return;
    updateInterval = window.setInterval(() => {
        const tracks = playlistManager.getTracks();
        let hasPlaying = false;
        for (const track of tracks) {
            if (track.state === 'playing') {
                hasPlaying = true;
                const controller = playlistManager.getController(track.id);
                if (controller) {
                    const currentTime = controller.getCurrentTime();
                    const duration = controller.getDuration();
                    playlistManager.updateTrack(track.id, {
                        currentTime,
                        duration: duration > 0 ? duration : track.duration,
                    });
                    const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
                    if (trackElement) {
                        const updatedTrack = playlistManager.getTrack(track.id);
                        if (updatedTrack) {
                            updateTrackElement(trackElement, updatedTrack);
                        }
                    }
                }
            }
        }
        // Stop interval if nothing is playing
        if (!hasPlaying) {
            stopUpdateInterval();
        }
    }, 250);
}
/**
 * Stop the update interval
 */
function stopUpdateInterval() {
    if (updateInterval !== null) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}
/**
 * Load tracks from URLs
 */
async function loadTracksFromUrls(urls, mode) {
    if (mode === 'replace') {
        // Clear existing tracks
        const tracks = playlistManager.getTracks();
        for (const track of tracks) {
            playlistManager.removeTrack(track.id);
        }
        playlistContainer.innerHTML = '';
    }
    // Add new tracks
    for (const url of urls) {
        await addTrackFromUrl(url);
    }
}
/**
 * Handle loading a playlist (with replace/append prompt if needed)
 */
async function handleLoadPlaylist(urls) {
    const currentTracks = playlistManager.getTracks();
    if (currentTracks.length === 0) {
        await loadTracksFromUrls(urls, 'replace');
    }
    else {
        const choice = await showReplaceAppendModal('You have tracks in the current playlist. Do you want to replace them or append the new tracks?');
        if (choice === 'cancel')
            return;
        await loadTracksFromUrls(urls, choice);
    }
}
/**
 * Initialize event listeners
 */
function initializeEventListeners() {
    // Add track button
    addButton.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
            addTrackFromUrl(url);
        }
    });
    // Enter key in URL input
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const url = urlInput.value.trim();
            if (url) {
                addTrackFromUrl(url);
            }
        }
    });
    // Global play/pause
    globalPlayPauseButton.addEventListener('click', () => {
        const tracks = playlistManager.getTracks();
        const hasPlaying = playlistManager.hasPlayingTracks();
        if (hasPlaying) {
            // Pause all
            for (const track of tracks) {
                if (track.state === 'playing') {
                    const controller = playlistManager.getController(track.id);
                    controller?.pause();
                }
            }
        }
        else {
            // Play all
            for (const track of tracks) {
                if (track.state !== 'error') {
                    const controller = playlistManager.getController(track.id);
                    controller?.play();
                }
            }
            startUpdateInterval();
        }
    });
    // Share button
    shareButton.addEventListener('click', async () => {
        const urls = playlistManager.getTrackUrls();
        if (urls.length === 0) {
            showError(inputError, 'No tracks to share.');
            return;
        }
        const shareUrl = encodePlaylistToUrl(urls);
        const success = await copyToClipboard(shareUrl);
        if (success) {
            const originalText = shareButton.textContent;
            shareButton.textContent = 'Copied!';
            setTimeout(() => {
                shareButton.textContent = originalText;
            }, 2000);
        }
        else {
            showError(inputError, 'Failed to copy to clipboard.');
        }
    });
    // Save/update playlist
    savePlaylistButton.addEventListener('click', () => {
        const name = playlistNameInput.value.trim();
        if (!name) {
            showError(inputError, 'Please enter a playlist name.');
            return;
        }
        const urls = playlistManager.getTrackUrls();
        if (urls.length === 0) {
            showError(inputError, 'No tracks to save.');
            return;
        }
        saveOrUpdatePlaylist(name, urls);
        playlistNameInput.value = '';
        // Refresh saved playlists list
        const playlists = getAllPlaylists();
        renderSavedPlaylists(playlists, savedPlaylistsList);
        // Show success message
        const originalText = savePlaylistButton.textContent;
        savePlaylistButton.textContent = 'Saved!';
        setTimeout(() => {
            savePlaylistButton.textContent = originalText;
        }, 2000);
    });
    // Saved playlists list (event delegation)
    savedPlaylistsList.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.classList.contains('load-btn')) {
            const playlistName = target.dataset.playlistName;
            if (!playlistName)
                return;
            const playlists = getAllPlaylists();
            const playlist = playlists.find(p => p.name === playlistName);
            if (playlist) {
                await handleLoadPlaylist(playlist.urls);
            }
        }
        else if (target.classList.contains('delete-btn')) {
            const playlistName = target.dataset.playlistName;
            if (!playlistName)
                return;
            if (confirm(`Delete playlist "${playlistName}"?`)) {
                deletePlaylist(playlistName);
                const playlists = getAllPlaylists();
                renderSavedPlaylists(playlists, savedPlaylistsList);
            }
        }
    });
}
/**
 * Initialize the application
 */
async function initialize() {
    // Wait for YouTube API
    await waitForYouTubeAPI();
    // Create player factory
    playerFactory = createYouTubePlayerFactory();
    // Initialize event listeners
    initializeEventListeners();
    // Render saved playlists
    const playlists = getAllPlaylists();
    renderSavedPlaylists(playlists, savedPlaylistsList);
    // Check for shared playlist in URL
    const sharedUrls = decodePlaylistFromLocation();
    if (sharedUrls && sharedUrls.length > 0) {
        clearPlaylistHash();
        await handleLoadPlaylist(sharedUrls);
        return;
    }
    // Load last used playlist
    const lastPlaylist = getLastPlaylist();
    if (lastPlaylist && lastPlaylist.urls.length > 0) {
        await loadTracksFromUrls(lastPlaylist.urls, 'replace');
    }
}
// Start the application
initialize().catch(console.error);


})();