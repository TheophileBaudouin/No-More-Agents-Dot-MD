import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrlhausHost } from "./urlhaus.ts";

const URLHAUS_URL = "https://urlhaus.abuse.ch/v1/host/";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response, calls: string[]): typeof fetch {
  return ((url: unknown, init?: RequestInit) => {
    calls.push(String(url));
    return Promise.resolve(handler(String(url), init));
  }) as typeof fetch;
}

test("no API key -> null, never fetches", async () => {
  const old = process.env.NMA_URLHAUS_KEY;
  delete process.env.NMA_URLHAUS_KEY;
  try {
    const calls: string[] = [];
    const r = await checkUrlhausHost("evil.example", stubFetch(() => json(200, {}), calls));
    assert.equal(r, null);
    assert.equal(calls.length, 0);
  } finally {
    if (old !== undefined) process.env.NMA_URLHAUS_KEY = old;
  }
});

test("matched host -> {match:true}, POST with Auth-Key and host body", async () => {
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    const r = await checkUrlhausHost(
      "evil.example",
      stubFetch((url, init) => {
        assert.equal(url, URLHAUS_URL);
        assert.equal(init?.method, "POST");
        assert.equal((init?.headers as Record<string, string>)["Auth-Key"], "test-key");
        assert.equal(String(init?.body), "host=evil.example");
        return json(200, { query_status: "ok", host: "evil.example", urlhaus_reference: "https://urlhaus.abuse.ch/host/evil.example/" });
      }, []),
    );
    assert.deepEqual(r, { match: true });
  } finally {
    delete process.env.NMA_URLHAUS_KEY;
  }
});

test("no match -> {match:false} (API answered, still not 'safe')", async () => {
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    const r = await checkUrlhausHost("benign.example", stubFetch(() => json(200, { query_status: "no_results" }), []));
    assert.deepEqual(r, { match: false });
  } finally {
    delete process.env.NMA_URLHAUS_KEY;
  }
});

test("API failure -> null (silent degradation)", async () => {
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    const r = await checkUrlhausHost("x.example", stubFetch(() => { throw new Error("ECONNREFUSED"); }, []));
    assert.equal(r, null);
  } finally {
    delete process.env.NMA_URLHAUS_KEY;
  }
});

test("5xx -> null (silent degradation)", async () => {
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    const r = await checkUrlhausHost("x.example", stubFetch(() => new Response("down", { status: 503 }), []));
    assert.equal(r, null);
  } finally {
    delete process.env.NMA_URLHAUS_KEY;
  }
});

test("invalid JSON -> null (silent degradation)", async () => {
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    const r = await checkUrlhausHost("x.example", stubFetch(() => new Response("not json", { status: 200 }), []));
    assert.equal(r, null);
  } finally {
    delete process.env.NMA_URLHAUS_KEY;
  }
});
