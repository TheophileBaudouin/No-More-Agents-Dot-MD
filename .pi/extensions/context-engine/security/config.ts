/** Constants + env overrides. No pi imports. */

import os from "node:os";
import path from "node:path";

export const TRUST_FILE: string =
  process.env.NMA_TRUST_FILE ?? path.join(os.homedir(), ".pi", "agent", "nma-trust.json");
export const NETWORK_ENABLED: boolean = process.env.NMA_NETWORK !== "0";
export const NETWORK_CACHE_TTL_MS: number = 3600000;
export const NETWORK_TIMEOUT_MS: number = 3000;
export const URLHAUS_KEY: string = process.env.NMA_URLHAUS_KEY ?? "";
