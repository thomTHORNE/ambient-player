/**
 * UI module for DOM operations and event handlers
 */

import type { Track, PlaylistManager } from './playlist.js';
import type { PersistedPlaylist } from './storage.js';

/**
 * Format seconds to mm:ss
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Create a track row element
 */
export function createTrackElement(track: Track): HTMLElement {
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
  } else if (track.state === 'error') {
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
  } else {
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
            <span class="volume-display">${Math.round(track.volume * 100)}</span>
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
export function updateTrackElement(trackElement: HTMLElement, track: Track): void {
  const playPauseBtn = trackElement.querySelector('.track-play-pause') as HTMLButtonElement;
  const seekBar = trackElement.querySelector('.track-seek') as HTMLInputElement;
  const timeDisplay = trackElement.querySelector('.track-time') as HTMLSpanElement;
  const loopToggle = trackElement.querySelector('.track-loop-toggle') as HTMLButtonElement;

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
export function renderTracks(
  playlistManager: PlaylistManager,
  playlistContainer: HTMLElement
): void {
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
export function updateGlobalPlayPauseButton(
  playlistManager: PlaylistManager,
  button: HTMLButtonElement
): void {
  const hasPlaying = playlistManager.hasPlayingTracks();
  button.textContent = hasPlaying ? 'Pause All' : 'Play All';
}

/**
 * Render saved playlists
 */
export function renderSavedPlaylists(
  playlists: PersistedPlaylist[],
  container: HTMLElement
): void {
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
export function showReplaceAppendModal(
  message: string
): Promise<'replace' | 'append' | 'cancel'> {
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
export function showError(element: HTMLElement, message: string): void {
  element.textContent = message;
  setTimeout(() => {
    element.textContent = '';
  }, 5000);
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

