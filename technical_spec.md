undefinedundefinedHere is the PDF converted into Markdown:

---

### Technical Specification - YouTube Multi-Track Audio Player

---

#### 1. Overview

- **Architecture:** Single Page Application (SPA) with pure front-end logic.  
- **Assets:** Static files only: `index.html`, `styles.css`, and compiled JS from TypeScript.  
- **Technologies:**
  - TypeScript for all application code (strict typing, interfaces).
  - No backend or external services beyond the YouTube IFrame API.
  - No build tools at runtime; TS compiled to JS ahead of deployment.
  - Handcrafted HTML and CSS with a dark theme and Inter font.

---

#### 2. File and Module Structure

Suggested logical structure (can be merged or refined as needed):

- `index.html`
  - HTML skeleton and main UI containers.
  - Links `styles.css`.
  - Loads `main.js` via `<script type="module">`.
  - Includes YouTube IFrame API script.

- `styles.css`
  - Dark theme styles, layout for header, playlist, and controls.
  - Visual hiding styles for the YouTube iframe that preserve functionality.

- `main.ts`
  - Application entry point and bootstrap logic.
  - Initializes `PlaylistManager`, YouTube API wrapper, UI, persistence, and URL parsing.

- `playlist.ts`
  - TypeScript types for tracks and playlist state.
  - `PlaylistManager` class to manage in-memory tracks and controllers.

- `youtubePlayer.ts`
  - Wrapper around YouTube IFrame API.
  - Handles player creation, event mapping, and metadata extraction.

- `storage.ts`
  - `localStorage` read/write helpers for playlists and last used playlist.

- `shareLinks.ts`
  - Encode/decode playlist URLs to/from the `p1` URL parameter.

- `ui.ts`
  - DOM operations and event handlers for tracks, global controls, and playlist management.

---

#### 3. Core TypeScript Types and Interfaces

```ts
type TrackId = string;

interface YouTubeVideoMeta {
  id: string; // YouTube video ID
  title: string;
  thumbnailUrl: string;
  durationSeconds?: number;
}

type TrackState = 'loading' | 'playing' | 'paused' | 'error';

interface TrackError {
  code: string; // e.g. 'EMBED_BLOCKED', 'NOT_FOUND', 'API_ERROR'
  message: string;
}

interface Track {
  id: TrackId;
  url: string; // Full YouTube URL
  videoId: string;
  meta?: YouTubeVideoMeta;
  state: TrackState;
  error?: TrackError;
  currentTime: number; // seconds
  duration?: number; // seconds (optional until known)
  volume: number; // 0.0-1.0
  isMuted: boolean;
  loop: boolean; // not persisted
}

interface PlaylistState {
  tracks: Track[];
}

interface PersistedPlaylist {
  name: string;
  urls: string[]; // ordered list of full URLs
}

interface StoredData {
  playlists: PersistedPlaylist[];
  lastPlaylistName?: string;
}
```

---

#### 4. YouTube IFrame API Integration

##### 4.1 Script Inclusion

In `index.html`:

```html
<script src="https://www.youtube.com/iframe_api"></script>
```

The script defines a global `YT` object and invokes `window.onYouTubeIframeAPIReady()` when ready.

##### 4.2 Player Controller and Factory

```ts
interface YouTubePlayerController {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

type TrackStateListener = (trackId: TrackId, state: TrackState) => void;
type TrackMetaListener = (trackId: TrackId, meta: YouTubeVideoMeta) => void;
type TrackErrorListener = (trackId: TrackId, error: TrackError) => void;

interface YouTubePlayerFactory {
  createPlayer(
    trackId: TrackId,
    containerElement: HTMLElement,
    videoId: string,
    onMeta: TrackMetaListener,
    onState: TrackStateListener,
    onError: TrackErrorListener
  ): YouTubePlayerController;
}
```

##### 4.3 Implementation Notes

- **Container element:**
  - A `div` per track, used as host for the YouTube iframe.
  - Styled to be visually hidden but still present in layout (avoid `display: none`).

- **`createPlayer`:**
  - Uses `new YT.Player(containerElement, { videoId, ... })`.
  - On `onReady`:
    - Reads metadata via `player.getVideoData()`.
    - Computes thumbnail URL via `https://img.youtube.com/vi/<id>/hqdefault.jpg`.
    - Reads duration via `player.getDuration()`.
    - Calls `onMeta` and sets initial state to `'paused'`.
  - On `onStateChange`:
    - Maps YouTube states to `TrackState` (`PLAYING`, `PAUSED`, `ENDED`).
    - On `ENDED`, checks `loop` flag externally and either restarts or remains paused.
  - On error: calls `onError` with appropriate `TrackError`.

---

#### 5. PlaylistManager

`playlist.ts` implements a manager for tracks and their controllers.

```ts
class PlaylistManager {
  private state: PlaylistState = { tracks: [] };
  private controllers = new Map<TrackId, YouTubePlayerController>();

  addTrack(url: string, videoId: string): Track {
    const track: Track = {
      id: crypto.randomUUID(),
      url,
      videoId,
      state: 'loading',
      currentTime: 0,
      volume: 1,
      isMuted: false,
      loop: false,
    };
    this.state.tracks.push(track);
    return track;
  }

  updateTrack(id: TrackId, partial: Partial<Track>): void {
    const track = this.state.tracks.find(t => t.id === id);
    if (!track) return;
    Object.assign(track, partial);
  }

  removeTrack(id: TrackId): void {
    this.state.tracks = this.state.tracks.filter(t => t.id !== id);
    const controller = this.controllers.get(id);
    if (controller) {
      controller.destroy();
      this.controllers.delete(id);
    }
  }

  getTracks(): ReadonlyArray<Track> {
    return this.state.tracks;
  }

  setController(id: TrackId, controller: YouTubePlayerController): void {
    this.controllers.set(id, controller);
  }

  getController(id: TrackId): YouTubePlayerController | undefined {
    return this.controllers.get(id);
  }
}
```

---

#### 6. Time, Progress, and Loop Handling

- **Time updates:**
  - Use polling with `setInterval` (e.g. every 250 ms) while at least one track is `'playing'`.
  - For each playing track, call `controller.getCurrentTime()` and `getDuration()` if unknown.
  - Update `track.currentTime` and `track.duration`, then refresh UI.

- **Seeking:**
  - On seek bar change, compute target time from percentage and known duration.
  - Call `controller.seekTo(targetSeconds)` and update `track.currentTime`.

- **Loop:**
  - Track's `loop` boolean toggled via UI (not persisted).
  - On `ENDED` state from YouTube:
    - If `loop === true`: `seekTo(0)` and `play()`.
    - If `false`: keep at end in `'paused'` state.

- **Global Play/Pause:**
  - **Play All:** calls `play()` on all non-error tracks.
  - **Pause All:** calls `pause()` on all tracks currently playing.

---

#### 7. localStorage Persistence

##### 7.1 Storage Key and Helpers

```ts
const STORAGE_KEY = 'yt_audio_playlists';

function loadStoredData(): StoredData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { playlists: [] };
  try {
    return JSON.parse(raw) as StoredData;
  } catch {
    return { playlists: [] };
  }
}

function saveStoredData(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
```

##### 7.2 Playlist CRUD Operations

```ts
function saveOrUpdatePlaylist(name: string, urls: string[]): void {
  const data = loadStoredData();
  const existing = data.playlists.find(p => p.name === name);
  if (existing) {
    existing.urls = urls;
  } else {
    data.playlists.push({ name, urls });
  }
  data.lastPlaylistName = name;
  saveStoredData(data);
}

function deletePlaylist(name: string): void {
  const data = loadStoredData();
  data.playlists = data.playlists.filter(p => p.name !== name);
  if (data.lastPlaylistName === name) {
    delete data.lastPlaylistName;
  }
  saveStoredData(data);
}

function getLastPlaylist(): PersistedPlaylist | undefined {
  const data = loadStoredData();
  if (!data.lastPlaylistName) return;
  return data.playlists.find(p => p.name === data.lastPlaylistName);
}

function getAllPlaylists(): PersistedPlaylist[] {
  return loadStoredData().playlists;
}
```

##### 7.3 Initialization Logic

- On startup:
  - Read `playlists` and `lastPlaylistName` from `localStorage`.
  - If a last playlist exists:
    - Load its URLs as tracks (paused at `0:00`).

---

#### 8. Shareable Playlist URLs

##### 8.1 Encoding

```ts
function encodePlaylistToUrl(urls: string[]): string {
  const json = JSON.stringify(urls);
  const base64 = btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const url = new URL(window.location.href);
  url.hash = `pl=${base64}`;
  return url.toString();
}
```

##### 8.2 Decoding on Load

```ts
function decodePlaylistFromLocation(): string[] | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#pl=')) return null;
  const base64 = hash.slice(4)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  try {
    const json = atob(base64);
    const urls = JSON.parse(json);
    if (!Array.isArray(urls)) return null;
    return urls as string[];
  } catch {
    return null;
  }
}
```

##### 8.3 Replace vs Append Flow

- On startup, after decoding the `pl` parameter:
  - If no existing tracks: load decoded URLs directly.
  - If tracks exist: show a prompt:
    - **Replace:** clear current tracks and load decoded URLs.
    - **Append:** keep current tracks and add decoded URLs after them.

---

#### 9. UI Structure and Event Binding

##### 9.1 HTML Skeleton (Simplified)

```html
<body class="dark">
  <main class="app">
    <header class="app-header">
      <h1>YouTube Audio Playlist</h1>
      <div class="input-group">
        <input id="urlInput" type="text" placeholder="Paste full YouTube URL" />
        <button id="addButton">Add to playlist</button>
      </div>
      <p id="inputError" class="error-message" aria-live="polite"></p>
      <div class="global-controls">
        <button id="globalPlayPause">Play All</button>
      </div>
    </header>

    <section class="playlists-section">
      <div class="playlist-save">
        <input id="playlistNameInput" type="text" placeholder="Playlist name" />
        <button id="savePlaylistButton">Save / Update playlist</button>
      </div>
      <ul id="savedPlaylistsList" class="saved-playlists"></ul>
    </section>

    <section id="playlist" class="playlist"></section>
  </main>

  <script type="module" src="main.js"></script>
</body>
```

##### 9.2 Track Row Structure

```html
<div class="track" data-track-id=".">
  <img src="track-thumbnail.png" alt="Track thumbnail" />
  <div class="track-main">
    <div class="track-title">Video title</div>
    <div class="track-controls">
      <button class="track-play-pause">Play</button>
      <input type="range" class="track-seek" min="0" max="100" value="0" />
      <span class="track-time">0:00 / 0:00</span>
      <input
        type="range"
        class="track-volume"
        min="0"
        max="1"
        step="0.01"
        value="1"
      />
      <button class="track-loop-toggle">Loop OFF</button>
      <button class="track-delete">Delete</button>
    </div>
    <p class="track-error-message"></p>
  </div>
  <div class="track-player-container"></div>
</div>
```

##### 9.3 Event Binding

- Use event delegation for playlist and saved playlist lists.
- Main handlers:
  - **Add to playlist:**
    - Validate URL.
    - Extract video ID.
    - Create track via `PlaylistManager`.
    - Initialize YouTube player via `YouTubePlayerFactory`.
  - **Per-track controls** (play/pause, seek, volume, loop, delete).
  - **Global Play/Pause** toggles all applicable tracks.
  - **Playlist save/update** extracts current URLs and calls `saveOrUpdatePlaylist`.
  - **Saved playlists:**
    - Load with Replace/Append choice.
    - Delete removes from storage and list.

---

#### 10. Styling and Dark Theme

- Dark background and light text (e.g. `#111` background, `#eee` text).
- Inter font (loaded via CSS or external font provider).
- Card-like track rows with subtle borders or shadows.
- Hidden iframe in `.track-player-container`:
  - Zero height with overflow hidden, or positioned off-screen.

---

#### 11. Non-Functional Considerations

- Performance: acceptable for personal use; no enforced track limit.
- Browser Support: modern browsers supporting ES modules, `localStorage`, and `crypto.randomUUID()` (or fallback).
- No analytics/logging requirements.
- No i18n; English-only.
- No formal accessibility targets beyond basic semantics.

---