const fs = require('fs');
const t = fs.readFileSync('frontend/src/pages/shared/OrderDetail.tsx', 'utf8');
const idx = [];
let k = 0;
while (true) { k = t.indexOf('eliver', k); if (k < 0) break; idx.push(k); k += 6; if (idx.length > 12) break; }
console.log('hits', idx.length);
idx.forEach((i) => console.log('---\n' + JSON.stringify(t.slice(Math.max(0, i - 300), i + 200))));
