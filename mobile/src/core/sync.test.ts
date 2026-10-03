import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  emptySync,
  queueChange,
  receive,
  acknowledge,
  resolveConflict,
  materialize,
  uploadable,
} from "./sync";
const local = {
  kind: "transaction" as const,
  id: "t",
  value: { cents: 100 },
  deleted: false,
  operationId: "device-a-op",
};
test("离线新增立即可见并进入上传队列", () => {
  const s = queueChange(emptySync(), local);
  assert.equal(uploadable(s).length, 1);
  assert.equal(materialize(s).length, 1);
  assert.equal(uploadable(s)[0].baseVersion, 0);
});
test("重复响应幂等，自己的确认移除待上传记录", () => {
  const pending = queueChange(emptySync(), local),
    remote = { ...local, version: 1 };
  const s = receive(pending, remote);
  assert.equal(uploadable(s).length, 0);
  assert.deepEqual(receive(s, remote), s);
});
test("不同设备新增交易互不覆盖", () => {
  const a = queueChange(emptySync(), local),
    s = receive(a, { ...local, id: "other", version: 1, operationId: "b" });
  assert.equal(materialize(s).length, 2);
  assert.equal(uploadable(s).length, 1);
});
test("同笔冲突保留双方数据并阻止静默上传", () => {
  const s = receive(queueChange(emptySync(), local), {
    ...local,
    value: { cents: 200 },
    version: 1,
    operationId: "b",
  });
  assert.equal(Object.keys(s.conflicts).length, 1);
  assert.equal(uploadable(s).length, 0);
  assert.deepEqual(materialize(s)[0].value, { cents: 100 });
  assert.throws(() => queueChange(s, { ...local, operationId: "new" }));
});
test("选择本机版本须基于最新服务器版本重新提交", () => {
  const s = receive(queueChange(emptySync(), local), {
      ...local,
      version: 3,
      operationId: "b",
    }),
    resolved = resolveConflict(s, "transaction:t", "local", "retry");
  assert.equal(uploadable(resolved)[0].baseVersion, 3);
  assert.equal(uploadable(resolved)[0].operationId, "retry");
});
test("删除标记避免远端拉取恢复已删除流水", () => {
  const s = queueChange(receive(emptySync(), { ...local, version: 1 }), {
    ...local,
    value: null,
    deleted: true,
    operationId: "delete",
  });
  assert.equal(materialize(s).length, 0);
  const conflict = receive(s, {
    ...local,
    version: 2,
    operationId: "remote-edit",
  });
  assert.equal(materialize(conflict).length, 0);
  assert.equal(Object.keys(conflict.conflicts).length, 1);
});

test("上传过程中继续编辑：旧确认不丢弃新编辑，也不制造冲突", () => {
  const first = queueChange(emptySync(), local),
    submitted = uploadable(first)[0];
  const edited = queueChange(first, {
    ...local,
    value: { cents: 300 },
    operationId: "new-edit",
  });
  const ack = acknowledge(edited, submitted, { ...local, version: 1 });
  assert.equal(Object.keys(ack.conflicts).length, 0);
  assert.equal(ack.pending["transaction:t"].operationId, "new-edit");
  assert.equal(ack.pending["transaction:t"].baseVersion, 1);
  assert.deepEqual(materialize(ack)[0].value, { cents: 300 });
});
