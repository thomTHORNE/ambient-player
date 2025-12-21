/**
 * Main entry point for the YouTube Audio Playlist application
 */

import { PlaylistManager } from './playlist.js';
import type { TrackId, YouTubeVideoMeta, TrackState, TrackError } from './playlist.js';
import {
  waitForYouTubeAPI,
  createYouTubePlayerFactory,
  extractVideoId,
  isValidYouTubeUrl,
} from './youtubePlayer.js';
import type { YouTubePlayerFactory } from './youtubePlayer.js';
import {
  saveOrUpdatePlaylist,
  deletePlaylist,
  getLastPlaylist,
  getAllPlaylists,
} from './storage.js';
import {
  encodePlaylistToUrl,
  decodePlaylistFromLocation,
  clearPlaylistHash,
} from './shareLinks.js';
import {
  createTrackElement,
  updateTrackElement,
  updateGlobalPlayPauseButton,
  renderSavedPlaylists,
  showReplaceAppendModal,
  showError,
  copyToClipboard,
  formatTime,
} from './ui.js';

// Global state
const playlistManager = new PlaylistManager();
let playerFactory: YouTubePlayerFactory;
let updateInterval: number | null = null;

// DOM elements
const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const addButton = document.getElementById('addButton') as HTMLButtonElement;
const inputError = document.getElementById('inputError') as HTMLElement;
const globalPlayPauseButton = document.getElementById('globalPlayPause') as HTMLButtonElement;
const shareButton = document.getElementById('shareButton') as HTMLButtonElement;
const playlistNameInput = document.getElementById('playlistNameInput') as HTMLInputElement;
const savePlaylistButton = document.getElementById('savePlaylistButton') as HTMLButtonElement;
const savedPlaylistsList = document.getElementById('savedPlaylistsList') as HTMLElement;
const playlistContainer = document.getElementById('playlist') as HTMLElement;

/**
 * Add a track from a URL
 */
async function addTrackFromUrl(url: string): Promise<void> {
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
  const playerContainer = trackElement.querySelector('.track-player-container') as HTMLElement;

  // Create player
  const controller = playerFactory.createPlayer(
    track.id,
    playerContainer,
    videoId,
    (trackId: TrackId, meta: YouTubeVideoMeta) => {
      // On metadata loaded
      playlistManager.updateTrack(trackId, {
        meta,
        state: 'paused',
        duration: meta.durationSeconds
      });
      const updatedTrack = playlistManager.getTrack(trackId);
      if (updatedTrack) {
        const element = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
        if (element) {
          // Remove loading class
          element.classList.remove('loading');

          // Get the track-main container
          const trackMain = element.querySelector('.track-main') as HTMLElement;
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
                  <span class="volume-display">${Math.round(updatedTrack.volume * 100)}</span>
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
                <div class="track-url-container" style="display: none;">
                  <input type="text" class="track-url-input" value="${updatedTrack.url}" placeholder="YouTube URL" />
                  <button class="track-url-reload-btn" title="Reload track with new URL">Reload</button>
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
    },
    (trackId: TrackId, state: TrackState) => {
      // On state change
      playlistManager.updateTrack(trackId, { state });
      updateGlobalPlayPauseButton(playlistManager, globalPlayPauseButton);

      // Update the UI immediately for this track
      const trackElement = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
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
    },
    (trackId: TrackId, error: TrackError) => {
      // On error
      playlistManager.updateTrack(trackId, { state: 'error', error });
      const updatedTrack = playlistManager.getTrack(trackId);
      if (updatedTrack) {
        const element = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
        if (element) {
          // Update the element to show error state without replacing it
          element.classList.remove('loading');
          element.classList.add('error');

          // Get the track-main container
          const trackMain = element.querySelector('.track-main') as HTMLElement;
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
    }
  );

  playlistManager.setController(track.id, controller);
  attachTrackEventListeners(trackElement, track.id);
  
  // Start update interval if not running
  startUpdateInterval();
}

/**
 * Attach event listeners to a track element
 */
function attachTrackEventListeners(trackElement: HTMLElement, trackId: TrackId): void {
  const playPauseBtn = trackElement.querySelector('.track-play-pause') as HTMLButtonElement;
  const stopBtn = trackElement.querySelector('.track-stop') as HTMLButtonElement;
  const seekToggleBtn = trackElement.querySelector('.track-seek-toggle') as HTMLButtonElement;
  const seekContainer = trackElement.querySelector('.track-seek-container') as HTMLElement;
  const seekBar = trackElement.querySelector('.track-seek') as HTMLInputElement;
  const volumeSlider = trackElement.querySelector('.track-volume') as HTMLInputElement;
  const loopToggle = trackElement.querySelector('.track-loop-toggle') as HTMLButtonElement;
  const deleteBtn = trackElement.querySelector('.track-delete') as HTMLButtonElement;

  const controller = playlistManager.getController(trackId);
  if (!controller) return;

  // Play/Pause
  playPauseBtn?.addEventListener('click', () => {
    const track = playlistManager.getTrack(trackId);
    if (!track) return;

    if (track.state === 'playing') {
      controller.pause();
    } else {
      controller.play();
    }
  });

  // Stop
  stopBtn?.addEventListener('click', () => {
    const track = playlistManager.getTrack(trackId);
    if (!track) return;

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

      // Also toggle URL container visibility
      const urlContainer = trackElement.querySelector('.track-url-container') as HTMLElement;
      if (urlContainer) {
        urlContainer.style.display = isHidden ? 'flex' : 'none';
      }

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
    if (seekBar) seekBar.dataset.seeking = 'true';
  });

  seekBar?.addEventListener('touchstart', () => {
    if (seekBar) seekBar.dataset.seeking = 'true';
  });

  // Track when user stops interacting with the seek bar
  seekBar?.addEventListener('mouseup', () => {
    if (seekBar) delete seekBar.dataset.seeking;
  });

  seekBar?.addEventListener('touchend', () => {
    if (seekBar) delete seekBar.dataset.seeking;
  });

  // Also remove on mouse leave to handle edge cases
  seekBar?.addEventListener('mouseleave', () => {
    if (seekBar) delete seekBar.dataset.seeking;
  });

  // Handle seeking
  seekBar?.addEventListener('input', () => {
    const track = playlistManager.getTrack(trackId);
    if (!track || !track.duration) return;

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

    // Update volume display
    const volumeDisplay = trackElement.querySelector('.volume-display') as HTMLSpanElement;
    if (volumeDisplay) {
      volumeDisplay.textContent = Math.round(volume * 100).toString();
    }
  });

  // Loop toggle
  loopToggle?.addEventListener('click', () => {
    const track = playlistManager.getTrack(trackId);
    if (!track) return;

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

  // URL Reload
  const urlReloadBtn = trackElement.querySelector('.track-url-reload-btn') as HTMLButtonElement;
  urlReloadBtn?.addEventListener('click', () => {
    const urlInput = trackElement.querySelector('.track-url-input') as HTMLInputElement;
    if (!urlInput) return;

    const newUrl = urlInput.value.trim();
    if (!newUrl) return;

    // Validate URL
    if (!isValidYouTubeUrl(newUrl)) {
      alert('Invalid YouTube URL. Please enter a valid YouTube video URL.');
      return;
    }

    const newVideoId = extractVideoId(newUrl);
    if (!newVideoId) {
      alert('Could not extract video ID from URL.');
      return;
    }

    reloadTrack(trackId, newUrl, newVideoId);
  });
}

/**
 * Reload a track with a new URL
 */
function reloadTrack(trackId: TrackId, newUrl: string, newVideoId: string): void {
  const track = playlistManager.getTrack(trackId);
  if (!track) return;

  const trackElement = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
  if (!trackElement) return;

  // Store current state
  const currentVolume = track.volume;
  const currentLoop = track.loop;

  // Destroy old controller
  const oldController = playlistManager.getController(trackId);
  if (oldController) {
    oldController.destroy();
  }

  // Update track to loading state
  playlistManager.updateTrack(trackId, {
    url: newUrl,
    videoId: newVideoId,
    state: 'loading',
    currentTime: 0,
    meta: undefined,
    duration: undefined,
    error: undefined,
  });

  // Update UI to loading state
  trackElement.classList.add('loading');
  trackElement.classList.remove('error');
  const trackMain = trackElement.querySelector('.track-main') as HTMLElement;
  if (trackMain) {
    trackMain.innerHTML = '<div class="track-loading">Loading...</div>';
  }

  // Remove old thumbnail
  const oldImg = trackElement.querySelector('img');
  if (oldImg) {
    oldImg.remove();
  }

  // Get player container
  const playerContainer = trackElement.querySelector('.track-player-container') as HTMLElement;
  if (!playerContainer) return;

  // Clear player container
  playerContainer.innerHTML = '';

  // Create new player
  const controller = playerFactory.createPlayer(
    trackId,
    playerContainer,
    newVideoId,
    (trackId: TrackId, meta: YouTubeVideoMeta) => {
      // On metadata loaded
      playlistManager.updateTrack(trackId, {
        meta,
        state: 'paused',
        duration: meta.durationSeconds,
        volume: currentVolume,
        loop: currentLoop,
      });
      const updatedTrack = playlistManager.getTrack(trackId);
      if (updatedTrack) {
        const element = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
        if (element) {
          // Remove loading class
          element.classList.remove('loading');

          // Get the track-main container
          const trackMain = element.querySelector('.track-main') as HTMLElement;
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
                <button class="track-loop-toggle ${currentLoop ? 'active' : ''}" title="Loop ${currentLoop ? 'ON' : 'OFF'}">Loop ${currentLoop ? 'ON' : 'OFF'}</button>
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
                  <span class="volume-display">${Math.round(updatedTrack.volume * 100)}</span>
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
                <div class="track-url-container" style="display: none;">
                  <input type="text" class="track-url-input" value="${updatedTrack.url}" placeholder="YouTube URL" />
                  <button class="track-url-reload-btn" title="Reload track with new URL">Reload</button>
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

          // Set volume on new controller
          controller.setVolume(currentVolume);

          attachTrackEventListeners(element, trackId);
        }
      }
    },
    (trackId: TrackId, state: TrackState) => {
      // On state change
      playlistManager.updateTrack(trackId, { state });
      updateGlobalPlayPauseButton(playlistManager, globalPlayPauseButton);

      // Update the UI immediately for this track
      const trackElement = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
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
    },
    (trackId: TrackId, error: TrackError) => {
      // On error
      playlistManager.updateTrack(trackId, { state: 'error', error });
      const updatedTrack = playlistManager.getTrack(trackId);
      if (updatedTrack) {
        const element = document.querySelector(`[data-track-id="${trackId}"]`) as HTMLElement;
        if (element) {
          // Update the element to show error state without replacing it
          element.classList.remove('loading');
          element.classList.add('error');

          // Get the track-main container
          const trackMain = element.querySelector('.track-main') as HTMLElement;
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
    }
  );

  playlistManager.setController(trackId, controller);
}

/**
 * Start the update interval for track progress
 */
function startUpdateInterval(): void {
  if (updateInterval !== null) return;

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

          const trackElement = document.querySelector(`[data-track-id="${track.id}"]`) as HTMLElement;
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
function stopUpdateInterval(): void {
  if (updateInterval !== null) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

/**
 * Load tracks from URLs
 */
async function loadTracksFromUrls(urls: string[], mode: 'replace' | 'append'): Promise<void> {
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
async function handleLoadPlaylist(urls: string[]): Promise<void> {
  const currentTracks = playlistManager.getTracks();

  if (currentTracks.length === 0) {
    await loadTracksFromUrls(urls, 'replace');
  } else {
    const choice = await showReplaceAppendModal(
      'You have tracks in the current playlist. Do you want to replace them or append the new tracks?'
    );

    if (choice === 'cancel') return;
    await loadTracksFromUrls(urls, choice);
  }
}

/**
 * Initialize event listeners
 */
function initializeEventListeners(): void {
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
    } else {
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
    } else {
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
    const target = e.target as HTMLElement;

    if (target.classList.contains('load-btn')) {
      const playlistName = target.dataset.playlistName;
      if (!playlistName) return;

      const playlists = getAllPlaylists();
      const playlist = playlists.find(p => p.name === playlistName);
      if (playlist) {
        await handleLoadPlaylist(playlist.urls);
      }
    } else if (target.classList.contains('delete-btn')) {
      const playlistName = target.dataset.playlistName;
      if (!playlistName) return;

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
async function initialize(): Promise<void> {
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

