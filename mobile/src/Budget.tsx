import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLedger } from "./LedgerProvider";
import { dateKey, money } from "./core/ledger";
import {
  applyBudgetDraft,
  budgetDraft,
  defaultFlexible,
  hiddenBudgetCategories,
  monthlyBudget,
  type BudgetProgress,
} from "./core/budget";
import { errorMessage } from "./error";
import categories from "./generated/EXP_CATS.json";
const color = {
  ink: "#243238",
  muted: "#6d777b",
  line: "#ddd7d0",
  background: "#f7f2ef",
  green: "#468769",
  orange: "#ff8d50",
  red: "#c45b68",
};
function Progress({
  name,
  progress,
}: {
  name: string;
  progress: BudgetProgress;
}) {
  const ratio = progress.ratio ?? 0,
    tone = ratio > 1 ? color.red : ratio >= 0.7 ? color.orange : color.green;
  return (
    <View style={s.progress}>
      <View style={s.row}>
        <Text style={s.label}>{name}</Text>
        <Text style={s.amount}>
          ¥{money(progress.spent)} / ¥{money(progress.limit)}
        </Text>
      </View>
      <View style={s.track}>
        <View
          style={[
            s.fill,
            {
              width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
              backgroundColor: tone,
            },
          ]}
        />
      </View>
      <Text style={[s.hint, { color: tone }]}>
        {progress.remaining < 0
          ? "超支 ¥" + money(-progress.remaining)
          : progress.remaining === 0
            ? "本月额度已用完"
            : "剩余 ¥" + money(progress.remaining)}
        　·　已用 {(ratio * 100).toFixed(0)}%
      </Text>
    </View>
  );
}
function BudgetEditor({ close }: { close: () => void }) {
  const store = useLedger(),
    [base] = useState(() => store.ledger),
    [draft, setDraft] = useState(() => budgetDraft(base)),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    lock = useRef(false);
  const visible = [
    ...categories.filter((c) => !hiddenBudgetCategories.has(c.id)),
    ...Object.keys(base.budgets)
      .filter((id) => !categories.some((c) => c.id === id))
      .map((id) => ({ id, n: id, ic: "", co: "" })),
  ];
  const disabled = saving || store.busy;
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await store.mutate((current) => applyBudgetDraft(current, base, draft));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      visible
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={() => {
        if (!disabled) close();
      }}
    >
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.header}>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              disabled={disabled}
            >
              <Text style={s.link}>取消</Text>
            </Pressable>
            <Text style={s.title}>本月预算</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="保存预算"
              onPress={() => void save()}
              disabled={disabled}
            >
              <Text
                style={[
                  s.link,
                  { color: disabled ? color.muted : color.green },
                ]}
              >
                {saving ? "保存中" : "保存"}
              </Text>
            </Pressable>
          </View>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[s.error, { paddingHorizontal: 18 }]}
            >
              {error}
            </Text>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
          >
            <View style={s.card}>
              <Text style={s.title}>非必需消费总额</Text>
              <Text style={s.hint}>人民币 / 月</Text>
              <TextInput
                accessibilityLabel="非必需消费月预算"
                value={draft.cap}
                editable={!disabled}
                onChangeText={(cap) => setDraft({ ...draft, cap })}
                keyboardType="decimal-pad"
                placeholder="不设上限"
                placeholderTextColor={color.muted}
                style={[s.input, { marginTop: 12 }]}
              />
            </View>
            <Text style={s.hint}>
              开启“非必需”的分类计入上方总额；分类预算单独跟踪。空白或 0
              表示不设上限。
            </Text>
            <View style={{ height: 16 }} />
            {visible.map((category) => (
              <View key={category.id} style={s.card}>
                <View style={s.row}>
                  <Text style={s.label}>{category.n}</Text>
                  <View style={s.row}>
                    <Text style={s.hint}>非必需</Text>
                    <Switch
                      accessibilityLabel={category.n + "计入非必需消费"}
                      value={
                        draft.flex[category.id] ??
                        defaultFlexible.has(category.id)
                      }
                      disabled={disabled}
                      onValueChange={(value) =>
                        setDraft({
                          ...draft,
                          flex: { ...draft.flex, [category.id]: value },
                        })
                      }
                      trackColor={{ false: color.line, true: color.green }}
                    />
                  </View>
                </View>
                <View style={[s.row, { marginTop: 10 }]}>
                  <Text style={s.hint}>月预算 ¥</Text>
                  <TextInput
                    accessibilityLabel={category.n + "月预算"}
                    value={draft.amounts[category.id] ?? ""}
                    editable={!disabled}
                    onChangeText={(value) =>
                      setDraft({
                        ...draft,
                        amounts: { ...draft.amounts, [category.id]: value },
                      })
                    }
                    keyboardType="decimal-pad"
                    placeholder="不设上限"
                    placeholderTextColor={color.muted}
                    style={[s.input, { flex: 1, textAlign: "right" }]}
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
export function BudgetPanel() {
  const { ledger } = useLedger(),
    [editing, setEditing] = useState(false),
    report = monthlyBudget(ledger, dateKey().slice(0, 7)),
    configured = report.flexible.limit > 0 || report.categories.length > 0;
  return (
    <View style={s.card}>
      <View style={s.row}>
        <Text style={s.title}>本月预算</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="设置本月预算"
          onPress={() => setEditing(true)}
        >
          <Text style={s.link}>设置</Text>
        </Pressable>
      </View>
      <Text style={[s.hint, { marginTop: 6 }]}>
        人民币账户 · {dateKey().slice(0, 7)}
      </Text>
      {configured ? (
        <>
          {report.flexible.limit > 0 && (
            <Progress name="非必需消费" progress={report.flexible} />
          )}{" "}
          {report.categories.map((c) => (
            <Progress
              key={c.id}
              name={
                categories.find((category) => category.id === c.id)?.n ?? c.id
              }
              progress={c}
            />
          ))}
        </>
      ) : (
        <Text style={[s.hint, { marginTop: 14 }]}>尚未设置预算</Text>
      )}
      {editing && <BudgetEditor close={() => setEditing(false)} />}
    </View>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  header: {
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  card: {
    backgroundColor: "#fff",
    borderColor: color.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { fontSize: 16, fontWeight: "700", color: color.ink },
  label: { fontSize: 13, fontWeight: "600", color: color.ink, flexShrink: 1 },
  link: {
    fontSize: 14,
    fontWeight: "600",
    color: color.green,
    paddingVertical: 6,
  },
  hint: { fontSize: 11, color: color.muted, lineHeight: 18 },
  amount: {
    fontSize: 12,
    color: color.ink,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
    textAlign: "right",
  },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 10,
    padding: 12,
    color: color.ink,
    backgroundColor: "#fff",
    fontSize: 14,
  },
  progress: { marginTop: 18, gap: 7 },
  track: {
    height: 7,
    backgroundColor: "#eee9e3",
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: { height: 7, borderRadius: 4 },
  error: { color: color.red, fontSize: 12, lineHeight: 18, marginBottom: 12 },
});
