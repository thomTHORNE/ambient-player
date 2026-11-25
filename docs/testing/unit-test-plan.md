# Ambient Player: logic analysis and unit-testing plan

Based on the code at commit `1a0c88e`. This is a plan only: no tests or code changes yet.

The same behaviour, described from the user's side and without code details, is in [user-test-rules.md](user-test-rules.md). Those rules are reviewed and approved first; this plan holds the technical detail for later.

**Scope.** Business logic and internal behaviour only: the client in `src/` and the relay in `worker/src/index.ts`. Rendering, layout, CSS, canvas output and visual effects are excluded, except where they hold logic that can be pulled out and tested as plain data.

**Labels used in this report**

- **Observed**: confirmed by reading the code (and, where noted, by running the expression in Node 22).
- **Inferred**: a likely consequence that the code doesn't show directly.
- **Ambiguous**: the intended behaviour can't be told from the code or the docs. The owner should decide before a test fixes it in place.
- **Priorities**: **P0** test infrastructure; **P1** core business rules or high-risk logic; **P2** important but lower risk; **P3** nice to have.

---

## 1. Architecture and logic overview

### 1.1 Module map

| Module | Responsibility | Logic weight | Import-time side effects | Main dependencies |
| --- | --- | --- | --- | --- |
| `src/main.ts` (1,701 lines) | Controller: app state, command runner, track lifecycle, playback poll, focus, mix load/save/import, remote-control roles and sync, boot | **Very high** | Looks up ~45 elements by id (`main.ts:111-156`), calls `storedScale()` (`:394`), then `initialize()` (`:1701`) | Almost every module |
| `src/playlist.ts` | `Track` model; `PlaylistManager` owns tracks and their player controllers | Medium, pure | None | `crypto.randomUUID` |
| `src/youtubePlayer.ts` | Wraps the YouTube IFrame API; maps player events to `loading/paused/playing/error`; error codes; 10 s load timeout; URL parsing | High | Declares the global `YT` type only | Global `YT`, `window.setTimeout` |
| `src/commands.ts` | Command union type; `dispatch()` sends to a remote route or runs locally | Small, critical | Module singletons `cmdRunLocally`, `cmdRoute` | None |
| `src/storage.ts` | Saved mixes in `localStorage["yt_audio_playlists"]` | Small, pure | None | `localStorage` (no try/catch) |
| `src/shareLinks.ts` | `#pl=<base64url JSON>` encode/decode; finding a mix in pasted text | Small, pure | None | `btoa/atob`, `location`, `history`, `isValidYouTubeUrl` |
| `src/remote.ts` | WebSocket to the relay room: hello/welcome, device list, role derivation, 30 s remote grace, reconnect backoff, heartbeat, command round trips with 5 s timeout, snapshot age | **High**, stateful | Module state `rc*` | `WebSocket`, `pairing.ts`, timers, `Date.now` |
| `src/pairing.ts` | Device identity, stored room, relay address rules, relay HTTP calls and error mapping, pairing-code parsing | Medium | None | `localStorage`, `fetch`, `crypto.getRandomValues`, `navigator.userAgent`, `history` |
| `src/devices.ts` | Devices panel: connect/join/rename/unpair/forget; device list labels | Medium (logic mixed with DOM) | Module state `dvExpiryTimer`, `dvKnownIds` | `pairing.ts`, `remote.ts`, `qr.ts`, DOM |
| `src/qr.ts` | QR encoder (byte mode, level M, versions 1–10) and SVG | Medium, pure | None | `TextEncoder` |
| `src/ui.ts` | HTML templates, `esc()`, time and dB formatting, track state labels, replace/append modal, `showError`, clipboard | Medium (pure helpers plus DOM) | Module state `errorTimer` | DOM, `matchMedia`, `navigator.clipboard` |
| `src/screen.ts` | Fullscreen (WebKit fallback), installed-app detection, wake lock | Small, stateful | Adds a `visibilitychange` listener (`screen.ts:124`) | Fullscreen API, `navigator.wakeLock` |
| `src/scale.ts` | UI scale setting: clamping, rounding, storage, viewport or zoom | Small | None | `localStorage`, `matchMedia` |
| `src/layoutPref.ts` | Layout choice (Auto/Stacked) per physical screen size | Small | Module cache `choiceCache` | `localStorage`, `screen`, events |
| `src/screenFx.ts` | Screen-effect settings: style dial, Mix, fine-tune overrides, storage | Small (inside a DOM closure) | None | DOM, `localStorage` |
| `src/accent.ts` | Accent colour and square-art detection from pixels | Medium (pixel maths) | None | Canvas |
| `src/crt.ts` | CRT renderer (canvas), param parsing, `crtCover` geometry | Mostly rendering | Module caches | Canvas, `getComputedStyle` |
| `src/layout.ts`, `src/resize.ts`, `src/backdrop.ts` | Layout, divider, backdrop | Presentation | **Heavy**: DOM lookups at import (`layout.ts:41-51`), `setInterval` and `new Image()` at import (`backdrop.ts:23, 93`) | DOM, `ResizeObserver` |
| `worker/src/index.ts` | Relay: HTTP routes with CORS; `Room` Durable Object (auth, devices, main role, snapshots, command forwarding, handover, sweep, rate limit, TTL); `Pairing` Durable Object (codes, per-IP rate limit, expiry) | **High** | None | `cloudflare:workers`, Durable Object storage, WebSockets, `crypto.subtle` |

### 1.2 How the modules depend on each other

```
                 ┌──────────── main.ts (controller) ─────────────┐
 UI events ──▶   │ dispatch() ─▶ commands.ts ─▶ route? ─▶ routeToMain ─▶ remote.sendCommand ─▶ relay ─▶ main device
                 │                         └▶ runLocalCommand ─▶ runCommand ─▶ PlaylistManager + YouTubePlayerController
                 │ YouTube callbacks (onMeta/onState/onError) ─▶ track state ─▶ render + scheduleBroadcast ─▶ remote.sendState
                 │ remote.onConnection / onRoomState / onRemoteCommand / onRelease ─▶ role transitions, mirroring, handover
                 └─ storage.ts, shareLinks.ts, pairing.ts, devices.ts, screen.ts, ui.ts (helpers)

 remote.ts ──▶ pairing.ts (storedRoom, relayUrl, thisDevice, saveRoom)
 devices.ts ──▶ pairing.ts, remote.ts, qr.ts
 shareLinks.ts ──▶ youtubePlayer.isValidYouTubeUrl
```

`bundle.js` joins every module into one IIFE with a shared scope. Top-level names must therefore be unique across modules, and any new module has to be added to the `files` list in dependency order (`bundle.js:14-35`). This limits how refactoring can be done (see section 7).

### 1.3 State inventory

**Controller state (`main.ts`)**

| Variable | Line | Meaning |
| --- | --- | --- |
| `playlistManager` | 94 | Tracks and controllers |
| `focusedId` | 97 | Channel on the main display; the deck acts on it |
| `mixName` | 98 | Name of the saved mix that's open, or `null` |
| `seeking` | 99 | Timeline drag in progress (suppresses slider updates) |
| `openDrawers` | 101 | Rows whose settings drawer is open |
| `pollTimer` | 96 | 250 ms poll interval while anything plays |
| `artCache`, `flashTimers` | 212, 933 | Presentation caches |
| `mcRole`, `mcStatus` | 1225-1226 | This device's role and the latest `ConnectionStatus` |
| `mcBroadcastTimer`, `mcSeq` | 1227-1228 | Debounced snapshot timer; snapshot sequence |
| `mcLastClaim` | 1229 | Rate limit for `claimMain` (3 s) |
| `mcTicker`, `mcBases` | 1230-1232 | Remote time projection: 500 ms ticker and base times |
| `mcThrottle` | 1234 | Per-`type:trackId` throttle for remote slider commands |
| `mcNoticeTimer` | 1235 | Badge notice in progress (blocks badge re-render) |
| `mcWantPlayHere`, `mcWantTimer` | 1237-1238 | "Play here" requested; 8 s give-up |
| `mcReleasing` | 1240 | Handing over: broadcasts suppressed |
| `mcResumeIds` | 1242 | Channels that were playing when the main device went away |
| `mcAutoplay` | 1244 | Channels to start once their player is ready |

**Connection state (`remote.ts`)**: `rcSocket`, `rcStatus`, `rcClockOffset`, `rcLastState`, `rcCommandSeq`, `rcPending`, the listener sets, `rcCommandHandler`, `rcReleaseHandler`, `rcOfflineSince`, `rcGraceTimer`, `rcAttempt`, `rcRetryTimer`, `rcHeartbeat` and `rcWanted` (`remote.ts:60-80`).

**Persisted state**

| Key | Owner | Shape |
| --- | --- | --- |
| `yt_audio_playlists` | `storage.ts` | `{ playlists: [{name, urls}], lastPlaylistName? }` (URLs only: no volume or repeat is saved) |
| `ambient-player:room` | `pairing.ts` | `{ roomId, secret }` |
| `ambient-player:device` | `pairing.ts` | `{ id, name }` |
| `ambient-player:relay` | `pairing.ts` | localhost relay override (development) |
| `ambient-player:ui-scale` | `scale.ts` | number 0.7–1.3; removed at 1 |
| `ambient-player:layout` | `layoutPref.ts` | `{ "<min>x<max>": "stacked" }` |
| `ambient-player:screen` | `screenFx.ts` | `{ style, mix, tuned }` |
| `ambient-player:stage-width` | `resize.ts` | ratio |

**Relay state** (Durable Object storage): Room keeps `hash`, `devices`, `mainId`, `state` (`{state, receivedAt}`), `handover` (`{to, deadline}`) and `lastActivity`. It also keeps `rates` in memory. Pairing keeps `code:<CODE>` → `{roomId, secret, expiresAt}`, plus `attempts` per IP in memory.

### 1.4 External dependencies

| Dependency | Used by | What tests need |
| --- | --- | --- |
| YouTube IFrame API (global `YT`, `window.onYouTubeIframeAPIReady`) | `youtubePlayer.ts:113-311` | A `FakeYT` with `Player` (which records options and exposes the event callbacks) and `PlayerState` constants |
| Relay HTTP (`fetch`) | `pairing.ts:147-194` | A `fetch` mock |
| Relay WebSocket | `remote.ts:153-249` | A `FakeWebSocket` with static `CONNECTING/OPEN/CLOSING/CLOSED`, because the code reads `WebSocket.OPEN` |
| `localStorage` | storage, pairing, scale, layoutPref, screenFx, resize | jsdom storage, plus a variant whose methods throw |
| `crypto.randomUUID`, `crypto.getRandomValues`, `crypto.subtle` | playlist, pairing, worker | Deterministic stubs |
| `history.replaceState`, `location.hash/search` | shareLinks, pairing | jsdom plus spies |
| Wake Lock, Fullscreen, `matchMedia`, Clipboard | screen, scale, ui | Stubs (jsdom has no `matchMedia`, wake lock or `Element.animate`) |
| `CSS.escape`, `ResizeObserver`, `requestAnimationFrame` | main, layout, crt | Polyfill or stub; only for the main harness |
| Cloudflare runtime (`DurableObject`, `WebSocketPair`, `WebSocketRequestResponsePair`, `ctx.storage`, `ctx.getWebSockets`, hibernation APIs) | worker | Alias `cloudflare:workers` to a stub, plus a fake `ctx` |

---

## 2. Execution flow analysis

### 2.1 Boot (`initialize`, `main.ts:1669-1699`)

1. `setCommandRunner(runLocalCommand)`.
2. `void setupRemoteControl()` runs without being awaited. It:
   - takes a `?relay=` override;
   - registers the connection, state, command and release listeners;
   - starts the 15 s broadcast interval and the 30 s probe interval;
   - then either joins with a `#pair=` code or calls `connectRoom()`.
3. Screen, layout, scale and resize setup; `renderMixList()`; `renderAll(false)`. **`renderMixList()` reads storage before the YouTube API has loaded** (see D1).
4. `await waitForYouTubeAPI()`, then `playerFactory = createYouTubePlayerFactory()` and `initializeEventListeners()`.
5. If `#pl=` is in the hash: clear the hash, call `handleLoadPlaylist(urls, null)` (which goes through `dispatch`, so **on a remote it goes to the main device**), and return.
6. Otherwise, if a last saved mix exists, has URLs, and `mcRole !== 'remote'`: `runLocalCommand({type:'load_mix', …, mode:'replace'})`. This deliberately skips the route, so it never reaches a main device.

**Ambiguous.** Step 6 depends on timing. If the socket connects and the device becomes a remote *after* step 6, `becomeRemote()` throws the restored mix away (`main.ts:1538`). The comment at `:1694-1695` suggests this is accepted.

### 2.2 Command pipeline

```
dispatch(cmd)                                commands.ts:67
  ├─ cmdRoute?(cmd) === true → return true   (remote: routeToMain, main.ts:1466)
  └─ cmdRunLocally(cmd)                      (runLocalCommand, main.ts:1247)
        ok = !!runCommand(cmd)               (main.ts:854-892)
        if ok && (play|play_all): maybeClaimMain(); clear mcResumeIds
        scheduleBroadcast()                  (always; no-op unless main)
        return ok
```

What each command does in `runCommand` (Observed):

| Command | Guard (returns `false` when…) | Effect |
| --- | --- | --- |
| `play` | Track or controller missing, or `state !== 'paused'` (`:785`) | `controller.play()`, `startPolling()`. State becomes `playing` only when YouTube reports it. |
| `pause` | Missing, or `state !== 'playing'` (`:794`) | `controller.pause()` |
| `play_all` | Never | `play()` on every paused track; `startPolling()` |
| `pause_all` | Never | `pause()` on every playing track |
| `focus` | Unknown track | `setFocus(id)` |
| `step` | Never (no-op with 0 tracks) | Wrap-around focus (`:604-609`) |
| `seek` | No controller (`:813`) | `seekTo(time)` and `currentTime = time`. **No clamping and no state check.** |
| `stop` | No controller | `pause()`, then `seekTrack(id, 0)` |
| `volume` | Unknown track | Clamped to [0, 1] (`:877`), then `setVolume` |
| `loop` | Unknown track | Sets the flag |
| `add` | Invalid URL (`:732-736`) | New track in `loading`; player created; focus set if there was none |
| `remove` | Unknown track | Removed and its controller destroyed; focus moves (2.5) |
| `relink` | Unknown track or invalid URL | Old controller destroyed; track reset; new player keeps volume and repeat (`:757-780`) |
| `load_mix` | Never | `replace`: clear everything, `mixName = name`, add each URL. `append`: add each URL and keep `mixName` (`:847-851, 910-919`). Invalid URLs are skipped one by one, each showing an error. |

### 2.3 Track lifecycle

```
            add / relink / leaveRemote
                    │
                 loading ──onError / TIMEOUT──▶ error (terminal until relink)
                    │ onReady → onMeta (state=paused) → onState('paused')
                    ▼
       ┌────── paused ◀──PAUSED / ENDED── playing ◀──PLAYING──┐
       │         ▲                                            │
       └─play()──┴──────────── (state comes from YT events) ──┘
```

- **Event mapping** (`youtubePlayer.ts:250-262`): PLAYING → `playing`; PAUSED and ENDED → `paused`; BUFFERING, CUED and UNSTARTED → **no callback** (the previous state stays).
- **`onReady`** (`:222-249`) clears the timeout. It then sends `onMeta({id, title||'Unknown Title', author||undefined, hqdefault thumbnail, durationSeconds>0?…})` followed by `onState('paused')`. If `getVideoData` throws, it sends `METADATA_ERROR` instead.
- **Error codes** (`:263-294`): 2 → `INVALID_PARAM`, 5 → `HTML5_ERROR`, 100 → `NOT_FOUND`, 101 and 150 → `EMBED_BLOCKED`, anything else → `UNKNOWN_ERROR`. A 10 s timeout gives `TIMEOUT` (`:199-206`); a constructor throw gives `PLAYER_CREATION_ERROR` (`:297-306`).
- **Controller methods** do nothing before `onReady` (`:144-185`). `setVolume(v)` sends `v * 100`.
- **`onMeta` in `main.ts`** (`:673-689`):
  - sets `state='paused'` and the duration;
  - applies `keep.volume` and `keep.loop` when relinking or taking over;
  - calls `controller.setVolume(track.volume)`;
  - when taking over, sets `currentTime = floor(keep.time)`;
  - if `mcAutoplay` contains the id, removes it and calls `playTrack(id)`.
- **`onTrackState`** (`:702-729`) ignores unknown tracks and tracks in `error`. Otherwise it updates the state and `currentTime`, starts polling on `playing`, and handles the **loop restart**: on `paused` with `loop` on, `duration > 0` and `currentTime >= duration - 1`, it runs `seekTo(0)` and `play()` after 100 ms.

### 2.4 Playback poll (`main.ts:615-655`)

Every 250 ms while any track plays:

- for each playing track with a controller: `currentTime = controller.getCurrentTime()`, and `duration` is replaced only when the controller reports `> 0`;
- if `meta.author` is empty, `fillAuthor` picks it up from `controller.getAuthor()`;
- the timer stops itself when nothing plays (`:633`).

### 2.5 Focus rules

- The first added track becomes the focus if none is set (`:739`).
- **Remove** (`:743-755`): the new focus is `rest[min(removedIndex, rest.length-1)]`, i.e. the next track, or the new last one, or `null`.
- **Step** (`:604-609`): `(i + dir + n) % n`. With no focus (`i = -1`), `dir=+1` gives index 0 and `dir=-1` gives index `n-2` (see D9).
- **Remote** (`:1416`): focus comes from the snapshot (`state.focusedId`).

### 2.6 Mixes, import and share

- **Save** (`main.ts:987-1003`): checks for a name, then for at least one channel; `saveOrUpdatePlaylist(name, urls)` updates in place by exact name and sets `lastPlaylistName`; then `mixName = name`.
- **Load a saved mix or a share link** goes through `handleLoadPlaylist` (`:922-930`). With no channels open it dispatches `replace` straight away. Otherwise a modal asks Replace, Add or Cancel. **Cancel returns `false` and no command is sent.**
- **Import** (`:1010-1039`):
  - text containing `#pair=` → `pairCodeFromText` → `joinWithCode`;
  - otherwise `decodePlaylistFromText`: a share-link payload if there is one, else every `http(s)` link, filtered to YouTube;
  - then `handleLoadPlaylist(urls, null)`. The text stays in the box if the dialog is cancelled.
- **Share** (`:979-985`): `encodePlaylistToUrl(urls)` and copy to the clipboard. There's no `try/catch` around the encoding (see D4).
- **Delete** (`:1045-1058`): needs `confirm()`; if the open mix was deleted, `mixName = null`.

### 2.7 Connection state machine (`remote.ts`)

**States** (`ConnectionState`): `off`, `connecting`, `online`, `offline`.

| Event | Transition |
| --- | --- |
| `connectRoom()` with a stored room and relay | `rcWanted=true`, attempt count reset, `rcOpen()`. `rcOpen` emits `connecting`, or `offline` if the previous state was `online` (`:159`). |
| Socket `open` | Sends `hello{protocol:1, deviceId, name, secret}`; heartbeat `'ping'` every 20 s |
| `welcome` | Attempt count reset; clock offset = `serverTime - Date.now()`; `rcLastState` stored; emit `online`; state listeners called with the snapshot age |
| `devices` | If `mainId` changed, `rcLastState = null`; emit |
| `state` | `rcLastState` updated; listeners called with the age |
| `command` | `rcCommandHandler(cmd, reply)`; the reply sends `ack{id, to: from, ok, error}` |
| `release` | `rcReleaseHandler()` |
| `ack` | Resolves the pending promise with `ok === true`; clears its timer |
| `close` 4001 | `saveRoom(null)`, `rcWanted=false`, emit `off` with `unpaired: true` |
| `close` 4000, or while not wanted | No emit and no retry (see D6) |
| `close` otherwise | Fail pending commands with `offline`; emit `offline`; retry after 1, 2, 5, 10, then every 30 s |
| `visibilitychange` (visible) or `online` | Immediate retry if wanted and there's no socket (`:348-359`) |
| `disconnectRoom()` | Not wanted; timers cleared; socket closed (1000); `rcLastState = null`; pending failed; emit `off` |

**Role derivation** (`rcEmit`, `remote.ts:82-107`), evaluated on every emit:

```
if mainId == me                    → main   (whatever the connection state)
elif state == online               → main online ? remote : idle
elif state == off or prevRole != remote → idle
else (remote, now disconnected)    → remote during the 30 s grace (from the first offline emit), then idle;
                                     a timer at 30.1 s re-emits so the change happens
state == online resets the grace.
```

**Command round trip** (`sendCommand`, `:315-325`): resolves `{ok:false, error:'offline'}` at once if the socket isn't open. Otherwise it waits for the `ack`, or gives `timeout` after 5 s. A late ack is ignored.

### 2.8 Role transitions in the controller (`onConnectionChange`, `main.ts:1571-1585`)

| Previous → new | Action |
| --- | --- |
| any → `remote` | `becomeRemote()`: clear the resume and autoplay sets; stop polling; destroy all tracks and players; install `routeToMain`; start the 500 ms `remoteTick`; apply `lastRoomState()` or render empty; update keep-awake |
| `remote` → `idle` | `leaveRemote()`: remove the route; stop the ticker; recreate players for the mirrored tracks (state `loading`, `startSeconds = currentTime`, volume and repeat kept). Tracks that were playing go into `mcAutoplay` if Play here was requested, otherwise into `mcResumeIds` |
| `remote` → `main` | `leaveRemote()`, then `broadcastNow()` |
| `idle` → `main` | `broadcastNow()` |
| `main` → `main`, coming back online | `broadcastNow()` |
| `idle`, online, something playing | `maybeClaimMain()` (only when idle and online; at most once every 3 s) |

### 2.9 Sync protocol

- **Main device.**
  - `buildRoomState()` (`:1290-1314`) returns `{v:1, seq:++mcSeq, sentAt, mixName, focusedId, tracks[]}`. For playing tracks the time is read live from the controller.
  - Broadcasts are debounced to 150 ms (`scheduleBroadcast`, `:1317-1320`) after every command and every `renderStatus`. There's also a 15 s refresh while anything plays (`:1647-1649`), and an immediate broadcast after a remote command succeeds (`:1529`).
- **Remote device.**
  - `applyRoomState(raw, ageMs)` (`:1388-1430`) replaces the tracks. Playing tracks are moved on by the snapshot's age, **clamped to the duration**. `mixName` and `focusedId` come from the snapshot.
  - The view is patched in place when the shape hasn't changed: same ids, URLs and titles, and "settled" (playing or paused) on both sides. Otherwise it re-renders in full.
  - `remoteTick` (`:1433-1447`) moves playing tracks on every 500 ms from `mcBases`, **wrapping modulo the duration when repeat is on**.
- **Commands from a remote.**
  - `routeToMain` (`:1466-1500`) gives local feedback straight away for focus, step, volume and seek.
  - Volume and seek are throttled per `type:trackId`: the first is sent at once; later ones within 100 ms are combined, and the last value is sent when the 100 ms runs out.
  - `sendToMain` (`:1502-1519`) turns failures into messages: `timeout` → "didn't respond", `no_main` or `offline` → "is offline", a failed `add` or `relink` → "That link has no YouTube video in it.", anything else → "couldn't do that".
- **The main device receiving a command.** `handleRemoteCommand` (`:1522-1530`) checks only that this device is main and that the command is an object with a string `type`. It then runs it and acks.
- **Remote watchdog** (`:1652-1656`): every 30 s, a remote that's online and has had no snapshot for more than 35 s sends `probe`.

### 2.10 Handover ("Play here") across client and relay

```
Remote R: playHere()              main.ts:1357   claimMain(true) → {claim_main, force:true}; mcWantPlayHere=true; 8 s give-up timer
Relay:    claim_main(force)       index.ts:318   store handover{to:R, deadline:+3 s}; send 'release' to main M; alarm at the deadline
Main M:   releaseMain()           main.ts:1333   sendState(final=true) (still showing what plays), mcReleasing=true, pause all, stop polling;
                                                 after 6 s, if still main: mcReleasing=false and broadcast
Relay:    state(final)            index.ts:346   store and forward; completeHandover(R): mainId=R; broadcast devices
          or alarm at deadline    index.ts:411   completeHandover(R) even without a final state
R:        devices(mainId=R)       remote.ts:200  role main → leaveRemote() with mcWantPlayHere → mcAutoplay = what was playing
                                                 → players created at those times; playTrack once each is ready; broadcastNow
M:        devices(mainId=R)                      role remote → becomeRemote()
```

Timers involved: relay handover 3 s, old-main fallback 6 s, requester notice 8 s. **Inferred:** if the relay alarm fires before M's final state arrives, R starts from the positions in its last mirrored snapshot rather than the final ones.

### 2.11 Failure modes

- **Main device goes offline** (relay still up): the remote sees the main offline, its role becomes `idle`, and `leaveRemote()` takes the mix over paused. `mcResumeIds` are offered through Play here; Play here then plays the paused ones and queues the loading ones in `mcAutoplay` (`resumeHere`, `:1379-1385`).
- **Relay goes away**: the main stays main (`mainId == me` wins). A remote stays a remote for 30 s, then becomes idle and takes the mix over. The badge shows "Disconnected".
- **Two idle devices playing when the relay comes back**: both claim main. The relay grants the first; the second gets `claim_denied`, which the client **doesn't handle** (no case at `remote.ts:192-226`). The second then becomes a remote and **its own mix is discarded** (`becomeRemote`). See D15.

### 2.12 Relay internals (`worker/src/index.ts`)

- **HTTP** (`:98-166`):
  - only origins listed in `ALLOWED_ORIGINS` are accepted (403 otherwise, also for `OPTIONS`);
  - `POST /rooms`; `POST /rooms/:id/{codes|rotate}` (needs a secret of at least 16 characters that matches the stored hash, else 403 `unpaired`); `POST /pair/:code` (code uppercased; 429 `slow`; 404 `code`); `GET /rooms/:id/ws` (426 without `Upgrade`);
  - any thrown error gives 500 `server`.
- **Room WebSocket** (`:230-386`):
  - binary messages or messages over 64 KB close the socket with 1009;
  - the first message must be `hello` (else 4003). A wrong secret sends `error`, then closes with 4001. A device id must match `[A-Za-z0-9_-]{8,40}` (else 4003). A 13th new device is refused (4004). An older socket from the same device is closed with 4000;
  - after authentication, each message counts against a limit of 40 per second (`allow`) and triggers `sweep()`, which closes sockets that haven't answered a heartbeat for 70 s (4005).
- **Alarms**: a handover past its deadline is completed. A room with no sockets and no activity for 90 days is deleted (`deleteAll`).
- **Pairing**:
  - codes are 6 characters from a 31-character alphabet and last 10 minutes;
  - redeeming allows 10 tries per minute per IP (the 11th gives `slow`), deletes the code on first use, and treats an expired code as unknown;
  - the alarm removes expired codes.

### 2.13 Timers

| Timer | Where | Duration |
| --- | --- | --- |
| Player load timeout | `youtubePlayer.ts:199` | 10 s |
| Playback poll | `main.ts:647` | 250 ms |
| Loop restart delay | `main.ts:723` | 100 ms |
| Snapshot debounce | `main.ts:1319` | 150 ms |
| Periodic snapshot | `main.ts:1647` | 15 s (main, while playing) |
| Remote probe check | `main.ts:1652` | 30 s (probe if the snapshot is over 35 s old) |
| Remote tick | `main.ts:1542` | 500 ms |
| Slider throttle | `main.ts:1483` | 100 ms |
| Release fallback | `main.ts:1344` | 6 s |
| Play-here give-up | `main.ts:1363` | 8 s |
| Badge notice | `main.ts:1631` | 4 s |
| Claim rate limit | `main.ts:1263` | 3 s |
| `showError` clear | `ui.ts:357` | 5 s |
| Button flash | `main.ts:941` | 1.8 s |
| Reconnect backoff | `remote.ts:56` | 1, 2, 5, 10, 30 s |
| Heartbeat | `remote.ts:57` | 20 s |
| Command timeout | `remote.ts:58` | 5 s |
| Remote grace | `remote.ts:75` | 30 s (re-emits at 30.1 s) |
| Pairing code countdown | `devices.ts:166` | 1 s tick |
| Unpair delay | `devices.ts:249` | 150 ms |
| Device-list refresh | `devices.ts:274` | 60 s |
| Relay handover | `index.ts:43` | 3 s |
| Relay stale socket | `index.ts:41` | 70 s |
| Room TTL | `index.ts:45` | 90 days |
| Code TTL | `index.ts:32` | 10 min |

---

## 3. Testability assessment

### 3.1 How each unit can be tested

| Unit | Class | How |
| --- | --- | --- |
| `extractVideoId`, `isValidYouTubeUrl` | Pure | Direct |
| `PlaylistManager` | Pure class | Direct; stub `crypto.randomUUID` |
| `dispatch` / `setCommandRunner` / `setCommandRoute` | Module singleton | `vi.resetModules()` and a dynamic import per test |
| `storage.ts` | Pure plus `localStorage` | jsdom storage, cleared between tests |
| `shareLinks.ts` | Pure plus `location` and `history` | Set `location.hash`; spy on `replaceState` |
| `ui.ts` (`esc`, `pad2`, `formatHMS`, `formatTime`, `clockParts`, `formatDb`, `stateInfo`, `trackTitle`, escaping in templates, `showError`, `copyToClipboard`) | Pure or lightly DOM-bound | Direct; fake timers for `showError` |
| `pairing.ts` | Pure plus storage, `fetch`, `location` | Stubs; `navigator.userAgent` overrides |
| `qr.ts` | Pure | Direct; a QR decoder as the oracle |
| `remote.ts` | Stateful; WebSocket and timers | `FakeWebSocket`, fake timers, `resetModules` |
| `youtubePlayer` factory | Callbacks and a global `YT` | `vi.stubGlobal('YT', FakeYT)`; fake timers |
| `screen.ts` | Stateful; browser APIs | Fake `navigator.wakeLock`, document fullscreen properties, `matchMedia` |
| `scale.ts`, `layoutPref.ts` | Small, stateful | Stubs; `resetModules` for `choiceCache` |
| `devices.ts` (`dvSeen`, label logic, `joinWithCode`) | Private logic mixed with DOM | `joinWithCode` can be tested by mocking `pairing.js` and `remote.js` and providing the `#devicesMessage` element. `dvSeen` and the label logic need extracting (R4). |
| `screenFx.ts` (`loadScreenState`, `turn`) | Private, inside a DOM closure | Extract (R5) |
| `accent.ts` (`extractAccent`, `isSquareArt`) | Pixel logic behind canvas | Extract into pixel-array functions (R6), or use the `canvas` npm package |
| `crt.ts` (`crtCover`, `crtColor`, `crtNum`) | Private, pure | Export (R6); low value |
| **`main.ts`** | **Not importable in isolation** | Option A: a characterization harness with no code changes (3.4). Option B: extract the pure logic (R1–R3). |
| `worker/src/index.ts` | Durable Object classes plus pure helpers | Alias `cloudflare:workers` to a stub, a fake `ctx`, and `worker.fetch(new Request(...), env)` |
| `layout.ts`, `resize.ts` (except clamping), `backdrop.ts`, `paintCrt` | Presentation | **Out of scope** |

### 3.2 Obstacles

1. **Side effects at import.**
   - `main.ts` queries the DOM (`:111-156`) and calls `initialize()` (`:1701`) as soon as it's imported.
   - `layout.ts:41-51` throws without its DOM (`lSlides.querySelectorAll` on `null`).
   - `backdrop.ts` starts a `setInterval` and creates an `Image` at import.
   - `screen.ts` adds a document listener.
2. **Module-level singletons**: `commands.ts`, `remote.ts`, `layoutPref.ts` (`choiceCache`), `ui.ts` (`errorTimer`), `screen.ts` (`lock`, `wanted`) and every `mc*` variable in `main.ts`. Each test needs fresh module instances (`vi.resetModules()` plus `await import()`), or a reset hook.
3. **Private functions that hold the business rules**:
   - in `main.ts`: `runCommand`, `applyRoomState`, `remoteTick`, `routeToMain`, `buildRoomState`, `renderRemoteBadge`'s decisions, `sendToMain` messages;
   - elsewhere: `rcEmit`'s role rule, `dvSeen`, `loadScreenState`, accent's colour maths, `crtCover`.
4. **The bare global `YT`**: `youtubePlayer.ts:210, 253-257` uses `YT.Player` and `YT.PlayerState`, not `window.YT`, so the stub must be on `globalThis`.
5. **Clocks**: `Date.now()` (throttle, claim limit, grace, clock offset, relay) and `performance.now()` (remote bases) are both used. Vitest's fake timers must be set to fake both (`toFake: [..., 'performance', 'Date']`).
6. **Browser APIs jsdom lacks**: `matchMedia`, `navigator.wakeLock`, `Element.animate` (called by `swapText` and `renderStage` unless reduced motion is reported), `CSS.escape`, `ResizeObserver`, and perhaps `requestAnimationFrame`.
7. **Build constraints**:
   - `tsconfig.json` compiles `src/**/*` into `dist/`. Tests should live outside `src/` (for example `test/`) with their own tsconfig, so `npm run build` stays the same.
   - Code moved into new modules has to be added to `bundle.js`'s `files` list, and top-level names must stay unique.
8. **Specifiers**: modules import each other as `./x.js`. Vitest (through Vite) resolves these to the `.ts` sources; check this once during setup.
9. **The worker** imports `cloudflare:workers` and uses `WebSocketPair` and `WebSocketRequestResponsePair` as globals.

### 3.3 Test doubles and fixtures

| Double | Shape |
| --- | --- |
| `FakeYT` | `Player` class: records `(element, options)` in `FakeYT.instances`; methods `playVideo`, `pauseVideo`, `seekTo`, `setVolume`, `getVolume`, `getCurrentTime`, `getDuration`, `getVideoData`, `destroy` as `vi.fn`; helpers `ready()`, `state(code)` and `error(code)` that call `options.events.*`. `PlayerState = {UNSTARTED:-1, ENDED:0, PLAYING:1, PAUSED:2, BUFFERING:3, CUED:5}`. |
| `FakeController` (for `main.ts`) | Implements `YouTubePlayerController` with `vi.fn` and settable `time`, `duration` and `author` |
| `FakePlayerFactory` | `createPlayer(...)` records `{trackId, videoId, onMeta, onState, onError, startSeconds}` and returns a `FakeController`; helpers to fire `meta(id)`, `state(id, s)` and `error(id, e)` |
| `FakeWebSocket` | Statics 0–3; `url`, `readyState`, `sent[]`, `send`, `close(code, reason)`, `addEventListener`; test-side `serverOpen()`, `serverMessage(obj or string)`, `serverClose(code)`; `FakeWebSocket.instances` |
| `fetchMock` | `vi.fn` returning `Response` objects (Node 22 has `Response`) |
| Storage | jsdom `localStorage`, plus a variant where `getItem`/`setItem` throw (`vi.spyOn(Storage.prototype, ...)`) |
| `matchMedia` stub | A map from query to `matches` (`(pointer: coarse)`, `(prefers-reduced-motion: reduce)`, `(display-mode: …)`) |
| Wake lock | `navigator.wakeLock.request` returns controllable deferred sentinels with `release` and `addEventListener('release')` |
| `FakeRemote` (for `main.ts`) | A mock of `remote.js` that keeps the `onConnection`, `onRoomState`, `onRemoteCommand` and `onRelease` callbacks; `claimMain`, `sendState`, `sendProbe` and `sendCommand` as spies; `lastRoomState` and `pendingCommands` stubs; and an `emit(status)` helper |
| Track fixture | `makeTrack(overrides)` returning a full `Track`; `makeStatus(overrides)` returning a `ConnectionStatus` |
| Worker `FakeCtx` | `storage`: a Map with `get(key or keys)`, `put(key, value)` and `put(object)`, `delete`, `deleteAll`, `list({prefix})`, `getAlarm`, `setAlarm`. Also `getWebSockets()`, `acceptWebSocket`, `setWebSocketAutoResponse`, `getWebSocketAutoResponseTimestamp(ws)` |
| Worker `FakeServerSocket` | `send`, `close`, `readyState`, `serializeAttachment`, `deserializeAttachment`, `sent[]`, `closed` |
| `cloudflare:workers` stub | `export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }`; global `WebSocketRequestResponsePair` and `WebSocketPair` stubs |

### 3.4 A characterization harness for `main.ts` (no code changes)

`main.ts` can be driven as a black box before any refactor:

1. Load the `<body>` of `index.html` into jsdom before importing `main.ts`.
2. Mock the presentation and platform modules:
   - `layout.js`, `crt.js`, `backdrop.js`, `screenFx.js`, `resize.js`, `accent.js` and `screen.js` as `vi.fn` stubs (`crt.js` must keep `FX_CHANGE_EVENT`);
   - `devices.js` as `{setupDevicesPanel, joinWithCode}` stubs;
   - `remote.js` as `FakeRemote`;
   - `youtubePlayer.js` as a partial mock: the real `extractVideoId` and `isValidYouTubeUrl`, a `waitForYouTubeAPI` that resolves immediately, and `createYouTubePlayerFactory` returning `FakePlayerFactory`;
   - `ui.js` as a partial mock with `prefersReducedMotion → true` (no `animate`) and a controllable `showReplaceAppendModal`.
3. Polyfill `CSS.escape`. Use fake timers. `await import('../src/main.ts')`, then flush microtasks.
4. Drive it with `dispatch()` from the same `commands.js` instance, with the factory callbacks, and with `FakeRemote.emit(...)`.
5. Observe it through:
   - calls to `FakeController` and `FakeRemote`;
   - `dispatch` return values;
   - the snapshot sent with `sendState` while in the main role: `buildRoomState()` exposes the whole model (tracks, states, times, volumes, repeat, focus, mix name), so it works as the state probe.

   Don't assert on markup.

This harness can pin current behaviour before the extractions in section 7. Once a `debugState()` seam exists (R0), it becomes simpler.

---

## 4. Existing coverage and gaps

### 4.1 What exists

- **No tests at all.** There's no test framework in `package.json` (only `typescript`) or in `worker/package.json` (`wrangler`, `typescript` and `@cloudflare/workers-types`). There's no `test` script, no test files and no CI configuration (the repository has no `.github/`).
- **The only automated check** is type-checking: `tsc` with `strict`, `noUnusedLocals` and friends, and `worker`'s `npm run check`.
- `docs/remote-control-plan.md:415-418` says "the Room Durable Object's message handling is plain TypeScript; **a few unit tests cover role claims, handover timeouts and wrong secrets**." **No such tests are in the repository.** Either they were never written or they were lost; the owner should confirm.

### 4.2 Gaps, ranked by risk

1. Remote-control roles, handover and failure paths, on both client and relay. These are the most complex and timing-dependent parts, with several cooperating timers.
2. Track lifecycle and command semantics in `main.ts`: guards, the loop restart, relink keeping settings, focus after removal.
3. YouTube adapter: event and error mapping, timeout.
4. Persistence and sharing formats: saved mixes, share links, import parsing. These are user data and cross-device contracts.
5. Pairing: code parsing, relay error mapping, the localhost-only relay override (a security rule).
6. Escaping: `esc()` and its use in templates is the XSS guard for titles, channel names and mix names that come from outside.
7. Wake-lock handling, settings modules and the QR encoder.

### 4.3 Behaviour found during analysis that tests should pin

The owner should decide on the **Ambiguous** rows. For likely defects, I suggest writing a test of the current behaviour marked `it.fails`, or as a named `it.todo`, so the decision stays visible.

| ID | Finding | Type | Where | Suggested treatment |
| --- | --- | --- | --- | --- |
| D1 | `loadStoredData` doesn't check the shape and has no `try/catch` around `localStorage`. With stored `"null"`, `getAllPlaylists()` throws (`null.playlists`); with `{}` it returns `undefined` and `renderSavedPlaylists` throws on `.length`. Either way `initialize()` stops at `renderMixList()` (`main.ts:1679`), before any event listener is attached. A throwing `localStorage` has the same effect. Every other module guards storage access. | Observed defect candidate (high impact, low likelihood) | `storage.ts:20-28, 76-78` | Characterize; propose validation |
| D2 | `showError` uses **one** `errorTimer` for every element. `showError(A)` followed by `showError(B)` within 5 s cancels A's clear, so A's message never goes away. | Observed defect candidate | `ui.ts:351-361` | `it.fails`, then a per-element timer |
| D3 | `setKeepAwake(true)` called twice before the first `request()` resolves makes two requests (`lock` is still `null`). The first sentinel is overwritten and never released. `updateKeepAwake` runs on every `renderStatus` (`main.ts:326`), for example once per channel when Play all starts several channels, so the calls overlap in normal use. **Inferred:** after a pause, the screen can stay awake until the page is hidden. | Observed race | `screen.ts:92-110` | `it.fails`, then an in-flight guard |
| D4 | `encodePlaylistToUrl` uses `btoa`, which throws `InvalidCharacterError` for any URL with characters outside Latin-1 (confirmed in Node: `…?x=日本` throws; `ä` works). The Share handler has no `catch`, so the user sees nothing. | Observed defect candidate | `shareLinks.ts:13`; `main.ts:979-985` | Characterize; propose UTF-8 encoding |
| D5 | If storage is unavailable, `thisDevice()` makes a **new random id on every call**, because `writeJson` swallows the error. `rcEmit` compares `mainId === thisDevice().id` on every emit (`remote.ts:85-88`), so the device would never recognise itself as main. | Observed mechanism; inferred impact | `pairing.ts:120-126` | Characterize; propose an in-memory fallback like `layoutPref`'s cache |
| D6 | On close code 4000 ("replaced by a newer connection from this device") the client doesn't emit or retry. That tab keeps `state:'online'` and its old role. If it was main, its `sendState` calls fail silently because `rcSend` returns `false`. | Observed; Ambiguous | `remote.ts:241-245` | Ask the owner; characterize |
| D7 | The remote's time projection isn't consistent: `applyRoomState` clamps playing time to the duration, but `remoteTick` wraps it modulo the duration when repeat is on. | Observed | `main.ts:1411` vs `:1441` | Characterize; align them |
| D8 | The loop restart runs on **any** pause in the last second of a repeating track, including a pause the user asked for. It also captures the controller, so after a relink within 100 ms it acts on the destroyed one (harmless: those calls do nothing). | Observed | `main.ts:719-728` | Characterize; Ambiguous |
| D9 | `step -1` with no focus selects index `n-2`, not the last track (`(-1-1+n)%n`; with `n=3` that's index 1). | Observed (checked) | `main.ts:604-609` | Characterize; low |
| D10 | `load_mix` in `append` mode, and any add or remove, keeps `mixName`, so the status shows a saved name for a mix that has changed. | Observed; Ambiguous | `main.ts:847-851` | Ask the owner |
| D11 | Commands from remotes are only checked for a string `type`. `{type:'volume', trackId}` with no volume gives `NaN` (clamping doesn't help) and calls `controller.setVolume(NaN)`. `{type:'load_mix'}` with no `urls` throws inside the socket handler, so no ack is sent and the remote waits for its 5 s timeout. A `null` command is answered `not_main`, which is misleading. | Observed | `main.ts:1522-1530` | Characterize; propose `validateCommand` (R3) |
| D12 | The remote's local feedback for volume doesn't clamp, unlike `runCommand`. | Observed | `main.ts:1471` vs `:877` | Low |
| D13 | Snapshots carry `seq`, `sentAt` and `v`, but `applyRoomState` never checks them, so there's no guard against stale or out-of-order snapshots. Ordering relies on there being one socket. | Observed; Ambiguous | `main.ts:1290-1296, 1388` | Ask the owner |
| D14 | `joinWithCode` sends `leave` and disconnects straight away, while Unpair waits 150 ms first so `leave` gets through. **Inferred:** the old room may never receive the `leave`. | Observed difference | `devices.ts:184-185` vs `:248-249` | Characterize |
| D15 | `claim_denied` from the relay isn't handled. When two idle devices that are both playing reconnect, the one that loses becomes a remote and its own mix is discarded. | Observed; Ambiguous (the README says other devices become remotes) | `index.ts:327`; `remote.ts:192-226`; `main.ts:1538` | Ask the owner; pin with a test |
| D16 | On `welcome`, the snapshot is applied twice: once by `becomeRemote()` through `lastRoomState()`, then again by the state listeners. Harmless, but tests that count calls must expect it. | Observed | `remote.ts:197-198` | Characterize |
| D17 | `extractVideoId` accepts `youtu.be/ID/extra` and returns `"ID/extra"`. It rejects `/shorts/`, `/embed/`, `/live/` and `youtube-nocookie.com`. It doesn't check the ID format, and a URL without a scheme is rejected. | Observed (checked) | `youtubePlayer.ts:316-336` | Characterize; ask about shorts and live |
| D18 | `decodePlaylistFromLocation` doesn't filter to YouTube URLs, unlike `decodePlaylistFromText`. Invalid entries each call `showError` later, and because of D2 only the last message shows. | Observed | `shareLinks.ts:25-29` | Characterize |
| D19 | `formatDb(NaN)` returns `"NaN dB"`; `formatHMS` gives three-digit hours at 100 h and above. | Observed | `ui.ts:25-53` | Low |
| D20 | After a relay `rotate`, the device that asked for it gets close code 4001, which runs `saveRoom(null)`. Whether `devices.ts:264` (`saveRoom(await rotateRoom(room))`) runs first depends on timing. Both orders end paired to the new secret, but one briefly shows "unpaired from another device". | Inferred race | `index.ts:217-220`; `remote.ts:234-239`; `devices.ts:259-271` | P3 test for both orders |
| D21 | The relay completes a handover to its target even if that device is now offline, leaving `mainId` pointing at an offline device so every device is idle. | Observed | `index.ts:411-431` | Characterize |
| D22 | `index.ts:314-315` repeats a comment line. | Nit | | None |

---

## 5. Proposed test cases

Suggested layout: `test/unit/<module>.test.ts` for the client, `worker/test/<area>.test.ts` for the relay, and shared doubles in `test/fakes/`.

### T1. URL parsing: `youtubePlayer.ts` `extractVideoId` / `isValidYouTubeUrl` (P1)

| ID | Input | Expected |
| --- | --- | --- |
| T1.1 | `https://www.youtube.com/watch?v=abc123`, and the same on `youtube.com`, `m.youtube.com` and `music.youtube.com` | `abc123` |
| T1.2 | `…/watch?v=abc&t=30s&list=PL1` | `abc` |
| T1.3 | `…/watch?v=ID&v=OTHER` | `ID` (first value) |
| T1.4 | `https://youtu.be/ID`, `https://youtu.be/ID?si=x&t=5` | `ID` |
| T1.5 | `https://WWW.YouTube.com/watch?v=ID`, `http://youtube.com/watch?v=ID` | `ID` (host is normalised; `http` is allowed) |
| T1.6 | `https://youtu.be/ID/extra` | `ID/extra` (**pins D17**) |
| T1.7 | `/shorts/ID`, `/embed/ID`, `/live/ID`, `youtube-nocookie.com/embed/ID` | `null` (pins D17) |
| T1.8 | `…/watch?v=`, `https://youtu.be/`, `youtube.com/watch?v=ID` (no scheme), `''`, `not a url`, `https://vimeo.com/1` | `null` |
| T1.9 | `isValidYouTubeUrl` for every input above | `extractVideoId(x) !== null` |

### T2. YouTube player adapter: `createYouTubePlayerFactory` (P1)

Setup: `vi.stubGlobal('YT', FakeYT)`, fake timers, and `window.location.origin` from jsdom.

| ID | Scenario | Expected |
| --- | --- | --- |
| T2.1 | Create without `startSeconds` | `YT.Player(el, {videoId, width:1, height:1, playerVars:{autoplay:0, controls:0, enablejsapi:1, origin}})` with **no** `start` key |
| T2.2 | `startSeconds` 12.9, 0 and −3 | `start: 12`; no `start`; no `start` |
| T2.3 | Before ready | `play`, `pause`, `seekTo` and `setVolume` don't call the player; `getCurrentTime()` and `getDuration()` return 0; `getAuthor()` returns `''` |
| T2.4 | `ready()` with data `{video_id:'v', title:'T', author:'A'}`, duration 125 | `onMeta('t1', {id:'v', title:'T', author:'A', thumbnailUrl:'https://img.youtube.com/vi/v/hqdefault.jpg', durationSeconds:125})`, **then** `onState('t1','paused')` (check the order) |
| T2.5 | `ready()` with empty title and author, duration 0 | `title:'Unknown Title'`, `author: undefined`, `durationSeconds: undefined` |
| T2.6 | `ready()` where `getVideoData` throws | `onError({code:'METADATA_ERROR'})`; no `onMeta`, no `onState` |
| T2.7 | After ready: `setVolume(0.42)`, `seekTo(30)` | `player.setVolume(42)`, `player.seekTo(30, true)` |
| T2.8 | `getAuthor()` after ready when `getVideoData` throws, or the author is missing | `''` |
| T2.9 | `state(PLAYING)`, `state(PAUSED)`, `state(ENDED)` | `playing`, `paused`, `paused` |
| T2.10 | `state(BUFFERING)`, `state(CUED)`, `state(UNSTARTED)` | No `onState` call |
| T2.11 | `error(2)`, `error(5)`, `error(100)`, `error(101)`, `error(150)`, `error(999)` | `INVALID_PARAM` "Invalid video ID"; `HTML5_ERROR`; `NOT_FOUND`; `EMBED_BLOCKED` ×2; `UNKNOWN_ERROR` "Cannot load this video" |
| T2.12 | Advance 10,000 ms with no ready | `onError({code:'TIMEOUT'})` exactly once |
| T2.13 | Ready at 5 s, then advance to 15 s | No `TIMEOUT` |
| T2.14 | `error(150)` at 1 s, then advance to 15 s | One `EMBED_BLOCKED` and no `TIMEOUT` |
| T2.15 | `destroy()` before the timeout | `player.destroy()` once; no `TIMEOUT`; a second `destroy()` does nothing |
| T2.16 | `YT.Player` constructor throws | `onError({code:'PLAYER_CREATION_ERROR'})`; no `TIMEOUT` later; the controller is returned and its methods do nothing |
| T2.17 | `waitForYouTubeAPI` when `window.YT.Player` exists | Resolves without setting `onYouTubeIframeAPIReady` |
| T2.18 | `waitForYouTubeAPI` when it doesn't | Pending until `window.onYouTubeIframeAPIReady()` is called (note that this overwrites any existing callback) |

### T3. `PlaylistManager` (P1)

| ID | Scenario | Expected |
| --- | --- | --- |
| T3.1 | `addTrack(url, vid)` with `randomUUID` stubbed | `{id, url, videoId, state:'loading', currentTime:0, volume:1, isMuted:false, loop:true}`, added at the end |
| T3.2 | `updateTrack` with a known id and `{state:'paused', meta: undefined}` | Fields merged; `meta` explicitly `undefined` (`reloadTrack` relies on this) |
| T3.3 | `updateTrack` / `removeTrack` with an unknown id | No-op; doesn't throw |
| T3.4 | `removeTrack` with a controller set | Track gone; `controller.destroy()` once; `getController(id)` returns `undefined` |
| T3.5 | `clearTracks` with controllers, including one for an id that has no track | Every controller destroyed; empty |
| T3.6 | `replaceTracks(list)` then mutate `list[0]` | The manager's copy doesn't change (shallow copy); earlier controllers destroyed |
| T3.7 | `getTrackUrls` | URLs in order |
| T3.8 | `hasPlayingTracks` | `true` only if some track is `playing` |
| T3.9 | Array from `getTracks()` before and after `removeTrack` | The old array still has the removed track (a new array is made). Document this for callers. |

### T4. Command routing: `commands.ts` (P1)

Use a fresh import for each test.

| ID | Scenario | Expected |
| --- | --- | --- |
| T4.1 | No runner, no route | `dispatch(cmd) === false` |
| T4.2 | Runner returns `true` or `false` | The same value; the runner gets the same object |
| T4.3 | Route returns `true` | `true`; the runner isn't called |
| T4.4 | Route returns `false` | The runner is called |
| T4.5 | `setCommandRoute(null)` after a route was set | Runs locally again |
| T4.6 | The runner throws | The error propagates (characterize) |

### T5. Saved mixes: `storage.ts` (P1)

| ID | Scenario | Expected |
| --- | --- | --- |
| T5.1 | Empty storage | `loadStoredData()` returns `{playlists:[]}`; `getAllPlaylists()` returns `[]`; `getLastPlaylist()` returns `undefined` |
| T5.2 | Invalid JSON | The default `{playlists:[]}` |
| T5.3 | `saveOrUpdatePlaylist('A', [u1])` | Stored `{playlists:[{name:'A', urls:[u1]}], lastPlaylistName:'A'}` |
| T5.4 | Save `A`, then `B`, then `A` again with new URLs | `A` updated in place (order `A`, `B` kept); `lastPlaylistName:'A'` |
| T5.5 | Names that differ in case (`Rain`, `rain`) | Two entries (matching is case-sensitive) |
| T5.6 | `deletePlaylist` of the last mix vs another one | Removed; `lastPlaylistName` deleted only when it matched |
| T5.7 | Delete a name that doesn't exist | No throw; the data is written back unchanged |
| T5.8 | `lastPlaylistName` points at a deleted name | `getLastPlaylist()` returns `undefined` |
| T5.9 | Stored `"null"`, `{}` and `{"playlists":"x"}` | **Current behaviour** (D1): throws, `undefined`, string. Use `it.fails` for the desired "falls back to `{playlists:[]}`" |
| T5.10 | `localStorage.getItem` throws | Current: the error propagates (D1) |
| T5.11 | Contract | Only URLs are saved: no volume, repeat or names per channel |

### T6. Share links: `shareLinks.ts` (P1)

| ID | Scenario | Expected |
| --- | --- | --- |
| T6.1 | `encodePlaylistToUrl([u1,u2])` with location `https://h/p/?q=1#old` | `https://h/p/?q=1#pl=<payload>`; the payload matches `/^[A-Za-z0-9_-]+$/` (no `+`, `/` or `=`) |
| T6.2 | Round trip: encode, set `location.hash` to it, decode | Deep-equal to the input, including URLs whose standard base64 would contain `+`, `/` or padding |
| T6.3 | Latin-1 characters (`…?x=ä`) | Round trip works |
| T6.4 | Characters outside Latin-1 (`…?x=日本`) | Current: throws `InvalidCharacterError` (**D4**) |
| T6.5 | `decodePlaylistFromLocation` with no hash, `#pair=ABC123` or `#x` | `null` |
| T6.6 | Payload that isn't valid base64, or JSON that's an object or string | `null` |
| T6.7 | Payload of `["a", 1, null, "b"]` | `["a","b"]`: non-strings dropped, **non-YouTube strings kept** (D18) |
| T6.8 | `decodePlaylistFromText` with text that contains a share link | That link's URLs, filtered to YouTube |
| T6.9 | Text with a share link whose payload is broken, plus plain YouTube links | `null`: no fallback to the plain links (characterize) |
| T6.10 | Plain links separated by spaces, commas, semicolons, new lines and quotes, and inside `<…>` | All YouTube links in order; delimiters not included |
| T6.11 | Text with only non-YouTube links, or no links | `null` |
| T6.12 | `clearPlaylistHash` with `#pl=…` | `history.replaceState(null, '', pathname + search)` |
| T6.13 | `clearPlaylistHash` with another hash | No `replaceState` call |

### T7. UI helpers: `ui.ts` (P1 for `esc`, P2 for the rest)

| ID | Scenario | Expected |
| --- | --- | --- |
| T7.1 | `esc('&<>"\'')` | `&amp;&lt;&gt;&quot;&#39;`; `esc('&lt;')` gives `&amp;lt;` (`&` handled first) |
| T7.2 | `channelRowHtml` with a title, author, URL and id containing `"><img src=x onerror=alert(1)>` | No raw `<img src=x` or unescaped `"` from the input anywhere in the output (escaping rule, not layout) |
| T7.3 | `renderSavedPlaylists` with a mix name containing `"` and `<` | Escaped in text and in `data-mix-name` / `data-playlist-name` |
| T7.4 | `pad2`: 0, 5.9, 123 | `00`, `05`, `123` |
| T7.5 | `formatHMS`: 0, 59, 3661.7, −1, NaN, Infinity, 360000 | `00:00:00`, `00:00:59`, `01:01:01`, `00:00:00` ×3, `100:00:00` |
| T7.6 | `formatTime`: 0, 65, 3600, 3725, −5, NaN | `0:00`, `1:05`, `1:00:00`, `1:02:05`, `0:00`, `0:00` |
| T7.7 | `formatDb`: 1, 0.5, 0.9999, 0.001, 0, NaN | `0.0 dB`, `−6.0 dB` (U+2212), `0.0 dB`, `−∞ dB`, `−∞ dB`, `NaN dB` (D19) |
| T7.8 | `stateInfo` for all four states | Playing/live, On hold/idle, Loading/busy, Unavailable/warn |
| T7.9 | `trackTitle`: error with a message; error without; loading without meta; loading with meta; paused without meta | The message; "This video cannot play here"; "Loading channel"; the meta title; "Untitled video" |
| T7.10 | `channelRowHtml` state rules | Toggle and volume `disabled` for `loading`/`error`; volume shown as `Math.round(volume*100)` |
| T7.11 | `showError(el, 'x')`, then 5,000 ms | Text set, then `''` |
| T7.12 | `showError(el,'a')` at 0, `showError(el,'b')` at 3 s | `'b'` stays until 8 s |
| T7.13 | `showError(A,'a')`, then `showError(B,'b')` at 1 s; advance 10 s | **Current:** A still shows `'a'` (D2). `it.fails` for "A clears at 5 s" |
| T7.14 | `copyToClipboard` when `writeText` resolves or rejects | `true` / `false` |

### T8. Pairing: `pairing.ts` (P1 for the relay-address rules, P2 for the rest)

| ID | Scenario | Expected |
| --- | --- | --- |
| T8.1 | `pairCodeFromText('https://x/#pair=abc123')` | `ABC123` |
| T8.2 | `'abc 123'`, `'ABC-123'`, `' abc123 '` | `ABC123` |
| T8.3 | `'abc12'`, `'abc1234'`, `'#pair=abc1234'`, `'ab!123'` | `null` |
| T8.4 | `'…#pair=abc123 please'` | `ABC123` |
| T8.5 | `takePairCodeFromLocation` with hash `#pair=abc123` | `ABC123`; `replaceState(null, '', pathname + search)` |
| T8.6 | Hash `#pair=abc123&x`, or none | `null`; no `replaceState` |
| T8.7 | `relayUrl`: stored override `http://localhost:8787` | That override |
| T8.8 | Stored override `https://evil.example` | Ignored; the `<meta>` is used (**security rule**) |
| T8.9 | Meta `https://relay.example/` | `https://relay.example` |
| T8.10 | Meta `http://relay.example`, empty, or missing | `''` |
| T8.11 | `takeRelayOverride` with `?relay=http://127.0.0.1:8787/&a=1#h` | Stored without the trailing slash; `replaceState(..., pathname + '?a=1' + '#h')` |
| T8.12 | `?relay=https://evil.example` | Not stored; the `relay` parameter is still removed |
| T8.13 | `?relay=off` or `?relay=` | Stored override removed |
| T8.14 | No `relay` parameter | No `replaceState` |
| T8.15 | `thisDevice()` on first run with `getRandomValues` stubbed | id of 16 base64url characters (12 bytes), name from the UA; saved; a second call returns the same |
| T8.16 | Stored `{id:1}` or `'garbage'` | Regenerated |
| T8.17 | Storage `setItem` throws | **Current:** a different id on each call (D5) |
| T8.18 | `defaultDeviceName` by UA (through `thisDevice`): Edge on Windows; Chrome on Android (UA has `Linux`); Safari on iPhone; `Macintosh` with `maxTouchPoints=5` | `Edge on Windows`; `Chrome on Android`; `Safari on iPhone`; `… on iPad` |
| T8.19 | Same, continued: `Macintosh` with `maxTouchPoints=0`; `navigator.brave` set; unknown UA | `… on Mac`; `Brave on …`; `Browser on this device` |
| T8.20 | `renameThisDevice('  x  ')`, a 50-character name, `'   '` | `'x'`; first 40 characters; the default name. The id doesn't change |
| T8.21 | `storedRoom` with an invalid shape; `saveRoom(null)` | `null`; the key is removed |
| T8.22 | `relayPost` with no relay | Rejects "Remote control is not set up…" |
| T8.23 | `fetch` rejects | "Couldn't reach the relay…" |
| T8.24 | Not OK with `{error:'code'}`, `'slow'`, `'unpaired'`, another value, or a body that isn't JSON | The matching message, or "The relay had a problem. Try again." |
| T8.25 | OK response | Returns the parsed body. Request is `POST` with `content-type: application/json`; the body is `undefined` for `createRoom` and `redeemPairingCode`, and `{secret}` for codes and rotate |
| T8.26 | Path encoding | `roomId` and `code` pass through `encodeURIComponent` |
| T8.27 | `rotateRoom(room)` | Resolves `{roomId: room.roomId, secret: <new>}` |
| T8.28 | `pairingLink('ABC123')` | `origin + pathname + '#pair=ABC123'` |

### T9. Connection state machine: `remote.ts` (P1)

Setup: a stored room `{roomId:'r'.repeat(20), secret:'s'.repeat(32)}`, a stored device `{id:'dev-me-0001', name:'Me'}`, meta relay `https://relay.test`, `FakeWebSocket`, fake `Date`, `performance` and timers, and a fresh import for each test.

| ID | Scenario | Expected |
| --- | --- | --- |
| T9.1 | `connectRoom()` with no room, or no relay | No socket; status stays `off` |
| T9.2 | `connectRoom()` | One socket at `wss://relay.test/rooms/<encoded id>/ws`; listener receives `connecting` |
| T9.3 | `onConnection(l)` | `l` called at once with the current status |
| T9.4 | `serverOpen()` | `sent[0]` is `{type:'hello', protocol:1, deviceId:'dev-me-0001', name:'Me', secret}` |
| T9.5 | Heartbeat | `'ping'` every 20,000 ms while OPEN; none after close |
| T9.6 | `welcome {devices:[me, M(online)], mainId:'M', state:S, receivedAt: T0, serverTime: now+2000}` | Status `online`, role `remote`, `mainName` from M's name; the state listener is called with S and an age of `now + 2000 - T0` (clamped at ≥ 0) |
| T9.7 | `welcome` with `state:null` | State listeners not called; `lastRoomState()` returns `null` |
| T9.8 | Role matrix after `welcome`/`devices`: `mainId` is me; online with M online; online with M offline; online with `mainId:null` | `main`, `remote`, `idle`, `idle` |
| T9.9 | `mainId` is me, then the socket closes (code 1006) | Role stays `main` with state `offline` |
| T9.10 | Remote, then close 1006 | Role `remote` with state `offline`. At 29.9 s still `remote`; at 30.1 s a listener gets role `idle` (from the grace timer) |
| T9.11 | Remote, close, reconnect and `welcome` at 10 s (main online) | Role `remote`; no `idle` emitted at 30 s (grace cleared) |
| T9.12 | Idle, then close | Role stays `idle` |
| T9.13 | `devices` with a different `mainId` | `lastRoomState()` becomes `null` |
| T9.14 | `devices` with the same `mainId` | Snapshot kept |
| T9.15 | `state {state:S2, receivedAt}` | Listener called with S2 and its age; `lastRoomState()` gives an age that grows with the clock |
| T9.16 | `command {id:'c1', from:'R', command:C}` with a handler that replies `(true)` | `sent` contains `{type:'ack', id:'c1', to:'R', ok:true}` |
| T9.17 | `command` with no id, no `from`, no command, or no handler | Ignored |
| T9.18 | `release` | Release handler called |
| T9.19 | Data that isn't a string, `'pong'`, malformed JSON, unknown `type` | Ignored; doesn't throw |
| T9.20 | `sendCommand` while not open | Resolves `{ok:false, error:'offline'}` at once; `pendingCommands()` is 0 |
| T9.21 | `sendCommand` while open, then `ack{id, ok:true}` | Resolves `{ok:true}`; pending 0 |
| T9.22 | Ack with `ok:'yes'` | Resolves `{ok:false}` (strict `=== true`) |
| T9.23 | `sendCommand`, then 5,000 ms | `{ok:false, error:'timeout'}`; a later ack is ignored |
| T9.24 | Two `sendCommand` calls in the same millisecond | Different ids (the sequence suffix) |
| T9.25 | Pending command, then the socket closes | Resolves `{ok:false, error:'offline'}` |
| T9.26 | Close 4001 | `localStorage` room removed; status `{state:'off', unpaired:true, mainId:null, devices:[]}`; no new socket after 60 s |
| T9.27 | Close 4000 | No listener call; no new socket (**D6**) |
| T9.28 | Close 1006 repeatedly with no `welcome` | New sockets at +1 s, +2 s, +5 s, +10 s, +30 s, +30 s |
| T9.29 | A `welcome` between failures | The backoff starts again at 1 s |
| T9.30 | Close event from an old socket after a reconnect | Ignored |
| T9.31 | `disconnectRoom()` | Socket closed with `(1000,'bye')`; status `off`, `mainId:null`; `lastRoomState()` is `null`; the socket's later close event emits nothing and schedules no retry |
| T9.32 | `reconnectRoom()` | Old socket closed; a new one opened |
| T9.33 | `setupReconnectTriggers` while a retry is pending; `visibilitychange` to visible, or `online` | Immediate new socket; backoff reset |
| T9.34 | The same events while a socket exists, or while not wanted | Nothing |
| T9.35 | `claimMain(true)` while open, and while closed | `{type:'claim_main', force:true}` sent and `true`; `false` |
| T9.36 | `sendState(s, true)` as main; as remote or idle | `{type:'state', state:s, final:true}` sent; nothing sent |
| T9.37 | `sendRename('X')`, `sendLeave()`, `sendProbe()` | The matching messages |
| T9.38 | `connectRoom()` twice while CONNECTING | Only one socket |
| T9.39 | `rcOpen` after being online (reconnect) | Emits `offline`, not `connecting` |

### T10. Screen and wake lock: `screen.ts` (P2)

| ID | Scenario | Expected |
| --- | --- | --- |
| T10.1 | `setKeepAwake(true)`, page visible | `wakeLock.request('screen')` once |
| T10.2 | Then `setKeepAwake(false)` | `sentinel.release()` once |
| T10.3 | No `navigator.wakeLock` | Resolves; doesn't throw |
| T10.4 | Page hidden | No request |
| T10.5 | A `visibilitychange` to visible while still wanted | Requests again |
| T10.6 | `request` rejects | No throw; the next `true` call tries again |
| T10.7 | `true` (pending), then `false`, then the request resolves | The sentinel is released at once (the `if (!wanted)` path) |
| T10.8 | Browser fires the sentinel's `release` | The next `true` call requests again |
| T10.9 | `true` and `true` before the first request resolves, then `false` | **Current:** 2 requests, 1 release (**D3**). `it.fails` for "1 request" or "all sentinels released" |
| T10.10 | `fullscreenSupported` / `isFullscreen` | Work with the standard and the `webkit*` properties |
| T10.11 | `runningAsApp` | `true` for display-mode fullscreen, display-mode standalone, or `navigator.standalone === true` |
| T10.12 | `enterFullscreen` | Calls `requestFullscreen({navigationUI:'hide'})`; falls back to `webkitRequestFullscreen`; `false` when neither exists or the call rejects |
| T10.13 | `exitFullscreen` when the call rejects | Error swallowed |

### T11. Controller: local commands and track lifecycle (`main.ts`, P1)

Run through the harness in 3.4, or through the functions extracted in R1/R2. `snapshot()` means: switch to the main role through `FakeRemote.emit({role:'main', state:'online', …})`, advance 150 ms, and read the last `sendState` argument. Before R0 exists, that's the state probe.

| ID | Scenario | Expected |
| --- | --- | --- |
| T11.1 | `dispatch({type:'add', url: valid})` on an empty mix | `true`; factory called with the videoId and no `startSeconds`; the track is `loading` and is the focus |
| T11.2 | `add` with an invalid URL | `false`; no track; `#inputError` has the message (the one DOM check, as a signal) |
| T11.3 | Fire `onMeta` for the track | State `paused`; duration from the meta; `controller.setVolume(1)` |
| T11.4 | `play` while loading or in error | `false`; `controller.play` not called |
| T11.5 | `play` while paused | `true`; `play()` called; poll running (advance 250 ms: `getCurrentTime` called once `onState('playing')` has fired) |
| T11.6 | `pause` while paused | `false` |
| T11.7 | `pause` while playing | `true`; `pause()` |
| T11.8 | `play_all` with [paused, loading, error, playing] | Only the paused one gets `play()`; returns `true` |
| T11.9 | `play_all` with no tracks | Returns `true` |
| T11.10 | `pause_all` | Only playing tracks get `pause()` |
| T11.11 | `focus` with an unknown id | `false`; focus unchanged |
| T11.12 | `step` with 3 tracks, focus on 0 | +1 gives 1; −1 gives 2 (wraps) |
| T11.13 | `step` with no tracks | `true`; nothing changes |
| T11.14 | `step −1` with no focus and 3 tracks | Index 1 (**D9**) |
| T11.15 | `seek` with no controller | `false` |
| T11.16 | `seek` with a controller and time 42 | `seekTo(42)`; `currentTime` 42 (no clamping, even past the duration) |
| T11.17 | `stop` | `pause()`, `seekTo(0)`, `currentTime` 0; `true` even when already paused |
| T11.18 | `volume` 1.5, −1, 0.3 | Applied as 1, 0, 0.3 (`controller.setVolume` gets the clamped value) |
| T11.19 | `volume` with an unknown id | `false` |
| T11.20 | `loop` with an unknown id | `false` |
| T11.21 | `loop` `{on:false}` | Flag stored |
| T11.22 | `remove` on [A,B,C] with focus on B | Focus moves to C; B's controller destroyed |
| T11.23 | `remove` the last one (C, focused) | Focus moves to B |
| T11.24 | `remove` the only track | Focus becomes `null` |
| T11.25 | `remove` a track that isn't the focus | Focus unchanged |
| T11.26 | `relink` with an invalid URL | `false`; the track is unchanged |
| T11.27 | `relink` a valid URL on a track with volume 0.4 and repeat off | Old controller destroyed; track `loading`, `currentTime` 0, `meta`, `duration` and `error` `undefined`, new `url`/`videoId`. After `onMeta`: volume 0.4, repeat off, `setVolume(0.4)` |
| T11.28 | `load_mix` replace `[v1, bad, v2]` named `'Rain'` | Previous controllers destroyed; 2 tracks; focus on v1; `mixName` `'Rain'`; returns `true` |
| T11.29 | `load_mix` replace where every URL is invalid | Returns `true`; no tracks; no focus |
| T11.30 | `load_mix` append on an existing mix named `'Rain'` | Old tracks and focus kept; new ones added; `mixName` still `'Rain'` (**D10**) |
| T11.31 | `onState` for a track in `error`, or an unknown id | Ignored |
| T11.32 | `onError` | State `error` with the error object; later `onState('playing')` is ignored (error is terminal) |
| T11.33 | Loop restart: repeat on, duration 100, time 99.5, `onState('paused')` | After 100 ms: `seekTo(0)` then `play()` |
| T11.34 | Same with repeat off; with time 98.9; with duration 0 (live) | No restart |
| T11.35 | A user `pause` at time 99.4 with repeat on | Restarts (**D8**, characterize) |
| T11.36 | Poll: playing, controller reports time 10 and duration 0, stored duration 200 | `currentTime` 10; duration stays 200 |
| T11.37 | Poll: meta has no author and `getAuthor` returns `'Ch'` | `meta.author` becomes `'Ch'` |
| T11.38 | Poll: nothing playing any more | Interval cleared (no `getCurrentTime` calls after the next tick) |
| T11.39 | `runLocalCommand` `play` succeeds while idle and online | `claimMain()` called once; a second `play` within 3 s doesn't call it; one after 3 s does |
| T11.40 | `play` fails | No `claimMain` |
| T11.41 | `play` succeeds while `mcResumeIds` is not empty | `mcResumeIds` cleared (Play here no longer offered in the badge model) |
| T11.42 | `handleLoadPlaylist(urls, name)` with 0 tracks | Dispatches replace; no modal |
| T11.43 | `handleLoadPlaylist` with 2 tracks and 1 URL | Modal message "This mix has 1 channel. Replace the 2 you have open…" |
| T11.44 | Modal cancelled | Returns `false`; no dispatch |
| T11.45 | Modal answers `append` | Dispatches append |
| T11.46 | Boot with `#pl=<payload>` and a saved last mix | The share link wins; hash cleared; the last mix isn't loaded |
| T11.47 | Boot with a last mix while idle | `load_mix` runs locally (`FakeRemote.sendCommand` not called), even if a route is set |
| T11.48 | Boot with a last mix that has no URLs | Nothing loaded |
| T11.49 | Boot when the role is already `remote` | Last mix not restored |
| T11.50 | Corrupt `yt_audio_playlists` at boot | **Current:** `initialize` rejects before the event listeners are attached (**D1**) |

### T12. Controller: remote control and sync (`main.ts`, P1)

Use the harness (`FakeRemote`, `FakeController`), or the extracted `roomSync.ts`, `throttle.ts` and `badge.ts` (R2).

| ID | Scenario | Expected |
| --- | --- | --- |
| T12.1 | `buildRoomState` | `v:1`; `seq` goes up by 1 per call; `sentAt` is `Date.now()`; `mixName` and `focusedId` included; each track has `id, url, videoId, meta, state, error, currentTime, duration, volume, loop` and **no `isMuted`** |
| T12.2 | Time in the snapshot | Playing tracks use `controller.getCurrentTime()`; others use the stored time |
| T12.3 | Main: five commands within 100 ms | One `sendState` at +150 ms |
| T12.4 | Main: a remote command succeeds | Broadcast at once; the pending debounce is cancelled |
| T12.5 | Idle or remote: commands | No `sendState` |
| T12.6 | Main while releasing | No `sendState` from the debounce |
| T12.7 | 15 s interval while main and playing | One `sendState` per 15 s |
| T12.8 | 15 s interval while main and nothing plays | No broadcast |
| T12.9 | 30 s interval while remote and online, last snapshot 36 s old or missing | `sendProbe()` |
| T12.10 | Same with a snapshot 10 s old | No probe |
| T12.11 | Same while idle or offline | No probe |
| T12.12 | `applyRoomState` while not remote; with `null`; with `{tracks:'x'}` | Ignored |
| T12.13 | `applyRoomState(S, age 2000)` with track A playing at 10 s (duration 100) and B paused at 5 s | A at 12 s, B at 5 s; `isMuted:false`; `mixName` and `focus` from S |
| T12.14 | Playing at 99 s with duration 100, age 5 s | 100 s (clamped, even with repeat on: **D7**) |
| T12.15 | `isSameShape` (R2) with the same ids, URLs, titles and settled states | `true` |
| T12.16 | `isSameShape` when only playing ↔ paused changed | `true` |
| T12.17 | `isSameShape` when the length, an id at an index, a URL or a title differs, or loading ↔ paused changed | `false` |
| T12.18 | `remoteTick` after 3 s, playing from base 10 s | 13 s |
| T12.19 | `remoteTick` with repeat on, duration 20, base 19, after 3 s | 2 s |
| T12.20 | `remoteTick` with repeat off | 20 s (clamped) |
| T12.21 | `remoteTick` with no duration | Not bounded |
| T12.22 | `remoteTick` for a paused track, or one with no base | Unchanged |
| T12.23 | `routeToMain` while not remote | Returns `false`; the command runs locally |
| T12.24 | Remote: `play` | `true`; `sendCommand(play)` once; no local player call |
| T12.25 | Remote: `focus` and `step` | Focus changes locally at once, and the command is sent |
| T12.26 | Remote: `seek` | `currentTime` and the base set locally at once, and the command is sent |
| T12.27 | Remote: volume 0.1, 0.2, 0.3 at 0, 30 and 60 ms | `sendCommand` gets 0.1 at 0 ms and 0.3 at 100 ms, and nothing else |
| T12.28 | Remote: volume on tracks A and B within 100 ms | Each sent at once (separate throttles) |
| T12.29 | Remote: two `seek`s 150 ms apart | Both sent at once |
| T12.30 | Remote: `add` / `relink` | Never throttled |
| T12.31 | `sendToMain` reply messages (R2 `failureText`) | `timeout` → "Laptop didn't respond."; `no_main` / `offline` → "Laptop is offline."; failed `add`/`relink` → "That link has no YouTube video in it." (also in `#inputError`); otherwise "Laptop couldn't do that."; with no main name: "The main device …" |
| T12.32 | `handleRemoteCommand` while not main | `reply(false, 'not_main')`; not run |
| T12.33 | `handleRemoteCommand(null)`, or a command without `type` | `reply(false, 'not_main')` (characterize: misleading code, D11) |
| T12.34 | `handleRemoteCommand` succeeds | `reply(true, undefined)`, then an immediate broadcast |
| T12.35 | `handleRemoteCommand` with an unknown id | `reply(false, 'failed')`; no extra broadcast |
| T12.36 | `{type:'volume', trackId}` with no volume | **Current:** `controller.setVolume(NaN)` (D11) |
| T12.37 | `{type:'load_mix'}` with no `urls` | **Current:** throws; `reply` never called (D11) |
| T12.38 | `becomeRemote` (emit role `remote`) with 2 local tracks playing | Controllers destroyed; polling stopped; route installed (a later `dispatch(play)` goes through `sendCommand`); `lastRoomState` applied; resume and autoplay sets cleared |
| T12.39 | `leaveRemote` because the main went offline (emit `idle`), mirrored A playing at 42.7 s with volume 0.3 and repeat off, B paused | Route removed; factory called for A with `startSeconds` 42.7 and for B. After A's `onMeta`: volume 0.3, repeat off, `currentTime` 42, **no `play()`**. A is in the resume set |
| T12.40 | `leaveRemote` after Play here (emit `main` after `playHere()`) | A is played automatically once ready (`play()` after `onMeta`); B isn't |
| T12.41 | Role transition `idle` → `main` | `broadcastNow` |
| T12.42 | Role transition `remote` → `main` | `leaveRemote` and `broadcastNow` |
| T12.43 | `main` with state `offline`, then `online` | `broadcastNow` |
| T12.44 | `idle`, state `online`, something playing | `maybeClaimMain` |
| T12.45 | `releaseMain` (the release handler) while main with A playing | `sendState(snapshot with A playing, true)` **before** `pause()`. Afterwards no debounced broadcasts. After 6 s, if still main: one `sendState` |
| T12.46 | `releaseMain` when the role changes to `remote` before 6 s | No fallback broadcast |
| T12.47 | `releaseMain` while not main | Nothing |
| T12.48 | `playHere` on a remote when `claimMain(true)` returns `false` | Notice "Not connected. Try again in a moment."; no pending flag |
| T12.49 | `playHere` on a remote when it returns `true` | Pending; after 8 s, if still remote, notice "Laptop didn't hand over." |
| T12.50 | `playHere` while idle with resume ids [A paused, B loading] | `play` dispatched for A; B queued for autoplay; resume ids cleared |
| T12.51 | Badge model (R2 `badgeModel`): no status, `off`, or idle without resume | Hidden |
| T12.52 | Badge: `mcWantPlayHere` | "Moving playback here…", pending |
| T12.53 | Badge: idle with resume, online | "Laptop offline" with button; offline style |
| T12.54 | Badge: idle with resume, not online | "Disconnected" with button |
| T12.55 | Badge: remote | "Remote · Laptop" with button when online; "Remote · reconnecting" without |
| T12.56 | Badge: main | "Playing here", "Playing here · 1 remote", "· 2 remotes"; "Playing here · reconnecting" |
| T12.57 | Badge: commands pending | Pending style |
| T12.58 | Badge while a notice is showing | Re-render held back until 4 s |
| T12.59 | Keep-awake while remote, even if the mirror shows playing | `setKeepAwake(false)` |
| T12.60 | Keep-awake while main/idle, playing, and fullscreen or installed app | `setKeepAwake(true)` |

### T13. Relay: `worker/src/index.ts` (P1)

Setup: alias `cloudflare:workers` to a stub; `FakeCtx`; `Room` and `Pairing` constructed directly. For `fetch`, an `env` with fake namespaces whose `get()` returns spy objects or real instances on `FakeCtx`.

**Helpers**

These are private now; export them (R7), or test them through behaviour.

| ID | Scenario | Expected |
| --- | --- | --- |
| T13.1 | `sameText` | Equal strings `true`; same length but different `false`; different length `false` |
| T13.2 | `cleanName` | Control characters removed; trimmed; cut to 40; `''`, `'   '` and non-strings give `Device` |
| T13.3 | `randomCode` | 6 characters, all from `CODE_ALPHABET` (no 0, O, 1, I, L) |
| T13.4 | `randomToken(18)` / `randomToken(24)` | 24 and 32 base64url characters; room ids match `ROOM_ID` |
| T13.5 | `readSecret` | Body that isn't JSON → `null`; secret shorter than 16 → `null`; non-string → `null` |

**HTTP routes**

| ID | Scenario | Expected |
| --- | --- | --- |
| T13.6 | `OPTIONS` from an allowed origin | 204 with `Access-Control-Allow-Origin` set to that origin, `Vary: Origin`, methods, headers and max-age |
| T13.7 | `OPTIONS` from another origin | 403 |
| T13.8 | Any method with no `Origin`, or a foreign one | 403 `{error:'origin'}` |
| T13.9 | `POST /rooms` | 200 `{roomId, secret}`; `room.init` called with `sha256(secret)`; CORS headers present |
| T13.10 | `/rooms/<short id>/codes` | 404 `not found` |
| T13.11 | `GET /rooms/:id/ws` without `Upgrade: websocket` | 426 |
| T13.12 | `GET /rooms/:id/ws` with it | Forwarded to `room.fetch` |
| T13.13 | `POST /rooms/:id/codes` with a missing, short or wrong secret | 403 `unpaired` |
| T13.14 | `POST /rooms/:id/codes` with the right secret | 200; `pairing.create(roomId, secret)` |
| T13.15 | `POST /rooms/:id/rotate` with the right secret | 200 `{secret: new}`; `room.rotate(sha256(new))` |
| T13.16 | `POST /pair/abc123` | Code uppercased before `redeem` |
| T13.17 | `redeem` returns `'slow'`, `null`, or a record | 429; 404 `code`; 200 with the record |
| T13.18 | A namespace method throws | 500 `{error:'server'}` |

**Room**

| ID | Scenario | Expected |
| --- | --- | --- |
| T13.19 | `init` twice | The second throws `room exists` |
| T13.20 | `checkSecret` | Right `true`; wrong `false`; uninitialised `false` |
| T13.21 | Before authentication: a `devices` message | Close 4003 `hello first` |
| T13.22 | Binary message, or more than 64 KB | Close 1009 |
| T13.23 | Malformed JSON | Ignored |
| T13.24 | `hello` with a wrong secret | `{type:'error', code:'unpaired'}` sent, then close 4001 |
| T13.25 | `hello` with device id `'short'` or `'bad id!'` | Close 4003 |
| T13.26 | `hello` when 12 devices are stored and the id is new | `error full`, then close 4004 |
| T13.27 | `hello` from a known device when 12 are stored | Accepted |
| T13.28 | `hello` from a device that already has a socket | Old socket closed 4000; new one authenticated |
| T13.29 | `welcome` contents | `{protocol:1, deviceId, devices: sorted by name with online flags, mainId, state: stored or null, receivedAt: stored or 0, serverTime}`; others get `devices`, the sender doesn't |
| T13.30 | `hello` effects | Name cleaned; `lastActivity` and `lastSeen` stored |
| T13.31 | Rate limit | Messages 1–40 within a second handled; the 41st dropped (no effect); handled again after 1 s |
| T13.32 | `rename` | Cleaned name stored; `devices` sent to everyone, including the sender |
| T13.33 | `leave` from a remote | Device removed; close 1000; `devices` to others with the leaver shown offline |
| T13.34 | `leave` from the main | `mainId` and `state` set to `null` |
| T13.35 | `claim_main` with no main | `mainId` becomes the claimer; handover deleted; `devices` broadcast |
| T13.36 | `claim_main` while the main is offline | Granted; stored `state` kept |
| T13.37 | `claim_main` while the main is online, no `force` | Only `{type:'claim_denied', mainId}` to the claimer |
| T13.38 | `claim_main` while the main is online, `force:true` | Handover `{to, deadline: now+3000}` stored; `{type:'release', to}` to the main; alarm at or before the deadline; `mainId` unchanged |
| T13.39 | `claim_main` from the current main | Nothing changes |
| T13.40 | `state` from a non-main device, or with a non-object `state` | Ignored |
| T13.41 | `state` from the main | Stored `{state, receivedAt: now}`; forwarded to every other authenticated socket, not the sender |
| T13.42 | `state` with `final:true` while a handover is stored | `mainId` becomes the handover target; handover deleted; `devices` broadcast |
| T13.43 | `state` with `final:true` and no handover | Just stored |
| T13.44 | `command` with no id, or no command object | Ignored |
| T13.45 | `command` while the main is offline, or sent by the main | `{type:'ack', id, ok:false, error:'no_main'}` to the sender |
| T13.46 | `command` otherwise | Forwarded to the main as `{type:'command', id (first 40 characters), from, command}` |
| T13.47 | `ack` from a non-main device | Ignored |
| T13.48 | `ack` from the main to an online target | Target gets `{type:'ack', id, ok: strict boolean, error: string or undefined}` |
| T13.49 | `ack` to an offline target | Dropped |
| T13.50 | `probe` | `devices` broadcast |
| T13.51 | `sweep` | A socket whose last heartbeat reply (or `connectedAt`) is older than 70 s is closed 4005 and `devices` broadcast; fresh sockets are kept |
| T13.52 | `webSocketClose` | `lastSeen` updated; `devices` with the closing socket offline; TTL alarm set when it was the last socket; code 1005 closes with 1000 |
| T13.53 | `webSocketError` | Same as a close with 1011 |
| T13.54 | `alarm` with a handover past its deadline | Completed, even when the target is offline (**D21**) |
| T13.55 | `alarm` with a handover not yet due | Not completed |
| T13.56 | `alarm` with no sockets and `lastActivity` older than 90 days | `deleteAll` |
| T13.57 | `alarm` with no sockets and recent activity | Alarm set for `last + TTL` |
| T13.58 | `scheduleAlarm` when an earlier alarm exists | Earlier one kept; a later one replaced by the earlier time |
| T13.59 | `rotate` | New hash; devices `{}`; `mainId` and `state` `null`; every socket closed 4001 |

**Pairing**

| ID | Scenario | Expected |
| --- | --- | --- |
| T13.60 | `create` | `{code, expiresAt: now + 600000}`; record stored; alarm set only if none exists |
| T13.61 | `create` when the first random code is taken (stub `getRandomValues` to repeat) | A different code |
| T13.62 | `redeem` a valid code | Record returned; second redeem gives `null` |
| T13.63 | `redeem` an expired code | `null`, and the record is deleted |
| T13.64 | `redeem` with `'abc'`, `'ABC12!'`, or an unknown code | `null` |
| T13.65 | 11 redeems from one IP within 60 s | The 11th gives `'slow'`, even for a valid code; works again after 60 s. Valid attempts count too |
| T13.66 | `alarm` | Expired codes deleted; re-armed at the earliest remaining expiry + 1 s; no re-arm when none are left |

### T14. Devices panel logic: `devices.ts` (P2)

| ID | Scenario | Expected |
| --- | --- | --- |
| T14.1 | `dvSeen` (after R4): online; 29 s; 90 s; 59 min; 60 min; 23 h; 24 h; 36 h | "Online"; "Seen just now"; "Seen 2 min ago" (rounds 1.5); "Seen 59 min ago"; "Seen 1 h ago"; "Seen 23 h ago"; "Seen 1 d ago"; "Seen 2 d ago" |
| T14.2 | Status label (after R4): not paired | "Not paired"/idle |
| T14.3 | Paired, online, nobody else online | "Paired"/idle |
| T14.4 | Paired, online, 2 others online | "3 online"/live |
| T14.5 | Paired, connecting | "Connecting"/busy |
| T14.6 | Paired, offline or off | "Offline"/warn |
| T14.7 | While not `online`, every device listed as offline | `online` forced to `false` |
| T14.8 | `joinWithCode` with no relay | Returns the "isn't set up" message; nothing redeemed |
| T14.9 | `joinWithCode` with a code for the current room | Returns `null`; "already paired"; no disconnect |
| T14.10 | `joinWithCode` with a code for a different room | `sendLeave` (only if there was a room), `disconnectRoom`, `saveRoom(new)`, `connectRoom`, in that order; returns `null` |
| T14.11 | `joinWithCode` when redeeming throws | Returns the error message, which is also shown |
| T14.12 | Leave timing compared with Unpair | Pin current behaviour (**D14**) |

### T15. Settings (P3)

| ID | Scenario | Expected |
| --- | --- | --- |
| T15.1 | `layoutChoice` with `screen` 1080×2400, then rotated to 2400×1080 | Same key `1080x2400` |
| T15.2 | `setLayoutChoice('stacked')`, then `'auto'` | Stored `{key:'stacked'}`; then key removed (storage removed when empty); `ambient:layout-choice` fired each time |
| T15.3 | Stored JSON `"x"`, `null`, or invalid | `auto` |
| T15.4 | `setItem` throws | The choice still holds for the session (`choiceCache`) |
| T15.5 | `storedScale` with nothing, `'abc'`, `'0.5'`, `'1.5'`, `'0.724'` | 1, 1, 1, 1, 0.7 |
| T15.6 | `applyScale(2)`, `applyScale(0.1)` | 1.3, 0.7 |
| T15.7 | `applyScale(1)` | Storage key removed; zoom cleared |
| T15.8 | `applyScale(0.85)` with coarse pointer | Viewport `initial/min/max-scale=0.85`; no `is-zoomed` |
| T15.9 | `applyScale(0.85)` with fine pointer | `--ui-zoom: 0.85`, `is-zoomed`; `appZoom()` returns 0.85 |
| T15.10 | `loadScreenState` (after R5) | Unknown style → `Slot mask`; mix outside 0–1 or not a number → 1; `tuned` not an object → `{}` |
| T15.11 | `turn(±1)` (after R5) | Wraps over the 5 styles; clears `tuned` |
| T15.12 | `setPreferred` (after R5) | Clamped to 0.05–0.95 |

### T16. QR encoder: `qr.ts` (P2)

Use a decoder such as `jsQR` as a dev dependency, as the oracle.

| ID | Scenario | Expected |
| --- | --- | --- |
| T16.1 | Byte lengths 14 / 15, 26 / 27, 62 / 63, 180 / 181, 213 / 214 (ASCII) | Sizes 21 / 25, 25 / 29, 33 / 37, 53 / 57, 57 / `null` (capacities 14, 26, 42, 62, 84, 106, 122, 152, 180, 213 bytes, worked out from the module's tables) |
| T16.2 | The production pairing link (56 bytes), and boundary lengths | Decodes back to the same text |
| T16.3 | UTF-8 text (`ä`, `日本`) | Counted as UTF-8 bytes; decodes back |
| T16.4 | Fixed patterns | Finder patterns at the three corners; timing pattern on row and column 6 alternating; dark module at `(8, size-8)` |
| T16.5 | `qrSvg` | `''` for text that's too long; otherwise a `viewBox` of `size + 8` |

### T17. Accent and square art: `accent.ts` (P3, after R6)

| ID | Scenario | Expected |
| --- | --- | --- |
| T17.1 | All black, all white, all grey | `null` |
| T17.2 | Solid saturated red | A hex colour with hue about 0°; contrast against `#161B1C` ≥ 4.5 |
| T17.3 | Coloured pixels under 1.5 % of the frame | `null` |
| T17.4 | Two hues, 70/30 | The dominant hue wins |
| T17.5 | Hues around 355° and 5° | Grouped as one (wrap-around) |
| T17.6 | Contrast can't reach 4.5 by lightness 0.86 | `null` |
| T17.7 | `isSquareFromPixels`: flat matching side bars with a textured centre | `true` |
| T17.8 | Side bars of different colours, noisy bars, or a flat centre | `false` |

`crtCover` geometry and `crtColor`/`crtNum` parsing can be added as P3 extras once R6 exists.

**Out of scope:** `layout.ts`, `backdrop.ts`, `paintCrt` pixel output, `resize.ts` pointer handling, and markup layout.

---

## 6. Implementation roadmap

Each phase can be merged on its own; a phase only needs the ones listed under "Depends on".

| Phase | Content | Depends on | Size (tests) | Code changes |
| --- | --- | --- | --- | --- |
| **0. Infrastructure** (P0) | See the detail below | — | — | Tooling only |
| **1. Pure client modules** (P1/P2) | T1, T3, T4, T5, T6, T7, T8, T16 | 0 | ~120 | None. D1/D2/D4/D17/D18 pinned with `it.fails` / `it.todo` |
| **2. Stateful client modules** (P1/P2) | T2 (YouTube adapter), T9 (connection), T10 (wake lock), T14.8–T14.12 (`joinWithCode` with mocked modules) | 0; reuses the Phase 1 fixtures | ~95 | None |
| **3. Relay** (P1) | See the detail below | 0 (worker side) | ~70 | None, or export the helpers (R7) |
| **4. Controller characterization** (P1) | The 3.4 harness; T11 and T12 run against the black box, observed through fakes and `sendState` snapshots | 1, 2 (fakes) | ~100 | None, or R0 (a read-only state accessor) to make it simpler |
| **5. Extraction and unit tests** (P1/P2) | R1–R3 pull the pure logic out of `main.ts`. Move the detailed cases in T11/T12 (`isSameShape`, tick maths, throttle, `failureText`, badge model, focus rules, loop decision, status text) onto the new modules; keep a slim harness suite as the integration net | 4 (characterization must be green first) | ~60 new or moved | Small refactors; `bundle.js` `files` list updated |
| **6. Settings and low priority** (P3) | T14.1–T14.7, T15, T17 | 0; R4–R6 | ~40 | Small exports |
| **7. Decisions on defect candidates** | For each D-item the owner accepts as a bug: fix, then turn the `it.fails` into an ordinary test | Owner input | — | Fixes (separate PRs) |

**Phase 0 in detail**

- Add `vitest`, `jsdom` (or `happy-dom`) and `@vitest/coverage-v8` to the root dev dependencies, plus `"test": "vitest run"`.
- Add `vitest.config.ts` with `environment: 'jsdom'`, `setupFiles: ['test/setup.ts']` and `include: ['test/**/*.test.ts']`.
- Add `test/tsconfig.json`, extending the root and including `src` and `test`, so the build isn't affected.
- `test/setup.ts`:
  - `matchMedia` stub (reduced motion on by default);
  - `CSS.escape` polyfill;
  - `crypto.randomUUID` / `getRandomValues` stubs that can be seeded;
  - clear `localStorage` and the `location` hash between tests;
  - `vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']})` where needed.
- `test/fakes/`: `FakeYT`, `FakeWebSocket`, `FakePlayerFactory`/`FakeController`, `FakeWakeLock`, `FakeRemote`, and the `makeTrack`/`makeStatus` fixtures.
- In `worker/`: `vitest` as a dev dependency, `worker/vitest.config.ts` with `resolve.alias['cloudflare:workers'] = 'test/stubs/cloudflare-workers.ts'` and `environment: 'node'`, plus `FakeCtx` and `FakeServerSocket`.
- Optional: a CI workflow running `npm run build` (to type-check), `npm test`, and `cd worker && npm test`.

**Phase 3 in detail**

- T13 helpers and routes first.
- Then the Room protocol, in this order: authentication and identity, claim and handover, state, command and ack, sweep and alarm.
- Then Pairing.

This also delivers the tests that `docs/remote-control-plan.md` already describes as existing.

**Order and rationale**

- Phases 1 and 3 give the fastest return on the most important contracts with no refactoring.
- Phase 2 covers the timing-heavy connection code, where regressions are hardest to see by hand.
- Phase 4 has to come before Phase 5, so the extraction from `main.ts` happens under a characterization net.
- Coverage targets: at least 90 % lines for `storage`, `shareLinks`, `playlist`, `commands`, `pairing`, `remote`, `youtubePlayer` and `worker/src/index.ts`. For `main.ts`, aim for the branches listed in T11/T12 rather than a percentage.

---

## 7. Recommendations

The refactors below are small and keep the architecture as it is. Each one is optional for its phase. All of them have to respect the bundle rules: new modules go into `bundle.js` `files` before `main.js`, and top-level names must be unique (use a module prefix, as `layout.ts` already does).

**R0. A test seam in `main.ts` (smallest change).**
- Export `function mainDebugState(): { tracks: ReadonlyArray<Track>; focusedId; mixName; role; resumeIds; autoplay }`, and wrap the `initialize().catch(...)` call so it doesn't run when a test flag is set (for example `if (!(globalThis as any).__AMBIENT_TEST__)`).
- This removes the need to read state through `sendState` in the harness.
- Cost: about 10 lines.

**R1. Extract the mix rules into `src/mixRules.ts`, pure with no DOM.**
- `nextFocusAfterRemove(ids: string[], removedIndex: number): string | null` (`main.ts:748-751`)
- `stepTarget(ids: string[], focusedId: string | null, dir: 1 | -1): string | null` (`:604-609`)
- `shouldRestartLoop(loop: boolean, duration: number, time: number): boolean` (`:720-722`)
- `statusLine(total: number, live: number): string` (`:319-324`)
- `loadPrompt(urlCount: number, openCount: number): string` (`:926`)

`main.ts` then calls these functions; its behaviour stays the same.

**R2. Extract the sync logic into `src/roomSync.ts` plus `src/throttle.ts`.**
- `buildRoomState(tracks, liveTime: (t) => number, meta: {seq, now, mixName, focusedId}): RoomState`
- `projectSnapshot(state, ageMs, now): { tracks: Track[]; bases: Map<id, {t, at}> }`
- `isSameShape(before, after): boolean`
- `tickTime(base, now, duration, loop): number`
- `failureText(reply, command, mainName): string`
- `badgeModel(status, role, flags): { hidden, text, showButton, offline, pending }`
- `createTrailingThrottle({ intervalMs, now, schedule, send })`, which replaces the inline `mcThrottle` code (`:1478-1497`).

Also move `MirroredTrack` and `RoomState` (`:1268-1288`) to this module, so the snapshot format is a shared, tested contract.

**R3. Validate commands at the trust boundary.**
- Add `parseCommand(raw: unknown): Command | null` in `commands.ts`. It checks each variant's fields: string ids, finite numbers, `dir ∈ {1, -1}`, `urls` an array of strings, `mode ∈ {replace, append}`.
- Use it in `handleRemoteCommand` and answer `invalid` for anything rejected.
- This is a **behaviour change** (it addresses D11) and needs the owner's agreement. It's pure and easy to test exhaustively.

**R4. Pull the logic out of `devices.ts`.**
- Export `dvSeen(device, now)` and a new `dvLabel(paired, status, meId): {label, tone}`, taken from `dvRender` lines 73-91.
- Pass `now` in so the code doesn't call `Date.now()` directly.

**R5. Pull the settings logic out of `screenFx.ts` and `resize.ts`.**
- Export `loadScreenState`, plus a pure `turnStyle(state, dir)` and `mergedValues(state)`, from `screenFx.ts`.
- Export a pure `clampRatio(r)` from `resize.ts` (from `setPreferred`).

**R6. Separate pixel maths from canvas I/O.**
- In `accent.ts`: `accentFromPixels(data: Uint8ClampedArray, total: number): string | null` and `squareArtFromPixels(data, w, h): boolean`. `extractAccent` and `isSquareArt` keep only the drawing.
- In `crt.ts`: export `crtCover`, `crtColor` and `crtNum`.

**R7. Relay.**
- Export `sameText`, `cleanName`, `randomCode`, `randomToken` and `readSecret`.
- Optionally pull the `claim_main` decision into `decideClaim(mainId, meId, mainOnline, force): 'grant' | 'deny' | 'handover' | 'noop'`, so the role rules can be tested as a table without sockets.
- Later, for a check closer to production, run a small suite with `@cloudflare/vitest-pool-workers` (real Durable Object storage and hibernation APIs). This complements the unit tests rather than replacing them.

**R8. Inject the clocks where it's cheap.**
- `remote.ts` and the sync code read `Date.now()` and `performance.now()` directly. Fake timers cover this, but taking a `now` argument (as in R2 and R4) makes the pure functions independent of the timer setup.

**R9. Robustness fixes that tests will point to** (owner decisions, not part of the test work):
- D1: validate stored data and `try/catch` storage access in `storage.ts`, as the other modules already do.
- D2: one timer per element in `showError`.
- D3: an in-flight guard in `setKeepAwake`.
- D4: UTF-8-safe base64 for share links. Keep decoding old links compatible.
- D5: an in-memory fallback for the device identity.
- D6: decide what a replaced tab should do.
- D7: one shared time-projection function (R2).
- D11: `parseCommand` (R3).
- D15: handle `claim_denied`, and decide whether a device should lose its local mix when it becomes a remote.

**Questions for the owner** (they decide the expected values for the ambiguous tests):
1. Should `append`, add or remove clear or mark `mixName` (D10)?
2. Should a user pause in the last second of a repeating track restart it (D8)?
3. What should a tab do after it's replaced (close code 4000) (D6)?
4. Should snapshots be rejected when they're out of order or stale, using `seq` or `sentAt` (D13)?
5. Should a device that was playing its own mix keep it when it becomes a remote (D15)?
6. Should YouTube Shorts, `/live/` and `/embed/` links be accepted (D17)?
7. Were the relay tests mentioned in `docs/remote-control-plan.md` written somewhere else?
