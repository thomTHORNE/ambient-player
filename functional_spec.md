Here is the PDF converted into Markdown:

---

### Functional Specification - YouTube Multi-Track Audio Player

---

#### 1. Overview

A single-page, dark-mode, pure front-end application that:

- Accepts full YouTube URLs from the user.
- Creates an audio-style player for each URL (video visually hidden).
- Allows independent control of each track (play/pause, seek, volume, loop).
- Supports global Play/Pause across all tracks.
- Manages named playlists persisted in `localStorage` (URLs only).
- Supports shareable URLs that encode a playlist and can be replaced or appended to the current playlist.
- Uses TypeScript, no backend, no build tools, and handcrafted HTML/CSS/JS (TS compiled to JS).

---

#### 2. Initial State

On first load:

- Page shows:
  - A YouTube URL input (placeholder: `Paste full YouTube URL`).
  - An **Add to playlist** button.
  - An inline error message area near the input (empty initially).
  - A Global Play/Pause button (initially labelled **Play All**).
  - An empty playlist area (no tracks).
  - A playlist management section:
    - Text field for **Playlist name**.
    - **Save / Update playlist** button.
    - List of saved playlists (empty initially).
- Visual design: dark background, Inter font (applied via CSS in the actual app), minimal layout.
- If a previously saved **last used playlist** exists in `localStorage`, it is loaded automatically (see section 6).

---

#### 3. Adding a Track

##### 3.1 Input and Validation

- User enters text in the URL input and clicks **Add to playlist**.
- The app runs basic validation:
  - Accepts only full YouTube URLs, e.g. `https://www.youtube.com/watch?v=VIDEO_ID`.
  - Rejects clearly invalid patterns and non-YouTube URLs.
- If validation fails:
  - Do not create a new track.
  - Show inline error text near the input:  
    `No video found for the provided URL.`

##### 3.2 Track Creation and Loading

If validation passes:

1. **Create track entry:**
   - Extract the YouTube `videoId` from the URL.
   - Create a new logical track in a `loading` state.
   - Append a placeholder track row to the bottom of the track list.

2. **Instantiate player:**
   - Create a hidden YouTube IFrame player (via IFrame API) for this `videoId`.
   - While loading, show a `Loading...` label or spinner in the track row instead of full controls.

3. **On successful load:**
   - Retrieve video metadata: title, thumbnail URL, and duration (if available).
   - Update the track row to show: thumbnail, title, and full controls (play/pause, seek, time, volume, loop, delete).
   - Set track to `state = paused` and `currentTime = 0`.

4. **On load failure** (invalid/blocked video, API error, embedding disabled):
   - Put the track row into an error state.
   - Show a descriptive error message, e.g.  
     `Cannot load this video (embedding disabled).`
   - Disable playback controls; leave **Delete** available.

---

#### 4. Per-Track UI and Behavior

Each track row includes:

1. **Thumbnail**
   - Small image representing the video.
   - Typically left-aligned in the row.

2. **Title**
   - Single-line or truncated with ellipsis.

3. **Controls**

   - **Play/Pause button**
     - If track is paused/idle: label **Play**, clicking starts playback for that track only.
     - If track is playing: label **Pause**, clicking pauses that track only.

   - **Seek bar**
     - Horizontal slider showing 0–100% of the track duration.
     - Dragging and releasing seeks to corresponding time.

   - **Time display**
     - Format: `mm:ss / mm:ss` (e.g. `01:23 / 05:12`).

   - **Volume slider**
     - Range `0.0–1.0` (or 0–100 mapped internally).
     - Affects only this track.

   - **Loop toggle**
     - Boolean control labelled **Loop** (or with an icon).
     - Default: **OFF**.
     - When **ON**: at end, the track automatically seeks to `0` and plays again.
     - When **OFF**: track stops at the end (paused at full progress).
     - Loop flag is **not persisted** to `localStorage`.

   - **Delete button**
     - Removes this track row and destroys its player.
     - If playing, playback stops before removal.
     - No effect on other tracks.

4. **Error message area**
   - For tracks in error state: displays descriptive message and disables controls (except **Delete**).
   - For normal tracks: empty or hidden.

---

#### 5. Global Play/Pause

A global control appears above the playlist:

- **Label logic:**
  - If at least one track is playing: label is **Pause All**.
  - If no tracks are playing: label is **Play All**.
- **Click behavior:**
  - **Play All:** calls `play()` on each non-error track.
  - **Pause All:** calls `pause()` on each currently playing track.
- The app never forces a single-track-only mode; overlapping audio is allowed.

---

#### 6. Playlist Persistence (`localStorage`)

Playlists are named collections of URLs stored in `localStorage`. Only URLs are persisted.

##### 6.1 Data Model

- Each playlist has:
  - A **name** (`string`).
  - An **ordered list** of YouTube URLs.
- The **current playlist** is defined by the tracks currently in the main list.

##### 6.2 Saving / Updating Playlists

- The playlist UI section includes:
  - Input: **Playlist name**.
  - Button: **Save / Update playlist**.

- **First save (new name):**
  - Collect all current track URLs in order.
  - Store them in `localStorage` under that name.
  - Mark this playlist as **last used**.

- **Update existing (same name):**
  - Overwrite that playlist's URL list with the current track URLs.
  - Keep the name and mark as **last used**.

##### 6.3 Deleting Saved Playlists

- Each saved playlist row shows:
  - The playlist name.
  - A **Load** button.
  - A **Delete** button.

- Clicking **Delete**:
  - Removes that playlist from `localStorage`.
  - Removes it from the saved playlists list UI.
  - Does not immediately change the current tracks (unless the user separately clears them).

##### 6.4 Auto-Restoring the Last Playlist

- On startup, the app reads `lastPlaylistName` from `localStorage`.
- If found and valid:
  - Loads its URLs as the current tracks (all paused at `0:00`).
- If not found: start with an empty playlist.

---

#### 7. Loading and Managing Saved Playlists

- Saved playlists are listed in a dedicated section.
- When the user clicks **Load** on a saved playlist:
  - If there are **no** current tracks: load the saved URLs directly as tracks.
  - If there **are** current tracks:
    - Show a prompt: **Replace current playlist** or **Append?**
    - **Replace:** clear current tracks and load only the saved playlist.
    - **Append:** keep current tracks and add saved tracks after them.

---

#### 8. Shareable URLs

The application supports shareable/bookmarkable URLs that encode a playlist.

- From the current playlist, a URL can be generated that encodes the list of URLs as a hash (e.g. `#pl=...`) or query parameter.
- When the app opens with such a URL:
  - It decodes the URLs from the hash/query.
  - If there are no current tracks: load decoded tracks immediately.
  - If there are current tracks: prompt **Replace** vs **Append**, with the same semantics as with saved playlists.

---

#### 9. Error States and Messages

- **Invalid URL syntax** (not recognized as a full YouTube URL):
  - Show input error: `No video found for the provided URL.`
  - Do not add a track row.

- **Valid URL but video load fails** (private, removed, embedding blocked):
  - Create a track row in error state.
  - Show an appropriate message, e.g.  
    `Cannot load this video (embedding disabled).`
  - Disable playback controls; keep **Delete** enabled.

---

#### 10. Non-Goals and Constraints

- No backend; no server-side components.
- No build tools at runtime (TS compiled to JS ahead of time).
- No analytics or logging requirements.
- No internationalization; English only.
- No formal accessibility targets (beyond basic semantics).
- No ToS/licensing compliance work for this personal project.

---