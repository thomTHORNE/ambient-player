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
   over 45 s).
2. **Grain.**
3. **A still tactical grid** (`--grid`): lines every 128px, dots every 32px
   and crosses where the lines meet, under a vignette.

## Layouts

| Screen | Query | Arrangement |
| --- | --- | --- |
| Vertical | `orientation: portrait` | Brand, then the stage: artwork at full width with the numbered strip down its right edge inside the frame, then the title. Panels below; the artwork collapses as you scroll, to about a tenth of the screen height. |
| Horizontal | `orientation: landscape` | Brand across the top; the stage in a left column (a fixed 4:3 artwork frame, the strip beside it, the title under it), panels in the middle, pager on the right. |
| Large horizontal | `landscape`, ≥ 960 × 680 | A wider stage column (up to 600px) with a bigger artwork and the thumbnail strip under the title; the deck and the channel list share the first panel. |
| Short horizontal | `landscape`, height ≤ 500px | A phone on its side: smaller title and more room for the artwork. |
| Narrow | width ≤ 640px | 16px gutters, a smaller brand. |
| Touch | `pointer: coarse` | 44px tap targets throughout. |

The panels are, in order:

1. **Deck:** transport, timeline, channel volume.
2. **Channels:** add a link, Play all / Pause all, the channel rows.
3. **Saved mixes, then mix status:** playback state, counts, duration,
   repeat, UI scale, share link.

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
- **Destructive actions confirm.** Removing a channel asks inline, in the
  danger colour. Deleting a mix asks in the browser's confirm dialog.

**Strips.** The strips show only what's playing, numbered by position in the
mix:

- **Numbered strip:** an accent fill and glow marks the channel on the main
  display.
- **Thumbnail strip:** muted (desaturated and dimmed), with no play buttons,
  so it never competes with the main artwork; the selected tile gets the same
  accent glow.

**Screen.**

- **Fullscreen.** The first tap takes over the screen. In fullscreen on an
  upright phone, the top 36px stays clear for a punch-hole camera.
- **Reduced motion.** With *reduce motion* on, the backdrop stops drifting
  and all transitions and animations become instant; nothing stays hidden.

## Brand

- **Header.** The brand tile holds the mark (the striped circle in
  `assets/mark-vector.svg`) drawn in the accent colour.
- **Title plate.** "Ambient Player" sits on a dark plate with a corner dot.
- **Status line.** Under the title, a status line shows the mix name and how
  many channels play.
- **Artwork files.** `assets/logo-vector.svg` and
  `assets/logo-vector-whitespace.svg` are the full logo artwork.
- **App icons.** Favicon and app icons are in `assets/` and `assets/icons/`.
