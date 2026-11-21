// Corrected asar extractor (pickle-format header per @electron/asar)
const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2];
const outDir = process.argv[3];

if (!asarPath || !outDir) {
  console.error('usage: node asar-extract.js <file.asar> <outDir>');
  process.exit(1);
}

const buf = fs.readFileSync(asarPath);

// sizeBuf: [payloadSize(4)][headerBufLen(4)]
// headerBuf: [payloadSize(4)][jsonLen(4)][json bytes][pad]
const headerBufLen = buf.readUInt32LE(4);   // size returned by readUInt32()
const jsonLen = buf.readUInt32LE(8 + 4);    // headerBuf[4:8]
const jsonStart = 8 + 8;                     // file offset of JSON
const headerJson = buf.toString('utf8', jsonStart, jsonStart + jsonLen);
const header = JSON.parse(headerJson);
const baseOffset = 8 + headerBufLen;

let fileCount = 0;
let unpackedCount = 0;
let linkCount = 0;

function walk(node, relPath) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const rel = path.join(relPath, name);
    if (entry.files) {
      walk(entry, rel);
    } else if (entry.link) {
      linkCount++;
    } else if (entry.unpacked) {
      unpackedCount++;
      // content lives in <asar>.unpacked
    } else {
      fileCount++;
      const target = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const offset = Number(entry.offset);
      const size = entry.size;
      const data = buf.subarray(baseOffset + offset, baseOffset + offset + size);
      fs.writeFileSync(target, data);
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
walk(header, '');
console.log(JSON.stringify({ headerBufLen, jsonLen, baseOffset, fileCount, unpackedCount, linkCount }, null, 2));
