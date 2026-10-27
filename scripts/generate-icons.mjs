// Generates the favicon set from the neutral launcher mark (components/brand.tsx):
//   app/icon.svg, app/favicon.ico (16/32/48 px), app/apple-icon.png (180 px).
// Next.js serves these through its metadata file conventions.
//   node scripts/generate-icons.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Geometry in a 32×32 unit square (same as BrandMark).
const BLUE = [0x33, 0x41, 0x55]; // slate background
const WHITE = [0xff, 0xff, 0xff];
const TILES = [[8, 8], [17, 8], [8, 17], [17, 17]]; // 7×7 tiles

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#334155"/><rect x="8" y="8" width="7" height="7" rx="1.5" fill="#fff"/><rect x="17" y="8" width="7" height="7" rx="1.5" fill="#fff"/><rect x="8" y="17" width="7" height="7" rx="1.5" fill="#fff"/><rect x="17" y="17" width="7" height="7" rx="1.5" fill="#fff"/></svg>
`;

function insideRoundedRect(x, y, r = 8) {
  if (x < 0 || y < 0 || x > 32 || y > 32) return false;
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
const inTile = (px, py) => TILES.some(([x, y]) => px >= x && px <= x + 7 && py >= y && py <= y + 7);

/** RGBA pixels at `size`, 4×4 supersampled. */
function render(size, background = null) {
  const px = new Uint8Array(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const ux = ((x + (sx + 0.5) / S) / size) * 32;
          const uy = ((y + (sy + 0.5) / S) / size) * 32;
          let c = null;
          if (insideRoundedRect(ux, uy, background ? 0 : 8)) {
            c = BLUE;
            if (inTile(ux, uy)) c = WHITE;
          } else if (background) c = background;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = S * S, i = (y * size + x) * 4;
      const cov = a / 255;
      px[i] = cov ? Math.round(r / cov) : 0;
      px[i + 1] = cov ? Math.round(g / cov) : 0;
      px[i + 2] = cov ? Math.round(b / cov) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

writeFileSync(join(root, 'app', 'icon.svg'), SVG);
writeFileSync(join(root, 'app', 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, data: png(size, render(size)) }))));
writeFileSync(join(root, 'app', 'apple-icon.png'), png(180, render(180, BLUE)));
console.log('Wrote app/icon.svg, app/favicon.ico, app/apple-icon.png');
