/** Unicode anomaly scanner: zero-width, BIDI, controls, homoglyphs, normalization. */

import { mkFinding, type Finding } from "./types.ts";

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);
const TAG_START = 0xe0000;
const TAG_END = 0xe007f;
const BIDI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/** Homoglyph codepoints that visually spoof ASCII, mapped to the lookalike. */
const HOMOGLYPHS = new Map<number, string>([
  // cyrillic lowercase
  [0x0430, "a"], [0x0435, "e"], [0x043e, "o"], [0x0440, "p"],
  [0x0441, "c"], [0x0445, "x"], [0x0443, "y"], [0x043d, "h"],
  [0x0432, "b"], [0x043c, "m"], [0x0442, "t"], [0x0456, "i"],
  // cyrillic uppercase
  [0x0410, "A"], [0x0412, "B"], [0x0415, "E"], [0x041d, "H"],
  [0x041e, "O"], [0x0420, "P"], [0x0421, "C"], [0x0422, "T"],
  [0x0423, "Y"], [0x0425, "X"],
  // greek
  [0x03b1, "a"], [0x03b5, "e"], [0x03b9, "i"], [0x03ba, "k"],
  [0x03bc, "u"], [0x03bd, "v"], [0x03bf, "o"], [0x03c1, "p"],
  [0x03c4, "t"], [0x03c5, "u"], [0x03c7, "x"], [0x03b7, "n"],
  // roman numerals
  [0x2160, "I"], [0x2164, "V"], [0x2169, "X"], [0x216c, "L"],
  [0x216d, "C"], [0x216e, "D"], [0x216f, "M"], [0x2170, "i"],
  [0x2174, "v"], [0x2179, "x"], [0x217c, "l"],
]);

const COMBINING_STARTS = [0x0300, 0x1ab0, 0x1dc0, 0x20d0, 0xfe20];

function isBidi(cp: number): boolean {
  return BIDI_RANGES.some(([s, e]) => cp >= s && cp <= e);
}

function isSuspiciousControl(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false;
  return (
    (cp >= 0x00 && cp <= 0x08) ||
    cp === 0x0b ||
    cp === 0x0c ||
    (cp >= 0x0e && cp <= 0x1f) ||
    (cp >= 0x7f && cp <= 0x9f)
  );
}

function isFullwidth(cp: number): boolean {
  return cp >= 0xff01 && cp <= 0xff5e;
}

function isLetterish(s: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(s);
}

/** Letter/number run around index i; hasAscii = the word mixes in ASCII. */
function wordAt(cps: string[], i: number): { word: string; hasAscii: boolean } {
  let start = i;
  let end = i;
  while (start > 0 && isLetterish(cps[start - 1])) start--;
  while (end < cps.length - 1 && isLetterish(cps[end + 1])) end++;
  const word = cps.slice(start, end + 1).join("");
  return { word, hasAscii: /[a-zA-Z0-9]/.test(word) };
}

function firstCombining(raw: string): number | null {
  for (const s of Array.from(raw)) {
    const cp = s.codePointAt(0)!;
    if (COMBINING_STARTS.some((start) => cp >= start && cp <= start + 0x6f)) {
      return cp;
    }
  }
  return null;
}

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase()}`;

/** Scan raw for unicode anomalies; findings carry 1-based line/column. */
export function scanUnicode(raw: string): Finding[] {
  const cps = Array.from(raw);
  const findings: Finding[] = [];
  let line = 1;
  let col = 1;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i].codePointAt(0)!;
    if (cp === 0x0a) {
      line++;
      col = 1;
      continue;
    }
    if (ZERO_WIDTH.has(cp) && !(cp === 0xfeff && i === 0)) {
      findings.push(
        mkFinding("uni-zerowidth", "unicode", "low", "medium", `zero-width ${hex(cp)}`, {
          line,
          column: col,
        }),
      );
    }
    if (cp >= TAG_START && cp <= TAG_END) {
      findings.push(
        mkFinding("uni-zerowidth", "unicode", "low", "medium", `tag char ${hex(cp)}`, {
          line,
          column: col,
        }),
      );
    }
    if (isBidi(cp)) {
      findings.push(
        mkFinding("uni-bidi", "unicode", "high", "high", `bidi control ${hex(cp)}`, {
          line,
          column: col,
        }),
      );
    }
    if (isSuspiciousControl(cp)) {
      findings.push(
        mkFinding(
          "uni-ctrl",
          "unicode",
          cp === 0x1b ? "high" : "medium",
          "high",
          `suspicious control ${hex(cp)}`,
          { line, column: col },
        ),
      );
    }
    if (HOMOGLYPHS.has(cp) || isFullwidth(cp)) {
      const { word, hasAscii } = wordAt(cps, i);
      if (hasAscii) {
        findings.push(
          mkFinding(
            "uni-homoglyph",
            "unicode",
            "medium",
            "medium",
            `homoglyph ${hex(cp)} in "${word}"`,
            { line, column: col },
          ),
        );
      }
    }
    col++;
  }
  if (raw.normalize("NFC") !== raw) {
    const cp = firstCombining(raw);
    findings.push(
      mkFinding(
        "uni-normalization",
        "unicode",
        "low",
        "low",
        cp === null ? "text is not NFC-normalized" : `decomposed text (${hex(cp)})`,
      ),
    );
  }
  return findings;
}
