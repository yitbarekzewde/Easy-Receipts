"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBusinessData, parseBusinessArray } = require("../business-data");

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
