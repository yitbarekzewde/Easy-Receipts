const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function input(value) {
    return {
        value, readOnly: true, focused: false,
        checkValidity() {
            const number = Number(this.value);
            return Number.isFinite(number) && number >= 0 && Math.abs(number * 100 - Math.round(number * 100)) < 1e-8;
        },
        focus() { this.focused = true; }
    };
}

function row(key, name, price, cost) {
    const fields = { name: input(name), price: input(price), costPrice: input(cost) };
    return {
        dataset: { priceKey: key }, fields,
        querySelector(selector) { return fields[selector.match(/data-price-field="([^"]+)"/)[1]]; }
    };
}

for (const file of ['main.js', path.join('public', 'main.js')]) {
    test(`product and price edit mode in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const start = source.indexOf('function formatItemName(');
        const end = source.indexOf('\nclass StockManager', start);
        assert.ok(start >= 0 && end > start);
        const rows = [row('apples', 'Apples', '10', '7'), row('bread', 'Bread', '0', '2')];
        const tbody = {
            innerHTML: '',
            querySelectorAll: () => rows.flatMap(item => Object.values(item.fields))
        };
        const elements = { 'price-management-rows': tbody, priceManagementEdit: {}, priceManagementDoneBar: {} };
        const storage = new Map([['p3_auto_prices', JSON.stringify({
            apples: { originalName: 'Apples', price: 10, costPrice: 7, extra: 'preserved' },
            bread: { originalName: 'Bread', price: 0, costPrice: 2 }
        })]]);
        const alerts = [];
        let accept = false;
        const context = vm.createContext({
            document: {
                getElementById: id => elements[id] || null,
                querySelectorAll: () => rows
            },
            localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
            alert: message => alerts.push(message),
            confirm: () => accept
        });
        const manager = vm.runInContext(`${source.slice(start, end)}\nnew InventoryPriceManager()`, context);
        manager.renderPriceManagementTable();
        assert.match(tbody.innerHTML, /readonly/);
        assert.match(tbody.innerHTML, /data-price-field="price"[^>]*value="0"/);
        assert.doesNotMatch(tbody.innerHTML, /deleteManagementKey|fa-trash/);

        manager.startPriceManagementEdit();
        assert.equal(elements.priceManagementEdit.hidden, true);
        assert.equal(elements.priceManagementDoneBar.hidden, false);
        assert.ok(tbody.querySelectorAll('input').every(field => !field.readOnly));
        rows[0].fields.name.value = 'Bread';
        manager.finishPriceManagementEdit();
        assert.match(alerts.pop(), /unique/);
        assert.equal(manager.priceManagementEditing, true);

        rows[0].fields.name.value = 'Pears';
        rows[0].fields.price.value = '-1';
        manager.finishPriceManagementEdit();
        assert.match(alerts.pop(), /valid non-negative/);
        assert.equal(rows[0].fields.price.focused, true);
        rows[0].fields.price.value = '12.50';
        assert.equal(manager.leavePriceManagementEdit(), false);
        assert.equal(manager.priceManagementEditing, true);
        manager.finishPriceManagementEdit();
        const saved = JSON.parse(storage.get('p3_auto_prices'));
        assert.equal(saved.pears.price, 12.5);
        assert.equal(saved.pears.costPrice, 7);
        assert.equal(saved.pears.extra, 'preserved');
        assert.equal(saved.apples, undefined);
        assert.equal(manager.priceManagementEditing, false);
        assert.equal(elements.priceManagementDoneBar.hidden, true);

        manager.startPriceManagementEdit();
        storage.set('p3_auto_prices', JSON.stringify({ changed: { originalName: 'Changed', price: 1 } }));
        manager.finishPriceManagementEdit();
        assert.match(alerts.pop(), /changed while you were editing/);
        assert.equal(manager.priceManagementEditing, true);
        accept = true;
        assert.equal(manager.leavePriceManagementEdit(), true);
        assert.equal(manager.priceManagementEditing, false);
        assert.ok(JSON.parse(storage.get('p3_auto_prices')).changed);
    });
}
