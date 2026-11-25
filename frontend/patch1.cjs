const fs = require('fs');
const p = 'frontend/src/pages/shared/OrderDetail.tsx';
let t = fs.readFileSync(p, 'utf8');
const orig = t.length;
function rep(a, b) {
  if (!t.includes(a)) { console.log('MISS: ' + JSON.stringify(a.slice(0, 60))); return; }
  t = t.split(a).join(b);
  console.log('HIT: ' + JSON.stringify(a.slice(0, 60)));
}
rep('  Card,\n  Dialog,', '  Card,\n  ConfirmDialog,\n  Dialog,');
rep('const [cancelOpen, setCancelOpen] = useState(false);',
    'const [cancelOpen, setCancelOpen] = useState(false);\n  const [deliverConfirm, setDeliverConfirm] = useState(false);');
rep('subtitle={isSeller ? order.customer?.name : undefined}',
    'subtitle={isSeller ? order.customer?.name : undefined}\n      backTo={basePath === \'seller\' ? \'/seller/orders\' : \'/customer/orders\'}\n      backLabel="Orders"');
rep('Edit order</Button>', 'Prepare invoice</Button>');
fs.writeFileSync(p, t);
console.log('done', orig, '->', t.length);
