import test from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Account, type Transaction } from "./ledger";
import {
  monthlyBudget,
  budgetDraft,
  applyBudgetDraft,
  budgetProgress,
} from "./budget";
import { exportLegacy } from "./legacy-export";
import { importLegacy } from "./ledger";
const account: Account = {
  id: "a",
  name: "现金",
  kind: "asset",
  role: "cash",
  icon: "cash",
  openingCents: 0,
  costCents: null,
  currency: "CNY",
  hidden: true,
};
const tx: Transaction = {
  id: "t",
  type: "expense",
  cents: 1234,
  accountId: "a",
  date: "2026-10-03",
  merchant: "餐饮",
  category: "e04",
  note: "",
};
test("monthly budget includes hidden history, excludes foreign currency, transfers and other months", () => {
  const ledger = {
    ...emptyLedger(),
    accounts: [account, { ...account, id: "usd", currency: "USD" }],
    transactions: [
      tx,
      { ...tx, id: "foreign", accountId: "usd" },
      { ...tx, id: "transfer", type: "transfer" as const, toAccountId: "a" },
      { ...tx, id: "other", date: "2026-09-30" },
    ],
    budgets: { e04: 1000 },
    budgetSettings: { flexCapCents: 2000, flex: {} },
  };
  const report = monthlyBudget(ledger, "2026-10");
  assert.equal(report.total, 1234);
  assert.equal(report.flexible.spent, 1234);
  assert.equal(report.categories[0].remaining, -234);
  assert.equal(report.categories[0].ratio, 1.234);
  assert.equal(report.flexible.remaining, 766);
  ledger.budgetSettings.flex = { e04: false };
  assert.equal(monthlyBudget(ledger, "2026-10").flexible.spent, 0);
  assert.throws(() => monthlyBudget(ledger, "2026-13"));
});
test("unset budgets have no percentage and exact exhaustion is zero remaining", () => {
  assert.equal(budgetProgress(0, 1234).ratio, null);
  assert.equal(budgetProgress(100, 100).remaining, 0);
});
test("budget draft merges only edits, preserves unrelated latest budgets and cloud settings", () => {
  const base = { ...emptyLedger(), budgets: { e01: 1000, e02: 2000 } },
    current = {
      ...base,
      budgets: { ...base.budgets, e02: 3000, e03: 100 },
      budgetSettings: { flexCapCents: 5000, flex: { e04: false } },
    },
    draft = budgetDraft(base);
  draft.amounts.e01 = "12.34";
  const next = applyBudgetDraft(current, base, draft);
  assert.deepEqual(next.budgets, { e01: 1234, e02: 3000, e03: 100 });
  assert.deepEqual(next.budgetSettings, current.budgetSettings);
  draft.cap = "100";
  draft.flex.e07 = false;
  const revised = applyBudgetDraft(base, base, draft);
  assert.equal(revised.budgetSettings?.flexCapCents, 10000);
  assert.equal(revised.budgetSettings?.flex.e07, false);
  assert.deepEqual(
    importLegacy(exportLegacy(revised)).budgets,
    revised.budgets,
  );
  assert.deepEqual(
    importLegacy(exportLegacy(revised)).budgetSettings,
    revised.budgetSettings,
  );
});
test("budget edit rejects concurrent overwrite, negatives and sub-cent values; blank clears only edited limit", () => {
  const base = { ...emptyLedger(), budgets: { e02: 1000 } },
    draft = budgetDraft(base);
  draft.amounts.e02 = "20";
  assert.throws(
    () => applyBudgetDraft({ ...base, budgets: { e02: 1500 } }, base, draft),
    /其他设备/,
  );
  draft.amounts.e02 = "-1";
  assert.throws(() => applyBudgetDraft(base, base, draft), /负数/);
  draft.amounts.e02 = "1.001";
  assert.throws(() => applyBudgetDraft(base, base, draft), /两位/);
  draft.amounts.e02 = "";
  assert.deepEqual(applyBudgetDraft(base, base, draft).budgets, {});
});
