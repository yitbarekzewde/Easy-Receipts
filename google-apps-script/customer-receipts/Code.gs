const CUSTOMER_RECEIPT_CONFIG = Object.freeze({
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
  MAX_EMAILS_PER_RECIPIENT_PER_6_HOURS: 8,
  MAX_EMAILS_GLOBAL_PER_6_HOURS: 100,
  CACHE_WINDOW_SECONDS: 21600
});

function doGet() {
  return customerReceiptJson_({ success: true, service: 'Easy Receipt customer receipt mailer', status: 'ready' });
}

function doPost(event) {
  try {
    if (!event || !event.postData || !event.postData.contents) {
      throw customerReceiptError_('Request body is required.');
    }

    const payload = JSON.parse(event.postData.contents);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw customerReceiptError_('Invalid request.');
    }
    if (payload.action && payload.action !== 'sendReceiptEmail' && payload.action !== 'sendCustomerReceipt') {
      throw customerReceiptError_('Unknown action.');
    }

    const recipient = customerReceiptEmail_(payload.toEmail || payload.email || payload.recipient || payload.to_email);
    const storeName = customerReceiptText_(payload.storeName, 160) || 'Easy Receipt';
    const subject = customerReceiptText_(payload.subject, 160) || 'Your receipt from ' + storeName;
    const message = customerReceiptText_(payload.message, 4000) || 'Please find your receipt attached.';
    const attachments = customerReceiptAttachment_(payload);

    customerReceiptRateLimit_('recipient', recipient, CUSTOMER_RECEIPT_CONFIG.MAX_EMAILS_PER_RECIPIENT_PER_6_HOURS);
    customerReceiptRateLimit_('global', 'all', CUSTOMER_RECEIPT_CONFIG.MAX_EMAILS_GLOBAL_PER_6_HOURS);
    if (MailApp.getRemainingDailyQuota() < 1) {
      throw customerReceiptError_('Email sending limit reached. Please try again later.');
    }

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: message + '\n\n' + storeName,
      name: storeName,
      attachments: [attachments]
    });

    return customerReceiptJson_({ success: true, message: 'Receipt sent.' });
  } catch (error) {
    if (error && error.isCustomerReceiptError) {
      return customerReceiptJson_({ success: false, message: error.message });
    }
    console.error('Customer receipt email failed:', error);
    return customerReceiptJson_({ success: false, message: 'Receipt could not be sent. Please try again.' });
  }
}

function customerReceiptAttachment_(payload) {
  let fileData = String(payload.fileData || '').trim();
  if (fileData.indexOf('base64,') !== -1) fileData = fileData.slice(fileData.indexOf('base64,') + 7);
  if (!fileData) throw customerReceiptError_('The receipt attachment is missing.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(fileData) || fileData.length > Math.ceil(CUSTOMER_RECEIPT_CONFIG.MAX_ATTACHMENT_BYTES * 4 / 3) + 8) {
    throw customerReceiptError_('The receipt attachment is invalid or exceeds 10 MB.');
  }

  const mimeType = String(payload.fileType || '').toLowerCase();
  const acceptedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf'];
  if (acceptedTypes.indexOf(mimeType) === -1) {
    throw customerReceiptError_('Attach the receipt as a PNG, JPEG, GIF, WebP, BMP, or PDF file.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(fileData);
  } catch (error) {
    throw customerReceiptError_('The receipt attachment could not be decoded.');
  }
  if (bytes.length > CUSTOMER_RECEIPT_CONFIG.MAX_ATTACHMENT_BYTES) {
    throw customerReceiptError_('The receipt attachment exceeds 10 MB.');
  }

  const filename = customerReceiptFilename_(payload.fileName, mimeType);
  return Utilities.newBlob(bytes, mimeType, filename);
}

function customerReceiptEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
    throw customerReceiptError_('A valid customer email is required.');
  }
  return email;
}

function customerReceiptText_(value, limit) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, limit);
}

function customerReceiptFilename_(value, mimeType) {
  const fallbackExtension = mimeType === 'application/pdf' ? '.pdf' : '.png';
  const filename = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 120);
  return filename || 'receipt' + fallbackExtension;
}

function customerReceiptRateLimit_(scope, identity, limit) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw customerReceiptError_('Please try again in a moment.');
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, scope + ':' + identity);
    const key = 'customer-receipt:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key) || 0);
    if (count >= limit) throw customerReceiptError_('Too many receipt emails. Please try again later.');
    cache.put(key, String(count + 1), CUSTOMER_RECEIPT_CONFIG.CACHE_WINDOW_SECONDS);
  } finally {
    lock.releaseLock();
  }
}

function customerReceiptError_(message) {
  const error = new Error(message);
  error.isCustomerReceiptError = true;
  return error;
}

function customerReceiptJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorizeCustomerReceiptEmail() {
  MailApp.getRemainingDailyQuota();
  Logger.log('Mail permission authorized.');
}
