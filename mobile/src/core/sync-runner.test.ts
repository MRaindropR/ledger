import test from "node:test";
import assert from "node:assert/strict";
import { emptySync, queueChange, type Entity } from "./sync";
import { exchange, mergeExchange, remoteEntity } from "./sync-runner";
const op = {
  kind: "account" as const,
  id: "a",
  value: { id: "a", name: "现金" },
  deleted: false,
  operationId: "one",
};
test("exchange paginates, preserves edits made while network is in flight", async () => {
  const initial = queueChange(emptySync(), op);
  let pulls = 0;
  const result = await exchange(initial, {
    apply: async (ops) =>
      ops.map((o) => ({
        status: "accepted",
        operationId: o.operationId,
        remote: { ...o, version: 1 },
      })),
    pull: async (cursor) => {
      pulls++;
      return cursor === 0 ? [{ cursor: 4, entity: { ...op, version: 1 } }] : [];
    },
  });
  const edited = queueChange(initial, {
    ...op,
    operationId: "two",
    value: { id: "a", name: "零钱" },
  });
  const merged = mergeExchange(edited, result);
  assert.equal(pulls, 2);
  assert.equal(merged.cursor, 4);
  assert.equal(merged.pending["account:a"].operationId, "two");
  assert.equal(merged.pending["account:a"].baseVersion, 1);
  assert.equal(Object.keys(merged.conflicts).length, 0);
});
test("network failure and incomplete acknowledgements never clear local queue", async () => {
  const initial = queueChange(emptySync(), op);
  await assert.rejects(
    exchange(initial, { apply: async () => [], pull: async () => [] }),
    /完整确认/,
  );
  await assert.rejects(
    exchange(initial, {
      apply: async () => {
        throw Error("offline");
      },
      pull: async () => [],
    }),
    /offline/,
  );
  assert.equal(Object.keys(initial.pending).length, 1);
});
test("remote conflict is explicit, malformed records and repeated cursors rejected", async () => {
  const initial = queueChange(emptySync(), op),
    remote: Entity = {
      ...op,
      version: 2,
      operationId: "other",
      value: { id: "a", name: "另一台设备" },
    };
  const result = await exchange(initial, {
    apply: async () => [
      { status: "conflict", operationId: op.operationId, remote },
    ],
    pull: async () => [],
  });
  assert.equal(Object.keys(mergeExchange(initial, result).conflicts).length, 1);
  assert.throws(
    () => remoteEntity({ ...remote, value: { id: "wrong" } }),
    /ID/,
  );
  await assert.rejects(
    exchange(emptySync(), {
      apply: async () => [],
      pull: async () => [{ cursor: 0, entity: remote }],
    }),
    /游标/,
  );
});
