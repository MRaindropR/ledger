import {
  emptyLedger,
  validateLedger,
  type Account,
  type Transaction,
  type Ledger,
} from "./ledger";
import {
  queueChange,
  materialize,
  type SyncState,
  type JsonValue,
  type EntityKind,
} from "./sync";

function entities(
  ledger: Ledger,
): Map<string, { kind: EntityKind; id: string; value: JsonValue }> {
  const result = new Map<
    string,
    { kind: EntityKind; id: string; value: JsonValue }
  >();
  for (const account of ledger.accounts)
    result.set("account:" + account.id, {
      kind: "account",
      id: account.id,
      value: JSON.parse(JSON.stringify(account)),
    });
  for (const tx of ledger.transactions)
    result.set("transaction:" + tx.id, {
      kind: "transaction",
      id: tx.id,
      value: JSON.parse(JSON.stringify(tx)),
    });
  result.set("settings:main", {
    kind: "settings",
    id: "main",
    value: {
      budgets: ledger.budgets,
      merchantCategories: ledger.merchantCategories,
      budgetSettings: JSON.parse(JSON.stringify(ledger.budgetSettings ?? null)),
      accountOrder: ledger.accounts.map((a) => a.id),
    },
  });
  return result;
}

export function ledgerFromSync(state: SyncState): Ledger {
  const entries = materialize(state),
    ledger = emptyLedger();
  const settings = entries.find(
    (e) => e.kind === "settings" && e.id === "main",
  );
  const value = settings?.value as
    | {
        budgets?: Record<string, number>;
        merchantCategories?: Record<string, string>;
        accountOrder?: string[];
        budgetSettings?: Ledger["budgetSettings"];
      }
    | undefined;
  ledger.budgets = value?.budgets ?? {};
  ledger.merchantCategories = value?.merchantCategories ?? {};
  if (value?.budgetSettings) ledger.budgetSettings = value.budgetSettings;
  const order = new Map((value?.accountOrder ?? []).map((id, i) => [id, i]));
  ledger.accounts = entries
    .filter((e) => e.kind === "account")
    .map((e) => e.value as Account)
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  ledger.transactions = entries
    .filter((e) => e.kind === "transaction")
    .map((e) => e.value as Transaction)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  validateLedger(ledger);
  return ledger;
}

/** Keep every local edit queued until the server acknowledges its revision. */
export function queueLedgerChanges(
  state: SyncState,
  before: Ledger,
  after: Ledger,
  id: () => string,
): SyncState {
  const previous = entities(before),
    next = entities(after);
  let result = state;
  for (const [key, entity] of next)
    if (
      JSON.stringify(previous.get(key)?.value) !== JSON.stringify(entity.value)
    ) {
      result = queueChange(result, {
        ...entity,
        deleted: false,
        operationId: id(),
      });
    }
  for (const [key, entity] of previous)
    if (!next.has(key))
      result = queueChange(result, {
        ...entity,
        value: null,
        deleted: true,
        operationId: id(),
      });
  return result;
}
