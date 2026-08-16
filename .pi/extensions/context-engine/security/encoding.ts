/** Recursive decoder for base64 / hex / URL-encoded blobs. Never mutates input. */

import { Buffer } from "node:buffer";
import { mkFinding, type Finding } from "./types.ts";
import { makePosIndex } from "./position.ts";

export type DecodedBlob = { from: string; text: string; line?: number; column?: number };

type RawBlob = DecodedBlob & { start: number; end: number };

const B64_RE = /[A-Za-z0-9+/]{16,}={0,2}/g;
const HEX_ESC_RE = /(?:\\x[0-9a-fA-F]{2}){2,}/g;
const HEX_STR_RE = /(?<![0-9a-fA-F])[0-9a-fA-F]{16,}(?![0-9a-fA-F])/g;
const URL_RE = /(?:%[0-9a-fA-F]{2}){4,}/g;

const CMD_TOKEN_RE =
  /\b(curl|wget|nc|ncat|python|python3|perl|ruby|node|powershell|pwsh|bash|sh|zsh|chmod|chown|sudo|rm|dd|mkfs|useradd|passwd|base64|eval|exec)\b/;
const EXEC_RE = /\|\s*(?:ba|z|da)?sh\b|\b(?:ba|z|da)?sh\s+-c\b|\$\([^)]*\)/;

function normB64(s: string): string {
  return s.replace(/=+$/, "");
}

function decodeB64(candidate: string): string | null {
  const text = Buffer.from(candidate, "base64").toString("utf8");
  // Round-trip check: only report text that really was base64 of UTF-8 text.
  if (normB64(Buffer.from(text, "utf8").toString("base64")) !== normB64(candidate)) {
    return null;
  }
  return text;
}

function decodeHex(candidate: string): string | null {
  if (candidate.length % 2 !== 0) return null;
  const text = Buffer.from(candidate, "hex").toString("utf8");
  if (Buffer.from(text, "utf8").toString("hex") !== candidate.toLowerCase()) {
    return null;
  }
  return text;
}

function decodeHexEscapes(candidate: string): string {
  return candidate.replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

function decodeUrl(candidate: string): string | null {
  try {
    return decodeURIComponent(candidate);
  } catch {
    return null; // malformed %XX sequence
  }
}

function analyzeBlob(b: RawBlob, findings: Finding[]): void {
  const kind = b.from
    .split(">")
    .pop()!
    .replace("url-encoding", "url")
    .replace("hex-escapes", "hex");
  const excerpt = b.text.trim().replace(/\s+/g, " ").slice(0, 60);
  const evidence = `decoded ${b.from} (line ${b.line ?? "?"}): ${excerpt}`;
  if (EXEC_RE.test(b.text)) {
    findings.push(
      mkFinding(`obf-${kind}-cmd`, "obfuscation", "high", "high", evidence, {
        line: b.line,
        column: b.column,
        terminal: true,
      }),
    );
  } else if (CMD_TOKEN_RE.test(b.text)) {
    findings.push(
      mkFinding(`obf-${kind}-cmd`, "obfuscation", "medium", "medium", evidence, {
        line: b.line,
        column: b.column,
      }),
    );
  } else {
    findings.push(
      mkFinding(`obf-${kind}`, "obfuscation", "info", "medium", evidence, {
        line: b.line,
        column: b.column,
      }),
    );
  }
}

function extractBlobs(raw: string): RawBlob[] {
  const pos = makePosIndex(raw);
  const candidates: RawBlob[] = [];
  const collect = (re: RegExp, from: string, decode: (s: string) => string | null) => {
    for (const m of raw.matchAll(re)) {
      const text = decode(m[0]);
      if (text === null) continue;
      const p = pos(m.index);
      candidates.push({
        from,
        text,
        line: p.line,
        column: p.column,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  };
  collect(HEX_STR_RE, "hex", decodeHex);
  collect(B64_RE, "base64", decodeB64);
  collect(URL_RE, "url-encoding", decodeUrl);
  collect(HEX_ESC_RE, "hex-escapes", decodeHexEscapes);
  // Dedup overlapping spans: stable sort by start (ties keep collection order,
  // matching the old first-wins rule) then linear sweep — O(k log k) instead
  // of the old O(k^2) `taken.some` per candidate.
  candidates.sort((a, b) => a.start - b.start);
  const out: RawBlob[] = [];
  let prev: RawBlob | null = null;
  for (const b of candidates) {
    if (prev !== null && b.start < prev.end) continue; // overlaps a kept blob
    out.push(b);
    prev = b;
  }
  return out;
}

/**
 * Find decodable blobs in raw, recursing into decoded text up to `depth`.
 * The original string is never modified; results are returned separately.
 */
export function findDecodedBlobs(
  raw: string,
  depth = 2,
): { decoded: DecodedBlob[]; findings: Finding[] } {
  const decoded: DecodedBlob[] = [];
  const findings: Finding[] = [];
  const walk = (text: string, level: number, parentFrom: string): void => {
    if (level <= 0) return;
    for (const b of extractBlobs(text)) {
      const from = parentFrom === "" ? b.from : `${parentFrom}>${b.from}`;
      decoded.push({ from, text: b.text, line: b.line, column: b.column });
      analyzeBlob({ ...b, from }, findings);
      walk(b.text, level - 1, from);
    }
  };
  walk(raw, depth, "");
  return { decoded, findings };
}
