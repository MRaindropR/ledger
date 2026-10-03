import type { JsonValue, EntityKind } from "./sync";
import type { Ledger } from "./ledger";
import { money } from "./ledger";
import expenseCategories from "../generated/EXP_CATS.json";
import incomeCategories from "../generated/INC_CATS.json";
export function describeConflict(
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
