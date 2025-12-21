# YouTube Audio Playlist

A single-page, dark-mode, pure front-end application for playing multiple YouTube videos as audio tracks simultaneously.

## Features

- **Multi-track playback**: Add multiple YouTube videos and control each independently
- **Audio-style controls**: Play/pause, seek, volume, and loop for each track
- **Global controls**: Play or pause all tracks at once
- **Playlist management**: Save, load, and delete named playlists (stored in localStorage)
- **Shareable URLs**: Generate shareable links that encode your current playlist
- **Dark theme**: Easy on the eyes with a modern dark interface
- **No backend required**: Pure front-end application using only the YouTube IFrame API

## Getting Started

### Prerequisites

- Node.js and npm (for TypeScript compilation)
- A modern web browser
- Python 3 (for the development server, or use any other HTTP server)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd yt-player
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile TypeScript to JavaScript:
   ```bash
   npm run build
   ```

### Running the Application

You have **two options**:

#### Option 1: Standalone (No Server Required) ⭐ Recommended

Simply open `index-standalone.html` directly in your browser:
- **macOS**: `open index-standalone.html`
- **Windows**: Double-click `index-standalone.html`
- **Linux**: `xdg-open index-standalone.html`

This uses the bundled `app.js` file and works without any server!

#### Option 2: With Development Server

If you prefer using ES modules (for development):

1. Start a local web server:
   ```bash
   npm run serve
   ```

2. Open your browser and navigate to `http://localhost:8000`

### Development

To automatically recompile TypeScript files on changes:
```bash
npm run watch
```

After making changes, rebuild the bundled version:
```bash
npm run build
```

Or just rebuild the bundle (if TypeScript is already compiled):
```bash
npm run bundle
```

## Usage

### Adding Tracks

1. Paste a full YouTube URL (e.g., `https://www.youtube.com/watch?v=VIDEO_ID`) into the input field
2. Click "Add to playlist"
3. The video will load as an audio track with controls

### Track Controls

Each track has the following controls:
- **Play/Pause**: Start or stop playback for this track
- **Seek bar**: Drag to jump to a specific time
- **Time display**: Shows current time and total duration
- **Volume slider**: Adjust volume for this track (0-100%)
- **Loop toggle**: Enable/disable looping for this track
- **Delete**: Remove the track from the playlist

### Global Controls

- **Play All / Pause All**: Control all tracks at once
- **Share Playlist**: Copy a shareable URL to your clipboard

### Saving Playlists

1. Add tracks to your current playlist
2. Enter a name in the "Playlist name" field
3. Click "Save / Update playlist"
4. Your playlist will be saved to localStorage

### Loading Playlists

1. Click "Load" next to a saved playlist
2. If you have tracks in the current playlist, you'll be prompted to:
   - **Replace**: Clear current tracks and load the saved playlist
   - **Append**: Keep current tracks and add saved tracks after them
   - **Cancel**: Don't load the playlist

### Sharing Playlists

1. Click "Share Playlist" to copy a shareable URL
2. Share the URL with others
3. When they open the URL, they'll be prompted to load your playlist

## Technical Details

- **TypeScript**: Strict typing for all application code
- **No build tools at runtime**: TypeScript compiled to ES2020 modules
- **YouTube IFrame API**: For video playback and control
- **localStorage**: For persisting playlists
- **Pure front-end**: No backend or server-side components

## Project Structure

```
yt-player/
├── index.html          # Main HTML file
├── styles.css          # Dark theme styles
├── src/                # TypeScript source files
│   ├── main.ts         # Application entry point
│   ├── playlist.ts     # Playlist manager and types
│   ├── youtubePlayer.ts # YouTube IFrame API wrapper
│   ├── storage.ts      # localStorage operations
│   ├── shareLinks.ts   # URL encoding/decoding
│   └── ui.ts           # DOM operations and UI helpers
├── dist/               # Compiled JavaScript files
├── tsconfig.json       # TypeScript configuration
└── package.json        # Project metadata and scripts
```

## Browser Support

Modern browsers supporting:
- ES2020 modules
- localStorage
- crypto.randomUUID() (or fallback)
- YouTube IFrame API

## License

This is a personal project. See LICENSE file for details.

## Acknowledgments

- Uses the YouTube IFrame Player API
- Inter font from Google Fonts