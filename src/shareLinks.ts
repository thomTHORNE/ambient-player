/**
 * Share links: a mix's YouTube URLs encoded into the page URL's hash
 * (#pl=<base64url JSON>), read back on load or pasted into Import.
 */

import { isValidYouTubeUrl } from './youtubePlayer.js';

/**
 * Encode a list of URLs into a shareable URL
 */
export function encodePlaylistToUrl(urls: string[]): string {
  const json = JSON.stringify(urls);
  const base64 = btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const url = new URL(window.location.href);
  url.hash = `pl=${base64}`;
  return url.toString();
}

/**
 * Decode playlist URLs from the current location hash
 */
export function decodePlaylistFromLocation(): string[] | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#pl=')) return null;
  return decodePayload(hash.slice(4));
}

/** The URL list inside a share link's #pl= payload, or null if it isn't one. */
function decodePayload(payload: string): string[] | null {
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const urls: unknown = JSON.parse(atob(base64));
    if (!Array.isArray(urls)) return null;
    return urls.filter((u): u is string => typeof u === 'string');
  } catch {
    return null;
  }
}

/**
 * The mix in pasted text: a share link, or else any YouTube links in it
 * (one or several, separated by spaces, commas or new lines). Null when
 * there is nothing to import.
 */
export function decodePlaylistFromText(text: string): string[] | null {
  const share = text.match(/#pl=([A-Za-z0-9_-]+)/);
  const urls = share
    ? decodePayload(share[1]) ?? []
    : text.match(/https?:\/\/[^\s,;"'<>]+/g) ?? [];
  const valid = urls.filter(isValidYouTubeUrl);
  return valid.length > 0 ? valid : null;
}

/**
 * Clear the playlist hash from the URL
 */
export function clearPlaylistHash(): void {
  if (window.location.hash.startsWith('#pl=')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

