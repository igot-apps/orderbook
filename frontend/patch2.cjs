const fs = require('fs');
const p = 'frontend/src/pages/shared/OrderDetail.tsx';
let t = fs.readFileSync(p, 'utf8');
function rep(a, b) {
  if (!t.includes(a)) { console.log('MISS: ' + JSON.stringify(a.slice(0, 80))); return; }
  t = t.split(a).join(b);
  console.log('HIT : ' + JSON.stringify(a.slice(0, 80)));
}
// CRLF-aware replacements
rep('  Card,\r\n  Dialog,', '  Card,\r\n  ConfirmDialog,\r\n  Dialog,');
rep("title=\"Edit order\"", 'title="Prepare invoice"');
// deliver button: reroute one-tap mutate -> confirm dialog
const m = t.match(/onClick=\{\(\) =>\s*mut\.mutate\(\{ path: 'deliver'[\s\S]*?\}\)\s*\)\s*\}/);
console.log('deliver block:', m ? 'FOUND len=' + m[0].length : 'NOT FOUND');
// eslint-disable-next-line no-control-regex
if (m) t = t.replace(m[0], 'onClick={() => setDeliverConfirm(true)}');
rep('{a.internalReference}</div>', "{isSeller ? a.internalReference : a.status}</div>");
// append ConfirmDialog before final </Page>
const confirm = [
  '      <ConfirmDialog',
  '        open={deliverConfirm}',
  '        onClose={() => setDeliverConfirm(false)}',
  "        onConfirm={() => { setDeliverConfirm(false); mut.mutate({ path: 'deliver', body: { proofNote: 'Marked as completed by seller' } }); }}",
  '        title="Mark this order completed?"',
  '        description="The customer will see it as fulfilled. Only do this after the goods have been handed over."',
  '        confirmLabel="Mark completed"',
  '        busy={mut.isPending}',
  '      />',
  ''
].join('\r\n');
const ix = t.lastIndexOf('</Page>');
if (ix > 0) t = t.slice(0, ix) + confirm + t.slice(ix);
fs.writeFileSync(p, t);
console.log('done len', t.length);
