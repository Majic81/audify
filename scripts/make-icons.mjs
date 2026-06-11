// Renders the Audify app icon (speaker + sound waves on an indigo gradient)
// to PNG at the sizes iOS/PWA need, with no dependencies beyond Node's zlib.
// Usage: node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

const TOP = [0x43, 0x38, 0xca];
const BOTTOM = [0x1e, 0x1b, 0x4b];
const FG = [0xf8, 0xfa, 0xfc];

// All shape tests in unit coordinates (0..1), mirroring icon.svg.
function inSpeaker(u, v) {
  if (u >= 0.24 && u <= 0.34 && v >= 0.43 && v <= 0.57) return true;
  if (u >= 0.34 && u <= 0.46) {
    const half = 0.07 + ((u - 0.34) / 0.12) * 0.11;
    return Math.abs(v - 0.5) <= half;
  }
  return false;
}

function inWave(u, v, radius) {
  const du = u - 0.46, dv = v - 0.5;
  if (du <= 0) return false;
  const r = Math.hypot(du, dv);
  return Math.abs(r - radius) <= 0.025 && Math.abs(Math.atan2(dv, du)) <= 0.9;
}

function pixel(u, v) {
  const fg = inSpeaker(u, v) || inWave(u, v, 0.155) || inWave(u, v, 0.26);
  if (fg) return FG;
  return [0, 1, 2].map((c) => Math.round(TOP[c] + (BOTTOM[c] - TOP[c]) * v));
}

function render(size) {
  const SS = 3; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr; g += pg; b += pb;
        }
      }
      const off = y * (size * 3 + 1) + 1 + x * 3;
      raw[off] = r / (SS * SS);
      raw[off + 1] = g / (SS * SS);
      raw[off + 2] = b / (SS * SS);
    }
  }
  return raw;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, png(size));
  console.log('wrote', file);
}
