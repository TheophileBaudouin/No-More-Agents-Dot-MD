import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { TRUST_FILE, NETWORK_ENABLED, NETWORK_CACHE_TTL_MS, NETWORK_TIMEOUT_MS, URLHAUS_KEY } from "./config.ts";

test("defaults match the approved plan", () => {
  assert.equal(TRUST_FILE, path.join(os.homedir(), ".pi", "agent", "nma-trust.json"));
  assert.equal(NETWORK_ENABLED, true);
  assert.equal(NETWORK_CACHE_TTL_MS, 3600000);
  assert.equal(NETWORK_TIMEOUT_MS, 3000);
  assert.equal(URLHAUS_KEY, "");
});

test("env overrides are honored (NMA_TRUST_FILE, NMA_NETWORK, NMA_URLHAUS_KEY)", async () => {
  const old = {
    trust: process.env.NMA_TRUST_FILE,
    net: process.env.NMA_NETWORK,
    key: process.env.NMA_URLHAUS_KEY,
  };
  process.env.NMA_TRUST_FILE = "/tmp/custom-trust.json";
  process.env.NMA_NETWORK = "0";
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    // Fresh module instance (computed specifier -> runtime query, no TS resolution) so the env snapshot is taken now.
    const cfg = await import("./config.ts" + "?env-overrides=1");
    assert.equal(cfg.TRUST_FILE, "/tmp/custom-trust.json");
    assert.equal(cfg.NETWORK_ENABLED, false);
    assert.equal(cfg.URLHAUS_KEY, "test-key");
  } finally {
    if (old.trust === undefined) delete process.env.NMA_TRUST_FILE;
    else process.env.NMA_TRUST_FILE = old.trust;
    if (old.net === undefined) delete process.env.NMA_NETWORK;
    else process.env.NMA_NETWORK = old.net;
    if (old.key === undefined) delete process.env.NMA_URLHAUS_KEY;
    else process.env.NMA_URLHAUS_KEY = old.key;
  }
});
