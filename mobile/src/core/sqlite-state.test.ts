import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  initializeStateDatabase,
  loadStateDatabase,
  saveStateDatabase,
  type StateDatabase,
} from "./sqlite-state";
import { emptySnapshot } from "./snapshot";
import { LedgerSession } from "./ledger-session";
function port(db: DatabaseSync): StateDatabase {
  return {
    execAsync: async (sql) => db.exec(sql),
    getAllAsync: async <T>(sql: string) => db.prepare(sql).all() as T[],
    getFirstAsync: async <T>(sql: string) =>
      (db.prepare(sql).get() ?? null) as T | null,
    runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
  };
}
test("real SQLite migration retains existing ledger and persists recovery copies, identity and share time", async () => {
  const db = new DatabaseSync(":memory:"),
    api = port(db),
    old = emptySnapshot().ledger;
  old.budgets = { e02: 1234 };
  try {
    db.exec(
      "CREATE TABLE ledger_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL,saved_at TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO ledger_state VALUES(1,?,?)").run(
      JSON.stringify(old),
      "old",
    );
    await initializeStateDatabase(api);
    await initializeStateDatabase(api);
    const loaded = await loadStateDatabase(api, () => crypto.randomUUID());
    assert.deepEqual(loaded.ledger, old);
    assert.ok(Object.keys(loaded.sync.pending).length > 0);
    loaded.binding = {
      projectUrl: "https://project.supabase.co",
      ownerId: "owner",
      bookId: "book",
    };
    const q = new LedgerSession(loaded, (s) => saveStateDatabase(api, s));
    await q.restore({ ...old, budgets: { e02: 5000 } }, () =>
      crypto.randomUUID(),
    );
    await q.change((s) => ({
      ...s,
      local: { ...s.local!, lastShareOpenedAt: "2026-10-03T04:00:00Z" },
    }));
    const restarted = await loadStateDatabase(api, () => crypto.randomUUID());
    assert.equal(restarted.local?.recoveryPoints[0].ledger.budgets.e02, 1234);
    assert.equal(restarted.ledger.budgets.e02, 5000);
    assert.equal(restarted.local?.lastShareOpenedAt, "2026-10-03T04:00:00Z");
    assert.deepEqual(restarted.sync, q.current.sync);
    assert.deepEqual(restarted.binding, q.current.binding);
    assert.equal(restarted.binding?.bookId, "book");
  } finally {
    db.close();
  }
});
test("real SQLite aborted write does not publish the replacement or its checkpoint", async () => {
  const db = new DatabaseSync(":memory:"),
    api = port(db);
  try {
    await initializeStateDatabase(api);
    const q = new LedgerSession(emptySnapshot(), (s) =>
      saveStateDatabase(api, s),
    );
    await q.mutate(
      (l) => ({ ...l, budgets: { e02: 100 } }),
      () => crypto.randomUUID(),
    );
    const before = await loadStateDatabase(api, () => crypto.randomUUID());
    db.exec(
      "CREATE TRIGGER fail_write BEFORE UPDATE ON ledger_state BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
    );
    await assert.rejects(
      q.restore({ ...q.current.ledger, budgets: { e02: 200 } }, () =>
        crypto.randomUUID(),
      ),
      /disk full/,
    );
    assert.deepEqual(
      await loadStateDatabase(api, () => crypto.randomUUID()),
      before,
    );
    assert.equal(q.current.ledger.budgets.e02, 100);
    assert.equal(q.current.local, undefined);
  } finally {
    db.close();
  }
});
