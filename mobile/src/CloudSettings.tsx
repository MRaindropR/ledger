import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCloud } from "./CloudProvider";
import { useLedger } from "./LedgerProvider";
import { errorMessage } from "./error";
import type { JsonValue, EntityKind } from "./core/sync";
import type { Ledger } from "./core/ledger";
import { money } from "./core/ledger";
import expenseCategories from "./generated/EXP_CATS.json";
import incomeCategories from "./generated/INC_CATS.json";
function describe(
  value: JsonValue,
  deleted: boolean,
  kind: EntityKind,
  ledger: Ledger,
) {
  if (deleted) return "已删除";
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "无内容";
  const v = value as Record<string, JsonValue>,
    accountName = (id: JsonValue) =>
      ledger.accounts.find((a) => a.id === id)?.name ?? "未知账户";
  if (kind === "account")
    return [
      v.name,
      `用途：${v.role === "investment" ? "投资账户" : v.kind === "liability" ? "信用 / 借款" : "现金 / 储蓄"}`,
      `期初余额：${v.currency} ${typeof v.openingCents === "number" ? money(v.openingCents) : "—"}`,
      `投资成本：${typeof v.costCents === "number" ? money(v.costCents) : "未录入"}`,
      v.hidden ? "已隐藏" : "正常显示",
    ].join("\n");
  if (kind === "transaction")
    return [
      v.merchant,
      `${v.type === "expense" ? "支出" : v.type === "income" ? "收入" : "转账"} ${typeof v.cents === "number" ? money(v.cents) : "—"}`,
      `日期：${v.date}`,
      `账户：${accountName(v.accountId)}`,
      v.toAccountId ? `转入：${accountName(v.toAccountId)}` : null,
      `分类：${[...expenseCategories, ...incomeCategories].find((c) => c.id === v.category)?.n ?? v.category}`,
      v.note ? `备注：${v.note}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  const budgets = v.budgets as Record<string, number> | undefined,
    order = v.accountOrder as string[] | undefined;
  const options = v.budgetSettings as {
      flexCapCents: number;
      flex: Record<string, boolean>;
    } | null,
    merchants = v.merchantCategories as Record<string, string> | undefined;
  return [
    budgets
      ? Object.entries(budgets)
          .map(
            ([id, n]) =>
              `${expenseCategories.find((c) => c.id === id)?.n ?? id}预算：${money(n)}`,
          )
          .join("\n")
      : "尚无预算",
    options
      ? `弹性预算上限：${money(options.flexCapCents)}\n` +
        Object.entries(options.flex)
          .map(
            ([id, flex]) =>
              `${expenseCategories.find((c) => c.id === id)?.n ?? id}：${flex ? "弹性" : "固定"}`,
          )
          .join("\n")
      : null,
    order ? "账户顺序：" + order.map(accountName).join("、") : null,
    merchants
      ? Object.entries(merchants)
          .map(
            ([merchant, id]) =>
              `${merchant} → ${[...expenseCategories, ...incomeCategories].find((c) => c.id === id)?.n ?? id}`,
          )
          .join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
function CloudButton({
  label,
  onPress,
  disabled,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        s.button,
        quiet && s.quiet,
        disabled && {
          opacity: 0.5,
        },
      ]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
export function CloudSettings() {
  const cloud = useCloud(),
    ledger = useLedger();
  const [editing, setEditing] = useState(false),
    [url, setUrl] = useState(
      cloud.config?.url ?? "https://fnhfwmjmuzejhsezvdqm.supabase.co",
    ),
    [key, setKey] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState("家庭账本"),
    [working, setWorking] = useState(false);
  const actionRunning = useRef(false);
  const act = useCallback(async (fn: () => Promise<void>) => {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert("操作未完成", errorMessage(e));
    } finally {
      setWorking(false);
      actionRunning.current = false;
    }
  }, []);
  const input = (
    label: string,
    value: string,
    onChangeText: (s: string) => void,
    keyboardType: "default" | "email-address" | "number-pad" = "default",
  ) => (
    <View style={s.field}>
      <Text style={s.small}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        style={s.input}
      />
    </View>
  );
  if (!cloud.ready) return <Text style={s.small}>正在读取同步配置</Text>;
  return (
    <View>
      <Text style={s.heading}>两端同步</Text>
      <Text
        style={[
          s.small,
          {
            marginBottom: 12,
          },
        ]}
      >
        {cloud.status}
      </Text>
      {cloud.lastSync && (
        <Text style={s.small}>
          最后同步：{new Date(cloud.lastSync).toLocaleString("zh-CN")}
        </Text>
      )}
      {!cloud.config || editing ? (
        <View style={s.card}>
          {input("Supabase 项目地址", url, setUrl)}
          {input("公开密钥（sb_publishable_）", key, setKey)}
          <Text style={s.small}>管理员密钥不能填入此处。</Text>
          {
            <CloudButton
              label={"保存同步配置"}
              onPress={() =>
                void act(async () => {
                  await cloud.configure(url, key);
                  setKey("");
                  setEditing(false);
                })
              }
              disabled={working || cloud.busy}
            />
          }
          {cloud.config && (
            <CloudButton
              label={"取消"}
              onPress={() => setEditing(false)}
              disabled={working || cloud.busy}
              quiet={true}
            />
          )}
        </View>
      ) : (
        <>
          {!cloud.session ? (
            <View style={s.card}>
              {input("登录邮箱", email, setEmail, "email-address")}
              {
                <CloudButton
                  label={"发送邮箱验证码"}
                  onPress={() => void act(() => cloud.sendCode(email))}
                  disabled={working || cloud.busy}
                  quiet={true}
                />
              }
              {input("邮箱验证码", code, setCode, "number-pad")}
              {
                <CloudButton
                  label={"登录"}
                  onPress={() =>
                    void act(async () => {
                      await cloud.verifyCode(email, code);
                      setCode("");
                    })
                  }
                  disabled={working || cloud.busy}
                />
              }
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.name}>{cloud.session.user.email ?? "已登录"}</Text>
              {ledger.binding ? (
                <>
                  <Text style={s.small}>
                    待上传 {Object.keys(ledger.sync.pending).length} 项 · 冲突{" "}
                    {Object.keys(ledger.sync.conflicts).length} 项
                  </Text>
                  {
                    <CloudButton
                      label={"立即同步"}
                      onPress={() => void act(cloud.syncNow)}
                      disabled={working || cloud.busy}
                    />
                  }
                </>
              ) : (
                <>
                  {
                    <CloudButton
                      label={"查看我的云端账本"}
                      onPress={() => void act(cloud.listBooks)}
                      disabled={working || cloud.busy}
                      quiet={true}
                    />
                  }
                  {cloud.books.map((book) => (
                    <View key={book.id} style={s.book}>
                      <Text style={s.name}>{book.name}</Text>
                      {
                        <CloudButton
                          label={"连接"}
                          onPress={() =>
                            Alert.alert(
                              "连接这个云端账本？",
                              "本机数据将与云端数据合并；相同记录有差异时会要求你选择。建议先导出本机备份。",
                              [
                                {
                                  text: "取消",
                                  style: "cancel",
                                },
                                {
                                  text: "连接",
                                  onPress: () =>
                                    void act(() => cloud.connectBook(book.id)),
                                },
                              ],
                            )
                          }
                          disabled={working || cloud.busy}
                          quiet={true}
                        />
                      }
                    </View>
                  ))}
                  {input("新账本名称", name, setName)}
                  {
                    <CloudButton
                      label={"创建云端账本并连接"}
                      onPress={() =>
                        Alert.alert(
                          "创建云端账本？",
                          "连接后自动同步本机账本。",
                          [
                            {
                              text: "取消",
                              style: "cancel",
                            },
                            {
                              text: "创建",
                              onPress: () =>
                                void act(() => cloud.createBook(name)),
                            },
                          ],
                        )
                      }
                      disabled={working || cloud.busy}
                    />
                  }
                </>
              )}
              {
                <CloudButton
                  label={"退出登录"}
                  onPress={() => void act(cloud.signOut)}
                  disabled={working || cloud.busy}
                  quiet={true}
                />
              }
            </View>
          )}
          {
            <CloudButton
              label={"更改同步配置"}
              onPress={() => {
                setUrl(cloud.config!.url);
                setEditing(true);
              }}
              disabled={working || cloud.busy}
              quiet={true}
            />
          }
        </>
      )}
      {Object.entries(ledger.sync.conflicts).map(([id, conflict]) => (
        <View key={id} style={s.card}>
          <Text style={s.name}>
            同步冲突 ·{" "}
            {conflict.local.kind === "account"
              ? "账户"
              : conflict.local.kind === "transaction"
                ? "交易"
                : "预算与排序"}
          </Text>
          <Text style={s.small}>本机版本</Text>
          <Text style={s.preview}>
            {describe(
              conflict.local.value,
              conflict.local.deleted,
              conflict.local.kind,
              ledger.ledger,
            )}
          </Text>
          <Text style={s.small}>云端版本</Text>
          <Text style={s.preview}>
            {describe(
              conflict.remote.value,
              conflict.remote.deleted,
              conflict.remote.kind,
              ledger.ledger,
            )}
          </Text>
          {
            <CloudButton
              label={"保留本机版本"}
              onPress={() =>
                Alert.alert(
                  "采用本机版本？",
                  "这条记录将以本机内容更新云端。",
                  [
                    {
                      text: "取消",
                      style: "cancel",
                    },
                    {
                      text: "确认",
                      onPress: () => void act(() => cloud.resolve(id, "local")),
                    },
                  ],
                )
              }
              disabled={working || cloud.busy}
            />
          }
          {
            <CloudButton
              label={"采用云端版本"}
              onPress={() =>
                Alert.alert("采用云端版本？", "本机这条记录将改为云端内容。", [
                  {
                    text: "取消",
                    style: "cancel",
                  },
                  {
                    text: "确认",
                    onPress: () => void act(() => cloud.resolve(id, "remote")),
                  },
                ])
              }
              disabled={working || cloud.busy}
              quiet={true}
            />
          }
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  heading: {
    fontSize: 18,
    fontWeight: "700",
    color: "#243238",
    marginTop: 22,
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd7d0",
    padding: 16,
    borderRadius: 18,
    marginVertical: 10,
  },
  field: {
    marginVertical: 8,
  },
  small: {
    fontSize: 12,
    color: "#6d777b",
    lineHeight: 19,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: "#243238",
  },
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd7d0",
    borderRadius: 10,
    color: "#243238",
    marginTop: 5,
    fontSize: 14,
  },
  button: {
    backgroundColor: "#ff8d50",
    borderRadius: 12,
    padding: 13,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: {
    color: "#243238",
    fontSize: 14,
    fontWeight: "600",
  },
  quiet: {
    backgroundColor: "#f7f2ef",
    borderWidth: 1,
    borderColor: "#ddd7d0",
  },
  book: {
    marginVertical: 10,
  },
  preview: {
    color: "#243238",
    fontSize: 11,
    lineHeight: 16,
    marginVertical: 8,
  },
});
