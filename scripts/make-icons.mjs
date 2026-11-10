// Generates the PNG app icons (no dependencies): dark tile with three lime "progress" bars.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [14, 15, 18];
const FG = [198, 244, 50];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Signed distance to a rounded rect (for smooth anti-aliased edges).
function inPill(x, y, x0, y0, w, h) {
  const r = h / 2;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = y0 + r;
  return r - Math.hypot(x - cx, y - cy);
}

function icon(size) {
  const s = size / 512;
  const bars = [
    [128, 150, 256, 1],
    [128, 232, 192, 0.75],
    [128, 314, 128, 0.5],
  ];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (const [bx, by, bw, op] of bars) {
        const d = inPill(x + 0.5, y + 0.5, bx * s, by * s, bw * s, 48 * s);
        a = Math.max(a, Math.min(1, Math.max(0, d + 0.5)) * op);
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), icon(size));
}
console.log('icons written');
