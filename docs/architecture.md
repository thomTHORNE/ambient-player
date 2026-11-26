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
- **Cache busting.** `bundle.js` then stamps every local stylesheet
  (`styles.css?v=<hash>`, `skins/xp.css?v=<hash>`) and `app.js?v=<hash>`
  into `index.html`, so a new deploy never pairs fresh HTML
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
| `crt.ts` | The screen effect: renders the artwork and thumbnails as phosphor cells on a canvas. |
| `backdrop.ts` | The backdrop: blurs and grades the artwork once onto a small canvas, and steps the drift at 10 frames a second (see Backdrop cost). |
| `screenFx.ts` | The Screen effect panel: style dial, Mix and fine-tune, saved on the device. |
| `commands.ts` | The command layer: every change to playback or the mix as a `Command`, applied through `dispatch()`. |
| `pairing.ts` | This device's ID and name, the room it's paired into, the relay's address and its HTTP calls, pairing links. |
| `remote.ts` | The WebSocket to the paired room: `hello`, the device list, heartbeat, reconnecting. |
| `devices.ts` | The Devices section: connect (code and QR code), join, the device list, rename, unpair, forget all. |
| `qr.ts` | A small QR code encoder (byte mode, level M, versions 1–10), drawn as SVG. |
| `screen.ts` | Fullscreen (with the WebKit fallback), installed-app detection and the screen wake lock. |
| `scale.ts` | The UI scale setting: reads, applies and stores it. |
| `layoutPref.ts` | The Layout setting (Auto or Stacked), kept per screen. |
| `resize.ts` | The divider that resizes the artwork column on large screens with a mouse. |
| `storage.ts` | Saved mixes in `localStorage` under `yt_audio_playlists`. |
| `skin.ts` | Skins: the list of skins, the Skins tab, applying and saving the choice on this device, and `ambient:skin-change`. |
| `tabs.ts` | Tabs: the Settings page's tab list, one section at a time, keyboard, the chosen tab kept per device; tab panel semantics only while the sections sit with their tab list. |
| `skinLayout.ts` | The window layout for skins that arrange the page themselves (Windows XP): moves the panels into the window and back, the task pane's collapsible groups, and the Mix tasks links. |
| `shareLinks.ts` | Encodes a mix's URLs into `#pl=<base64url JSON>`, reads it back from the page URL, and finds a mix in pasted text for Import. |

## State and rendering

`main.ts` keeps a small amount of state:

| Piece | What it holds |
| --- | --- |
| `playlistManager` | The tracks: URL, video ID, metadata, state (`loading`, `playing`, `paused`, `error`), time, duration, volume, loop, and `selected` (ticked for Resume). |
| `focusedId` | The channel on the main display; the deck acts on it. |
| `mixName` | The saved mix's name, if any. |
| `openDrawers` | Which channel rows have their settings drawer open. |

**Commands.** Nothing in the interface calls the players directly.

- **dispatch():** every change to playback or the mix goes through
  `dispatch()` in `commands.ts` as a `Command`. The commands are play, pause,
  play all, pause all, resume, select (tick for Resume), focus, step, seek,
  stop, volume, repeat, add, remove, change link and load mix.
- **Where they run:** `runCommand()` in `main.ts` applies them on this
  device. Remote control will add a route that sends them to the main device
  instead (see `docs/remote-control-plan.md`).
- **Self-contained:** commands are plain JSON and carry the value to apply,
  never a toggle ("pause this channel", not "toggle it"), so they mean the
  same on another device.
- **Not commands:** purely local actions, such as a row's drawer, the remove
  confirmation, saving mixes on this device, share links, and the layout,
  scale and screen settings.

**Resume.** Each track's `selected` flag is what Resume plays (the
section "Resume: the channels played last" in `main.ts`):

- **Following playback:** a channel that starts playing is ticked (in
  `onTrackState`, so autoplay and handovers count too). A `play` command
  while nothing plays unticks the rest; a `pause` or `stop` while other
  channels play unticks that one. Pause all changes nothing, so the ticks
  are exactly what was playing.
- **Order:** `sortSelectedFirst()` moves the ticked channels to the top,
  each group keeping its order. It runs on Pause all, Resume, loading a
  saved mix, and `visibilitychange` with nothing playing; never on a row
  tap. Only the device that plays sorts; remotes take the order from the
  snapshot.
- **Kept:** in the room snapshot (`selected` on each track), and as the
  saved mix's `resume` links on this device, written shortly after a change.

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

## Skins (`skin.ts`, `skins/`)

A skin is the whole look. All behaviour is shared; the stylesheet differs,
and a skin may also move panels into a layout of its own. Switching is
instant and never touches playback.

- **How one applies:** `html[data-skin]` names it (`modern` or `xp`), and
  `html[data-arrange]` how it lays the page out: `pages` (the base layout)
  or `window`.
  `styles.css` is the base and the Modern Warfare skin; `skins/xp.css` has
  every Windows XP rule, scoped to `[data-skin="xp"]`, so the base skin is
  never affected. Both stylesheets always load.
- **Before the first paint:** an inline script in `index.html` reads
  `ambient-player:skin` and sets `data-skin`; `setupSkinPanel()` then
  applies it again (also setting `meta[name="theme-color"]`) and ticks the
  radio button.
- **Changing it:** `applySkin()` sets the attribute and the theme colour,
  saves the choice (Modern, the default, removes the key) and fires
  `ambient:skin-change` on `window`. `layout.ts` re-measures the panels and
  snap sizes on it; `main.ts` repaints the thumbnails' screen effect and the
  layout readout.
- **Per device:** the skin is never in the room snapshot, so remote control
  doesn't carry it; each device wears its own.
- **The window layout (`skinLayout.ts`):** with `data-arrange="window"`,
  the panels move into `#xpShell` (hidden in every other skin):
  - **Toolbar:** the deck's transport, the repeat switch and the volume.
  - **Main view:** the stage, with the timeline under Now playing and the
    thumbnails in `#xpPlaying`, then the channels panel.
  - **Task pane:** Mix tasks (static markup), then the saved mixes and mix
    status, and the Settings page's sections (devices, screen effect,
    layout, skins) as groups. Out of their tab list the sections show at
    once, and `tabs.ts` drops their tab panel semantics until they return.
  - **Moving back:** nodes are moved, never copied, so listeners and ids
    stay; a comment marks each one's place, and leaving the skin puts them
    back. `layout.ts` stands aside while arranged (no pages, merge moves or
    collapsing stage).
  - **Groups:** each gets a collapse button; collapsed groups are kept in
    `ambient-player:xp-groups`.
  - **Mix tasks:** links that mirror a button (label, hidden, disabled)
    and press it, or open a group and focus one of its fields.
- **Windows XP specifics:**
  - **Highlight colour:** `--accent` is forced to the XP selection blue
    (`!important` beats the artwork colour `main.ts` sets on `<html>`).
  - **Title and status bars from existing markup:** the brand row is the
    title bar; its status line (`.brand__sub`) is positioned as the status
    bar along the window's foot.
  - **Wide and narrow:** horizontal screens 860px and up get the toolbar on
    top, the task pane beside the main view, and the channel list scrolling
    on its own; everything else is one scrolling column.
  - **Skin-only markup:** `#xpShell` and its contents, `#xpPlaying`, and
    `.ch-head` (the list's column headings), all hidden in Modern; the
    status panel's heading is visible only there.
  - **Channels as a details view:** on panels at least 600px wide (a
    container query on `.channels`), each row's parts are laid out on the
    same grid columns as `.ch-head`.
  - **Icons:** from the kit's icon sheet, in `assets/skins/xp/icons` at 16
    and 32px (`image-set()` with a plain `url()` fallback).
- **Adding a skin:** add it to `SKINS` in `skin.ts`, a radio button to the
  Skins tab in `index.html`, the id to the inline script, and a
  stylesheet under `skins/` scoped to its `data-skin`, linked in
  `index.html`.

## Screen effect (`crt.ts`, `screenFx.ts`)

The cover art and the thumbnail strip are drawn as if on a CRT or LED wall.

**Rendering** (`paintCrt()`). The artwork is drawn into a canvas, device
pixel by device pixel:

1. **Sampling:** the picture is sampled into cells, one colour per cell, on
   a small canvas (with an optional defocus blur first).
2. **Grade:** each cell is desaturated, tinted towards a cold blue-grey, and
   adjusted for contrast and brightness.
3. **Phosphors:** each cell is a red, green and blue stripe. Each stripe is
   brightest in the middle and leaks some light (`--crt-bleed`) into its
   neighbours, which gives the colour fringe. Cells stack in columns with a
   dark gap, and every other column is offset by half a cell (a slot mask).
4. **Glow:** a blurred copy is screened over the result. CSS then softens
   the canvas slightly (`--crt-soft`).

**When it renders.** Only when the picture loads, the frame grows or changes
width, or a setting changes; never per frame.

- **Cover art:** `setupArtCrt()` keeps `#artCrt` over the picture. The canvas
  holds the whole picture at the size `object-fit: cover` gives it, and CSS
  gives it the picture's zoom (letterboxed or square art). So the two line
  up exactly, and the collapsing artwork only crops it.
- **Thumbnails:** `paintCrtThumbs()` renders the strip's canvases from a
  CORS copy of each thumbnail, cached by URL and size.

**Mix.** `--crt-mix` is the canvas's opacity over the plain picture, which
stays visible underneath. Changing it never re-renders.

**Settings.**

- **Where they live:** every setting is a `--crt-*` custom property. The
  defaults in `styles.css` are the Slot mask style.
- **How the panel applies them:** `screenFx.ts` sets the properties on
  `<html>` for the chosen style plus any fine-tuning, then fires
  `ambient:fx-change` to re-render.
- **Styles:** each style is a full set of values (`SCREEN_STYLES`). The dial
  turns through them in order.
- **Fine-tune:** a moved slider is kept as an override until the dial turns
  or the style is reset.
- **Saved:** in `localStorage` under `ambient-player:screen` as
  `{ style, mix, tuned }`.

## Pairing and the relay (remote control)

Remote control is being built in phases (`docs/remote-control-plan.md`).
Phases 1–4 are built: commands, pairing, controlling the main device from
a remote, and handover ("Play here") with failure handling.

**The relay** (`worker/`) is a Cloudflare Worker with two SQLite-backed
Durable Objects:

- **Room:** one per set of paired devices. It holds the connections, the
  device list, and a hash of the room secret.
- **Pairing:** holds pairing codes, which last 10 minutes and work once.

The routes and messages are listed in `worker/README.md`.

**Where it's configured.**

- **Address:** the app reads the relay's address from
  `<meta name="ambient-relay">` in `index.html`, currently
  `https://ambient-relay.tomica-trncic.workers.dev`. With no address, the
  Devices section says remote control isn't set up and nothing connects.
- **Development:** `?relay=http://127.0.0.1:8787` points one browser at a
  local relay. Only localhost addresses are accepted that way, so a link
  can't redirect a device to someone else's relay.

**Pairing.**

1. **Connect a device:** creates a room the first time. The relay returns a
   room ID and a long random secret, kept in `localStorage` under
   `ambient-player:room`.
2. **The code:** the device asks for a pairing code and shows it with a QR
   code of `…/#pair=<code>`.
3. **Joining:** the other device swaps the code for the room ID and secret.
   It does that from a typed code, from the link (on load or on
   `hashchange`), or from the link pasted into **Import**.
4. **What a link carries:** the code is single use and short lived; the
   secret itself is never in a link.

**The connection** (`remote.ts`).

- **Joining the room:** a paired device opens one WebSocket to its room and
  sends `hello` with its device ID, name and the secret. It gets `welcome`
  with the device list, then `devices` whenever someone joins, leaves,
  renames or disconnects.
- **Heartbeat:** a plain-text `ping` every 20 seconds, answered by the relay
  without waking the room.
- **Reconnecting:** after 1, 2, 5, 10, then every 30 seconds, and straight
  away when the page becomes visible or the network returns.
- **Unpaired elsewhere:** close code 4001 means **Forget all devices** was
  used on another device. This device then forgets the room and says so.

**Roles and sync** (`main.ts`, "Remote control: roles and sync").

| Role | When | What it does |
| --- | --- | --- |
| **Main** | The room's `mainId` is this device. | Plays. After every change it shares a snapshot of the mix (`buildRoomState()`: channels, states, times, volumes, repeat, focus, mix name), debounced to 150 ms, plus every 15 seconds while playing. Runs commands from remotes and answers them. |
| **Remote** | Another device is main and online. | Destroys its players and mirrors the snapshots (`applyRoomState()`). Playing channels' times move on locally between snapshots, using the snapshot's age (room clock offset). Every command goes to the main device (`setCommandRoute`). |
| **Idle** | No main device online (or not paired). | Plays on its own, as without pairing. Starting playback while paired and online claims main. |

- **Switching roles:**
  - **To remote:** the device destroys its players and shows the main
    device's mix.
  - **Back to idle:** when the main device goes offline, the device takes
    the mirrored mix over **paused**. Its players are created at each
    channel's last position, using the player's `start` (a seek would start
    playback).
- **Play here (handover):** the remote asks for main with `force`.
  1. **The old main device:** sends a final snapshot (what's playing, and
     where), pauses everything, and turns into a remote when the relay names
     the new main.
  2. **The new main device:** creates its players at those positions and
     starts the channels that were playing as soon as each is ready.

  Playback continues within a few seconds.
- **The main device going away:** the remote takes the mix over paused, and
  the badge offers **Play here**, which plays the channels that were playing
  there.
- **The relay going away:** the main device keeps playing. A remote waits 30
  seconds for the connection to come back, then takes the mix over the same
  way and shows **Disconnected · Play here**.
- **A sleeping main device:** a remote that hasn't had a snapshot for over 35
  seconds sends `probe` every 30 seconds. The relay then drops connections
  that stopped answering heartbeats, so a phone that went to sleep with its
  connection half open shows as offline.
- **Start-up restore stays local:** a device restores its own last mix on
  start only on itself, never as a command to the main device.
- **On a remote:** focus, previous and next, volume and seek respond at once,
  and the next snapshot confirms them. Volume and seek drags send at most
  about 10 messages a second, always including the final value.
- **Failed commands:** if the main device doesn't answer within 5 seconds,
  or a command fails there, the header badge shows why for a few seconds.
- **The header badge:**
  - **On a remote:** **Remote · Laptop**, with a **Play here** button.
  - **On the main device:** **Playing here · 1 remote**.
  - **When the main device has gone:** **Laptop offline** or
    **Disconnected**, with **Play here**.
  - **While a command or handover is on its way:** it pulses.
- **The Devices list:** marks the main device **Plays**.
- **Keep-awake:** off on a remote, since it plays nothing.

**This device** (`ambient-player:device`) has a random ID and a generated
name such as "Brave on Android", which can be renamed in the Devices
section.

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

## Backdrop cost (`backdrop.ts`)

The drift is the only thing that animates all the time, and every frame of
it redraws the whole screen, including each `backdrop-filter` panel over it.
Two things keep that cheap:

- **No CSS filter on the moving layer.** The artwork is blurred, desaturated
  and dimmed once, onto a canvas about 320px wide, when the picture or the
  window's size changes. A `filter: blur()` on the drifting element would be
  redone by the GPU on every frame, on a surface larger than the screen.
- **10 frames a second.** The CSS animation is paused and its clock is
  advanced every 100 ms. The keyframes and easing stay in `styles.css`.

Measured in headless Chromium at 1920×1080 with software GL, the GPU
process went from a full core (dropping frames) to about 70% of one. On a
real GPU both numbers are far smaller, but the ratio is what matters.

## Layout (`layout.ts` with `styles.css`)

The app shell (`.app`) is fixed to the viewport, and the page itself never
scrolls.

**Deciding the layout.** One place decides which layout applies and marks
it on `<html>`; the stylesheet and the panel code follow the marks, never
the screen directly.

- **Who sets them.** `decideLayout()` and `applyMerge()` in `layout.ts`,
  re-run on every resize, rotation and Layout change. The inline script in
  `index.html` sets the same marks before the first paint; keep its queries
  in sync with `layout.ts`.
- **The marks:**

| Mark | Meaning |
| --- | --- |
| `data-layout="stacked"` | The vertical layout: on upright screens, or wherever **Stacked** is chosen. |
| `data-layout="columns"` | The side-by-side layout: horizontal screens on **Auto**. |
| `data-layout-forced="true"` | Stacked chosen on a horizontal screen. |
| `data-merged="true"` | Columns, `(orientation: landscape) and (min-width: 960px) and (min-height: 680px)`: deck and channels share a panel. |
| `data-resizable="true"` | Columns, and the large-screen-with-mouse query: the artwork column can be resized. |

- **In CSS.** Rules for one layout are written as
  `:where(html[data-layout="columns"]) .art { … }`. `:where()` adds no
  specificity, so each rule ranks exactly as an unconditional one would,
  and source order works as it does for a media query. Size checks that
  still matter inside a layout (short screens, narrow screens, touch) stay
  as media queries.
- **The Layout setting** (`layoutPref.ts`).
  - **Choices:** **Auto** or **Stacked**.
  - **Where it's saved:** in `localStorage` under `ambient-player:layout`,
    as a map from the screen's physical size (`min×max` of
    `screen.width`/`screen.height`, so rotation doesn't change it) to the
    choice. A Fold's cover and inner displays have different sizes, so each
    keeps its own choice.
  - **Applying a change:** it fires `ambient:layout-choice`, and
    `layout.ts` re-lays out on that event.
- **Stacked on a horizontal screen.**
  - **Wide screens (700px and up):** the column is 600px wide and centred,
    with the pager beside it.
    - **How:** the scroller stays full width and pads its content into the
      column with `--stack-pad`, computed against the app's width (`.app` is
      an inline-size container here, so `100cqw`).
    - **The band:** the stage's gradient band cancels that padding with
      negative margins, so it spans the whole screen.
  - **Short screens:** if the collapsed stage would leave the panels under
    half the space, the collapse range also covers the title. The first
    swipe then leaves only a slim band of artwork. The title type is
    smaller at heights of 500px and under.

**Stacked (vertical) layout.**

- **One scroller.** `#scroller` scrolls everything: the stage (artwork,
  numbered strip, title) and the four pages below it.
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
  the scroll position; only a change of layout (rotation, the Layout
  setting) brings the same panel back into view.
- **Resting at the top.** Until the user first touches, scrolls or presses a
  key, the page stays at the top with the artwork at full size. Content
  arriving on load (fonts, the channel's title) moves the snap stops, and the
  browser would otherwise re-snap to the collapsed one. Re-measuring also
  keeps a page that was at the top there.

**Columns (side-by-side) layout.**

- **Grid.** `#scroller` becomes `display: contents`, and its children join
  the app grid: stage on the left, panels in the middle, pager on the right.
- **Paging.** The panels container (`#slides`) snaps vertically, one panel
  per screen, and each panel scrolls inside.

**Large horizontal screens.**

- **Merge.** In the columns layout at `(orientation: landscape) and
  (min-width: 960px) and (min-height: 680px)`, `applyMerge()` moves the
  channel list onto the deck's panel and sets `html[data-merged="true"]`.
  CSS then hides the empty channels panel and its pager bar, widens the
  stage column, and swaps the numbered strip for the thumbnail strip.
- **Keep in sync.** The same query appears in `layout.ts` (`mergeQuery`) and
  the inline script in `index.html`; keep them in sync.

**Pager and panel tracking.** The pager bars map to the visible panels.
`currentIndex()` works out the panel in view:

- **Stacked:** the last panel whose top has passed a line a third of the way
  down the space under the stage, or the last panel when scrolled to the end.
- **Columns:** the snapped page.

## Resizable artwork column (`resize.ts`)

**Where it applies.** Only in the columns layout on large horizontal screens
with a mouse or trackpad (`data-resizable`):

```
(orientation: landscape) and (min-width: 1280px) and (min-height: 680px)
  and (hover: hover) and (pointer: fine)
```

The query is in `layout.ts` and the inline script. Touch screens (the Fold,
tablets, phones) never match.

**Layout.** In this mode the app grid gains a fourth column for the divider
(`#stageSplitter`, as wide as the gutter, replacing the column gap):

```
"brand brand brand  brand"
"stage split slides pager"
```

**Width.**

- **The setting.** The artwork column's width comes from `--stage-pref` on
  `<html>`, a share of the grid's width such as `calc(0.42 * 100%)`. Without
  it, the column keeps the default `clamp(300px, 42vw, 600px)`.
- **Limits in CSS.** CSS clamps the column:
  - **narrowest:** 300px;
  - **widest:** `--stage-max`. That is the smaller of the width the 4:3
    artwork can use at the screen's height and the width that leaves the
    panels 560px.
- **Room under the artwork.** In this mode 350px is kept under the artwork
  (instead of 240px), so the title and one row of thumbnails always fit.

**Interaction.**

- **Dragging.** Pointer capture on the divider, one update per animation
  frame. The pointer position is converted to a share of the app's content
  box. Positions are measured in viewport pixels, with the app's padding
  scaled by the desktop UI zoom, so the divider follows the pointer at any
  UI scale.
- **Keyboard.** The arrow keys move it by 2% of the width; Home and End go
  to the narrowest and widest.
- **Reset.** A double-click removes the setting.
- **Saving.** After each change the width as laid out (after clamping) is
  saved under `ambient-player:stage-width`. The inline script in
  `index.html` applies it before the first paint.

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
| `localStorage["yt_audio_playlists"]` | `{ playlists: [{ name, urls[], resume?[] }], lastPlaylistName? }`. Saving a mix makes it the last one; it reopens on the next visit. An unsaved mix is not kept. `resume` holds the links ticked for Resume; it is updated by itself while that mix is open, and the ticked channels open at the top. Mixes saved before Resume have none. |
| `localStorage["ambient-player:ui-scale"]` | The UI scale (0.7–1.3), removed at 100%. |
| `localStorage["ambient-player:layout"]` | The Layout setting per screen: `{ "<min>x<max>": "stacked" }`. Auto removes the screen's entry. |
| `localStorage["ambient-player:room"]` | The paired room: `{ roomId, secret }`. |
| `localStorage["ambient-player:device"]` | This device: `{ id, name }`. |
| `localStorage["ambient-player:relay"]` | Development only: a localhost relay address set with `?relay=`. |
| `localStorage["ambient-player:screen"]` | The screen effect: `{ style, mix, tuned }` (style name, 0–1, overridden `--crt-*` values). |
| `localStorage["ambient-player:skin"]` | The skin on this device: `xp`. Removed for Modern Warfare, the default. |
| `localStorage["ambient-player:tabs:settings"]` | The Settings tab last opened on this device (its tab's id). |
| `localStorage["ambient-player:xp-groups"]` | Windows XP's task pane: which groups are collapsed, `{ "<heading id>": true }`. Screen effect starts collapsed. |
| `localStorage["ambient-player:stage-width"]` | The artwork column's share of the width on large screens with a mouse; removed on reset. |
| Share link | `#pl=` followed by the mix's URL list as base64url-encoded JSON. On boot a share link loads in place of the last saved mix, and the hash is cleared. **Import** (Saved mixes panel) reads the same payload from pasted text with `decodePlaylistFromText()`. With no share link in the text, it takes any YouTube links it finds instead. It then loads them like a saved mix. |

## Page flags

Attributes on `<html>` that CSS keys off:

| Attribute | Set by | Meaning |
| --- | --- | --- |
| `data-empty` | `renderChannels()` | No channels yet. |
| `data-layout` | `decideLayout()`, inline script | `stacked` (vertical) or `columns` (side by side). |
| `data-layout-forced` | `decideLayout()`, inline script | Stacked chosen on a horizontal screen. |
| `data-merged` | `applyMerge()`, inline script | Large-screen layout: deck and channels on one panel. |
| `data-resizable` | `decideLayout()`, inline script | The artwork column can be resized. |
| `data-fullscreen` | `setupScreenTakeover()` | Fullscreen or the installed fullscreen app. |
| `class="is-zoomed"`, `--ui-zoom` | `scale.ts` | Desktop UI scale in effect. |
| `--stage-pref` | `resize.ts`, inline script | The chosen artwork column width. |
| `class="is-resizing"` | `resize.ts` | The divider is being dragged: resize cursor everywhere, no text selection. |

Other state hooks:

| Element | Attribute or class | Meaning |
| --- | --- | --- |
| `#art` | `data-state` | Empty, loading or error artwork. |
| `#stage` | `data-shape` | `square` or `wide` artwork. |
| `.stage-wrap` | `.is-collapsed` | The stage is fully collapsed. |
| Rows and tiles | `.is-<state>`, `.is-focus` | The channel's state; the channel on the main display. |
