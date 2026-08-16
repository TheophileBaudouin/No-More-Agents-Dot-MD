/** Constants + env overrides, read at call time (tests toggle env). No pi imports. */

import os from "node:os";
import path from "node:path";

export function getTrustFile(): string {
  return (
    process.env.NMA_TRUST_FILE ??
    path.join(os.homedir(), ".pi", "agent", "nma-trust.json")
  );
}

export function isNetworkEnabled(): boolean {
  return process.env.NMA_NETWORK !== "0";
}

/**
 * Policy: the command guard (barrier B) is armed only while at least one
 * loaded rule file is NOT explicitly trusted (hash-approved) by the user.
 * No context files, or all trusted => the extension never imposes command
 * confirmations. Rule-declared `action: confirm` is unaffected (user design).
 */
export function isGuardArmed(
  files: Iterable<{ loaded: boolean; trusted: boolean }>,
): boolean {
  for (const f of files) if (f.loaded && !f.trusted) return true;
  return false;
}

export function getUrlhausKey(): string {
  return process.env.NMA_URLHAUS_KEY ?? "";
}

export const NETWORK_CACHE_TTL_MS: number = 3600000;
export const NETWORK_TIMEOUT_MS: number = 3000;
