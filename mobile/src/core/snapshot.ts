import { emptyLedger, validateLedger, type Ledger } from "./ledger";
import { emptySync, type SyncState } from "./sync";
import { ledgerFromSync, queueLedgerChanges } from "./ledger-sync";
export type CloudBinding = {
  projectUrl: string;
  ownerId: string;
  bookId: string;
};
export type Snapshot = {
  ledger: Ledger;
  sync: SyncState;
  binding: CloudBinding | null;
  local?: {
    recoveryPoints: {
      id: string;
      createdAt: string;
      reason: "import" | "manual";
      ledger: Ledger;
    }[];
    lastShareOpenedAt?: string;
  };
};
export const emptySnapshot = (): Snapshot => ({
  ledger: emptyLedger(),
  sync: emptySync(),
  binding: null,
});
export function changeLedger(
  snapshot: Snapshot,
  fn: (ledger: Ledger) => Ledger,
  id: () => string,
): Snapshot {
  const ledger = fn(snapshot.ledger);
  validateLedger(ledger);
  return {
    ...snapshot,
    ledger,
    sync: queueLedgerChanges(snapshot.sync, snapshot.ledger, ledger, id),
  };
}
export function bindSnapshot(
  snapshot: Snapshot,
  binding: CloudBinding,
  id: () => string,
): Snapshot {
  if (
    snapshot.binding &&
    JSON.stringify(snapshot.binding) === JSON.stringify(binding)
  )
    return snapshot;
  if (
    snapshot.binding &&
    JSON.stringify(snapshot.binding) !== JSON.stringify(binding)
  )
    throw Error(
      "本机账本已经连接其他云端账本，请先导出备份；不能直接切换并混合数据",
    );
  if (
    !binding.projectUrl.startsWith("https://") ||
    !binding.ownerId ||
    !binding.bookId
  )
    throw Error("账本连接信息无效");
  return {
    ...snapshot,
    binding,
    sync: queueLedgerChanges(snapshot.sync, emptyLedger(), snapshot.ledger, id),
  };
}
export function changeSync(
  snapshot: Snapshot,
  binding: CloudBinding,
  fn: (state: SyncState) => SyncState,
): Snapshot {
  if (JSON.stringify(snapshot.binding) !== JSON.stringify(binding))
    throw Error("账本连接已变化，请重新同步");
  const sync = fn(snapshot.sync),
    ledger = ledgerFromSync(sync);
  return { ...snapshot, sync, ledger };
}
export class SnapshotQueue {
  private tail: Promise<void> = Promise.resolve();
  constructor(
    public current: Snapshot,
    private persist: (snapshot: Snapshot) => Promise<void>,
  ) {}
  change(fn: (snapshot: Snapshot) => Snapshot): Promise<Snapshot> {
    const job = this.tail.then(async () => {
      const next = fn(this.current);
      await this.persist(next);
      this.current = next;
      return next;
    });
    this.tail = job.then(
      () => {},
      () => {},
    );
    return job;
  }
}
