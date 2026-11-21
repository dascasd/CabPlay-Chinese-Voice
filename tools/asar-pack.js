const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2];        // original app.asar
const extractedDir = process.argv[3];    // app-extracted dir (with modified files)
const outPath = process.argv[4];         // output app.asar

// ---- parse original header ----
const buf = fs.readFileSync(asarPath);
const headerBufLen = buf.readUInt32LE(4);
const jsonLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.toString('utf8', 16, 16 + jsonLen));

// ---- helper: align ----
function alignInt(i, a) { return i + ((a - (i % a)) % a); }

// ---- first pass: compute sizes/offsets, collect list of packed files ----
const packed = []; // { relPath (posix), absPath, size, offset, executable }
let offset = 0;

function walk(node, rel) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const rel2 = rel + '/' + name;
    if (entry.files) {
      walk(entry, rel2);
    } else if (entry.link) {
      throw new Error('unexpected link entry: ' + rel2);
    } else if (entry.unpacked) {
      // keep as unpacked (content lives in app.asar.unpacked)
      // mark in-place; we rebuild tree in second pass
    } else {
      const abs = path.join(extractedDir, ...rel2.split('/'));
      if (!fs.existsSync(abs)) {
        throw new Error('missing file for packed entry: ' + rel2);
      }
      const size = fs.statSync(abs).size;
      packed.push({ rel2, abs, size, offset, executable: entry.executable === true });
      offset += size;
    }
  }
}
walk(header, '');

// ---- second pass: rebuild header tree (preserve original order & flags) ----
const packedIndex = {}; // rel2 -> packed entry
for (const p of packed) packedIndex[p.rel2] = p;

function rebuild(node, rel) {
  const out = {};
  for (const [name, entry] of Object.entries(node.files || {})) {
    const rel2 = rel + '/' + name;
    if (entry.files) {
      out[name] = { files: rebuild(entry, rel2) };
    } else if (entry.link) {
      out[name] = { link: entry.link };
    } else if (entry.unpacked) {
      const e = { size: entry.size, unpacked: true };
      if (entry.executable !== undefined) e.executable = entry.executable;
      out[name] = e;
    } else {
      const p = packedIndex[rel2];
      if (!p) throw new Error('packed entry not found: ' + rel2);
      const e = { size: p.size, offset: String(p.offset) };
      if (p.executable) e.executable = true;
      out[name] = e;
    }
  }
  return out;
}
const newHeader = { files: rebuild(header, '') };

// ---- serialize header (pickle format) ----
const headerString = JSON.stringify(newHeader);
const strLen = Buffer.byteLength(headerString, 'utf8');
const aligned = alignInt(strLen, 4);
const headerBuf = Buffer.alloc(8 + aligned);
headerBuf.writeUInt32LE(4 + aligned, 0);      // payloadSize
headerBuf.writeInt32LE(strLen, 4);            // string length
headerBuf.write(headerString, 8, 'utf8');     // string bytes (rest is zero-padded)

const sizeBuf = Buffer.alloc(8);
sizeBuf.writeUInt32LE(4, 0);                  // payloadSize of size pickle
sizeBuf.writeUInt32LE(headerBuf.length, 4);   // headerBuf.length

// ---- write output ----
const ws = fs.createWriteStream(outPath);
ws.write(sizeBuf);
ws.write(headerBuf);
for (const p of packed) {
  ws.write(fs.readFileSync(p.abs));
}
ws.end();

console.log(JSON.stringify({
  originalHeaderSize: headerBufLen,
  newHeaderBufLen: headerBuf.length,
  newHeaderJsonLen: strLen,
  packedFiles: packed.length,
  totalDataBytes: offset,
}, null, 2));
