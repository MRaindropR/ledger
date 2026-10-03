import test from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, type Account } from "./ledger";
import { emptySync, uploadable } from "./sync";
import { queueLedgerChanges } from "./ledger-sync";
const account: Account = {
  id: "a",
  name: "现金",
  kind: "asset",
  role: "cash",
  icon: "cash",
  openingCents: 0,
  costCents: null,
  hidden: false,
  currency: "CNY",
};
test("local edits produce separate entity operations and deletion tombstones", () => {
  const before = emptyLedger(),
    after = { ...before, accounts: [account] };
  let seq = 0;
  const queued = queueLedgerChanges(emptySync(), before, after, () =>
    String(++seq),
  );
  assert.equal(uploadable(queued).length, 2);
  const deleted = queueLedgerChanges(queued, after, before, () =>
    String(++seq),
  );
  assert.equal(deleted.pending["account:a"].deleted, true);
  assert.equal(deleted.pending["account:a"].baseVersion, 0);
});
test("unchanged state does not enqueue; account ordering is persisted separately", () => {
  const before = {
    ...emptyLedger(),
    accounts: [account, { ...account, id: "b" }],
  };
  let seq = 0;
  assert.equal(
    uploadable(
      queueLedgerChanges(emptySync(), before, before, () => String(++seq)),
    ).length,
    0,
  );
  const after = { ...before, accounts: [...before.accounts].reverse() };
  const queued = queueLedgerChanges(emptySync(), before, after, () =>
    String(++seq),
  );
  assert.deepEqual(Object.keys(queued.pending), ["settings:main"]);
});
