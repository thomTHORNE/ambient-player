/**
 * Ambient Player relay.
 *
 * Rooms of paired devices, so one device can remote-control another
 * (docs/remote-control-plan.md). The Worker routes requests; each room is a
 * Room Durable Object that holds the devices' WebSocket connections, and a
 * single Pairing Durable Object holds the short-lived pairing codes.
 *
 * Routes (all JSON; only the origins in ALLOWED_ORIGINS may call them):
 *   POST /rooms               create a room: { roomId, secret }
 *   POST /rooms/:id/codes     { secret } -> a pairing code: { code, expiresAt }
 *   POST /rooms/:id/rotate    { secret } -> a new secret; every other device is unpaired
 *   POST /pair/:code          swap a pairing code for { roomId, secret }
 *   GET  /rooms/:id/ws        WebSocket into the room (authenticates with a `hello` message)
 *
 * In a room, one device is the main device: it plays the audio and is the
 * only one that changes the mix. It sends `state` snapshots, which the room
 * keeps and forwards; other devices send `command`s, which the room forwards
 * to the main device, and its `ack`s go back to the sender. See
 * worker/README.md for the messages.
 */

import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  PAIRING: DurableObjectNamespace<Pairing>;
  ALLOWED_ORIGINS: string;
}

const PROTOCOL = 1;
const CODE_TTL_MS = 10 * 60 * 1000;
/** No 0/O, 1/I/L: easy to read out and type. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_ID = /^[A-Za-z0-9_-]{16,40}$/;
const MAX_MESSAGE = 64 * 1024;
const MAX_DEVICES = 12;
/** Messages a socket may send per second before the rest are dropped. */
const MAX_RATE = 40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let text = '';
  for (const b of data) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomCode(): string {
  const data = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(data, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare two strings without leaking where they differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '';
  return name || 'Device';
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function readSecret(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { secret?: unknown };
    return typeof body.secret === 'string' && body.secret.length >= 16 ? body.secret : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    const okOrigin = allowed.includes(origin);
    const cors: Record<string, string> = okOrigin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: okOrigin ? 204 : 403,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (!okOrigin) return json({ error: 'origin' }, 403);

    const parts = url.pathname.split('/').filter(Boolean);
    const pairing = () => env.PAIRING.get(env.PAIRING.idFromName('pairing'));

    try {
      // POST /rooms
      if (request.method === 'POST' && parts.length === 1 && parts[0] === 'rooms') {
        const roomId = randomToken(18);
        const secret = randomToken(24);
        await env.ROOMS.get(env.ROOMS.idFromName(roomId)).init(await sha256(secret));
        return json({ roomId, secret }, 200, cors);
      }

      // /rooms/:id/...
      if (parts[0] === 'rooms' && parts.length === 3 && ROOM_ID.test(parts[1])) {
        const roomId = parts[1];
        const room = env.ROOMS.get(env.ROOMS.idFromName(roomId));

        if (parts[2] === 'ws' && request.method === 'GET') {
          if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade' }, 426, cors);
          return room.fetch(request);
        }

        if (request.method === 'POST' && (parts[2] === 'codes' || parts[2] === 'rotate')) {
          const secret = await readSecret(request);
          if (!secret || !(await room.checkSecret(await sha256(secret)))) return json({ error: 'unpaired' }, 403, cors);
          if (parts[2] === 'codes') return json(await pairing().create(roomId, secret), 200, cors);
          const next = randomToken(24);
          await room.rotate(await sha256(next));
          return json({ secret: next }, 200, cors);
        }
      }

      // POST /pair/:code
      if (request.method === 'POST' && parts.length === 2 && parts[0] === 'pair') {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        const result = await pairing().redeem(parts[1].toUpperCase(), ip);
        if (result === 'slow') return json({ error: 'slow' }, 429, cors);
        if (!result) return json({ error: 'code' }, 404, cors);
        return json(result, 200, cors);
      }

      return json({ error: 'not found' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'server' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Room: the paired devices and their connections
// ---------------------------------------------------------------------------

interface DeviceRecord {
  id: string;
  name: string;
  lastSeen: number;
}

interface SocketTag {
  authed: boolean;
  deviceId?: string;
}

/** The main device's last snapshot, with when the room received it (room clock). */
interface StoredState {
  state: unknown;
  receivedAt: number;
}

export class Room extends DurableObject<Env> {
  /** Recent message times per socket, for the rate limit (kept in memory only). */
  private rates = new WeakMap<WebSocket, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered without waking the object, so idle rooms sleep.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async init(secretHash: string): Promise<void> {
    if (await this.ctx.storage.get('hash')) throw new Error('room exists');
    await this.ctx.storage.put({ hash: secretHash, devices: {} });
  }

  async checkSecret(secretHash: string): Promise<boolean> {
    const hash = await this.ctx.storage.get<string>('hash');
    return !!hash && sameText(hash, secretHash);
  }

  /** Forget all devices: a new secret, and every connection closed. */
  async rotate(secretHash: string): Promise<void> {
    await this.ctx.storage.put({ hash: secretHash, devices: {}, mainId: null, state: null });
    for (const ws of this.ctx.getWebSockets()) ws.close(4001, 'unpaired');
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authed: false } satisfies SocketTag);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) {
      ws.close(1009, 'message too big');
      return;
    }
    let msg: { type?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const tag = (ws.deserializeAttachment() ?? { authed: false }) as SocketTag;

    if (!tag.authed) {
      if (msg.type !== 'hello') {
        ws.close(4003, 'hello first');
        return;
      }
      const secret = typeof msg.secret === 'string' ? msg.secret : '';
      if (!secret || !(await this.checkSecret(await sha256(secret)))) {
        ws.send(JSON.stringify({ type: 'error', code: 'unpaired' }));
        ws.close(4001, 'unpaired');
        return;
      }
      const deviceId = typeof msg.deviceId === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(msg.deviceId) ? msg.deviceId : '';
      if (!deviceId) {
        ws.close(4003, 'device id');
        return;
      }
      const devices = await this.devices();
      if (!devices[deviceId] && Object.keys(devices).length >= MAX_DEVICES) {
        ws.send(JSON.stringify({ type: 'error', code: 'full' }));
        ws.close(4004, 'room full');
        return;
      }
      // One connection per device: a newer one replaces the old.
      for (const other of this.ctx.getWebSockets()) {
        const otherTag = other.deserializeAttachment() as SocketTag | null;
        if (other !== ws && otherTag?.deviceId === deviceId) other.close(4000, 'replaced');
      }
      ws.serializeAttachment({ authed: true, deviceId } satisfies SocketTag);
      devices[deviceId] = { id: deviceId, name: cleanName(msg.name), lastSeen: Date.now() };
      await this.ctx.storage.put('devices', devices);
      const mainId = await this.mainId();
      const stored = await this.ctx.storage.get<StoredState>('state');
      ws.send(
        JSON.stringify({
          type: 'welcome',
          protocol: PROTOCOL,
          deviceId,
          devices: this.list(devices),
          mainId,
          state: stored?.state ?? null,
          receivedAt: stored?.receivedAt ?? 0,
          serverTime: Date.now(),
        })
      );
      await this.broadcastDevices(devices, { skip: ws });
      return;
    }

    if (!this.allow(ws)) return;
    const devices = await this.devices();
    const me = tag.deviceId ? devices[tag.deviceId] : undefined;
    if (!me) return;
    const mainId = await this.mainId();

    switch (msg.type) {
      case 'rename':
        me.name = cleanName(msg.name);
        await this.ctx.storage.put('devices', devices);
        await this.broadcastDevices(devices);
        break;

      case 'leave':
        delete devices[me.id];
        await this.ctx.storage.put('devices', devices);
        if (mainId === me.id) await this.ctx.storage.put({ mainId: null, state: null });
        ws.close(1000, 'left');
        await this.broadcastDevices(devices, { skip: ws, closing: ws });
        break;

      // Become the main device: granted when there is none, or it is offline.
      case 'claim_main': {
        const mainOnline = !!mainId && mainId !== me.id && !!this.socketFor(mainId);
        if (mainOnline) {
          ws.send(JSON.stringify({ type: 'claim_denied', mainId }));
          break;
        }
        if (mainId !== me.id) {
          await this.ctx.storage.put({ mainId: me.id, state: null });
          await this.broadcastDevices(devices);
        }
        break;
      }

      // A snapshot from the main device: keep it and pass it on.
      case 'state': {
        if (mainId !== me.id || typeof msg.state !== 'object' || msg.state === null) break;
        const stored: StoredState = { state: msg.state, receivedAt: Date.now() };
        await this.ctx.storage.put('state', stored);
        const text = JSON.stringify({ type: 'state', ...stored });
        for (const other of this.authedSockets()) if (other !== ws) this.trySend(other, text);
        break;
      }

      // A command from a remote: to the main device, or back with an error.
      case 'command': {
        const id = typeof msg.id === 'string' ? msg.id.slice(0, 40) : '';
        if (!id || typeof msg.command !== 'object' || msg.command === null) break;
        const main = mainId && mainId !== me.id ? this.socketFor(mainId) : null;
        if (!main) {
          ws.send(JSON.stringify({ type: 'ack', id, ok: false, error: 'no_main' }));
          break;
        }
        this.trySend(main, JSON.stringify({ type: 'command', id, from: me.id, command: msg.command }));
        break;
      }

      // The main device's answer to a command, back to the device that sent it.
      case 'ack': {
        if (mainId !== me.id || typeof msg.to !== 'string' || typeof msg.id !== 'string') break;
        const target = this.socketFor(msg.to);
        if (target) {
          this.trySend(
            target,
            JSON.stringify({ type: 'ack', id: msg.id, ok: msg.ok === true, error: typeof msg.error === 'string' ? msg.error : undefined })
          );
        }
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const tag = ws.deserializeAttachment() as SocketTag | null;
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      // Already closed.
    }
    if (!tag?.authed || !tag.deviceId) return;
    const devices = await this.devices();
    const me = devices[tag.deviceId];
    if (me) {
      me.lastSeen = Date.now();
      await this.ctx.storage.put('devices', devices);
    }
    await this.broadcastDevices(devices, { skip: ws, closing: ws });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }

  private async devices(): Promise<Record<string, DeviceRecord>> {
    return (await this.ctx.storage.get<Record<string, DeviceRecord>>('devices')) ?? {};
  }

  private async mainId(): Promise<string | null> {
    return (await this.ctx.storage.get<string | null>('mainId')) ?? null;
  }

  private authedSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const tag = ws.deserializeAttachment() as SocketTag | null;
      return !!tag?.authed && ws.readyState === WebSocket.OPEN;
    });
  }

  /** The open connection of a device, if it is online. */
  private socketFor(deviceId: string): WebSocket | null {
    return (
      this.authedSockets().find((ws) => (ws.deserializeAttachment() as SocketTag | null)?.deviceId === deviceId) ?? null
    );
  }

  private trySend(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch {
      // Closing; it will be cleaned up.
    }
  }

  /** At most MAX_RATE messages per second per socket; the rest are dropped. */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const recent = (this.rates.get(ws) ?? []).filter((t) => now - t < 1000);
    recent.push(now);
    this.rates.set(ws, recent);
    return recent.length <= MAX_RATE;
  }

  /** The device list, with who is connected right now. */
  private list(devices: Record<string, DeviceRecord>, closing?: WebSocket) {
    const online = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const tag = ws.deserializeAttachment() as SocketTag | null;
      if (ws !== closing && ws.readyState === WebSocket.OPEN && tag?.authed && tag.deviceId) online.add(tag.deviceId);
    }
    return Object.values(devices)
      .map((d) => ({ ...d, online: online.has(d.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Send the device list (and the main device) to every connected device except `skip`; `closing` counts as offline. */
  private async broadcastDevices(
    devices: Record<string, DeviceRecord>,
    opts: { skip?: WebSocket; closing?: WebSocket } = {}
  ): Promise<void> {
    const { skip, closing } = opts;
    const text = JSON.stringify({ type: 'devices', devices: this.list(devices, closing), mainId: await this.mainId() });
    for (const ws of this.ctx.getWebSockets()) {
      const tag = ws.deserializeAttachment() as SocketTag | null;
      if (ws === skip || !tag?.authed || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(text);
      } catch {
        // Closing; it will be cleaned up.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pairing: short-lived, single-use codes
// ---------------------------------------------------------------------------

interface CodeRecord {
  roomId: string;
  secret: string;
  expiresAt: number;
}

export class Pairing extends DurableObject<Env> {
  /** Recent redeem attempts per IP, so codes can't be guessed quickly. */
  private attempts = new Map<string, number[]>();

  async create(roomId: string, secret: string): Promise<{ code: string; expiresAt: number }> {
    let code = randomCode();
    while (await this.ctx.storage.get(`code:${code}`)) code = randomCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    await this.ctx.storage.put(`code:${code}`, { roomId, secret, expiresAt } satisfies CodeRecord);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(expiresAt + 1000);
    return { code, expiresAt };
  }

  async redeem(code: string, ip: string): Promise<{ roomId: string; secret: string } | null | 'slow'> {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.attempts.set(ip, recent);
    if (recent.length > 10) return 'slow';
    if (!/^[A-Z0-9]{6}$/.test(code)) return null;
    const record = await this.ctx.storage.get<CodeRecord>(`code:${code}`);
    if (!record) return null;
    await this.ctx.storage.delete(`code:${code}`);
    if (record.expiresAt < now) return null;
    return { roomId: record.roomId, secret: record.secret };
  }

  /** Clear expired codes. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const codes = await this.ctx.storage.list<CodeRecord>({ prefix: 'code:' });
    let next = Infinity;
    for (const [key, record] of codes) {
      if (record.expiresAt < now) await this.ctx.storage.delete(key);
      else next = Math.min(next, record.expiresAt);
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(next + 1000);
  }
}
