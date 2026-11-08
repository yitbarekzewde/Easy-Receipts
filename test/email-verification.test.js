const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

for (const file of ['index.html', path.join('public', 'index.html')]) {
    test(`email verification controls in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /id="emailVerificationNotice"[^>]*hidden/);
        assert.match(source, /id="emailVerificationMessage"/);
        assert.match(source, /onclick="authManager\.sendVerificationEmail\(\)">Verify email<\/button>/);
        assert.match(source, /id="emailVerificationStatus"/);
    });
}
