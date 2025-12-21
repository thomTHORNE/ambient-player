/**
 * Share links module for encoding/decoding playlist URLs
 */
/**
 * Encode a list of URLs into a shareable URL
 */
export function encodePlaylistToUrl(urls) {
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
export function decodePlaylistFromLocation() {
    const hash = window.location.hash;
    if (!hash.startsWith('#pl='))
        return null;
    const base64 = hash.slice(4)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    try {
        const json = atob(base64);
        const urls = JSON.parse(json);
        if (!Array.isArray(urls))
            return null;
        return urls;
    }
    catch {
        return null;
    }
}
/**
 * Clear the playlist hash from the URL
 */
export function clearPlaylistHash() {
    if (window.location.hash.startsWith('#pl=')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}
