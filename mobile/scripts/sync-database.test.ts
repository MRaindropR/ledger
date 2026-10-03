import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";

test("database sync: permissions, revisions, retries and tombstones", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/001_native_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const alice = randomUUID(),
      bob = randomUUID();
    await db.query("insert into auth.users values ($1),($2)", [alice, bob]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      alice,
    ]);
    const created = await db.query<{ id: string }>(
      "select ledger_create('家庭账本') as id",
    );
    const book = created.rows[0].id;
    const op = {
      kind: "account",
      id: "cash",
      value: { name: "现金", openingCents: 10000 },
      deleted: false,
      baseVersion: 0,
      operationId: randomUUID(),
    };
    const apply = async (operations: unknown[]) =>
      (
        await db.query<{ result: any }>(
          "select ledger_apply($1,$2::jsonb) as result",
          [book, JSON.stringify(operations)],
        )
      ).rows[0].result;
    const first = await apply([op]);
    assert.equal(first[0].status, "accepted");
    assert.equal(first[0].remote.version, 1);
    assert.deepEqual(
      await apply([op]),
      first,
      "a network retry must not apply twice",
    );
    await assert.rejects(
      apply([{ ...op, value: { name: "不同内容" } }]),
      /operation_id_reused/,
    );
    const conflict = await apply([
      { ...op, operationId: randomUUID(), value: { name: "过期修改" } },
    ]);
    assert.equal(conflict[0].status, "conflict");
    assert.equal(conflict[0].remote.value.name, "现金");
    const before = await db.query<{ cursor: number }>(
      "select cursor from ledger_records",
    );
    const update = await apply([
      {
        ...op,
        baseVersion: 1,
        operationId: randomUUID(),
        value: { name: "新版现金" },
      },
    ]);
    assert.equal(update[0].remote.version, 2);
    const after = await db.query<{ cursor: number }>(
      "select cursor from ledger_records",
    );
    assert.ok(
      Number(after.rows[0].cursor) > Number(before.rows[0].cursor),
      "updates advance incremental cursor",
    );
    await apply([
      {
        ...op,
        baseVersion: 2,
        operationId: randomUUID(),
        deleted: true,
        value: null,
      },
    ]);
    const tombstone = await db.query<{ deleted: boolean; version: number }>(
      "select deleted,version from ledger_records",
    );
    assert.equal(tombstone.rows[0].deleted, true);
    assert.equal(Number(tombstone.rows[0].version), 3);
    await assert.rejects(
      db.exec("delete from ledger_records"),
      /permission denied/,
    );
    await assert.rejects(
      apply([{ ...op, deleted: undefined, operationId: randomUUID() }]),
      /invalid_operation/,
    );
    await assert.rejects(
      apply([{ ...op, kind: undefined, operationId: randomUUID() }]),
      /invalid_operation/,
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      bob,
    ]);
    assert.equal((await db.query("select * from ledger_books")).rows.length, 0);
    assert.equal(
      (await db.query("select * from ledger_records")).rows.length,
      0,
    );
    await assert.rejects(apply([op]), /book_access_denied/);
    await db.exec("set role anon");
    await assert.rejects(
      db.exec("select * from ledger_records"),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("select ledger_create('未登录')"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
