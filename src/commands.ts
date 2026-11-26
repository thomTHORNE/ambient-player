/**
 * Commands: every change to playback or the mix, as plain data.
 *
 * The interface never calls the players directly; it calls dispatch() with a
 * command. Today every command runs here, on this device. Remote control
 * (docs/remote-control-plan.md) adds a route that sends commands to the main
 * device instead, and the same data travels over the wire, so each command
 * must stay JSON-serialisable and self-contained: it carries the values to
 * apply ("pause this channel"), never a toggle that depends on the state the
 * sender happened to see.
 *
 * Purely local actions are not commands: opening a row's drawer, the remove
 * confirmation, saving mixes on this device, share links, and the layout,
 * scale and screen settings.
 */

import type { TrackId } from './playlist.js';

export type Command =
  | { type: 'play'; trackId: TrackId }
  | { type: 'pause'; trackId: TrackId }
  | { type: 'play_all' }
  | { type: 'pause_all' }
  /** Play the channels marked for Resume (the ones last played). */
  | { type: 'resume' }
  /** Mark a channel for Resume, or unmark it. */
  | { type: 'select'; trackId: TrackId; on: boolean }
  /** Bring a channel to the main display. */
  | { type: 'focus'; trackId: TrackId }
  /** Move the main display to the previous or next channel. */
  | { type: 'step'; dir: 1 | -1 }
  | { type: 'seek'; trackId: TrackId; time: number }
  /** Pause and go back to the start (the deck's Stop). */
  | { type: 'stop'; trackId: TrackId }
  | { type: 'volume'; trackId: TrackId; volume: number }
  | { type: 'loop'; trackId: TrackId; on: boolean }
  | { type: 'add'; url: string }
  | { type: 'remove'; trackId: TrackId }
  | { type: 'relink'; trackId: TrackId; url: string }
  /**
   * Load a list of links: replace the mix (taking `name`) or add to it.
   * `resume` (replace only): the links to mark for Resume, from a saved mix.
   */
  | { type: 'load_mix'; urls: string[]; name: string | null; mode: 'replace' | 'append'; resume?: string[] };

export type CommandType = Command['type'];

/** Runs a command on this device; false when it couldn't be applied. */
type CommandRunner = (command: Command) => boolean;

/**
 * Decides where a command goes. Returns true when it took the command (sent
 * it to another device), false to run it here.
 */
type CommandRoute = (command: Command) => boolean;

let cmdRunLocally: CommandRunner | null = null;
let cmdRoute: CommandRoute | null = null;

/** The local implementation (src/main.ts registers it at start-up). */
export function setCommandRunner(runner: CommandRunner): void {
  cmdRunLocally = runner;
}

/** Remote control's hook: send commands elsewhere instead of running them. */
export function setCommandRoute(next: CommandRoute | null): void {
  cmdRoute = next;
}

/**
 * Apply a command: on this device, or wherever the route sends it.
 * True when it was applied here or handed on; false when it failed here.
 */
export function dispatch(command: Command): boolean {
  if (cmdRoute && cmdRoute(command)) return true;
  return cmdRunLocally ? cmdRunLocally(command) : false;
}
