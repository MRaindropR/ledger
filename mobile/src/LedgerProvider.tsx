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
  SnapshotQueue,
  changeLedger,
  bindSnapshot,
  changeSync,
  type CloudBinding,
  type Snapshot,
} from "./core/snapshot";
import { loadSnapshot, persistSnapshot } from "./storage";
import { errorMessage } from "./error";
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
    [pending, setPending] = useState(0);
  const current = useRef(state.ledger),
    snapshot = useRef(state),
    queue = useRef<SnapshotQueue | null>(null);
  useEffect(() => {
    let live = true;
    loadSnapshot()
      .then((s) => {
        if (!live) return;
        queue.current = new SnapshotQueue(s, persistSnapshot);
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
  async function change(fn: (s: Snapshot) => Snapshot) {
    const q = queue.current;
    if (!q) throw Error("账本尚未加载");
    setPending((n) => n + 1);
    setStatus("正在保存");
    try {
      const next = await q.change(fn);
      snapshot.current = next;
      current.current = next.ledger;
      setState(next);
      setError("");
      setStatus(
        "已保存 · " +
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
      );
    } catch (e) {
      setError(errorMessage(e));
      setStatus("保存失败");
      throw e;
    } finally {
      setPending((n) => n - 1);
    }
  }
  const mutate = (fn: (ledger: Ledger) => Ledger) =>
    change((s) => changeLedger(s, fn, randomUUID));
  const bindCloud = (binding: CloudBinding) =>
    change((s) => bindSnapshot(s, binding, randomUUID));
  const mutateSync = (
    binding: CloudBinding,
    fn: (state: SyncState) => SyncState,
  ) => change((s) => changeSync(s, binding, fn));
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
