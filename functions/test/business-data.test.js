"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBusinessData, parseBusinessArray, toDatabaseRows } = require("../business-data");

test("parses saved customer and receipt arrays and rejects invalid stored values", () => {
    assert.deepEqual(parseBusinessArray('[{"name":"Sam"}]', "customers"), [{ name: "Sam" }]);
    assert.deepEqual(parseBusinessArray(null, "customers"), []);
    assert.throws(() => parseBusinessArray("{", "customers"), /not valid JSON/);
    assert.throws(() => parseBusinessArray('{"name":"Sam"}', "customers"), /not a list/);
    assert.throws(() => parseBusinessArray('[{"name":"Sam"},null]', "customers"), /invalid entry/);
});

test("returns customer contact and balance summaries without exposing ID numbers", () => {
    const result = buildBusinessData([
        { name: "Sam", phone: "555-0100", email: "sam@example.com", due: "12.5", deposit: 2, idNumber: "private" }
    ], []);
    assert.deepEqual(result.customers, [{
        id: "",
        name: "Sam",
        phone: "555-0100",
        email: "sam@example.com",
        due: 12.5,
        deposit: 2
    }]);
});

test("combines saved receipts with customer history without duplicate transactions", () => {
    const result = buildBusinessData(
        [{ name: "Sam", history: [{ id: 1, receiptRef: "04112026-001", client: "Sam", timestamp: "2026-11-04", total: 15, paid: 15, items: [{ name: "Tea", qty: 1, price: 15 }] }] }],
        [{ id: 1, receiptRef: "04112026-001", client: "Sam", createdAt: "2026-11-04T10:00:00Z", total: 15, paid: 15, cartSnapshot: [{ name: "Tea", qty: 1, price: 15 }] }]
    );
    assert.equal(result.receipts.length, 1);
    assert.equal(result.receipts[0].receiptRef, "04112026-001");
    assert.deepEqual(result.receipts[0].items, [{ name: "Tea", qty: 1, price: 15 }]);
});

test("does not report customer payments as sales receipts", () => {
    const result = buildBusinessData([{ name: "Sam", history: [
        { id: 1, total: 15, paid: 0, items: [] },
        { id: 2, type: "payment", amount: 10, total: 10, paid: 10, items: [] }
    ] }], []);
    assert.deepEqual(result.receipts.map(receipt => receipt.id), ["1"]);
});

test("creates Supabase reporting rows without customer identity numbers", () => {
    const data = buildBusinessData(
        [{ id: 21, name: "Sam", phone: "555-0100", due: 4, idNumber: "private" }],
        [{ id: 42, receiptRef: "04112026-042", createdAt: "2026-11-04T10:00:00Z", client: "Sam", total: 10, paid: 10, cartSnapshot: [{ name: "Tea", qty: 1, price: 10 }] }]
    );
    const rows = toDatabaseRows("firebase-uid", {
        email: "admin@example.com",
        displayName: "Admin",
        createdAt: "2026-11-01T10:00:00Z",
        lastSignInAt: ""
    }, data);

    assert.equal(rows.account.uid, "firebase-uid");
    assert.equal(rows.customers[0].customer_key, "21");
    assert.equal(rows.customers[0].due, 4);
    assert.equal("idNumber" in rows.customers[0], false);
    assert.equal(rows.receipts[0].receipt_key, "42");
    assert.equal(rows.receipts[0].receipt_ref, "04112026-042");
    assert.equal(rows.receipts[0].items[0].name, "Tea");
});
