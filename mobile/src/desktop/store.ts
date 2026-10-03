import { validateLedger } from "../core/ledger";
import type { Snapshot } from "../core/snapshot";
import type { exportLegacy } from "../core/legacy-export";
export type DesktopRecord = {
  snapshot: Snapshot;
  legacy: ReturnType<typeof exportLegacy>;
  revision: number;
  savedAt: string;
};
export class DesktopStore {
  private connection: Promise<IDBDatabase>;
  constructor(
    factory: IDBFactory = indexedDB,
    name = "smartledger_native_bridge",
  ) {
    this.connection = new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("ledger");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async read(): Promise<DesktopRecord | null> {
    const db = await this.connection;
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("ledger", "readonly")
        .objectStore("ledger")
        .get("main");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }
  async update(
    fn: (record: DesktopRecord | null) => DesktopRecord,
  ): Promise<DesktopRecord> {
    const db = await this.connection;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("ledger", "readwrite"),
        store = transaction.objectStore("ledger"),
        request = store.get("main");
      let next: DesktopRecord, error: unknown;
      request.onsuccess = () => {
        try {
          next = fn(request.result ?? null);
          validateLedger(next.snapshot.ledger);
          store.put(next, "main");
        } catch (e) {
          error = e;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(next);
      transaction.onabort = () =>
        reject(error ?? transaction.error ?? Error("浏览器保存失败"));
      transaction.onerror = () => {
        error ??= transaction.error;
      };
    });
  }
  async close() {
    (await this.connection).close();
  }
}
