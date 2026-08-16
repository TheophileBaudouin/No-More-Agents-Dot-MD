/** Finding model, severity weights, and risk aggregation. No pi imports. */

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type Category =
  | "prompt-injection"
  | "obfuscation"
  | "external"
  | "unicode"
  | "tool-hijack"
  | "command"
  | "secrets"
  | "supply-chain"
  | "exfiltration";

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  score: number;
  confidence: Confidence;
  evidence: string;
  line?: number;
  column?: number;
  terminal?: boolean;
}

export interface ScanResult {
  level: RiskLevel;
  findings: Finding[];
  decoded?: { from: string; text: string }[];
}

/** SkillsGuard-derived severity weights, recalibrated by the plan. */
export const WEIGHTS: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 3,
  high: 10,
  critical: 25,
};

/** A single terminal (or critical) finding forces the whole file to critical. */
export function isTerminal(findings: Finding[]): boolean {
  return findings.some((f) => f.terminal === true || f.severity === "critical");
}

/**
 * Risk level from the weighted, log2(count+1)-scaled sum per severity.
 * Calibrated thresholds: low <= 4, medium <= 12, high <= 24, >= 25 critical.
 */
export function aggregate(findings: Finding[]): RiskLevel {
  if (isTerminal(findings)) return "critical";
  const counts: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const f of findings) counts[f.severity]++;
  let total = 0;
  for (const sev of Object.keys(counts) as Severity[]) {
    if (counts[sev] > 0) {
      total += Math.round(WEIGHTS[sev] * Math.log2(counts[sev] + 1));
    }
  }
  if (total === 0) return "none";
  const level: RiskLevel =
    total <= 4 ? "low" : total <= 12 ? "medium" : total <= 24 ? "high" : "critical";
  // M-7: a single medium+ finding is a real signal — never hide it under low.
  // (A lone high/critical finding already aggregates to >= medium via weight,
  // this guards the medium tier and any future re-weighting.)
  if (
    level === "low" &&
    findings.some(
      (f) =>
        f.severity === "medium" ||
        f.severity === "high" ||
        f.severity === "critical",
    )
  ) {
    return "medium";
  }
  return level;
}

/** Finding factory shared by all scanners; score is derived from WEIGHTS. */
export function mkFinding(
  id: string,
  category: Category,
  severity: Severity,
  confidence: Confidence,
  evidence: string,
  extra: Partial<Pick<Finding, "line" | "column" | "terminal">> = {},
): Finding {
  return {
    id,
    category,
    severity,
    score: WEIGHTS[severity],
    confidence,
    evidence,
    ...extra,
  };
}
