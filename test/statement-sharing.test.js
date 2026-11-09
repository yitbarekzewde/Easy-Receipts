const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

for (const file of ['main.js', path.join('public', 'main.js')]) {
    test(`customer statement ordering and sharing in ${file}`, async () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const start = source.indexOf('class CustomerManager');
        const end = source.indexOf('\nfunction formatItemName', start);
        const customersView = { id: 'customersListView', innerHTML: '' };
        const elements = { customersListView: customersView };
        const history = [
            { id: 1, store: 'Old store', timestamp: '2025-01-01T00:00:00Z', total: 10, paid: 5, items: [{ name: 'Tea', qty: 1, price: 10 }] },
            { id: 2, type: 'payment', timestamp: '2026-01-01T00:00:00Z', amount: 5, method: 'cash' }
        ];
        const customer = { id: 99, name: 'Customer <script>', email: 'private@example.test', history, depositPayments: [] };
        let payload;
        let downloadedBlob;
        const elementsCreated = [];
        const result = {
            children: [],
            get textContent() { return this._textContent || ''; },
            set textContent(value) { this._textContent = value; this.children = []; },
            replaceChildren() { this.children = []; },
            append(...items) { this.children.push(...items); }
        };
        const details = {
            inputs: [],
            querySelector: () => result,
            querySelectorAll: () => details.inputs
        };
        const body = { appendChild(element) { element.parentElement = body; } };
        const context = vm.createContext({
            document: {
                getElementById: id => elements[id] || null,
                body,
                createElement: tagName => {
                    const element = {
                        tagName, appendChild() {}, setAttribute() {},
                        click() { this.clicked = true; },
                        remove() { this.removed = true; }
                    };
                    elementsCreated.push(element);
                    return element;
                }
            },
            window: { easyReceiptPublishStatement: async data => { payload = data; return 'https://example.test/statement#secret'; } },
            navigator: {}, console, URL: {
                createObjectURL: blob => { downloadedBlob = blob; return 'blob:statement'; },
                revokeObjectURL() {}
            }, Blob, encodeURIComponent
        });
        const manager = vm.runInContext(`${source.slice(start, end)}\nObject.create(CustomerManager.prototype)`, context);
        manager.getSavedCustomers = () => [customer];
        manager.renderCustomersList();
        assert.ok(customersView.innerHTML.indexOf('Deposit payment') < customersView.innerHTML.indexOf('Old store'));
        const button = { disabled: false, closest: () => details };
        const selected = history[0];
        details.inputs = [{ value: '0', dataset: { entry: encodeURIComponent(JSON.stringify({ ...selected, statementIndex: 0 })) } }];
        await manager.shareCustomerStatement(99, button, true);
        assert.equal(payload.entries.length, 1);
        assert.equal(payload.entries[0].store, 'Old store');
        assert.equal(payload.entries[0].items[0].name, 'Tea');
        assert.equal(payload.email, undefined);
        assert.equal(button.disabled, false);
        assert.equal(result.children.length, 2);

        payload = null;
        await manager.shareCustomerStatement(99, button, false);
        assert.equal(payload.entries.length, 2);
        assert.equal(payload.entries[0].type, 'payment');
        payload = null;
        history[0].total = 99;
        await manager.shareCustomerStatement(99, button, true);
        assert.equal(payload, null);
        assert.match(result.textContent, /changed/);
        details.inputs = [];
        await manager.shareCustomerStatement(99, button, true);
        assert.match(result.textContent, /Select at least one/);
        context.window.easyReceiptPublishStatement = async () => { throw new Error('Sign in first'); };
        await manager.shareCustomerStatement(99, button, false);
        assert.match(result.textContent, /Sign in first/);
        assert.equal(button.disabled, false);
        const localCopyButton = result.children[0];
        assert.equal(localCopyButton.textContent, 'Share local copy');
        await localCopyButton.onclick();
        const download = elementsCreated.find(element => element.tagName === 'a');
        assert.equal(download.download, 'customer-script-statement.html');
        assert.equal(download.clicked, true);
        assert.match(result.textContent, /downloaded/);
        const localHtml = await downloadedBlob.text();
        assert.match(localHtml, /Customer: Customer &lt;script&gt;/);
        assert.doesNotMatch(localHtml, /Customer: Customer <script>/);
        assert.match(localHtml, /Old store/);
        assert.match(localHtml, /Tea/);
        assert.doesNotMatch(localHtml, /private@example\.test/);
    });
}
