import {
  cents,
  validDate,
  normalizeMerchant,
  type Ledger,
  type Transaction,
} from "./ledger";
export type ImportIssue = { line: number; reason: string };
export type BillImport = { transactions: Transaction[]; issues: ImportIssue[] };
export function classifyImport(ledger: Ledger, transactions: Transaction[]) {
  const index = new Map<string, Set<number>>();
  const signature = (t: Transaction) =>
    JSON.stringify([
      t.accountId,
      t.type,
      t.cents,
      normalizeMerchant(t.merchant),
    ]);
  const day = (t: Transaction) =>
    Math.floor(Date.parse(t.date + "T00:00:00Z") / 86400000);
  const add = (t: Transaction) => {
    const k = signature(t);
    if (!index.has(k)) index.set(k, new Set());
    index.get(k)!.add(day(t));
  };
  ledger.transactions.forEach(add);
  return transactions.map((transaction) => {
    const days = index.get(signature(transaction)),
      date = day(transaction);
    const result: "new" | "duplicate" | "review" = days?.has(date)
      ? "duplicate"
      : [-3, -2, -1, 1, 2, 3].some((d) => days?.has(date + d))
        ? "review"
        : "new";
    add(transaction);
    return result;
  });
}

/** RFC-style quoting, including embedded delimiters/newlines and escaped double quotes. */
export function csvRows(text: string): string[][] {
  if (text.includes("\uFFFD"))
    throw Error("文件编码无法读取，请另存为 UTF-8 CSV 后导入");
  text = text.replace(/^\uFEFF/, "");
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
  let inside = false;
  for (let i = 0; i < Math.min(text.length, 65536); i++) {
    if (text[i] === '"') {
      if (inside && text[i + 1] === '"') i++;
      else inside = !inside;
    } else if (!inside && Object.hasOwn(counts, text[i])) counts[text[i]]++;
  }
  const delimiter = Object.keys(counts).sort(
    (a, b) => counts[b] - counts[a],
  )[0];
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const endField = () => {
    row.push(field.trim());
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === delimiter) endField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else if (char === '"' && !field.trim() && !closed) {
      field = "";
      quoted = true;
    } else if (char === '"') throw Error("CSV 字段内的引号需要使用双引号转义");
    else if (closed && !/\s/.test(char)) throw Error("CSV 引号后有多余内容");
    else field += char;
  }
  if (quoted) throw Error("CSV 引号未闭合，文件可能不完整");
  if (field || row.length) endRow();
  if (rows.length > 20001) throw Error("单次最多导入 20,000 行，请拆分文件");
  return rows;
}
const key = (s: string) => s.replace(/[\s（）()]/g, "").toLocaleLowerCase();
const aliases = {
  date: ["交易日期", "交易时间", "日期", "date", "transactiondate"],
  posted: ["记账日期", "入账日期", "posteddate"],
  description: [
    "交易说明",
    "交易对方",
    "商户",
    "商户名称",
    "商品",
    "商品名称",
    "说明",
    "description",
    "merchant",
  ],
  amount: ["金额", "金额元", "交易金额", "人民币金额", "amount"],
  income: ["收入金额", "收入", "贷方金额", "credit"],
  expense: ["支出金额", "支出", "借方金额", "debit"],
  direction: ["收支", "收/支", "收支类型", "交易类型", "type", "direction"],
  note: ["备注", "note"],
  currency: ["币种", "currency"],
  status: ["交易状态", "当前状态", "status"],
};
function column(headers: string[], names: string[]) {
  return headers.findIndex((h) => names.some((n) => key(n) === key(h)));
}
function billDate(text: string, year: number) {
  const full = text
    .trim()
    .match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|\s|T|$)/);
  const short = text.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  const date = full
    ? `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`
    : short
      ? `${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`
      : "";
  if (!validDate(date)) throw Error("日期无效，需 YYYY-MM-DD 或 MM/DD");
  return date;
}
export function parseCsvBill(
  text: string,
  accountId: string,
  year: number,
  currency: string,
): BillImport {
  if (!accountId) throw Error("选择入账账户");
  if (!Number.isInteger(year) || year < 1900 || year > 9999)
    throw Error("输入有效四位年份");
  const rows = csvRows(text);
  return parseBillRows(rows, accountId, year, currency);
}
export function parseBillRows(
  rows: string[][],
  accountId: string,
  year: number,
  currency: string,
): BillImport {
  if (!accountId) throw Error("选择入账账户");
  if (!Number.isInteger(year) || year < 1900 || year > 9999)
    throw Error("输入有效四位年份");
  if (rows.length > 20001) throw Error("单次最多导入 20,000 行，请拆分文件");
  const headerIndex = rows.findIndex(
    (row) =>
      column(row, aliases.date) >= 0 &&
      (column(row, aliases.amount) >= 0 ||
        column(row, aliases.income) >= 0 ||
        column(row, aliases.expense) >= 0),
  );
  if (headerIndex < 0)
    throw Error("未找到日期和金额表头，支持交易日期、交易说明、金额、收支等列");
  const columns = Object.fromEntries(
    Object.entries(aliases).map(([k, names]) => [
      k,
      column(rows[headerIndex], names),
    ]),
  );
  const transactions: Transaction[] = [],
    issues: ImportIssue[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i],
      value = (name: keyof typeof aliases) =>
        columns[name] < 0 ? "" : row[columns[name]] || "";
    try {
      if (
        value("status") &&
        !/^(成功|支付成功|交易成功|已完成|退款成功|已退款|success|completed)$/i.test(
          value("status"),
        )
      )
        throw Error("交易状态不是已完成，请核对后再导入");
      if (
        value("currency") &&
        ![
          currency,
          ...(currency === "CNY" ? ["人民币", "RMB", "￥", "¥"] : []),
        ].includes(value("currency").toUpperCase())
      )
        throw Error("币种与所选账户不一致");
      const date = billDate(value("date"), year),
        postedDate = value("posted") ? billDate(value("posted"), year) : date;
      let signed: number, type: "income" | "expense";
      if (columns.amount >= 0) {
        signed = cents(value("amount"));
        const direction = value("direction");
        if (direction) {
          if (/^(收入|收|收款|退款|income|credit)$/i.test(direction))
            type = "income";
          else if (/^(支出|支|付款|消费|expense|debit)$/i.test(direction))
            type = "expense";
          else throw Error("无法确定收支类型，请核对");
        } else type = signed < 0 ? "income" : "expense";
      } else {
        const income = value("income") ? cents(value("income")) : 0;
        const expense = value("expense") ? cents(value("expense")) : 0;
        if (income < 0 || expense < 0 || (income && expense))
          throw Error("收入/支出列必须只有一列为正金额");
        type = income ? "income" : "expense";
        signed = income || expense;
      }
      if (!signed) throw Error("金额为零，未导入");
      transactions.push({
        id: "",
        type,
        cents: Math.abs(signed),
        accountId,
        date,
        postedDate,
        merchant: value("description") || "未填写说明",
        category: type === "income" ? "i01" : "e01",
        note: value("note"),
      });
    } catch (error) {
      issues.push({
        line: i + 1,
        reason: error instanceof Error ? error.message : "无法读取此行",
      });
    }
  }
  return { transactions, issues };
}
