import * as SQLite from "expo-sqlite";
import { emptyLedger, validateLedger, type Ledger } from "./core/ledger";
import { randomUUID } from "expo-crypto";
import { emptySync, type SyncState } from "./core/sync";
import { queueLedgerChanges } from "./core/ledger-sync";
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
      if (!columns.some((c) => c.name === "sync_json"))
        await d.execAsync("ALTER TABLE ledger_state ADD COLUMN sync_json TEXT");
      return d;
    })();
  return connection;
}
export async function loadLedger(): Promise<Ledger> {
  const row = await (
    await db()
  ).getFirstAsync<{ json: string }>("SELECT json FROM ledger_state WHERE id=1");
  if (!row) return emptyLedger();
  const result = JSON.parse(row.json);
  validateLedger(result);
  return result;
}
export async function persistLedger(ledger: Ledger) {
  validateLedger(ledger);
  const connection = await db();
  const previous = await connection.getFirstAsync<{
    json: string;
    sync_json: string | null;
  }>("SELECT json,sync_json FROM ledger_state WHERE id=1");
  const before = previous ? JSON.parse(previous.json) : emptyLedger();
  const sync: SyncState = previous?.sync_json
    ? JSON.parse(previous.sync_json)
    : emptySync();
  // A legacy local snapshot is queued on its first save, including unchanged entities.
  const queued = queueLedgerChanges(
    sync,
    previous?.sync_json ? before : emptyLedger(),
    ledger,
    randomUUID,
  );
  await connection.runAsync(
    "INSERT INTO ledger_state(id,json,saved_at,sync_json) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,saved_at=excluded.saved_at,sync_json=excluded.sync_json",
    JSON.stringify(ledger),
    new Date().toISOString(),
    JSON.stringify(queued),
  );
}
export async function loadSyncState(): Promise<SyncState> {
  const row = await (
    await db()
  ).getFirstAsync<{ sync_json: string | null }>(
    "SELECT sync_json FROM ledger_state WHERE id=1",
  );
  return row?.sync_json ? JSON.parse(row.sync_json) : emptySync();
}
