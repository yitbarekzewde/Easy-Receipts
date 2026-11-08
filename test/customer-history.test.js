const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

for (const file of ['main.js', path.join('public', 'main.js')]) {
    test(`customer history views in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const start = source.indexOf('class CustomerManager');
        const end = source.indexOf('\nfunction formatItemName', start);
        assert.ok(start >= 0 && end > start);
        const customersView = { id: 'customersListView', innerHTML: '' };
        const profileView = { id: 'profileCustomerHistory', innerHTML: '' };
        const profileScreen = { hidden: true };
        const summary = { innerHTML: '' };
        const elements = { customersListView: customersView, profileCustomerHistory: profileView, profileCustomerHistoryScreen: profileScreen, customerBalanceSummary: summary };
        const saved = [{ id: 1, name: 'Customer', due: 100.15, deposit: 0, history: [], depositPayments: [{ amount: 3, method: 'Old method', timestamp: 'Earlier' }] }];
        const alerts = [];
        const context = vm.createContext({ document: { getElementById: id => elements[id] || null }, alert: message => alerts.push(message) });
        const manager = vm.runInContext(`${source.slice(start, end)}\nObject.create(CustomerManager.prototype)`, context);
        manager.getSavedCustomers = () => saved;
        manager.setSavedCustomers = () => {};
        manager.renderCustomersList();
        assert.match(profileView.innerHTML, /profileCustomerHistory-customer-details-1/);
        assert.match(customersView.innerHTML, /customersListView-customer-details-1/);
        assert.match(profileView.innerHTML, /Earlier record/);
        assert.match(profileView.innerHTML, /Old method/);

        const toggle = { setAttribute: (name, value) => { toggle[name] = value; } };
        manager.toggleProfileCustomerHistory(toggle);
        assert.equal(profileScreen.hidden, false);
        assert.equal(toggle['aria-expanded'], 'true');
        manager.toggleProfileCustomerHistory(toggle);
        assert.equal(profileScreen.hidden, true);
        assert.equal(toggle['aria-expanded'], 'false');

        const classes = new Set(['hidden']);
        elements.detail = { classList: {
            toggle: value => classes.has(value) ? classes.delete(value) : classes.add(value),
            contains: value => classes.has(value)
        } };
        const name = { getAttribute: () => 'detail', setAttribute: (key, value) => { name[key] = value; } };
        manager.toggleCustomerDetails(name);
        assert.equal(name['aria-expanded'], 'true');
        manager.toggleCustomerDetails(name);
        assert.equal(name['aria-expanded'], 'false');

        const amount = { value: '25.10' };
        const method = { value: '__custom__' };
        const custom = { value: 'Bank transfer' };
        const controls = { querySelector: selector => ({ '.customer-deposit-input': amount, '.customer-deposit-method': method, '.customer-custom-method-input': custom })[selector] };
        const button = { closest: selector => selector === '.customer-balance-controls' ? controls : profileView };
        manager.renderSelectedCustomerBalance = () => {};
        manager.updateBalance(1, button);
        assert.equal(saved[0].due, 75.05);
        assert.equal(saved[0].deposit, 0);
        assert.equal(saved[0].depositMethod, 'Bank transfer');
        assert.equal(saved[0].depositPayments.length, 2);
        assert.equal(saved[0].history[0].type, 'payment');
        assert.equal(saved[0].history[0].remainingDue, 75.05);
        assert.match(profileView.innerHTML, /Bank transfer/);
        assert.match(profileView.innerHTML, /Due after payment: R 75.05/);
        assert.equal((profileView.innerHTML.match(/Deposit payment/g) || []).length, 2);

        amount.value = '100.05';
        method.value = 'Bank transfer';
        manager.updateBalance(1, button);
        assert.equal(saved[0].due, 0);
        assert.equal(saved[0].deposit, 25);
        amount.value = '10';
        method.value = 'cash';
        manager.updateBalance(1, button);
        assert.equal(saved[0].deposit, 35);
        const historyLength = saved[0].history.length;
        amount.value = '2.001';
        manager.updateBalance(1, button);
        assert.equal(saved[0].history.length, historyLength);
        assert.match(alerts.at(-1), /two decimal places/);
        amount.value = '1';
        method.value = '__custom__';
        custom.value = ' ';
        manager.updateBalance(1, button);
        assert.equal(saved[0].history.length, historyLength);
        assert.match(alerts.at(-1), /payment method/);
    });
}
