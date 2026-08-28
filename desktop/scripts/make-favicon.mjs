// Build a real PNG-backed ICO for browsers that still request /favicon.ico.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '..', '..');
const svg = readFileSync(join(root, 'icon.svg'));
const png = await sharp(svg, { density: 256 }).resize(32, 32).png().toBuffer();

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);       // reserved
header.writeUInt16LE(1, 2);       // icon
header.writeUInt16LE(1, 4);       // one image
header.writeUInt8(32, 6);         // width
header.writeUInt8(32, 7);         // height
header.writeUInt8(0, 8);          // palette
header.writeUInt8(0, 9);          // reserved
header.writeUInt16LE(1, 10);      // color planes
header.writeUInt16LE(32, 12);     // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);

const ico = Buffer.concat([header, png]);
writeFileSync(join(root, 'favicon.ico'), ico);
writeFileSync(join(root, 'web', 'public', 'favicon.ico'), ico);
console.log('wrote favicon.ico and web/public/favicon.ico');
