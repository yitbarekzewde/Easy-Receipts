const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptDirectory = path.join(__dirname, '..', 'google-apps-script');
const source = fs.readFileSync(path.join(scriptDirectory, 'Code.gs'), 'utf8');

test('Apps Script deployment has one doPost router', () => {
    const scripts = fs.readdirSync(scriptDirectory).filter(file => file.endsWith('.gs'));
    assert.deepEqual(scripts, ['Code.gs']);
    assert.equal((source.match(/function doPost\(/g) || []).length, 1);
});

test('Apps Script router handles all public email services', () => {
    for (const action of [
        'sendOTP',
        'verifyOTP',
        'sendManualProfileOTP',
        'verifyManualProfileOTP',
        'sendResetOTP',
        'resetPassword',
        'notifyAuthEvent',
        'sendSupportEmail',
        'sendDeveloperContact',
        'sendReceiptEmail',
        'sendCustomerReceipt'
    ]) {
        assert.match(source, new RegExp("case '" + action + "':"));
    }
});
