import React, { useState } from "react";
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SvgXml } from "react-native-svg";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import icons from "./generated/icons.json";
import expenseCategories from "./generated/EXP_CATS.json";
import incomeCategories from "./generated/INC_CATS.json";
import {
  balance,
  cents,
  dateKey,
  deleteAccount,
  importLegacy,
  investmentProfit,
  money,
  parseBill,
  reconcile,
  saveTransaction,
  totals,
  type Account,
  type Transaction,
  type TxType,
} from "./core/ledger";
import { useLedger } from "./LedgerProvider";
import { errorMessage } from "./error";
import { AnnualReview } from "./AnnualReview";

const C = {
  background: "#f7f2ef",
  white: "#fff",
  ink: "#243238",
  muted: "#6d777b",
  line: "#ddd7d0",
  orange: "#ff8d50",
  green: "#468769",
  red: "#c45b68",
  lime: "#e3efb5",
  blue: "#d8edfc",
  peach: "#ffddc8",
};
type Page = "首页" | "账单" | "账户" | "导入" | "报表" | "设置";
const tabIcons: Record<Page, string> = {
  首页: "home",
  账单: "receipt",
  账户: "wallet",
  导入: "import",
  报表: "report",
  设置: "settings",
};
function Icon({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <SvgXml
      xml={(icons as Record<string, string>)[name] || icons.wallet}
      width={size}
      height={size}
    />
  );
}
function Button({
  label,
  onPress,
  quiet = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[s.button, quiet && s.quiet, disabled && { opacity: 0.5 }]}
    >
      <Text style={{ color: C.ink, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
function Input({
  label,
  value,
  change,
  number = false,
  multiline = false,
}: {
  label: string;
  value: string;
  change: (s: string) => void;
  number?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        keyboardType={number ? "decimal-pad" : "default"}
        multiline={multiline}
        style={[
          s.input,
          multiline && { height: 130, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
function Choices({
  values,
  value,
  change,
}: {
  values: { id: string; label: string }[];
  value: string;
  change: (s: string) => void;
}) {
  return (
    <View style={s.wrap}>
      {values.map((x) => (
        <Pressable
          key={x.id}
          onPress={() => change(x.id)}
          style={[s.chip, x.id === value && s.selected]}
        >
          <Text style={{ color: C.ink, fontSize: 12 }}>{x.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function Sheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.sheetHeading}>
            <Text style={s.heading}>{title}</Text>
            <Button label="关闭" onPress={close} quiet />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export function LedgerScreen({ page }: { page: Page }) {
  const { ledger, loaded, status, error, busy, current, mutate } = useLedger();
  const setPage = (p: Page) =>
    router.replace(
      (
        {
          首页: "/",
          账单: "/transactions",
          账户: "/accounts",
          导入: "/import",
          报表: "/reports",
          设置: "/settings",
        } as const
      )[p],
    );
  const [form, setForm] = useState<Transaction | null>(null),
    [amount, setAmount] = useState("");
  const [account, setAccount] = useState<Account | null>(null),
    [accountAmount, setAccountAmount] = useState(""),
    [cost, setCost] = useState(""),
    [showHidden, setShowHidden] = useState(false);
  const [text, setText] = useState(""),
    [importAccount, setImportAccount] = useState(""),
    [billYear, setBillYear] = useState(String(new Date().getFullYear())),
    [preview, setPreview] = useState<Transaction[]>([]),
    [selection, setSelection] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState(""),
    [lastBackup, setLastBackup] = useState<string | null>(null);
  const summary = totals(ledger),
    monthly = ledger.transactions.filter(
      (t) =>
        t.date.startsWith(dateKey().slice(0, 7)) &&
        ledger.accounts.find((a) => a.id === t.accountId)?.currency === "CNY",
    ),
    income = monthly
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.cents, 0),
    expense = monthly
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.cents, 0);
  const openTransaction = (tx?: Transaction) => {
    if (!tx && !ledger.accounts.some((a) => !a.hidden)) {
      Alert.alert("先添加账户", "请在账户页添加你的第一个账户");
      setPage("账户");
      return;
    }
    const t = tx || {
      id: Crypto.randomUUID(),
      type: "expense",
      cents: 0,
      accountId: ledger.accounts.find((a) => !a.hidden)!.id,
      date: dateKey(),
      merchant: "",
      category: "e01",
      note: "",
    };
    setForm(t);
    setAmount(tx ? String(t.cents / 100) : "");
  };
  const openAccount = (a?: Account) => {
    setAccount(
      a || {
        id: Crypto.randomUUID(),
        name: "",
        kind: "asset",
        role: "cash",
        icon: "bank",
        openingCents: 0,
        costCents: null,
        hidden: false,
        currency: "CNY",
      },
    );
    setAccountAmount(
      a
        ? String(
            (a.kind === "liability"
              ? -balance(ledger, a)
              : balance(ledger, a)) / 100,
          )
        : "",
    );
    setCost(
      a?.costCents !== null && a?.costCents !== undefined
        ? String(a.costCents / 100)
        : "",
    );
  };
  function accountActions(a: Account) {
    Alert.alert(a.name, "账户操作", [
      { text: "编辑", onPress: () => openAccount(a) },
      {
        text: a.hidden ? "显示账户" : "隐藏账户",
        onPress: () => {
          void mutate((l) => ({
            ...l,
            accounts: l.accounts.map((x) =>
              x.id === a.id ? { ...x, hidden: !x.hidden } : x,
            ),
          })).catch(() => {});
        },
      },
      {
        text: "上移",
        onPress: () => {
          void mutate((l) => {
            const accounts = [...l.accounts],
              i = accounts.findIndex((x) => x.id === a.id);
            if (i > 0)
              [accounts[i - 1], accounts[i]] = [accounts[i], accounts[i - 1]];
            return { ...l, accounts };
          }).catch(() => {});
        },
      },
      {
        text: "删除",
        style: "destructive",
        onPress: () =>
          Alert.alert("删除账户？", "已有流水的账户只能隐藏。", [
            { text: "取消", style: "cancel" },
            {
              text: "删除",
              style: "destructive",
              onPress: () => {
                void mutate((l) => deleteAccount(l, a.id)).catch((e) =>
                  Alert.alert("无法删除", e.message),
                );
              },
            },
          ]),
      },
      { text: "取消", style: "cancel" },
    ]);
  }
  async function backup() {
    try {
      const file = new File(
        Paths.cache,
        `smartledger-${dateKey()}-${Date.now()}.json`,
      );
      file.create({ overwrite: true });
      file.write(JSON.stringify(current.current, null, 2));
      if (!(await Sharing.isAvailableAsync()))
        throw Error("此设备无法打开分享面板");
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        UTI: "public.json",
      });
      setLastBackup(new Date().toLocaleString("zh-CN"));
    } catch (error: unknown) {
      const e = { message: errorMessage(error) };
      Alert.alert("备份失败", e.message);
    }
  }
  async function restore() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const imported = importLegacy(
        JSON.parse(await new File(result.assets[0].uri).text()),
      );
      Alert.alert(
        "导入账本",
        `${imported.accounts.length} 个账户、${imported.transactions.length} 笔交易，将替换本机账本。建议先导出当前备份。`,
        [
          { text: "取消", style: "cancel" },
          {
            text: "确认导入",
            style: "destructive",
            onPress: () => {
              void mutate(() => imported).catch((e) =>
                Alert.alert("导入失败", e.message),
              );
            },
          },
        ],
      );
    } catch (error: unknown) {
      const e = { message: errorMessage(error) };
      Alert.alert("导入失败", e.message);
    }
  }
  const txRow = (t: Transaction) => (
    <Pressable key={t.id} style={s.card} onPress={() => openTransaction(t)}>
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{t.merchant || "未填写说明"}</Text>
        <Text style={s.small}>
          {t.date} ·{" "}
          {ledger.accounts.find((a) => a.id === t.accountId)?.name ||
            "账户缺失"}
        </Text>
      </View>
      <Text
        style={[
          s.amount,
          {
            color:
              t.type === "expense"
                ? C.red
                : t.type === "income"
                  ? C.green
                  : C.muted,
          },
        ]}
      >
        {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}¥
        {money(t.cents)}
      </Text>
    </Pressable>
  );
  if (!loaded)
    return (
      <SafeAreaView style={s.safe}>
        <View style={{ padding: 24 }}>
          {!error ? (
            <ActivityIndicator />
          ) : (
            <Text style={{ color: C.red }}>{error}</Text>
          )}
          <Text>{status}</Text>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={s.top}>
        <Text style={s.heading}>
          {page === "首页" ? "财务概览" : page === "账户" ? "我的账户" : page}
        </Text>
        <Text style={[s.small, { color: error ? C.red : C.green }]}>
          {status}
        </Text>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 18, paddingBottom: 30 }}
      >
        {page === "首页" && (
          <>
            <Text style={s.small}>{dateKey()}</Text>
            <View
              style={[
                s.metric,
                { backgroundColor: C.lime, marginVertical: 14 },
              ]}
            >
              <Text style={s.small}>净资产 · 人民币账户</Text>
              <Text style={s.large}>¥{money(summary.net)}</Text>
              <Text style={s.small}>
                资产 ¥{money(summary.assets)}　负债 ¥
                {money(summary.liabilities)}
              </Text>
            </View>
            <View style={s.row}>
              <View style={[s.metric, { flex: 1, backgroundColor: C.blue }]}>
                <Text style={s.small}>本月收入</Text>
                <Text style={s.amount}>¥{money(income)}</Text>
              </View>
              <View style={[s.metric, { flex: 1, backgroundColor: C.peach }]}>
                <Text style={s.small}>本月支出</Text>
                <Text style={s.amount}>¥{money(expense)}</Text>
              </View>
            </View>
            <View style={{ marginVertical: 16 }}>
              <Button label="＋ 记一笔" onPress={() => openTransaction()} />
            </View>
            <Text style={s.section}>最近交易</Text>
            {ledger.transactions.slice(0, 10).map(txRow)}
            {!ledger.transactions.length && (
              <Text style={s.small}>
                尚无交易。可导入电脑端 JSON 备份，或添加账户后开始记账。
              </Text>
            )}
          </>
        )}
        {page === "账单" && (
          <>
            <Input label="搜索交易" value={search} change={setSearch} />
            <Button label="＋ 记一笔" onPress={() => openTransaction()} />
            <View style={{ height: 12 }} />
            {ledger.transactions
              .filter((t) => (t.merchant + t.note + t.date).includes(search))
              .map(txRow)}
          </>
        )}
        {page === "账户" && (
          <>
            <View style={s.row}>
              <Button label="＋ 添加账户" onPress={() => openAccount()} />
              <Button
                label={showHidden ? "隐藏已停用" : "显示已停用"}
                quiet
                onPress={() => setShowHidden(!showHidden)}
              />
            </View>
            {(["asset", "liability"] as const).map((kind) => (
              <View key={kind}>
                <Text
                  style={[
                    s.section,
                    { color: kind === "asset" ? C.green : C.red },
                  ]}
                >
                  {kind === "asset" ? "资产" : "负债"}
                </Text>
                {ledger.accounts
                  .filter((a) => a.kind === kind && (showHidden || !a.hidden))
                  .map((a) => (
                    <View
                      key={a.id}
                      style={[s.card, a.hidden && { opacity: 0.5 }]}
                    >
                      <Icon name={a.icon} />
                      <Pressable
                        style={{ flex: 1 }}
                        onPress={() => openAccount(a)}
                      >
                        <Text style={s.name}>{a.name}</Text>
                        <Text style={s.small}>
                          {a.role === "investment"
                            ? "投资账户"
                            : a.kind === "liability"
                              ? "信用 / 借款"
                              : a.currency + " · 现金 / 储蓄"}
                        </Text>
                      </Pressable>
                      <View style={{ alignItems: "flex-end", maxWidth: "46%" }}>
                        <Text
                          style={[
                            s.amount,
                            { color: a.kind === "liability" ? C.red : C.ink },
                          ]}
                        >
                          {a.currency === "CNY" ? "¥" : a.currency + " "}
                          {money(
                            a.kind === "liability"
                              ? -balance(ledger, a)
                              : balance(ledger, a),
                          )}
                        </Text>
                        {a.role === "investment" && (
                          <Text style={[s.small, { fontSize: 10 }]}>
                            {investmentProfit(ledger, a) === null
                              ? "待录入成本后计算收益"
                              : "收益 " + money(investmentProfit(ledger, a)!)}
                          </Text>
                        )}
                      </View>
                      <Pressable
                        accessibilityLabel={a.name + "账户操作"}
                        style={s.more}
                        onPress={() => accountActions(a)}
                      >
                        <Text style={{ fontSize: 20, color: C.muted }}>⋯</Text>
                      </Pressable>
                    </View>
                  ))}
              </View>
            ))}
          </>
        )}
        {page === "导入" && (
          <>
            <Text style={s.small}>
              正数为支出，负数为退款收入；疑似重复需人工核对。
            </Text>
            <Text style={s.label}>入账账户</Text>
            <Choices
              values={ledger.accounts
                .filter((a) => !a.hidden)
                .map((a) => ({ id: a.id, label: a.name }))}
              value={importAccount}
              change={setImportAccount}
            />
            <Input
              label="账单年份（MM/DD 格式）"
              value={billYear}
              change={setBillYear}
              number
            />
            <Input label="账单文本" value={text} change={setText} multiline />
            <Button
              label="解析并对账"
              onPress={() => {
                try {
                  if (!importAccount) throw Error("选择入账账户");
                  if (!/^\d{4}$/.test(billYear)) throw Error("输入四位年份");
                  const rows = parseBill(text, importAccount, Number(billYear));
                  if (!rows.length)
                    throw Error("未识别交易，请检查日期、说明和金额列");
                  setPreview(rows);
                  setSelection(
                    Object.fromEntries(
                      rows.map((t, i) => [i, reconcile(ledger, t) === "new"]),
                    ),
                  );
                } catch (error: unknown) {
                  const e = { message: errorMessage(error) };
                  Alert.alert("无法解析", e.message);
                }
              }}
            />
            {preview.map((t, i) => {
              const match = reconcile(ledger, t);
              return (
                <Pressable
                  key={i}
                  onPress={() =>
                    setSelection({ ...selection, [i]: !selection[i] })
                  }
                  style={s.card}
                >
                  <Text>{selection[i] ? "☑" : "☐"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{t.merchant}</Text>
                    <Text
                      style={[
                        s.small,
                        { color: match === "new" ? C.green : C.red },
                      ]}
                    >
                      {t.date} ·{" "}
                      {match === "new"
                        ? "新增"
                        : match === "duplicate"
                          ? "重复"
                          : "日期接近，需核对"}
                    </Text>
                  </View>
                  <Text>{money(t.cents)}</Text>
                </Pressable>
              );
            })}
            {preview.length > 0 && (
              <Button
                label={`导入所选 ${Object.values(selection).filter(Boolean).length} 笔`}
                disabled={busy}
                onPress={() => {
                  void mutate((l) =>
                    preview.reduce(
                      (next, t, i) =>
                        selection[i]
                          ? saveTransaction(next, {
                              ...t,
                              id: Crypto.randomUUID(),
                            })
                          : next,
                      l,
                    ),
                  )
                    .then(() => {
                      setPreview([]);
                      setText("");
                      setPage("账单");
                    })
                    .catch((e) => Alert.alert("导入失败", e.message));
                }}
              />
            )}
          </>
        )}
        {page === "报表" && <AnnualReview />}
        {page === "设置" && (
          <>
            <Text style={s.section}>本地账本</Text>
            <View style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  {ledger.accounts.length} 个账户 · {ledger.transactions.length}{" "}
                  笔交易
                </Text>
                <Text style={s.small}>SQLite 本机保存，支持离线使用</Text>
              </View>
            </View>
            <Button label="导出 JSON 备份" onPress={() => void backup()} />
            <View style={{ height: 10 }} />
            <Button
              label="导入电脑账本 / 恢复备份"
              quiet
              onPress={() => void restore()}
            />
            <Text style={[s.small, { marginTop: 12 }]}>
              {lastBackup ? "最后打开备份分享：" + lastBackup : "尚未导出备份"}
            </Text>
            <Text style={s.section}>两端同步</Text>
            <Text style={s.small}>
              同步服务尚未联调。当前数据仅保存在此设备；JSON
              导入导出仅用于迁移，不能视为自动同步。
            </Text>
          </>
        )}
      </ScrollView>
      <View style={s.tabs}>
        {(Object.keys(tabIcons) as Page[]).map((p) => (
          <Pressable
            key={p}
            accessibilityLabel={p}
            style={s.tab}
            onPress={() => setPage(p)}
          >
            <Icon name={tabIcons[p]} size={25} />
            <Text
              style={{
                fontSize: 10,
                color: p === page ? C.orange : C.muted,
                marginTop: 4,
              }}
            >
              {p}
            </Text>
          </Pressable>
        ))}
      </View>
      {form && (
        <Sheet
          title={
            ledger.transactions.some((t) => t.id === form.id)
              ? "编辑交易"
              : "记一笔"
          }
          close={() => setForm(null)}
        >
          <Choices
            values={[
              { id: "expense", label: "支出" },
              { id: "income", label: "收入" },
              { id: "transfer", label: "转账" },
            ]}
            value={form.type}
            change={(type) => setForm({ ...form, type: type as TxType })}
          />
          <Input label="金额" value={amount} change={setAmount} number />
          <Input
            label="交易日期 YYYY-MM-DD"
            value={form.date}
            change={(date) => setForm({ ...form, date })}
          />
          <Text style={s.label}>
            {form.type === "transfer" ? "转出账户" : "账户"}
          </Text>
          <Choices
            values={ledger.accounts.map((a) => ({ id: a.id, label: a.name }))}
            value={form.accountId}
            change={(accountId) => setForm({ ...form, accountId })}
          />
          {form.type === "transfer" && (
            <>
              <Text style={s.label}>转入账户</Text>
              <Choices
                values={ledger.accounts
                  .filter((a) => a.id !== form.accountId)
                  .map((a) => ({ id: a.id, label: a.name }))}
                value={form.toAccountId || ""}
                change={(toAccountId) => setForm({ ...form, toAccountId })}
              />
            </>
          )}
          <Input
            label="说明 / 商户"
            value={form.merchant}
            change={(merchant) => setForm({ ...form, merchant })}
          />
          {form.type !== "transfer" && (
            <>
              <Text style={s.label}>分类</Text>
              <Choices
                values={(form.type === "income"
                  ? incomeCategories
                  : expenseCategories
                ).map((c) => ({ id: c.id, label: c.n }))}
                value={form.category}
                change={(category) => setForm({ ...form, category })}
              />
            </>
          )}
          <Input
            label="备注"
            value={form.note}
            change={(note) => setForm({ ...form, note })}
          />
          <Button
            label="保存"
            disabled={busy}
            onPress={() => {
              try {
                const saved = { ...form, cents: cents(amount) };
                void mutate((l) => saveTransaction(l, saved))
                  .then(() => setForm(null))
                  .catch((e) => Alert.alert("保存失败", e.message));
              } catch (error: unknown) {
                const e = { message: errorMessage(error) };
                Alert.alert("检查金额", e.message);
              }
            }}
          />
          {ledger.transactions.some((t) => t.id === form.id) && (
            <View style={{ marginTop: 12 }}>
              <Button
                label="删除交易"
                quiet
                onPress={() =>
                  Alert.alert("删除交易？", "删除后重新计算账户余额。", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "删除",
                      style: "destructive",
                      onPress: () => {
                        void mutate((l) => ({
                          ...l,
                          transactions: l.transactions.filter(
                            (t) => t.id !== form.id,
                          ),
                        }))
                          .then(() => setForm(null))
                          .catch(() => {});
                      },
                    },
                  ])
                }
              />
            </View>
          )}
        </Sheet>
      )}
      {account && (
        <Sheet title="账户设置" close={() => setAccount(null)}>
          <Input
            label="账户名称"
            value={account.name}
            change={(name) => setAccount({ ...account, name })}
          />
          <Choices
            values={[
              { id: "asset", label: "资产" },
              { id: "liability", label: "负债" },
            ]}
            value={account.kind}
            change={(kind) =>
              setAccount({
                ...account,
                kind: kind as Account["kind"],
                role: kind === "liability" ? "credit" : "cash",
              })
            }
          />
          <Choices
            values={[
              { id: "cash", label: "现金 / 储蓄" },
              { id: "investment", label: "投资" },
              { id: "credit", label: "信用卡" },
              { id: "loan", label: "借款" },
            ]}
            value={account.role}
            change={(role) =>
              setAccount({
                ...account,
                role,
                kind: role === "investment" ? "asset" : account.kind,
              })
            }
          />
          <Input
            label={
              account.kind === "liability"
                ? "当前待还金额（溢缴款填负数）"
                : "当前余额"
            }
            value={accountAmount}
            change={setAccountAmount}
            number
          />
          {account.role === "investment" && (
            <Input
              label="投资成本（空白表示未录入）"
              value={cost}
              change={setCost}
              number
            />
          )}
          <Text style={s.label}>图标</Text>
          <View style={s.wrap}>
            {Object.keys(icons).map((name) => (
              <Pressable
                key={name}
                accessibilityLabel={name}
                onPress={() => setAccount({ ...account, icon: name })}
                style={[s.iconChoice, name === account.icon && s.selected]}
              >
                <Icon name={name} />
              </Pressable>
            ))}
          </View>
          <Button
            label="保存账户"
            disabled={busy}
            onPress={() => {
              try {
                if (!account.name.trim()) throw Error("填写账户名称");
                const raw = cents(accountAmount),
                  signed = account.kind === "liability" ? -raw : raw;
                void mutate((l) => {
                  const updated = {
                    ...account,
                    name: account.name.trim(),
                    openingCents:
                      signed -
                      l.transactions.reduce(
                        (sum, t) =>
                          sum +
                          (t.accountId === account.id
                            ? t.type === "income"
                              ? t.cents
                              : -t.cents
                            : t.type === "transfer" &&
                                t.toAccountId === account.id
                              ? t.cents
                              : 0),
                        0,
                      ),
                    costCents: cost.trim() ? cents(cost) : null,
                  };
                  return {
                    ...l,
                    accounts: l.accounts.some((a) => a.id === updated.id)
                      ? l.accounts.map((a) =>
                          a.id === updated.id ? updated : a,
                        )
                      : [...l.accounts, updated],
                  };
                })
                  .then(() => setAccount(null))
                  .catch((e) => Alert.alert("保存失败", e.message));
              } catch (error: unknown) {
                const e = { message: errorMessage(error) };
                Alert.alert("检查账户", e.message);
              }
            }}
          />
        </Sheet>
      )}
    </SafeAreaView>
  );
}
export default function App() {
  return <LedgerScreen page="首页" />;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  top: { padding: 18, paddingBottom: 10 },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: C.ink,
    letterSpacing: -0.5,
  },
  sheetHeading: {
    padding: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  section: {
    fontSize: 16,
    fontWeight: "700",
    color: C.ink,
    marginTop: 24,
    marginBottom: 12,
  },
  name: { fontSize: 13, fontWeight: "600", color: C.ink },
  small: { fontSize: 11, color: C.muted, lineHeight: 17 },
  large: {
    fontSize: 30,
    fontWeight: "700",
    color: C.ink,
    fontVariant: ["tabular-nums"],
    marginVertical: 10,
  },
  amount: {
    fontSize: 15,
    fontWeight: "700",
    color: C.ink,
    fontVariant: ["tabular-nums"],
  },
  metric: { borderRadius: 20, padding: 18, gap: 8 },
  row: { flexDirection: "row", gap: 10 },
  card: {
    backgroundColor: C.white,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  button: {
    backgroundColor: C.orange,
    borderRadius: 12,
    padding: 13,
    alignItems: "center",
  },
  quiet: { backgroundColor: "#ede8e2" },
  input: {
    borderColor: C.line,
    borderWidth: 1,
    backgroundColor: C.white,
    borderRadius: 12,
    padding: 13,
    color: C.ink,
    fontSize: 14,
  },
  label: { fontSize: 12, color: C.muted, marginBottom: 6, marginTop: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    padding: 9,
    borderRadius: 10,
  },
  selected: { backgroundColor: C.lime, borderColor: "#a9c56c" },
  more: {
    backgroundColor: "#f8f6f3",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 9,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: C.white,
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 10,
  },
  tab: { flex: 1, alignItems: "center" },
  iconChoice: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 9,
    backgroundColor: C.white,
  },
  error: { paddingHorizontal: 18, color: C.red, fontSize: 12 },
});
