const CONTACT_CONFIG = Object.freeze({
  TO_EMAIL: 'yitbarek.etc@gmail.com',
  MAX_MESSAGE_LENGTH: 10000,
  MAX_EMAILS_PER_SENDER_PER_HOUR: 5
});

function doGet() {
  return contactJson_({ success: true, service: 'Developer contact form', status: 'ready' });
}

function doPost(event) {

  try {
    if (!event || !event.postData || !event.postData.contents) {
      throw contactError_('Request body is required.');
    }

    const payload = JSON.parse(event.postData.contents);
    const fromEmail = String(payload.from_email || '').trim().toLowerCase();
    const message = String(payload.message || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail) || fromEmail.length > 254) {
      throw contactError_('Enter a valid email address.');
    }
    if (!message) throw contactError_('Enter a message.');
    if (message.length > CONTACT_CONFIG.MAX_MESSAGE_LENGTH) {
      throw contactError_('Message must be 10,000 characters or fewer.');
    }

    enforceContactRateLimit_(fromEmail);
    if (MailApp.getRemainingDailyQuota() < 1) {
      throw contactError_('The contact form has reached its email limit. Please try again later.');
    }

    MailApp.sendEmail({
      to: CONTACT_CONFIG.TO_EMAIL,
      replyTo: fromEmail,
      subject: 'Website contact message',
      body: 'From: ' + fromEmail + '\n\n' + message,
      name: 'Website Contact Form'
    });

    return contactJson_({ success: true, message: 'Message sent.' });
  } catch (error) {
    if (error && error.isContactError) {
      return contactJson_({ success: false, message: error.message });
    }
    console.error('Developer contact request failed:', error);
    return contactJson_({ success: false, message: 'Message could not be sent. Please try again.' });
  }
}

function enforceContactRateLimit_(email) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw contactError_('Please try again in a moment.');

  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email);
    const key = 'contact:' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key) || 0);
    if (count >= CONTACT_CONFIG.MAX_EMAILS_PER_SENDER_PER_HOUR) {
      throw contactError_('Too many messages. Please try again later.');
    }
    cache.put(key, String(count + 1), 3600);
  } finally {
    lock.releaseLock();
  }
}

function contactError_(message) {
  const error = new Error(message);
  error.isContactError = true;
  return error;
}

function contactJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorizeContactEmail() {
  MailApp.getRemainingDailyQuota();
  Logger.log('Mail permission authorized.');
}
