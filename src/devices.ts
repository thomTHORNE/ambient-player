/**
 * The Devices section (fourth panel): pairing devices for remote control
 * (docs/remote-control-plan.md, phase 2).
 *
 * - Connect a device: creates the room if this device has none, then shows
 *   a single-use pairing code and a QR code of its link for 10 minutes.
 * - Join: a code typed here, a #pair= link opened in the browser, or a
 *   pairing link pasted into Import pairs this device into that room.
 * - Paired: the device list (online or last seen), renaming this device,
 *   unpairing it, and forgetting all devices (a new room secret).
 */

import {
  relayUrl,
  thisDevice,
  renameThisDevice,
  storedRoom,
  saveRoom,
  createRoom,
  requestPairingCode,
  redeemPairingCode,
  rotateRoom,
  pairingLink,
  pairCodeFromText,
} from './pairing.js';
import { onConnection, connectionStatus, connectRoom, disconnectRoom, reconnectRoom, sendRename, sendLeave } from './remote.js';
import type { ConnectionStatus, DeviceInfo } from './remote.js';
import { qrSvg } from './qr.js';

const dvById = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let dvExpiryTimer = 0;
let dvKnownIds = new Set<string>();

function dvMessage(text: string, ok = false): void {
  const el = dvById<HTMLElement>('devicesMessage');
  el.textContent = text;
  el.classList.toggle('is-ok', ok);
}

function dvEsc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function dvSeen(device: DeviceInfo): string {
  if (device.online) return 'Online';
  const minutes = Math.round((Date.now() - device.lastSeen) / 60000);
  if (minutes < 1) return 'Seen just now';
  if (minutes < 60) return `Seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Seen ${hours} h ago`;
  return `Seen ${Math.round(hours / 24)} d ago`;
}

function dvHidePairBox(): void {
  window.clearInterval(dvExpiryTimer);
  dvExpiryTimer = 0;
  dvById<HTMLElement>('pairBox').hidden = true;
}

function dvRender(status: ConnectionStatus): void {
  const paired = !!storedRoom();
  const configured = !!relayUrl();
  const me = thisDevice();
  const pill = dvById<HTMLElement>('devicesState');
  const intro = dvById<HTMLElement>('devicesIntro');
  const list = dvById<HTMLUListElement>('deviceList');
  const manage = dvById<HTMLElement>('devicesManage');
  const connect = dvById<HTMLButtonElement>('connectDevice');
  const join = dvById<HTMLButtonElement>('joinButton');
  const joinInput = dvById<HTMLInputElement>('joinCode');

  // While disconnected, nobody is known to be online.
  const live = status.state === 'online';
  const devices = status.devices.map((d) => ({ ...d, online: live && d.online }));
  const others = devices.filter((d) => d.id !== me.id);
  const onlineOthers = others.filter((d) => d.online).length;
  let label = 'Not paired';
  let tone = 'idle';
  if (paired) {
    if (status.state === 'online') {
      label = onlineOthers ? `${onlineOthers + 1} online` : 'Paired';
      tone = onlineOthers ? 'live' : 'idle';
    } else if (status.state === 'connecting') {
      label = 'Connecting';
      tone = 'busy';
    } else {
      label = 'Offline';
      tone = 'warn';
    }
  }
  pill.textContent = label;
  pill.className = `pill tone-${tone}`;

  intro.textContent = !configured
    ? "Remote control isn't set up on this copy of the player yet."
    : paired
      ? others.length
        ? 'Paired devices. Open Ambient Player on any of them to use it as a remote.'
        : 'Paired. Connect another device to use it as a remote.'
      : 'Pair another device, such as your phone, to control this player from it like a remote.';

  list.hidden = !paired || devices.length === 0;
  list.innerHTML = devices
    .slice()
    .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : Number(b.online) - Number(a.online)))
    .map(
      (d) => `
      <li class="device${d.online ? ' is-online' : ''}">
        <span class="device__dot" aria-hidden="true"></span>
        <span>
          <span class="device__name">${dvEsc(d.name)}</span>
          <span class="device__seen">${dvSeen(d)}</span>
        </span>
        <span>
          ${d.id === status.mainId ? '<span class="device__tag device__tag--main">Plays</span>' : ''}
          ${d.id === me.id ? '<span class="device__tag">This device</span>' : ''}
        </span>
      </li>`
    )
    .join('');

  manage.hidden = !paired;
  connect.textContent = paired ? 'Connect another device' : 'Connect a device';
  connect.disabled = !configured;
  join.disabled = !configured;
  joinInput.disabled = !configured;
  const nameInput = dvById<HTMLInputElement>('deviceName');
  if (document.activeElement !== nameInput) nameInput.value = me.name;

  // A device that just joined while the code was showing: done.
  const ids = new Set(status.devices.map((d) => d.id));
  const newcomer = status.devices.find((d) => !dvKnownIds.has(d.id) && d.id !== me.id && d.online);
  if (newcomer && dvKnownIds.size > 0 && !dvById<HTMLElement>('pairBox').hidden) {
    dvHidePairBox();
    dvMessage(`${newcomer.name} is paired.`, true);
  }
  if (status.state === 'online') dvKnownIds = ids;

  if (status.unpaired) dvMessage('This device was unpaired from another device.');
}

/** Show a fresh pairing code and its QR code, counting down to expiry. */
async function dvShowCode(): Promise<void> {
  let room = storedRoom();
  if (!room) {
    room = await createRoom();
    saveRoom(room);
    connectRoom();
  }
  const { code, expiresAt } = await requestPairingCode(room);
  const box = dvById<HTMLElement>('pairBox');
  dvById<HTMLElement>('pairQr').innerHTML = qrSvg(pairingLink(code), `QR code for pairing code ${code}`);
  dvById<HTMLElement>('pairCode').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  const expiry = dvById<HTMLElement>('pairExpiry');
  const tick = () => {
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    if (left === 0) {
      dvHidePairBox();
      dvMessage('The pairing code expired. Connect again for a new one.');
      return;
    }
    expiry.textContent = `Works once · expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  window.clearInterval(dvExpiryTimer);
  dvExpiryTimer = window.setInterval(tick, 1000);
  tick();
  box.hidden = false;
}

/**
 * Pair this device using a code (typed, from a #pair= link, or pasted into
 * Import). Resolves to an error message, or null when paired.
 */
export async function joinWithCode(code: string): Promise<string | null> {
  if (!relayUrl()) return "Remote control isn't set up on this copy of the player yet.";
  const current = storedRoom();
  try {
    const room = await redeemPairingCode(code);
    if (current && current.roomId === room.roomId) {
      dvMessage('This device is already paired with them.', true);
      return null;
    }
    if (current) sendLeave();
    disconnectRoom();
    saveRoom(room);
    connectRoom();
    dvMessage('Paired. Your other devices are listed above.', true);
    return null;
  } catch (error) {
    const message = (error as Error).message;
    dvMessage(message);
    return message;
  }
}

export function setupDevicesPanel(): void {
  const connect = dvById<HTMLButtonElement>('connectDevice');
  const joinInput = dvById<HTMLInputElement>('joinCode');
  const join = dvById<HTMLButtonElement>('joinButton');

  onConnection(dvRender);

  connect.addEventListener('click', async () => {
    dvMessage('');
    connect.disabled = true;
    try {
      await dvShowCode();
    } catch (error) {
      dvMessage((error as Error).message);
    } finally {
      connect.disabled = !relayUrl();
    }
  });
  dvById<HTMLButtonElement>('pairCancel').addEventListener('click', dvHidePairBox);

  const submitJoin = async () => {
    const code = pairCodeFromText(joinInput.value);
    if (!code) {
      dvMessage('Enter the 6-character code shown on the other device.');
      joinInput.focus();
      return;
    }
    join.disabled = true;
    const error = await joinWithCode(code);
    join.disabled = false;
    if (!error) joinInput.value = '';
  };
  join.addEventListener('click', () => void submitJoin());
  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitJoin();
  });

  const nameInput = dvById<HTMLInputElement>('deviceName');
  const rename = () => {
    const device = renameThisDevice(nameInput.value);
    nameInput.value = device.name;
    sendRename(device.name);
    dvMessage('Renamed.', true);
  };
  dvById<HTMLButtonElement>('renameDevice').addEventListener('click', rename);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') rename();
  });

  dvById<HTMLButtonElement>('unpairDevice').addEventListener('click', () => {
    if (!confirm('Unpair this device? It stops being a remote, and pairing again needs a new code.')) return;
    sendLeave();
    window.setTimeout(() => {
      disconnectRoom();
      saveRoom(null);
      dvHidePairBox();
      dvKnownIds = new Set();
      dvRender(connectionStatus());
      dvMessage('This device is unpaired.', true);
    }, 150);
  });

  dvById<HTMLButtonElement>('forgetDevices').addEventListener('click', async () => {
    const room = storedRoom();
    if (!room) return;
    if (!confirm('Forget all devices? Every other device is unpaired and needs a new code to pair again. This cannot be undone.')) return;
    try {
      saveRoom(await rotateRoom(room));
      dvHidePairBox();
      reconnectRoom();
      dvMessage('All other devices are unpaired.', true);
    } catch (error) {
      dvMessage((error as Error).message);
    }
  });

  // Last seen times move on even when nothing else changes.
  window.setInterval(() => {
    if (storedRoom()) dvRender(connectionStatus());
  }, 60000);
}
