type StoredValue = unknown;

type RedisUrlClient = {
  set: (key: string, value: string) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  scanIterator: (options: { MATCH: string; COUNT: number }) => AsyncIterable<string | Buffer>;
};

type JsonStore = {
  setJSON: (key: string, value: StoredValue) => Promise<void>;
  getJSON: <T>(key: string) => Promise<T | null>;
  deleteJSON: (key: string) => Promise<boolean>;
  listKeys: () => Promise<string[]>;
};

export type JsonStoreStatus = {
  provider: "redis" | "netlify-blobs" | "memory";
  persistent: boolean;
  label: string;
  warning: string | null;
};

const globalStore = globalThis as typeof globalThis & {
  __internalLinkAuditStores?: Map<string, Map<string, StoredValue>>;
  __internalLinkAuditRedisClient?: Promise<RedisUrlClient>;
};

function hasRedisCredentials() {
  return Boolean(
    process.env.REDIS_URL
      || (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
      || (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

async function getRedisUrlClient() {
  if (!process.env.REDIS_URL) {
    return null;
  }

  globalStore.__internalLinkAuditRedisClient ??= (async () => {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });

    client.on("error", (error) => {
      console.error("[LinkIntel] Redis client error", error);
    });

    await client.connect();
    return client as RedisUrlClient;
  })();

  return globalStore.__internalLinkAuditRedisClient;
}

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

function restRedisStore(name: string): JsonStore | null {
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

async function redisUrlStore(name: string): Promise<JsonStore | null> {
  const client = await getRedisUrlClient();

  if (!client) {
    return null;
  }

  const prefix = `ila:${name}:`;

  return {
    async setJSON(key, value) {
      await client.set(`${prefix}${key}`, JSON.stringify(value));
    },
    async getJSON<T>(key: string) {
      const value = await client.get(`${prefix}${key}`);
      return value ? JSON.parse(value) as T : null;
    },
    async deleteJSON(key) {
      const deleted = await client.del(`${prefix}${key}`);
      return deleted > 0;
    },
    async listKeys() {
      const keys: string[] = [];
      for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        keys.push(String(key).slice(prefix.length));
      }
      return keys;
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
  const redis = await redisUrlStore(name) ?? restRedisStore(name);

  if (redis) {
    return redis;
  }

  return (await netlifyStore(name)) ?? memoryStore(name);
}

export function getJsonStoreStatus(): JsonStoreStatus {
  if (hasRedisCredentials()) {
    return {
      provider: "redis",
      persistent: true,
      label: "Persistent Redis storage",
      warning: null,
    };
  }

  if (process.env.NETLIFY) {
    return {
      provider: "netlify-blobs",
      persistent: true,
      label: "Persistent Netlify Blobs storage",
      warning: null,
    };
  }

  return {
    provider: "memory",
    persistent: false,
    label: "Temporary memory storage",
    warning: "Project sessions may disappear between Vercel requests until you connect Vercel KV or Upstash Redis.",
  };
}
