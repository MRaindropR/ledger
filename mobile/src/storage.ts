import * as SQLite from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { emptyLedger, validateLedger } from "./core/ledger";
import { emptySync } from "./core/sync";
import { queueLedgerChanges } from "./core/ledger-sync";
import { emptySnapshot, type Snapshot } from "./core/snapshot";
let connection: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!connection)
    connection = (async () => {
      const d = await SQLite.openDatabaseAsync("smartledger.sqlite");
      await d.execAsync(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, saved_at TEXT NOT NULL);",
      );
      const columns = await d.getAllAsync<{ name: string }>(
        "PRAGMA table_info(ledger_state)",
      );
      for (const name of ["sync_json", "binding_json"])
        if (!columns.some((c) => c.name === name))
          await d.execAsync(`ALTER TABLE ledger_state ADD COLUMN ${name} TEXT`);
      return d;
    })();
  return connection;
}
export async function loadSnapshot(): Promise<Snapshot> {
  const row = await (
    await db()
  ).getFirstAsync<{
    json: string;
    sync_json: string | null;
    binding_json: string | null;
  }>("SELECT json,sync_json,binding_json FROM ledger_state WHERE id=1");
  if (!row) return emptySnapshot();
  const ledger = JSON.parse(row.json);
  validateLedger(ledger);
  return {
    ledger,
    sync: row.sync_json
      ? JSON.parse(row.sync_json)
      : queueLedgerChanges(emptySync(), emptyLedger(), ledger, randomUUID),
    binding: row.binding_json ? JSON.parse(row.binding_json) : null,
  };
}
export async function persistSnapshot(snapshot: Snapshot) {
  validateLedger(snapshot.ledger);
  // One statement commits ledger, pending operations and book binding atomically.
  await (
    await db()
  ).runAsync(
    "INSERT INTO ledger_state(id,json,saved_at,sync_json,binding_json) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,saved_at=excluded.saved_at,sync_json=excluded.sync_json,binding_json=excluded.binding_json",
    JSON.stringify(snapshot.ledger),
    new Date().toISOString(),
    JSON.stringify(snapshot.sync),
    JSON.stringify(snapshot.binding),
  );
}
