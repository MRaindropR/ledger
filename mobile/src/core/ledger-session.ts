import { SnapshotQueue, changeLedger, type Snapshot } from "./snapshot";
import type { Ledger } from "./ledger";
import { undoLedger } from "./undo";
import { checkpoint, protectedRestore } from "./recovery";
import { sameValue } from "./value-equal";
/** Session history stays in memory; local recovery points are persisted with the snapshot. */
export class LedgerSession extends SnapshotQueue {
  private sessionTail: Promise<void> = Promise.resolve();
  private history: { before: Ledger; after: Ledger }[] = [];
  get canUndo() {
    return this.history.length > 0;
  }
  private serial(fn: () => Promise<Snapshot>) {
    const job = this.sessionTail.then(fn);
    this.sessionTail = job.then(
      () => {},
      () => {},
    );
    return job;
  }
  override change(fn: (s: Snapshot) => Snapshot) {
    return this.serial(() => super.change(fn));
  }
  private edited(fn: (s: Snapshot) => Snapshot) {
    return this.serial(async () => {
      const before = this.current.ledger,
        next = await super.change(fn);
      if (!sameValue(before, next.ledger)) {
        this.history.push({ before, after: next.ledger });
        if (this.history.length > 20) this.history.shift();
      }
      return next;
    });
  }
  mutate(fn: (l: Ledger) => Ledger, id: () => string) {
    return this.edited((s) => changeLedger(s, fn, id));
  }
  restore(ledger: Ledger, id: () => string) {
    return this.edited((s) => protectedRestore(s, ledger, id));
  }
  backup(id: () => string) {
    return this.change((s) => checkpoint(s, "manual", id));
  }
  undo(id: () => string) {
    return this.serial(async () => {
      const entry = this.history.at(-1);
      if (!entry) throw Error("没有可撤销的操作");
      const next = await super.change((s) =>
        changeLedger(s, (l) => undoLedger(l, entry.before, entry.after), id),
      );
      this.history.pop();
      return next;
    });
  }
}
