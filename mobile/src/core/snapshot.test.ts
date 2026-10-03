import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySnapshot,
  SnapshotQueue,
  changeLedger,
  bindSnapshot,
} from "./snapshot";
import type { Account } from "./ledger";
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
test("serialized saves preserve both edits and their durable pending queue", async () => {
  const writes: string[] = [];
  let id = 0;
  const queue = new SnapshotQueue(emptySnapshot(), async (s) => {
    await Promise.resolve();
    writes.push(JSON.stringify(s));
  });
  await Promise.all([
    queue.change((s) =>
      changeLedger(
        s,
        (l) => ({ ...l, accounts: [account] }),
        () => String(++id),
      ),
    ),
    queue.change((s) =>
      changeLedger(
        s,
        (l) => ({ ...l, accounts: [...l.accounts, { ...account, id: "b" }] }),
        () => String(++id),
      ),
    ),
  ]);
  assert.equal(queue.current.ledger.accounts.length, 2);
  assert.equal(Object.keys(queue.current.sync.pending).length, 3);
  assert.equal(JSON.parse(writes[1]).ledger.accounts.length, 2);
});
test("failed persistence does not publish changes, subsequent save still works", async () => {
  let fail = true;
  const queue = new SnapshotQueue(emptySnapshot(), async () => {
    if (fail) throw Error("disk full");
  });
  await assert.rejects(
    queue.change((s) =>
      changeLedger(
        s,
        (l) => ({ ...l, accounts: [account] }),
        () => "op",
      ),
    ),
    /disk full/,
  );
  assert.equal(queue.current.ledger.accounts.length, 0);
  assert.equal(Object.keys(queue.current.sync.pending).length, 0);
  fail = false;
  await queue.change((s) =>
    changeLedger(
      s,
      (l) => ({ ...l, accounts: [account] }),
      () => "op",
    ),
  );
  assert.equal(queue.current.ledger.accounts.length, 1);
});
test("a connected local ledger cannot silently move to a different owner", () => {
  const binding = {
    projectUrl: "https://example.supabase.co",
    ownerId: "alice",
    bookId: "book",
  };
  const snapshot = bindSnapshot(emptySnapshot(), binding, () => "op");
  assert.throws(
    () => bindSnapshot(snapshot, { ...binding, ownerId: "bob" }, () => "op"),
    /不能直接切换/,
  );
});
