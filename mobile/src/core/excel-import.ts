import * as XLSX from "xlsx";
import { importLegacy, type Ledger } from "./ledger";
import { parseBillRows } from "./csv-import";

export function readExcel(bytes: Uint8Array): XLSX.WorkBook {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw Error("Excel 文件不能超过 5 MB");
  return XLSX.read(bytes, {
    type: "array",
    cellNF: true,
    cellDates: false,
    cellText: false,
    bookVBA: false,
    sheetRows: 20002,
  });
}
export function workbookBackup(workbook: XLSX.WorkBook): Ledger | null {
  const sheet = workbook.Sheets["原生账本JSON"];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });
  if (rows[0]?.[0] !== "序号" || rows[0]?.[1] !== "JSON 数据")
    throw Error("账本备份表头不完整");
  const chunks = rows.slice(1).sort((a, b) => Number(a[0]) - Number(b[0]));
  let length = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i][0] !== i || typeof chunks[i][1] !== "string")
      throw Error("账本备份片段缺失或重复，不能恢复");
    length += (chunks[i][1] as string).length;
    if (length > 32 * 1024 * 1024)
      throw Error("账本备份过大，请在电脑端导出 JSON 后恢复");
  }
  if (!chunks.length) throw Error("账本备份为空");
  return importLegacy(JSON.parse(chunks.map((row) => row[1]).join("")));
}
export function billSheetNames(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.filter(
    (name) =>
      name !== "原生账本JSON" &&
      !workbook.Workbook?.Sheets?.find((s) => s.name === name)?.Hidden,
  );
}
export function parseExcelBill(
  workbook: XLSX.WorkBook,
  name: string,
  accountId: string,
  year: number,
  currency: string,
) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw Error("所选工作表已不存在");
  const reference = sheet["!fullref"] || sheet["!ref"];
  if (!reference) throw Error("工作表为空");
  const range = XLSX.utils.decode_range(reference);
  if (range.e.r - range.s.r > 20000 || range.e.c - range.s.c > 99)
    throw Error("工作表超过 20,000 行或 100 列，请拆分后导入");
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v === undefined) {
        row.push("");
        continue;
      }
      if (cell.t === "n" && cell.z && XLSX.SSF.is_date(String(cell.z))) {
        const date = XLSX.SSF.parse_date_code(Number(cell.v), {
          date1904: !!workbook.Workbook?.WBProps?.date1904,
        });
        row.push(
          date
            ? `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
            : "无效日期",
        );
      } else row.push(String(cell.v));
    }
    rows.push(row);
  }
  return parseBillRows(rows, accountId, year, currency);
}
