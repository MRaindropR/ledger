import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "expo-crypto";
import { cloudConfig, type CloudConfig } from "./core/cloud-config";
import { exchange, mergeExchange } from "./core/sync-runner";
import { resolveConflict } from "./core/sync";
import {
  loadCloudConfig,
  saveCloudConfig,
  openCloud,
  remoteBook,
  verifiedOwner,
} from "./cloud";
import { useLedger } from "./LedgerProvider";
import { errorMessage } from "./error";
type Book = { id: string; name: string };
type Cloud = {
  config: CloudConfig | null;
  session: Session | null;
  ready: boolean;
  busy: boolean;
  status: string;
  lastSync: string | null;
  books: Book[];
  configure: (url: string, key: string) => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  listBooks: () => Promise<void>;
  createBook: (name: string) => Promise<void>;
  connectBook: (id: string) => Promise<void>;
  syncNow: () => Promise<void>;
  resolve: (key: string, choice: "local" | "remote") => Promise<void>;
};
const Context = createContext<Cloud | null>(null);
export function CloudProvider({ children }: { children: React.ReactNode }) {
  const ledger = useLedger(),
    ledgerRef = useRef(ledger);
  useEffect(() => {
    ledgerRef.current = ledger;
  }, [ledger]);
  const [config, setConfig] = useState<CloudConfig | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("未连接云端"),
    [lastSync, setLastSync] = useState<string | null>(null),
    [books, setBooks] = useState<Book[]>([]);
  const connection = useRef<ReturnType<typeof openCloud> | null>(null),
    subscription = useRef<{ unsubscribe: () => void } | null>(null),
    running = useRef(false),
    sessionRef = useRef<Session | null>(null),
    syncAction = useRef<() => Promise<void>>(async () => {});
  function activate(c: CloudConfig) {
    subscription.current?.unsubscribe();
    connection.current?.close();
    const opened = openCloud(c);
    connection.current = opened;
    sessionRef.current = null;
    setSession(null);
    setStatus("正在读取登录状态");
    setConfig(c);
    setBooks([]);
    subscription.current = opened.client.auth.onAuthStateChange(
      (event, next) => {
        if (connection.current !== opened) return;
        sessionRef.current = next;
        setSession(next);
        if (event === "SIGNED_OUT") setStatus("未登录");
        else if (event === "SIGNED_IN" || event === "INITIAL_SESSION")
          setStatus(next ? "已登录 · 尚未同步" : "未登录");
      },
    ).data.subscription;
    void opened.client.auth
      .getSession()
      .then(({ data, error }) => {
        if (connection.current !== opened) return;
        if (error) setStatus(error.message);
        else {
          sessionRef.current = data.session;
          setSession(data.session);
        }
      })
      .catch((e) => {
        if (connection.current === opened) setStatus(errorMessage(e));
      });
  }
  useEffect(() => {
    let live = true;
    loadCloudConfig()
      .then((c) => {
        if (live && c) activate(c);
      })
      .catch((e) => {
        if (live) setStatus(errorMessage(e));
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
      subscription.current?.unsubscribe();
      connection.current?.close();
    };
  }, []);
  function client(): SupabaseClient {
    if (!connection.current) throw Error("先配置同步项目");
    return connection.current.client;
  }
  async function configure(url: string, key: string) {
    if (running.current) throw Error("同步进行中，请稍后更改配置");
    const next = cloudConfig(url, key),
      binding = ledgerRef.current.binding;
    if (binding && binding.projectUrl !== next.url)
      throw Error("本机账本已连接其他项目，不能直接切换");
    await saveCloudConfig(next);
    activate(next);
  }
  async function sendCode(email: string) {
    const { error } = await client().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
    setStatus("验证码已发送，请检查邮箱");
  }
  async function verifyCode(email: string, token: string) {
    const { error } = await client().auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    if (error) throw error;
  }
  async function signOut() {
    if (running.current) throw Error("同步进行中，请稍后退出");
    const { error } = await client().auth.signOut({ scope: "local" });
    if (error) throw error;
    setBooks([]);
    setLastSync(null);
  }
  async function listBooks() {
    const c = client();
    await verifiedOwner(c);
    const { data, error } = await c
      .from("ledger_books")
      .select("id,name")
      .order("created_at", { ascending: true });
    if (error) throw error;
    setBooks(data ?? []);
  }
  async function connectBook(id: string) {
    const c = client(),
      ownerId = await verifiedOwner(c),
      url = config?.url;
    if (!url) throw Error("同步配置无效");
    const { data, error } = await c
      .from("ledger_books")
      .select("id,name")
      .eq("id", id)
      .single();
    if (error || !data) throw Error("无法访问这个账本");
    await ledgerRef.current.bindCloud({ projectUrl: url, ownerId, bookId: id });
    setStatus("已连接 · 待首次同步");
  }
  async function createBook(name: string) {
    const c = client();
    await verifiedOwner(c);
    const { data, error } = await c.rpc("ledger_create", {
      p_name: name.trim(),
    });
    if (error) throw error;
    if (typeof data !== "string") throw Error("创建账本响应无效");
    await connectBook(data);
    await listBooks();
  }
  async function syncNow() {
    if (running.current) return;
    const store = ledgerRef.current,
      binding = store.binding;
    if (!binding) {
      setStatus("先选择云端账本");
      return;
    }
    const captured = connection.current,
      c = client();
    running.current = true;
    setBusy(true);
    setStatus("正在同步");
    try {
      const owner = await verifiedOwner(c);
      if (owner !== binding.ownerId || config?.url !== binding.projectUrl)
        throw Error("登录账号与本机账本归属不一致，停止同步");
      const result = await exchange(
        store.snapshot.current.sync,
        remoteBook(c, binding.bookId),
      );
      if (
        captured !== connection.current ||
        sessionRef.current?.user.id !== owner
      )
        throw Error("登录状态已变化，保留本地待同步记录");
      await ledgerRef.current.mutateSync(binding, (s) =>
        mergeExchange(s, result),
      );
      const state = ledgerRef.current.snapshot.current.sync,
        count = Object.keys(state.conflicts).length,
        pending = Object.keys(state.pending).length;
      setLastSync(new Date().toISOString());
      setStatus(
        count
          ? `有 ${count} 项冲突待处理`
          : pending
            ? `已同步 · ${pending} 项待上传`
            : "已同步",
      );
    } catch (e) {
      setStatus("同步失败 · " + errorMessage(e));
      throw e;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    syncAction.current = syncNow;
  });
  const userId = session?.user.id;
  // Foreground polling also retrieves edits made on the computer while the phone stays open.
  useEffect(() => {
    if (!ledger.loaded || !ledger.binding || !userId) return;
    const run = () => {
      if (AppState.currentState === "active")
        void syncAction.current().catch(() => {});
    };
    const timer = setInterval(run, 30000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    run();
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [ledger.loaded, ledger.binding, userId]);
  useEffect(() => {
    if (!ledger.loaded || !ledger.binding || !userId) return;
    const timer = setTimeout(
      () => void syncAction.current().catch(() => {}),
      1500,
    );
    return () => clearTimeout(timer);
  }, [ledger.sync.pending, ledger.loaded, ledger.binding, userId]);
  async function resolve(key: string, choice: "local" | "remote") {
    const binding = ledgerRef.current.binding;
    if (!binding) throw Error("尚未连接账本");
    await ledgerRef.current.mutateSync(binding, (s) =>
      resolveConflict(s, key, choice, randomUUID()),
    );
  }
  return (
    <Context.Provider
      value={{
        config,
        session,
        ready,
        busy,
        status,
        lastSync,
        books,
        configure,
        sendCode,
        verifyCode,
        signOut,
        listBooks,
        createBook,
        connectBook,
        syncNow,
        resolve,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCloud() {
  const value = useContext(Context);
  if (!value) throw Error("CloudProvider is required");
  return value;
}
