import { flow, type Ledger, type Transaction } from "./ledger";

/** Swap adjacent accounts in the displayed column, leaving other columns/hidden slots intact. */
export function moveAccount(
  ledger: Ledger,
  id: string,
  direction: -1 | 1,
  showHidden = false,
): Ledger {
  const source = ledger.accounts.find((a) => a.id === id);
  if (!source) throw Error("账户已不存在");
  const indices = ledger.accounts.flatMap((a, i) =>
    a.kind === source.kind && (showHidden || !a.hidden) ? [i] : [],
  );
  const position = indices.findIndex((i) => ledger.accounts[i].id === id);
  const target = indices[position + direction];
  if (position < 0 || target === undefined) return ledger;
  const accounts = [...ledger.accounts];
  const current = indices[position];
  [accounts[current], accounts[target]] = [accounts[target], accounts[current]];
  return { ...ledger, accounts };
}

export type AccountEntry = {
  transaction: Transaction;
  delta: number;
  balanceAfter: number;
};
export function accountStatement(ledger: Ledger, id: string) {
  const account = ledger.accounts.find((a) => a.id === id);
  if (!account) throw Error("账户已不存在");
  let current = account.openingCents,
    income = 0,
    expense = 0,
    transferIn = 0,
    transferOut = 0;
  const entries: AccountEntry[] = ledger.transactions
    .filter(
      (t) =>
        t.accountId === id || (t.type === "transfer" && t.toAccountId === id),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((transaction) => {
      const delta = flow(transaction, id);
      current += delta;
      if (transaction.type === "income") income += transaction.cents;
      else if (transaction.type === "expense") expense += transaction.cents;
      else if (delta > 0) transferIn += delta;
      else transferOut -= delta;
      return { transaction, delta, balanceAfter: current };
    })
    .reverse();
  return {
    account,
    entries,
    current,
    income,
    expense,
    transferIn,
    transferOut,
  };
}
