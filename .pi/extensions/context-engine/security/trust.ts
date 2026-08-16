/** Global SHA-256 trust store (Task 10). Trust = canonical path + content hash. No pi imports. */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RiskLevel } from "./types.ts";
import { getTrustFile } from "./config.ts";

export type TrustEntry = {
  sha256: string;
  approvedAt: string;
  provenance: string;
  level: RiskLevel;
};

let trustFile: string = getTrustFile();
let store: Map<string, TrustEntry> | null = null;

/** Load (or reload) the trust store. Corrupt files warn and start empty. */
export function loadTrust(file: string = getTrustFile()): Map<string, TrustEntry> {
  trustFile = file;
  store = readStore(file);
  return store;
}

function readStore(file: string): Map<string, TrustEntry> {
  const map = new Map<string, TrustEntry>();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[security] cannot read trust file ${file}, starting empty: ${(err as Error).message}`);
    }
    return map;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return map;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof val === "object" && val !== null && typeof (val as TrustEntry).sha256 === "string") {
        map.set(key, val as TrustEntry);
      }
    }
  } catch (err) {
    console.warn(`[security] corrupt trust file ${file}, starting empty: ${(err as Error).message}`);
  }
  return map;
}

function ensureStore(): Map<string, TrustEntry> {
  if (store === null) loadTrust();
  return store!;
}

/** SHA-256 of the raw content, hex-encoded. */
export function currentHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Approve `file` for exactly this content. Written atomically (tmp + rename, 0o600). */
export function approve(file: string, raw: string, level: RiskLevel, provenance: string): void {
  const map = ensureStore();
  map.set(path.resolve(file), {
    sha256: currentHash(raw),
    approvedAt: new Date().toISOString(),
    provenance,
    level,
  });
  saveStore(map);
}

/** Remove any approval for `file`. */
export function revoke(file: string): void {
  const map = ensureStore();
  if (map.delete(path.resolve(file))) saveStore(map);
}

/** 'trusted' (path+hash match), 'changed' (hash mismatch => approval invalid), 'unknown'. */
export function status(file: string, raw: string): "trusted" | "changed" | "unknown" {
  const entry = ensureStore().get(path.resolve(file));
  if (entry === undefined) return "unknown";
  return entry.sha256 === currentHash(raw) ? "trusted" : "changed";
}

/** Gate->loader filter: file must be allowed AND its content must still hash
 * to what the gate scanned (closes the scan/load TOCTOU). Fail-closed. */
export function isCurrent(
  allowed: Set<string>,
  hashes: Map<string, string>,
  file: string,
  raw: string,
): boolean {
  return allowed.has(file) && hashes.get(file) === currentHash(raw);
}

function saveStore(map: Map<string, TrustEntry>): void {
  const file = trustFile;
  const data = JSON.stringify(Object.fromEntries(map), null, 2) + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Unique tmp (pid + time): two pi sessions never clobber each other's tmp
  // (last-writer-wins on the final rename remains possible — documented, no
  // lock: losing an approval is fail-closed, never fail-open).
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    // Never fatal: keep the in-memory store; the next write retries.
    console.warn(`[security] trust store write failed: ${(err as Error).message}`);
    try {
      fs.unlinkSync(tmp); // no-op after a successful rename
    } catch {
      /* tmp already gone */
    }
  }
}
