/** npm Registry + OSV best-effort signals for install commands (Task 8). No pi imports. */

import { aggregate, mkFinding, type Finding, type ScanResult } from "./types.ts";
import { NETWORK_CACHE_TTL_MS, isNetworkEnabled, NETWORK_TIMEOUT_MS } from "./config.ts";

export type FetchFn = typeof fetch;

export type InstallTarget =
  | { kind: "npm"; name: string; version?: string }
  | { kind: "pypi" | "crates"; name: string }
  | { kind: "url" | "git"; url: string };

const REGISTRY_URL = "https://registry.npmjs.org/";
const OSV_URL = "https://api.osv.dev/v1/querybatch";
const YOUNG_MS = 90 * 24 * 3600 * 1000;

type NpmTarget = Extract<InstallTarget, { kind: "npm" }>;

type Trigger = { re: RegExp; kind: InstallTarget["kind"]; firstOnly?: boolean };

const TRIGGERS: Trigger[] = [
  { re: /^npm (?:install|i|ci)$/i, kind: "npm" },
  { re: /^yarn add$/i, kind: "npm" },
  { re: /^bun add$/i, kind: "npm" },
  { re: /^pnpm (?:add|install|i)$/i, kind: "npm" },
  { re: /^npx$/i, kind: "npm", firstOnly: true },
  { re: /^pip3? install$/i, kind: "pypi" },
  { re: /^cargo install$/i, kind: "crates" },
];

const PKG_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const OTHER_NAME_RE = /^[a-z0-9._-]+$/i;

/** Split "name@version" / "@scope/name@version", keeping the version when pinned. */
function parsePkgSpec(spec: string): { name: string; version?: string } | null {
  let name = spec;
  let version: string | undefined;
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash === -1) return null;
    const at = name.lastIndexOf("@");
    if (at > slash) {
      version = name.slice(at + 1);
      name = name.slice(0, at);
    }
  } else {
    const at = name.lastIndexOf("@");
    if (at > 0) {
      version = name.slice(at + 1);
      name = name.slice(0, at);
    }
  }
  if (!PKG_NAME_RE.test(name)) return null;
  return version === undefined ? { name } : { name, version };
}

/**
 * Best-effort install target extraction: npm/yarn/bun/pnpm/npx packages,
 * pip/cargo names (recognized, not npm-lookupable), tarball URLs, git+ deps.
 */
export function extractTargets(command: string): InstallTarget[] {
  const tokens = command.split(/\s+/).filter(Boolean);
  const out: InstallTarget[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let trigger: Trigger | null = null;
    let argsStart = -1;
    for (const t of TRIGGERS) {
      if (t.re.test(tokens[i])) {
        trigger = t;
        argsStart = i + 1;
        break;
      }
      const pair = `${tokens[i]} ${tokens[i + 1] ?? ""}`.trim();
      if (t.re.test(pair)) {
        trigger = t;
        argsStart = i + 2;
        break;
      }
    }
    if (trigger === null) continue;
    for (let j = argsStart; j < tokens.length; j++) {
      const tok = tokens[j];
      if (tok === "&&" || tok === ";" || tok === "|") break;
      if (tok.startsWith("-")) continue;
      const spec = tok.replace(/^['"]|['"]$/g, "");
      if (trigger.kind === "npm") {
        const parsed = parsePkgSpec(spec);
        if (parsed !== null) {
          out.push({ kind: "npm", ...parsed });
          if (trigger.firstOnly) break;
        } else if (/^https?:\/\//i.test(spec)) {
          out.push({ kind: "url", url: spec });
        } else if (spec.startsWith("git+")) {
          out.push({ kind: "git", url: spec });
        }
      } else {
        const name = spec.split(/[=@<>]/)[0];
        if (OTHER_NAME_RE.test(name)) out.push({ kind: trigger.kind as "pypi" | "crates", name });
      }
    }
  }
  return out;
}

/** Strip a version spec down to a comparable "x.y.z" (null when it is not one). */
function normVersion(v: string): string | null {
  const m = v.replace(/^[vV]/, "").replace(/^[^0-9]+/, "").match(/^\d+(?:\.\d+){0,2}/);
  return m === null ? null : m[0];
}

function semverCmp(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** OSV SEMVER events: introduced/fixed alternating; a trailing open segment is affected. */
function inRange(version: string, events: unknown): boolean {
  if (!Array.isArray(events)) return false;
  let current: string | null = null;
  for (const ev of events) {
    if (typeof ev !== "object" || ev === null) continue;
    const e = ev as Record<string, unknown>;
    if (typeof e.introduced === "string") {
      current = e.introduced;
    } else if (typeof e.fixed === "string") {
      if (current !== null && semverCmp(version, current) >= 0 && semverCmp(version, e.fixed) < 0) {
        return true;
      }
      current = null;
    }
  }
  return current !== null && semverCmp(version, current) >= 0;
}

function vulnAffects(version: string, vuln: unknown): boolean {
  if (typeof vuln !== "object" || vuln === null) return false;
  const affected = (vuln as { affected?: unknown }).affected;
  if (!Array.isArray(affected)) return false;
  for (const a of affected) {
    if (typeof a !== "object" || a === null) continue;
    const entry = a as { ranges?: unknown; versions?: unknown };
    if (Array.isArray(entry.versions) && entry.versions.includes(version)) return true;
    if (Array.isArray(entry.ranges)) {
      for (const r of entry.ranges) {
        if (
          typeof r === "object" &&
          r !== null &&
          (r as { type?: unknown }).type === "SEMVER" &&
          inRange(version, (r as { events?: unknown }).events)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

type RegistryMeta = { hasInstallScript: boolean; deprecated: boolean; created: string | null };

function extractRegistryMeta(j: Record<string, unknown>): RegistryMeta {
  const dt = j["dist-tags"] as Record<string, unknown> | undefined;
  const latestTag = typeof dt?.latest === "string" ? dt.latest : undefined;
  const versions = j.versions as Record<string, unknown> | undefined;
  const latest = latestTag === undefined || versions === undefined ? undefined : (versions[latestTag] as Record<string, unknown> | undefined);
  const scripts = { ...((j.scripts as Record<string, unknown>) ?? {}), ...((latest?.scripts as Record<string, unknown>) ?? {}) };
  const time = j.time as Record<string, unknown> | undefined;
  return {
    hasInstallScript:
      typeof scripts.install === "string" || typeof scripts.preinstall === "string" || typeof scripts.postinstall === "string",
    deprecated: Boolean(j.deprecated ?? latest?.deprecated),
    created: typeof time?.created === "string" ? time.created : null,
  };
}

// In-memory TTL cache: registry metadata per package, OSV vuln lists per package.
type CacheEntry = { ts: number; data: unknown };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown {
  const e = cache.get(key);
  if (e === undefined) return undefined;
  if (Date.now() - e.ts > NETWORK_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return e.data;
}

/** F14: bound the cache — evict the oldest entry (Map order = insertion) at 200. */
function cacheSet(key: string, data: unknown): void {
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { ts: Date.now(), data });
}

async function registryMeta(name: string, fetchFn: FetchFn): Promise<RegistryMeta | null> {
  const key = `reg:${name}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit as RegistryMeta;
  try {
    const res = await fetchFn(REGISTRY_URL + encodeURIComponent(name), {
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!res.ok) return null; // 404/5xx: unknown, no signal
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return null;
    const meta = extractRegistryMeta(json as Record<string, unknown>);
    cacheSet(key, meta);
    return meta;
  } catch {
    return null; // network failure / timeout / invalid JSON: never "safe"
  }
}

/** One OSV querybatch for all uncached names; failures are silent and uncached. */
async function osvBatch(names: string[], fetchFn: FetchFn): Promise<void> {
  const uncached = names.filter((n) => cacheGet(`osv:${n}`) === undefined);
  if (uncached.length === 0) return;
  try {
    const res = await fetchFn(OSV_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: uncached.map((name) => ({ package: { name, ecosystem: "npm" } })) }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const json: unknown = await res.json();
    const results = Array.isArray((json as { results?: unknown })?.results)
      ? (json as { results: unknown[] }).results
      : [];
    for (let i = 0; i < uncached.length; i++) {
      const r = results[i];
      const vulns = Array.isArray((r as { vulns?: unknown } | undefined)?.vulns)
        ? (r as { vulns: unknown[] }).vulns
        : [];
      cacheSet(`osv:${uncached[i]}`, vulns);
    }
  } catch {
    // API failure: no signal
  }
}

function merged(existing: ScanResult, extra: Finding[]): ScanResult {
  const findings = [...existing.findings, ...extra];
  return { ...existing, findings, level: aggregate(findings) };
}

/**
 * Best-effort reputation enrichment for install commands. Never blocks on API
 * failures: network errors, timeouts, 5xx and invalid JSON add no findings and
 * leave the existing result unchanged (unknown, never "safe").
 */
export async function enrichInstall(
  command: string,
  existing: ScanResult,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ScanResult> {
  if (!isNetworkEnabled()) return existing;
  const targets = extractTargets(command);
  const extra: Finding[] = [];
  const npmTargets: NpmTarget[] = [];
  for (const t of targets) {
    if (t.kind === "url" && !t.url.startsWith(REGISTRY_URL)) {
      extra.push(mkFinding("cmd-tarball-url", "supply-chain", "medium", "medium", `install from tarball URL ${t.url}`));
    } else if (t.kind === "git") {
      extra.push(mkFinding("cmd-nonregistry", "supply-chain", "low", "medium", `install from git dependency ${t.url}`));
    } else if (t.kind === "npm") {
      npmTargets.push(t);
    }
    // pypi/crates: no lookup API in scope -> no signal
  }
  if (npmTargets.length === 0) {
    return extra.length === 0 ? existing : merged(existing, extra);
  }
  const metas = await Promise.all(npmTargets.map((t) => registryMeta(t.name, fetchFn)));
  const versioned = npmTargets.filter((t) => t.version !== undefined && normVersion(t.version) !== null);
  await osvBatch(versioned.map((t) => t.name), fetchFn);
  for (let i = 0; i < npmTargets.length; i++) {
    const t = npmTargets[i];
    const meta = metas[i];
    if (meta === null) continue;
    if (meta.hasInstallScript) {
      const young =
        meta.created !== null &&
        Date.now() - Date.parse(meta.created) >= 0 &&
        Date.now() - Date.parse(meta.created) < YOUNG_MS;
      extra.push(
        mkFinding(
          young ? "cmd-install-young" : "cmd-install-script",
          "supply-chain",
          young ? "medium" : "low",
          "medium",
          `package ${t.name} runs an install script${young ? " and is younger than 90 days" : ""}`,
        ),
      );
    }
    if (meta.deprecated) {
      extra.push(mkFinding("cmd-deprecated", "supply-chain", "low", "medium", `package ${t.name} is deprecated`));
    }
    if (t.version !== undefined) {
      const v = normVersion(t.version);
      if (v !== null) {
        const vulns = cacheGet(`osv:${t.name}`);
        const affected = Array.isArray(vulns) ? vulns.filter((x) => vulnAffects(v, x)) : [];
        if (affected.length > 0) {
          const ids = affected
            .slice(0, 3)
            .map((x) => (x as { id?: unknown }).id ?? "?")
            .join(", ");
          extra.push(mkFinding("cmd-osv-vuln", "supply-chain", "high", "high", `${t.name}@${t.version}: ${ids}`));
        }
      }
    }
  }
  return extra.length === 0 ? existing : merged(existing, extra);
}
