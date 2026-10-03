import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLedger } from "./LedgerProvider";
import { annualReview } from "./core/review";
import { money } from "./core/ledger";
export function AnnualReview() {
  const { ledger } = useLedger(),
    [year, setYear] = useState(new Date().getFullYear());
  const report = annualReview(ledger, year),
    max = Math.max(1, ...report.months.map((m) => m.expense));
  return (
    <View>
      <View style={s.years}>
        <Pressable
          accessibilityLabel="上一年"
          onPress={() => setYear(Math.max(1900, year - 1))}
        >
          <Text style={s.arrow}>‹</Text>
        </Pressable>
        <Text style={s.heading}>{year} 年度复盘</Text>
        <Pressable
          accessibilityLabel="下一年"
          onPress={() => setYear(Math.min(9999, year + 1))}
        >
          <Text style={s.arrow}>›</Text>
        </Pressable>
      </View>
      <Text style={s.hint}>人民币账户 · 转账不计入收支</Text>
      <View style={[s.card, { backgroundColor: "#e3efb5" }]}>
        <Text style={s.hint}>年度结余</Text>
        <Text style={s.total}>¥{money(report.net)}</Text>
        <Text style={s.hint}>
          收入 ¥{money(report.income)}　支出 ¥{money(report.expense)}
        </Text>
        <Text style={s.hint}>
          结余率{" "}
          {report.savingRate === null
            ? "—"
            : (report.savingRate * 100).toFixed(1) + "%"}
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>每月支出</Text>
        {report.months.map((m) => (
          <View key={m.month} style={s.month}>
            <Text style={{ width: 36 }}>{m.month}月</Text>
            <View style={s.track}>
              <View style={[s.bar, { width: `${(m.expense / max) * 100}%` }]} />
            </View>
            <Text style={s.amount}>¥{money(m.expense)}</Text>
          </View>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.heading}>支出分类</Text>
        {report.categories.length ? (
          report.categories.map((c) => (
            <View key={c.name} style={s.category}>
              <Text style={s.name}>{c.name}</Text>
              <Text>¥{money(c.cents)}</Text>
            </View>
          ))
        ) : (
          <Text style={s.hint}>这一年尚无支出记录</Text>
        )}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  years: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrow: { fontSize: 30, paddingHorizontal: 16, color: "#468769" },
  heading: { fontSize: 17, fontWeight: "700", color: "#243238" },
  hint: { fontSize: 12, color: "#6d777b", marginVertical: 5 },
  card: {
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ddd7d0",
    backgroundColor: "#fff",
    marginTop: 16,
  },
  total: {
    fontSize: 28,
    fontWeight: "700",
    color: "#243238",
    marginVertical: 8,
  },
  month: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  track: { height: 9, backgroundColor: "#f7f2ef", borderRadius: 5, flex: 1 },
  bar: { height: 9, backgroundColor: "#ff8d50", borderRadius: 5 },
  amount: { fontSize: 11, textAlign: "right", width: 92, color: "#243238" },
  category: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1eeeb",
  },
  name: { color: "#243238", flex: 1 },
});
