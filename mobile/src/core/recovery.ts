import { validateLedger, type Ledger } from "./ledger";
import { changeLedger, type Snapshot } from "./snapshot";
export function checkpoint(
  snapshot: Snapshot,
  reason: "import" | "manual",
  id: () => string,
  createdAt = new Date().toISOString(),
): Snapshot {
  if (!Number.isFinite(Date.parse(createdAt))) throw Error("备份时间无效");
  const point = {
    id: id(),
    createdAt,
    reason,
    ledger: JSON.parse(JSON.stringify(snapshot.ledger)) as Ledger,
  };
  validateLedger(point.ledger);
  return {
    ...snapshot,
    local: {
      ...snapshot.local,
      recoveryPoints: [point, ...(snapshot.local?.recoveryPoints ?? [])].slice(
        0,
        3,
      ),
    },
  };
}
export function protectedRestore(
  snapshot: Snapshot,
  ledger: Ledger,
  id: () => string,
  createdAt?: string,
): Snapshot {
  validateLedger(ledger);
  return changeLedger(
    checkpoint(snapshot, "import", id, createdAt),
    () => ledger,
    id,
  );
}
export function validateLocal(local: Snapshot["local"]) {
  if (!local) return;
  if (!Array.isArray(local.recoveryPoints) || local.recoveryPoints.length > 3)
    throw Error("恢复点数据无效");
  for (const point of local.recoveryPoints) {
    if (
      !point.id ||
      !Number.isFinite(Date.parse(point.createdAt)) ||
      !["manual", "import"].includes(point.reason)
    )
      throw Error("恢复点数据无效");
    validateLedger(point.ledger);
  }
  if (
    local.lastShareOpenedAt &&
    !Number.isFinite(Date.parse(local.lastShareOpenedAt))
  )
    throw Error("备份时间无效");
}
