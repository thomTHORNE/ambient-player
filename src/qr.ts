/**
 * A small QR code encoder: byte mode, error correction level M, versions 1–10
 * (up to 213 bytes), drawn as SVG. Enough for pairing links.
 *
 * Follows the QR code specification (ISO/IEC 18004); the structure mirrors
 * Project Nayuki's reference implementation (MIT): data and error correction
 * codewords, function patterns, zig-zag placement, one fixed mask.
 */

/** Error correction codewords per block and number of blocks, level M, by version (index 0 unused). */
const QR_ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const QR_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format information for level M is 0b00. */
const QR_LEVEL_BITS = 0;
const QR_MASK = 0;

function qrRawModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function qrDataCodewords(ver: number): number {
  return Math.floor(qrRawModules(ver) / 8) - QR_ECC_PER_BLOCK[ver] * QR_BLOCKS[ver];
}

function qrMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function qrDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = qrMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = qrMultiply(root, 0x02);
  }
  return result;
}

function qrRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= qrMultiply(coef, factor)));
  }
  return result;
}

/** The modules of a QR code for `text` (true is dark), or null if it is too long. */
export function qrEncode(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));

  // Smallest version that fits: mode (4 bits) + count (8 or 16 bits) + data.
  let ver = 1;
  for (; ver <= 10; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= qrDataCodewords(ver) * 8) break;
  }
  if (ver > 10) return null;
  const capacity = qrDataCodewords(ver) * 8;

  // Data bits, terminator, padding.
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // Error correction, split into blocks and interleaved.
  const numBlocks = QR_BLOCKS[ver];
  const eccLen = QR_ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(qrRawModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = qrDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = qrRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(block[i]);
    });
  }

  // The grid.
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Finder patterns.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  // Alignment patterns.
  const align: number[] = [];
  if (ver > 1) {
    const count = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < count; pos -= step) align.splice(1, 0, pos);
  }
  align.forEach((ay, i) =>
    align.forEach((ax, j) => {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (corner) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    })
  );

  // Format information (level and mask), twice, plus the dark module.
  const formatData = (QR_LEVEL_BITS << 3) | QR_MASK;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0x5412;
  const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(format, i));
  set(8, 7, bit(format, 6));
  set(8, 8, bit(format, 7));
  set(7, 8, bit(format, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i));
  set(8, size - 8, true);

  // Version information (version 7 and up).
  if (ver >= 7) {
    let vrem = ver;
    for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
    const versionBits = (ver << 12) | vrem;
    for (let i = 0; i < 18; i++) {
      const dark = bit(versionBits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Data, in the zig-zag order, then the mask.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && index < codewords.length * 8) {
          modules[y][x] = bit(codewords[index >>> 3], 7 - (index & 7));
          index++;
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x];
    }
  }
  return modules;
}

/** An SVG QR code for `text`: dark modules in `currentColor`, with the quiet zone. */
export function qrSvg(text: string, label: string): string {
  const modules = qrEncode(text);
  if (!modules) return '';
  const size = modules.length;
  const quiet = 4;
  let path = '';
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    })
  );
  const full = size + quiet * 2;
  return `<svg viewBox="0 0 ${full} ${full}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#08090A"/></svg>`;
}
