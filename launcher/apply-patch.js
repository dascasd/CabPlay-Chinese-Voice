// CabPlay 语音增强补丁应用器 (v1.22.0 基准)
// 用法: node apply-patch.js [--check]   --check 只检查版本不修改
'use strict';
// Electron 的 fs 会把 app.asar 当压缩包拦截，必须用 original-fs
let fs;
try { fs = require('original-fs'); } catch { fs = require('fs'); }
const path = require('path');
const crypto = require('crypto');
function _sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function integrityOf(buf) {
  const blockSize = 4194304;
  const blocks = [];
  for (let i = 0; i < buf.length; i += blockSize) blocks.push(_sha256(buf.subarray(i, i + blockSize)));
  if (!blocks.length) blocks.push(_sha256(Buffer.alloc(0)));
  return { algorithm: 'SHA256', hash: _sha256(buf), blockSize, blocks };
}

const HERE = __dirname;
const PATCH_DIR = fs.existsSync(path.join(HERE, 'announceTurn.txt')) ? HERE : path.join(HERE, 'patch-data');
const MARKER = path.join(HERE, 'patched-version.txt');

// ---------- 找 CabPlay ----------
function findCabPlay() {
  const candidates = [
    'C:\\rj\\cabplay',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CabPlay'),
    'C:\\Program Files\\CabPlay',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'resources', 'app.asar'))) return c;
  }
  return null;
}

// ---------- asar 读写 ----------
function align(n, a) { return n + ((a - (n % a)) % a); }
function readAsar(file) {
  const buf = fs.readFileSync(file);
  const headerBufLen = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.toString('utf8', 16, 16 + jsonLen));
  const base = 8 + headerBufLen;
  return { buf, header, base };
}
function getFile(a, rel) {
  let n = a.header;
  for (const p of rel.split('/')) { n = n.files && n.files[p]; if (!n) return null; }
  if (n.unpacked || n.link) return null;
  return a.buf.subarray(a.base + Number(n.offset), a.base + Number(n.offset) + Number(n.size));
}
function writeAsar(a, outPath) {
  const packed = [];
  let offset = 0;
  function walk(node, rel) {
    for (const [name, e] of Object.entries(node.files || {})) {
      const r = rel + '/' + name;
      if (e.files) { walk(e, r); continue; }
      if (e.unpacked || e.link) continue;
      packed.push({ r, entry: e, offset });
      offset += Number(e.size);
    }
  }
  walk(a.header, '');
  const idx = {};
  for (const p of packed) idx[p.r] = p;
  function rebuild(node, rel) {
    const out = {};
    for (const [name, e] of Object.entries(node.files || {})) {
      const r = rel + '/' + name;
      if (e.files) out[name] = { files: rebuild(e, r) };
      else if (e.link) out[name] = { link: e.link };
      else if (e.unpacked) { const x = { size: e.size, unpacked: true }; if (e.executable !== undefined) x.executable = e.executable; out[name] = x; }
      else {
        const p = idx[r];
        const x = { size: p.entry.size, offset: String(p.offset) };
        if (p.entry.executable) x.executable = true;
        out[name] = x;
      }
    }
    return out;
  }
  const newHeader = { files: rebuild(a.header, '') };
  const s = JSON.stringify(newHeader);
  const strLen = Buffer.byteLength(s, 'utf8');
  const al = align(strLen, 4);
  const hb = Buffer.alloc(8 + al);
  hb.writeUInt32LE(4 + al, 0);
  hb.writeInt32LE(strLen, 4);
  hb.write(s, 8, 'utf8');
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(hb.length, 4);
  const ws = fs.createWriteStream(outPath);
  ws.write(sizeBuf); ws.write(hb);
  for (const p of packed) {
    const buf = a.buf.subarray(a.base + Number(p.entry.offset), a.base + Number(p.entry.offset) + Number(p.entry.size));
    ws.write(buf);
  }
  return new Promise((res, rej) => { ws.on('finish', () => res(true)); ws.on('error', rej); ws.end(); });
}
function packFromFiles(tree, outPath) {
  // tree: { files: { 'a/b.js': Buffer, ... } }  (全部 packed)
  const files = tree.files;
  const json = { files: {} };
  let offset = 0;
  for (const [k, buf] of Object.entries(files)) {
    const parts = k.split('/');
    let cur = json;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur.files[parts[i]] || !cur.files[parts[i]].files) cur.files[parts[i]] = { files: {} };
      cur = cur.files[parts[i]];
    }
    cur.files[parts[parts.length - 1]] = { size: buf.length, offset: String(offset) };
    offset += buf.length;
  }
  const s = JSON.stringify(json);
  const strLen = Buffer.byteLength(s, 'utf8');
  const al = align(strLen, 4);
  const hb = Buffer.alloc(8 + al);
  hb.writeUInt32LE(4 + al, 0);
  hb.writeInt32LE(strLen, 4);
  hb.write(s, 8, 'utf8');
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(hb.length, 4);
  const ws = fs.createWriteStream(outPath);
  ws.write(sizeBuf); ws.write(hb);
  for (const buf of Object.values(files)) ws.write(buf);
  return new Promise((res, rej) => { ws.on('finish', () => res(true)); ws.on('error', rej); ws.end(); });
}

// ---------- 补丁 ----------
const P = []; // { file, kind:'block'|'insert'|'replace', from, to, data }
function block(file, from, to, dataFile) { P.push({ file, kind: 'block', from: [].concat(from), to: [].concat(to), dataFile }); }
function insert(file, anchor, pos, dataFile) { P.push({ file, kind: 'insert', anchor, pos, dataFile }); }
function replace(file, from, to) { P.push({ file, kind: 'replace', from, to, dataFile: /\.txt$/.test(to) ? to : null }); }

block('ui/app.js', '  function speak(text, onEnd0, {', '  function speakIn(lang, text, token, play, onEnd) {', 'speak.txt');
block('ui/app.js', '  let lastFirstTurn = null;', '  // ------------------------------------------------------------------ Video (YouTube, Twitch)', 'announceTurn.txt');
block('ui/app.js', '  // Ansage zum Einordnen', '  let navActive = false;', 'laneVoice-new.txt');
insert('ui/app.js', '  let onRouteSeen = false;', 'after', 'decls.txt');
insert('ui/app.js', '    naviEvents(m, offRoute);', 'after', 'offroute-safe.txt');
insert('ui/app.js', '    if (!m) return;\n    const t = telemetry || {};', 'before', 'arrival.txt');
insert('ui/app.js', '      laneSpoken.clear();', 'after', 'resets2.txt');
replace('updater.js', '  return installed && setup ? setup : zip;', '  return zip || setup;');
replace('ui/defaults.js', 'navVoice: false,', 'navVoice: true,');
replace('ui/defaults.js', 'curveWarn: false,', 'curveWarn: true,');
insert('ui/i18n-zh.js', 'window.CarI18nZh = function (translate) {', 'after', 'lanehelpers-zh.txt');
insert('ui/i18n-zh.js', '    "Bitte rechts einordnen.":', 'after', 'i18n-exact-zh.txt');
insert('ui/i18n-zh.js', '  const SENTENCES = [', 'after', 'i18n-sent-zh.txt');
insert('ui/i18n-zh-hant.js', 'window.CarI18nZhHant = function (translate) {', 'after', 'lanehelpers-hant.txt');
insert('ui/i18n-zh-hant.js', '    "Bitte rechts einordnen.":', 'after', 'i18n-exact-hant.txt');
insert('ui/i18n-zh-hant.js', '  const SENTENCES = [', 'after', 'i18n-sent-hant.txt');

function applyPatch(content, p) {
  if (p.kind === 'replace') {
    const to = p.dataFile ? fs.readFileSync(path.join(PATCH_DIR, p.dataFile), 'utf8') : p.to;
    if (content.includes(p.from)) return { ok: true, out: content.split(p.from).join(to) };
    if (content.includes(to)) return { ok: true, out: content, skipped: true }; // 已打过
    return { ok: false, why: 'not found: ' + p.from.slice(0, 40) };
  }
  let data = fs.readFileSync(path.join(PATCH_DIR, p.dataFile), 'utf8');
  if (!data.endsWith('\n')) data += '\n'; // 必须换行结尾，否则插入后会和下一行粘连（曾导致 toggle 被注释）
  if (p.kind === 'insert') {
    if (content.includes(data.trim().slice(0, 60))) return { ok: true, out: content }; // 已打过
    const i = content.indexOf(p.anchor);
    if (i < 0) return { ok: false, why: 'anchor not found: ' + p.anchor.slice(0, 40) };
    let at;
    if (p.pos === 'before') at = i;
    else { const nl = content.indexOf('\n', i); at = nl < 0 ? content.length : nl + 1; }
    return { ok: true, out: content.slice(0, at) + data + content.slice(at) };
  }
  // block
  if (content.includes(data)) return { ok: true, out: content, skipped: true }; // 已打过
  let from = null;
  for (const a of p.from) { if (content.includes(a)) { from = a; break; } }
  if (!from) return { ok: false, why: 'start not found: ' + p.from[0].slice(0, 40) };
  const i = content.indexOf(from);
  let to = null;
  for (const a of p.to) { if (content.indexOf(a, i) >= 0) { to = a; break; } }
  if (!to) return { ok: false, why: 'end not found: ' + p.to[0].slice(0, 40) };
  const j = content.indexOf(to, i);
  return { ok: true, out: content.slice(0, i) + data + content.slice(j) };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const dirArg = process.argv.find((a) => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice(6) : findCabPlay();
  if (!dir) { console.error('找不到 CabPlay 安装目录'); process.exit(2); }
  const asarPath = path.join(dir, 'resources', 'app.asar');
  const a = readAsar(asarPath);
  const pkgBuf = getFile(a, 'package.json');
  const ver = JSON.parse(pkgBuf.toString('utf8')).version;
  const patchVer = fs.existsSync(MARKER) ? fs.readFileSync(MARKER, 'utf8').trim() : '';
  console.log('CabPlay: ' + dir);
  console.log('当前版本: ' + ver + '   已适配版本: ' + (patchVer || '(无)'));
  if (checkOnly) { process.exit(ver === patchVer ? 0 : 1); }

  // 提取需要的文件
  const needFiles = [...new Set(P.map((p) => p.file))];
  const texts = {};
  for (const f of needFiles) {
    const b = getFile(a, f);
    if (!b) { console.error('缺少文件: ' + f); process.exit(3); }
    texts[f] = b.toString('utf8').replace(/\r\n/g, '\n');
  }
  // 应用补丁
  let failed = [];
  for (const p of P) {
    const r = applyPatch(texts[p.file], p);
    if (r.ok) texts[p.file] = r.out;
    else failed.push(p.file + ' / ' + (p.dataFile || p.from.slice(0, 30)) + ': ' + r.why);
  }
  if (failed.length) {
    console.error('补丁失败 ' + failed.length + ' 处:');
    for (const f of failed) console.error('  ' + f);
    console.error('（官方代码可能已大改，需要重新适配）');
    process.exit(4);
  }
  // 写回 asar：基于原文件列表，替换被修改的文件内容
  const newFiles = {};
  function walk(node, rel) {
    for (const [name, e] of Object.entries(node.files || {})) {
      const r = rel + '/' + name;
      if (e.files) { walk(e, r); continue; }
      if (e.unpacked || e.link) continue;
      const key = r.replace(/^[\/]+/, ''); // walk 的 r 带前导 /，texts 的键不带
      if (texts[key] !== undefined) newFiles[r] = Buffer.from(texts[key], 'utf8');
      else newFiles[r] = a.buf.subarray(a.base + Number(e.offset), a.base + Number(e.offset) + Number(e.size));
    }
  }
  walk(a.header, '');
  // 打包：保留 unpacked 项
  const json = { files: {} };
  let offset = 0;
  const packedOrder = [];
  function walk2(node, rel) {
    const out = {};
    for (const [name, e] of Object.entries(node.files || {})) {
      const r = rel + '/' + name;
      if (e.files) out[name] = { files: walk2(e, r) };
      else if (e.link) out[name] = { link: e.link };
      else if (e.unpacked) { const x = { size: e.size, unpacked: true }; if (e.executable !== undefined) x.executable = e.executable; out[name] = x; }
      else {
        const buf = newFiles[r];
        const key = r.replace(/^[\/]+/, '');
        const x = { size: buf.length };
        if (e.executable) x.executable = true;
        // 保留 integrity：未修改的文件用原值，修改过的重算（1.23.0 会校验）
        if (e.integrity) x.integrity = texts[key] !== undefined ? integrityOf(buf) : e.integrity;
        x.offset = String(offset);
        out[name] = x;
        offset += buf.length;
        packedOrder.push(buf);
      }
    }
    return out;
  }
  const tree = { files: walk2(a.header, '') };
  const s = JSON.stringify(tree);
  const strLen = Buffer.byteLength(s, 'utf8');
  const al = align(strLen, 4);
  const hb = Buffer.alloc(8 + al);
  hb.writeUInt32LE(4 + al, 0);
  hb.writeInt32LE(strLen, 4);
  hb.write(s, 8, 'utf8');
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(hb.length, 4);
  const tmpOut = asarPath + '.new';
  const ws = fs.createWriteStream(tmpOut);
  ws.write(sizeBuf); ws.write(hb);
  for (const buf of packedOrder) ws.write(buf);
  await new Promise((res, rej) => { ws.on('finish', res); ws.on('error', rej); ws.end(); });
  // 备份 + 替换
  fs.copyFileSync(asarPath, asarPath + '.bak');
  fs.copyFileSync(tmpOut, asarPath);
  fs.unlinkSync(tmpOut);
  fs.writeFileSync(MARKER, ver, 'utf8');
  console.log('补丁已应用，版本 ' + ver + ' 已适配。');
}
main().catch((e) => { console.error(e); process.exit(9); });
