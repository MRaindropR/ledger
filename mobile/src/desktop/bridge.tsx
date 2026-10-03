import React, {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { DesktopController, type Action, type Legacy } from "./controller";
import { importLegacy, type Ledger } from "../core/ledger";
import { describeConflict } from "../core/conflict-description";
import { errorMessage } from "../error";
import type { Conflict } from "../core/sync";
import type { Snapshot } from "../core/snapshot";
const controller = new DesktopController();
function useStateOfApp() {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
export function useApp(reducer: (state: Legacy, action: Action) => Legacy) {
  const state = useStateOfApp();
  if (!state.row) throw Error("账本尚未加载");
  const dispatch = useCallback(
    (action: Action) =>
      controller
        .dispatch(action, reducer)
        .then(() => true)
        .catch((e) => {
          alert(errorMessage(e));
          return false;
        }),
    [reducer],
  );
  return [state.row.legacy, dispatch] as const;
}
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd7d0",
  borderRadius: 18,
  padding: 20,
  marginTop: 18,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ddd7d0",
  borderRadius: 10,
  color: "#243238",
  background: "#fff",
  fontSize: 14,
  marginTop: 6,
};
function Button({
  children,
  onClick,
  disabled = false,
  quiet = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "10px 16px",
        borderRadius: 10,
        border: quiet ? "1px solid #ddd7d0" : "none",
        background: quiet ? "#f7f2ef" : "#ff8d50",
        color: "#243238",
        fontWeight: 600,
        marginTop: 10,
        marginRight: 8,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  value,
  change,
  type = "text",
}: {
  label: string;
  value: string;
  change: (s: string) => void;
  type?: string;
}) {
  return (
    <label
      style={{
        display: "block",
        margin: "12px 0",
        color: "#6d777b",
        fontSize: 12,
      }}
    >
      {label}
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => change(e.target.value)}
        autoComplete="off"
        style={input}
      />
    </label>
  );
}
function downloadJSON() {
  const blob = new Blob([controller.exportJSON()], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "smartledger-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ConflictCard({
  id,
  conflict,
  disabled,
  onResolve,
  ledger,
}: {
  id: string;
  conflict: Conflict;
  disabled: boolean;
  onResolve: (id: string, choice: "local" | "remote") => void;
  ledger: Ledger;
}) {
  return (
    <div style={{ ...card, background: "#f7f2ef" }}>
      <h4>
        同步冲突 ·{" "}
        {conflict.local.kind === "account"
          ? "账户"
          : conflict.local.kind === "transaction"
            ? "交易"
            : "预算与排序"}
      </h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 16,
          marginTop: 12,
        }}
      >
        <div>
          本机版本
          <pre
            style={{
              fontSize: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {describeConflict(
              conflict.local.value,
              conflict.local.deleted,
              conflict.local.kind,
              ledger,
            )}
          </pre>
        </div>
        <div>
          云端版本
          <pre
            style={{
              fontSize: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {describeConflict(
              conflict.remote.value,
              conflict.remote.deleted,
              conflict.remote.kind,
              ledger,
            )}
          </pre>
        </div>
      </div>
      <Button disabled={disabled} onClick={() => onResolve(id, "local")}>
        保留本机版本
      </Button>
      <Button quiet disabled={disabled} onClick={() => onResolve(id, "remote")}>
        采用云端版本
      </Button>
    </div>
  );
}
export function Panel() {
  const state = useStateOfApp(),
    [editing, setEditing] = useState(false),
    [url, setUrl] = useState(
      state.projectUrl || "https://fnhfwmjmuzejhsezvdqm.supabase.co",
    ),
    [key, setKey] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState("家庭账本"),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState("");
  const action = useRef(false),
    file = useRef<HTMLInputElement>(null);
  const act = useCallback(async (fn: () => Promise<void>) => {
    if (action.current) return;
    action.current = true;
    setWorking(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      action.current = false;
      setWorking(false);
    }
  }, []);
  const resolve = useCallback(
    (id: string, choice: "local" | "remote") => {
      if (
        confirm(
          choice === "local"
            ? "采用本机版本更新这条云端记录？"
            : "这条本机记录改为云端版本？",
        )
      )
        void act(() => controller.resolve(id, choice));
    },
    [act],
  );
  const recover = useCallback(
    (id: string) => {
      const point = controller
        .getState()
        .row?.snapshot.local?.recoveryPoints.find((p) => p.id === id);
      if (
        point &&
        confirm(
          "恢复这个账本？将替换本机记录，并向已连接的云端同步。操作前会再保留一个恢复点。",
        )
      )
        void act(() => controller.restore(point.ledger));
    },
    [act],
  );
  const disabled = working || state.cloud.syncing,
    binding = state.row?.snapshot.binding;
  async function restore(file: File) {
    const data = JSON.parse(await file.text()),
      ledger = importLegacy(data);
    if (
      !confirm(
        `恢复 ${ledger.accounts.length} 个账户、${ledger.transactions.length} 笔交易？\n当前本机账本将被替换${binding ? "，连接的云端账本也将随之更新" : ""}。请先导出备份。`,
      )
    )
      return;
    await controller.restore(data);
    setMessage("账本已保存");
  }
  return (
    <section style={card} aria-label="手机与电脑同步">
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
        手机与电脑同步
      </h3>
      <p
        style={{
          color: state.cloud.ok === false ? "#c45b68" : "#6d777b",
          fontSize: 13,
        }}
      >
        {state.cloud.status}
      </p>
      {state.cloud.lastSync && (
        <p style={{ fontSize: 12, color: "#6d777b" }}>
          最后同步：{state.cloud.lastSync.toLocaleString("zh-CN")}
        </p>
      )}
      {message && (
        <p
          role="status"
          style={{
            color: message === "账本已保存" ? "#468769" : "#c45b68",
            marginTop: 10,
          }}
        >
          {message}
        </p>
      )}
      {!state.projectUrl || editing ? (
        <>
          <Field label="Supabase 项目地址" value={url} change={setUrl} />
          <Field
            label="公开密钥（sb_publishable_）"
            value={key}
            change={setKey}
          />
          <p style={{ fontSize: 12, color: "#6d777b" }}>不要填写管理员密钥。</p>
          <Button
            disabled={disabled}
            onClick={() =>
              void act(async () => {
                await controller.configure(url, key);
                setEditing(false);
                setKey("");
              })
            }
          >
            保存同步配置
          </Button>
          {state.projectUrl && (
            <Button quiet onClick={() => setEditing(false)}>
              取消
            </Button>
          )}
        </>
      ) : (
        <>
          {state.email ? (
            <>
              <p style={{ marginTop: 12 }}>{state.email}</p>
              {binding ? (
                <>
                  <p style={{ fontSize: 12, color: "#6d777b", marginTop: 8 }}>
                    待上传{" "}
                    {Object.keys(state.row!.snapshot.sync.pending).length} 项 ·
                    冲突{" "}
                    {Object.keys(state.row!.snapshot.sync.conflicts).length} 项
                  </p>
                  <Button
                    disabled={disabled}
                    onClick={() => void act(() => controller.syncNow())}
                  >
                    立即同步
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    quiet
                    disabled={disabled}
                    onClick={() => void act(() => controller.listBooks())}
                  >
                    查看我的云端账本
                  </Button>
                  {state.books.map((book) => (
                    <div key={book.id} style={{ marginTop: 12 }}>
                      {book.name}
                      <Button
                        quiet
                        disabled={disabled}
                        onClick={() => {
                          if (
                            confirm(
                              "连接这个云端账本？本机记录将与云端合并，相同记录有差异时会要求选择。建议先导出备份。",
                            )
                          )
                            void act(() => controller.connectBook(book.id));
                        }}
                      >
                        连接
                      </Button>
                    </div>
                  ))}
                  <Field label="新账本名称" value={name} change={setName} />
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      if (confirm("创建云端账本并同步本机数据？"))
                        void act(() => controller.createBook(name));
                    }}
                  >
                    创建云端账本并连接
                  </Button>
                </>
              )}
              <Button
                quiet
                disabled={disabled}
                onClick={() => void act(() => controller.signOut())}
              >
                退出登录
              </Button>
            </>
          ) : (
            <>
              <Field
                label="登录邮箱"
                value={email}
                change={setEmail}
                type="email"
              />
              <Button
                quiet
                disabled={disabled}
                onClick={() => void act(() => controller.sendCode(email))}
              >
                发送邮箱验证码
              </Button>
              <Field label="邮箱验证码" value={code} change={setCode} />
              <Button
                disabled={disabled}
                onClick={() =>
                  void act(async () => {
                    await controller.verifyCode(email, code);
                    setCode("");
                  })
                }
              >
                登录
              </Button>
            </>
          )}
          <Button
            quiet
            disabled={disabled}
            onClick={() => {
              setUrl(state.projectUrl);
              setEditing(true);
            }}
          >
            更改同步配置
          </Button>
        </>
      )}
      {state.row &&
        Object.entries(state.row.snapshot.sync.conflicts).map(
          ([id, conflict]) => (
            <ConflictCard
              key={id}
              id={id}
              conflict={conflict}
              ledger={state.row!.snapshot.ledger}
              disabled={disabled}
              onResolve={resolve}
            />
          ),
        )}
      <div
        style={{
          borderTop: "1px solid #ddd7d0",
          marginTop: 20,
          paddingTop: 10,
        }}
      >
        <Button quiet onClick={downloadJSON}>
          导出完整 JSON 备份
        </Button>
        <Button quiet disabled={disabled} onClick={() => file.current?.click()}>
          导入 JSON 账本
        </Button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label="导入 JSON 账本文件"
          style={{ display: "none" }}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (selected) void act(() => restore(selected));
          }}
        />
      </div>
      <h4 style={{ marginTop: 20 }}>本机恢复点</h4>
      {state.row?.snapshot.local?.recoveryPoints.map((point) => (
        <RecoveryCard
          key={point.id}
          point={point}
          disabled={disabled}
          recover={recover}
        />
      ))}
      <p style={{ color: "#6d777b", fontSize: 12, marginTop: 10 }}>
        保留最近 3 个导入前副本；清除浏览器数据会丢失这些本机副本。
      </p>
    </section>
  );
}
function RecoveryCard({
  point,
  disabled,
  recover,
}: {
  point: NonNullable<Snapshot["local"]>["recoveryPoints"][number];
  disabled: boolean;
  recover: (id: string) => void;
}) {
  return (
    <div style={{ ...card, padding: 14, marginTop: 10 }}>
      <strong>
        {point.reason === "import" ? "导入前自动保护" : "手动备份"}
      </strong>
      <p style={{ fontSize: 12, color: "#6d777b", marginTop: 6 }}>
        {new Date(point.createdAt).toLocaleString("zh-CN")} ·{" "}
        {point.ledger.accounts.length} 个账户 ·{" "}
        {point.ledger.transactions.length} 笔交易
      </p>
      <Button quiet disabled={disabled} onClick={() => recover(point.id)}>
        恢复这个副本
      </Button>
    </div>
  );
}
type Workbook = { Sheets: Record<string, unknown>; SheetNames: string[] };
type Spreadsheet = {
  utils: {
    aoa_to_sheet: (rows: unknown[][]) => unknown;
    book_append_sheet: (
      workbook: Workbook,
      sheet: unknown,
      name: string,
    ) => void;
    sheet_to_json: (
      sheet: unknown,
      options: { header: number; defval: string },
    ) => unknown[][];
  };
};
const api = {
  initialize: (initial: unknown) => controller.initialize(initial),
  restore: (data: unknown) => controller.restore(data),
  useApp,
  Panel,
  getState: controller.getState,
  subscribe: controller.subscribe,
  legacy: () => controller.getState().row?.legacy,
  exportJSON: () => controller.exportJSON(),
  addWorkbookJSON(workbook: Workbook, xlsx: Spreadsheet) {
    const json = controller.exportJSON(),
      chunks: unknown[][] = [["序号", "JSON 数据"]];
    for (let i = 0; i < json.length; i += 16000)
      chunks.push([i / 16000, json.slice(i, i + 16000)]);
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet(chunks),
      "原生账本JSON",
    );
  },
  readWorkbookJSON(workbook: Workbook, xlsx: Spreadsheet) {
    const sheet = workbook.Sheets["原生账本JSON"];
    if (!sheet) return null;
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const data = JSON.parse(
      rows
        .slice(1)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((row) => String(row[1]))
        .join(""),
    );
    importLegacy(data);
    return data;
  },
};
declare global {
  interface Window {
    SmartLedgerDesktop: typeof api;
  }
}
window.SmartLedgerDesktop = api;
