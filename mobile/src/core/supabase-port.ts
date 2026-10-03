import type { SupabaseClient } from "@supabase/supabase-js";
import { remoteEntity, type ApplyResult, type RemotePort } from "./sync-runner";
export function remoteBook(client: SupabaseClient, bookId: string): RemotePort {
  return {
    async apply(operations) {
      const { data, error } = await client.rpc("ledger_apply", {
        p_book: bookId,
        p_operations: operations,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw Error("云端上传响应无效");
      return data as ApplyResult[];
    },
    async pull(cursor) {
      const { data, error } = await client
        .from("ledger_records")
        .select("kind,id,value,deleted,version,operation_id,cursor")
        .eq("book_id", bookId)
        .gt("cursor", cursor)
        .order("cursor", { ascending: true })
        .limit(500);
      if (error) throw error;
      if (!Array.isArray(data)) throw Error("云端增量响应无效");
      return data.map((row) => ({
        cursor: Number(row.cursor),
        entity: remoteEntity({
          kind: row.kind,
          id: row.id,
          value: row.value,
          deleted: row.deleted,
          version: Number(row.version),
          operationId: row.operation_id,
        }),
      }));
    },
  };
}
