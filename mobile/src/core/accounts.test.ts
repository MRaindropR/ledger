import { test } from "node:test";
import { strict as assert } from "node:assert";
import { emptyLedger, balance, type Account, type Transaction } from "./ledger";
import { accountStatement, moveAccount } from "./accounts";
import { changeLedger, emptySnapshot } from "./snapshot";
import { ledgerFromSync } from "./ledger-sync";
const account = (
  id: string,
  kind: Account["kind"] = "asset",
  hidden = false,
): Account => ({
  id,
  name: id,
  kind,
  hidden,
  role: "cash",
  icon: "cash",
  openingCents: 10000,
  costCents: null,
  currency: "CNY",
});
test("account sorting swaps within visible column and survives sync projection", () => {
  const ledger = {
    ...emptyLedger(),
    accounts: [
      account("a"),
      account("debt", "liability"),
      account("hidden", "asset", true),
      account("b"),
      account("c"),
    ],
  };
  const next = moveAccount(ledger, "a", 1);
  assert.deepEqual(
    next.accounts.map((a) => a.id),
    ["b", "debt", "hidden", "a", "c"],
  );
  assert.deepEqual(moveAccount(next, "a", -1), ledger);
  assert.equal(moveAccount(ledger, "a", -1), ledger);
  assert.equal(moveAccount(ledger, "hidden", 1), ledger);
  assert.deepEqual(
    moveAccount(ledger, "a", 1, true).accounts.map((a) => a.id),
    ["hidden", "debt", "a", "b", "c"],
  );
  assert.throws(() => moveAccount(ledger, "missing", 1));
  let sequence = 0;
  const snapshot = changeLedger(
    emptySnapshot(),
    () => next,
    () => String(++sequence),
  );
  assert.deepEqual(
    ledgerFromSync(snapshot.sync).accounts.map((a) => a.id),
    next.accounts.map((a) => a.id),
  );
});
test("account statement includes incoming transfers and reconstructs signed running balance", () => {
  const make = (
    id: string,
    type: Transaction["type"],
    cents: number,
    accountId: string,
    toAccountId?: string,
  ): Transaction => ({
    id,
    type,
    cents,
    accountId,
    toAccountId,
    date: "2026-10-03",
    merchant: id,
    category: "e01",
    note: "",
  });
  const debt = { ...account("d", "liability"), openingCents: -10000 };
  const ledger = {
    ...emptyLedger(),
    accounts: [account("a"), debt],
    transactions: [
      make("3", "transfer", 3000, "a", "d"),
      make("1", "income", 2000, "a"),
      make("2", "expense", 500, "a"),
      make("4", "expense", 1000, "d"),
    ],
  };
  const assets = accountStatement(ledger, "a");
  assert.deepEqual(
    assets.entries.map((e) => [e.transaction.id, e.delta, e.balanceAfter]),
    [
      ["3", -3000, 8500],
      ["2", -500, 11500],
      ["1", 2000, 12000],
    ],
  );
  assert.equal(assets.current, balance(ledger, ledger.accounts[0]));
  assert.equal(assets.income, 2000);
  assert.equal(assets.expense, 500);
  assert.equal(assets.transferOut, 3000);
  const liabilities = accountStatement(ledger, "d");
  assert.equal(liabilities.current, -8000);
  assert.equal(liabilities.transferIn, 3000);
  assert.equal(liabilities.income, 0);
  assert.equal(liabilities.expense, 1000);
  assert.equal(
    accountStatement({ ...ledger, transactions: [] }, "a").current,
    10000,
  );
  assert.throws(() => accountStatement(ledger, "missing"));
});
