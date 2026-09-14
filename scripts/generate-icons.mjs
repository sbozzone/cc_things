/**
 * Generates the app icons as PNGs, with no image dependency.
 *
 * Run with `node scripts/generate-icons.mjs`. The output is committed, so a deploy
 * never has to rasterize anything.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ACCENT = [0xfa, 0x46, 0x16];
const INK = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distance from a point to a line segment, used to draw the mark with soft edges. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = maskable ? size * 0.06 : size * 0.0;
  const radius = maskable ? size * 0.5 : size * 0.22;
  const cx = size / 2;
  const stroke = size * 0.085;
  // A check mark drawn once, scaled to the canvas.
  const marks = [
    [0.26, 0.52, 0.44, 0.70],
    [0.44, 0.70, 0.76, 0.32],
  ].map(([x1, y1, x2, y2]) => [x1 * size, y1 * size, x2 * size, y2 * size]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Rounded-square coverage.
      const qx = Math.abs(px - cx) - (size / 2 - inset - radius);
      const qy = Math.abs(py - cx) - (size / 2 - inset - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - outside));

      let markAlpha = 0;
      for (const [x1, y1, x2, y2] of marks) {
        const d = distanceToSegment(px, py, x1, y1, x2, y2);
        markAlpha = Math.max(markAlpha, Math.max(0, Math.min(1, stroke / 2 - d + 0.5)));
      }

      const i = (y * size + x) * 4;
      const r = ACCENT[0] + (INK[0] - ACCENT[0]) * markAlpha;
      const g = ACCENT[1] + (INK[1] - ACCENT[1]) * markAlpha;
      const b = ACCENT[2] + (INK[2] - ACCENT[2]) * markAlpha;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(bgAlpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const outputs = [
  ['public/icon-192.png', render(192)],
  ['public/icon-512.png', render(512)],
  ['public/icon-maskable-512.png', render(512, { maskable: true })],
  ['public/apple-icon.png', render(180)],
  ['public/favicon-32.png', render(32)],
];

for (const [path, buffer] of outputs) {
  writeFileSync(path, buffer);
  console.log(`wrote ${path} (${buffer.length} bytes)`);
}
