import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { cloudConfig, type CloudConfig } from "../core/cloud-config";
import {
  emptySnapshot,
  bindSnapshot,
  changeLedger,
  changeSync,
  type CloudBinding,
} from "../core/snapshot";
import { importLegacy, type Ledger } from "../core/ledger";
import { exportLegacy } from "../core/legacy-export";
import { exchange, mergeExchange } from "../core/sync-runner";
import { resolveConflict, uploadable } from "../core/sync";
import { undoLedger } from "../core/undo";
import { protectedRestore } from "../core/recovery";
import { remoteBook } from "../core/supabase-port";
import { DesktopStore, type DesktopRecord } from "./store";
import { errorMessage } from "../error";
const newOperationId = () => crypto.randomUUID();
export type Legacy = ReturnType<typeof exportLegacy>;
export type Action = { type: string; p?: unknown };
type Book = { id: string; name: string };
export type DesktopState = {
  row: DesktopRecord | null;
  save: {
    state: "saving" | "saved" | "error";
    lastSaved: Date | null;
    error: string | null;
  };
  cloud: {
    status: string;
    syncing: boolean;
    ok: boolean | null;
    lastSync: Date | null;
    error: string | null;
  };
  projectUrl: string;
  email: string | null;
  books: Book[];
};
export class DesktopController {
  private state: DesktopState = {
    row: null,
    save: { state: "saving", lastSaved: null, error: null },
    cloud: {
      status: "未连接云端",
      syncing: false,
      ok: null,
      lastSync: null,
      error: null,
    },
    projectUrl: "",
    email: null,
    books: [],
  };
  private listeners = new Set<() => void>();
  private client: SupabaseClient | null = null;
  private config: CloudConfig | null = null;
  private session: Session | null = null;
  private authSubscription: { unsubscribe: () => void } | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private channel: BroadcastChannel | null = null;
  private undo: { before: Ledger; after: Ledger }[] = [];
  constructor(private store = new DesktopStore()) {}
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }
  private update(patch: Partial<DesktopState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  private publish(row: DesktopRecord) {
    if (this.state.row && row.revision < this.state.row.revision) return;
    this.update({
      row,
      save: { state: "saved", lastSaved: new Date(row.savedAt), error: null },
    });
  }
  async initialize(initial: unknown) {
    const row = await this.store.update((old) => {
      if (old) return old;
      let snapshot = emptySnapshot();
      if (initial)
        snapshot = changeLedger(
          snapshot,
          () => importLegacy(initial),
          newOperationId,
        );
      return {
        snapshot,
        legacy: exportLegacy(snapshot.ledger, (initial ?? {}) as Legacy),
        revision: 1,
        savedAt: new Date().toISOString(),
      };
    });
    this.publish(row);
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("smartledger_native_bridge");
      this.channel.onmessage = () => {
        void this.store
          .read()
          .then((row) => {
            if (row) this.publish(row);
          })
          .catch((e) => this.saveFailed(e));
      };
    }
    try {
      const raw = localStorage.getItem("smartledger.native.cloud.config");
      if (raw) {
        const c = JSON.parse(raw) as CloudConfig;
        this.activate(cloudConfig(c.url, c.publishableKey));
      }
    } catch (e) {
      this.cloudFailed(e);
    }
    this.poll = setInterval(() => {
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      )
        void this.syncNow().catch(() => {});
    }, 30000);
  }
  private saveFailed(error: unknown) {
    this.update({
      save: {
        state: "error",
        lastSaved: this.state.save.lastSaved,
        error: errorMessage(error),
      },
    });
  }
  private cloudFailed(error: unknown) {
    this.update({
      cloud: {
        ...this.state.cloud,
        syncing: false,
        ok: false,
        status: "同步失败 · " + errorMessage(error),
        error: errorMessage(error),
      },
    });
  }
  private async mutate(fn: (record: DesktopRecord) => DesktopRecord) {
    this.update({ save: { ...this.state.save, state: "saving", error: null } });
    try {
      const row = await this.store.update((old) => {
        if (!old) throw Error("账本尚未加载");
        const next = fn(old);
        return {
          ...next,
          revision: old.revision + 1,
          savedAt: new Date().toISOString(),
        };
      });
      this.publish(row);
      this.channel?.postMessage("changed");
      this.schedule();
      return row;
    } catch (e) {
      this.saveFailed(e);
      throw e;
    }
  }
  async dispatch(
    action: Action,
    reducer: (ledger: Legacy, action: Action) => Legacy,
  ) {
    if (action.type === "UNDO") {
      const item = this.undo.at(-1);
      if (!item) throw Error("没有可撤销的操作");
      await this.mutate((row) => {
        const snapshot = changeLedger(
          row.snapshot,
          (l) => undoLedger(l, item.before, item.after),
          newOperationId,
        );
        return {
          ...row,
          snapshot,
          legacy: exportLegacy(snapshot.ledger, row.legacy),
        };
      });
      this.undo.pop();
      return;
    }
    let entry: { before: Ledger; after: Ledger } | undefined;
    await this.mutate((row) => {
      const legacy =
          action.type === "RESTORE"
            ? (action.p as Legacy)
            : reducer(row.legacy, action),
        ledger = importLegacy(legacy),
        snapshot =
          action.type === "RESTORE"
            ? protectedRestore(row.snapshot, ledger, newOperationId)
            : changeLedger(row.snapshot, () => ledger, newOperationId);
      entry = { before: row.snapshot.ledger, after: ledger };
      return { ...row, snapshot, legacy: exportLegacy(ledger, legacy) };
    });
    if (entry) {
      this.undo.push(entry);
      if (this.undo.length > 20) this.undo.shift();
    }
  }
  async restore(input: unknown) {
    await this.dispatch({ type: "RESTORE", p: input }, (l) => l);
  }
  exportJSON() {
    const row = this.state.row;
    if (!row) throw Error("账本尚未加载");
    return JSON.stringify(row.snapshot.ledger, null, 2);
  }
  private activate(config: CloudConfig) {
    this.authSubscription?.unsubscribe();
    this.client?.auth.stopAutoRefresh();
    this.config = config;
    this.session = null;
    const client = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    this.client = client;
    this.update({
      projectUrl: config.url,
      email: null,
      books: [],
      cloud: { ...this.state.cloud, status: "正在读取登录状态", ok: null },
    });
    this.authSubscription = client.auth.onAuthStateChange((event, session) => {
      if (this.client !== client) return;
      this.session = session;
      this.update({ email: session?.user.email ?? null });
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION")
        this.update({
          cloud: {
            ...this.state.cloud,
            status: session ? "已登录 · 尚未同步" : "未登录",
          },
        });
      if (event === "SIGNED_OUT")
        this.update({ cloud: { ...this.state.cloud, status: "未登录" } });
      if (session) this.schedule();
    }).data.subscription;
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (this.client !== client) return;
        if (error) this.cloudFailed(error);
        else {
          this.session = data.session;
          this.update({ email: data.session?.user.email ?? null });
          this.schedule();
        }
      })
      .catch((e) => this.cloudFailed(e));
  }
  async configure(url: string, key: string) {
    if (this.running) throw Error("同步进行中，请稍后更改配置");
    const config = cloudConfig(url, key),
      binding = this.state.row?.snapshot.binding;
    if (binding && binding.projectUrl !== config.url)
      throw Error("本机账本已连接其他项目，不能直接切换");
    localStorage.setItem(
      "smartledger.native.cloud.config",
      JSON.stringify(config),
    );
    this.activate(config);
  }
  private connected() {
    if (!this.client) throw Error("先配置同步项目");
    return this.client;
  }
  private async owner(client: SupabaseClient) {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user) throw Error("请重新登录");
    return data.user.id;
  }
  async sendCode(email: string) {
    const { error } = await this.connected().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
    this.update({
      cloud: { ...this.state.cloud, status: "验证码已发送，请检查邮箱" },
    });
  }
  async verifyCode(email: string, token: string) {
    const { error } = await this.connected().auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    if (error) throw error;
  }
  async signOut() {
    if (this.running) throw Error("同步进行中，请稍后退出");
    const { error } = await this.connected().auth.signOut({ scope: "local" });
    if (error) throw error;
    this.update({ books: [] });
  }
  async listBooks() {
    const client = this.connected();
    await this.owner(client);
    const { data, error } = await client
      .from("ledger_books")
      .select("id,name")
      .order("created_at", { ascending: true });
    if (error) throw error;
    this.update({ books: data ?? [] });
  }
  async connectBook(id: string) {
    const client = this.connected(),
      ownerId = await this.owner(client);
    const { data, error } = await client
      .from("ledger_books")
      .select("id,name")
      .eq("id", id)
      .single();
    if (error || !data) throw Error("无法访问这个账本");
    const binding: CloudBinding = {
      ownerId,
      bookId: id,
      projectUrl: this.config!.url,
    };
    await this.mutate((row) => ({
      ...row,
      snapshot: bindSnapshot(row.snapshot, binding, newOperationId),
    }));
    this.schedule(true);
  }
  async createBook(name: string) {
    const client = this.connected();
    await this.owner(client);
    const { data, error } = await client.rpc("ledger_create", {
      p_name: name.trim(),
    });
    if (error) throw error;
    if (typeof data !== "string") throw Error("创建账本响应无效");
    await this.connectBook(data);
    await this.listBooks();
  }
  private schedule(force = false) {
    if (!this.session || !this.state.row?.snapshot.binding) return;
    if (!force && !uploadable(this.state.row.snapshot.sync).length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow().catch(() => {}), 1500);
  }
  async syncNow() {
    const record = this.state.row,
      client = this.client,
      binding = record?.snapshot.binding;
    if (this.running || !client || !binding || !this.session) return;
    this.running = true;
    this.update({
      cloud: {
        ...this.state.cloud,
        status: "正在同步",
        syncing: true,
        error: null,
      },
    });
    try {
      const owner = await this.owner(client);
      if (owner !== binding.ownerId || this.config?.url !== binding.projectUrl)
        throw Error("登录账号与本机账本归属不一致，停止同步");
      const result = await exchange(
        record.snapshot.sync,
        remoteBook(client, binding.bookId),
      );
      if (client !== this.client || this.session?.user.id !== owner)
        throw Error("登录状态已变化，保留待同步记录");
      const row = await this.mutate((old) => {
        const snapshot = changeSync(old.snapshot, binding, (s) =>
          mergeExchange(s, result),
        );
        return {
          ...old,
          snapshot,
          legacy: exportLegacy(snapshot.ledger, old.legacy),
        };
      });
      const conflicts = Object.keys(row.snapshot.sync.conflicts).length,
        pending = Object.keys(row.snapshot.sync.pending).length;
      this.update({
        cloud: {
          status: conflicts
            ? `有 ${conflicts} 项冲突待处理`
            : pending
              ? `已同步 · ${pending} 项待上传`
              : "已同步",
          syncing: false,
          ok: conflicts ? false : true,
          lastSync: new Date(),
          error: null,
        },
      });
    } catch (e) {
      this.cloudFailed(e);
      throw e;
    } finally {
      this.running = false;
    }
  }
  async resolve(key: string, choice: "local" | "remote") {
    const binding = this.state.row?.snapshot.binding;
    if (!binding) throw Error("尚未连接账本");
    await this.mutate((row) => {
      const snapshot = changeSync(row.snapshot, binding, (s) =>
        resolveConflict(s, key, choice, crypto.randomUUID()),
      );
      return {
        ...row,
        snapshot,
        legacy: exportLegacy(snapshot.ledger, row.legacy),
      };
    });
  }
  async close() {
    if (this.poll) clearInterval(this.poll);
    if (this.timer) clearTimeout(this.timer);
    this.channel?.close();
    this.authSubscription?.unsubscribe();
    this.client?.auth.stopAutoRefresh();
    await this.store.close();
  }
}
