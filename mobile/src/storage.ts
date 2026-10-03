import * as SQLite from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import {
  initializeStateDatabase,
  loadStateDatabase,
  saveStateDatabase,
} from "./core/sqlite-state";
import type { Snapshot } from "./core/snapshot";
let connection: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!connection)
    connection = (async () => {
      const database = await SQLite.openDatabaseAsync("smartledger.sqlite");
      await initializeStateDatabase(database);
      return database;
    })();
  return connection;
}
export async function loadSnapshot() {
  return loadStateDatabase(await db(), randomUUID);
}
export async function persistSnapshot(snapshot: Snapshot) {
  await saveStateDatabase(await db(), snapshot);
}
