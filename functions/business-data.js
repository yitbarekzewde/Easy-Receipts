"use strict";

function parseBusinessArray(value, key) {
    if (value == null) return [];
    if (typeof value !== "string") {
        throw new Error(`Saved ${key} data has an invalid format.`);
    }

    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`Saved ${key} data is not valid JSON.`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`Saved ${key} data is not a list.`);
    }
    if (parsed.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
        throw new Error(`Saved ${key} data contains an invalid entry.`);
    }
    return parsed;
}

function customerSummary(customer) {
    return {
        id: customer.id == null ? "" : String(customer.id),
        name: String(customer.name || ""),
        phone: String(customer.phone || ""),
        email: String(customer.email || ""),
        due: Number.isFinite(Number(customer.due)) ? Number(customer.due) : 0,
        deposit: Number.isFinite(Number(customer.deposit)) ? Number(customer.deposit) : 0
    };
}

function receiptSummary(receipt) {
    const items = Array.isArray(receipt.items)
        ? receipt.items
        : (Array.isArray(receipt.cartSnapshot) ? receipt.cartSnapshot : receipt.cart);
    return {
        id: String(receipt.id == null ? "" : receipt.id),
        receiptRef: String(receipt.receiptRef || (receipt.id == null ? "" : `ER-${receipt.id}`)),
        createdAt: String(receipt.createdAt || ""),
        timestamp: String(receipt.timestamp || ""),
        customer: String(receipt.client || receipt.customer || ""),
        store: String(receipt.store || ""),
        total: Number.isFinite(Number(receipt.total)) ? Number(receipt.total) : 0,
        paid: Number.isFinite(Number(receipt.paid)) ? Number(receipt.paid) : 0,
        items: Array.isArray(items) ? items.filter(item => item && typeof item === "object").map(item => ({
            name: String(item.name || "Item"),
            qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0,
            price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0
        })) : []
    };
}

function buildBusinessData(customerRecords, receiptRecords) {
    const customers = customerRecords.map(customerSummary);
    const receipts = new Map();
    receiptRecords.forEach(record => {
        const receipt = receiptSummary(record);
        const key = receipt.id || receipt.receiptRef || `${receipt.timestamp}|${receipt.store}|${receipt.total}`;
        if (key) receipts.set(key, receipt);
    });

    customerRecords.forEach(customer => {
        (Array.isArray(customer.history) ? customer.history : []).forEach(record => {
            if (record.type === "payment") return;
            const receipt = receiptSummary(record);
            const key = receipt.id || receipt.receiptRef || `${receipt.timestamp}|${receipt.store}|${receipt.total}`;
            if (!key) return;
            const existing = receipts.get(key);
            if (existing) {
                if (!existing.items.length && receipt.items.length) existing.items = receipt.items;
            } else {
                receipts.set(key, receipt);
            }
        });
    });

    return {
        customers,
        receipts: Array.from(receipts.values()).sort((left, right) =>
            (Date.parse(right.createdAt || right.timestamp) || 0) - (Date.parse(left.createdAt || left.timestamp) || 0))
    };
}

function timestampOrNull(value) {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function toDatabaseRows(uid, account, businessData) {
    return {
        account: {
            uid,
            email: account.email || null,
            display_name: account.displayName || null,
            disabled: Boolean(account.disabled),
            created_at: timestampOrNull(account.createdAt),
            last_sign_in_at: timestampOrNull(account.lastSignInAt),
            synced_at: new Date().toISOString()
        },
        customers: businessData.customers.map((customer, index) => ({
            customer_key: String(customer.id != null && String(customer.id) !== ""
                ? customer.id
                : `legacy-${index}-${String(customer.name || "customer").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).slice(0, 200),
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            due: customer.due,
            deposit: customer.deposit
        })),
        receipts: businessData.receipts.map((receipt, index) => ({
            receipt_key: String(receipt.id || receipt.receiptRef || `legacy-${index}`).slice(0, 200),
            receipt_ref: receipt.receiptRef || null,
            created_at: timestampOrNull(receipt.createdAt),
            timestamp_text: receipt.timestamp || null,
            customer: receipt.customer || null,
            store: receipt.store || null,
            total: receipt.total,
            paid: receipt.paid,
            items: receipt.items
        }))
    };
}

module.exports = { buildBusinessData, parseBusinessArray, toDatabaseRows };
