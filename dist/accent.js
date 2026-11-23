/**
 * Accent colour from artwork.
 *
 * Samples the current channel's thumbnail, finds its most prevalent vivid hue
 * and returns a version of it that reads well on the dark panels. Returns null
 * when the artwork is too dark, too grey or has no colour that stands out, so
 * the caller can fall back to amber.
 */
/** Used when there is no artwork or it has no usable colour. */
export const FALLBACK_ACCENT = '#FFB24A';
/** The darkest surface accent text sits on (panel over the backdrop). */
const PANEL_RGB = [0x16, 0x1b, 0x1c];
const MIN_CONTRAST = 4.5;
const SAMPLE_W = 64;
const SAMPLE_H = 36;
const HUE_BINS = 36; // 10° each
function luminance([r, g, b]) {
    const lin = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function rgbToHue(r, g, b, max, min) {
    const d = max - min;
    if (d === 0)
        return 0;
    let h;
    if (max === r)
        h = ((g - b) / d) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
}
function toHex([r, g, b]) {
    return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
/**
 * Returns a hex accent colour, or null when the image has no usable colour
 * (too dark, too grey, too little of any one hue) or cannot be read.
 */
export function extractAccent(img) {
    if (!img.complete || img.naturalWidth === 0)
        return null;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx)
        return null;
    let data;
    try {
        ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
        data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    }
    catch {
        return null; // Image not readable (no CORS): use the fallback.
    }
    const weight = new Float64Array(HUE_BINS);
    const satSum = new Float64Array(HUE_BINS);
    const hueX = new Float64Array(HUE_BINS);
    const hueY = new Float64Array(HUE_BINS);
    const total = SAMPLE_W * SAMPLE_H;
    let vivid = 0;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const chroma = max - min;
        const sat = max === 0 ? 0 : chroma / max;
        // Skip near-black, near-white and greyish pixels: they carry no accent.
        if (max < 0.2 || (min > 0.88 && sat < 0.15) || sat < 0.25 || chroma < 0.12)
            continue;
        const h = rgbToHue(r, g, b, max, min);
        const bin = Math.floor(h / (360 / HUE_BINS)) % HUE_BINS;
        // Vivid, bright pixels count more than dull ones.
        const w = chroma * (0.5 + 0.5 * max);
        weight[bin] += w;
        satSum[bin] += sat * w;
        const rad = (h * Math.PI) / 180;
        hueX[bin] += Math.cos(rad) * w;
        hueY[bin] += Math.sin(rad) * w;
        vivid++;
    }
    // Too few coloured pixels: a dark or monochrome image.
    if (vivid / total < 0.05)
        return null;
    // Most prevalent hue, smoothed over neighbouring bins.
    let best = -1;
    let bestWeight = 0;
    for (let i = 0; i < HUE_BINS; i++) {
        const w = weight[(i + HUE_BINS - 1) % HUE_BINS] * 0.5 +
            weight[i] +
            weight[(i + 1) % HUE_BINS] * 0.5;
        if (w > bestWeight) {
            bestWeight = w;
            best = i;
        }
    }
    if (best < 0 || bestWeight / total < 0.02)
        return null;
    let x = 0, y = 0, sw = 0, ss = 0;
    for (const i of [best - 1, best, best + 1]) {
        const k = (i + HUE_BINS) % HUE_BINS;
        x += hueX[k];
        y += hueY[k];
        sw += weight[k];
        ss += satSum[k];
    }
    let hue = (Math.atan2(y, x) * 180) / Math.PI;
    if (hue < 0)
        hue += 360;
    const sat = sw > 0 ? ss / sw : 0.6;
    // Normalise for a dark UI: keep the hue, give it enough saturation and
    // lightness to read as text on the panels.
    const s = Math.min(0.85, Math.max(0.5, sat));
    let l = 0.66;
    let rgb = hslToRgb(hue, s, l);
    while (contrast(rgb, PANEL_RGB) < MIN_CONTRAST && l < 0.86) {
        l += 0.02;
        rgb = hslToRgb(hue, s, l);
    }
    if (contrast(rgb, PANEL_RGB) < MIN_CONTRAST)
        return null;
    return toHex(rgb);
}
