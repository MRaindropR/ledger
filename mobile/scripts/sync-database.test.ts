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
    const checks = await db.exec(
      await readFile(
        new URL("../../supabase/check_native_sync.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(checks[0].rows.length, 3);
    for (const row of checks[0].rows as any[]) {
      assert.equal(row.rls_enabled, true);
      assert.equal(row.anon_can_read, false);
      assert.equal(row.authenticated_can_insert, false);
      assert.equal(row.authenticated_can_update, false);
      assert.equal(row.authenticated_can_delete, false);
      assert.equal(
        row.authenticated_can_read,
        row.table_name !== "ledger_receipts",
      );
    }
    assert.equal(checks[1].rows.length, 2);
    assert.equal(checks[2].rows.length, 2);
    for (const row of checks[2].rows as any[]) {
      assert.equal(row.security_definer, true);
      assert.equal(row.anon_can_execute, false);
      assert.equal(row.authenticated_can_execute, true);
    }
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

test("migration refuses existing ledger schema and preserves legacy data atomically", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create table public.sync_data(value text); insert into public.sync_data values ('legacy sentinel'); create table public.ledger_books(marker text); insert into public.ledger_books values ('existing sentinel');",
    );
    const migration = await readFile(
      new URL("../../supabase/migrations/001_native_sync.sql", import.meta.url),
      "utf8",
    );
    await assert.rejects(db.exec(migration), /ledger_schema_exists/);
    await db.exec("rollback");
    assert.deepEqual((await db.query("select * from public.sync_data")).rows, [
      { value: "legacy sentinel" },
    ]);
    assert.deepEqual(
      (await db.query("select * from public.ledger_books")).rows,
      [{ marker: "existing sentinel" }],
    );
    const result = await db.query<{
      records: string | null;
      receipts: string | null;
    }>(
      "select to_regclass('public.ledger_records')::text as records, to_regclass('public.ledger_receipts')::text as receipts",
    );
    assert.deepEqual(result.rows, [{ records: null, receipts: null }]);
  } finally {
    await db.close();
  }
});

test("migration rolls back newly created tables when a later permission step fails", async () => {
  const db = new PGlite();
  try {
    // Missing authenticated role causes failure after all three CREATE TABLEs.
    await db.exec(
      "create schema auth; create table auth.users(id uuid primary key); create table public.sync_data(value text); insert into public.sync_data values ('legacy sentinel');",
    );
    const migration = await readFile(
      new URL("../../supabase/migrations/001_native_sync.sql", import.meta.url),
      "utf8",
    );
    await assert.rejects(db.exec(migration));
    await db.exec("rollback");
    const rows = await db.query(
      "select to_regclass('public.ledger_books')::text as books, to_regclass('public.ledger_records')::text as records, to_regclass('public.ledger_receipts')::text as receipts",
    );
    assert.deepEqual(rows.rows, [
      { books: null, records: null, receipts: null },
    ]);
    assert.deepEqual((await db.query("select * from public.sync_data")).rows, [
      { value: "legacy sentinel" },
    ]);
  } finally {
    await db.close();
  }
});
