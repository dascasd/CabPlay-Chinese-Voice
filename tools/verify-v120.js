const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
const hlen = buf.readUInt32LE(4), jlen = buf.readUInt32LE(12);
const header = JSON.parse(buf.toString('utf8', 16, 16 + jlen));
const base = 8 + hlen;
function getFile(rel) { let n = header; for (const p of rel.split('/')) { n = n.files[p]; if (!n) return null; } return buf.toString('utf8', base + Number(n.offset), base + Number(n.offset) + n.size); }
const app = getFile('ui/app.js');
const zh = getFile('ui/i18n-zh.js');
console.log('三层时间触发 T_SPEECH:', app.includes('T_SPEECH'));
console.log('D_trigger 公式:', app.includes('refs.map((d) => d + Math.round(mps * T_SPEECH))'));
console.log('车道短语 lanePhrase:', app.includes('function lanePhrase'));
console.log('驶出环岛 zh:', zh.includes('现在驶出环岛。'));
console.log('车道第X zh:', zh.includes('请走左侧第 $1 车道'));
console.log('车道N集合 zh:', zh.includes('请走左侧 $1 车道'));
