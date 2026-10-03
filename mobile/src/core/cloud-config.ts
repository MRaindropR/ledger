export type CloudConfig = { url: string; publishableKey: string };
export function cloudConfig(url: string, key: string): CloudConfig {
  const parsed = new URL(url.trim());
  if (
    parsed.protocol !== "https:" ||
    !/^[-a-z0-9]+\.supabase\.co$/.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw Error("填写 Supabase 项目 HTTPS 地址");
  const publishableKey = key.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey))
    throw Error(
      "这里只接受 sb_publishable_ 开头的公开密钥；不要填写管理员密钥",
    );
  return { url: parsed.origin, publishableKey };
}
