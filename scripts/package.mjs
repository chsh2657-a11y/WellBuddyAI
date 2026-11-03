// Packs extension/ into download/bogard-seo-extension.zip with manifest.json
// at the archive root. Windows "Extract All" (and macOS) unzip it into a
// folder named after the zip, so that folder is exactly the one to select in
// chrome://extensions. (A nested top folder made Windows users pick the
// outer folder and hit "manifest file is missing or unreadable".)
// Dependency-free: deflate + CRC-32 from node:zlib. Fixed timestamps make the
// output byte-identical when the sources haven't changed.
// Run: npm run package

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const SRC = 'extension';
const OUT_DIR = 'download';
const OUT = join(OUT_DIR, 'bogard-seo-extension.zip');
const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|\.git.*)$/;

// 2026-11-03 00:00 in MS-DOS date/time format
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 3;

function walk(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const files = walk(SRC)
  .map((full) => ({ full, name: relative(SRC, full).split(sep).join('/') }))
  .filter((f) => !SKIP.test(f.name));
if (!files.some((f) => f.name === 'manifest.json')) throw new Error('manifest.json must be at the zip root');

// Explicit folder entries ("fonts/", "lib/", ...) before the files, as most zip tools write them.
const dirs = [...new Set(files.flatMap((f) => {
  const parts = f.name.split('/').slice(0, -1);
  return parts.map((_, i) => `${parts.slice(0, i + 1).join('/')}/`);
}))].sort();
const entries = [...dirs.map((name) => ({ name, dir: true })), ...files];

const locals = [];
const centrals = [];
let offset = 0;
for (const { full, name, dir } of entries) {
  const data = dir ? Buffer.alloc(0) : readFileSync(full);
  const nameBuf = Buffer.from(name, 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = !dir && deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const crc = crc32(data) >>> 0;
  const flags = 0x0800; // UTF-8 names

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4); // made by: Unix, v2.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  // Unix mode in the high word; MS-DOS directory bit (0x10) for folders.
  central.writeUInt32LE(dir ? (((0o40755 << 16) | 0x10) >>> 0) : ((0o100644 << 16) >>> 0), 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(OUT_DIR, { recursive: true });
const zip = Buffer.concat([...locals, centralBuf, end]);
writeFileSync(OUT, zip);
console.log(`${OUT}: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB (version ${manifest.version})`);
