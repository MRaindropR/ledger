import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySnapshot,
  bindSnapshot,
  changeLedger,
  changeSync,
  type Snapshot,
} from "../src/core/snapshot";
import { saveTransaction, balance, type Transaction } from "../src/core/ledger";
import {
  exchange,
  mergeExchange,
  type ApplyResult,
  type RemotePort,
} from "../src/core/sync-runner";
import { resolveConflict } from "../src/core/sync";
test("two-device database roundtrip: adds, conflicts, deletions and lost replies", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/001_native_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const owner = randomUUID();
    await db.query("insert into auth.users values ($1)", [owner]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const book = (
      await db.query<{ id: string }>("select ledger_create('双端测试') as id")
    ).rows[0].id;
    const binding = {
      ownerId: owner,
      bookId: book,
      projectUrl: "https://example.supabase.co",
    };
    const port: RemotePort = {
      apply: async (operations) =>
        (
          await db.query<{ result: ApplyResult[] }>(
            "select ledger_apply($1,$2::jsonb) as result",
            [book, JSON.stringify(operations)],
          )
        ).rows[0].result,
      pull: async (cursor) =>
        (
          await db.query<{
            cursor: number;
            kind: "account" | "transaction" | "settings";
            id: string;
            value: any;
            deleted: boolean;
            version: number;
            operation_id: string;
          }>(
            "select * from ledger_records where book_id=$1 and cursor>$2 order by cursor limit 2",
            [book, cursor],
          )
        ).rows.map((row) => ({
          cursor: Number(row.cursor),
          entity: {
            kind: row.kind,
            id: row.id,
            value: row.value,
            deleted: row.deleted,
            version: Number(row.version),
            operationId: row.operation_id,
          },
        })),
    };
    // Keep network work outside the serialized snapshot update, exactly as native code does.
    async function run(snapshot: Snapshot) {
      const result = await exchange(snapshot.sync, port);
      return changeSync(snapshot, binding, (s) => mergeExchange(s, result));
    }
    let a = bindSnapshot(
      changeLedger(
        emptySnapshot(),
        (l) => ({
          ...l,
          accounts: [
            {
              id: "cash",
              name: "现金",
              kind: "asset",
              role: "cash",
              icon: "cash",
              openingCents: 100000,
              costCents: null,
              hidden: false,
              currency: "CNY",
            },
          ],
        }),
        randomUUID,
      ),
      binding,
      randomUUID,
    );
    a = await run(a);
    let b = await run(bindSnapshot(emptySnapshot(), binding, randomUUID));
    assert.deepEqual(b.ledger, a.ledger);
    const tx: Transaction = {
      id: "a-tx",
      type: "expense",
      cents: 1000,
      accountId: "cash",
      date: "2026-10-03",
      merchant: "午餐",
      category: "e01",
      note: "",
    };
    a = changeLedger(a, (l) => saveTransaction(l, tx), randomUUID);
    b = changeLedger(
      b,
      (l) => saveTransaction(l, { ...tx, id: "b-tx", cents: 2000 }),
      randomUUID,
    );
    a = await run(a);
    b = await run(b);
    a = await run(a);
    assert.equal(a.ledger.transactions.length, 2);
    assert.equal(balance(a.ledger, a.ledger.accounts[0]), 97000);
    a = changeLedger(
      a,
      (l) => saveTransaction(l, { ...tx, cents: 1500 }),
      randomUUID,
    );
    b = changeLedger(
      b,
      (l) => saveTransaction(l, { ...tx, cents: 1700 }),
      randomUUID,
    );
    a = await run(a);
    b = await run(b);
    assert.equal(Object.keys(b.sync.conflicts).length, 1);
    assert.equal(
      b.ledger.transactions.find((t) => t.id === tx.id)?.cents,
      1700,
    );
    b = changeSync(b, binding, (s) =>
      resolveConflict(s, "transaction:" + tx.id, "local", randomUUID()),
    );
    b = await run(b);
    a = await run(a);
    assert.equal(
      a.ledger.transactions.find((t) => t.id === tx.id)?.cents,
      1700,
    );
    b = changeLedger(
      b,
      (l) => ({
        ...l,
        transactions: l.transactions.filter((t) => t.id !== tx.id),
      }),
      randomUUID,
    );
    b = await run(b);
    a = await run(a);
    assert.equal(a.ledger.transactions.length, 1);
    assert.equal(balance(a.ledger, a.ledger.accounts[0]), 98000);
    a = changeLedger(
      a,
      (l) => saveTransaction(l, { ...tx, id: "retry-tx", cents: 400 }),
      randomUUID,
    );
    await assert.rejects(
      exchange(a.sync, {
        apply: port.apply,
        pull: async () => {
          throw Error("reply lost");
        },
      }),
      /reply lost/,
    );
    assert.ok(Object.keys(a.sync.pending).length > 0);
    a = await run(JSON.parse(JSON.stringify(a)) as Snapshot);
    assert.equal(
      a.ledger.transactions.filter((t) => t.id === "retry-tx").length,
      1,
    );
    assert.equal(Object.keys(a.sync.pending).length, 0);
  } finally {
    await db.close();
  }
});
