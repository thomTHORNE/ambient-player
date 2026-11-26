# Design

A calm, tactical console: sharp dark panels with corner brackets over the
current channel's blurred artwork. The artwork and the channel playing are
the focus; everything else stays quiet. All styles live in `styles.css`,
with the design tokens at the top under `:root`.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#08090A` | Page background, theme colour. |
| `--panel` | `rgba(13, 15, 16, 0.62)` | Panel glass. It is translucent, so the backdrop's colour comes through. |
| `--text`, `--text-2`, `--text-3` | `#ECEEEE`, `#A2A8A7`, `#6A7170` | Primary text, secondary labels, faint subtext. |
| `--line`, `--line-strong` | white at 10% and 22% | Borders and dividers. |
| `--accent` | from the artwork, amber `#FFB24A` fallback | The primary action, whatever is playing, the selected channel, the active pager bar. |
| `--accent-fill`, `--accent-line`, `--accent-glow`, `--accent-deep` | `color-mix()` of the accent | Tints, outlines and glows derived from the accent. |
| `--orange` | `#FF7A3D` | Warnings only: a channel that can't play, an input error. |
| `--danger` | `#FF6B61` | Destructive actions only (removing a channel). |

**The accent.**

- **Source.** It is sampled from the current channel's thumbnail
  (`src/accent.ts`) and adjusted to stay readable on the panels.
- **Changes.** It fades over 700 ms when the channel changes (a registered
  `@property`).
- **Use it for meaning.** Never use it as decoration: the accent says "this
  is live" or "this is the main action".

## Type

| Font | Use |
| --- | --- |
| Chakra Petch (400–700) | Interface text, titles and labels. Labels are uppercase with wide letter spacing. |
| JetBrains Mono (400, 500) | Readouts: times, numbers, dB, channel indices, the layout readout. |

Both load from Google Fonts. The title on the main display is 26px on
phones, 20–22px in the horizontal column, and 16px on a phone held sideways.

## Surfaces and texture

**Corner brackets** are the signature detail. Panels, cards, deck tiles, the
artwork, dialogs and the selected channel row draw L-shaped corners with a
`::before` layer. A host element tunes them with:

| Property | Sets |
| --- | --- |
| `--bc` | Colour. |
| `--bl` | Arm length. |
| `--bi` | Inset; negative values reach outside the box. |

The artwork's brackets sit inside the frame like a viewfinder.

**Glass** (`--glass`) layers the panel colour with:

- a fine film grain (`--noise`, an SVG turbulence tile);
- a 2px ordered dither (`--dither`).

**Backdrop**, from bottom to top:

1. **The artwork.** It is blurred, desaturated and dimmed, and oversized so
   its edges never show. It drifts slowly (a gentle rotate, skew and zoom
   over 45 s), at 10 frames a second, which looks the same as 60 at that
   speed and blur.
2. **Grain.**
3. **A still tactical grid** (`--grid`): lines every 128px, dots every 32px
   and crosses where the lines meet, under a vignette.

## Layouts

| Screen | Query | Arrangement |
| --- | --- | --- |
| Vertical (Stacked) | `orientation: portrait`, or **Layout: Stacked** | Brand, then the stage: artwork at full width with the numbered strip down its right edge inside the frame, then the title. Panels below; the artwork collapses as you scroll, to about a tenth of the screen height. |
| Horizontal (Columns) | `orientation: landscape` on **Layout: Auto** | Brand across the top; the stage in a left column (a fixed 4:3 artwork frame, the strip beside it, the title under it), panels in the middle, pager on the right. |
| Large horizontal | `landscape`, ≥ 960 × 680 | A wider stage column (up to 600px) with a bigger artwork and the thumbnail strip under the title; the deck and the channel list share the first panel. |
| Large horizontal, mouse | `landscape`, ≥ 1280 × 680, `hover: hover` and `pointer: fine` | As above, plus a divider between the artwork and the panels. Dragging it resizes the artwork column, from 300px up to the most the artwork can use at the screen's height, always leaving the panels 560px. |
| Short horizontal | `landscape`, height ≤ 500px | A phone on its side: smaller title and more room for the artwork. |
| Stacked on a horizontal screen | **Layout: Stacked** | The vertical layout in a centred 600px column with the pager beside it; the artwork's gradient band still spans the full screen width. On short screens: smaller title type, and the first swipe tucks the title away, leaving a slim band of artwork. |
| Narrow | width ≤ 640px | 16px gutters, a smaller brand. |
| Touch | `pointer: coarse` | 44px tap targets throughout. |

The panels are, in order:

1. **Deck:** transport, timeline (with the channel's repeat switch),
   channel volume.
2. **Channels:** add a link, Resume, Play all / Pause all, the channel rows.
3. **Library:** saved mixes and import, then mix status: duration and the
   share link.
4. **Settings:** one panel with tabs: Devices (pairing and the device
   list), Screen (style dial, Mix, fine-tune), Skins, and Layout (the
   Layout setting and UI scale).

On large horizontal screens the deck and channels share the first page, so
there are three.

**Tabs.** Drawn like the transport buttons: glass tiles with corner
brackets that step out on hover, sharing the row's width; the open tab is
the primary one, with the accent's glow along its foot and accent
brackets. The sections sit
flat in the Settings panel, one at a time; the tab names them, so their
own headings are for screen readers (Devices keeps its status chip). Left /
Right, Home and End move between tabs.

## Interaction rules

These came out of using the app on a phone and a Fold. Keep them when
changing the layout.

**Moving around.**

- **Vertical everywhere.** Moving between panels is a vertical swipe on every
  screen, one panel per swipe, so a swipe never catches a horizontal slider.
  Sliders take only sideways drags (`touch-action: pan-y`).
- **Nothing scrolls on its own.** Selecting a channel may scroll an inner
  list or strip to show it, but it never moves the page or collapses the
  artwork.
- **One panel in view.** Each panel fills the space under the stage, so the
  next one never peeks in. A long panel scrolls to its end before the next
  swipe moves on.

**The artwork.**

- **Stable size.** The frame is the same size for every channel, whatever
  the thumbnail's shape, so switching channels never makes the layout jump.
  Square album art is zoomed to fill the frame.
- **Size limit.** On vertical screens the stage takes at most half of the
  space under the brand.

**Channel controls.**

- **The main volume is primary.** The big deck slider is the main volume
  control. Each row's own volume, its link and **Remove channel** sit behind
  the row's settings toggle, so scrolling a long list can't change them by
  accident.
- **Rows don't move under a tap.** The list reorders (channels played last
  to the top, for Resume) only on Pause all, Resume, loading a mix or
  coming back to the app, never in response to a tap on a row.
- **Resume ticks.** The square at the start of a row is ticked, in the
  accent, for the channels Resume plays. On narrow phones the row thumbnail
  shrinks (and below 330px goes) so the title keeps its room.
- **Destructive actions confirm.** Removing a channel asks inline, in the
  danger colour. Deleting a mix asks in the browser's confirm dialog.

**Strips.** The strips show only what's playing, numbered by position in the
mix:

- **Numbered strip:** an accent fill and glow marks the channel on the main
  display.
- **Thumbnail strip:** muted (desaturated and dimmed), with no play buttons,
  so it never competes with the main artwork; the selected tile gets the same
  accent glow.

**Resizable artwork.**

- **Look.** The divider is a hairline with a short grip at half height. It
  turns to the accent colour on hover, on keyboard focus and while dragging.
- **Limits.** It never lets the column grow past what the artwork can fill,
  so there's no empty space beside the art.
- **Where.** It appears only where a mouse or trackpad can drag it; touch
  layouts keep their fixed columns.

**Saved mixes.** The mix that's open now (by name) is marked in the list:
an accent bar on the left, a faint accent wash, the name in the accent
colour and "· Current" after the channel count.

**Devices.**

- **Pairing code:** a white QR code sits beside the code in large accent
  type, split in two halves ("5JM 87X") so it's easy to read out. The code
  leaves out 0, O, 1, I and L.
- **Countdown:** the code counts down to its expiry. Its box closes on its
  own once the other device joins.
- **Device list:** each device shows an accent dot when it's online, a grey
  one otherwise, with "Online" or "Seen 5 min ago"; this device is tagged.
  While disconnected, no one is shown as online.
- **Unpairing:** **Unpair this device** and **Forget all devices** both ask
  first; forgetting all is styled as destructive.
- **Main device:** the device that plays is tagged **Plays** in the accent
  colour.
- **Header badge:** sits after the status line, with a small accent dot:
  - **On a remote:** **Remote · Laptop**, with a small **Play here** button
    in the accent colour.
  - **When the main device has gone:** **Laptop offline** (or
    **Disconnected**), with **Play here**.
  - **On the main device:** **Playing here · 1 remote**.
  - **While a command is on its way:** the dot pulses.
  - **While reconnecting:** it turns grey.
  - **When a command fails:** it shows the reason in orange for a few
    seconds.

**Screen effect.**

- **The look:** the artwork reads as a picture on a physical screen, not a
  filter over it. Real phosphor cells, red, green and blue stripes, a
  slot-mask offset, and a slight glow, like a photo of a CRT or LED wall.
- **Calm, not loud:** the picture is graded cold and desaturated, so the
  accent and the interface stay the focus.
- **Style dial:** a rotary switch. A knob with a pointer and five detents
  turns, with a small spring, to the next style on each tap; the arrow keys
  turn it either way.
- **Mix:** built like the volume card. A large accent readout and caption
  sit over a small slot-mask meter whose lit columns show how much of the
  effect is on, with the slider beneath.
- **Fine-tune:** every other setting stays behind its toggle, out of the
  way.

**Screen.**

- **Fullscreen.** The first tap takes over the screen. In fullscreen on an
  upright phone, the top 36px stays clear for a punch-hole camera.
- **Reduced motion.** With *reduce motion* on, the backdrop stops drifting
  and all transitions and animations become instant; nothing stays hidden.

## Skins

Everything above describes **Modern Warfare**, the default skin. **Windows
XP** (`skins/xp.css`, laid out by `src/skinLayout.ts`) is the player as a
desktop window, after the XP UI kit sheets and the "task pane" mockup.
Everything stays in view at once instead of paging:

- **Window.** The Luna title bar on top ("Ambient Player", the maximize /
  restore button for fullscreen), the cream face (`#ECE9D8`), and a status
  bar with sunken panes at the foot (the mix, what's playing, remote
  control) and the resize grip.
- **Toolbar.** Under the title bar: Previous, Play / Pause, Next and Stop
  as flat toolbar buttons, the repeat checkbox, and the volume slider at
  the far end.
- **Task pane.** On the left, on the blue pane: collapsible groups. Mix
  tasks first, the primary group (dark header): Resume, Play all / Pause
  all, Save this mix, Copy share link, Import a link. Then Saved mixes, Mix
  status, Devices, Screen effect (collapsed at first) and Skins.
- **Main view.** The artwork in a sunken frame beside three groupboxes:
  Now playing, Timeline and Playing now (thumbnails, hidden on short
  screens). Under them the channels: their name, the link field, Resume or
  Pause all, then the details list, which fills the rest of the height and
  scrolls on its own.
- **Phones.** One column: the artwork edge to edge, Now playing and the
  timeline, the four transport buttons, repeat and volume, the channels as
  a group with a big green Resume, then the task pane's groups.
- **Groups.** The timeline, Now playing, Playing now and the skin families
  are groupboxes with blue legends.
- **Controls.**
  - **Buttons:** the kit's buttons (75px minimum, orange hover, blue focus
    ring); Resume is the default button, with a green play mark.
  - **Transport:** flat toolbar buttons that rise on hover.
  - **Fields:** sunken white boxes with the `#7F9DB9` border.
  - **Choices:** XP checkboxes and radio buttons; the repeat switch is a
    checkbox.
  - **Sliders:** the green-footed cursor on a sunken groove.
  - **Timeline:** an XP progress bar of green blocks.
  - **Scrollbars:** the kit's blue scrollbars where the browser allows.
- **Lists.** The channels are a details view with column headings on wide
  panels and list rows on narrow ones; saved mixes and devices are list
  views with folder and computer icons. Selection is XP blue (`#316AC5`)
  with white text; that blue replaces the artwork's accent.
- **Type.** Tahoma (Trebuchet MS for titles) where the system has them, at
  12px (13px on touch screens), in sentence case.
- **Touch.** Controls keep at least 38–44px targets on touch screens,
  larger than XP's own.
- **Not used.** No Windows logo, Start button or product icons: the kit's
  generic system icons only.

## Brand

- **Header.** The brand tile holds the mark (the striped circle in
  `assets/mark-vector.svg`) drawn in the accent colour.
- **Title plate.** "Ambient Player" sits on a dark plate with a corner dot.
- **Status line.** Under the title, a status line shows the mix name and how
  many channels play.
- **Artwork files.** `assets/logo-vector.svg` and
  `assets/logo-vector-whitespace.svg` are the full logo artwork.
- **App icons.** Favicon and app icons are in `assets/` and `assets/icons/`.
