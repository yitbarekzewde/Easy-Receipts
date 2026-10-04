const SUPPORT_ATTACHMENT_CONFIG = Object.freeze({
  SUPPORT_EMAIL: 'yitbarek537zewde@gmail.com',
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
  MAX_MESSAGES_PER_SENDER_PER_HOUR: 5,
  MAX_MESSAGES_GLOBAL_PER_6_HOURS: 50
});

function doGet() {
  return supportAttachmentJson_({ success: true, service: 'Easy Receipt support mailer', status: 'ready' });
}

function doPost(event) {
  try {
    if (!event || !event.postData || !event.postData.contents) {
      throw supportAttachmentError_('Request body is required.');
    }

    const payload = JSON.parse(event.postData.contents);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw supportAttachmentError_('Invalid request.');
    }
    if (payload.action && payload.action !== 'sendSupportEmail') {
      throw supportAttachmentError_('Unknown action.');
    }

    const senderEmail = supportAttachmentEmail_(payload.toEmail || payload.email || payload.recipient);
    const subject = supportAttachmentText_(payload.subject, 160) || 'Support Request';
    const message = supportAttachmentText_(payload.message, 12000);
    const storeName = supportAttachmentText_(payload.storeName, 160) || 'Easy Receipt';
    const attachments = supportAttachmentFiles_(payload);

    supportAttachmentRateLimit_('sender', senderEmail, SUPPORT_ATTACHMENT_CONFIG.MAX_MESSAGES_PER_SENDER_PER_HOUR, 3600);
    supportAttachmentRateLimit_('global', 'all', SUPPORT_ATTACHMENT_CONFIG.MAX_MESSAGES_GLOBAL_PER_6_HOURS, 21600);
    if (MailApp.getRemainingDailyQuota() < 1) {
      throw supportAttachmentError_('Email sending limit reached. Please try again later.');
    }

    MailApp.sendEmail({
      to: SUPPORT_ATTACHMENT_CONFIG.SUPPORT_EMAIL,
      replyTo: senderEmail,
      subject: '[Easy Receipt Support] ' + subject,
      body: 'Store: ' + storeName + '\nFrom: ' + senderEmail + '\n\n' + (message || '(No message provided.)'),
      name: 'Easy Receipt Support',
      attachments: attachments
    });

    return supportAttachmentJson_({ success: true, message: 'Support request sent.' });
  } catch (error) {
    if (error && error.isSupportAttachmentError) {
      return supportAttachmentJson_({ success: false, message: error.message });
    }
    console.error('Support attachment request failed:', error);
    return supportAttachmentJson_({ success: false, message: 'Support request could not be sent. Please try again.' });
  }
}

function supportAttachmentFiles_(payload) {
  let fileData = String(payload.fileData || '').trim();
  if (fileData.indexOf('base64,') !== -1) fileData = fileData.slice(fileData.indexOf('base64,') + 7);
  if (!fileData) return [];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(fileData) || fileData.length > Math.ceil(SUPPORT_ATTACHMENT_CONFIG.MAX_ATTACHMENT_BYTES * 4 / 3) + 8) {
    throw supportAttachmentError_('The attachment is invalid or exceeds 10 MB.');
  }

  const mimeType = String(payload.fileType || '').toLowerCase();
  const acceptedTypes = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ];
  if (acceptedTypes.indexOf(mimeType) === -1) {
    throw supportAttachmentError_('This attachment type is not supported.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(fileData);
  } catch (error) {
    throw supportAttachmentError_('The attachment could not be decoded.');
  }
  if (bytes.length > SUPPORT_ATTACHMENT_CONFIG.MAX_ATTACHMENT_BYTES) {
    throw supportAttachmentError_('Attachments must be 10 MB or smaller.');
  }

  const filename = supportAttachmentFilename_(payload.fileName, mimeType);
  return [Utilities.newBlob(bytes, mimeType, filename)];
}

function supportAttachmentEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
    throw supportAttachmentError_('A valid sender email is required.');
  }
  return email;
}

function supportAttachmentText_(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

function supportAttachmentFilename_(value, mimeType) {
  const fallbackExtension = mimeType === 'application/pdf' ? '.pdf' : '';
  const filename = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 120);
  return filename || 'support-attachment' + fallbackExtension;
}

function supportAttachmentRateLimit_(scope, identity, limit, windowSeconds) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw supportAttachmentError_('Please try again in a moment.');
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, scope + ':' + identity);
    const key = 'support-attachment:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key) || 0);
    if (count >= limit) throw supportAttachmentError_('Too many support requests. Please try again later.');
    cache.put(key, String(count + 1), windowSeconds);
  } finally {
    lock.releaseLock();
  }
}

function supportAttachmentError_(message) {
  const error = new Error(message);
  error.isSupportAttachmentError = true;
  return error;
}

function supportAttachmentJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorizeSupportEmail() {
  MailApp.getRemainingDailyQuota();
  Logger.log('Mail permission authorized.');
}
