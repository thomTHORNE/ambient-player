/**
 * Main entry point for the YouTube Audio Playlist application
 */
import { PlaylistManager } from './playlist.js';
import { waitForYouTubeAPI, createYouTubePlayerFactory, extractVideoId, isValidYouTubeUrl, } from './youtubePlayer.js';
import { saveOrUpdatePlaylist, deletePlaylist, getLastPlaylist, getAllPlaylists, } from './storage.js';
import { encodePlaylistToUrl, decodePlaylistFromLocation, clearPlaylistHash, } from './shareLinks.js';
import { createTrackElement, updateTrackElement, updateGlobalPlayPauseButton, renderSavedPlaylists, showReplaceAppendModal, showError, copyToClipboard, formatTime, } from './ui.js';
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
                <button class="track-play-pause">Play</button>
                <input type="range" class="track-seek" min="0" max="100" value="0" />
                <span class="track-time">0:00 / ${formatTime(meta.durationSeconds || 0)}</span>
                <input type="range" class="track-volume" min="0" max="1" step="0.01" value="${updatedTrack.volume}" />
                <button class="track-loop-toggle">Loop OFF</button>
                <button class="track-delete">Delete</button>
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
