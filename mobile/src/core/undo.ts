import {
  validateLedger,
  type Ledger,
  type Account,
  type Transaction,
} from "./ledger";
import { sameValue as same } from "./value-equal";
function reverseItems<T extends { id: string }>(
  current: T[],
  before: T[],
  after: T[],
): T[] {
  const result = new Map(current.map((item) => [item.id, item])),
    previous = new Map(before.map((item) => [item.id, item])),
    expected = new Map(after.map((item) => [item.id, item]));
  for (const id of new Set([...previous.keys(), ...expected.keys()])) {
    const old = previous.get(id),
      saved = expected.get(id);
    if (same(old, saved)) continue;
    if (!same(result.get(id), saved))
      throw Error("记录已在其他设备修改，不能直接撤销");
    if (old) result.set(id, old);
    else result.delete(id);
  }
  return Array.from(result.values());
}
/** Undo only the local delta; unrelated transactions received later remain intact. */
export function undoLedger(
  current: Ledger,
  before: Ledger,
  after: Ledger,
): Ledger {
  const ledger = {
    ...current,
    accounts: reverseItems<Account>(
      current.accounts,
      before.accounts,
      after.accounts,
    ),
    transactions: reverseItems<Transaction>(
      current.transactions,
      before.transactions,
      after.transactions,
    ),
  };
  for (const field of [
    "budgets",
    "merchantCategories",
    "budgetSettings",
  ] as const) {
    if (!same(before[field], after[field])) {
      if (!same(current[field], after[field]))
        throw Error("设置已在其他设备修改，不能直接撤销");
      Object.assign(ledger, { [field]: before[field] });
    }
  }
  const changedOrder =
    before.accounts.map((a) => a.id).join("|") !==
    after.accounts.map((a) => a.id).join("|");
  if (changedOrder) {
    const expectedIds = new Set(after.accounts.map((a) => a.id));
    if (
      !same(
        current.accounts.filter((a) => expectedIds.has(a.id)).map((a) => a.id),
        after.accounts.map((a) => a.id),
      )
    )
      throw Error("账户排序已在其他设备修改，不能直接撤销");
    const order = new Map(before.accounts.map((a, i) => [a.id, i]));
    ledger.accounts.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  ledger.transactions.sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
  validateLedger(ledger);
  return ledger;
}
