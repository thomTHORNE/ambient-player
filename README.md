# Ambient Player

Mix several YouTube streams as audio at once: rain on a window, a fireplace,
distant thunder. Each YouTube link becomes a **channel** with its own volume
and repeat, and the mix can be saved on the device or shared as a link.

Live at **https://thomthorne.github.io/ambient-player/**

It is a static, front-end-only web app (TypeScript, HTML and CSS) with no
backend. Playback runs through hidden YouTube players (the YouTube IFrame
API); only the sound and the artwork are shown.

## Features

- **Pages.** Four, one swipe each (tap a pager bar to jump): **Deck**
  (transport, timeline with repeat, volume), **Channels**, **Library**
  (saved mixes, import, mix status and the share link) and **Settings**,
  whose tabs hold Devices, Screen effect, Skins and Layout (layout and UI
  scale). The tab you pick is kept per device. On large horizontal screens
  the deck and channels share a page.
- **Many channels at once.** Each one plays, pauses and sets its volume on
  its own. **Play all / Pause all** sits in the Channels panel header.
- **Resume where you left off.** The channels that were playing last are
  ticked in the channel list. **Pause all** moves them to the top, and
  **Resume** in the Channels header plays only those, from where they
  stopped.
  - **What gets ticked:** a channel is ticked when it starts playing. Playing
    one channel while nothing plays starts a new set; pausing one while
    others play unticks it. Tap the square at the start of a row to tick or
    untick it yourself.
  - **When the list reorders:** on Pause all and Resume, when a mix loads,
    and when you come back to the app with nothing playing. Never while you
    tap a row, so rows don't jump under your finger.
  - **Kept:** with the saved mix on this device, so the next visit opens
    with the same channels ticked and on top. With remote control, the ticks
    and order are part of the mix every paired device sees.
- **Main display.** One channel at a time fills the screen with its artwork,
  title and channel name. The deck (previous, play, next, stop, timeline and
  volume) controls that channel. Tap the artwork to play or pause it.
- **Strip of what's playing.** The numbered strip on the artwork, or the
  thumbnail strip under the title on large horizontal screens, lists the
  channels that are playing, numbered by their place in the mix. Tap one to
  bring it to the main display.
- **Per-channel settings.** The volume button on a channel row opens its
  drawer: a volume slider, its YouTube link (paste a new one and press **Load
  link**) and **Remove channel**, which asks for confirmation first.
- **Remote control.** Pair devices in **Settings › Devices**.
  - **Pairing:** **Connect a device** shows a QR code and a 6-character code.
    Scan or enter it on the other device.
  - **Main and remote:** the device that starts playing becomes the main
    device. Any other paired device that opens the app becomes its remote:
    it shows the same mix live and controls everything, from play, pause,
    volume and seeking to switching, adding and removing channels and
    loading mixes.
  - **Play here:** the button in the header badge moves playback to the
    device in your hand, from the same positions.
  - **When the main device goes offline:** remotes take the mix over,
    paused, at the same positions, and offer **Play here**.
  - **The relay:** pairing goes through the relay in `worker/`, deployed on
    Cloudflare.

  See `docs/remote-control-plan.md`.
- **Screen effect.** The cover art and the thumbnail strip are drawn as if
  on a CRT or LED wall: phosphor cells, colour fringe, glow. The Screen
  effect tab (**Settings › Screen**) has a dial for the style (Slot mask, Hero,
  Close-up, LED wall, Photographed), a **Mix** slider from the plain picture
  to the full effect, and **Fine-tune** for every setting. Kept per device.
- **Skins.** **Settings › Skins** changes the whole look, at any
  time, without interrupting playback:
  - **Modern › Modern Warfare:** the tactical console (dark glass, corner
    brackets, the artwork's colour). The default.
  - **Frutiger Aero › Windows XP:** the player as a desktop window. A blue
    title bar (its button is fullscreen), a toolbar with the transport,
    repeat and volume, a task pane of collapsible groups (Mix tasks, Saved
    mixes, Mix status, Devices, Screen effect, Skins), the artwork beside
    Now playing, the timeline and Playing now, the channels as a details
    list, and a status bar. On a phone it is one column: artwork, transport,
    channels, then the task pane.

  The skin is kept per device, never shared through remote control, so a
  remote can wear a different skin from the player it controls.
- **Accent from the artwork.** The interface's highlight colour comes from
  the current channel's thumbnail. It falls back to amber when the thumbnail
  is too dark or grey. (Windows XP keeps its own selection blue.)
- **Saved mixes.** Name a mix and save it on this device. The last saved mix
  reopens next time. Loading a mix while channels are open asks whether to
  replace them or add to them.
- **Share links.** **Copy share link** puts the whole mix in a URL. Opening
  it loads that mix.
- **Import.** In the installed app there's no address bar to open a share
  link in. Instead, paste the link into **Import** in the Saved mixes panel.
  Plain YouTube links work too (one or several, separated by spaces, commas
  or new lines). If channels are open, it asks whether to replace them or
  add to them.
- **Fullscreen takeover.** The first tap enters fullscreen, and while
  something plays there the screen stays awake. The button at the top right leaves or
  re-enters fullscreen. Installed from the home screen (*Add to Home screen* /
  *Install app*), it always opens fullscreen.
- **UI scale.** **Settings › Layout** has a 70–130% setting for the whole
  interface, kept per device. The line under it shows the size the app lays
  out at and which layout that gives.
- **Layout choice.** The **Layout** setting (**Settings › Layout**) picks **Auto**
  (follow the screen) or **Stacked**, the vertical phone layout on any
  screen, just because you prefer it. It's remembered per screen, so Stacked
  on a Fold's cover display leaves the inner display on Auto.
- **Resizable artwork.** On large screens used with a mouse or trackpad
  (1280 × 680 and up, such as an ultrawide monitor), drag the divider between
  the artwork and the panels to make the artwork bigger or smaller.
  Double-click the divider to reset it. The width is kept per device.
- **Keyboard.** <kbd>Space</kbd> plays or pauses the main channel, and
  <kbd>[</kbd> / <kbd>]</kbd> step between channels.

## Layouts

| Screen | Layout |
| --- | --- |
| Vertical (phones, a Fold's cover display) | Artwork at full width above the panels. The first swipe up shrinks it; after that each swipe moves one panel: deck, channels, the library (saved mixes and mix status), then settings. |
| Horizontal | The artwork and title in a column on the left; the panels page vertically on the right. |
| Large horizontal (960 × 680 and up: a Fold's inner display, laptops) | A wider left column with bigger artwork and the thumbnail strip; the deck and the channel list share the first panel. |
| Large horizontal with a mouse (1280 × 680 and up) | As above, with a draggable divider that sets the artwork column's width. |

With **Layout: Stacked**, any horizontal screen uses the vertical layout
instead, in a centred column on wide screens. On short screens the first
swipe also tucks the title away, leaving a slim band of artwork.

The pager bars on the right edge show the panel in view and jump to a panel
on tap.

## Development

You need Node.js (for the TypeScript compiler) and Python 3 (or any static
file server).

```bash
npm install
```

```bash
npm run build
```

```bash
npm run serve
```

Then open http://localhost:8000.

| Script | What it does |
| --- | --- |
| `npm run build` | Compiles `src/` to `dist/` with `tsc`, bundles it into `app.js` and stamps cache-busting versions into `index.html`. Run it after every change. |
| `npm run watch` | Recompiles `src/` on save (run `npm run bundle` to refresh `app.js`). |
| `npm run bundle` | Rebuilds `app.js` and the version stamps from `dist/`. |
| `npm run serve` | Serves the folder at http://localhost:8000. |

`app.js` is a classic script, so `index.html` also works opened straight from
disk once it is built.

## Deployment

GitHub Pages serves the `main` branch as it is. Build, commit the generated
`app.js` and `index.html` together with your changes, and push. `dist/` is a
build intermediate and is not committed.

## Project structure

```
index.html            Page markup; loads styles.css and app.js
styles.css            Base styles and the Modern Warfare skin: tokens, layouts, components
skins/xp.css          The Windows XP skin, scoped to html[data-skin="xp"]
app.js                Generated bundle of src/ (committed for GitHub Pages)
bundle.js             Build step: bundles dist/ into app.js, stamps versions
manifest.webmanifest  Installable app: name, icons, fullscreen display
src/
  main.ts             Controller: state, rendering, events, boot
  layout.ts           Panels, pager, collapsing artwork, large-screen merge
  ui.ts               HTML templates, formatting, small DOM helpers
  playlist.ts         Track model and PlaylistManager
  youtubePlayer.ts    YouTube IFrame API wrapper and URL parsing
  accent.ts           Accent colour and square-art detection from artwork
  crt.ts              Screen effect: draws the artwork as phosphor cells
  screenFx.ts         Screen effect panel: style dial, Mix, fine-tune
  commands.ts         Command layer: every change to playback or the mix
  pairing.ts          This device, its room, the relay's address and calls
  remote.ts           The connection to the paired room (presence, reconnecting)
  devices.ts          The Devices section: pairing codes, QR, device list
  qr.ts               A small QR code encoder (SVG)
  screen.ts           Fullscreen and screen wake lock
  scale.ts            UI scale setting
  layoutPref.ts       Layout setting (Auto or Stacked), kept per screen
  resize.ts           Draggable divider for the artwork column
  storage.ts          Saved mixes in localStorage
  skin.ts             Skins: the list, the Skins tab, kept per device
  tabs.ts             Tabs (the Settings page): one section at a time
  skinLayout.ts       Window layout for skins that need one (Windows XP)
  shareLinks.ts       Encode, decode and import share links
assets/               Favicon, app icons and the logo artwork
  skins/xp/icons/     Windows XP skin icons (16 and 32 px)
docs/                 Architecture and design notes
worker/               The remote control relay (Cloudflare Worker); see worker/README.md
```

## Documentation

- [docs/architecture.md](docs/architecture.md): how the code is organised,
  how playback, layout and the build work.
- [docs/design.md](docs/design.md): the visual system (colour, type, surfaces,
  layouts) and the interaction rules behind it.

## Browser support

Current Chrome, Edge, Brave, Safari and Firefox. The app uses CSS container
queries, `color-mix()`, `@property`, scroll snapping and `dvh` units.
Fullscreen and keeping the screen awake depend on the browser; iPhone Safari
has neither, but the installed app still runs without browser bars.
