import {
  acknowledge,
  receive,
  uploadable,
  type Entity,
  type Operation,
  type SyncState,
} from "./sync";
export type ApplyResult = {
  status: "accepted" | "conflict";
  operationId: string;
  remote: Entity;
};
export type Change = { cursor: number; entity: Entity };
export type RemotePort = {
  apply: (operations: Operation[]) => Promise<ApplyResult[]>;
  pull: (cursor: number) => Promise<Change[]>;
};
export type SyncResult = {
  submitted: Operation[];
  applied: ApplyResult[];
  changes: Change[];
  cursor: number;
};
export function remoteEntity(raw: unknown): Entity {
  if (!raw || typeof raw !== "object") throw Error("云端记录格式无效");
  const e = raw as Entity;
  if (
    !["account", "transaction", "settings"].includes(e.kind) ||
    typeof e.id !== "string" ||
    !e.id ||
    typeof e.operationId !== "string" ||
    !Number.isSafeInteger(e.version) ||
    e.version < 1 ||
    typeof e.deleted !== "boolean" ||
    (!e.deleted &&
      (!e.value || typeof e.value !== "object" || Array.isArray(e.value)))
  )
    throw Error("云端记录格式无效");
  if (
    !e.deleted &&
    e.kind !== "settings" &&
    (e.value as { id?: unknown }).id !== e.id
  )
    throw Error("云端记录 ID 不一致");
  return e;
}
export async function exchange(
  state: SyncState,
  remote: RemotePort,
): Promise<SyncResult> {
  const submitted = uploadable(state),
    applied: ApplyResult[] = [],
    changes: Change[] = [];
  for (let i = 0; i < submitted.length; i += 100) {
    const batch = submitted.slice(i, i + 100),
      results = await remote.apply(batch);
    if (results.length !== batch.length)
      throw Error("云端未完整确认上传结果，保留本地队列");
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (
        !["accepted", "conflict"].includes(r.status) ||
        r.operationId !== batch[j].operationId
      )
        throw Error("云端确认与上传操作不匹配");
      remoteEntity(r.remote);
    }
    applied.push(...results);
  }
  let cursor = state.cursor,
    pages = 0;
  for (;;) {
    if (++pages > 20000) throw Error("账本过大，分批同步未能完成");
    const page = await remote.pull(cursor);
    if (!page.length) break;
    for (const change of page) {
      if (!Number.isSafeInteger(change.cursor) || change.cursor <= cursor)
        throw Error("云端增量游标无效");
      remoteEntity(change.entity);
      cursor = change.cursor;
      changes.push(change);
    }
  }
  return { submitted, applied, changes, cursor };
}
export function mergeExchange(state: SyncState, result: SyncResult): SyncState {
  let next = state;
  const operations = new Map(
    result.submitted.map((op) => [op.operationId, op]),
  );
  for (const r of result.applied) {
    const op = operations.get(r.operationId);
    if (!op) throw Error("无法匹配云端上传确认");
    next =
      r.status === "accepted"
        ? acknowledge(next, op, r.remote)
        : receive(next, r.remote);
  }
  for (const change of result.changes) next = receive(next, change.entity);
  return { ...next, cursor: Math.max(next.cursor, result.cursor) };
}
