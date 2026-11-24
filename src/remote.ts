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
 * Phase 2 covers presence only. Phase 3 adds roles, state and commands to
 * the same connection.
 */

import { relayUrl, storedRoom, saveRoom, thisDevice } from './pairing.js';

export interface DeviceInfo {
  id: string;
  name: string;
  lastSeen: number;
  online: boolean;
}

export type ConnectionState = 'off' | 'connecting' | 'online' | 'offline';

export interface ConnectionStatus {
  state: ConnectionState;
  devices: DeviceInfo[];
  /** Set when the room no longer accepts this device (unpaired elsewhere). */
  unpaired: boolean;
}

type ConnectionListener = (status: ConnectionStatus) => void;

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const HEARTBEAT_MS = 20000;

let rcSocket: WebSocket | null = null;
let rcStatus: ConnectionStatus = { state: 'off', devices: [], unpaired: false };
let rcAttempt = 0;
let rcRetryTimer = 0;
let rcHeartbeat = 0;
let rcWanted = false;
const rcListeners = new Set<ConnectionListener>();

function rcEmit(patch: Partial<ConnectionStatus>): void {
  rcStatus = { ...rcStatus, ...patch };
  rcListeners.forEach((listener) => listener(rcStatus));
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
    let msg: { type?: string; devices?: DeviceInfo[]; code?: string };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      rcAttempt = 0;
      rcEmit({ state: 'online', devices: msg.devices ?? [] });
    } else if (msg.type === 'devices') {
      rcEmit({ devices: msg.devices ?? [] });
    }
  });

  socket.addEventListener('close', (event) => {
    if (rcSocket !== socket) return;
    rcSocket = null;
    window.clearInterval(rcHeartbeat);
    if (event.code === 4001) {
      // The room no longer knows this device: it was unpaired elsewhere.
      saveRoom(null);
      rcWanted = false;
      rcEmit({ state: 'off', devices: [], unpaired: true });
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
  rcEmit({ state: 'off', devices: [], unpaired: false });
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
