import test from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Account, type Transaction } from "./ledger";
import { undoLedger } from "./undo";
const account: Account = {
  id: "a",
  name: "现金",
  kind: "asset",
  role: "cash",
  icon: "cash",
  openingCents: 0,
  costCents: null,
  hidden: false,
  currency: "CNY",
};
const tx: Transaction = {
  id: "t",
  type: "expense",
  cents: 100,
  accountId: "a",
  date: "2026-10-03",
  merchant: "午餐",
  category: "e02",
  note: "",
};
test("undo preserves a different transaction added by another device", () => {
  const before = { ...emptyLedger(), accounts: [account] },
    after = { ...before, transactions: [tx] },
    current = { ...after, transactions: [tx, { ...tx, id: "remote" }] };
  assert.deepEqual(
    undoLedger(current, before, after).transactions.map((t) => t.id),
    ["remote"],
  );
});
test("undo rejects overwriting a later edit or removing an account referenced later", () => {
  const before = { ...emptyLedger(), accounts: [account] },
    after = { ...before, transactions: [tx] };
  assert.throws(
    () =>
      undoLedger(
        { ...after, transactions: [{ ...tx, cents: 200 }] },
        before,
        after,
      ),
    /其他设备/,
  );
  assert.throws(() => undoLedger(after, emptyLedger(), before), /账户/);
});
