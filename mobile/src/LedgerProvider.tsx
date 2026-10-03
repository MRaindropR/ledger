import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { emptyLedger, type Ledger } from "./core/ledger";
import { loadLedger, persistLedger } from "./storage";
type Store = {
  ledger: Ledger;
  loaded: boolean;
  status: string;
  error: string;
  busy: boolean;
  current: React.MutableRefObject<Ledger>;
  mutate: (fn: (l: Ledger) => Ledger) => Promise<void>;
};
const Context = createContext<Store | null>(null);
export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [ledger, setLedger] = useState(emptyLedger()),
    [loaded, setLoaded] = useState(false),
    [status, setStatus] = useState("正在加载"),
    [error, setError] = useState(""),
    [pending, setPending] = useState(0);
  const current = useRef(ledger),
    queue = useRef(Promise.resolve());
  useEffect(() => {
    loadLedger()
      .then((l) => {
        current.current = l;
        setLedger(l);
        setLoaded(true);
        setStatus("已保存");
      })
      .catch((e) => {
        setError(e.message);
        setStatus("读取失败");
      });
  }, []);
  function mutate(fn: (l: Ledger) => Ledger) {
    setPending((n) => n + 1);
    const job = queue.current.then(async () => {
      const next = fn(current.current);
      setStatus("正在保存");
      await persistLedger(next);
      current.current = next;
      setLedger(next);
      setError("");
      setStatus(
        "已保存 · " +
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
      );
    });
    queue.current = job.catch((e) => {
      setError(e.message);
      setStatus("保存失败");
    });
    void job.finally(() => setPending((n) => n - 1)).catch(() => {});
    return job;
  }
  return (
    <Context.Provider
      value={{
        ledger,
        loaded,
        status,
        error,
        busy: pending > 0,
        current,
        mutate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLedger() {
  const store = useContext(Context);
  if (!store) throw Error("LedgerProvider is required");
  return store;
}
