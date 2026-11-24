/**
 * YouTube IFrame API wrapper
 */

import type { TrackId, YouTubeVideoMeta, TrackState, TrackError } from './playlist.js';

// YouTube IFrame API types
declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: () => void;
  }

  const YT: {
    Player: new (element: HTMLElement | string, config: YT.PlayerOptions) => YT.Player;
    PlayerState: {
      UNSTARTED: number;
      ENDED: number;
      PLAYING: number;
      PAUSED: number;
      BUFFERING: number;
      CUED: number;
    };
  };

  namespace YT {
    interface PlayerOptions {
      videoId: string;
      width?: number;
      height?: number;
      playerVars?: PlayerVars;
      events?: Events;
    }

    interface PlayerVars {
      autoplay?: 0 | 1;
      start?: number;
      controls?: 0 | 1;
      enablejsapi?: 0 | 1;
      origin?: string;
    }

    interface Events {
      onReady?: (event: PlayerEvent) => void;
      onStateChange?: (event: OnStateChangeEvent) => void;
      onError?: (event: OnErrorEvent) => void;
    }

    interface PlayerEvent {
      target: Player;
    }

    interface OnStateChangeEvent extends PlayerEvent {
      data: number;
    }

    interface OnErrorEvent extends PlayerEvent {
      data: number;
    }

    interface Player {
      playVideo(): void;
      pauseVideo(): void;
      seekTo(seconds: number, allowSeekAhead: boolean): void;
      setVolume(volume: number): void;
      getVolume(): number;
      getCurrentTime(): number;
      getDuration(): number;
      getVideoData(): VideoData;
      destroy(): void;
    }

    interface VideoData {
      video_id: string;
      title: string;
      author?: string;
    }
  }
}

export interface YouTubePlayerController {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  /** Channel name. YouTube often leaves it empty until playback has started. */
  getAuthor(): string;
  destroy(): void;
}

export type TrackStateListener = (trackId: TrackId, state: TrackState) => void;
export type TrackMetaListener = (trackId: TrackId, meta: YouTubeVideoMeta) => void;
export type TrackErrorListener = (trackId: TrackId, error: TrackError) => void;

export interface YouTubePlayerFactory {
  createPlayer(
    trackId: TrackId,
    containerElement: HTMLElement,
    videoId: string,
    onMeta: TrackMetaListener,
    onState: TrackStateListener,
    onError: TrackErrorListener,
    /** Start here (whole seconds) without starting playback. */
    startSeconds?: number
  ): YouTubePlayerController;
}

/**
 * Wait for YouTube IFrame API to be ready
 */
export function waitForYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        resolve();
      };
    }
  });
}

/**
 * Create a YouTube player controller
 */
export function createYouTubePlayerFactory(): YouTubePlayerFactory {
  return {
    createPlayer(
      trackId: TrackId,
      containerElement: HTMLElement,
      videoId: string,
      onMeta: TrackMetaListener,
      onState: TrackStateListener,
      onError: TrackErrorListener,
      startSeconds?: number
    ): YouTubePlayerController {
      let player: YT.Player | null = null;
      let isReady = false;
      let timeoutId: number | null = null;

      const controller: YouTubePlayerController = {
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
        seekTo(seconds: number) {
          if (isReady && player) {
            player.seekTo(seconds, true);
          }
        },
        setVolume(volume: number) {
          if (isReady && player) {
            player.setVolume(volume * 100);
          }
        },
        getCurrentTime(): number {
          if (isReady && player) {
            return player.getCurrentTime();
          }
          return 0;
        },
        getDuration(): number {
          if (isReady && player) {
            return player.getDuration();
          }
          return 0;
        },
        getAuthor(): string {
          if (isReady && player) {
            try {
              return player.getVideoData().author || '';
            } catch {
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

                const meta: YouTubeVideoMeta = {
                  id: videoData.video_id,
                  title: videoData.title || 'Unknown Title',
                  author: videoData.author || undefined,
                  thumbnailUrl: `https://img.youtube.com/vi/${videoData.video_id}/hqdefault.jpg`,
                  durationSeconds: duration > 0 ? duration : undefined,
                };

                onMeta(trackId, meta);
                onState(trackId, 'paused');
              } catch (error) {
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
              } else if (state === YT.PlayerState.PAUSED) {
                onState(trackId, 'paused');
              } else if (state === YT.PlayerState.ENDED) {
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
      } catch (error) {
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
export function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Standard youtube.com URLs, including the mobile and YouTube Music sites
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(urlObj.hostname)) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) return videoId;
    }

    // youtu.be short URLs
    if (urlObj.hostname === 'youtu.be') {
      const videoId = urlObj.pathname.slice(1);
      if (videoId) return videoId;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate if a URL is a valid YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

