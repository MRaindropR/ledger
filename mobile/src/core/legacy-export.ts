import { balance, validateLedger, type Ledger } from "./ledger";
type Previous = {
  accs?: Record<string, unknown>[];
  txs?: Record<string, unknown>[];
  budgets?: Record<string, unknown>;
};
/** Render the same normalized ledger through the existing HTML UI without losing its local display metadata. */
export function exportLegacy(ledger: Ledger, previous: Previous = {}) {
  validateLedger(ledger);
  const accounts = new Map((previous.accs ?? []).map((a) => [String(a.id), a])),
    transactions = new Map((previous.txs ?? []).map((t) => [String(t.id), t]));
  return {
    nativeBridgeVersion: 1,
    accs: ledger.accounts.map((a) => ({
      ...accounts.get(a.id),
      id: a.id,
      n: a.name,
      kind: a.kind,
      role: a.role,
      ic: "icon:" + a.icon,
      cur: a.currency,
      currency: a.currency,
      bal: balance(ledger, a) / 100,
      cost: a.costCents === null ? null : a.costCents / 100,
      hidden: a.hidden,
    })),
    txs: ledger.transactions.map((t) => ({
      ...transactions.get(t.id),
      id: t.id,
      tp: t.type,
      amt: t.cents / 100,
      acc: t.accountId,
      acc2: t.toAccountId,
      dt: t.date,
      postDate: t.postedDate,
      m: t.merchant,
      cat: t.category,
      note: t.note,
    })),
    merchantCatMap: ledger.merchantCategories,
    budgets: {
      ...previous.budgets,
      cats: Object.fromEntries(
        Object.entries(ledger.budgets).map(([id, n]) => [id, n / 100]),
      ),
      ...(ledger.budgetSettings
        ? {
            flexCap: ledger.budgetSettings.flexCapCents / 100,
            flex: ledger.budgetSettings.flex,
          }
        : {}),
    },
  };
}
