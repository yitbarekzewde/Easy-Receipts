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

module.exports = { buildBusinessData, parseBusinessArray };
