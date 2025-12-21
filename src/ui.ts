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
          <button class="track-delete">Delete</button>
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
          <button class="track-play-pause ${isPlaying ? 'playing' : ''}">${isPlaying ? 'Pause' : 'Play'}</button>
          <input type="range" class="track-seek" min="0" max="100" value="${seekPercent}" />
          <span class="track-time">${currentTime} / ${duration}</span>
          <input type="range" class="track-volume" min="0" max="1" step="0.01" value="${track.volume}" />
          <button class="track-loop-toggle ${track.loop ? 'active' : ''}">Loop ${track.loop ? 'ON' : 'OFF'}</button>
          <button class="track-delete">Delete</button>
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
    playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
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
    container.innerHTML = '<li style="color: #888; padding: 0.5rem;">No saved playlists</li>';
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

