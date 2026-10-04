const CONFIG = Object.freeze({
  FIREBASE_PROJECT_ID: 'receipts-eccf0',
  SUPPORT_EMAIL: 'yitbarek537zewde@gmail.com',
  OTP_TTL_SECONDS: 10 * 60,
  OTP_RESEND_SECONDS: 60,
  OTP_MAX_ATTEMPTS: 5,
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024
});

const IDENTITY_TOOLKIT_BASE = 'https://identitytoolkit.googleapis.com/v1/projects/';

function doGet() {
  return jsonOutput_({ success: true, service: 'Easy Receipt Apps Script', status: 'ready' });
}

function doPost(event) {
  try {
    if (!event || !event.postData || !event.postData.contents) {
      throw publicError_('Request body is required.');
    }

    const payload = JSON.parse(event.postData.contents);
    const result = dispatch_(payload);
    return jsonOutput_(result);
  } catch (error) {
    if (error && error.isPublicError) {
      return jsonOutput_({ success: false, message: error.message });
    }
    console.error('Apps Script request failed:', error);
    return jsonOutput_({ success: false, message: 'The request could not be completed. Please try again.' });
  }
}

function dispatch_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw publicError_('Invalid request.');
  }

  switch (String(payload.action || '')) {
    case 'sendOTP':
      return sendOtp_(payload.email, 'registration');
    case 'verifyOTP':
      return verifyRegistrationOtp_(payload.email, payload.otp);
    case 'sendResetOTP':
      return sendResetOtp_(payload.email);
    case 'resetPassword':
      return resetPassword_(payload.email, payload.otp, payload.newPassword);
    case 'sendSupportEmail':
      return sendSupportEmail_(payload);
    case 'sendReceiptEmail':
      return sendReceiptEmail_(payload);
    default:
      throw publicError_('Unknown action.');
  }
}

function sendOtp_(emailValue, purpose) {
  const email = normalizeEmail_(emailValue);
  enforceRateLimit_('otp-' + purpose, email, 5, 21600);
  const cache = CacheService.getScriptCache();
  const key = otpCacheKey_(purpose, email);
  const cooldownKey = key + ':cooldown';
  if (cache.get(cooldownKey)) {
    throw publicError_('Please wait one minute before requesting another code.');
  }

  const otp = createOtp_();
  const secret = getOtpSecret_();
  const record = { digest: otpDigest_(purpose, email, otp, secret), attempts: 0 };
  const isReset = purpose === 'password-reset';
  const subject = isReset ? 'Your Easy Receipt password reset code' : 'Verify your Easy Receipt email';
  const body = isReset
    ? 'Your Easy Receipt password reset code is ' + otp + '. It expires in 10 minutes. If you did not request this, you can ignore this email.'
    : 'Your Easy Receipt email verification code is ' + otp + '. It expires in 10 minutes.';

  ensureMailQuota_();
  MailApp.sendEmail({ to: email, subject: subject, body: body, name: 'Easy Receipt' });
  cache.put(key, JSON.stringify(record), CONFIG.OTP_TTL_SECONDS);
  cache.put(cooldownKey, '1', CONFIG.OTP_RESEND_SECONDS);
  return { success: true, message: isReset ? 'Reset code sent.' : 'Verification code sent.' };
}

function sendResetOtp_(emailValue) {
  const email = normalizeEmail_(emailValue);
  enforceRateLimit_('password-reset-request', email, 5, 21600);
  const user = lookupFirebaseUser_(email);
  if (!user) {
    // Avoid exposing whether an email is registered.
    return { success: true, message: 'If an account exists, a reset code was sent.' };
  }
  return sendOtp_(email, 'password-reset');
}

function verifyRegistrationOtp_(emailValue, otpValue) {
  const email = normalizeEmail_(emailValue);
  withValidOtp_('registration', email, otpValue, function () {
    const user = lookupFirebaseUser_(email);
    if (!user) throw publicError_('No account was found for this email. Register again and request a new code.');
    updateFirebaseUser_(user.localId, { emailVerified: true });
  });
  return { success: true, message: 'Email verified.' };
}

function resetPassword_(emailValue, otpValue, newPasswordValue) {
  const email = normalizeEmail_(emailValue);
  const newPassword = String(newPasswordValue || '');
  if (newPassword.length < 6 || newPassword.length > 128) {
    throw publicError_('Password must be between 6 and 128 characters.');
  }

  withValidOtp_('password-reset', email, otpValue, function () {
    const user = lookupFirebaseUser_(email);
    if (!user) throw publicError_('Password reset could not be completed for this account.');
    updateFirebaseUser_(user.localId, { password: newPassword });
  });
  return { success: true, message: 'Password updated.' };
}

function withValidOtp_(purpose, email, otpValue, callback) {
  const otp = String(otpValue || '').trim();
  if (!/^\d{6}$/.test(otp)) throw publicError_('Enter the six-digit code from your email.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw publicError_('Please try again in a moment.');
  try {
    const cache = CacheService.getScriptCache();
    const key = otpCacheKey_(purpose, email);
    const value = cache.get(key);
    if (!value) throw publicError_('The code is missing or expired. Request a new code.');

    const record = JSON.parse(value);
    const expected = otpDigest_(purpose, email, otp, getOtpSecret_());
    if (!constantTimeEquals_(record.digest, expected)) {
      record.attempts = Number(record.attempts || 0) + 1;
      if (record.attempts >= CONFIG.OTP_MAX_ATTEMPTS) {
        cache.remove(key);
        throw publicError_('Too many incorrect attempts. Request a new code.');
      }
      cache.put(key, JSON.stringify(record), CONFIG.OTP_TTL_SECONDS);
      throw publicError_('The code is incorrect. Please try again.');
    }

    callback();
    cache.remove(key);
    cache.remove(key + ':cooldown');
  } finally {
    lock.releaseLock();
  }
}

function sendSupportEmail_(payload) {
  const senderEmail = normalizeEmail_(payload.toEmail || payload.email || payload.recipient);
  const subject = cleanText_(payload.subject, 160) || 'Support Request';
  const message = cleanText_(payload.message, 12000);
  const storeName = cleanText_(payload.storeName, 160) || 'Easy Receipt';
  const attachments = getAttachments_(payload, false);
  enforceRateLimit_('support-sender', senderEmail, 5, 3600);
  enforceRateLimit_('support-inbox', CONFIG.SUPPORT_EMAIL, 50, 21600);
  ensureMailQuota_();

  MailApp.sendEmail({
    to: CONFIG.SUPPORT_EMAIL,
    replyTo: senderEmail,
    subject: '[Easy Receipt Support] ' + subject,
    body: 'Store: ' + storeName + '\nFrom: ' + senderEmail + '\n\n' + (message || '(No message provided.)'),
    name: 'Easy Receipt Support',
    attachments: attachments
  });
  return { success: true, message: 'Support request sent.' };
}

function sendReceiptEmail_(payload) {
  const recipient = normalizeEmail_(payload.toEmail || payload.email || payload.recipient);
  const subject = cleanText_(payload.subject, 160) || 'Your receipt from Easy Receipt';
  const message = cleanText_(payload.message, 4000) || 'Please find your receipt attached.';
  const storeName = cleanText_(payload.storeName, 160) || 'Easy Receipt';
  const attachments = getAttachments_(payload, true);
  enforceRateLimit_('receipt-recipient', recipient, 8, 21600);
  enforceRateLimit_('receipt-global', CONFIG.SUPPORT_EMAIL, 80, 21600);
  ensureMailQuota_();

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: message + '\n\n' + storeName,
    name: storeName,
    attachments: attachments
  });
  return { success: true, message: 'Receipt sent.' };
}

function getAttachments_(payload, required) {
  const fileData = String(payload.fileData || '').trim();
  if (!fileData) {
    if (required) throw publicError_('The receipt attachment is missing.');
    return [];
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(fileData) || fileData.length > Math.ceil(CONFIG.MAX_ATTACHMENT_BYTES * 4 / 3) + 8) {
    throw publicError_('The attachment is invalid or too large. Maximum size is 10 MB.');
  }

  const mimeType = String(payload.fileType || '').toLowerCase();
  const allowedTypes = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ];
  const supportedImage = /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(mimeType);
  if (!supportedImage && allowedTypes.indexOf(mimeType) === -1) throw publicError_('This attachment type is not supported.');

  let bytes;
  try {
    bytes = Utilities.base64Decode(fileData);
  } catch (error) {
    throw publicError_('The attachment could not be decoded.');
  }
  if (bytes.length > CONFIG.MAX_ATTACHMENT_BYTES) throw publicError_('Attachments must be 10 MB or smaller.');

  const filename = cleanFilename_(payload.fileName) || 'attachment';
  return [Utilities.newBlob(bytes, mimeType, filename)];
}

function lookupFirebaseUser_(email) {
  const response = identityToolkitRequest_('accounts:lookup', { email: [email] });
  const users = response && response.users ? response.users : [];
  return users.length ? users[0] : null;
}

function updateFirebaseUser_(localId, changes) {
  const body = Object.assign({ localId: localId }, changes);
  identityToolkitRequest_('accounts:update', body);
}

function identityToolkitRequest_(method, payload) {
  const projectId = encodeURIComponent(CONFIG.FIREBASE_PROJECT_ID);
  const url = IDENTITY_TOOLKIT_BASE + projectId + '/' + method;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  let body;
  try { body = JSON.parse(response.getContentText() || '{}'); }
  catch (error) { body = {}; }
  if (status < 200 || status >= 300) {
    console.error('Firebase Identity Toolkit admin request failed:', status, body && body.error ? body.error.message : 'Unknown error');
    throw publicError_('Firebase account service is unavailable. Check the Apps Script Firebase Auth permissions.');
  }
  return body;
}

function normalizeEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw publicError_('Enter a valid email address.');
  }
  return email;
}

function cleanText_(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

function cleanFilename_(value) {
  return String(value || 'attachment').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 120);
}

function createOtp_() {
  const randomHex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return String(parseInt(randomHex, 16) % 1000000).padStart(6, '0');
}

function getOtpSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('OTP_HMAC_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty('OTP_HMAC_SECRET', secret);
  }
  return secret;
}

function otpDigest_(purpose, email, otp, secret) {
  const signature = Utilities.computeHmacSha256Signature(purpose + ':' + email + ':' + otp, secret);
  return Utilities.base64Encode(signature);
}

function otpCacheKey_(purpose, email) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, purpose + ':' + email);
  return 'otp:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function constantTimeEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function ensureMailQuota_() {
  if (MailApp.getRemainingDailyQuota() < 1) throw publicError_('Email sending limit reached. Please try again later.');
}

function enforceRateLimit_(scope, identity, limit, windowSeconds) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw publicError_('Please try again in a moment.');
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, scope + ':' + identity);
    const key = 'rate:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key) || 0);
    if (count >= limit) throw publicError_('Too many requests. Please try again later.');
    cache.put(key, String(count + 1), windowSeconds);
  } finally {
    lock.releaseLock();
  }
}

function publicError_(message) {
  const error = new Error(message);
  error.isPublicError = true;
  return error;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function authorizeServices() {
  MailApp.getRemainingDailyQuota();
  ScriptApp.getOAuthToken();
  Logger.log('Mail and Firebase Admin scopes authorized.');
}
