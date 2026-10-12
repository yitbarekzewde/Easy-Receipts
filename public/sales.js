(() => {
    const readArray = key => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value : [];
        } catch (error) {
            return [];
        }
    };
    const readObject = key => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) {
            return {};
        }
    };
    const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const money = value => `R ${Number(value || 0).toFixed(2)}`;

    let stockItems = readArray('p3_stock_items');
    const boxMappings = readArray('p3_box_barcodes');
    const autoPrices = readObject('p3_auto_prices');
    let customers = readArray('p3_saved_customers');
    let cart = readArray('p3_active_cart').filter(item => item.name && item.name !== 'Sample Product');
    let products = [];
    let cameraStream = null;
    let detector = null;
    let cameraPendingProduct = null;
    let cameraPendingDefaultQty = 1;
    let currentReceipt = null;

    const elements = Object.fromEntries([
        'posStore', 'posCustomer', 'customerBalance', 'customerForm', 'newCustomerName', 'newCustomerIdType', 'newCustomerIdNumber', 'newCustomerIdStatus', 'newCustomerPhone', 'newCustomerEmail',
        'showCustomerForm', 'saveCustomer', 'posBarcodeInput', 'addBarcode', 'toggleCamera', 'stopCamera', 'cameraPanel',
        'cameraPreview', 'scanStatus', 'productSearch', 'productCount', 'productGrid', 'cartCount', 'cartLines', 'emptyCart',
        'clearCart', 'recentPanel', 'showRecentSales', 'sheetBackdrop',
        'totalValue', 'cashPaid', 'onlinePaid', 'balanceLabel', 'balanceValue', 'completeSale', 'printReceipt', 'checkoutStatus',
        'recentSales', 'printReceiptContent', 'cameraQtyPanel', 'cameraQtyLabel', 'cameraQtyInput', 'cameraQtyConfirm', 'cameraQtySkip'
    ].map(id => [id, document.getElementById(id)]));

    function priceFor(name, fallback = 0) {
        const price = autoPrices[String(name || '').trim().toLowerCase()]?.price;
        return Number(price) > 0 ? Number(price) : Number(fallback || 0);
    }

    function buildProducts() {
        const list = stockItems.map(item => ({
            id: String(item.id ?? item.barcode ?? item.name),
            stockItemId: item.id,
            barcode: String(item.barcode || '').trim(),
            caseBarcode: String(item.caseBarcode || '').trim(),
            unitsPerBox: Math.max(1, Math.round(Number(item.unitsPerBox) || 1)),
            name: String(item.name || '').trim(),
            category: String(item.category || 'Stock'),
            price: priceFor(item.name, item.sellPrice),
            stockQty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : null
        })).filter(item => item.name);

        boxMappings.forEach(mapping => {
            const existing = list.find(item => item.name.toLowerCase() === String(mapping.name || '').trim().toLowerCase());
            if (existing) {
                existing.caseBarcode ||= String(mapping.barcode || '').trim();
                existing.unitsPerBox = Math.max(1, Math.round(Number(mapping.unitsPerBox) || 1));
            } else if (mapping.name) {
                list.push({
                    id: `box-${String(mapping.barcode || mapping.name)}`,
                    stockItemId: null,
                    barcode: '',
                    caseBarcode: String(mapping.barcode || '').trim(),
                    unitsPerBox: Math.max(1, Math.round(Number(mapping.unitsPerBox) || 1)),
                    name: String(mapping.name).trim(),
                    category: 'Box barcode',
                    price: priceFor(mapping.name),
                    stockQty: null
                });
            }
        });

        Object.entries(autoPrices).forEach(([key, item]) => {
            const name = String(item?.originalName || '').trim();
            if (name && !list.some(product => product.name.toLowerCase() === name.toLowerCase())) {
                list.push({ id: `price-${key}`, stockItemId: null, barcode: '', caseBarcode: '', unitsPerBox: 1, name, category: 'Other', price: Number(item.price) || 0, stockQty: null });
            }
        });
        return list.sort((left, right) => left.name.localeCompare(right.name));
    }

    function persistCart() {
        if (cart.length) localStorage.setItem('p3_active_cart', JSON.stringify(cart));
        else localStorage.removeItem('p3_active_cart');
    }

    function setScanMessage(message, type = '') {
        elements.scanStatus.textContent = message;
        elements.scanStatus.className = `scan-status${type ? ` ${type}` : ''}`;
    }

    function setCheckoutMessage(message, type = '') {
        elements.checkoutStatus.textContent = message;
        elements.checkoutStatus.className = `checkout-status${type ? ` ${type}` : ''}`;
    }

    function renderStores() {
        const stores = readArray('p3_saved_stores');
        const values = stores.length ? stores : ['My Store'];
        elements.posStore.innerHTML = values.map(store => `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`).join('');
    }

    function renderCustomers(selectedId = elements.posCustomer.value) {
        customers = readArray('p3_saved_customers');
        elements.posCustomer.innerHTML = '<option value="">Choose a customer</option>' + customers.map(customer => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`).join('');
        if (selectedId && customers.some(customer => String(customer.id) === String(selectedId))) elements.posCustomer.value = String(selectedId);
        renderCustomerBalance();
    }

    function renderCustomerBalance() {
        const customer = customers.find(item => String(item.id) === elements.posCustomer.value);
        if (!customer) {
            elements.customerBalance.textContent = customers.length ? '' : 'No saved customers yet. Add one to attach this sale to a customer.';
            return;
        }
        const due = Number(customer.due || 0);
        const deposit = Number(customer.deposit || 0);
        elements.customerBalance.textContent = due > 0 ? `Outstanding balance: ${money(due)}` : deposit > 0 ? `Customer credit: ${money(deposit)}` : 'Customer account is balanced.';
    }

    function renderProducts() {
        products = buildProducts();
        const query = elements.productSearch.value.trim().toLowerCase();
        const filtered = products.filter(product => !query || `${product.name} ${product.category} ${product.barcode} ${product.caseBarcode}`.toLowerCase().includes(query));
        elements.productCount.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;
        elements.productGrid.innerHTML = filtered.length ? filtered.map(product => `
            <button class="product-card" type="button" data-product-id="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.name)} to cart">
                <span class="product-name">${escapeHtml(product.name)}</span>
                <span class="product-meta"><span>${escapeHtml(product.category)}${product.stockQty === null ? '' : ` · ${product.stockQty} in stock`}</span><strong class="product-price">${money(product.price)}</strong></span>
            </button>`).join('') : '<div class="catalog-empty">No products found. Add a product in stock control or save a box barcode.</div>';
    }

    function renderCart() {
        const count = cart.reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
        elements.cartCount.textContent = String(count);
        elements.emptyCart.classList.toggle('hidden', cart.length > 0);
        elements.cartLines.innerHTML = cart.map((item, index) => `
            <article class="cart-line">
                <div>
                    <div class="cart-line-name">${escapeHtml(item.name)}</div>
                    <div class="cart-line-sub">${money(item.price)} each</div>
                    <div class="line-controls">
                        <button class="qty-button" type="button" data-cart-action="decrease" data-cart-index="${index}" aria-label="Decrease ${escapeHtml(item.name)} quantity"><i class="fas fa-minus" aria-hidden="true"></i></button>
                        <span class="line-quantity">${Math.max(1, Number(item.qty) || 1)}</span>
                        <button class="qty-button" type="button" data-cart-action="increase" data-cart-index="${index}" aria-label="Increase ${escapeHtml(item.name)} quantity"><i class="fas fa-plus" aria-hidden="true"></i></button>
                        <button class="remove-line" type="button" data-cart-action="remove" data-cart-index="${index}" aria-label="Remove ${escapeHtml(item.name)}"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>
                    </div>
                </div>
                <strong class="cart-line-total">${money(Number(item.price || 0) * Number(item.qty || 0))}</strong>
            </article>`).join('');
        persistCart();
        updateTotals();
    }

    function getTotals() {
        const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
        const total = subtotal;
        const cash = Math.max(0, Number(elements.cashPaid.value) || 0);
        const online = Math.max(0, Number(elements.onlinePaid.value) || 0);
        return { subtotal, total, cash, online, paid: cash + online, balance: cash + online - total };
    }

    function updateTotals() {
        const totals = getTotals();
        elements.totalValue.textContent = money(totals.total);
        const isOverpaid = totals.balance > 0.005;
        elements.balanceLabel.textContent = isOverpaid ? 'Change due' : 'Remaining';
        elements.balanceValue.textContent = money(Math.abs(totals.balance));
        elements.balanceValue.parentElement.classList.toggle('overpaid', isOverpaid);
    }

    function addProduct(product, quantity = 1) {
        const existing = cart.find(item => String(item.name || '').toLowerCase() === product.name.toLowerCase());
        if (existing) {
            existing.qty = Number(existing.qty || 0) + quantity;
            existing.price = Number(product.price || existing.price || 0);
            existing.stockItemId = product.stockItemId ?? existing.stockItemId;
        } else {
            cart.push({
                id: Math.floor(Date.now() + Math.random() * 1000),
                stockItemId: product.stockItemId ?? null,
                barcode: product.barcode || product.caseBarcode || '',
                name: product.name,
                price: Number(product.price || 0),
                qty: quantity
            });
        }
        renderCart();
        setScanMessage(`Added ${quantity} x ${product.name}.`, 'success');
    }

    function scanBarcode(value, fromCamera = false) {
        const code = String(value || '').trim().toLowerCase();
        if (!code) {
            setScanMessage('Scan or enter a barcode first.', 'error');
            return;
        }
        products = buildProducts();
        const product = products.find(item => item.barcode && item.barcode.toLowerCase() === code)
            || products.find(item => item.caseBarcode && item.caseBarcode.toLowerCase() === code);
        if (!product) {
            setScanMessage('Barcode not found. Add it to a stock item or save its box barcode first.', 'error');
            elements.posBarcodeInput.select();
            return;
        }
        const isBox = Boolean(product.caseBarcode && product.caseBarcode.toLowerCase() === code);
        if (fromCamera) {
            promptCameraQuantity(product, isBox ? product.unitsPerBox : 1);
            return;
        }
        addProduct(product, isBox ? product.unitsPerBox : 1);
        elements.posBarcodeInput.value = '';
        elements.posBarcodeInput.focus();
    }

    function promptCameraQuantity(product, defaultQty) {
        cameraPendingProduct = product;
        cameraPendingDefaultQty = Math.max(1, Number(defaultQty) || 1);
        elements.cameraQtyLabel.textContent = product.name;
        elements.cameraQtyInput.value = cameraPendingDefaultQty;
        elements.cameraQtyPanel.classList.remove('hidden');
        setScanMessage(`Found ${product.name}. Enter the quantity.`);
        elements.cameraQtyInput.focus();
        elements.cameraQtyInput.select();
    }

    function resumeCameraScan() {
        cameraPendingProduct = null;
        elements.cameraQtyPanel.classList.add('hidden');
        if (cameraStream) {
            setScanMessage('Ready for the next barcode.');
            startDetectLoop();
        }
    }

    function confirmCameraQuantity() {
        if (!cameraPendingProduct) return;
        const quantity = Number(elements.cameraQtyInput.value);
        if (!Number.isInteger(quantity) || quantity < 1) {
            setScanMessage('Enter a whole quantity of 1 or more.', 'error');
            elements.cameraQtyInput.focus();
            return;
        }
        addProduct(cameraPendingProduct, quantity);
        resumeCameraScan();
    }

    function updateCartLine(index, action) {
        const item = cart[index];
        if (!item) return;
        if (action === 'remove') cart.splice(index, 1);
        if (action === 'increase') item.qty = Number(item.qty || 0) + 1;
        if (action === 'decrease') {
            item.qty = Number(item.qty || 0) - 1;
            if (item.qty < 1) cart.splice(index, 1);
        }
        renderCart();
    }

    function openSheet(sheet) {
        [elements.customerForm, elements.recentPanel].forEach(panel => panel.classList.toggle('hidden', panel !== sheet));
        elements.sheetBackdrop.classList.toggle('hidden', !sheet);
    }

    function showCustomerForm(show) {
        openSheet(show ? elements.customerForm : null);
        if (show) elements.newCustomerName.focus();
    }

    function toggleRecentSales() {
        openSheet(elements.recentPanel.classList.contains('hidden') ? elements.recentPanel : null);
    }

    function normalizeId(value) {
        return String(value || '').replace(/\s/g, '').trim().toUpperCase();
    }

    function validateIdentity(type, value) {
        const identity = normalizeId(value);
        if (!identity) return 'An ID number or passport number is required.';
        if (type === 'passport') {
            return /^[A-Z0-9]{5,20}$/.test(identity) ? '' : 'Enter a passport number using 5 to 20 letters or numbers.';
        }
        if (!/^\d{13}$/.test(identity)) return 'A South African ID must contain exactly 13 digits.';
        const yearPart = Number(identity.slice(0, 2));
        const year = yearPart <= new Date().getFullYear() % 100 ? 2000 + yearPart : 1900 + yearPart;
        const month = Number(identity.slice(2, 4));
        const day = Number(identity.slice(4, 6));
        const birthDate = new Date(year, month - 1, day);
        if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day || birthDate > new Date()) {
            return 'The birth date in this South African ID is not valid.';
        }
        if (!['0', '1'].includes(identity[10])) return 'The citizenship digit in this South African ID is not valid.';
        const digits = [...identity].map(Number);
        const oddSum = digits.slice(0, 12).filter((_, index) => index % 2 === 0).reduce((sum, digit) => sum + digit, 0);
        const doubled = digits.slice(0, 12).filter((_, index) => index % 2 === 1).join('') * 2;
        const evenSum = String(doubled).split('').reduce((sum, digit) => sum + Number(digit), 0);
        return (10 - ((oddSum + evenSum) % 10)) % 10 === digits[12] ? '' : 'The South African ID checksum is invalid. Check the number against the document.';
    }

    function updateNewCustomerIdFeedback() {
        const type = elements.newCustomerIdType.value;
        const value = elements.newCustomerIdNumber.value;
        const message = validateIdentity(type, value);
        elements.newCustomerIdStatus.textContent = value.trim() ? (message || 'Identity number looks valid.') : '';
        elements.newCustomerIdStatus.dataset.state = value.trim() ? (message ? 'error' : 'success') : '';
        return message;
    }

    function saveCustomer() {
        const name = elements.newCustomerName.value.trim();
        if (!name) {
            elements.newCustomerName.focus();
            return;
        }
        const idType = elements.newCustomerIdType.value;
        const idNumber = normalizeId(elements.newCustomerIdNumber.value);
        const idError = validateIdentity(idType, idNumber);
        if (idError) {
            updateNewCustomerIdFeedback();
            elements.newCustomerIdNumber.focus();
            return;
        }
        const existing = customers.find(customer => customer.name.toLowerCase() === name.toLowerCase());
        const idOwner = customers.find(customer => normalizeId(customer.idNumber) === idNumber && (customer.idType || 'sa-id') === idType);
        if (idOwner && idOwner !== existing) {
            elements.newCustomerIdStatus.textContent = `This ID is already registered to ${idOwner.name}.`;
            elements.newCustomerIdStatus.dataset.state = 'error';
            elements.newCustomerIdNumber.focus();
            return;
        }
        let customer = existing;
        if (!customer) {
            customer = { id: Date.now(), name, idType, idNumber, phone: elements.newCustomerPhone.value.trim(), email: elements.newCustomerEmail.value.trim(), due: 0, deposit: 0, history: [] };
            customers.push(customer);
            localStorage.setItem('p3_saved_customers', JSON.stringify(customers));
        } else if (!existing.idNumber) {
            existing.idType = idType;
            existing.idNumber = idNumber;
            localStorage.setItem('p3_saved_customers', JSON.stringify(customers));
        }
        renderCustomers(customer.id);
        elements.newCustomerName.value = '';
        elements.newCustomerIdNumber.value = '';
        elements.newCustomerIdType.value = 'sa-id';
        elements.newCustomerIdStatus.textContent = '';
        elements.newCustomerPhone.value = '';
        elements.newCustomerEmail.value = '';
        showCustomerForm(false);
    }

    function updateCustomerLedger(customer, receipt) {
        const difference = receipt.paid - receipt.total;
        customer.due = Number(customer.due || 0) + Math.max(0, -difference);
        customer.deposit = Number(customer.deposit || 0) + Math.max(0, difference);
        if (customer.deposit > 0 && customer.due > 0) {
            const offset = Math.min(customer.deposit, customer.due);
            customer.deposit -= offset;
            customer.due -= offset;
        }
        customer.history = Array.isArray(customer.history) ? customer.history : [];
        customer.history.push({
            id: receipt.id,
            timestamp: receipt.timestamp,
            store: receipt.store,
            total: receipt.total,
            paid: receipt.paid,
            items: receipt.items
        });
    }

    function applyStockSale(items) {
        stockItems = readArray('p3_stock_items');
        items.forEach(sold => {
            if (sold.stockItemId === null || sold.stockItemId === undefined) return;
            const stock = stockItems.find(item => String(item.id) === String(sold.stockItemId));
            if (stock) {
                stock.qty = Math.max(0, Number(stock.qty || 0) - Number(sold.qty || 0));
                stock.updatedAt = new Date().toISOString();
            }
        });
        localStorage.setItem('p3_stock_items', JSON.stringify(stockItems));
    }

    function completeSale() {
        if (!cart.length) {
            setCheckoutMessage('Add at least one product before completing the sale.', 'error');
            return;
        }
        const customer = customers.find(item => String(item.id) === elements.posCustomer.value);
        if (!customer) {
            setCheckoutMessage('Choose or add a customer for this receipt.', 'error');
            elements.posCustomer.focus();
            return;
        }

        const totals = getTotals();
        const id = Date.now();
        const timestamp = new Date().toLocaleString();
        const store = elements.posStore.value || 'My Store';
        const items = cart.map(item => ({ ...item }));
        const receipt = {
            id,
            timestamp,
            store,
            client: customer.name,
            paid: totals.paid,
            total: totals.total,
            cash: totals.cash,
            online: totals.online,
            cartSnapshot: items,
            cashier: window.easyReceiptStaff?.name || '',
            image: ''
        };

        const snapshots = readArray('p3_pos_snapshots');
        snapshots.push(receipt);
        localStorage.setItem('p3_pos_snapshots', JSON.stringify(snapshots));
        updateCustomerLedger(customer, { id, timestamp, store, total: totals.total, paid: totals.paid, items });
        localStorage.setItem('p3_saved_customers', JSON.stringify(customers));
        applyStockSale(items);
        currentReceipt = { ...receipt, items, subtotal: totals.subtotal, change: Math.max(0, totals.balance), due: Math.max(0, -totals.balance) };
        renderPrintReceipt(currentReceipt);

        cart = [];
        persistCart();
        renderCart();
        elements.cashPaid.value = '';
        elements.onlinePaid.value = '';
        updateTotals();
        renderCustomers(customer.id);
        renderProducts();
        renderRecentSales();
        elements.printReceipt.classList.remove('hidden');
        setCheckoutMessage(`Sale completed for ${customer.name}. Receipt ${id}.`);
    }

    function renderPrintReceipt(receipt) {
        const rows = receipt.items.map(item => `<tr><td>${escapeHtml(item.name)} × ${Number(item.qty || 0)}</td><td>${money(Number(item.price || 0) * Number(item.qty || 0))}</td></tr>`).join('');
        elements.printReceiptContent.innerHTML = `
            <div class="receipt-print-header"><h1>${escapeHtml(receipt.store)}</h1><p>Sales receipt</p><p>${escapeHtml(receipt.timestamp)}</p><p>Receipt #${escapeHtml(receipt.id)}</p><p>Customer: ${escapeHtml(receipt.client)}</p></div>
            <table class="receipt-print-table"><thead><tr><th>Item</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="receipt-print-total"><span>Total</span><span>${money(receipt.total)}</span></div>
            <p>Paid: ${money(receipt.paid)}${receipt.change ? ` · Change: ${money(receipt.change)}` : ''}</p>
            ${receipt.due ? `<p>Amount due: ${money(receipt.due)}</p>` : ''}
            <p style="text-align:center;margin-top:22px">Thank you</p>`;
    }

    function renderRecentSales() {
        const snapshots = readArray('p3_pos_snapshots').slice(-4).reverse();
        elements.recentSales.innerHTML = snapshots.length ? snapshots.map(sale => `
            <button class="recent-sale" type="button" data-customer-name="${escapeHtml(sale.client || 'Customer')}" aria-expanded="false">
                <span class="recent-sale-main"><strong>${escapeHtml(sale.client || 'Customer')}</strong><span>${escapeHtml(sale.timestamp || '')}</span></span>
                <span class="recent-sale-amount"><strong>${money(sale.total)}</strong><i class="fas fa-chevron-down" aria-hidden="true"></i></span>
            </button>
            <div class="recent-customer-details hidden"></div>`).join('') : '<p class="recent-empty">Completed sales will appear here.</p>';
    }

    function getCustomerPurchases(customerName) {
        const key = String(customerName || '').trim().toLowerCase();
        const customer = readArray('p3_saved_customers').find(item => String(item.name || '').trim().toLowerCase() === key);
        const purchases = new Map();
        const addPurchase = (entry, itemList) => {
            const timestamp = entry.timestamp || '';
            const fallbackId = `${timestamp}|${entry.store || ''}|${entry.total || 0}`;
            const id = String(entry.id ?? fallbackId);
            const items = Array.isArray(itemList) ? itemList : [];
            const existing = purchases.get(id);
            if (existing) {
                if (!existing.items.length && items.length) existing.items = items;
                return;
            }
            purchases.set(id, {
                id,
                timestamp,
                store: entry.store || 'Store',
                total: Number(entry.total || 0),
                paid: Number(entry.paid || 0),
                items
            });
        };

        readArray('p3_pos_snapshots')
            .filter(entry => String(entry.client || '').trim().toLowerCase() === key)
            .forEach(entry => addPurchase(entry, entry.items || entry.cartSnapshot || entry.cart));
        (Array.isArray(customer?.history) ? customer.history : []).forEach(entry => addPurchase(entry, entry.items || entry.cartSnapshot || entry.cart));

        return [...purchases.values()].sort((left, right) => {
            const leftTime = Date.parse(left.timestamp) || 0;
            const rightTime = Date.parse(right.timestamp) || 0;
            return rightTime - leftTime;
        });
    }

    function renderCustomerPurchaseHistory(customerName) {
        const purchases = getCustomerPurchases(customerName);
        const customer = readArray('p3_saved_customers').find(item => String(item.name || '').trim().toLowerCase() === String(customerName || '').trim().toLowerCase());
        const lifetimeTotal = purchases.reduce((sum, purchase) => sum + purchase.total, 0);
        const purchaseDetails = purchases.length ? purchases.map(purchase => {
            const itemRows = purchase.items.length ? purchase.items.map(item => {
                const quantity = Number(item.qty || 0);
                const price = Number(item.price || 0);
                return `<div class="purchase-item"><span>${escapeHtml(item.name || 'Item')} <small>× ${quantity} at ${money(price)}</small></span><strong>${money(quantity * price)}</strong></div>`;
            }).join('') : '<p class="purchase-no-items">Item details were not saved for this receipt.</p>';
            return `
                <article class="customer-purchase">
                    <div class="purchase-heading"><span><strong>${escapeHtml(purchase.timestamp || 'Date unavailable')}</strong><small>${escapeHtml(purchase.store)}</small></span><strong>${money(purchase.total)}</strong></div>
                    <div class="purchase-items">${itemRows}</div>
                    <div class="purchase-payment"><span>Receipt ${escapeHtml(purchase.id)}</span><span>Paid ${money(purchase.paid)}</span></div>
                </article>`;
        }).join('') : '<p class="purchase-no-items">No saved purchase history for this customer.</p>';
        const balance = customer ? `<span class="history-balance">${Number(customer.due || 0) > 0 ? `Balance due ${money(customer.due)}` : Number(customer.deposit || 0) > 0 ? `Store credit ${money(customer.deposit)}` : 'Account balanced'}</span>` : '';

        return `
            <div class="customer-history-heading"><span><strong>${escapeHtml(customerName)}</strong><small>${purchases.length} purchase${purchases.length === 1 ? '' : 's'} · lifetime ${money(lifetimeTotal)}</small></span>${balance}</div>
            <div class="customer-purchase-list">${purchaseDetails}</div>`;
    }

    async function startCamera() {
        if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
            setScanMessage('Camera scanning is not supported here. Use a USB or Bluetooth barcode scanner.', 'error');
            return;
        }
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            elements.cameraPreview.srcObject = cameraStream;
            elements.cameraPanel.classList.remove('hidden');
            detector = new BarcodeDetector({ formats: ['code_128', 'ean_13', 'qr_code', 'upc_a', 'code_39'] });
            setScanMessage('Camera ready. Hold a barcode in view.');
            startDetectLoop();
        } catch (error) {
            setScanMessage('Camera access was blocked. Use a USB or Bluetooth barcode scanner.', 'error');
        }
    }

    function startDetectLoop() {
        const stream = cameraStream;
        const detect = async () => {
            if (!cameraStream || cameraStream !== stream || cameraPendingProduct) return;
            try {
                const matches = await detector.detect(elements.cameraPreview);
                if (matches.length && cameraStream === stream) {
                    elements.posBarcodeInput.value = matches[0].rawValue;
                    scanBarcode(matches[0].rawValue, true);
                    if (cameraPendingProduct) return;
                    await new Promise(resolve => setTimeout(resolve, 1200));
                }
            } catch (error) {
                console.warn('Camera barcode scan failed:', error);
            }
            if (cameraStream === stream && !cameraPendingProduct) requestAnimationFrame(detect);
        };
        detect();
    }

    function stopCamera() {
        if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        cameraPendingProduct = null;
        elements.cameraQtyPanel.classList.add('hidden');
        elements.cameraPreview.srcObject = null;
        elements.cameraPanel.classList.add('hidden');
    }

    function init() {
        renderStores();
        renderCustomers();
        renderProducts();
        renderCart();
        renderRecentSales();

        elements.posBarcodeInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                scanBarcode(elements.posBarcodeInput.value);
            }
        });
        elements.addBarcode.addEventListener('click', () => scanBarcode(elements.posBarcodeInput.value));
        elements.toggleCamera.addEventListener('click', startCamera);
        elements.stopCamera.addEventListener('click', stopCamera);
        elements.cameraQtyConfirm.addEventListener('click', confirmCameraQuantity);
        elements.cameraQtySkip.addEventListener('click', resumeCameraScan);
        elements.cameraQtyInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); confirmCameraQuantity(); }
            if (event.key === 'Escape') resumeCameraScan();
        });
        elements.productSearch.addEventListener('input', renderProducts);
        elements.productGrid.addEventListener('click', event => {
            const button = event.target.closest('[data-product-id]');
            if (!button) return;
            const product = products.find(item => item.id === button.dataset.productId);
            if (product) addProduct(product);
        });
        elements.cartLines.addEventListener('click', event => {
            const button = event.target.closest('[data-cart-action]');
            if (button) updateCartLine(Number(button.dataset.cartIndex), button.dataset.cartAction);
        });
        elements.clearCart.addEventListener('click', () => {
            cart = [];
            renderCart();
            setCheckoutMessage('Cart cleared.');
        });
        [elements.cashPaid, elements.onlinePaid].forEach(input => input.addEventListener('input', updateTotals));
        elements.posCustomer.addEventListener('change', renderCustomerBalance);
        elements.showCustomerForm.addEventListener('click', () => showCustomerForm(elements.customerForm.classList.contains('hidden')));
        elements.showRecentSales.addEventListener('click', toggleRecentSales);
        elements.newCustomerIdNumber.addEventListener('input', updateNewCustomerIdFeedback);
        elements.newCustomerIdType.addEventListener('change', () => {
            const isPassport = elements.newCustomerIdType.value === 'passport';
            elements.newCustomerIdNumber.placeholder = isPassport ? 'Passport number' : '13-digit ID number';
            elements.newCustomerIdNumber.inputMode = isPassport ? 'text' : 'numeric';
            updateNewCustomerIdFeedback();
        });
        elements.sheetBackdrop.addEventListener('click', () => openSheet(null));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !elements.sheetBackdrop.classList.contains('hidden')) openSheet(null);
        });
        elements.saveCustomer.addEventListener('click', saveCustomer);
        elements.newCustomerName.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveCustomer();
            }
        });
        elements.completeSale.addEventListener('click', completeSale);
        elements.printReceipt.addEventListener('click', () => { if (currentReceipt) window.print(); });
        elements.recentSales.addEventListener('click', event => {
            const button = event.target.closest('[data-customer-name]');
            if (!button) return;
            const details = button.nextElementSibling;
            const opening = details.classList.contains('hidden');
            elements.recentSales.querySelectorAll('.recent-customer-details').forEach(panel => panel.classList.add('hidden'));
            elements.recentSales.querySelectorAll('[data-customer-name]').forEach(row => row.setAttribute('aria-expanded', 'false'));
            if (opening) {
                details.innerHTML = renderCustomerPurchaseHistory(button.dataset.customerName);
                details.classList.remove('hidden');
                button.setAttribute('aria-expanded', 'true');
            }
        });
        window.addEventListener('beforeunload', stopCamera);
    }

    document.addEventListener('DOMContentLoaded', init);
})();