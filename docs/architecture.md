# Architecture

Ambient Player is a static single-page app. Everything runs in the browser;
the only outside services are the YouTube IFrame API (playback, titles,
durations) and `img.youtube.com` (artwork).

## Build

```
src/*.ts ──tsc──▶ dist/*.js ──bundle.js──▶ app.js ◀── index.html (script tag)
```

- **`tsc`** compiles each module in `src/` to an ES module in `dist/`
  (strict mode, ES2020; `noUnusedLocals` and `noUnusedParameters` keep dead
  code out).
- **`bundle.js`** concatenates the modules in dependency order into a single
  IIFE, `app.js`, stripping the `import` / `export` lines.
  - **Shared scope.** All modules end up in one shared scope, so **top-level
    names must be unique across modules**. That's why `layout.ts` prefixes
    its element constants with `l` (`lScroller`, `lStage`, …).
  - **New modules.** Add a new module to the `files` list in `bundle.js`
    after the modules it depends on.
- **Cache busting.** `bundle.js` then stamps `styles.css?v=<hash>` and
  `app.js?v=<hash>` into `index.html`, so a new deploy never pairs fresh HTML
  with a cached stylesheet or script. GitHub Pages caches files for about 10
  minutes.
- **Committed output.** `app.js` and `index.html` are committed (GitHub Pages
  serves `main` as it is); `dist/` is ignored.

## Modules

| Module | Role |
| --- | --- |
| `main.ts` | The controller. Holds the app state, renders the stage, deck, channel list, strips and status, wires every event, runs the playback poll and boots the app. |
| `layout.ts` | Layout behaviour CSS can't do alone: the collapsing artwork on vertical screens, the pager, moving between panels, snap sizes, and merging the deck and channel list on large horizontal screens. |
| `ui.ts` | Pure helpers: HTML templates for channel rows, strip items and saved mixes, in-place row patches, time / dB formatting, icons, the replace-or-append dialog. |
| `playlist.ts` | The `Track` model and `PlaylistManager`, which owns the track list and each track's player controller. |
| `youtubePlayer.ts` | Wraps the YouTube IFrame API: waits for it to load, creates hidden players, reports state, metadata and errors through callbacks, and parses YouTube URLs. |
| `accent.ts` | Samples the artwork on a canvas for the accent colour, and detects square (album) art. |
| `screen.ts` | Fullscreen (with the WebKit fallback), installed-app detection and the screen wake lock. |
| `scale.ts` | The UI scale setting: reads, applies and stores it. |
| `storage.ts` | Saved mixes in `localStorage` under `yt_audio_playlists`. |
| `shareLinks.ts` | Encodes a mix's URLs into `#pl=<base64url JSON>` and reads it back. |

## State and rendering

`main.ts` keeps a small amount of state:

| Piece | What it holds |
| --- | --- |
| `playlistManager` | The tracks: URL, video ID, metadata, state (`loading`, `playing`, `paused`, `error`), time, duration, volume, loop. |
| `focusedId` | The channel on the main display; the deck acts on it. |
| `mixName` | The saved mix's name, if any. |
| `openDrawers` | Which channel rows have their settings drawer open. |

**Rendering.**

- **Full renders.** `renderChannels()`, `renderStatus()` and
  `renderStage()` rebuild their areas from the state.
- **In-place patches.** Frequent changes (time, play state) are patched with
  `patchChannelRow()`, so a slider drag or keyboard focus inside a row
  survives.
- **Strips.** `renderStrip()` rebuilds both strips (numbered and thumbnail)
  with only the channels that are playing. CSS shows one of them per layout.

**Playback loop.** While anything plays, `poll()` runs every 250 ms. It reads
the current time and duration from each playing player, fills in the channel
name once YouTube reports it, patches the rows and redraws the timeline. It
stops itself when nothing plays.

## Playback

- **Hidden players.** Each channel gets a hidden 1×1 YouTube player in
  `#playerBay`.
- **Callbacks.** `createYouTubePlayerFactory()` returns a factory whose
  players report through three callbacks:
  - **State:** `onTrackState` in `main.ts`, which also refreshes the strips
    when a channel starts or stops.
  - **Metadata:** the title and the `hqdefault` thumbnail.
  - **Errors:** an embedding refusal, a missing video, or the 10-second load
    timeout.
- **Controller.** Each player is driven through a `YouTubePlayerController`
  (play, pause, seek, volume, loop, time, duration, author), which the
  `PlaylistManager` stores next to its track.
- **Changing a channel's link.** `reloadTrack` keeps the channel's volume and
  repeat setting and replaces its player.

## Artwork and accent

- **Artwork images.** The main display loads `maxresdefault.jpg` (true 16:9).
  If that is missing (a 120×90 placeholder or an error), it falls back to
  `hqdefault.jpg`, which has letterbox bars and is zoomed to hide them
  (`.is-letterboxed`).
- **Accent.** When an image loads, `extractAccent()` samples it at 96×54 and
  picks the most prevalent vivid hue. It returns `null` when the image is too
  dark, too grey or has no hue that stands out. The hue is adjusted for 4.5:1
  contrast against the panels.
  - **Applied.** The result sets `--accent` on `<html>`, or `FALLBACK_ACCENT`
    (amber `#FFB24A`) on `null`. `--accent` is a registered `@property`, so
    it fades between channels.
- **Square art.** `isSquareArt()` detects album art published with bars at
  the sides; on horizontal screens it is zoomed to fill the 4:3 frame.
- **Cache.** Results are cached per image URL, so switching back to a channel
  doesn't sample again.

## Layout (`layout.ts` with `styles.css`)

The app shell (`.app`) is fixed to the viewport, and the page itself never
scrolls.

**Vertical screens (portrait).**

- **One scroller.** `#scroller` scrolls everything: the stage (artwork,
  numbered strip, title) and the three panels below it.
- **Collapsing stage.** The stage is `position: sticky` with a fixed height
  and a negative `top` equal to its collapse range, so the content under it
  never moves out of step. While scrolling through that range only two
  things change:
  - the artwork's height;
  - a `translate3d` on the stage that keeps the shrinking artwork at the top.

  The stage's size never depends on the thumbnail, so switching channels
  doesn't resize it. The upper part takes at most half of the space under
  the brand.
- **Paging.** Scrolling uses mandatory scroll snapping, so each swipe moves
  one panel, as on horizontal screens. `refreshLayout()` measures and sets
  three custom properties on `#scroller`:
  - `--pinned-h`: the height of the collapsed stage, used as
    `scroll-padding-top`;
  - `--page-h`: the space under it, the minimum height of each panel;
  - `--deck-snap`: the deck's extra stop with the artwork at full size
    (scroll position 0).

  A panel taller than the screen scrolls freely and also stops at its end
  (`scroll-snap-align: start end`). A 1px `scroll-padding-bottom` absorbs
  sub-pixel rounding so the last panel's end stays reachable.
- **Re-measuring.** A `ResizeObserver` on the scroller and the title block
  re-measures whenever the space changes. A plain window resize never moves
  the scroll position; only a rotation brings the same panel back into view.

**Horizontal screens (landscape).**

- **Grid.** `#scroller` becomes `display: contents`, and its children join
  the app grid: stage on the left, panels in the middle, pager on the right.
- **Paging.** The panels container (`#slides`) snaps vertically, one panel
  per screen, and each panel scrolls inside.

**Large horizontal screens.**

- **Merge.** At `(orientation: landscape) and (min-width: 960px) and
  (min-height: 680px)`, `applyMerge()` moves the channel list onto the
  deck's panel and sets `html[data-merged="true"]`. CSS then hides the empty
  channels panel and its pager bar, widens the stage column, and swaps the
  numbered strip for the thumbnail strip.
- **Keep in sync.** The same query appears in `layout.ts` (`mergeQuery`) and
  `styles.css`; keep them in sync.

**Pager and panel tracking.** The pager bars map to the visible panels.
`currentIndex()` works out the panel in view:

- **Portrait:** the last panel whose top has passed a line a third of the way
  down the space under the stage, or the last panel when scrolled to the end.
- **Landscape:** the snapped page.

## UI scale (`scale.ts`)

The scale is saved in `localStorage` under `ambient-player:ui-scale`. A small
inline script in `index.html` applies it before the first paint.

- **Touch devices (`pointer: coarse`).**
  - **Viewport.** It rewrites the viewport meta tag (`initial-scale`, with
    `minimum-scale` and `maximum-scale` pinned to it), so the layout sees
    more or fewer CSS pixels. At 85% a Fold's inner display can reach the
    large-screen layout.
  - **Side effect.** Pinch-zoom is off while the scale isn't 100%.
- **Desktop.** Browsers ignore the viewport tag there, so `.app` gets
  `zoom: var(--ui-zoom)` and is sized back up to fill the window
  (`html.is-zoomed`).

## Fullscreen and wake lock (`screen.ts`)

- **Entering fullscreen.** Browsers only allow it from a user gesture, so the
  first click anywhere, caught in the capture phase, enters fullscreen.
  - **Afterwards.** The tap still reaches its target. The header button
    leaves and re-enters fullscreen.
  - **Installed app.** In the installed app (`display: fullscreen` in the
    manifest) the button stays hidden.
- **Page flag.** `html[data-fullscreen]` marks the state. On an upright touch
  screen in fullscreen, CSS keeps at least 36px clear at the top for a
  punch-hole camera, since browsers don't always report the cutout in
  `env(safe-area-inset-top)`.
- **Wake lock.** A screen wake lock is held while a channel plays in
  fullscreen or in the installed app.

## Storage and sharing

| Store | Shape |
| --- | --- |
| `localStorage["yt_audio_playlists"]` | `{ playlists: [{ name, urls[] }], lastPlaylistName? }`. Saving a mix makes it the last one; it reopens on the next visit. An unsaved mix is not kept. |
| `localStorage["ambient-player:ui-scale"]` | The UI scale (0.7–1.3), removed at 100%. |
| Share link | `#pl=` followed by the mix's URL list as base64url-encoded JSON. On boot a share link loads in place of the last saved mix, and the hash is cleared. |

## Page flags

Attributes on `<html>` that CSS keys off:

| Attribute | Set by | Meaning |
| --- | --- | --- |
| `data-empty` | `renderChannels()` | No channels yet. |
| `data-merged` | `applyMerge()` | Large-screen layout: deck and channels on one panel. |
| `data-fullscreen` | `setupScreenTakeover()` | Fullscreen or the installed fullscreen app. |
| `class="is-zoomed"`, `--ui-zoom` | `scale.ts` | Desktop UI scale in effect. |

Other state hooks:

| Element | Attribute or class | Meaning |
| --- | --- | --- |
| `#art` | `data-state` | Empty, loading or error artwork. |
| `#stage` | `data-shape` | `square` or `wide` artwork. |
| `.stage-wrap` | `.is-collapsed` | The stage is fully collapsed. |
| Rows and tiles | `.is-<state>`, `.is-focus` | The channel's state; the channel on the main display. |
