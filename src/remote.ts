/**
 * The connection to the paired room (docs/remote-control-plan.md).
 *
 * While this device is paired, it keeps one WebSocket open to its room on
 * the relay: it says `hello` with the room secret, gets the device list in
 * `welcome`, and hears `devices` whenever someone joins, leaves, renames or
 * goes offline. It reconnects on its own (1, 2, 5, 10, then every 30
 * seconds, and right away when the page becomes visible or the network comes
 * back) and sends a heartbeat every 20 seconds, which the relay answers
 * without waking the room.
 *
 * Roles: one device in the room is the main device (it plays the audio).
 * While the main device is online, every other device is a remote: it
 * mirrors the main device's `state` and sends it commands. When no main
 * device is online, every device is idle and plays on its own; the first to
 * play claims main.
 */

import { relayUrl, storedRoom, saveRoom, thisDevice } from './pairing.js';
import type { Command } from './commands.js';

export interface DeviceInfo {
  id: string;
  name: string;
  lastSeen: number;
  online: boolean;
}

export type ConnectionState = 'off' | 'connecting' | 'online' | 'offline';

/** main: plays and is mirrored; remote: controls the main device; idle: on its own. */
export type Role = 'idle' | 'main' | 'remote';

export interface ConnectionStatus {
  state: ConnectionState;
  devices: DeviceInfo[];
  /** Set when the room no longer accepts this device (unpaired elsewhere). */
  unpaired: boolean;
  /** The room's main device, if any (it may be offline). */
  mainId: string | null;
  role: Role;
  /** The main device's name (for "Remote · Laptop"). */
  mainName: string;
}

export interface CommandReply {
  ok: boolean;
  /** 'no_main', 'timeout', 'offline', or the main device's reason. */
  error?: string;
}

type ConnectionListener = (status: ConnectionStatus) => void;
type StateListener = (state: unknown, ageMs: number) => void;
type CommandHandler = (command: Command, reply: (ok: boolean, error?: string) => void) => void;

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_MS = 20000;
const COMMAND_TIMEOUT_MS = 5000;

let rcSocket: WebSocket | null = null;
let rcStatus: ConnectionStatus = { state: 'off', devices: [], unpaired: false, mainId: null, role: 'idle', mainName: '' };
/** Room clock minus this device's clock, from `welcome`. */
let rcClockOffset = 0;
/** The main device's latest snapshot and when the room received it (room clock). */
let rcLastState: { state: unknown; receivedAt: number } | null = null;
let rcCommandSeq = 0;
const rcPending = new Map<string, { resolve: (reply: CommandReply) => void; timer: number }>();
const rcStateListeners = new Set<StateListener>();
let rcCommandHandler: CommandHandler | null = null;
let rcAttempt = 0;
let rcRetryTimer = 0;
let rcHeartbeat = 0;
let rcWanted = false;
const rcListeners = new Set<ConnectionListener>();

function rcEmit(patch: Partial<ConnectionStatus>): void {
  const next = { ...rcStatus, ...patch };
  // The role follows from who is main and whether it is online.
  const me = thisDevice().id;
  const main = next.devices.find((d) => d.id === next.mainId);
  next.mainName = main?.name ?? '';
  if (next.mainId && next.mainId === me) next.role = 'main';
  else if (next.state === 'online') next.role = main?.online ? 'remote' : 'idle';
  // A remote stays one through a dropped connection while it reconnects;
  // only knowing the main device is offline (or unpairing) makes it idle.
  else if (next.state === 'off' || rcStatus.role !== 'remote') next.role = 'idle';
  rcStatus = next;
  rcListeners.forEach((listener) => listener(rcStatus));
}

function rcStateAge(receivedAt: number): number {
  return Math.max(0, Date.now() + rcClockOffset - receivedAt);
}

function rcFailPending(error: string): void {
  rcPending.forEach(({ resolve, timer }) => {
    window.clearTimeout(timer);
    resolve({ ok: false, error });
  });
  rcPending.clear();
}

export function onConnection(listener: ConnectionListener): void {
  rcListeners.add(listener);
  listener(rcStatus);
}

export function connectionStatus(): ConnectionStatus {
  return rcStatus;
}

function rcSend(message: unknown): boolean {
  if (rcSocket?.readyState !== WebSocket.OPEN) return false;
  rcSocket.send(JSON.stringify(message));
  return true;
}

function rcClear(): void {
  window.clearTimeout(rcRetryTimer);
  window.clearInterval(rcHeartbeat);
  rcRetryTimer = 0;
  rcHeartbeat = 0;
}

function rcScheduleRetry(): void {
  if (!rcWanted || rcRetryTimer) return;
  const delay = RECONNECT_DELAYS[Math.min(rcAttempt, RECONNECT_DELAYS.length - 1)];
  rcAttempt++;
  rcRetryTimer = window.setTimeout(() => {
    rcRetryTimer = 0;
    rcOpen();
  }, delay);
}

function rcOpen(): void {
  const room = storedRoom();
  const base = relayUrl();
  if (!rcWanted || !room || !base) return;
  if (rcSocket && (rcSocket.readyState === WebSocket.OPEN || rcSocket.readyState === WebSocket.CONNECTING)) return;

  rcEmit({ state: rcStatus.state === 'online' ? 'offline' : 'connecting', unpaired: false });
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${encodeURIComponent(room.roomId)}/ws`);
  rcSocket = socket;

  socket.addEventListener('open', () => {
    const device = thisDevice();
    socket.send(JSON.stringify({ type: 'hello', protocol: 1, deviceId: device.id, name: device.name, secret: room.secret }));
    window.clearInterval(rcHeartbeat);
    rcHeartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, HEARTBEAT_MS);
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || event.data === 'pong') return;
    let msg: {
      type?: string;
      devices?: DeviceInfo[];
      mainId?: string | null;
      state?: unknown;
      receivedAt?: number;
      serverTime?: number;
      id?: string;
      from?: string;
      ok?: boolean;
      error?: string;
      command?: Command;
    };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'welcome':
        rcAttempt = 0;
        rcClockOffset = (msg.serverTime ?? Date.now()) - Date.now();
        rcLastState = msg.state ? { state: msg.state, receivedAt: msg.receivedAt ?? 0 } : null;
        rcEmit({ state: 'online', devices: msg.devices ?? [], mainId: msg.mainId ?? null });
        if (rcLastState) rcStateListeners.forEach((l) => l(rcLastState!.state, rcStateAge(rcLastState!.receivedAt)));
        break;
      case 'devices':
        if (msg.mainId !== rcStatus.mainId) rcLastState = null;
        rcEmit({ devices: msg.devices ?? [], mainId: msg.mainId ?? null });
        break;
      case 'state':
        rcLastState = { state: msg.state, receivedAt: msg.receivedAt ?? Date.now() + rcClockOffset };
        rcStateListeners.forEach((l) => l(rcLastState!.state, rcStateAge(rcLastState!.receivedAt)));
        break;
      case 'command': {
        const id = msg.id;
        const from = msg.from;
        if (!id || !from || !msg.command || !rcCommandHandler) break;
        rcCommandHandler(msg.command, (ok, error) => rcSend({ type: 'ack', id, to: from, ok, error }));
        break;
      }
      case 'ack': {
        const pending = msg.id ? rcPending.get(msg.id) : undefined;
        if (!pending || !msg.id) break;
        window.clearTimeout(pending.timer);
        rcPending.delete(msg.id);
        pending.resolve({ ok: msg.ok === true, error: msg.error });
        break;
      }
    }
  });

  socket.addEventListener('close', (event) => {
    if (rcSocket !== socket) return;
    rcSocket = null;
    window.clearInterval(rcHeartbeat);
    rcFailPending('offline');
    if (event.code === 4001) {
      // The room no longer knows this device: it was unpaired elsewhere.
      saveRoom(null);
      rcWanted = false;
      rcEmit({ state: 'off', devices: [], unpaired: true, mainId: null });
      return;
    }
    if (event.code === 4000 || !rcWanted) {
      // Replaced by a newer connection from this device, or closed on purpose.
      if (!rcWanted) rcEmit({ state: 'off', devices: [] });
      return;
    }
    rcEmit({ state: 'offline' });
    rcScheduleRetry();
  });
}

/** Connect to the stored room (if any) and stay connected. */
export function connectRoom(): void {
  if (!storedRoom() || !relayUrl()) return;
  rcWanted = true;
  rcAttempt = 0;
  rcClear();
  rcOpen();
}

/** Close the connection (after unpairing). */
export function disconnectRoom(): void {
  rcWanted = false;
  rcClear();
  const socket = rcSocket;
  rcSocket = null;
  socket?.close(1000, 'bye');
  rcLastState = null;
  rcFailPending('offline');
  rcEmit({ state: 'off', devices: [], unpaired: false, mainId: null });
}

/** Reconnect from scratch (after the room's secret changed). */
export function reconnectRoom(): void {
  disconnectRoom();
  connectRoom();
}

export function sendRename(name: string): void {
  rcSend({ type: 'rename', name });
}

/** Tell the room this device is leaving it (unpair). */
export function sendLeave(): void {
  rcSend({ type: 'leave' });
}

// ---------------------------------------------------------------------------
// Roles, state and commands
// ---------------------------------------------------------------------------

/** Ask to become the main device (granted when no main device is online). */
export function claimMain(): void {
  rcSend({ type: 'claim_main' });
}

/** Main device: share the current state with the remotes. */
export function sendState(state: unknown): void {
  if (rcStatus.role === 'main') rcSend({ type: 'state', state });
}

/** Remote: send a command to the main device; resolves with its answer. */
export function sendCommand(command: Command): Promise<CommandReply> {
  const id = `c${Date.now().toString(36)}${(rcCommandSeq++).toString(36)}`;
  if (!rcSend({ type: 'command', id, command })) return Promise.resolve({ ok: false, error: 'offline' });
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      rcPending.delete(id);
      resolve({ ok: false, error: 'timeout' });
    }, COMMAND_TIMEOUT_MS);
    rcPending.set(id, { resolve, timer });
  });
}

/** Commands in flight (for a pending indicator). */
export function pendingCommands(): number {
  return rcPending.size;
}

/** Main device: run commands from remotes. */
export function onRemoteCommand(handler: CommandHandler): void {
  rcCommandHandler = handler;
}

/** Remote: hear the main device's snapshots, with how old each is (ms). */
export function onRoomState(listener: StateListener): void {
  rcStateListeners.add(listener);
}

/** The latest snapshot and its current age, if any. */
export function lastRoomState(): { state: unknown; ageMs: number } | null {
  return rcLastState ? { state: rcLastState.state, ageMs: rcStateAge(rcLastState.receivedAt) } : null;
}

/** Retry straight away when the page comes back or the network returns. */
export function setupReconnectTriggers(): void {
  const retryNow = () => {
    if (!rcWanted || rcSocket) return;
    rcAttempt = 0;
    rcClear();
    rcOpen();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryNow();
  });
  window.addEventListener('online', retryNow);
}
