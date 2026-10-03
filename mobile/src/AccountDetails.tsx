import React, { useMemo } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { accountStatement } from "./core/accounts";
import { money, type Ledger } from "./core/ledger";

export function AccountDetails({
  ledger,
  id,
  close,
}: {
  ledger: Ledger;
  id: string;
  close: () => void;
}) {
  const statement = useMemo(
    () =>
      ledger.accounts.some((a) => a.id === id)
        ? accountStatement(ledger, id)
        : null,
    [ledger, id],
  );
  const account = statement?.account;
  const prefix =
    account?.currency === "CNY" ? "¥" : (account?.currency || "") + " ";
  const format = (value: number) => prefix + money(value);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.heading}>
          <Text style={styles.title}>{account?.name || "账户已删除"}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={styles.close}
          >
            <Text style={styles.text}>关闭</Text>
          </Pressable>
        </View>
        {statement ? (
          <FlatList
            data={statement.entries}
            keyExtractor={(entry) => entry.transaction.id}
            initialNumToRender={15}
            windowSize={9}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.summary}>
                <Text style={styles.muted}>
                  {account?.hidden ? "已停用 · " : ""}当前
                  {account?.kind === "liability"
                    ? "待还（负数为溢缴）"
                    : "余额"}
                </Text>
                <Text style={styles.total}>
                  {format(
                    account?.kind === "liability"
                      ? -statement.current
                      : statement.current,
                  )}
                </Text>
                <Text style={styles.text}>
                  累计收入 {format(statement.income)} · 支出{" "}
                  {format(statement.expense)}
                </Text>
                <Text style={styles.text}>
                  转入 {format(statement.transferIn)} · 转出{" "}
                  {format(statement.transferOut)}
                </Text>
                <Text style={styles.muted}>
                  期初余额 {format(account!.openingCents)} ·{" "}
                  {statement.entries.length} 笔流水
                </Text>
              </View>
            }
            ListEmptyComponent={<Text style={styles.muted}>暂无流水</Text>}
            renderItem={({ item }) => {
              const t = item.transaction;
              const otherId = t.accountId === id ? t.toAccountId : t.accountId;
              const other =
                ledger.accounts.find((a) => a.id === otherId)?.name ||
                "账户缺失";
              return (
                <View style={styles.entry}>
                  <View style={styles.row}>
                    <Text style={[styles.text, { flex: 1, fontWeight: "600" }]}>
                      {t.merchant ||
                        (t.type === "transfer" ? "账户转账" : "未填写说明")}
                    </Text>
                    <Text
                      style={[
                        styles.text,
                        {
                          color: item.delta >= 0 ? "#468769" : "#c45b68",
                          fontWeight: "600",
                        },
                      ]}
                    >
                      {item.delta >= 0 ? "+" : "−"}
                      {format(Math.abs(item.delta))}
                    </Text>
                  </View>
                  <Text style={styles.muted}>
                    {t.date}
                    {t.postedDate ? " · 记账 " + t.postedDate : ""}
                    {t.type === "transfer"
                      ? (item.delta > 0 ? " · 转入自 " : " · 转出至 ") + other
                      : ""}
                  </Text>
                  {!!t.note && <Text style={styles.text}>{t.note}</Text>}
                  <Text style={styles.muted}>
                    余额 {format(item.balanceAfter)}
                  </Text>
                </View>
              );
            }}
            ListFooterComponent={
              <Text style={styles.muted}>
                余额按交易日期排列；同日流水按记录编号排列。
              </Text>
            }
          />
        ) : (
          <Text style={styles.text}>此账户已从当前账本删除。</Text>
        )}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f7f2ef" },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#243238", flex: 1 },
  close: { padding: 12, backgroundColor: "#fff", borderRadius: 12 },
  list: { padding: 20, paddingTop: 0, paddingBottom: 40 },
  summary: {
    backgroundColor: "#e3efb5",
    borderRadius: 18,
    padding: 20,
    gap: 9,
    marginBottom: 16,
  },
  total: { fontSize: 28, fontWeight: "700", color: "#243238" },
  text: { fontSize: 14, color: "#243238" },
  muted: { fontSize: 12, color: "#6d777b", lineHeight: 19 },
  entry: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd7d0",
    borderRadius: 16,
    padding: 16,
    gap: 7,
    marginBottom: 10,
  },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
});
