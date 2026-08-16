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
