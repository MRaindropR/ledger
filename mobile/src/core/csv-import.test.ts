import { test } from "node:test";
import { strict as assert } from "node:assert";
import { classifyImport, csvRows, parseCsvBill } from "./csv-import";
import { emptyLedger, reconcile } from "./ledger";
test("CSV quoting preserves commas, newlines, BOM and escaped quotes", () => {
  assert.deepEqual(
    csvRows('\uFEFF日期,说明,金额\r\n2026-10-03,"餐饮,\n""午餐""",19.90'),
    [
      ["日期", "说明", "金额"],
      ["2026-10-03", '餐饮,\n"午餐"', "19.90"],
    ],
  );
  assert.deepEqual(csvRows("日期\t说明\t金额\n2026-10-03\t测试\t2"), [
    ["日期", "说明", "金额"],
    ["2026-10-03", "测试", "2"],
  ]);
  assert.throws(() => csvRows('a,b\n"unclosed,1'), /未闭合/);
  assert.throws(() => csvRows('a,b\n"x"bad,1'), /多余/);
  assert.throws(() => csvRows("a,\uFFFD"), /UTF-8/);
});
test("CSV explicit direction overrides signs, strict amounts/date/currency produce visible issues", () => {
  const result = parseCsvBill(
    "导出账单\n交易时间,交易对方,金额（元）,收/支,备注,币种\n2026/10/03 12:00,午餐,19.90,支出,备注,CNY\n10/04,退款,5,收入,,人民币\n2026-02-30,错误日期,3,支出,,CNY\n10/05,外币,2,支出,,USD\n10/05,多位小数,1.001,支出,,CNY\n10/05,忽略,4,其他,,CNY",
    "a",
    2026,
    "CNY",
  );
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].cents, 1990);
  assert.equal(result.transactions[1].type, "income");
  assert.equal(result.transactions[1].date, "2026-10-04");
  assert.equal(result.issues.length, 4);
  assert.deepEqual(
    result.issues.map((i) => i.line),
    [5, 6, 7, 8],
  );
});
test("CSV supports separate debit credit, signed credit-card amounts and rejects unknown headers", () => {
  const split = parseCsvBill(
    "日期;商户;收入金额;支出金额\n2026-10-03;工资;1000;\n2026-10-03;午餐;;20\n2026-10-03;矛盾;1;2",
    "a",
    2026,
    "CNY",
  );
  assert.deepEqual(
    split.transactions.map((t) => [t.type, t.cents]),
    [
      ["income", 100000],
      ["expense", 2000],
    ],
  );
  assert.equal(split.issues.length, 1);
  const signed = parseCsvBill(
    "date,description,amount\n2026-10-03,refund,-2.50\n2026-10-03,purchase,8",
    "a",
    2026,
    "CNY",
  );
  assert.deepEqual(
    signed.transactions.map((t) => t.type),
    ["income", "expense"],
  );
  assert.throws(() => parseCsvBill("x,y,z\n1,2,3", "a", 2026, "CNY"), /表头/);
});
test("import classification includes duplicates inside the same file", () => {
  const rows = parseCsvBill(
    "日期,商户,金额\n2026-10-03,午餐,20\n2026-10-03,午餐,20\n2026-10-05,午餐,20",
    "a",
    2026,
    "CNY",
  ).transactions;
  assert.deepEqual(classifyImport(emptyLedger(), rows), [
    "new",
    "duplicate",
    "review",
  ]);
  assert.equal(emptyLedger().transactions.length, 0);
});
test("indexed duplicate classification preserves reconciliation rules for a 20,000-row batch", () => {
  const seed = parseCsvBill(
    "日期,商户,金额\n2026-10-03,午餐,20",
    "a",
    2026,
    "CNY",
  ).transactions[0];
  const ledger = {
    ...emptyLedger(),
    transactions: [{ ...seed, id: "existing" }],
  };
  const candidates = [
    seed,
    { ...seed, date: "2026-10-06" },
    { ...seed, date: "2026-10-07" },
    { ...seed, merchant: "OTHER" },
    { ...seed, type: "income" as const },
  ];
  const expected = candidates.map((t, i) =>
    reconcile(
      {
        ...ledger,
        transactions: [...ledger.transactions, ...candidates.slice(0, i)],
      },
      t,
    ),
  );
  assert.deepEqual(classifyImport(ledger, candidates), expected);
  const large = Array.from({ length: 20000 }, (_, i) => ({
    ...seed,
    merchant: "Unique " + i,
  }));
  assert.equal(
    classifyImport(ledger, large).filter((x) => x === "new").length,
    20000,
  );
});
