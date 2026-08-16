import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  isTerminal,
  WEIGHTS,
  mkFinding,
  type Finding,
  type Severity,
} from "./types.ts";

function f(severity: Severity, extra: Partial<Finding> = {}): Finding {
  return mkFinding("test", "prompt-injection", severity, "medium", "evidence", extra);
}

test("WEIGHTS match the approved plan", () => {
  assert.deepEqual(WEIGHTS, { info: 0, low: 1, medium: 3, high: 10, critical: 25 });
});

test("aggregate: no findings (or info only) -> none", () => {
  assert.equal(aggregate([]), "none");
  assert.equal(aggregate([f("info")]), "none"); // info weighs 0
});

test("aggregate: single low finding -> low", () => {
  assert.equal(aggregate([f("low")]), "low");
});

test("aggregate: 4 low findings stay low (threshold <= 4)", () => {
  assert.equal(aggregate([f("low"), f("low"), f("low"), f("low")]), "low"); // round(1*log2(5)) = 2
});

test("aggregate: 16 medium findings stay medium, 17 cross to high", () => {
  const sixteen = Array.from({ length: 16 }, () => f("medium"));
  assert.equal(aggregate(sixteen), "medium"); // round(3*log2(17)) = 12
  assert.equal(aggregate([...sixteen, f("medium")]), "high"); // round(3*log2(18)) = 13
});

test("aggregate: high findings scale 1/2/5 -> high/high/critical", () => {
  assert.equal(aggregate([f("high")]), "high"); // F12: a lone high is a real high, never folded to medium
  assert.equal(aggregate([f("high"), f("high")]), "high"); // round(10*log2(3)) = 16
  assert.equal(aggregate(Array.from({ length: 5 }, () => f("high"))), "critical"); // round(10*log2(6)) = 26
});

test("F12: one high plus two lows stays high", () => {
  assert.equal(aggregate([f("high"), f("low"), f("low")]), "high"); // 10 + 1 + 1 = 12
});

test("F12: three medium findings stay medium (no false high)", () => {
  assert.equal(aggregate([f("medium"), f("medium"), f("medium")]), "medium"); // round(3*log2(4)) = 6
});

test("aggregate: mixed severities sum", () => {
  const mixed = [f("low"), f("medium"), f("high")];
  assert.equal(aggregate(mixed), "high"); // 1 + 3 + 10 = 14
});

test("isTerminal: one terminal finding forces critical regardless of score", () => {
  assert.equal(isTerminal([f("low"), f("high", { terminal: true })]), true);
  assert.equal(aggregate([f("low"), f("high", { terminal: true })]), "critical");
});

test("isTerminal: critical severity is terminal; high alone is not", () => {
  assert.equal(isTerminal([f("critical")]), true);
  assert.equal(isTerminal([f("low"), f("high")]), false);
});

test("mkFinding derives score from WEIGHTS", () => {
  assert.equal(f("medium").score, 3);
  assert.equal(f("critical").score, 25);
  assert.equal(f("high", { terminal: true }).terminal, true);
});

test("M-7: a single medium-severity finding never aggregates below medium", () => {
  assert.equal(aggregate([f("medium")]), "medium");
});
