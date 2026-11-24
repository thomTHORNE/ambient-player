/**
 * Pairing: this device's identity, the room it's paired into, and the
 * relay's HTTP calls (docs/remote-control-plan.md).
 *
 * - The relay's address comes from <meta name="ambient-relay"> in
 *   index.html (empty until the relay is deployed). For development,
 *   ?relay=http://127.0.0.1:8787 points this browser at a local relay; only
 *   localhost addresses are accepted that way, so a link can't redirect a
 *   device to someone else's relay.
 * - The room (ID and secret) is kept in localStorage. The secret is sent
 *   only to the relay, never in a link: pairing links carry a short-lived,
 *   single-use code instead.
 */

export interface RoomLink {
  roomId: string;
  secret: string;
}

export interface ThisDevice {
  id: string;
  name: string;
}

const ROOM_KEY = 'ambient-player:room';
const DEVICE_KEY = 'ambient-player:device';
const RELAY_KEY = 'ambient-player:relay';
const LOCAL_RELAY = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function pairingToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept; works for this visit.
  }
}

// ---------------------------------------------------------------------------
// Relay address
// ---------------------------------------------------------------------------

/** Take ?relay=<localhost address> from the URL (development), then drop it. */
export function takeRelayOverride(): void {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('relay');
  if (value === null) return;
  try {
    if (value === '' || value === 'off') localStorage.removeItem(RELAY_KEY);
    else if (LOCAL_RELAY.test(value.replace(/\/$/, ''))) localStorage.setItem(RELAY_KEY, value.replace(/\/$/, ''));
  } catch {
    // Ignore.
  }
  params.delete('relay');
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
}

/** The relay's base URL, or '' when remote control isn't set up. */
export function relayUrl(): string {
  let override = '';
  try {
    override = localStorage.getItem(RELAY_KEY) || '';
  } catch {
    // Ignore.
  }
  if (override && LOCAL_RELAY.test(override)) return override;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="ambient-relay"]')?.content.trim() || '';
  return /^https:\/\//.test(meta) ? meta.replace(/\/$/, '') : '';
}

// ---------------------------------------------------------------------------
// This device and its room
// ---------------------------------------------------------------------------

/** A readable default name, e.g. "Brave on Android". */
function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const brave = (navigator as Navigator & { brave?: unknown }).brave !== undefined;
  const browser = brave
    ? 'Brave'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const system = /Android/.test(ua)
    ? 'Android'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1
        ? 'iPad'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'this device';
  return `${browser} on ${system}`;
}

export function thisDevice(): ThisDevice {
  const stored = readJson<ThisDevice>(DEVICE_KEY);
  if (stored && typeof stored.id === 'string' && typeof stored.name === 'string') return stored;
  const device = { id: pairingToken(12), name: defaultDeviceName() };
  writeJson(DEVICE_KEY, device);
  return device;
}

export function renameThisDevice(name: string): ThisDevice {
  const device = { ...thisDevice(), name: name.trim().slice(0, 40) || defaultDeviceName() };
  writeJson(DEVICE_KEY, device);
  return device;
}

export function storedRoom(): RoomLink | null {
  const room = readJson<RoomLink>(ROOM_KEY);
  return room && typeof room.roomId === 'string' && typeof room.secret === 'string' ? room : null;
}

export function saveRoom(room: RoomLink | null): void {
  writeJson(ROOM_KEY, room);
}

// ---------------------------------------------------------------------------
// Relay calls
// ---------------------------------------------------------------------------

async function relayPost<T>(path: string, body?: unknown): Promise<T> {
  const base = relayUrl();
  if (!base) throw new Error('Remote control is not set up on this copy of the player.');
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the relay. Check the connection and try again.");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const reason = data.error;
    throw new Error(
      reason === 'code'
        ? "That code doesn't work. Codes last 10 minutes and work once."
        : reason === 'slow'
          ? 'Too many tries. Wait a minute and try again.'
          : reason === 'unpaired'
            ? 'This device is no longer paired.'
            : 'The relay had a problem. Try again.'
    );
  }
  return data;
}

export function createRoom(): Promise<RoomLink> {
  return relayPost<RoomLink>('/rooms');
}

export function requestPairingCode(room: RoomLink): Promise<{ code: string; expiresAt: number }> {
  return relayPost(`/rooms/${encodeURIComponent(room.roomId)}/codes`, { secret: room.secret });
}

export function redeemPairingCode(code: string): Promise<RoomLink> {
  return relayPost<RoomLink>(`/pair/${encodeURIComponent(code)}`);
}

/** Forget all devices: the room gets a new secret; only this device keeps it. */
export async function rotateRoom(room: RoomLink): Promise<RoomLink> {
  const { secret } = await relayPost<{ secret: string }>(`/rooms/${encodeURIComponent(room.roomId)}/rotate`, {
    secret: room.secret,
  });
  return { roomId: room.roomId, secret };
}

// ---------------------------------------------------------------------------
// Pairing links
// ---------------------------------------------------------------------------

/** The link a QR code carries: opening it pairs the device. */
export function pairingLink(code: string): string {
  return `${window.location.origin}${window.location.pathname}#pair=${code}`;
}

/** A pairing code from a link or typed text ("ABC 123", "abc123"), or null. */
export function pairCodeFromText(text: string): string | null {
  const fromLink = text.match(/#pair=([A-Za-z0-9]{6})\b/);
  if (fromLink) return fromLink[1].toUpperCase();
  const typed = text.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{6}$/.test(typed) ? typed.toUpperCase() : null;
}

/** A pairing code in the page URL (#pair=…), removed from the URL once read. */
export function takePairCodeFromLocation(): string | null {
  const match = window.location.hash.match(/^#pair=([A-Za-z0-9]{6})$/);
  if (!match) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return match[1].toUpperCase();
}
