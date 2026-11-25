# Ambient Player: test rules from the user's side

These are the rules the unit tests will check, written as a user sees the app, with no code details. Each rule gets at least one test. **No tests exist yet.**

The technical detail (which unit covers each rule, mocks, edge cases, order of work) is in [unit-test-plan.md](unit-test-plan.md). Its finding IDs (D1–D22) are given in brackets where a rule here comes from one.

**Status: waiting for review.** Every rule needs approving. Rules marked ❓ or ⚠️ also need a decision, which goes in the table at the end.

**Markers**

- No marker: describes what the app does now. Approve it, or change it.
- **❓** The current behaviour may not be what's intended. Needs a decision.
- **⚠️** The current behaviour looks like a bug. The rule is written as proposed, and its test will fail until the bug is fixed.

---

## A. Adding channels

- **A1.** A youtube.com, m.youtube.com, music.youtube.com or youtu.be link adds a channel. Extra parts such as a timestamp or playlist are ignored.
- **A2.** Text with no YouTube video in it adds nothing and shows "That link has no YouTube video in it". An empty box asks you to paste a link first.
- **A3. ❓** Shorts, `/live/` and `/embed/` links are refused today. Should they be accepted? (D17)
- **A4.** A new channel loads paused, at full volume, with repeat on. It never starts playing by itself.
- **A5.** The first channel added to an empty mix goes on the main display.
- **A6.** A channel is marked Unavailable, with the reason, if:
  - it hasn't loaded after 10 seconds;
  - the video is private or missing;
  - embedding is disabled.

  It can't be played until its link is changed.

## B. Playing

- **B1.** Play and pause only act on a channel that's ready. Loading and unavailable channels ignore them.
- **B2.** Several channels play at once, each on its own.
- **B3.** Play all starts every ready channel and Pause all pauses every playing one. The button reads "Pause all" while anything plays.
- **B4.** Each channel has its own volume from 0 to 100%. Values outside that range are capped.
- **B5.** With repeat on, a channel starts again when it ends. With repeat off, it stops at the end.
- **B6. ❓** Today, pausing in the last second of a repeating channel also restarts it. Recommended: only a real end restarts. (D8)
- **B7.** Stop pauses the channel and goes back to the start.
- **B8.** Seeking moves the position. The timeline works only once the length is known.
- **B9.** Elapsed and remaining time update while playing. The YouTube channel name is filled in when YouTube reports it.

## C. Main display and switching

- **C1.** Previous and next go through all channels, not only playing ones, and wrap around.
- **C2.** Tapping a channel or a strip tile puts it on the main display. The deck then controls that channel.
- **C3.** The strip shows only playing channels, numbered by their place in the mix.
- **C4.** Removing asks for confirmation first.
- **C5.** If the removed channel was on the main display, the next one takes its place. If it was last, the previous one does, and if the mix is now empty, nothing does.
- **C6.** Changing a channel's link keeps its volume, repeat setting and place in the mix, and starts from 0. An invalid link leaves the channel as it was and shows a message.
- **C7.** Space plays or pauses the main channel, and `[` and `]` go to the previous or next channel. None of these act while you're typing in a field.

## D. Saved mixes

- **D1.** Saving needs a name and at least one channel. Saving under an existing name replaces that mix. Names are case-sensitive.
- **D2. ❓** Only the links are saved: no volumes, repeat settings or positions. Is that intended?
- **D3. ❓** The last mix you *saved* reopens on start. Loading a different mix doesn't change which one reopens. Is that intended?
- **D4.** With no channels open, a mix loads straight away. With channels open, it asks Replace, Add or Cancel. Cancel changes nothing.
- **D5.** Replacing takes the loaded mix's name, which shows in the status and is marked current in the list.
- **D6. ❓** After "Add to current", or after adding or removing channels, the old name stays although the mix has changed. Should it? (D10)
- **D7.** Invalid links inside a mix are skipped and the valid ones load.
- **D8.** Deleting asks for confirmation. Deleting the open mix turns it into "Unsaved mix".
- **D9. ⚠️** Damaged saved data stops the app from starting today. Proposed: it's ignored, and the app starts with no saved mixes. (D1)

## E. Share and Import

- **E1.** Copy share link puts every channel's link into one URL (links only). It's disabled when there are no channels.
- **E2.** Opening a share link loads that mix, unnamed, instead of the last saved one, and clears the link from the address bar.
- **E3. ⚠️** Share fails silently if a link contains characters such as Japanese letters. Proposed: it always works. (D4)
- **E4.** Import accepts a share link, or YouTube links separated by spaces, commas or new lines. Other links are ignored, and if there's nothing usable, a message says so.
- **E5.** Importing a pairing link pairs the device instead.
- **E6.** Cancelling the Replace/Add question keeps the pasted text.
- **E7. ⚠️** If two messages appear close together, the first can stay on screen forever. Proposed: every message clears after 5 seconds. (D2)

## F. Pairing devices

- **F1.** Connect a device shows a 6-character code and a QR code. The code works once and expires after 10 minutes, with a message.
- **F2.** The code can be typed in any case, with spaces or dashes, or arrive by opening or pasting the pairing link.
- **F3.** A wrong, expired or used code shows "That code doesn't work". More than 10 tries a minute shows "Too many tries".
- **F4.** A code for the group you're already in says so and changes nothing. A code for another group leaves the old one.
- **F5.** The device list shows each device as online or last seen ("Seen 5 min ago"). It marks "This device" and "Plays" for the main device.
- **F6.** A device name can be up to 40 characters. An empty name falls back to one like "Chrome on Android".
- **F7.** Unpair removes this device from the group. Forget all devices unpairs every other device, and each one is told.
- **F8.** A group holds at most 12 devices.

## G. Main device and remotes

- **G1.** The first paired device to start playing becomes the main device, and it plays the audio.
- **G2.** Any other paired device that opens the app becomes its remote. It shows the same mix live and plays nothing itself.
- **G3.** Every control on a remote acts on the main device. That includes adding, removing and relinking channels, and loading mixes and share links.
- **G4.** Switching, volume and seeking respond on the remote straight away, and the main device then confirms. Times keep moving between updates.
- **G5.** If the main device doesn't answer within 5 seconds, or refuses, the remote says why: "didn't respond", "is offline", "no YouTube video" or "couldn't do that".
- **G6.** A remote never loads its own last mix on start, and never sends it to the main device.
- **G7. ❓** A device playing its own mix that becomes a remote loses that mix. This happens, for example, when two devices are both playing as they reconnect. Should it keep the mix somehow, or is losing it acceptable? (D15)
- **G8.** A remote doesn't keep the screen awake.
- **G9.** The header badge reads "Remote · Laptop" on a remote and "Playing here · 1 remote" on the main device ("Laptop" being the main device's name).

## H. Play here

- **H1.** Play here on a remote moves playback to it, from the same positions. The old main device stops and becomes a remote.
- **H2.** If the main device doesn't hand over within 8 seconds, the remote shows "didn't hand over". If the remote isn't connected, it shows "Not connected. Try again in a moment."
- **H3.** If the old main device stays silent, the handover still completes after 3 seconds. Playback then starts from the positions in the last update.

## I. When something goes offline

- **I1.** If the main device goes offline, remotes take the mix over paused, at the same positions. They show "Laptop offline" with Play here, which resumes what was playing.
- **I2.** If the relay can't be reached, the main device keeps playing. A remote waits 30 seconds, then takes over the same way and shows "Disconnected".
- **I3.** Reconnecting is automatic: after 1, 2, 5 and 10 seconds, then every 30 seconds. It's immediate on returning to the app or when the network comes back.
- **I4.** A main device that has gone to sleep is noticed after about 35 seconds without updates.
- **I5.** A device unpaired from elsewhere forgets the pairing and says so.
- **I6. ❓** If a second tab on the same device takes over the connection, the old tab still believes it's connected. What should it do: show it's disconnected, or reconnect? (D6)
- **I7. ⚠️** Without browser storage, a device can never be recognised as the main device. Proposed: it works for the visit. (D5)
- **I8. ⚠️** A malformed command from a remote can leave the remote waiting the full 5 seconds. Proposed: it's refused at once with "couldn't do that". (D11)

## J. Screen

- **J1.** The screen stays awake while something plays in fullscreen or in the installed app. It may sleep again when nothing plays.
- **J2. ⚠️** After Play all starts several channels, the screen can stay awake after pausing. Proposed: it's always released. (D3)
- **J3.** The first tap enters fullscreen where the browser allows it. Fullscreen is never forced back after you leave it.

## K. Remembered settings (low priority)

- **K1.** UI scale is 70–130% in 5% steps and is kept per device.
- **K2.** The layout choice (Auto or Stacked) is kept per screen.
- **K3.** The screen effect's style, Mix and fine-tuning are kept. Turning the dial drops the fine-tuning.
- **K4.** The artwork column width is kept.

---

## Decisions

Fill in a decision for each row. Rules without a marker are approved as written unless noted here.

| Rule | Question | Recommendation | Decision |
| --- | --- | --- | --- |
| A3 | Accept Shorts, `/live/` and `/embed/` links? | Accept Shorts and live | |
| B6 | Should a pause in the last second of a repeating channel restart it? | No: only a real end restarts | |
| D2 | Save only links, or also volume and repeat? | Owner's call | |
| D3 | Should loading a mix make it the one that reopens? | Owner's call | |
| D6 | Keep the mix name after adding to or changing the mix? | Owner's call | |
| G7 | Does a device keep its own mix when it becomes a remote? | Owner's call | |
| I6 | What should a replaced tab do? | Show it as disconnected | |
| D9 | Ignore damaged saved data | Yes | |
| E3 | Share works with any characters | Yes | |
| E7 | Every message clears after 5 seconds | Yes | |
| I7 | Works without browser storage for the visit | Yes | |
| I8 | Refuse malformed commands at once | Yes | |
| J2 | Always release the screen when playback stops | Yes | |
| (other) | Rules to add or change | | |
