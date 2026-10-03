import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as XLSX from "xlsx";
import {
  readExcel,
  workbookBackup,
  billSheetNames,
  parseExcelBill,
} from "./excel-import";
import { emptyLedger } from "./ledger";
const roundtrip = (workbook: XLSX.WorkBook) =>
  readExcel(
    new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
  );
test("real XLSX bytes preserve numeric dates, merchant text and strict amount review", () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["交易日期", "商户", "金额", "收支"],
    [46300, "午餐", 19.9, "支出"],
    ["2026-10-05", "退款", 2.5, "收入"],
    ["2026-10-05", "错误", 1.001, "支出"],
  ]);
  sheet.A2.z = "yyyy-mm-dd";
  XLSX.utils.book_append_sheet(wb, sheet, "信用卡账单");
  const parsed = roundtrip(wb);
  assert.deepEqual(billSheetNames(parsed), ["信用卡账单"]);
  const result = parseExcelBill(parsed, "信用卡账单", "a", 2026, "CNY");
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].date, "2026-10-05");
  assert.equal(result.transactions[0].cents, 1990);
  assert.equal(result.transactions[1].type, "income");
  assert.equal(result.issues.length, 1);
  assert.equal(workbookBackup(parsed), null);
});
test("desktop XLSX backup chunks restore the complete ledger and reject incomplete fragments", () => {
  const ledger = {
    ...emptyLedger(),
    accounts: [
      {
        id: "a",
        name: "港币账户",
        kind: "asset" as const,
        role: "investment",
        icon: "stock",
        openingCents: 12345,
        costCents: null,
        hidden: false,
        currency: "HKD",
      },
    ],
    budgets: { e01: 1234 },
  };
  const json = JSON.stringify(ledger),
    chunks = [json.slice(0, 30), json.slice(30)];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["序号", "JSON 数据"],
      [1, chunks[1]],
      [0, chunks[0]],
    ]),
    "原生账本JSON",
  );
  assert.deepEqual(workbookBackup(roundtrip(wb)), ledger);
  wb.Sheets["原生账本JSON"].A2.v = 2;
  assert.throws(() => workbookBackup(roundtrip(wb)), /缺失或重复/);
});
test("Excel respects 1904 date system, visible sheet selection and row limits", () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["日期", "说明", "金额"],
    [44838, "测试", 1],
  ]);
  sheet.A2.z = "m/d/yy";
  XLSX.utils.book_append_sheet(wb, sheet, "可见");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["hidden"]]),
    "隐藏",
  );
  wb.Workbook = {
    WBProps: { date1904: true },
    Sheets: [
      { name: "可见", Hidden: 0 },
      { name: "隐藏", Hidden: 1 },
    ],
  };
  const parsed = roundtrip(wb);
  assert.deepEqual(billSheetNames(parsed), ["可见"]);
  assert.equal(
    parseExcelBill(parsed, "可见", "a", 2026, "CNY").transactions[0].date,
    "2026-10-05",
  );
  parsed.Sheets["可见"]["!fullref"] = "A1:C30000";
  assert.throws(
    () => parseExcelBill(parsed, "可见", "a", 2026, "CNY"),
    /20,000/,
  );
});
