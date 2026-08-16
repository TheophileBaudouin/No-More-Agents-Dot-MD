/** URLhaus host reputation (Task 9, opt-in via NMA_URLHAUS_KEY). No pi imports. */

import { NETWORK_TIMEOUT_MS, getUrlhausKey } from "./config.ts";

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
const HOST_URL_RE = /https?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*)(?::\d+)?/g;
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
