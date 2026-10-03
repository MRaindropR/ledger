import test from "node:test";
import assert from "node:assert/strict";
import { importLegacy, balance,totals } from "./ledger";
import { exportLegacy } from "./legacy-export";
test("HTML-native roundtrip preserves currencies, balances, budgets and display metadata", () => {
  const old = {
    accs: [
      {
        id: "a",
        n: "美元现金",
        kind: "asset",
        role: "cash",
        ic: "icon:cash",
        cur: "USD",
        bal: 45.32,
        color: "#ff8d50",
      },
      {
        id: "card",
        n: "信用卡",
        kind: "liability",
        role: "loan",
        ic: "icon:credit",
        cur: "CNY",
        bal: -30,
      },
    ],
    txs: [
      {
        id: "t",
        tp: "expense",
        amt: 4.68,
        acc: "a",
        dt: "2026-10-03",
        m: "午餐",
        cat: "e02",
        note: "餐厅",
        src: "text",
      },
    ],
    budgets: { cats: { e02: 900 }, flexCap: 1200, flex: { e02: true } },
    merchantCatMap: { 午餐: "e02" },
  };
  const native = importLegacy(old),
    legacy = exportLegacy(native, old),
    again = importLegacy(legacy);
  assert.deepEqual(again, native);
  assert.equal(Reflect.get(legacy.accs[0], "color"), "#ff8d50");
  assert.equal(Reflect.get(legacy.txs[0], "src"), "text");
  assert.equal(native.accounts[0].currency, "USD");
  assert.equal(legacy.budgets.flexCap, 1200);
});
test("bridge marker preserves a credit-card overpayment instead of turning it into debt", () => {
  const native = importLegacy({
    nativeBridgeVersion: 1,
    accs: [
      {
        id: "card",
        n: "信用卡",
        kind: "liability",
        ic: "icon:credit",
        bal: 123.45,
      },
    ],
    txs: [],
  });
  assert.equal(
    balance(importLegacy(exportLegacy(native)), native.accounts[0]),
    12345,
  );
  assert.deepEqual(totals(native),{assets:12345,liabilities:0,net:12345});
});
