// Packs extension/ into download/bogard-seo-extension.zip with a single top
// folder (bogard-seo-extension/) so it can be unzipped and loaded as-is.
// Dependency-free: deflate + CRC-32 from node:zlib. Fixed timestamps make the
// output byte-identical when the sources haven't changed.
// Run: npm run package

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const SRC = 'extension';
const TOP = 'bogard-seo-extension';
const OUT_DIR = 'download';
const OUT = join(OUT_DIR, `${TOP}.zip`);
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
  .map((full) => ({ full, name: `${TOP}/${relative(SRC, full).split(sep).join('/')}` }))
  .filter((f) => !SKIP.test(f.name));

const locals = [];
const centrals = [];
let offset = 0;
for (const { full, name } of files) {
  const data = readFileSync(full);
  const nameBuf = Buffer.from(name, 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
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
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(OUT_DIR, { recursive: true });
const zip = Buffer.concat([...locals, centralBuf, end]);
writeFileSync(OUT, zip);
console.log(`${OUT}: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB (version ${manifest.version})`);
