import { emptyLedger, validateLedger } from "./ledger";
import { emptySync } from "./sync";
import { queueLedgerChanges } from "./ledger-sync";
import { emptySnapshot, type Snapshot } from "./snapshot";
import { validateLocal } from "./recovery";
export interface StateDatabase {
  execAsync(sql: string): Promise<unknown>;
  getAllAsync<T>(sql: string): Promise<T[]>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  runAsync(sql: string, ...params: string[]): Promise<unknown>;
}
export async function initializeStateDatabase(db: StateDatabase) {
  await db.execAsync(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, saved_at TEXT NOT NULL);",
  );
  const columns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(ledger_state)",
  );
  for (const name of ["sync_json", "binding_json", "local_json"])
    if (!columns.some((c) => c.name === name))
      await db.execAsync(`ALTER TABLE ledger_state ADD COLUMN ${name} TEXT`);
}
export async function loadStateDatabase(
  db: StateDatabase,
  id: () => string,
): Promise<Snapshot> {
  const row = await db.getFirstAsync<{
    json: string;
    sync_json: string | null;
    binding_json: string | null;
    local_json: string | null;
  }>(
    "SELECT json,sync_json,binding_json,local_json FROM ledger_state WHERE id=1",
  );
  if (!row) return emptySnapshot();
  const ledger = JSON.parse(row.json),
    local = row.local_json
      ? (JSON.parse(row.local_json) ?? undefined)
      : undefined;
  validateLedger(ledger);
  validateLocal(local);
  return {
    ledger,
    sync: row.sync_json
      ? JSON.parse(row.sync_json)
      : queueLedgerChanges(emptySync(), emptyLedger(), ledger, id),
    binding: row.binding_json ? JSON.parse(row.binding_json) : null,
    local,
  };
}
export async function saveStateDatabase(db: StateDatabase, snapshot: Snapshot) {
  validateLedger(snapshot.ledger);
  validateLocal(snapshot.local);
  // The ledger, outbox, book identity and recovery copies commit in one SQLite statement.
  await db.runAsync(
    "INSERT INTO ledger_state(id,json,saved_at,sync_json,binding_json,local_json) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,saved_at=excluded.saved_at,sync_json=excluded.sync_json,binding_json=excluded.binding_json,local_json=excluded.local_json",
    JSON.stringify(snapshot.ledger),
    new Date().toISOString(),
    JSON.stringify(snapshot.sync),
    JSON.stringify(snapshot.binding),
    JSON.stringify(snapshot.local ?? null),
  );
}
