/**
 * Calibration gate (Tasks 14-15): every fixture in fixtures/ must scan to the
 * level recorded in fixtures/expected.json. This is the permanent guard for
 * the false-positive discipline: benign <= low, false-positives <= medium,
 * malicious categories >= high (or explicitly marked subtle).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseContextFile } from "../engine.ts";
import { scanCommand } from "./commands.ts";
import { scanContext, scanFrontmatter } from "./scan.ts";
import { aggregate, type RiskLevel } from "./types.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

type Spec = {
  expected: RiskLevel;
  mode: "context" | "frontmatter" | "command";
  note?: string;
};

const manifest: Record<string, Spec> = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "expected.json"), "utf8"),
);

/** Mirror index.ts frontmatterMeta: { action } from the parsed rule, {} on failure. */
function metaOf(raw: string, file: string): Record<string, unknown> {
  try {
    const rule = parseContextFile(raw, file);
    if (rule) return { action: rule.action } as unknown as Record<string, unknown>;
  } catch {
    /* malformed frontmatter: body scan only */
  }
  return {};
}

/** Run the same scan pipeline as index.ts's gate: body scan, plus frontmatter when present. */
function scanLevel(rel: string, raw: string, mode: Spec["mode"]): RiskLevel {
  if (mode === "command") return scanCommand(raw).level;
  if (mode === "frontmatter") return scanFrontmatter(metaOf(raw, rel)).level;
  const body = scanContext(raw, rel);
  const meta = metaOf(raw, rel);
  if (Object.keys(meta).length === 0) return body.level;
  const fm = scanFrontmatter(meta);
  return aggregate([...body.findings, ...fm.findings]);
}

for (const [rel, spec] of Object.entries(manifest).sort()) {
  test(`calibration: ${rel} -> ${spec.expected}`, () => {
    const raw = fs.readFileSync(path.join(FIXTURES, rel), "utf8");
    const level = scanLevel(rel, raw, spec.mode);
    assert.equal(level, spec.expected, `note: ${spec.note ?? "-"}`);
  });
}

test("calibration: manifest covers every fixture file and nothing else", () => {
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(d, e.name))
        : [path.relative(FIXTURES, path.join(d, e.name))],
    );
  const files = walk(FIXTURES)
    .filter((f) => f.endsWith(".md"))
    .sort();
  assert.deepEqual(files, Object.keys(manifest).sort());
});

const HIGH_CATS = ["prompt-injection", "remote", "unicode", "obfuscation", "exfiltration"];
const ORDER: RiskLevel[] = ["none", "low", "medium", "high", "critical"];
const rank = (l: RiskLevel) => ORDER.indexOf(l);

test("calibration discipline: false positives never exceed medium", () => {
  for (const [rel, spec] of Object.entries(manifest)) {
    if (!rel.startsWith("false-positives/")) continue;
    assert.ok(
      rank(spec.expected) <= rank("medium"),
      `${rel} expected ${spec.expected} — FP discipline caps at medium`,
    );
  }
});

test("calibration discipline: benign never exceeds low", () => {
  for (const [rel, spec] of Object.entries(manifest)) {
    if (!rel.startsWith("benign/")) continue;
    assert.ok(
      rank(spec.expected) <= rank("low"),
      `${rel} expected ${spec.expected} — benign must stay none/low`,
    );
  }
});

test("calibration discipline: malicious categories reach high unless marked subtle", () => {
  for (const [rel, spec] of Object.entries(manifest)) {
    const cat = rel.split("/")[0];
    if (!HIGH_CATS.includes(cat)) continue;
    if (spec.note && /subtle/.test(spec.note)) {
      assert.ok(rank(spec.expected) >= rank("medium"), `${rel} subtle must be >= medium`);
    } else {
      assert.ok(
        rank(spec.expected) >= rank("high"),
        `${rel} expected ${spec.expected} — malicious must be high/critical`,
      );
    }
  }
});
