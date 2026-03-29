import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';

const ICONS_DIR = join(import.meta.dirname, '..', 'public', 'icons');
mkdirSync(ICONS_DIR, { recursive: true });

// CRC32
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, checksum]);
}

function createPNG(size) {
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // RGB
  const ihdr = makeChunk('IHDR', ihdrData);

  // Image data: blue circle on transparent-ish background
  const rows = [];
  const cx = size / 2, cy = size / 2, r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inside = dist <= r;
      const offset = 1 + x * 3;
      if (inside) {
        row[offset] = 0x42;     // R
        row[offset + 1] = 0x63; // G
        row[offset + 2] = 0xeb; // B
      } else {
        row[offset] = 0xee;
        row[offset + 1] = 0xee;
        row[offset + 2] = 0xee;
      }
    }
    rows.push(row);
  }

  const rawData = Buffer.concat(rows);
  const compressed = deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);

  const iend = makeChunk('IEND', Buffer.alloc(0));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([signature, ihdr, idat, iend]);
}

for (const size of [16, 32, 48, 128]) {
  const png = createPNG(size);
  const path = join(ICONS_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated icon-${size}.png (${png.length} bytes)`);
}
