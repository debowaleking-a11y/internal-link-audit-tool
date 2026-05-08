type StoredValue = unknown;

type JsonStore = {
  setJSON: (key: string, value: StoredValue) => Promise<void>;
  getJSON: <T>(key: string) => Promise<T | null>;
  deleteJSON: (key: string) => Promise<boolean>;
  listKeys: () => Promise<string[]>;
};

const globalStore = globalThis as typeof globalThis & {
  __internalLinkAuditStores?: Map<string, Map<string, StoredValue>>;
};

function memoryNamespace(name: string) {
  globalStore.__internalLinkAuditStores ??= new Map();
  let namespace = globalStore.__internalLinkAuditStores.get(name);

  if (!namespace) {
    namespace = new Map();
    globalStore.__internalLinkAuditStores.set(name, namespace);
  }

  return namespace;
}

function memoryStore(name: string): JsonStore {
  const namespace = memoryNamespace(name);

  return {
    async setJSON(key, value) {
      namespace.set(key, value);
    },
    async getJSON<T>(key: string) {
      return (namespace.get(key) as T | undefined) ?? null;
    },
    async deleteJSON(key) {
      return namespace.delete(key);
    },
    async listKeys() {
      return [...namespace.keys()];
    },
  };
}

function redisStore(name: string): JsonStore | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  const redisUrl = url;
  const redisToken = token;

  async function command<T>(args: unknown[]) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${redisToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(`Store command failed with status ${response.status}.`);
    }

    const payload = await response.json() as { result?: T };
    return payload.result as T;
  }

  const prefix = `ila:${name}:`;

  return {
    async setJSON(key, value) {
      await command(["SET", `${prefix}${key}`, JSON.stringify(value)]);
    },
    async getJSON(key) {
      const value = await command<string | null>(["GET", `${prefix}${key}`]);
      return value ? JSON.parse(value) : null;
    },
    async deleteJSON(key) {
      const deleted = await command<number>(["DEL", `${prefix}${key}`]);
      return deleted > 0;
    },
    async listKeys() {
      const keys = await command<string[]>(["KEYS", `${prefix}*`]);
      return keys.map((key) => key.slice(prefix.length));
    },
  };
}

async function netlifyStore(name: string): Promise<JsonStore | null> {
  if (!process.env.NETLIFY) {
    return null;
  }

  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name, consistency: "strong" });

  return {
    async setJSON(key, value) {
      await store.setJSON(key, value);
    },
    async getJSON<T>(key: string) {
      return store.get(key, { type: "json" }) as Promise<T | null>;
    },
    async deleteJSON(key) {
      await store.delete(key);
      return true;
    },
    async listKeys() {
      const { blobs } = await store.list();
      return blobs.map((blob) => blob.key);
    },
  };
}

export async function getJsonStore(name: string): Promise<JsonStore> {
  const redis = redisStore(name);

  if (redis) {
    return redis;
  }

  return (await netlifyStore(name)) ?? memoryStore(name);
}
