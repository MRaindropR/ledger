import { normalizeMerchant, type Ledger, type Transaction } from "./ledger";
import expenseCategories from "../generated/EXP_CATS.json";
import incomeCategories from "../generated/INC_CATS.json";

export function applyMerchantRule(
  ledger: Ledger,
  tx: Transaction,
): Transaction {
  if (tx.type === "transfer") return tx;
  const key = normalizeMerchant(tx.merchant);
  if (!key) return tx;
  // Legacy desktops stored unnormalized merchant names. Prefer the exact
  // normalized key, then accept only an unambiguous legacy equivalent.
  const direct = ledger.merchantCategories[key];
  const legacy = [
    ...new Set(
      Object.entries(ledger.merchantCategories)
        .filter(([name]) => normalizeMerchant(name) === key)
        .map(([, category]) => category),
    ),
  ];
  const category = direct ?? (legacy.length === 1 ? legacy[0] : undefined);
  const allowed = tx.type === "income" ? incomeCategories : expenseCategories;
  return category && allowed.some((c) => c.id === category)
    ? { ...tx, category }
    : tx;
}

export function rememberMerchantRule(ledger: Ledger, tx: Transaction): Ledger {
  if (tx.type === "transfer") return ledger;
  const key = normalizeMerchant(tx.merchant);
  if (!key) throw Error("请先填写商户名称");
  const allowed = tx.type === "income" ? incomeCategories : expenseCategories;
  if (!allowed.some((c) => c.id === tx.category))
    throw Error("该分类与收支类型不匹配");
  // Remove legacy aliases so desktop and native clients share one rule.
  const rules = Object.fromEntries(
    Object.entries(ledger.merchantCategories).filter(
      ([name]) => normalizeMerchant(name) !== key,
    ),
  );
  rules[key] = tx.category;
  return { ...ledger, merchantCategories: rules };
}
