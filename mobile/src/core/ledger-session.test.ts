import test from "node:test";
import assert from "node:assert/strict";
import { LedgerSession } from "./ledger-session";
import { emptySnapshot } from "./snapshot";
import { emptyLedger, type Account } from "./ledger";
import { protectedRestore, validateLocal } from "./recovery";
const a: Account = {
  id: "a",
  name: "现金",
  kind: "asset",
  role: "cash",
  icon: "cash",
  currency: "CNY",
  hidden: false,
  costCents: null,
  openingCents: 10000,
};
let sequence = 0;
const id = () => String(++sequence);
test("recovery and restore are one persisted change; failed writes preserve ledger, outbox and history", async () => {
  let fail = false,
    persisted = emptySnapshot();
  const q = new LedgerSession(emptySnapshot(), async (s) => {
    if (fail) throw Error("disk full");
    persisted = structuredClone(s);
  });
  await q.mutate((l) => ({ ...l, accounts: [a] }), id);
  const old = structuredClone(q.current);
  fail = true;
  await assert.rejects(q.restore(emptyLedger(), id), /disk full/);
  assert.deepEqual(q.current, old);
  assert.deepEqual(persisted, old);
  fail = false;
  await q.restore(emptyLedger(), id);
  assert.deepEqual(q.current.local?.recoveryPoints[0].ledger, old.ledger);
  assert.equal(q.current.ledger.accounts.length, 0);
  await q.undo(id);
  assert.equal(q.current.ledger.accounts.length, 1);
  validateLocal(q.current.local);
});
test("concurrent local writes and undo serialize, remote changes do not enter local history", async () => {
  const q = new LedgerSession(emptySnapshot(), async () => {});
  await Promise.all([
    q.mutate((l) => ({ ...l, accounts: [...l.accounts, a] }), id),
    q.mutate(
      (l) => ({ ...l, accounts: [...l.accounts, { ...a, id: "b" }] }),
      id,
    ),
  ]);
  await q.change((s) => ({
    ...s,
    ledger: {
      ...s.ledger,
      accounts: [...s.ledger.accounts, { ...a, id: "remote" }],
    },
  }));
  await q.undo(id);
  assert.deepEqual(
    q.current.ledger.accounts.map((a) => a.id),
    ["a", "remote"],
  );
  await q.undo(id);
  assert.deepEqual(
    q.current.ledger.accounts.map((a) => a.id),
    ["remote"],
  );
  assert.equal(q.canUndo, false);
});
test("recovery points retain three copies and restore keeps book identity rather than old sync metadata", () => {
  let snapshot = {
    ...emptySnapshot(),
    ledger: { ...emptyLedger(), accounts: [a] },
    binding: {
      projectUrl: "https://project.supabase.co",
      ownerId: "owner",
      bookId: "book",
    },
  };
  for (let i = 0; i < 5; i++)
    snapshot = protectedRestore(
      snapshot,
      { ...snapshot.ledger, budgets: { e02: i * 100 } },
      id,
    ) as typeof snapshot;
  assert.equal(snapshot.local?.recoveryPoints.length, 3);
  assert.equal(snapshot.binding?.bookId, "book");
  assert.equal(snapshot.local?.recoveryPoints[0].ledger.budgets.e02, 300);
});
