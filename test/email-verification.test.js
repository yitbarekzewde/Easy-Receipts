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

test('GitHub Pages root loads Firebase modules from the public directory', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    for (const module of ['firebase-config', 'cloud-sync', 'team', 'chat']) {
        assert.match(source, new RegExp(`<script type="module" src="public/${module}\\.js"><\\/script>`));
    }
});

for (const file of ['reg-form.html', path.join('public', 'reg-form.html')]) {
    test(`manual registration sends an email verification link in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /createUserWithEmailAndPassword/);
        assert.match(source, /sendEmailVerification\(credential\.user/);
        assert.match(source, /await signOut\(auth\)/);
    });
}

for (const file of ['login.html', path.join('public', 'login.html')]) {
    test(`Google can be linked to a verified manual account in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /handleLoginGoogleCredential/);
        assert.match(source, /auth\/account-exists-with-different-credential/);
        assert.match(source, /linkWithCredential\(user, GoogleAuthProvider\.credential\(token\)\)/);
        assert.match(source, /Verify your email before linking Google/);
    });
}

for (const file of ['index.html', path.join('public', 'index.html')]) {
    test(`manual in-app profile is saved only after email verification in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /id="manualProfileVerification" hidden/);
        assert.match(source, /id="regVerificationCode"[^>]*disabled/);
        assert.match(source, /Choose the Google account that matches your verified manual profile email/);
    });
}

for (const file of ['main.js', path.join('public', 'main.js')]) {
    test(`profile setup requires successful OTP verification before saving in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const verifyStart = source.indexOf('async verifyManualProfileEmail()');
        const saveStart = source.indexOf('this.saveProfile({', verifyStart);
        assert.notEqual(verifyStart, -1);
        assert.notEqual(saveStart, -1);
        assert.ok(source.indexOf('if (!response.ok || !result.success)', verifyStart) < saveStart);
        assert.match(source, /action: 'sendManualProfileOTP'/);
        assert.match(source, /action: 'verifyManualProfileOTP'/);
        assert.match(source, /saved\.provider === 'manual'.*?showManualGoogleSignInNotice\(\)/s);
        assert.match(source, /this\.openAuthModal\('google'\)/);
    });
}

test('Google sign-in preserves details from a matching manual profile', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'cloud-sync.js'), 'utf8');
    assert.match(source, /const keepManualProfile = savedProfile\?\.provider === "manual"/);
    assert.match(source, /savedProfile\.email.*?user\.email/s);
    assert.match(source, /\.\.\.\(keepManualProfile \? savedProfile : \{\}\)/);
});

test('email verification clients use the deployed Apps Script with manual OTP support', () => {
    const endpoint = 'https://script.google.com/macros/s/AKfycby7yEM8uurq1uAogomMp_f6FYK4cYf5A2HV9YJSwiBvsbBrNNAVwbFbosbAis8SfuG4/exec';
    for (const file of [
        'main.js',
        path.join('public', 'main.js'),
        'login.html',
        path.join('public', 'login.html'),
        'credit-customers.js',
        path.join('public', 'credit-customers.js')
    ]) {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.ok(source.includes(endpoint), `${file} should use the deployed email verification endpoint`);
        assert.ok(!source.includes('AKfycbxT3RdZts03TA0bWzUfD3NsKAaP-yASsKkElwyM8JUVt0cIZOmZZUK3iz1U76FhZ5uuzg'));
    }
});

for (const file of ['main.js', path.join('public', 'main.js')]) {
    test(`Google sign-in notice uses responsive, accessible styling in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /notice\.className = 'manual-google-notice'/);
        assert.match(source, /manual-google-notice__connect/);
        assert.match(source, /manual-google-notice__dismiss/);
    });
}

for (const file of ['styles.css', path.join('public', 'styles.css')]) {
    test(`Google sign-in notice is styled for mobile and dark mode in ${file}`, () => {
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        assert.match(source, /\.manual-google-notice\s*\{/);
        assert.match(source, /@media \(max-width: 380px\)/);
        assert.match(source, /prefers-reduced-motion: reduce/);
        assert.match(source, /body\[data-theme="dark"\] \.manual-google-notice/);
    });
}
