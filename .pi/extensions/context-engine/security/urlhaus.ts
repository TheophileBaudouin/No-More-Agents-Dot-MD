/** URLhaus host reputation (Task 9, opt-in via NMA_URLHAUS_KEY). No pi imports. */

import { NETWORK_TIMEOUT_MS, NETWORK_CACHE_TTL_MS, getUrlhausKey, isNetworkEnabled } from "./config.ts";
import { aggregate, mkFinding, type Finding, type ScanResult } from "./types.ts";

export type FetchFn = typeof fetch;

/**
 * Query urlhaus for a host. Returns null when disabled or on API failure
 * (never "safe"); {match:false} means the API answered and found nothing.
 */
export async function checkUrlhausHost(
  host: string,
  fetchFn?: FetchFn,
): Promise<{ match: boolean } | null> {
  // Re-read the env at call time so the key can be toggled without re-import.
  const key = process.env.NMA_URLHAUS_KEY ?? getUrlhausKey();
  if (key === "") return null;
  const f = fetchFn ?? globalThis.fetch;
  try {
    const res = await f("https://urlhaus.abuse.ch/v1/host/", {
      method: "POST",
      headers: { "Auth-Key": key, "Content-Type": "application/x-www-form-urlencoded" },
      body: `host=${encodeURIComponent(host)}`,
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return null;
    return { match: (json as { query_status?: unknown }).query_status === "ok" };
  } catch {
    return null;
  }
}

/** Public http(s) hosts in a command — localhost/private IPs excluded. */
const HOST_URL_RE = /https?:\/\/(?:[^/@\s]+@)?([A-Za-z0-9][A-Za-z0-9.-]*)(?::\d+)?/g;
const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i;

const MAX_HOSTS_PER_COMMAND = 5;

/**
 * Unique public hosts referenced by http(s) URLs in a shell command. IPv6
 * literals never match HOST_URL_RE (skipped, safe direction: no query, no
 * signal); "127."-prefixed hostnames are skipped too (weird but harmless).
 */
export function extractPublicHosts(command: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of command.matchAll(HOST_URL_RE)) {
    const host = m[1].toLowerCase();
    if (seen.has(host) || PRIVATE_HOST_RE.test(host)) continue;
    seen.add(host);
    out.push(host);
    if (out.length >= MAX_HOSTS_PER_COMMAND) break;
  }
  return out;
}

// In-memory TTL cache: definitive urlhaus answers per host (failures uncached,
// so a transient outage retries on the next command). Same shape as npm.ts.
type HostCacheEntry = { ts: number; match: boolean };
const hostCache = new Map<string, HostCacheEntry>();

function hostCacheGet(host: string): boolean | undefined {
  const e = hostCache.get(host);
  if (e === undefined) return undefined;
  if (Date.now() - e.ts > NETWORK_CACHE_TTL_MS) {
    hostCache.delete(host);
    return undefined;
  }
  return e.match;
}

/** Bound the cache — evict the oldest entry (Map order = insertion) at 200. */
function hostCacheSet(host: string, match: boolean): void {
  if (hostCache.size >= 200) hostCache.delete(hostCache.keys().next().value!);
  hostCache.set(host, { ts: Date.now(), match });
}

/**
 * Best-effort URLhaus host reputation for shell commands (opt-in via
 * NMA_URLHAUS_KEY). A listed host adds one critical terminal finding;
 * "not listed" adds nothing (absence of signal is never "safe"); API
 * failure adds nothing and leaves the level unchanged. Never throws.
 */
export async function enrichUrlhaus(
  command: string,
  existing: ScanResult,
  fetchFn?: FetchFn,
): Promise<ScanResult> {
  if (!isNetworkEnabled()) return existing;
  if ((process.env.NMA_URLHAUS_KEY ?? getUrlhausKey()) === "") return existing;
  const hosts = extractPublicHosts(command);
  if (hosts.length === 0) return existing;
  const extra: Finding[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      let match = hostCacheGet(host);
      if (match === undefined) {
        const r = await checkUrlhausHost(host, fetchFn);
        if (r === null) return; // failure: no signal, never cached
        match = r.match;
        hostCacheSet(host, match);
      }
      if (!match) return;
      extra.push(
        mkFinding(
          "cmd-urlhaus-listed",
          "external",
          "critical",
          "high",
          `host ${host} is listed on URLhaus (known malware distribution)`,
          { terminal: true },
        ),
      );
    }),
  );
  if (extra.length === 0) return existing;
  const findings = [...existing.findings, ...extra];
  return { ...existing, findings, level: aggregate(findings) };
}
