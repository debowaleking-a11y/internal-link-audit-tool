import assert from "node:assert/strict";
import test from "node:test";
import { getJsonStoreStatus } from "@/lib/json-store";

const managedEnvKeys = [
  "REDIS_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NETLIFY",
] as const;

function withStoreEnv(env: Partial<Record<(typeof managedEnvKeys)[number], string>>, run: () => void) {
  const original = new Map(managedEnvKeys.map((key) => [key, process.env[key]]));

  for (const key of managedEnvKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const key of managedEnvKeys) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("getJsonStoreStatus reports temporary memory when no persistent storage is configured", () => {
  withStoreEnv({}, () => {
    const status = getJsonStoreStatus();

    assert.equal(status.provider, "memory");
    assert.equal(status.persistent, false);
    assert.match(status.warning ?? "", /Project sessions may disappear/);
  });
});

test("getJsonStoreStatus reports persistent Redis when REST credentials are configured", () => {
  withStoreEnv({ KV_REST_API_URL: "https://redis.example", KV_REST_API_TOKEN: "secret" }, () => {
    const status = getJsonStoreStatus();

    assert.equal(status.provider, "redis");
    assert.equal(status.persistent, true);
    assert.equal(status.warning, null);
  });
});

test("getJsonStoreStatus reports persistent Redis when Vercel Redis URL is configured", () => {
  withStoreEnv({ REDIS_URL: "redis://default:secret@redis.example:6379" }, () => {
    const status = getJsonStoreStatus();

    assert.equal(status.provider, "redis");
    assert.equal(status.persistent, true);
    assert.equal(status.warning, null);
  });
});
