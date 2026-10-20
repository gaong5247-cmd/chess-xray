/**
 * Generate platform icon assets without image libraries, local dependencies or network.
 * Stores a multiresolution ICO (including 256px PNG) for Tauri Windows builds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, payload) {
  const kind = Buffer.from(name, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([kind, payload])));
  return Buffer.concat([size, kind, payload, check]);
}
function image(size) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    data[row] = 0;
    for (let x = 0; x < size; x++) {
      const nx = (x + .5) / size, ny = (y + .5) / size;
      const dx = Math.min(nx, 1 - nx), dy = Math.min(ny, 1 - ny);
      const inside = dx > .07 && dy > .07 || (
        (dx - .07) ** 2 + (dy - .07) ** 2 < .07 ** 2 && dx >= 0 && dy >= 0);
      const frame = inside && (dx < .14 || dy < .14);
      const diagonal = Math.abs(nx - ny) < .073 || Math.abs(nx + ny - 1) < .073;
      const eyeRing = Math.abs(((nx - .5) / .245) ** 2 + ((ny - .5) / .245) ** 2 - 1) < .28;
      const core = ((nx - .5) ** 2 + (ny - .5) ** 2) < .075 ** 2;
      const i = row + 1 + 4 * x;
      if (!inside) { data[i + 3] = 0; continue; }
      const base = Math.floor(19 + 16 * nx);
      const color = core ? [247, 255, 221] : frame ? [75, 151, 143]
        : (diagonal || eyeRing) ? [197, 243, 121] : [base - 8, base + 13, base + 25];
      data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
const sizes = [32, 48, 64, 128, 256];
const layers = sizes.map(image);
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(layers.length, 4);
let offset = 6 + 16 * layers.length;
const directory = layers.map((layer, i) => {
  const entry = Buffer.alloc(16);
  entry[0] = sizes[i] === 256 ? 0 : sizes[i];
  entry[1] = sizes[i] === 256 ? 0 : sizes[i];
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(layer.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += layer.length;
  return entry;
});
const target = join('src-tauri', 'icons');
mkdirSync(target, { recursive: true });
writeFileSync(join(target, 'icon.ico'), Buffer.concat([icoHeader, ...directory, ...layers]));
writeFileSync(join(target, 'icon.png'), layers[layers.length - 1]);
console.log('Generated Chess X-Ray icon.ico + icon.png');
