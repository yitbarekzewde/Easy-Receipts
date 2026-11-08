const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('customer purchase list excludes deposit payments', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sales.js'), 'utf8');
    const start = source.indexOf('    function getCustomerPurchases(');
    const end = source.indexOf('\n    function ', start + 1);
    assert.ok(start >= 0 && end > start);
    const customers = [{ name: 'Customer', history: [
        { id: 1, total: 20, items: [] },
        { id: 'payment-1', type: 'payment', total: 10, paid: 10, items: [] }
    ] }];
    const context = vm.createContext({ readArray: key => key === 'p3_saved_customers' ? customers : [] });
    const purchases = vm.runInContext(`${source.slice(start, end)}\ngetCustomerPurchases('Customer')`, context);
    assert.deepEqual(Array.from(purchases, purchase => purchase.id), ['1']);
});
