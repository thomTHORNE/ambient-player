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
      mute(): void;
      unMute(): void;
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

// ---------------------------------------------------------------------------
// Warming up: each channel plays once, muted, while the page is visible
// ---------------------------------------------------------------------------
//
// Chromium holds back media in a hidden page from a frame that has never
// played anything: it loads only once the page is visible again. Each channel
// is its own YouTube frame, so with the screen off (a phone controlled from
// another device) a channel that has never played would not start until the
// screen came on, while channels that had played kept working. So each new
// player plays for a moment, muted, while the page is visible, then goes back
// to where it was, paused. One at a time, so a mix's loading stays light.

const warmQueue: Array<() => Promise<void>> = [];
let warming = false;

function whenVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

async function drainWarmQueue(): Promise<void> {
  if (warming) return;
  warming = true;
  while (warmQueue.length) {
    await whenVisible();
    await warmQueue.shift()!();
  }
  warming = false;
}

function queueWarmUp(job: () => Promise<void>): void {
  warmQueue.push(job);
  void drainWarmQueue();
}

/** Give up on a warm-up that doesn't start playing within this long. */
const WARM_TIMEOUT_MS = 8000;

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
      /** Played at least once (warm-up or for real): this frame can start while hidden. */
      let warmed = false;
      /** The warm-up in progress: what it does with the player's next events. */
      let warm: {
        stage: 'starting' | 'stopping';
        /** Asked to play meanwhile: keep playing, with the sound on. */
        wantPlay: boolean;
        from: number;
        finish: () => void;
      } | null = null;

      const endWarmUp = () => {
        const w = warm;
        if (!w) return;
        warm = null;
        warmed = true;
        w.finish();
      };

      const warmUp = (): Promise<void> =>
        new Promise((resolve) => {
          if (!player || warmed || warm) return resolve();
          const p = player;
          const timer = window.setTimeout(() => {
            // Never started: leave it paused, sound on; it can still play when asked.
            if (!warm) return;
            const keep = warm.wantPlay;
            warm = null;
            p.unMute();
            if (!keep) p.pauseVideo();
            resolve();
          }, WARM_TIMEOUT_MS);
          warm = {
            stage: 'starting',
            wantPlay: false,
            from: p.getCurrentTime() || startSeconds || 0,
            finish: () => {
              clearTimeout(timer);
              resolve();
            },
          };
          p.mute();
          p.playVideo();
        });

      const controller: YouTubePlayerController = {
        play() {
          if (warm) {
            // Taken up when the warm-up's playback starts (or stops).
            warm.wantPlay = true;
            return;
          }
          if (isReady && player) {
            // Playing for real: no warm-up needed (or wanted) after this.
            warmed = true;
            player.playVideo();
          }
        },
        pause() {
          if (warm) {
            warm.wantPlay = false;
            return;
          }
          if (isReady && player) {
            player.pauseVideo();
          }
        },
        seekTo(seconds: number) {
          // Warming up: it goes back here once it has stopped.
          if (warm) warm.from = seconds;
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
          endWarmUp();
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
                queueWarmUp(warmUp);
              } catch (error) {
                onError(trackId, {
                  code: 'METADATA_ERROR',
                  message: 'Failed to load video metadata',
                });
              }
            },
            onStateChange(event) {
              const state = event.data;

              // Warming up: the page hears nothing of it, unless asked to play meanwhile.
              if (warm) {
                const p = event.target;
                if (state === YT.PlayerState.PLAYING && warm.stage === 'starting') {
                  if (warm.wantPlay) {
                    p.unMute();
                    endWarmUp();
                    onState(trackId, 'playing');
                  } else {
                    warm.stage = 'stopping';
                    p.pauseVideo();
                  }
                } else if (state === YT.PlayerState.PAUSED && warm.stage === 'stopping') {
                  const w = warm;
                  p.seekTo(w.from, true);
                  p.unMute();
                  endWarmUp();
                  // Asked to play while it stopped: start for real now.
                  if (w.wantPlay) p.playVideo();
                }
                return;
              }

              if (state === YT.PlayerState.PLAYING) {
                warmed = true;
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

