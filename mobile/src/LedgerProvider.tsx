import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { randomUUID } from "expo-crypto";
import type { Ledger } from "./core/ledger";
import type { SyncState } from "./core/sync";
import {
  emptySnapshot,
  bindSnapshot,
  changeSync,
  type CloudBinding,
  type Snapshot,
} from "./core/snapshot";
import { loadSnapshot, persistSnapshot } from "./storage";
import { errorMessage } from "./error";
import { LedgerSession } from "./core/ledger-session";
type Store = {
  ledger: Ledger;
  sync: SyncState;
  binding: CloudBinding | null;
  loaded: boolean;
  status: string;
  error: string;
  busy: boolean;
  current: React.MutableRefObject<Ledger>;
  snapshot: React.MutableRefObject<Snapshot>;
  mutate: (fn: (ledger: Ledger) => Ledger) => Promise<void>;
  restore: (ledger: Ledger) => Promise<void>;
  createBackup: () => Promise<Ledger>;
  markShareOpened: () => Promise<void>;
  undo: () => Promise<void>;
  canUndo: boolean;
  recoveryPoints: NonNullable<Snapshot["local"]>["recoveryPoints"];
  lastShareOpenedAt: string | null;
  bindCloud: (binding: CloudBinding) => Promise<void>;
  mutateSync: (
    binding: CloudBinding,
    fn: (state: SyncState) => SyncState,
  ) => Promise<void>;
};
const Context = createContext<Store | null>(null);
export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(emptySnapshot),
    [loaded, setLoaded] = useState(false),
    [status, setStatus] = useState("正在加载"),
    [error, setError] = useState(""),
    [canUndo, setCanUndo] = useState(false),
    [pending, setPending] = useState(0);
  const current = useRef(state.ledger),
    snapshot = useRef(state),
    queue = useRef<LedgerSession | null>(null);
  useEffect(() => {
    let live = true;
    loadSnapshot()
      .then((s) => {
        if (!live) return;
        queue.current = new LedgerSession(s, persistSnapshot);
        snapshot.current = s;
        current.current = s.ledger;
        setState(s);
        setLoaded(true);
        setStatus("已保存");
      })
      .catch((e) => {
        if (live) {
          setError(errorMessage(e));
          setStatus("读取失败");
        }
      });
    return () => {
      live = false;
    };
  }, []);
  async function change(run: (q: LedgerSession) => Promise<Snapshot>) {
    const q = queue.current;
    if (!q) throw Error("账本尚未加载");
    setPending((n) => n + 1);
    setStatus("正在保存");
    try {
      const next = await run(q);
      snapshot.current = next;
      current.current = next.ledger;
      setState(next);
      setCanUndo(q.canUndo);
      setError("");
      setStatus(
        "已保存 · " +
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
      );
      return next;
    } catch (e) {
      setError(errorMessage(e));
      setStatus("保存失败");
      throw e;
    } finally {
      setPending((n) => n - 1);
    }
  }
  const mutate = async (fn: (ledger: Ledger) => Ledger) => {
    await change((q) => q.mutate(fn, randomUUID));
  };
  const restore = async (ledger: Ledger) => {
    await change((q) => q.restore(ledger, randomUUID));
  };
  const createBackup = async () => {
    const next = await change((q) => q.backup(randomUUID));
    return next.local!.recoveryPoints[0].ledger;
  };
  const undo = async () => {
    await change((q) => q.undo(randomUUID));
  };
  const markShareOpened = async () => {
    await change((q) =>
      q.change((s) => ({
        ...s,
        local: {
          ...s.local,
          recoveryPoints: s.local?.recoveryPoints ?? [],
          lastShareOpenedAt: new Date().toISOString(),
        },
      })),
    );
  };
  const bindCloud = (binding: CloudBinding) =>
    change((q) => q.change((s) => bindSnapshot(s, binding, randomUUID))).then(
      () => {},
    );
  const mutateSync = (
    binding: CloudBinding,
    fn: (state: SyncState) => SyncState,
  ) =>
    change((q) => q.change((s) => changeSync(s, binding, fn))).then(() => {});
  return (
    <Context.Provider
      value={{
        ledger: state.ledger,
        sync: state.sync,
        binding: state.binding,
        loaded,
        status,
        error,
        busy: pending > 0,
        current,
        snapshot,
        mutate,
        restore,
        createBackup,
        markShareOpened,
        undo,
        canUndo,
        recoveryPoints: state.local?.recoveryPoints ?? [],
        lastShareOpenedAt: state.local?.lastShareOpenedAt ?? null,
        bindCloud,
        mutateSync,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLedger() {
  const value = useContext(Context);
  if (!value) throw Error("LedgerProvider is required");
  return value;
}
