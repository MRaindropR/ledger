import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { DesktopStore, type DesktopRecord } from "./store";
import { emptySnapshot, changeLedger } from "../core/snapshot";
import { exportLegacy } from "../core/legacy-export";
import type { Account } from "../core/ledger";
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
const initial = (): DesktopRecord => ({
  snapshot: emptySnapshot(),
  legacy: exportLegacy(emptySnapshot().ledger),
  revision: 0,
  savedAt: "",
});
test("two tabs atomically preserve both local edits and pending operations", async () => {
  const factory = new IDBFactory(),
    first = new DesktopStore(factory, "test"),
    second = new DesktopStore(factory, "test");
  let op = 0;
  const add = (id: string) => (row: DesktopRecord | null) => {
    const old = row ?? initial(),
      snapshot = changeLedger(
        old.snapshot,
        (l) => ({ ...l, accounts: [...l.accounts, { ...account, id }] }),
        () => String(++op),
      );
    return {
      ...old,
      snapshot,
      legacy: exportLegacy(snapshot.ledger, old.legacy),
      revision: old.revision + 1,
    };
  };
  await Promise.all([first.update(add("a")), second.update(add("b"))]);
  const row = await first.read();
  assert.equal(row?.snapshot.ledger.accounts.length, 2);
  assert.equal(row?.revision, 2);
  assert.equal(Object.keys(row!.snapshot.sync.pending).length, 3);
  await assert.rejects(
    second.update(() => {
      throw Error("invalid import");
    }),
    /invalid import/,
  );
  assert.deepEqual(await second.read(), row);
  await first.close();
  await second.close();
});
