import test from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Account, type Transaction } from "./ledger";
import { annualReview } from "./review";
test("年度复盘区分币种，排除转账，保留隐藏账户历史", () => {
  const account: Account = {
    id: "a",
    name: "现金",
    kind: "asset",
    role: "cash",
    icon: "cash",
    openingCents: 0,
    costCents: null,
    hidden: true,
    currency: "CNY",
  };
  const tx: Transaction = {
    id: "t",
    type: "expense",
    cents: 200,
    accountId: "a",
    date: "2026-01-02",
    merchant: "午餐",
    category: "餐饮",
    note: "",
  };
  const ledger = {
    ...emptyLedger(),
    accounts: [account, { ...account, id: "usd", currency: "USD" }],
    transactions: [
      tx,
      { ...tx, id: "i", type: "income" as const, cents: 1000 },
      {
        ...tx,
        id: "x",
        type: "transfer" as const,
        toAccountId: "a",
        cents: 9000,
      },
      { ...tx, id: "f", accountId: "usd", cents: 99000 },
      { ...tx, id: "old", date: "2025-01-02" },
    ],
  };
  const review = annualReview(ledger, 2026);
  assert.equal(review.income, 1000);
  assert.equal(review.expense, 200);
  assert.equal(review.net, 800);
  assert.equal(review.savingRate, 0.8);
  assert.equal(review.months[0].count, 2);
  assert.equal(review.categories[0].cents, 200);
  assert.equal(annualReview(emptyLedger(), 2026).savingRate, null);
});
