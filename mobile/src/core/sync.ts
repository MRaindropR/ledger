export type EntityKind = "account" | "transaction" | "settings";
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Entity = {
  kind: EntityKind;
  id: string;
  value: JsonValue;
  deleted: boolean;
  version: number;
  operationId: string;
};
export type Operation = {
  kind: EntityKind;
  id: string;
  value: JsonValue;
  deleted: boolean;
  baseVersion: number;
  operationId: string;
};
export type Conflict = { local: Operation; remote: Entity };
export type SyncState = {
  cursor: number;
  records: Record<string, Entity>;
  pending: Record<string, Operation>;
  conflicts: Record<string, Conflict>;
};
export const entityKey = (kind: EntityKind, id: string) => kind + ":" + id;
export const emptySync = (): SyncState => ({
  cursor: 0,
  records: {},
  pending: {},
  conflicts: {},
});
export function queueChange(
  state: SyncState,
  change: Omit<Operation, "baseVersion">,
): SyncState {
  const key = entityKey(change.kind, change.id);
  if (state.conflicts[key]) throw Error("先解决同步冲突，再修改这条记录");
  const baseVersion =
    state.pending[key]?.baseVersion ?? state.records[key]?.version ?? 0;
  return {
    ...state,
    pending: { ...state.pending, [key]: { ...change, baseVersion } },
  };
}
export function receive(state: SyncState, remote: Entity): SyncState {
  const key = entityKey(remote.kind, remote.id),
    known = state.records[key],
    pending = state.pending[key];
  if (known && remote.version <= known.version) return state;
  const records = { ...state.records, [key]: remote },
    nextPending = { ...state.pending },
    conflicts = { ...state.conflicts };
  if (pending) {
    if (pending.operationId === remote.operationId) {
      delete nextPending[key];
      delete conflicts[key];
    } else if (remote.version > pending.baseVersion) {
      conflicts[key] = { local: pending, remote };
    }
  }
  return { ...state, records, pending: nextPending, conflicts };
}
/** An edit made while a previous revision is in flight must survive its acknowledgement. */
export function acknowledge(
  state: SyncState,
  submitted: Operation,
  remote: Entity,
): SyncState {
  if (remote.operationId !== submitted.operationId)
    throw Error("服务器确认与上传操作不匹配");
  const key = entityKey(remote.kind, remote.id),
    pending = state.pending[key],
    known = state.records[key];
  if (known && known.version > remote.version) return state;
  if (
    pending &&
    pending.operationId !== submitted.operationId &&
    pending.baseVersion === submitted.baseVersion
  ) {
    const updated = {
      ...state,
      pending: {
        ...state.pending,
        [key]: { ...pending, baseVersion: remote.version },
      },
    };
    return receive(updated, remote);
  }
  return receive(state, remote);
}
export function resolveConflict(
  state: SyncState,
  key: string,
  choice: "local" | "remote",
  operationId: string,
): SyncState {
  const conflict = state.conflicts[key];
  if (!conflict) throw Error("冲突不存在");
  const pending = { ...state.pending },
    conflicts = { ...state.conflicts };
  delete conflicts[key];
  if (choice === "remote") delete pending[key];
  else
    pending[key] = {
      ...conflict.local,
      baseVersion: conflict.remote.version,
      operationId,
    };
  return { ...state, pending, conflicts };
}
export function materialize(state: SyncState): Entity[] {
  const result = { ...state.records };
  for (const [key, op] of Object.entries(state.pending))
    result[key] = {
      kind: op.kind,
      id: op.id,
      value: op.value,
      deleted: op.deleted,
      version: op.baseVersion,
      operationId: op.operationId,
    };
  return Object.values(result).filter((x) => !x.deleted);
}
export function uploadable(state: SyncState): Operation[] {
  return Object.entries(state.pending)
    .filter(([key]) => !state.conflicts[key])
    .map(([, op]) => op);
}
