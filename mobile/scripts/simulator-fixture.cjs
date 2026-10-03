// Synthetic CI data only. The production app and its bundled JS are unchanged.
const { DatabaseSync } = require("node:sqlite");
const date =
  process.env.SMOKE_FIXTURE_DATE || new Date().toISOString().slice(0, 10);
const account = (id, kind, openingCents) => ({
  id,
  name: kind === "asset" ? "CI现金" : "CI信用卡",
  kind,
  role: kind === "asset" ? "cash" : "credit",
  icon: kind === "asset" ? "cash" : "credit",
  openingCents,
  costCents: null,
  hidden: false,
  currency: "CNY",
});
const tx = (id, type, cents, accountId, toAccountId) => ({
  id,
  type,
  cents,
  accountId,
  ...(toAccountId ? { toAccountId } : {}),
  date,
  merchant: "CI测试流水",
  category: type === "income" ? "i01" : "e02",
  note: "",
});
const ledger = {
  schemaVersion: 1,
  accounts: [account("a", "asset", 10000), account("d", "liability", -10000)],
  transactions: [
    tx("1", "income", 2000, "a"),
    tx("2", "expense", 500, "a"),
    tx("3", "transfer", 3000, "a", "d"),
    tx("4", "expense", 1000, "d"),
  ],
  budgets: {},
  merchantCategories: {},
};
if (require.main === module) {
  const db = new DatabaseSync(process.argv[2]);
  if (process.argv[3] === "verify") {
    const columns = db
      .prepare("PRAGMA table_info(ledger_state)")
      .all()
      .map((x) => x.name);
    for (const name of ["sync_json", "binding_json", "local_json"])
      if (!columns.includes(name))
        throw Error("Native migration did not create " + name);
    const stored = JSON.parse(
      db.prepare("SELECT json FROM ledger_state WHERE id=1").get().json,
    );
    if (JSON.stringify(stored) !== JSON.stringify(ledger))
      throw Error("Seeded ledger changed unexpectedly");
    console.log("Native SQLite migration retained the synthetic ledger.");
  } else {
    // Start with the original three-column schema to exercise the real native migration.
    db.exec(
      "CREATE TABLE ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, saved_at TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO ledger_state VALUES(1,?,?)").run(
      JSON.stringify(ledger),
      new Date().toISOString(),
    );
  }
  db.close();
}
module.exports = { ledger };
