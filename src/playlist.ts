/**
 * Playlist manager module
 */

import type { YouTubePlayerController } from './youtubePlayer.js';

export type TrackId = string;

export interface YouTubeVideoMeta {
  id: string;
  title: string;
  author?: string;
  thumbnailUrl: string;
  durationSeconds?: number;
}

export type TrackState = 'loading' | 'playing' | 'paused' | 'error';

export interface TrackError {
  code: string;
  message: string;
}

export interface Track {
  id: TrackId;
  url: string;
  videoId: string;
  meta?: YouTubeVideoMeta;
  state: TrackState;
  error?: TrackError;
  currentTime: number;
  duration?: number;
  volume: number;
  isMuted: boolean;
  loop: boolean;
}

export interface PlaylistState {
  tracks: Track[];
}

/**
 * Manages the playlist state and track controllers
 */
export class PlaylistManager {
  private state: PlaylistState = { tracks: [] };
  private controllers = new Map<TrackId, YouTubePlayerController>();

  /**
   * Add a new track to the playlist
   */
  addTrack(url: string, videoId: string): Track {
    const track: Track = {
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
  updateTrack(id: TrackId, partial: Partial<Track>): void {
    const track = this.state.tracks.find(t => t.id === id);
    if (!track) return;
    Object.assign(track, partial);
  }

  /**
   * Remove a track from the playlist
   */
  removeTrack(id: TrackId): void {
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
  getTracks(): ReadonlyArray<Track> {
    return this.state.tracks;
  }

  /**
   * Get a specific track by ID
   */
  getTrack(id: TrackId): Track | undefined {
    return this.state.tracks.find(t => t.id === id);
  }

  /**
   * Set the controller for a track
   */
  setController(id: TrackId, controller: YouTubePlayerController): void {
    this.controllers.set(id, controller);
  }

  /**
   * Get the controller for a track
   */
  getController(id: TrackId): YouTubePlayerController | undefined {
    return this.controllers.get(id);
  }

  /**
   * Clear all tracks
   */
  clearTracks(): void {
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
  replaceTracks(tracks: Track[]): void {
    this.clearTracks();
    this.state.tracks = tracks.map((t) => ({ ...t }));
  }

  /**
   * Get all track URLs in order
   */
  getTrackUrls(): string[] {
    return this.state.tracks.map(t => t.url);
  }

  /**
   * Check if any track is currently playing
   */
  hasPlayingTracks(): boolean {
    return this.state.tracks.some(t => t.state === 'playing');
  }
}

