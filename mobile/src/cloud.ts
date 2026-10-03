import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import { AppState } from "react-native";
import { chunkedStorage } from "./core/secure-chunks";
import { cloudConfig, type CloudConfig } from "./core/cloud-config";
import {
  remoteEntity,
  type ApplyResult,
  type Change,
  type RemotePort,
} from "./core/sync-runner";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const secureStorage = chunkedStorage(
  {
    getItem: (key) => SecureStore.getItemAsync(key, options),
    setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
    removeItem: (key) => SecureStore.deleteItemAsync(key, options),
  },
  randomUUID,
);
const configKey = "smartledger.cloud.config";
export async function loadCloudConfig(): Promise<CloudConfig | null> {
  const raw = await SecureStore.getItemAsync(configKey, options);
  if (raw) {
    const c = JSON.parse(raw) as CloudConfig;
    return cloudConfig(c.url, c.publishableKey);
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL,
    key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? cloudConfig(url, key) : null;
}
export async function saveCloudConfig(config: CloudConfig) {
  await SecureStore.setItemAsync(configKey, JSON.stringify(config), options);
}
export function openCloud(config: CloudConfig) {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      storage: secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const update = (state: string) =>
    state === "active"
      ? client.auth.startAutoRefresh()
      : client.auth.stopAutoRefresh();
  update(AppState.currentState);
  const listener = AppState.addEventListener("change", update);
  return {
    client,
    close() {
      listener.remove();
      client.auth.stopAutoRefresh();
    },
  };
}
export async function verifiedOwner(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw Error("请重新登录");
  return data.user.id;
}
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
      })) as Change[];
    },
  };
}
