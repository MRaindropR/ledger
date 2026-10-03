import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { validateLedger, totals, type Ledger } from "./ledger";
const require = createRequire(import.meta.url);
test("standalone Expo Router build declares an explicit native URL scheme", () => {
  const config = JSON.parse(
    readFileSync(new URL("../../app.json", import.meta.url), "utf8"),
  );
  assert.equal(config.expo.scheme, "smartledger");
  assert.equal(config.expo.ios.bundleIdentifier, "com.mraindropr.smartledger");
  assert.ok(config.expo.plugins.includes("expo-router"));
});
test("native simulator fixture validates and matches all screenshot financial assertions", () => {
  const { ledger } = require("../../scripts/simulator-fixture.cjs") as {
    ledger: Ledger;
  };
  validateLedger(ledger);
  assert.deepEqual(totals(ledger), {
    assets: 8500,
    liabilities: 8000,
    net: 500,
  });
  assert.equal(
    ledger.transactions
      .filter((t) => t.type === "income")
      .reduce((s, t) => s + t.cents, 0),
    2000,
  );
  assert.equal(
    ledger.transactions
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + t.cents, 0),
    1500,
  );
  assert.ok(
    ledger.transactions.every((t) => t.date === ledger.transactions[0].date),
  );
  assert.equal(ledger.accounts.length, 2);
});
