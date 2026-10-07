(() => {
    const STORAGE_KEY = 'p3_saved_customers';
    const SERVICE_FEE_RATE = 0.10;
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx2vAFTPPvCwnK7rI0OQuvuesMCvqQ9NSHX2tx94z-axY7eEvF7T4cU3WRwpgj021Ct/exec';
    const CUSTOMER_RECEIPT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxnzc70hmMw9G8fIPRX1eiypQfglG5Yw9in3XLVPGDx02GOzk6ibMnR2y7M7WfeaDdpUA/exec';
    const byId = id => document.getElementById(id);
    const money = value => `R ${Number(value || 0).toFixed(2)}`;
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
    let selectedCustomerId = '';
    let creditCart = [];
    let pendingIdPhoto = '';
    let verifiedRegistrationEmail = '';
    let requestedRegistrationEmail = '';
    let savingCredit = false;

    function getCustomers() {
        try {
            const customers = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(customers) ? customers : [];
        } catch {
            return [];
        }
    }

    function saveCustomers(customers) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customers));
    }

    function getStockItems() {
        try {
            const items = JSON.parse(localStorage.getItem('p3_stock_items') || '[]');
            return Array.isArray(items) ? items : [];
        } catch {
            return [];
        }
    }

    function getAutoPrices() {
        try {
            const prices = JSON.parse(localStorage.getItem('p3_auto_prices') || '{}');
            return prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {};
        } catch {
            return {};
        }
    }

    function getStockPrice(item) {
        const autoPrice = getAutoPrices()[String(item.name || '').trim().toLowerCase()]?.price;
        return Number(autoPrice) > 0 ? Number(autoPrice) : Number(item.sellPrice || 0);
    }

    function getSelectedCustomer(customers = getCustomers()) {
        return customers.find(customer => String(customer.id) === String(selectedCustomerId)) || null;
    }

    function setStatus(id, message, state = '') {
        const status = byId(id);
        status.textContent = message;
        status.dataset.state = state;
    }

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    function setEmailVerificationStatus(message, state = '') {
        const status = byId('customerEmailVerificationStatus');
        status.textContent = message;
        status.dataset.state = state;
    }

    async function postAppsScript(url, payload, fallbackMessage) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error(fallbackMessage);
        }
        if (!response.ok || !result.success) throw new Error(result.message || fallbackMessage);
        return result;
    }

    function getCashierProfile() {
        try {
            const profile = JSON.parse(localStorage.getItem('p3_user_profile') || 'null');
            return profile && typeof profile === 'object' ? profile : {};
        } catch {
            return {};
        }
    }

    function wrapCanvasLines(context, lines, maxWidth) {
        return lines.flatMap(line => {
            const words = String(line).split(/\s+/);
            const wrapped = [];
            let current = '';
            words.forEach(word => {
                const candidate = current ? `${current} ${word}` : word;
                if (current && context.measureText(candidate).width > maxWidth) {
                    wrapped.push(current);
                    current = word;
                } else current = candidate;
            });
            if (current) wrapped.push(current);
            return wrapped;
        });
    }

    function createCreditEmailAttachment(details) {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare the credit detail attachment.');
        const bodyLines = [
            `Customer: ${details.customer.name}`,
            `Cashier: ${details.cashierName}`,
            `Reference: ${details.id}`,
            `Date: ${new Date(details.timestamp).toLocaleString()}`,
            '',
            'ITEMS'
        ];
        details.items.forEach(item => bodyLines.push(`${item.qty} x ${item.name} @ ${money(item.price)} = ${money(item.qty * item.price)}`));
        bodyLines.push('', `Items subtotal: ${money(details.principal)}`, `Service fee (10%): ${money(details.fee)}`, `Credit added: ${money(details.total)}`, `Previous balance: ${money(details.previousBalance)}`, `New balance: ${money(details.newBalance)}`);
        context.font = '23px Arial, sans-serif';
        const lines = wrapCanvasLines(context, bodyLines, 1060);
        const lineHeight = 37;
        canvas.height = Math.max(540, 170 + lines.length * lineHeight);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#164b3d';
        context.font = 'bold 34px Arial, sans-serif';
        context.fillText('EASY RECEIPT · CREDIT DETAIL', 70, 74);
        context.fillStyle = '#24352e';
        context.font = '23px Arial, sans-serif';
        lines.forEach((line, index) => context.fillText(line, 70, 135 + index * lineHeight));
        return canvas.toDataURL('image/png').split(',')[1];
    }

    async function sendCreditDetailEmail(email, details, attachment) {
        return postAppsScript(CUSTOMER_RECEIPT_APPS_SCRIPT_URL, {
            action: 'sendReceiptEmail',
            toEmail: email,
            subject: `Credit detail ${details.id} · Easy Receipt`,
            message: details.emailBody,
            storeName: 'Easy Receipt Credit Desk',
            fileData: attachment,
            fileName: `credit-${details.id}.png`,
            fileType: 'image/png'
        }, 'Credit email could not be sent.');
    }

    async function notifyCreditSaved(details) {
        const cashier = getCashierProfile();
        const cashierEmail = normalizeEmail(cashier.email);
        const customerEmail = normalizeEmail(details.customer.email);
        const recipients = new Map();
        if (customerEmail) recipients.set(customerEmail, ['customer']);
        if (cashierEmail) {
            const roles = recipients.get(cashierEmail) || [];
            if (!roles.includes('cashier')) roles.push('cashier');
            recipients.set(cashierEmail, roles);
        }
        const missingRoles = [];
        if (!customerEmail) missingRoles.push('customer email is missing');
        if (!cashierEmail) missingRoles.push('cashier email is not set in the Easy Receipt profile');
        if (!recipients.size) return { sent: [], failed: [], missingRoles };

        const emailBody = [
            `Credit details for ${details.customer.name}`,
            `Reference: ${details.id}`,
            `Date: ${new Date(details.timestamp).toLocaleString()}`,
            '',
            ...details.items.map(item => `${item.qty} x ${item.name} @ ${money(item.price)} = ${money(item.qty * item.price)}`),
            '',
            `Items subtotal: ${money(details.principal)}`,
            `Service fee (10%): ${money(details.fee)}`,
            `Credit added: ${money(details.total)}`,
            `Previous balance: ${money(details.previousBalance)}`,
            `New balance: ${money(details.newBalance)}`
        ].join('\n');
        const mailDetails = { ...details, cashierName: cashier.name || 'Cashier', emailBody };
        let attachment;
        try {
            attachment = createCreditEmailAttachment(mailDetails);
        } catch (error) {
            return { sent: [], failed: [], missingRoles: [...missingRoles, error.message] };
        }
        const results = await Promise.all(Array.from(recipients, async ([email, roles]) => {
            try {
                await sendCreditDetailEmail(email, mailDetails, attachment);
                return { email, roles, success: true };
            } catch (error) {
                return { email, roles, success: false, message: error.message };
            }
        }));
        return {
            sent: results.filter(result => result.success).flatMap(result => result.roles),
            failed: results.filter(result => !result.success).map(result => `${result.roles.join('/')} email: ${result.message}`),
            missingRoles
        };
    }

    async function compressIdentityPhoto(file) {
        if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the ID photo.');
        if (file.size > 15 * 1024 * 1024) throw new Error('Choose an ID image smaller than 15 MB.');
        const image = await createImageBitmap(file);
        const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot prepare the ID photo for storage.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.76);
        if (dataUrl.length > 2 * 1024 * 1024) throw new Error('This ID image is too large to store. Use a smaller or lower-resolution photo.');
        return dataUrl;
    }

    function closeIdentityImage() {
        byId('identityImageModal').classList.add('hidden');
        byId('identityImageModal').setAttribute('aria-hidden', 'true');
        byId('identityImageView').removeAttribute('src');
        document.body.classList.remove('identity-image-open');
    }

    function closeCustomerStatement() {
        byId('customerStatementModal').classList.add('hidden');
        byId('customerStatementModal').setAttribute('aria-hidden', 'true');
        document.body.classList.remove('statement-open');
        byId('accountDetail').querySelector('[data-open-statement]')?.focus();
    }

    function openCustomerStatement(customer) {
        if (!customer) return;
        const entries = Array.isArray(customer.history) ? customer.history : [];
        const totals = entries.reduce((summary, entry) => {
            if (entry.type === 'payment') summary.payments += Number(entry.amount || entry.paid || 0);
            else {
                summary.purchases += Number(entry.total || 0);
                summary.fees += Number(entry.serviceFee || 0);
                summary.payments += Number(entry.paid || 0);
            }
            return summary;
        }, { purchases: 0, fees: 0, payments: 0 });
        const idLabel = customer.idType === 'passport' ? 'Passport' : 'ID';
        const maskedId = String(customer.idNumber || 'Not recorded').replace(/.(?=.{4})/g, '•');
        byId('statementTitle').textContent = `${customer.name} statement`;
        byId('statementCustomerMeta').textContent = `${idLabel}: ${maskedId}${customer.phone ? ` · ${customer.phone}` : ''}${customer.email ? ` · ${customer.email}` : ''}`;
        byId('statementSummary').innerHTML = `
            <div><span>Billed total</span><strong>${money(totals.purchases)}</strong></div>
            <div><span>Service fees</span><strong>${money(totals.fees)}</strong></div>
            <div><span>Payments</span><strong>${money(totals.payments)}</strong></div>
            <div class="statement-current-balance"><span>Current balance</span><strong>${money(customer.due)}</strong></div>`;

        const rows = entries.map((entry, index) => {
            const isPayment = entry.type === 'payment';
            const items = Array.isArray(entry.items) ? entry.items : [];
            const itemsMarkup = items.length ? `<ul class="statement-item-list">${items.map(item => {
                if (typeof item === 'string') return `<li>${escapeHtml(item)}</li>`;
                const quantity = Number(item.qty || 1);
                const price = Number(item.price || 0);
                return `<li>${escapeHtml(item.name || 'Item')} · ${quantity} × ${money(price)} = ${money(quantity * price)}</li>`;
            }).join('')}</ul>` : '<span class="statement-no-items">No item details recorded</span>';
            const dateValue = entry.timestamp || entry.date || '';
            const date = dateValue && !Number.isNaN(new Date(dateValue).getTime()) ? new Date(dateValue).toLocaleString() : 'Date unavailable';
            const purchaseTotal = Number(entry.total || 0);
            const fee = Number(entry.serviceFee || 0);
            const paid = isPayment ? Number(entry.amount || entry.paid || 0) : Number(entry.paid || 0);
            const dueChange = isPayment ? -paid : Math.max(0, purchaseTotal - paid);
            return `<tr>
                <td data-label="Date">${escapeHtml(date)}</td>
                <td data-label="Reference">${escapeHtml(entry.id || `#${index + 1}`)}</td>
                <td data-label="Activity"><span class="statement-type ${isPayment ? 'payment' : 'purchase'}">${isPayment ? 'Payment' : 'Purchase'}</span></td>
                <td data-label="Items">${itemsMarkup}</td>
                <td data-label="Subtotal">${money(isPayment ? 0 : Number(entry.principal ?? (purchaseTotal - fee)))}</td>
                <td data-label="Fee">${money(fee)}</td>
                <td data-label="Paid">${money(paid)}</td>
                <td data-label="Balance change" class="${dueChange > 0 ? 'statement-charge' : 'statement-payment'}">${dueChange > 0 ? '+' : dueChange < 0 ? '−' : ''}${money(Math.abs(dueChange))}</td>
            </tr>`;
        });
        byId('statementTableWrap').innerHTML = entries.length ? `
            <table class="statement-table">
                <thead><tr><th>Date</th><th>Reference</th><th>Activity</th><th>Items</th><th>Subtotal</th><th>Fee</th><th>Paid</th><th>Balance change</th></tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table>` : '<div class="statement-empty">No statement activity recorded for this customer.</div>';
        byId('customerStatementModal').classList.remove('hidden');
        byId('customerStatementModal').setAttribute('aria-hidden', 'false');
        document.body.classList.add('statement-open');
        byId('closeCustomerStatement').focus();
    }

    function render() {
        const customers = getCustomers();
        if (!customers.some(customer => String(customer.id) === String(selectedCustomerId))) {
            selectedCustomerId = customers.length ? String(customers[0].id) : '';
        }

        const totalDue = customers.reduce((total, customer) => total + Number(customer.due || 0), 0);
        const totalFees = customers.reduce((total, customer) => total + (Array.isArray(customer.history)
            ? customer.history.reduce((sum, entry) => sum + Number(entry.serviceFee || 0), 0)
            : 0), 0);
        byId('accountCount').textContent = customers.length;
        byId('outstandingTotal').textContent = money(totalDue);
        byId('feesTotal').textContent = money(totalFees);

        const selector = byId('ledgerCustomer');
        selector.innerHTML = '<option value="">Select a customer</option>' + customers.map(customer =>
            `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`).join('');
        selector.value = selectedCustomerId;
        const query = byId('customerSearch').value.trim().toLowerCase();
        const visibleCustomers = customers.filter(customer =>
            [customer.name, customer.idNumber, customer.phone, customer.email].some(value => String(value || '').toLowerCase().includes(query)));
        byId('customerList').innerHTML = visibleCustomers.length ? visibleCustomers.map(customer => {
            const due = Number(customer.due || 0);
            return `<button type="button" class="customer-row${String(customer.id) === String(selectedCustomerId) ? ' selected' : ''}" data-customer-id="${escapeHtml(customer.id)}">
                <span><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.phone || customer.idNumber || 'Credit account')}</span></span>
                <span class="customer-balance ${due > 0 ? 'has-due' : 'clear'}">${money(due)}</span>
            </button>`;
        }).join('') : `<div class="empty-list">${customers.length ? 'No customers match your search.' : 'No credit customers registered yet.'}</div>`;

        renderDetail(getSelectedCustomer(customers));
        renderCreditStock();
        updateCreditPreview();
    }

    function renderDetail(customer) {
        const container = byId('accountDetail');
        if (!customer) {
            container.innerHTML = '<div class="empty-detail"><span><i class="fas fa-address-card" aria-hidden="true"></i></span><h2>Select an account</h2><p>Choose a customer to review their balance and recent activity.</p></div>';
            return;
        }
        const due = Number(customer.due || 0);
        const history = Array.isArray(customer.history) ? [...customer.history].reverse().slice(0, 12) : [];
        const idLabel = customer.idType === 'passport' ? 'Passport' : 'ID';
        const idNumber = customer.idNumber ? `${idLabel} ${String(customer.idNumber).replace(/.(?=.{4})/g, '•')}` : 'ID not recorded';
        const initials = String(customer.name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        const profileDetails = [
            ['Date of birth', customer.dateOfBirth ? new Date(`${customer.dateOfBirth}T00:00:00`).toLocaleDateString() : 'Not recorded'],
            ['Gender', customer.gender ? customer.gender[0].toUpperCase() + customer.gender.slice(1) : 'Not recorded']
        ];
        const profileMarkup = profileDetails.map(([label, value]) =>
            `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
        ).join('');
        const photoAction = customer.idPhoto
            ? '<button class="id-photo-button" type="button" data-view-id-photo><i class="fas fa-image" aria-hidden="true"></i> View ID photo</button>'
            : '';
        const transactions = history.length ? history.map(entry => {
            const isPayment = entry.type === 'payment';
            const amount = isPayment ? Number(entry.amount || entry.paid || 0) : Number(entry.total || 0);
            const detail = isPayment ? 'Payment received' : `Credit${entry.serviceFee ? ` + ${money(entry.serviceFee)} fee` : ''}`;
            const date = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : 'Date unavailable';
            return `<div class="transaction"><span>${escapeHtml(detail)}<br>${escapeHtml(date)}</span><strong class="${isPayment ? '' : 'credit-entry'}">${isPayment ? '−' : '+'}${money(amount)}</strong></div>`;
        }).join('') : '<div class="empty-list">No account activity yet.</div>';

        container.innerHTML = `<div class="detail-top"><div class="customer-profile"><span class="customer-avatar" aria-hidden="true">${escapeHtml(initials)}</span><div><p class="eyebrow">CUSTOMER PROFILE</p><h2>${escapeHtml(customer.name)}</h2><p>${escapeHtml(idNumber)}</p>${photoAction}</div></div><span class="account-tag">Credit</span></div>
            <div class="customer-profile-details">${profileMarkup}</div>
            <div class="detail-balance"><span>Outstanding balance</span><strong class="${due > 0 ? '' : 'clear'}">${money(due)}</strong></div>
            <div class="detail-contact"><span><i class="fas fa-phone" aria-hidden="true"></i>${escapeHtml(customer.phone || 'No phone number')}</span><span><i class="fas fa-envelope" aria-hidden="true"></i>${escapeHtml(customer.email || 'No email address')}</span><span><i class="fas fa-location-dot" aria-hidden="true"></i>${escapeHtml(customer.address || 'No address recorded')}</span></div>
            <button class="statement-open-button" type="button" data-open-statement><i class="fas fa-file-invoice-dollar" aria-hidden="true"></i> View full statement</button>
            <div class="transaction-heading">Recent activity <span>${history.length} shown</span></div><div class="transaction-list">${transactions}</div>`;
    }

    function updateCreditPreview() {
        const principal = creditCart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
        byId('creditSubtotalPreview').textContent = money(principal);
        byId('feePreview').textContent = money(principal * SERVICE_FEE_RATE);
        byId('creditTotalPreview').textContent = money(principal * (1 + SERVICE_FEE_RATE));
    }

    function renderCreditStock() {
        const availableCount = getOrderingItems().filter(item => item.stockItem && item.available > 0 && item.price > 0).length;
        byId('creditStockStatus').textContent = availableCount
            ? 'Choose products from the main Ordering catalog using the button below.'
            : 'No priced products with stock are available in the Ordering catalog.';
        byId('creditCart').innerHTML = creditCart.length ? creditCart.map((item, index) => `
            <div class="credit-cart-line"><span>${escapeHtml(item.name)} × ${Number(item.qty)}</span><strong>${money(item.price * item.qty)}</strong><button type="button" data-remove-credit-item="${index}" aria-label="Remove ${escapeHtml(item.name)}"><i class="fas fa-times" aria-hidden="true"></i></button></div>
        `).join('') : '<div class="credit-cart-empty">No stock items added.</div>';
    }

    function getOrderingItems() {
        const stockItems = getStockItems();
        return Object.values(getAutoPrices()).filter(item => item?.originalName).map(managedItem => {
            const stockItem = stockItems.find(item => String(item.name || '').trim().toLowerCase() === managedItem.originalName.trim().toLowerCase());
            return {
                managedItem,
                stockItem,
                available: Math.max(0, Number(stockItem?.qty || 0)),
                price: Number(managedItem.price || 0)
            };
        }).sort((first, second) => first.managedItem.originalName.localeCompare(second.managedItem.originalName));
    }

    function renderOrderingCatalog() {
        const container = byId('orderingCatalogItems');
        const previousSelection = new Map(Array.from(container.querySelectorAll('.ordering-checkbox:checked'), checkbox => {
            const row = checkbox.closest('.ordering-option');
            return [checkbox.value, Number(row.querySelector('.ordering-quantity').value) || 1];
        }));
        const query = byId('orderingCatalogSearch').value.trim().toLowerCase();
        const items = getOrderingItems().filter(item => !query || `${item.managedItem.originalName} ${item.stockItem?.barcode || ''}`.toLowerCase().includes(query));
        if (!items.length) {
            container.innerHTML = '<div class="ordering-catalog-empty">No Ordering items match this search.</div>';
            return;
        }
        container.innerHTML = items.map(item => {
            const available = Boolean(item.stockItem && item.available > 0 && item.price > 0);
            const itemId = String(item.stockItem?.id ?? '');
            const selectedQuantity = previousSelection.get(itemId) || 1;
            const maxQuantity = Math.max(1, item.available);
            return `<div class="ordering-option${available ? '' : ' is-unavailable'}">
                <label class="ordering-option-main">
                    <input class="ordering-checkbox" type="checkbox" value="${escapeHtml(itemId)}"${available ? '' : ' disabled'}${previousSelection.has(itemId) ? ' checked' : ''}>
                    <span class="ordering-option-copy"><strong>${escapeHtml(item.managedItem.originalName)}</strong><span>${available ? `${item.available} in stock` : item.stockItem ? 'Out of stock or price unavailable' : 'Not in stock control'}</span></span>
                    <strong class="ordering-option-price">${money(item.price)}</strong>
                </label>
                <label class="ordering-option-qty">Qty<input class="ordering-quantity" type="number" min="1" max="${maxQuantity}" step="1" value="${Math.min(selectedQuantity, maxQuantity)}" inputmode="numeric"${available && previousSelection.has(itemId) ? '' : ' disabled'} aria-label="Quantity for ${escapeHtml(item.managedItem.originalName)}"></label>
            </div>`;
        }).join('');
    }

    function openOrderingCatalog() {
        renderOrderingCatalog();
        byId('orderingCatalogStatus').textContent = 'Select items from the main Ordering price list. Only items already in stock can be credited.';
        byId('orderingCatalogStatus').dataset.state = '';
        byId('orderingCatalogModal').classList.remove('hidden');
        byId('orderingCatalogModal').setAttribute('aria-hidden', 'false');
        document.body.classList.add('ordering-open');
        byId('orderingCatalogSearch').focus();
    }

    function closeOrderingCatalog() {
        byId('orderingCatalogModal').classList.add('hidden');
        byId('orderingCatalogModal').setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ordering-open');
        byId('openOrderingCatalog').focus();
    }

    function addSelectedOrderingItems() {
        const selected = Array.from(byId('orderingCatalogItems').querySelectorAll('.ordering-checkbox:checked')).map(checkbox => {
            const row = checkbox.closest('.ordering-option');
            return { stockItemId: checkbox.value, quantity: Number(row.querySelector('.ordering-quantity').value) };
        });
        if (!selected.length) {
            setStatus('orderingCatalogStatus', 'Select at least one item first.', 'error');
            return;
        }

        const stockItems = getStockItems();
        const prepared = [];
        const requested = new Map();
        for (const selection of selected) {
            if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
                setStatus('orderingCatalogStatus', 'Each quantity must be a whole number greater than zero.', 'error');
                return;
            }
            const stockItem = stockItems.find(item => String(item.id) === selection.stockItemId);
            if (!stockItem) {
                setStatus('orderingCatalogStatus', 'A selected item is no longer in stock control. Refresh the catalog and try again.', 'error');
                renderOrderingCatalog();
                return;
            }
            const price = getStockPrice(stockItem);
            if (!Number.isFinite(price) || price <= 0) {
                setStatus('orderingCatalogStatus', `${stockItem.name} no longer has a valid managed price.`, 'error');
                return;
            }
            requested.set(selection.stockItemId, (requested.get(selection.stockItemId) || 0) + selection.quantity);
            prepared.push({ stockItemId: stockItem.id, barcode: stockItem.barcode || '', name: stockItem.name, price, qty: selection.quantity });
        }

        for (const [stockItemId, quantity] of requested) {
            const stockItem = stockItems.find(item => String(item.id) === stockItemId);
            const alreadyAdded = creditCart.filter(item => String(item.stockItemId) === stockItemId).reduce((sum, item) => sum + item.qty, 0);
            if (Number(stockItem.qty || 0) < quantity + alreadyAdded) {
                setStatus('orderingCatalogStatus', `Not enough ${stockItem.name} remains in stock.`, 'error');
                renderOrderingCatalog();
                return;
            }
        }

        prepared.forEach(item => {
            const existing = creditCart.find(cartItem => String(cartItem.stockItemId) === String(item.stockItemId));
            if (existing) existing.qty += item.qty;
            else creditCart.push(item);
        });
        closeOrderingCatalog();
        renderCreditStock();
        updateCreditPreview();
        setStatus('ledgerStatus', `${selected.length} item selection${selected.length === 1 ? '' : 's'} added to the credit.`);
    }

    function getStockAudit() {
        try {
            const log = JSON.parse(localStorage.getItem('p3_stock_audit') || '[]');
            return Array.isArray(log) ? log : [];
        } catch {
            return [];
        }
    }

    function normalizeId(value) {
        return String(value || '').replace(/\s/g, '').trim().toUpperCase();
    }

    function validateIdentity(type, value) {
        const identity = normalizeId(value);
        if (!identity) return 'An ID number or passport number is required.';
        if (type === 'passport') {
            return /^[A-Z0-9]{5,20}$/.test(identity)
                ? ''
                : 'Enter a passport number using 5 to 20 letters or numbers.';
        }
        if (!/^\d{13}$/.test(identity)) return 'A South African ID must contain exactly 13 digits.';

        const yearPart = Number(identity.slice(0, 2));
        const currentYear = new Date().getFullYear();
        const year = yearPart <= currentYear % 100 ? 2000 + yearPart : 1900 + yearPart;
        const month = Number(identity.slice(2, 4));
        const day = Number(identity.slice(4, 6));
        const birthDate = new Date(year, month - 1, day);
        if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day || birthDate > new Date()) {
            return 'The birth date in this South African ID is not valid.';
        }
        if (!['0', '1'].includes(identity[10])) return 'The citizenship digit in this South African ID is not valid.';

        const digits = [...identity].map(Number);
        const oddPositionSum = digits.slice(0, 12).filter((_, index) => index % 2 === 0).reduce((sum, digit) => sum + digit, 0);
        const doubledEvenDigits = digits.slice(0, 12).filter((_, index) => index % 2 === 1).join('') * 2;
        const evenPositionSum = String(doubledEvenDigits).split('').reduce((sum, digit) => sum + Number(digit), 0);
        const checkDigit = (10 - ((oddPositionSum + evenPositionSum) % 10)) % 10;
        return checkDigit === digits[12] ? '' : 'The South African ID checksum is invalid. Check the number against the document.';
    }

    function getSouthAfricanIdDetails(value) {
        const idNumber = normalizeId(value);
        if (validateIdentity('sa-id', idNumber)) return null;
        const currentYear = new Date().getFullYear();
        const shortYear = Number(idNumber.slice(0, 2));
        const year = (2000 + shortYear) <= currentYear ? 2000 + shortYear : 1900 + shortYear;
        const month = idNumber.slice(2, 4);
        const day = idNumber.slice(4, 6);
        const genderSequence = Number(idNumber.slice(6, 10));
        return {
            dateOfBirth: `${year}-${month}-${day}`,
            gender: genderSequence >= 5000 ? 'male' : 'female'
        };
    }

    function getOcrLabelValue(lines, labels) {
        const labelPattern = new RegExp(`^(?:${labels})\\s*[:\\-]?\\s*(.*)$`, 'i');
        for (let index = 0; index < lines.length; index++) {
            const match = lines[index].match(labelPattern);
            if (!match) continue;
            const value = match[1].trim();
            if (value) return value;
            const nextLine = lines[index + 1] || '';
            return /^(?:surname|names?|forenames?|given names?)\b/i.test(nextLine) ? '' : nextLine;
        }
        return '';
    }

    function updateIdentityFeedback() {
        const type = byId('customerIdType').value;
        const input = byId('customerIdNumber');
        const feedback = byId('identityStatus');
        const message = validateIdentity(type, input.value);
        input.setCustomValidity(message);
        input.setAttribute('aria-invalid', message && input.value.trim() ? 'true' : 'false');
        feedback.textContent = message || (input.value.trim()
            ? type === 'sa-id' ? 'Number format and checksum are valid. Verify it against the original ID.' : 'Passport number format looks valid. Verify it against the original document.'
            : '');
        feedback.dataset.state = message ? 'error' : input.value.trim() ? 'success' : '';
        return message;
    }

    byId('customerIdType').addEventListener('change', event => {
        const isPassport = event.target.value === 'passport';
        byId('identityNumberLabel').textContent = isPassport ? 'Passport number' : 'South African ID number';
        byId('customerIdNumber').inputMode = isPassport ? 'text' : 'numeric';
        byId('customerIdNumber').placeholder = isPassport ? '5 to 20 letters or numbers' : '13-digit ID number';
        updateIdentityFeedback();
    });
    byId('customerIdNumber').addEventListener('input', () => {
        updateIdentityFeedback();
        const identityDetails = getSouthAfricanIdDetails(byId('customerIdNumber').value);
        if (identityDetails && byId('customerIdType').value === 'sa-id') {
            byId('customerDateOfBirth').value = identityDetails.dateOfBirth;
            byId('customerGender').value = identityDetails.gender;
        }
    });
    byId('customerEmail').addEventListener('input', () => {
        const currentEmail = normalizeEmail(byId('customerEmail').value);
        if (verifiedRegistrationEmail && currentEmail !== verifiedRegistrationEmail) {
            verifiedRegistrationEmail = '';
            requestedRegistrationEmail = '';
            byId('customerEmailOtp').value = '';
            setEmailVerificationStatus('Email changed. Send and verify a new code before registering.');
        } else if (requestedRegistrationEmail && currentEmail !== requestedRegistrationEmail) {
            requestedRegistrationEmail = '';
            byId('customerEmailOtp').value = '';
            setEmailVerificationStatus('Email changed. Send a new verification code.');
        }
    });

    byId('sendCustomerEmailCode').addEventListener('click', async () => {
        const emailInput = byId('customerEmail');
        if (!emailInput.checkValidity()) {
            emailInput.reportValidity();
            return;
        }
        const email = normalizeEmail(emailInput.value);
        byId('sendCustomerEmailCode').disabled = true;
        setEmailVerificationStatus('Sending verification code...');
        try {
            await postAppsScript(APPS_SCRIPT_URL, { action: 'sendCreditCustomerOTP', email }, 'Could not send verification code.');
            requestedRegistrationEmail = email;
            verifiedRegistrationEmail = '';
            byId('customerEmailOtp').value = '';
            setEmailVerificationStatus('Code sent. It expires in 10 minutes.', 'success');
            byId('customerEmailOtp').focus();
        } catch (error) {
            setEmailVerificationStatus(error.message, 'error');
        } finally {
            byId('sendCustomerEmailCode').disabled = false;
        }
    });

    byId('verifyCustomerEmailCode').addEventListener('click', async () => {
        const email = normalizeEmail(byId('customerEmail').value);
        const otp = byId('customerEmailOtp').value.trim();
        if (!email || email !== requestedRegistrationEmail) {
            setEmailVerificationStatus('Send a code to this email address first.', 'error');
            return;
        }
        if (!/^\d{6}$/.test(otp)) {
            byId('customerEmailOtp').setCustomValidity('Enter the six-digit code from the email.');
            byId('customerEmailOtp').reportValidity();
            byId('customerEmailOtp').setCustomValidity('');
            return;
        }
        byId('verifyCustomerEmailCode').disabled = true;
        setEmailVerificationStatus('Verifying code...');
        try {
            await postAppsScript(APPS_SCRIPT_URL, { action: 'verifyCreditCustomerOTP', email, otp }, 'Email verification failed.');
            verifiedRegistrationEmail = email;
            setEmailVerificationStatus('Email verified. This address will receive saved credit details.', 'success');
        } catch (error) {
            setEmailVerificationStatus(error.message, 'error');
        } finally {
            byId('verifyCustomerEmailCode').disabled = false;
        }
    });

    byId('registrationForm').addEventListener('submit', event => {
        event.preventDefault();
        const name = byId('customerName').value.trim();
        const idNumber = normalizeId(byId('customerIdNumber').value);
        const idType = byId('customerIdType').value;
        const email = normalizeEmail(byId('customerEmail').value);
        const identityError = updateIdentityFeedback();
        if (!name) {
            byId('customerName').setCustomValidity('Enter the customer name shown on the document.');
            byId('customerName').reportValidity();
            return;
        }
        byId('customerName').setCustomValidity('');
        if (!email || email !== verifiedRegistrationEmail) {
            setEmailVerificationStatus('Verify this email before adding the customer to credit accounts.', 'error');
            byId('customerEmail').focus();
            return;
        }
        if (identityError) {
            byId('customerIdNumber').reportValidity();
            return;
        }
        const customers = getCustomers();
        if (customers.some(customer => normalizeId(customer.idNumber) === idNumber && (customer.idType || 'sa-id') === idType)) {
            setStatus('scanStatus', 'That identity document number is already registered.', 'error');
            byId('customerIdNumber').focus();
            return;
        }
        const customer = {
            id: Date.now(), name, idType, idNumber,
            dateOfBirth: byId('customerDateOfBirth').value,
            gender: byId('customerGender').value,
            phone: byId('customerPhone').value.trim(),
            email,
            emailVerified: true,
            emailVerifiedAt: new Date().toISOString(),
            address: byId('customerAddress').value.trim(),
            idPhoto: pendingIdPhoto || '',
            due: 0, deposit: 0, history: []
        };
        customers.push(customer);
        try {
            saveCustomers(customers);
        } catch {
            setStatus('scanStatus', 'Could not save this customer. The browser may be out of storage space; remove the photo or free local storage and try again.', 'error');
            return;
        }
        selectedCustomerId = String(customer.id);
        event.currentTarget.reset();
        pendingIdPhoto = '';
        byId('idPhotoPreview').classList.add('hidden');
        setStatus('scanStatus', `${name} was added to credit customers.`, 'success');
        render();
    });

    byId('registrationForm').addEventListener('reset', () => {
        pendingIdPhoto = '';
        verifiedRegistrationEmail = '';
        requestedRegistrationEmail = '';
        byId('idPhotoPreview').classList.add('hidden');
        byId('idImage').value = '';
        byId('customerEmailOtp').value = '';
        setEmailVerificationStatus('Verify the customer\'s email before creating the credit account.');
    });

    byId('idImage').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            pendingIdPhoto = await compressIdentityPhoto(file);
            byId('idPhotoPreview').classList.remove('hidden');
        } catch (error) {
            pendingIdPhoto = '';
            byId('idPhotoPreview').classList.add('hidden');
            setStatus('scanStatus', error.message || 'Could not prepare that image. Try another photo.', 'error');
            event.target.value = '';
            return;
        }
        try {
            if (!window.Tesseract) {
                setStatus('scanStatus', 'Photo is ready to save. ID text scanning is unavailable; enter the details manually.', 'error');
                return;
            }
            setStatus('scanStatus', 'Scanning the ID in this browser… keep this page open.');
            const result = await window.Tesseract.recognize(file, 'eng', {
                logger: progress => {
                    if (progress.status === 'recognizing text') {
                        const percent = Math.round((progress.progress || 0) * 100);
                        setStatus('scanStatus', `Reading ID text… ${percent}%`);
                    }
                }
            });
            const text = result.data.text || '';
            const idCandidates = (text.match(/(?:\d[\s-]*){13}/g) || [])
                .map(candidate => candidate.replace(/\D/g, ''))
                .filter(candidate => candidate.length === 13);
            const idCandidate = idCandidates.find(candidate => !validateIdentity('sa-id', candidate)) || idCandidates[0] || '';
            const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            const forenames = getOcrLabelValue(lines, 'forenames?|given names?');
            const surname = getOcrLabelValue(lines, 'surname');
            const names = getOcrLabelValue(lines, 'names?');
            if (idCandidate) {
                if (byId('customerIdType').value !== 'sa-id') {
                    byId('customerIdType').value = 'sa-id';
                    byId('customerIdType').dispatchEvent(new Event('change'));
                }
                byId('customerIdNumber').value = idCandidate;
                const identityDetails = getSouthAfricanIdDetails(idCandidate);
                if (identityDetails) {
                    byId('customerDateOfBirth').value = identityDetails.dateOfBirth;
                    byId('customerGender').value = identityDetails.gender;
                }
            }
            const scannedName = [forenames, surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || names;
            if (scannedName) byId('customerName').value = scannedName.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’ -]/g, '').replace(/\s+/g, ' ').trim();
            updateIdentityFeedback();
            const captured = Boolean(idCandidate || scannedName);
            setStatus('scanStatus', captured
                ? 'Scan complete. Name, ID number, date of birth and gender have been filled where readable. Verify them against the original ID; enter contact details manually.'
                : 'Photo is ready to save, but name and ID number were not detected. Enter the details manually.', captured ? 'success' : 'error');
            if (idCandidate) byId('customerPhone').focus();
            else byId('customerName').focus();
        } catch {
            setStatus('scanStatus', 'Photo is ready to save, but text scanning failed. Enter and verify the details manually.', 'error');
        } finally {
            event.target.value = '';
        }
    });

    byId('removeIdPhoto').addEventListener('click', () => {
        pendingIdPhoto = '';
        byId('idPhotoPreview').classList.add('hidden');
        setStatus('scanStatus', 'Selected ID photo removed.');
    });
    byId('accountDetail').addEventListener('click', event => {
        const customer = getSelectedCustomer();
        if (event.target.closest('[data-open-statement]')) {
            openCustomerStatement(customer);
            return;
        }
        if (!event.target.closest('[data-view-id-photo]') || !customer?.idPhoto) return;
        byId('identityImageView').src = customer.idPhoto;
        byId('identityImageModal').classList.remove('hidden');
        byId('identityImageModal').setAttribute('aria-hidden', 'false');
        document.body.classList.add('identity-image-open');
        byId('closeIdentityImage').focus();
    });
    byId('closeIdentityImage').addEventListener('click', closeIdentityImage);
    byId('identityImageModal').addEventListener('click', event => {
        if (event.target.matches('[data-close-identity-image]')) closeIdentityImage();
    });
    byId('closeCustomerStatement').addEventListener('click', closeCustomerStatement);
    byId('dismissCustomerStatement').addEventListener('click', closeCustomerStatement);
    byId('customerStatementModal').addEventListener('click', event => {
        if (event.target.matches('[data-close-statement]')) closeCustomerStatement();
    });

    byId('openOrderingCatalog').addEventListener('click', openOrderingCatalog);
    byId('closeOrderingCatalog').addEventListener('click', closeOrderingCatalog);
    byId('cancelOrderingCatalog').addEventListener('click', closeOrderingCatalog);
    byId('orderingCatalogModal').addEventListener('click', event => {
        if (event.target.matches('[data-close-ordering]')) closeOrderingCatalog();
    });
    byId('orderingCatalogSearch').addEventListener('input', renderOrderingCatalog);
    byId('orderingCatalogItems').addEventListener('change', event => {
        if (!event.target.matches('.ordering-checkbox')) return;
        const quantity = event.target.closest('.ordering-option').querySelector('.ordering-quantity');
        quantity.disabled = !event.target.checked;
        if (event.target.checked) quantity.focus();
    });
    byId('addSelectedOrderingItems').addEventListener('click', addSelectedOrderingItems);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !byId('customerStatementModal').classList.contains('hidden')) closeCustomerStatement();
        if (event.key === 'Escape' && !byId('identityImageModal').classList.contains('hidden')) closeIdentityImage();
        if (event.key === 'Escape' && !byId('orderingCatalogModal').classList.contains('hidden')) closeOrderingCatalog();
    });
    byId('creditCart').addEventListener('click', event => {
        const removeButton = event.target.closest('[data-remove-credit-item]');
        if (removeButton) removeCreditStockItem(Number(removeButton.dataset.removeCreditItem));
    });
    byId('ledgerCustomer').addEventListener('change', event => {
        selectedCustomerId = event.target.value;
        render();
    });

    byId('creditForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (savingCredit) return;
        const customers = getCustomers();
        const customer = getSelectedCustomer(customers);
        if (!customer) return setStatus('ledgerStatus', 'Register or select a customer account first.', 'error');
        if (!creditCart.length) return setStatus('ledgerStatus', 'Add at least one stock item before posting credit.', 'error');

        const stockItems = getStockItems();
        const stockUpdates = [];
        for (const cartItem of creditCart) {
            const stockItem = stockItems.find(item => String(item.id) === String(cartItem.stockItemId));
            if (!stockItem) return setStatus('ledgerStatus', `${cartItem.name} is no longer in stock records. Refresh and try again.`, 'error');
            const quantity = creditCart.filter(item => String(item.stockItemId) === String(cartItem.stockItemId)).reduce((sum, item) => sum + item.qty, 0);
            if (Number(stockItem.qty || 0) < quantity) return setStatus('ledgerStatus', `Not enough ${cartItem.name} remains in stock. Refresh and try again.`, 'error');
            if (!stockUpdates.some(item => String(item.stockItemId) === String(cartItem.stockItemId))) {
                stockUpdates.push({ stockItem, quantity });
            }
        }

        const principal = creditCart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
        if (!Number.isFinite(principal) || principal <= 0) return setStatus('ledgerStatus', 'Selected stock items must have a valid selling price.', 'error');
        const fee = Math.round(principal * SERVICE_FEE_RATE * 100) / 100;
        const total = Math.round((principal + fee) * 100) / 100;
        const timestamp = new Date().toISOString();
        const creditId = Date.now();
        const previousBalance = Number(customer.due || 0);
        const creditedItems = creditCart.map(item => ({ ...item }));
        const submitButton = byId('creditForm').querySelector('button[type="submit"]');
        savingCredit = true;
        submitButton.disabled = true;
        setStatus('ledgerStatus', 'Saving credit and updating stock...');
        const audit = getStockAudit();
        try {
            stockUpdates.forEach(({ stockItem, quantity }) => {
                stockItem.qty = Math.max(0, Number(stockItem.qty || 0) - quantity);
                stockItem.updatedAt = timestamp;
                audit.push({ id: Date.now() + Math.random(), itemId: stockItem.id, name: stockItem.name, barcode: stockItem.barcode || '', mode: 'sale', qty: quantity, remaining: stockItem.qty, timestamp });
            });
            localStorage.setItem('p3_stock_items', JSON.stringify(stockItems));
            localStorage.setItem('p3_stock_audit', JSON.stringify(audit));
            customer.due = Math.round((previousBalance + total) * 100) / 100;
            customer.history = Array.isArray(customer.history) ? customer.history : [];
            customer.history.push({ id: creditId, type: 'credit', timestamp, store: 'Credit account', principal, serviceFee: fee, total, paid: 0, items: creditedItems });
            saveCustomers(customers);
            byId('creditForm').reset();
            creditCart = [];
            render();

            const emailResult = await notifyCreditSaved({
                id: creditId,
                timestamp,
                customer: { name: customer.name, email: customer.email },
                items: creditedItems,
                principal,
                fee,
                total,
                previousBalance,
                newBalance: customer.due
            });
            const deliveryNotes = [
                ...emailResult.failed,
                ...emailResult.missingRoles.map(message => `not sent: ${message}`)
            ];
            const deliveredTo = emailResult.sent.length ? `Email sent to ${emailResult.sent.join(' and ')}.` : 'Credit details were not emailed.';
            setStatus('ledgerStatus', `Credit ${creditId} saved for ${customer.name}. ${deliveredTo}${deliveryNotes.length ? ` ${deliveryNotes.join('; ')}.` : ''}`, deliveryNotes.length ? 'error' : 'success');
        } catch (error) {
            setStatus('ledgerStatus', `Credit could not be fully saved. Check this customer's balance and stock before retrying. ${error.message || ''}`, 'error');
        } finally {
            savingCredit = false;
            submitButton.disabled = false;
        }
    });

    byId('paymentForm').addEventListener('submit', event => {
        event.preventDefault();
        const customers = getCustomers();
        const customer = getSelectedCustomer(customers);
        const amount = Number(byId('paymentAmount').value);
        if (!customer) return setStatus('ledgerStatus', 'Select a customer account first.', 'error');
        if (!Number.isFinite(amount) || amount <= 0) return setStatus('ledgerStatus', 'Enter a payment greater than zero.', 'error');
        const previousDue = Number(customer.due || 0);
        customer.due = Math.max(0, Math.round((previousDue - amount) * 100) / 100);
        if (amount > previousDue) customer.deposit = Math.round((Number(customer.deposit || 0) + amount - previousDue) * 100) / 100;
        customer.history = Array.isArray(customer.history) ? customer.history : [];
        customer.history.push({ id: Date.now(), type: 'payment', timestamp: new Date().toISOString(), store: 'Credit payment', amount, paid: amount, total: amount, items: [] });
        saveCustomers(customers);
        byId('paymentForm').reset();
        setStatus('ledgerStatus', `${money(amount)} payment recorded for ${customer.name}.`, 'success');
        render();
    });

    byId('customerSearch').addEventListener('input', render);
    byId('customerList').addEventListener('click', event => {
        const row = event.target.closest('[data-customer-id]');
        if (!row) return;
        selectedCustomerId = row.dataset.customerId;
        render();
    });
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY) render();
        if (event.key === 'p3_stock_items' || event.key === 'p3_auto_prices') {
            renderCreditStock();
            if (!byId('orderingCatalogModal').classList.contains('hidden')) renderOrderingCatalog();
        }
    });
    render();
})();