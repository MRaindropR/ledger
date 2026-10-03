import type { Ledger } from "./ledger";
export function annualReview(ledger: Ledger, year: number, currency = "CNY") {
  if (!Number.isInteger(year) || year < 1900 || year > 9999)
    throw Error("年份无效");
  const accounts = new Set(
    ledger.accounts.filter((a) => a.currency === currency).map((a) => a.id),
  );
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    income: 0,
    expense: 0,
    count: 0,
  }));
  const categories: Record<string, number> = {};
  let income = 0,
    expense = 0;
  for (const t of ledger.transactions) {
    if (
      !t.date.startsWith(year + "-") ||
      !accounts.has(t.accountId) ||
      t.type === "transfer"
    )
      continue;
    const month = months[Number(t.date.slice(5, 7)) - 1];
    if (!month) continue;
    month.count++;
    if (t.type === "income") {
      income += t.cents;
      month.income += t.cents;
    } else {
      expense += t.cents;
      month.expense += t.cents;
      categories[t.category] = (categories[t.category] ?? 0) + t.cents;
    }
  }
  return {
    year,
    currency,
    income,
    expense,
    net: income - expense,
    savingRate: income > 0 ? (income - expense) / income : null,
    months,
    categories: Object.entries(categories)
      .map(([name, cents]) => ({ name, cents }))
      .sort((a, b) => b.cents - a.cents),
  };
}
