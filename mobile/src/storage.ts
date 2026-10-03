import * as SQLite from 'expo-sqlite';
import {emptyLedger,validateLedger,type Ledger} from './core/ledger';
let connection:Promise<SQLite.SQLiteDatabase>|undefined;
async function db(){if(!connection)connection=(async()=>{const d=await SQLite.openDatabaseAsync('smartledger.sqlite');await d.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, saved_at TEXT NOT NULL);');return d;})();return connection;}
export async function loadLedger():Promise<Ledger>{const row=await(await db()).getFirstAsync<{json:string}>('SELECT json FROM ledger_state WHERE id=1');if(!row)return emptyLedger();const result=JSON.parse(row.json);validateLedger(result);return result;}
export async function persistLedger(ledger:Ledger){validateLedger(ledger);await(await db()).runAsync('INSERT INTO ledger_state(id,json,saved_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,saved_at=excluded.saved_at',JSON.stringify(ledger),new Date().toISOString());}
