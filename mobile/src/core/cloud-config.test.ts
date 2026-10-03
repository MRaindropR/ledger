import test from "node:test";
import assert from "node:assert/strict";
import { cloudConfig } from "./cloud-config";
test("cloud config accepts only project HTTPS and public keys", () => {
  const key = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
  assert.equal(
    cloudConfig("https://example.supabase.co/", key).url,
    "https://example.supabase.co",
  );
  for (const url of [
    "http://example.supabase.co",
    "https://example.supabase.co.evil.com",
    "https://user@evil.supabase.co",
    "https://example.supabase.co/path",
  ])
    assert.throws(() => cloudConfig(url, key));
  assert.throws(
    () =>
      cloudConfig(
        "https://example.supabase.co",
        "sb_secret_abcdefghijklmnopqrstuvwxyz",
      ),
    /公开密钥/,
  );
});
