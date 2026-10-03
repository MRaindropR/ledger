import { test } from "node:test";
import { strict as assert } from "node:assert";
import { emptyLedger, type Transaction } from "./ledger";
import { applyMerchantRule, rememberMerchantRule } from "./merchant-rules";

const tx: Transaction = {
  id: "t",
  type: "expense",
  cents: 100,
  accountId: "a",
  date: "2026-10-03",
  merchant: " Cafe-A ",
  category: "e01",
  note: "",
};
test("merchant rules normalize names, preserve unrelated rules and never rewrite history", () => {
  const ledger = emptyLedger();
  ledger.merchantCategories = { cafe_a: "e02", OTHER: "e01" };
  ledger.transactions = [tx];
  const learned = rememberMerchantRule(ledger, tx);
  assert.deepEqual(learned.merchantCategories, {
    OTHER: "e01",
    "CAFE A": "e01",
  });
  assert.equal(learned.transactions, ledger.transactions);
  assert.deepEqual(ledger.merchantCategories, { cafe_a: "e02", OTHER: "e01" });
  assert.equal(
    applyMerchantRule(learned, { ...tx, category: "e02" }).category,
    "e01",
  );
});
test("legacy rule lookup rejects ambiguous aliases, invalid categories and opposite income type", () => {
  const ledger = emptyLedger();
  ledger.merchantCategories = { cafe_a: "e01" };
  assert.equal(
    applyMerchantRule(ledger, { ...tx, category: "e02" }).category,
    "e01",
  );
  ledger.merchantCategories["Cafe-A"] = "e02";
  assert.equal(applyMerchantRule(ledger, tx), tx);
  ledger.merchantCategories["CAFE A"] = "bad";
  assert.equal(applyMerchantRule(ledger, tx), tx);
  ledger.merchantCategories["CAFE A"] = "e01";
  const income = { ...tx, type: "income" as const, category: "i01" };
  assert.equal(applyMerchantRule(ledger, income), income);
  assert.throws(
    () => rememberMerchantRule(ledger, { ...income, category: "e01" }),
    /不匹配/,
  );
});
test("transfers and blank merchants never learn a category", () => {
  const ledger = emptyLedger();
  const transfer = { ...tx, type: "transfer" as const };
  assert.equal(rememberMerchantRule(ledger, transfer), ledger);
  assert.equal(applyMerchantRule(ledger, transfer), transfer);
  assert.throws(
    () => rememberMerchantRule(ledger, { ...tx, merchant: "  " }),
    /商户/,
  );
});
