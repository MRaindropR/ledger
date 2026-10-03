export type TxType = "expense" | "income" | "transfer";
export type Account = {
  id: string;
  name: string;
  kind: "asset" | "liability";
  role: string;
  icon: string;
  openingCents: number;
  costCents: number | null;
  hidden: boolean;
  currency: string;
};
export type Transaction = {
  id: string;
  type: TxType;
  cents: number;
  accountId: string;
  toAccountId?: string;
  date: string;
  postedDate?: string;
  merchant: string;
  category: string;
  note: string;
};
export type Ledger = {
  schemaVersion: 1;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Record<string, number>;
  merchantCategories: Record<string, string>;
  budgetSettings?: { flexCapCents: number; flex: Record<string, boolean> };
};
export const emptyLedger = (): Ledger => ({
  schemaVersion: 1,
  accounts: [],
  transactions: [],
  budgets: {},
  merchantCategories: {},
});
export function cents(value: string | number): number {
  if (typeof value === "number") {
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    if (
      !Number.isFinite(value) ||
      !Number.isSafeInteger(rounded) ||
      Math.abs(scaled - rounded) > 0.00001
    )
      throw Error("金额必须为最多两位小数");
    return rounded;
  }
  const text = String(value).replace(/[¥￥$,\s元]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw Error("金额必须为最多两位小数");
  const negative = text.startsWith("-");
  const [whole, decimal = ""] = text.replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw Error("金额超出范围");
  return negative ? -result : result;
}
export const money = (n: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + "T12:00:00Z");
  return !isNaN(+d) && d.toISOString().slice(0, 10) === date;
}
export function flow(t: Transaction, id: string) {
  return t.accountId === id
    ? t.type === "income"
      ? t.cents
      : -t.cents
    : t.type === "transfer" && t.toAccountId === id
      ? t.cents
      : 0;
}
export function balance(ledger: Ledger, account: Account) {
  return (
    account.openingCents +
    ledger.transactions.reduce((sum, t) => sum + flow(t, account.id), 0)
  );
}
export function totals(ledger: Ledger) {
  const visible = ledger.accounts.filter(
    (a) => !a.hidden && a.currency === "CNY",
  );
  return {
    assets: visible
      .filter((a) => a.kind === "asset" || balance(ledger,a)>0)
      .reduce((s, a) => s + balance(ledger, a), 0),
    liabilities: visible
      .filter((a) => a.kind === "liability")
      .reduce((s, a) => s + Math.max(0, -balance(ledger, a)), 0),
    net: visible.reduce((s, a) => s + balance(ledger, a), 0),
  };
}
export function saveTransaction(ledger: Ledger, t: Transaction): Ledger {
  if (
    !t.id ||
    !Number.isSafeInteger(t.cents) ||
    t.cents <= 0 ||
    !validDate(t.date)
  )
    throw Error("检查金额和交易日期");
  const from = ledger.accounts.find((a) => a.id === t.accountId);
  if (!from) throw Error("请选择账户");
  if (t.type === "transfer") {
    const to = ledger.accounts.find((a) => a.id === t.toAccountId);
    if (!to || to.id === from.id) throw Error("转出和转入账户必须不同");
    if (to.currency !== from.currency)
      throw Error("跨币种转账需提供汇率，当前不能直接保存");
  }
  return {
    ...ledger,
    transactions: [...ledger.transactions.filter((x) => x.id !== t.id), t].sort(
      (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    ),
  };
}
export function deleteAccount(ledger: Ledger, id: string) {
  if (
    ledger.transactions.some((t) => t.accountId === id || t.toAccountId === id)
  )
    throw Error("账户已有流水，请隐藏以保留历史");
  return { ...ledger, accounts: ledger.accounts.filter((a) => a.id !== id) };
}
export function investmentProfit(ledger: Ledger, a: Account) {
  return a.costCents === null ? null : balance(ledger, a) - a.costCents;
}
type LegacyAccount = {
  id: string;
  n: string;
  kind: "asset" | "liability";
  role?: string;
  ic?: string;
  bal: number | string;
  cost?: number | string | null;
  hidden?: boolean;
  currency?: string;
  cur?: string;
};
type LegacyTransaction = {
  id: string;
  tp: TxType;
  amt: number | string;
  acc: string;
  acc2?: string;
  dt: string;
  postDate?: string;
  m?: string;
  cat?: string;
  note?: string;
};
type LegacyLedger = {
  schemaVersion?: number;
  nativeBridgeVersion?: number;
  accs?: LegacyAccount[];
  txs?: LegacyTransaction[];
  merchantCatMap?: Record<string, string>;
  budgets?: {
    cats?: Record<string, number | string>;
    flexCap?: number | string;
    flex?: Record<string, boolean>;
  };
};
function record(x: unknown): LegacyLedger {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("账本格式无效");
  return x as LegacyLedger;
}
export function importLegacy(input: unknown): Ledger {
  const raw = record(input);
  if (raw.schemaVersion === 1) {
    validateLedger(input as Ledger);
    return input as Ledger;
  }
  if (!Array.isArray(raw.accs) || !Array.isArray(raw.txs))
    throw Error("请选择 SmartLedger JSON 备份");
  const ledger = emptyLedger();
  ledger.transactions = raw.txs.map((t) => ({
    id: String(t.id),
    type: t.tp,
    cents: cents(t.amt),
    accountId: String(t.acc),
    toAccountId: t.acc2 ? String(t.acc2) : undefined,
    date: t.dt,
    postedDate: t.postDate,
    merchant: t.m || "",
    category: t.cat || "e01",
    note: t.note || "",
  }));
  ledger.accounts = raw.accs.map((a) => {
    const signed =
      a.kind === "liability" && raw.nativeBridgeVersion !== 1
        ? -Math.abs(cents(a.bal))
        : cents(a.bal);
    return {
      id: String(a.id),
      name: a.n,
      kind: a.kind,
      role: a.role || "cash",
      icon: a.ic?.startsWith("icon:")
        ? a.ic.slice(5)
        : a.kind === "liability"
          ? "credit"
          : "bank",
      openingCents:
        signed -
        ledger.transactions.reduce((s, t) => s + flow(t, String(a.id)), 0),
      costCents:
        a.cost === undefined || a.cost === null || a.cost === ""
          ? null
          : cents(a.cost),
      hidden: !!a.hidden,
      currency: a.currency || a.cur || "CNY",
    };
  });
  ledger.merchantCategories = raw.merchantCatMap || {};
  for (const [key, value] of Object.entries(raw.budgets?.cats || {}))
    ledger.budgets[key] = cents(String(value));
  if (raw.budgets?.flexCap !== undefined || raw.budgets?.flex)
    ledger.budgetSettings = {
      flexCapCents: cents(raw.budgets.flexCap ?? 0),
      flex: raw.budgets.flex ?? {},
    };
  validateLedger(ledger);
  return ledger;
}
export function validateLedger(l: Ledger) {
  if (
    !l ||
    typeof l !== "object" ||
    l.schemaVersion !== 1 ||
    !Array.isArray(l.accounts) ||
    !Array.isArray(l.transactions)
  )
    throw Error("账本版本不支持");
  if (
    !l.budgets ||
    typeof l.budgets !== "object" ||
    Array.isArray(l.budgets) ||
    Object.values(l.budgets).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !l.merchantCategories ||
    typeof l.merchantCategories !== "object" ||
    Array.isArray(l.merchantCategories) ||
    Object.values(l.merchantCategories).some((c) => typeof c !== "string")
  )
    throw Error("预算或分类规则无效");
  if (
    l.budgetSettings &&
    (!Number.isSafeInteger(l.budgetSettings.flexCapCents) ||
      l.budgetSettings.flexCapCents < 0 ||
      !l.budgetSettings.flex ||
      typeof l.budgetSettings.flex !== "object" ||
      Array.isArray(l.budgetSettings.flex) ||
      Object.values(l.budgetSettings.flex).some((b) => typeof b !== "boolean"))
  )
    throw Error("弹性预算设置无效");
  const ids = new Set<string>();
  for (const a of l.accounts) {
    if (
      !a ||
      typeof a.id !== "string" ||
      !a.id ||
      a.id.length > 128 ||
      ids.has(a.id) ||
      typeof a.name !== "string" ||
      !a.name.trim() ||
      typeof a.role !== "string" ||
      typeof a.icon !== "string" ||
      typeof a.hidden !== "boolean" ||
      typeof a.currency !== "string" ||
      !/^[A-Z]{3}$/.test(a.currency) ||
      !["asset", "liability"].includes(a.kind) ||
      !Number.isSafeInteger(a.openingCents) ||
      (a.costCents !== null &&
        (!Number.isSafeInteger(a.costCents) || a.costCents < 0))
    )
      throw Error("账户数据无效");
    ids.add(a.id);
  }
  const txIds = new Set<string>();
  for (const t of l.transactions) {
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id ||
      t.id.length > 128 ||
      typeof t.merchant !== "string" ||
      typeof t.category !== "string" ||
      typeof t.note !== "string" ||
      (t.postedDate !== undefined && !validDate(t.postedDate)) ||
      txIds.has(t.id) ||
      !["income", "expense", "transfer"].includes(t.type)
    )
      throw Error("交易数据无效");
    txIds.add(t.id);
    saveTransaction({ ...l, transactions: [] }, t);
  }
}
export const normalizeMerchant = (s: string) =>
  s
    .trim()
    .replace(/[-_\s]+/g, " ")
    .toUpperCase();
export function reconcile(
  l: Ledger,
  t: Transaction,
): "new" | "duplicate" | "review" {
  const same = l.transactions.filter(
    (x) =>
      x.accountId === t.accountId &&
      x.type === t.type &&
      x.cents === t.cents &&
      normalizeMerchant(x.merchant) === normalizeMerchant(t.merchant),
  );
  if (same.some((x) => x.date === t.date)) return "duplicate";
  return same.some(
    (x) => Math.abs(+new Date(x.date) - +new Date(t.date)) <= 3 * 86400000,
  )
    ? "review"
    : "new";
}
export function parseBill(
  text: string,
  accountId: string,
  year: number,
): Transaction[] {
  const date = (s: string) => {
    const parts = s.replace(/\//g, "-").split("-");
    return parts.length === 2
      ? `${year}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`
      : `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  };
  const results: Transaction[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line
      .trim()
      .match(
        /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\s+(?:(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2})\s+)?(.+?)\s+[¥￥]?(-?[\d,]+(?:\.\d{1,2})?)\s*$/,
      );
    if (!m) continue;
    const amount = cents(m[4]);
    if (!amount || !validDate(date(m[1]))) continue;
    results.push({
      id: "",
      type: amount < 0 ? "income" : "expense",
      cents: Math.abs(amount),
      accountId,
      date: date(m[1]),
      postedDate: date(m[2] || m[1]),
      merchant: m[3],
      category: amount < 0 ? "i01" : "e01",
      note: "",
    });
  }
  return results;
}
