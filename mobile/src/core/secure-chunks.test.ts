import test from "node:test";
import assert from "node:assert/strict";
import { chunkedStorage } from "./secure-chunks";
test("session chunks keep Unicode intact, failed rotation preserves previous session", async () => {
  const data = new Map<string, string>();
  let fail = false,
    id = 0;
  const storage = chunkedStorage(
    {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        if (fail && k.endsWith(".1")) throw Error("keychain unavailable");
        assert.ok(Buffer.byteLength(v) <= 1500);
        data.set(k, v);
      },
      removeItem: async (k) => {
        data.delete(k);
      },
    },
    () => String(++id),
  );
  const original = "旧会话🪴".repeat(500);
  await storage.setItem("auth", original);
  assert.equal(await storage.getItem("auth"), original);
  fail = true;
  await assert.rejects(
    storage.setItem("auth", "新会话".repeat(500)),
    /keychain/,
  );
  assert.equal(await storage.getItem("auth"), original);
  fail = false;
  await storage.removeItem("auth");
  assert.equal(await storage.getItem("auth"), null);
  assert.equal(data.size, 0);
});
