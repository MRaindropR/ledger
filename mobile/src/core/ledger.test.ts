import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  cents,
  emptyLedger,
  saveTransaction,
  balance,
  importLegacy,
  totals,
  parseBill,
  reconcile,
  investmentProfit,
  deleteAccount,
  type Ledger,
} from "./ledger";
const base = (): Ledger => ({
  ...emptyLedger(),
  accounts: [
    {
      id: "a",
      name: "现金",
      kind: "asset",
      role: "cash",
      icon: "cash",
      openingCents: 10000,
      costCents: null,
      hidden: false,
      currency: "CNY",
    },
    {
      id: "c",
      name: "信用卡",
      kind: "liability",
      role: "credit",
      icon: "credit",
      openingCents: -20000,
      costCents: null,
      hidden: false,
      currency: "CNY",
    },
  ],
});
const tx = {
  id: "t",
  type: "expense" as const,
  cents: 1000,
  accountId: "c",
  date: "2026-10-03",
  merchant: "午餐",
  category: "e02",
  note: "",
};
test("金额使用整数分，拒绝三位小数", () => {
  assert.equal(cents("0.29"), 29);
  assert.equal(cents(0.1 + 0.2), 30);
  assert.equal(cents("-1,200.31"), -120031);
  assert.throws(() => cents("0.001"));
});
test("信用卡支出增加负债，净资产减少", () => {
  const l = saveTransaction(base(), tx);
  assert.equal(balance(l, l.accounts[1]), -21000);
  assert.deepEqual(totals(l), {
    assets: 10000,
    liabilities: 21000,
    net: -11000,
  });
});
test("编辑与删除不重复累计账户余额", () => {
  const l = saveTransaction(saveTransaction(base(), tx), {
    ...tx,
    cents: 2000,
  });
  assert.equal(l.transactions.length, 1);
  assert.equal(balance(l, l.accounts[1]), -22000);
  assert.equal(balance({ ...l, transactions: [] }, l.accounts[1]), -20000);
});
test("转账守恒及跨币种校验", () => {
  const l = saveTransaction(base(), {
    ...tx,
    type: "transfer",
    accountId: "a",
    toAccountId: "c",
  });
  assert.equal(totals(l).net, -10000);
  assert.throws(() =>
    saveTransaction(base(), { ...tx, type: "transfer", toAccountId: "c" }),
  );
});
test("旧版导入保持账户当前余额，负债正负两种兼容", () => {
  for (const debt of [-210, 210]) {
    const l = importLegacy({
      accs: [{ id: "c", n: "卡", kind: "liability", bal: debt }],
      txs: [{ id: "t", tp: "expense", amt: 10, acc: "c", dt: "2026-10-03" }],
    });
    assert.equal(balance(l, l.accounts[0]), -21000);
  }
});
test("不录成本不显示浮盈，已引用账户禁止删除", () => {
  const l = saveTransaction(base(), tx);
  assert.equal(investmentProfit(l, l.accounts[0]), null);
  assert.throws(() => deleteAccount(l, "c"));
});
test("日期有效性及账单去重", () => {
  assert.throws(() => saveTransaction(base(), { ...tx, date: "2026-02-30" }));
  const parsed = parseBill(
    "07/20 07/21 WLZF-午餐 ￥19.90\n2026-07-22 咖啡 3.00",
    "a",
    2026,
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].cents, 1990);
  assert.equal(parsed[0].postedDate, "2026-07-21");
  const l = saveTransaction(base(), { ...parsed[0], id: "one" });
  assert.equal(reconcile(l, parsed[0]), "duplicate");
  assert.equal(reconcile(l, { ...parsed[0], date: "2026-07-22" }), "review");
});
