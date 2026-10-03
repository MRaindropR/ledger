import { cents, validateLedger, type Ledger } from "./ledger";
/** Keep the existing desktop definition of discretionary categories. */
export const defaultFlexible = new Set([
  "e04",
  "e07",
  "e09",
  "e11",
  "e14",
  "e19",
  "e20",
  "e22",
  "e24",
  "e26",
  "e30",
  "e31",
  "e32",
  "e36",
  "e37",
  "e38",
  "e39",
]);
export const hiddenBudgetCategories = new Set(["e28", "e29", "e42"]);
export const isFlexible = (ledger: Ledger, id: string) =>
  ledger.budgetSettings?.flex[id] ?? defaultFlexible.has(id);
export type BudgetProgress = {
  limit: number;
  spent: number;
  remaining: number;
  ratio: number | null;
};
export function budgetProgress(limit: number, spent: number): BudgetProgress {
  return {
    limit,
    spent,
    remaining: limit - spent,
    ratio: limit > 0 ? spent / limit : null,
  };
}
export function monthlyBudget(ledger: Ledger, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error("预算月份无效");
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a])),
    spent: Record<string, number> = {};
  let flexibleSpent = 0,
    total = 0;
  for (const tx of ledger.transactions) {
    if (
      tx.type !== "expense" ||
      !tx.date.startsWith(month + "-") ||
      accounts.get(tx.accountId)?.currency !== "CNY"
    )
      continue;
    spent[tx.category] = (spent[tx.category] ?? 0) + tx.cents;
    total += tx.cents;
    if (isFlexible(ledger, tx.category)) flexibleSpent += tx.cents;
  }
  return {
    total,
    flexible: budgetProgress(
      ledger.budgetSettings?.flexCapCents ?? 0,
      flexibleSpent,
    ),
    categories: Object.entries(ledger.budgets)
      .filter(([, n]) => n > 0)
      .map(([id, limit]) => ({
        id,
        ...budgetProgress(limit, spent[id] ?? 0),
        flexible: isFlexible(ledger, id),
      })),
  };
}
export type BudgetDraft = {
  amounts: Record<string, string>;
  flex: Record<string, boolean>;
  cap: string;
};
export function budgetDraft(ledger: Ledger): BudgetDraft {
  return {
    amounts: Object.fromEntries(
      Object.entries(ledger.budgets).map(([id, n]) => [
        id,
        n ? String(n / 100) : "",
      ]),
    ),
    flex: { ...ledger.budgetSettings?.flex },
    cap: ledger.budgetSettings?.flexCapCents
      ? String(ledger.budgetSettings.flexCapCents / 100)
      : "",
  };
}
const parseLimit = (text: string) => {
  const n = text.trim() ? cents(text) : 0;
  if (n < 0) throw Error("预算不能为负数");
  return n;
};
/** Merge only edited settings; never overwrite later changes made by another device. */
export function applyBudgetDraft(
  current: Ledger,
  base: Ledger,
  draft: BudgetDraft,
): Ledger {
  const next = { ...current, budgets: { ...current.budgets } },
    flex = { ...current.budgetSettings?.flex };
  let changed = false;
  for (const id of new Set([
    ...Object.keys(base.budgets),
    ...Object.keys(draft.amounts),
  ])) {
    const value = parseLimit(draft.amounts[id] ?? ""),
      old = base.budgets[id] ?? 0;
    if (value === old) continue;
    if ((current.budgets[id] ?? 0) !== old)
      throw Error("预算已在其他设备更新，请关闭后重新编辑");
    if (value) next.budgets[id] = value;
    else delete next.budgets[id];
    changed = true;
  }
  for (const id of new Set([
    ...Object.keys(base.budgetSettings?.flex ?? {}),
    ...Object.keys(draft.flex),
  ])) {
    const value = draft.flex[id] ?? defaultFlexible.has(id),
      old = isFlexible(base, id);
    if (value === old) continue;
    if (isFlexible(current, id) !== old)
      throw Error("预算分类已在其他设备更新，请关闭后重新编辑");
    flex[id] = value;
    changed = true;
  }
  const cap = parseLimit(draft.cap),
    oldCap = base.budgetSettings?.flexCapCents ?? 0;
  if (cap !== oldCap && (current.budgetSettings?.flexCapCents ?? 0) !== oldCap)
    throw Error("非必需预算已在其他设备更新，请关闭后重新编辑");
  if (changed || cap !== oldCap)
    next.budgetSettings = {
      flexCapCents:
        cap !== oldCap ? cap : (current.budgetSettings?.flexCapCents ?? 0),
      flex,
    };
  validateLedger(next);
  return next;
}
