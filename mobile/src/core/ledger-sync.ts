import type { Ledger } from "./ledger";
import {
  queueChange,
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
      accountOrder: ledger.accounts.map((a) => a.id),
    },
  });
  return result;
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
