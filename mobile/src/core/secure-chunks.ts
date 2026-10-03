export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};
type Manifest = { generation: string; count: number };
/** Commit a small manifest last, so a failed token rotation keeps the old session readable. */
export function chunkedStorage(
  store: KeyValueStore,
  id: () => string,
): KeyValueStore {
  const manifestKey = (key: string) => key + ".manifest";
  const chunkKey = (key: string, m: Manifest, i: number) =>
    key + "." + m.generation + "." + i;
  async function manifest(key: string): Promise<Manifest | null> {
    const raw = await store.getItem(manifestKey(key));
    if (!raw) return null;
    const m = JSON.parse(raw) as Manifest;
    if (
      !m.generation ||
      !Number.isSafeInteger(m.count) ||
      m.count < 1 ||
      m.count > 1000
    )
      throw Error("安全存储内容损坏");
    return m;
  }
  async function cleanup(key: string, m: Manifest) {
    for (let i = 0; i < m.count; i++)
      await store.removeItem(chunkKey(key, m, i)).catch(() => {});
  }
  return {
    async getItem(key) {
      const m = await manifest(key);
      if (!m) return null;
      let text = "";
      for (let i = 0; i < m.count; i++) {
        const chunk = await store.getItem(chunkKey(key, m, i));
        if (chunk === null) throw Error("登录会话不完整，请重新登录");
        text += chunk;
      }
      return text;
    },
    async setItem(key, value) {
      const old = await manifest(key),
        chunks: string[] = [];
      let chunk = "",
        bytes = 0;
      for (const char of value) {
        const n =
          char.codePointAt(0)! <= 127
            ? 1
            : char.codePointAt(0)! <= 2047
              ? 2
              : char.codePointAt(0)! <= 65535
                ? 3
                : 4;
        if (bytes + n > 1500) {
          chunks.push(chunk);
          chunk = "";
          bytes = 0;
        }
        chunk += char;
        bytes += n;
      }
      chunks.push(chunk);
      const next = { generation: id(), count: chunks.length };
      try {
        for (let i = 0; i < chunks.length; i++)
          await store.setItem(chunkKey(key, next, i), chunks[i]);
        await store.setItem(manifestKey(key), JSON.stringify(next));
      } catch (e) {
        await cleanup(key, next);
        throw e;
      }
      if (old) await cleanup(key, old);
    },
    async removeItem(key) {
      const old = await manifest(key);
      await store.removeItem(manifestKey(key));
      if (old) await cleanup(key, old);
    },
  };
}
