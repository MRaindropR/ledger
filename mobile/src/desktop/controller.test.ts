import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { DesktopStore } from "./store";
import { DesktopController, type Legacy, type Action } from "./controller";
test("desktop controllers preserve concurrent edits, reload and delta undo", async () => {
  const factory = new IDBFactory(),
    first = new DesktopController(new DesktopStore(factory, "controllers")),
    second = new DesktopController(new DesktopStore(factory, "controllers"));
  const originalCrypto = globalThis.crypto;
  // Browser Crypto methods require the correct receiver; model this in the regression test.
  const browserCrypto = {
    randomUUID() {
      assert.equal(this, browserCrypto);
      return originalCrypto.randomUUID();
    },
  };
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: browserCrypto,
  });
  const reducer = (l: Legacy, a: Action): Legacy => ({
    ...l,
    accs: [
      ...l.accs,
      {
        id: String(a.p),
        n: String(a.p),
        kind: "asset",
        role: "cash",
        ic: "cash",
        cur: "CNY",
        currency: "CNY",
        bal: 100,
        cost: null,
        hidden: false,
      },
    ],
  });
  try {
    await first.initialize(null);
    await second.initialize(null);
    await Promise.all([
      first.dispatch({ type: "ADD_ACC", p: "one" }, reducer),
      second.dispatch({ type: "ADD_ACC", p: "two" }, reducer),
    ]);
    await first.dispatch({ type: "UNDO" }, reducer);
    assert.deepEqual(
      first.getState().row!.snapshot.ledger.accounts.map((a) => a.id),
      ["two"],
    );
    await assert.rejects(
      first.restore({
        schemaVersion: 1,
        accounts: [],
        transactions: [{ id: "bad" }],
      }),
    );
    assert.equal(first.getState().save.state, "error");
    const reloaded = new DesktopController(
      new DesktopStore(factory, "controllers"),
    );
    try {
      await reloaded.initialize(null);
      assert.deepEqual(
        reloaded.getState().row!.snapshot.ledger.accounts.map((a) => a.id),
        ["two"],
      );
      assert.equal(reloaded.getState().save.state, "saved");
      assert.equal(
        JSON.parse(reloaded.exportJSON()).accounts[0].openingCents,
        10000,
      );
    } finally {
      await reloaded.close();
    }
  } finally {
    await first.close();
    await second.close();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});
test("desktop restore preserves a durable pre-import copy and keeps it out of exported ledger", async () => {
  const factory = new IDBFactory(),
    store = new DesktopStore(factory, "recovery"),
    controller = new DesktopController(store);
  try {
    await controller.initialize({
      schemaVersion: 1,
      accounts: [],
      transactions: [],
      budgets: { e02: 1000 },
      merchantCategories: {},
    });
    await controller.restore({
      schemaVersion: 1,
      accounts: [],
      transactions: [],
      budgets: { e02: 2000 },
      merchantCategories: {},
    });
    const row = await store.read();
    assert.equal(
      row?.snapshot.local?.recoveryPoints[0].ledger.budgets.e02,
      1000,
    );
    assert.equal(row?.snapshot.ledger.budgets.e02, 2000);
    assert.equal(JSON.parse(controller.exportJSON()).local, undefined);
    const reloaded = new DesktopController(
      new DesktopStore(factory, "recovery"),
    );
    try {
      await reloaded.initialize(null);
      assert.equal(
        reloaded.getState().row?.snapshot.local?.recoveryPoints[0].ledger
          .budgets.e02,
        1000,
      );
      await reloaded.restore(
        reloaded.getState().row!.snapshot.local!.recoveryPoints[0].ledger,
      );
      assert.equal(reloaded.getState().row?.snapshot.ledger.budgets.e02, 1000);
      assert.equal(
        reloaded.getState().row?.snapshot.local?.recoveryPoints[0].ledger
          .budgets.e02,
        2000,
      );
    } finally {
      await reloaded.close();
    }
  } finally {
    await controller.close();
  }
});
