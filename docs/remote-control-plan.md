# Remote control: plan

Status: **phase 1 (the command layer) is built**; phases 2–5 are proposed.
Review the decisions below before phase 2.

## Goal

Like Spotify Connect: one device plays the audio (the **main** device), and
Ambient Player opened on another paired device becomes a **remote** for it.
The remote shows the same mix, live, and controls everything: play, pause,
volume, seeking, switching channels, adding and removing channels, and
loading mixes. A remote can also take over playback ("Play here").

Constraints:

- **Hosting:** the site stays a static app on GitHub Pages; the only new
  server piece is a small relay on Cloudflare's free tier.
- **Accounts:** none. Devices are paired once, by QR code or a short code.
- **Without the relay:** if it's unreachable, the app works exactly as it
  does today, on its own.

## Decisions for you

These change the plan; the recommended option is listed first.

1. **Pairing.**
   - **QR code plus short code, once per device (recommended):** the code
     works when there's no camera at hand.
   - **Alternative:** a pairing link sent between your own devices.
2. **Who becomes main.**
   - **The first device to start playing (recommended).**
   - **Alternative:** a device you mark as main in settings, such as the
     laptop, which every other device then treats as main.
3. **When the main device disappears.**
   - **Remotes offer "Play here" (recommended):** playback continues on the
     remote from the last known positions.
   - **Alternative:** remotes just show "Main device offline".
4. **How much a remote can do.**
   - **Everything (recommended).**
   - **Alternative:** playback only (play, pause, volume, switching
     channels), with no editing of the mix.
5. **Device names.**
   - **Generated from the browser and system (recommended):** for example
     "Chrome on Android", renameable in settings.
   - **Alternative:** ask for a name at pairing.

## How it fits together

```
 Main device (plays audio)              Cloudflare (free tier)             Remote device
 ┌───────────────────────┐   WebSocket  ┌──────────────────────────┐ WebSocket ┌────────────────────┐
 │ Ambient Player        │◀────────────▶│ Worker  /room/:id/ws     │◀─────────▶│ Ambient Player     │
 │ YouTube players       │  state ─────▶│   └▶ Durable Object      │── state ─▶│ no players         │
 │ applies commands      │◀── commands  │      "Room" per pair:    │◀ commands │ mirrors the state  │
 └───────────────────────┘              │      devices, roles,     │           │ sends commands     │
                                        │      last state snapshot │           └────────────────────┘
                                        └──────────────────────────┘
```

**The relay.**

- **One Durable Object per room:** a room is the group of paired devices.
  The object holds the WebSocket connections, knows which device is main,
  and keeps the last state snapshot so a remote that joins sees the mix
  immediately.
- **Single writer:** only the main device has YouTube players and only it
  changes the mix. Remotes send commands; the main device applies them and
  broadcasts the new state. One writer means no conflicts to resolve.
- **The relay just relays:** it forwards messages, keeps the snapshot and
  decides roles; it doesn't interpret the mix.

## Pairing and rooms

**Creating a room.** On the first device, open the new **Devices** section
of the last panel and tap **Connect a device**. The app:

1. asks the Worker to create a room and gets back a room ID and a room
   secret (128 random bits, base64url);
2. stores both in `localStorage` under `ambient-player:room`;
3. shows a QR code and a short pairing code (6 characters, valid for 10
   minutes, single use).

**Joining.** On the second device, either:

- **Scan the QR code:** it encodes
  `https://thomthorne.github.io/ambient-player/#pair=<code>`. The app swaps
  the code for the room ID and secret and stores them. This works like
  share links do today, and also through **Import** in the installed app,
  which has no address bar.
- **Type the short code:** into **Devices → Join with a code**.

**After that.** Every paired device connects to the room on its own when the
app opens. No more pairing.

**Leaving.** **Devices → Unpair this device** forgets the room on that
device. **Forget all devices** (from any paired device) rotates the room
secret, so every other device has to pair again.

**Why a short code, not the secret, in the QR code:** the QR code or code
might be seen or photographed. A short-lived, single-use code limits what
that exposes; the long secret never leaves your devices except over the
encrypted WebSocket.

## Roles

| Role | Device | What it does |
| --- | --- | --- |
| **Main** | One per room | Has the YouTube players and plays the audio. Applies commands, broadcasts state. |
| **Remote** | Every other connected device | No players load. Shows the mirrored state, sends commands. |
| **Idle** | Connected, before any audio | Behaves like today. Becomes main on its first play if no device is main yet. |

**Claiming main.** A device claims main when it starts playback and no other
device is main. The Durable Object grants the claim (it's the only one who
decides, so two devices can't both become main). If a main device already
exists, the playing device asks "Play here instead of on Laptop?" and a yes
becomes a handover.

**Handover ("Play here"), step by step:**

1. The remote sends `claim_main`.
2. The Durable Object tells the current main device to `release`.
3. The old main device stops its players and sends its final snapshot, with
   positions.
4. The Durable Object makes the new device main and sends it that snapshot.
5. The new main device loads the players, seeks each channel to its
   position, and resumes the channels that were playing.
6. The new main device broadcasts state; every remote, including the old
   main device, now mirrors it.

If the old main device doesn't answer within 3 seconds (asleep or offline),
the Durable Object hands over with the last snapshot it has.

**The main device disappearing.** The Durable Object notices the socket
close, or a heartbeat timeout of about 45 seconds. It marks the room "no
main" and tells the remotes, which show **Main device offline · Play here**.

## The state snapshot

The main device sends the whole mix. It's small (a few kB for a long mix),
so there's no need for diffs.

```ts
interface RoomState {
  v: 1;                       // protocol version
  seq: number;                // increases with every change from the main device
  sentAt: number;             // main device's clock, ms (for extrapolation)
  mixName: string | null;
  focusedId: string | null;   // the channel on the main display
  tracks: Array<{
    id: string;
    url: string;
    videoId: string;
    meta?: { title: string; author?: string; thumbnailUrl: string; durationSeconds?: number };
    state: 'loading' | 'playing' | 'paused' | 'error';
    error?: { code: string; message: string };
    currentTime: number;      // seconds, at sentAt
    duration?: number;
    volume: number;           // 0–1
    loop: boolean;
  }>;
}
```

**When it's sent.**

- **On every change:** play or pause, volume, focus, add, remove, link
  change, repeat. Changes inside one moment are debounced and sent together.
- **Every 15 seconds while something plays:** so drift stays small.

**Positions.** These aren't streamed four times a second. A remote advances
`currentTime` itself for playing channels, using `sentAt` and the clock
offset measured when it connected. The next snapshot corrects any drift.

**What stays per device.** These are not synced:

- **Settings:** UI scale, Layout, screen effect, fullscreen.
- **Saved mixes:** these stay in each device's `localStorage`. Loading a
  saved mix on a remote sends its links to the main device.

## Commands (remote → main)

Every command carries an `id`; the main device answers with `ack` (or
`error`) and then the new state.

| Command | Fields |
| --- | --- |
| `play` / `pause` | `trackId` |
| `play_all` / `pause_all` | none |
| `focus` | `trackId` |
| `step` | `dir: 1 \| -1` |
| `seek` | `trackId`, `time` |
| `stop` | `trackId` (pause and go to the start, like the deck's Stop) |
| `volume` | `trackId`, `volume` |
| `loop` | `trackId`, `on` |
| `add` | `url` |
| `remove` | `trackId` |
| `relink` | `trackId`, `url` |
| `load_mix` | `urls[]`, `name \| null`, `mode: 'replace' \| 'append'` |

The **replace-or-add question** is asked on the remote (the person holding
it decides), and the answer is sent as `mode`.

**Slider drags** (volume, seek) are throttled to about 10 messages a second
while dragging, with the final value always sent on release.

## Messages (WebSocket protocol)

All messages are JSON with a `type`. Version 1:

| Direction | `type` | Purpose |
| --- | --- | --- |
| device → room | `hello` | `deviceId`, `name`, `secret`, `protocol: 1`. Sent first; the room closes the socket if the secret is wrong. |
| room → device | `welcome` | Your role, the device list, the main device's ID, the last snapshot, the server time (for clock offset). |
| room → all | `devices` | The device list changed (joined, left, renamed, new main). |
| main → room | `state` | A snapshot. The room stores it and forwards it to remotes. |
| remote → room → main | `command` | A command, forwarded to the main device only. |
| main → room → remote | `ack` / `error` | The answer to a command, forwarded to the remote that sent it. |
| device → room | `claim_main` | Ask to become main (first play, or Play here). |
| room → main | `release` | Stop playing and send a final snapshot (handover). |
| device → room | `rename` | Change this device's name. |

**Heartbeat.** The client sends `ping` every 20 seconds. The Durable Object
answers with WebSocket auto-response, which replies without waking the
object, so idle rooms stay hibernated and cost nothing.

## The Cloudflare side

**Code.** A new `worker/` folder in this repository:

```
worker/
  wrangler.toml          name, compatibility date, the Room Durable Object binding (SQLite-backed)
  src/index.ts           the Worker: routes, origin check, rate limits
  src/room.ts            the Room Durable Object
  package.json           wrangler as a dev dependency
```

**Routes.**

| Route | What it does |
| --- | --- |
| `POST /rooms` | Create a room. Returns `{ roomId, secret }`. |
| `POST /rooms/:id/codes` | With the secret, issue a short pairing code (10 minutes, single use). |
| `POST /pair/:code` | Swap a pairing code for `{ roomId, secret }`. |
| `GET /rooms/:id/ws` | Upgrade to a WebSocket into the room's Durable Object. |
| `POST /rooms/:id/rotate` | With the secret, rotate it (**Forget all devices**). |

**The Room Durable Object.**

- **API:** uses the WebSocket Hibernation API (`acceptWebSocket`,
  `webSocketMessage`, `webSocketClose`), so it sleeps between messages.
- **Stored (SQLite):** a hash of the room secret, the device list (ID, name,
  last seen), the main device's ID and the last snapshot.
- **Pairing codes:** a small table of codes with expiry. The code-to-room
  lookup goes through one shared Durable Object, keyed `"pairing"`, that
  only holds pending codes.
- **Ping:** auto-response is set for `ping` → `pong`.
- **Cleanup:** an alarm removes rooms that have had no device for 90 days.

**Safety.**

- **Origin check:** the Worker accepts requests only from the GitHub Pages
  origin (and `localhost` for development). Anything else gets `403`.
- **Secrets:** stored as a hash, compared in constant time.
- **Rate limits:** pairing-code lookups are limited per IP (a few per minute)
  so codes can't be guessed. Messages per socket are capped at about 30 per
  second.
- **Size:** messages over 64 kB are rejected; a snapshot is a few kB.
- **Logging:** none, other than Cloudflare's own request logs.

### Free tier budget

Checked against Cloudflare's docs ([Durable Objects pricing][do-pricing],
[limits][do-limits], [Workers pricing][workers-pricing]) for this plan. Check
them again before deploying, since plans change.

| Free plan limit (per day) | Expected use (2–3 devices, 8 hours of listening) |
| --- | --- |
| Durable Object requests: 100,000 (WebSocket messages count) | About 2,000–5,000: snapshots on change plus one every 15 seconds while playing, commands, connects. Pings answered by auto-response don't wake the object. |
| Duration: 13,000 GB-s | Small. The object hibernates between messages, so it only accrues time while handling one. |
| SQLite rows written: 100,000 | About one write per snapshot plus connects: a few thousand at most. |
| Storage: 5 GB in total | A few kB per room. |
| Workers requests: 100,000 | A handful: room creation, pairing, WebSocket upgrades. |

Exceeding a free limit makes further operations fail until 00:00 UTC. The
app would then behave as if the relay were offline: each device plays on its
own.

## Changes in the app

### 1. A command layer (the largest change)

Today, buttons and sliders in `src/main.ts` call the player controllers and
`PlaylistManager` directly, in many places. They all move behind one
function:

```ts
dispatch(command: Command): void
```

- **Main or not connected:** the command runs locally, exactly as today.
  Then, if connected, the new state is broadcast.
- **Remote:** the command is sent to the main device and the interface shows
  it as pending (a subtle state on the control) until the new state arrives.

The existing handlers become commands: `togglePlay`, the global Play all /
Pause all, `setFocus` and `stepFocus`, the seek and volume sliders, Stop,
repeat, `addTrackFromUrl`, `removeTrack`, `reloadTrack`, `loadTracksFromUrls`
and `handleLoadPlaylist`.

This step changes nothing visible and is worth doing first, on its own.

### 2. Applying a snapshot (remote)

A remote fills `PlaylistManager` from the snapshot, without creating
players, and renders with the existing `renderAll()`. The 250 ms playback
poll becomes position extrapolation from the snapshot on a remote.

### 3. New modules

| Module | Role |
| --- | --- |
| `src/commands.ts` | The `Command` type, `dispatch()`, and running a command locally. |
| `src/remote.ts` | The WebSocket connection: `hello`, reconnecting with backoff (1, 2, 5, 10, 30 seconds), heartbeat, clock offset, sending and receiving. Emits role and state events. |
| `src/roomState.ts` | Building a snapshot from the local state (main device), and applying one (remote). |
| `src/pairing.ts` | Creating and joining rooms, pairing codes, the `#pair=` link, the room stored in `localStorage`. |
| `assets/vendor/qrcode.js` | A small QR code generator (MIT licensed, vendored, about 20 kB). |

The relay's address is a constant in `remote.ts`, for example
`https://ambient-relay.<your-subdomain>.workers.dev`.

### 4. Interface

- **Remote badge in the header:** in place of the status line, **Remote ·
  Laptop** with a small live dot. It turns to **Main device offline** with a
  **Play here** button when the main device is gone.
- **On the main device:** the header says **Playing here · 2 remotes**.
- **Devices section** in the last panel:
  - **Not paired:** **Connect a device** (shows the QR code and short code)
    and **Join with a code**.
  - **Paired:** the device list (name, role, online or last seen),
    **Rename this device**, **Play here** (on a remote), **Unpair this
    device** and **Forget all devices**.
- **What a remote turns off:** fullscreen takeover, keep-awake and the YouTube
  players don't load. The artwork, accent and screen effect still work: they
  only need the thumbnails, which come from `img.youtube.com` as today.
- **Feedback:** while a command is in flight, the control shows a pending
  state. If the main device doesn't answer within 5 seconds, the remote
  shows "Laptop didn't respond".

### 5. What doesn't change

- **Not paired:** the app is exactly as today, and no connection is opened.
- **Relay unreachable:** a paired device that can't reach the relay works
  locally, as today, and retries in the background. Nothing blocks on the
  relay.

## Risks and how the plan handles them

| Risk | Handling |
| --- | --- |
| **A phone as the main device.** Mobile browsers can pause audio or drop the WebSocket when the app goes to the background or the screen turns off. | Keep-awake already helps in fullscreen. Reconnect on `visibilitychange`. Recommend a laptop or desktop as main; test phones as main early (phase 2). |
| **Two devices playing.** | Only the Durable Object grants main. A device that loses main stops its players. |
| **Clock differences between devices.** | A clock offset is measured on connect (`welcome` carries server time) and positions are extrapolated with it. Snapshots every 15 seconds correct drift. |
| **The installed app and the browser not sharing storage** (relevant to scanning a QR code with the camera, which opens the browser). | On Android, the installed app and Chrome or Brave share the site's storage, so pairing in the browser carries over. Where it doesn't, **Join with a code** or **Import** of the pairing link inside the installed app works. Test on the Fold. |
| **The relay being reachable by anyone.** | Origin check, room secrets, single-use short-lived codes, rate limits. The worst case for a stranger is seeing nothing. |
| **Free tier limits changing.** | Usage is about 5% of the request limit. If a limit is hit, the app falls back to local playback. |

## Phases

Each phase ends in something usable and is its own commit or pull request.

1. **Command layer.**
   - **Work:** `src/commands.ts`, and every control in `src/main.ts` going
     through `dispatch()`.
   - **Visible change:** none.
   - **Done when:** every control still works on a phone and a desktop, and
     the layout snapshots still match.
2. **Relay and pairing.**
   - **Worker side:** the `worker/` folder (Worker and Room Durable Object),
     deployed to your Cloudflare account.
   - **App side:** `src/pairing.ts` and the Devices section.
   - **Done when:** two devices pair by QR code and by code, both show up in
     the device list, unpairing and rotating work, and the room survives
     reloads.
3. **Remote mode.**
   - **Work:** `src/remote.ts`, `src/roomState.ts`, roles, snapshots,
     commands, the remote badge and pending states.
   - **Done when:** a phone controls a laptop's playback (every command in
     the table), positions stay in step within about a second, and a remote
     that joins late sees the mix immediately.
4. **Handover and failure handling.**
   - **Work:** Play here, a main device going offline, reconnecting,
     fallback to local playback when the relay is down.
   - **Done when:**
     - **Handover:** playback moves between devices from the same positions.
     - **Offline main:** closing the main device's tab shows "offline · Play
       here" on the remote within a minute.
     - **Relay down:** blocking the relay leaves every device working on its
       own.
5. **Docs.**
   - **Work:** the README, `docs/architecture.md` (relay, protocol, roles)
     and `docs/design.md` (remote interface).
   - **Also:** a short `worker/README.md` for deploying.

## Testing

- **Locally:** `wrangler dev` runs the Worker and Durable Object on your
  machine. Two browser windows (or the preview and a phone on the same Wi-Fi)
  pair against it.
- **On devices:** the Fold (cover and inner displays) as a remote for the
  laptop, then the Fold as main, testing the screen turning off and the app
  going to the background.
- **Protocol:** the Room Durable Object's message handling is plain
  TypeScript; a few unit tests cover role claims, handover timeouts and
  wrong secrets.

## What you'd need to do

- **Account:** create a Cloudflare account (free) if you don't have one.
- **Deploy:** run `npx wrangler login` once, then `npx wrangler deploy` in
  `worker/`. I can run the deploy once you're logged in, if you prefer.
- **Address:** tell me the `workers.dev` subdomain it gets, or a custom
  domain if you want one, for the relay address in the app.

[do-pricing]: https://developers.cloudflare.com/durable-objects/platform/pricing/
[do-limits]: https://developers.cloudflare.com/durable-objects/platform/limits/
[workers-pricing]: https://developers.cloudflare.com/workers/platform/pricing/
