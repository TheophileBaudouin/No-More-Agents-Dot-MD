/**
 * No More Agents Dot MD — turns `.pi/context/*.md` files into Pi behaviors.
 * Frontmatter YAML = behavior (events/match/action); the Markdown body is the
 * context injected into the agent. The frontmatter is never injected.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import {
	copyToClipboard,
	createLocalBashOperations,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	loadContextDir,
	parseContextFile,
	selectForEvent,
	selectInject,
	selectToolRules,
	type Rule,
} from "./engine.ts";
import type { Subject } from "./match.ts";
import { tryAcquireSingleton, releaseSingleton } from "./guard.ts";
import { scanAction, needsNetworkCheck } from "./security/actions.ts";
import { enrichInstall } from "./security/npm.ts";
import { enrichUrlhaus } from "./security/urlhaus.ts";
import {
	nudgeLevel,
	provenance,
	scanContext,
	scanFrontmatter,
	type Provenance,
} from "./security/scan.ts";
import {
	approve,
	currentHash,
	isCurrent,
	revoke,
	status,
} from "./security/trust.ts";
import {
	aggregate,
	mkFinding,
	type Finding,
	type RiskLevel,
	type ScanResult,
} from "./security/types.ts";
import { isNetworkEnabled } from "./security/config.ts";
import { fetchIndex, fetchContext, matchEntries } from "./registry.ts";
import {
	assignNames,
	buildBrief,
	buildPlan,
	parseSections,
} from "./convert.ts";

const CONTEXT_DIR = ".pi/context";

/** Display name used in notifications, logs and transcript messages. */
const BRAND = "No More Agents Dot MD";

/** Submission form for the community registry (awesome-No-More-Agents-Dot-MD). */
const SHARE_URL =
	"https://theophilebaudouin.github.io/awesome-No-More-Agents-Dot-MD/submit/";

/** Open a URL in the default browser (no shell; best-effort). */
function openBrowser(url: string) {
	const launch: Record<string, [string, string[]]> = {
		darwin: ["open", [url]],
		win32: ["rundll32", ["url.dll,FileProtocolHandler", url]],
		linux: ["xdg-open", [url]],
	};
	const [cmd, args] = launch[process.platform] ?? launch.linux;
	spawn(cmd, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}

type ActivityEntry = {
	t: string;
	rule: string;
	event: string;
	action: string;
	detail?: string;
};

// Module scope: each install path is a distinct jiti module, so each loaded
// copy gets its own token. Used by the singleton guard below.
const INSTANCE = {};

// This copy's own location. /nma status shows it, so it's always obvious
// WHICH install path (project-local vs global npm package) won the guard.
const SELF_PATH = import.meta.url.startsWith("file://")
	? fileURLToPath(import.meta.url)
	: import.meta.url;

export default function (pi: ExtensionAPI) {
	// Singleton guard: when both a project-local copy and the global npm
	// package are present, pi loads both. First copy wins; the other yields
	// (registers nothing) so /nma and handlers are never duplicated.
	if (!tryAcquireSingleton(INSTANCE)) return;
	// Released before in-process reload (pi emits session_shutdown with
	// reason "reload" first), so the reloaded copy can acquire again.
	pi.on("session_shutdown", async () => releaseSingleton(INSTANCE));

	let rules: Rule[] = [];
	let injectedOnce = new Set<string>();
	let pendingInject: string[] = [];
	const activity: ActivityEntry[] = [];
	const lastScan = new Map<
		string,
		{ level: RiskLevel; findings: Finding[]; trusted: boolean; loaded: boolean }
	>();
	// Policy state: files loaded this session without explicit user trust.
	// Barrier B (command guard) only runs while this set is non-empty.
	const guardArmed = new Set<string>();

	function mergeScans(a: ScanResult, b: ScanResult): ScanResult {
		const findings = [...a.findings, ...b.findings];
		return { level: aggregate(findings), findings };
	}

	/** One-line-per-finding summary, truncated: confirm dialogs stay readable. */
	function fmtFindings(fs: Finding[], max = 10): string {
		const lines = fs.slice(0, max).map((f) => `- [${f.id}] ${f.evidence}`);
		if (fs.length > max) lines.push(`… and ${fs.length - max} more`);
		return lines.join("\n") || "(no details)";
	}

	/** Frontmatter parsed as behavior meta; a malformed one is scanned as {} (body scan still runs). */
	function frontmatterMeta(raw: string, file: string): Record<string, unknown> {
		try {
			const rule = parseContextFile(raw, file);
			if (rule)
				// SAFETY: rule.action/rule.match come from parseContextFile's
				// already-validated Rule shape; the scanner only reads them as
				// untyped metadata, and the F6 gate independently validates user
				// match.regex (ReDoS caps) before anything reaches the engine.
				return { action: rule.action, match: rule.match } as unknown as Record<
					string,
					unknown
				>;
		} catch {
			/* malformed frontmatter: body scan only */
		}
		return {};
	}

	/**
	 * Best-effort git tracking check, batched: ONE `git ls-files` per gate
	 * run instead of one spawn per file (F14). Paths are relative to `dir`
	 * (git reports them from the current directory). undefined = no repo or
	 * git missing (unknown). Never throws.
	 */
	function listGitTracked(dir: string): Set<string> | undefined {
		try {
			const r = spawnSync("git", ["-C", dir, "ls-files"], {
				encoding: "utf8",
				timeout: 2000,
			});
			if (r.status !== 0) return undefined;
			return new Set(
				r.stdout
					.split("\n")
					.filter(Boolean)
					.map((f) => path.join(dir, f)),
			);
		} catch {
			return undefined;
		}
	}

	/**
	 * Load-time gate (barrier A): scan + trust every rule file, prompt on
	 * medium/high, block critical, short-circuit on trusted. Returns the set of
	 * file names allowed through to the loader. Never throws.
	 */
	async function securityGate(
		dir: string,
		ctx: ExtensionContext | undefined,
	): Promise<{ allowed: Set<string>; hashes: Map<string, string> }> {
		// Rebuild scan state each gate run: stale entries (deleted files) must
		// not keep the command guard armed after the last untrusted file is gone.
		lastScan.clear();
		const allowed = new Set<string>();
		const hashes = new Map<string, string>();
		const blocked: string[] = [];
		if (!fs.existsSync(dir)) return { allowed, hashes };
		// F14: one git spawn per gate, shared by every file's provenance.
		const gitTracked = listGitTracked(dir);
		for (const f of fs.readdirSync(dir)) {
			if (!f.endsWith(".md") || f.toLowerCase() === "readme.md") continue;
			const abs = path.join(dir, f);
			// F14: size cap — a multi-MB blob is not a rule file. Fail-closed:
			// skipped files never load, and the notify makes the skip visible.
			let st: fs.Stats;
			try {
				st = fs.statSync(abs);
			} catch (err) {
				console.error(`[${BRAND}] ${f}: cannot stat: ${(err as Error).message}`);
				continue;
			}
			if (st.size > 5_000_000) {
				const msg = `[${BRAND}] ${f}: too large to scan (${Math.ceil(st.size / 1048576)} MB) — not loaded`;
				if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(msg, "warning");
				else console.log(msg);
				continue;
			}
			let raw: string;
			try {
				raw = fs.readFileSync(abs, "utf8");
				hashes.set(f, currentHash(raw)); // T1 content pin, re-checked at load (M-3)
			} catch (err) {
				console.error(`[${BRAND}] ${f}: cannot read: ${(err as Error).message}`);
				continue;
			}
			let scan: ScanResult;
			try {
				scan = mergeScans(
					scanContext(raw, f),
					scanFrontmatter(frontmatterMeta(raw, f)),
				);
			} catch (err) {
				// Fail-safe: a scan error is treated as high risk, never a silent load.
				console.error(`[${BRAND}] ${f}: scan error: ${(err as Error).message}`);
				scan = {
					level: "high",
					findings: [
						mkFinding(
							"scan-error",
							"command",
							"high",
							"high",
							`scan failed: ${(err as Error).message}`,
						),
					],
				};
			}
			let trusted = false;
			try {
				trusted = status(abs, raw) === "trusted";
			} catch (err) {
				console.error(
					`[${BRAND}] ${f}: trust store error: ${(err as Error).message}`,
				);
			}
			// Provenance (best-effort): project trust + git tracking + mtime.
			// ctx without isProjectTrusted is treated as trusted (no nudge);
			// a missing git signal never downgrades a file.
			let prov: Provenance = "user";
			try {
				prov = provenance(abs, {
					isProjectTrusted: ctx?.isProjectTrusted?.() ?? true,
					mtimeMs: fs.statSync(abs).mtimeMs,
					gitTracked: gitTracked?.has(abs),
				});
			} catch {
				/* best-effort: keep user */
			}
			scan.level = nudgeLevel(scan.level, prov, scan.findings);
			let loaded: boolean;
			if (trusted || scan.level === "none" || scan.level === "low") {
				loaded = true;
			} else if (scan.level === "critical") {
				// Never auto-prompt for critical: explain the manual escape hatch.
				loaded = false;
				blocked.push(f);
				const top = scan.findings[0]?.id ?? "unknown";
				const msg = `[${BRAND}] BLOCKED ${f}: ${top} — run /nma trust ${f} to approve`;
				if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(msg, "error");
				else console.log(msg);
			} else if (ctx?.hasUI) {
				const details = fmtFindings(scan.findings);
				const ok = await ctx.ui.confirm(`${scan.level} rule file: ${f}`, details);
				if (ok) {
					try {
						approve(abs, raw, scan.level, prov);
						trusted = true; // explicit user approval is trust
					} catch (err) {
						console.error(
							`[${BRAND}] ${f}: approve failed: ${(err as Error).message}`,
						);
					}
					loaded = true;
				} else {
					loaded = false;
					ctx.ui.notify(`[${BRAND}] Skipped ${f}`, "warning");
				}
			} else {
				loaded = false;
				console.log(`[${BRAND}] Skipped ${f} (${scan.level} risk, no UI)`);
			}
			if (loaded) allowed.add(f);
			lastScan.set(f, {
				level: scan.level,
				findings: scan.findings,
				trusted,
				loaded,
			});
		}
		if (blocked.length > 0) {
			const msg = `[${BRAND}] ${blocked.length} rule file(s) blocked: ${blocked.join(", ")}`;
			if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(msg, "error");
			else console.log(msg);
		}
		return { allowed, hashes };
	}

	async function reload(cwd: string, ctx?: ExtensionContext) {
		const dir = path.join(cwd, CONTEXT_DIR);
		const { allowed, hashes } = await securityGate(dir, ctx);
		rules = loadContextDir(dir, (f, raw) => isCurrent(allowed, hashes, f, raw));
		injectedOnce = new Set<string>();
		pendingInject = [];
		guardArmed.clear();
		for (const [f, s] of lastScan) if (s.loaded && !s.trusted) guardArmed.add(f);
		if (guardArmed.size > 0 && ctx?.hasUI && ctx.ui?.notify) {
			ctx.ui.notify(
				`[${BRAND}] Command guard ON: ${guardArmed.size} untrusted rule file(s) loaded. /nma security to review; /nma trust <file> to review & approve a file and relax the guard.`,
				"warning",
			);
		}
		if (rules.length > 0) {
			console.log(`[${BRAND}] ${rules.length} rule(s) loaded from .pi/context/`);
		}
	}

	function log(rule: string, event: string, action: string, detail?: string) {
		activity.push({ t: new Date().toISOString(), rule, event, action, detail });
		if (activity.length > 100) activity.shift();
	}

	/**
	 * Security barrier B: scan the action BEFORE user rules run.
	 * Returns a block reason, or null when the action may proceed. An action
	 * approval is one-time only — nothing is ever persisted here.
	 */
	async function securityBarrier(
		tool: string,
		input: unknown,
		event: string,
		ctx: ExtensionContext | undefined,
	): Promise<string | null> {
		if (guardArmed.size === 0) {
			// Policy: the guard runs only while untrusted rule files are loaded.
			return null;
		}
		let sr: ScanResult;
		try {
			sr = scanAction(tool, input);
		} catch (err) {
			// Fail-closed (M-6): a scanner exception must never become a silent
			// allow — block the action and surface the reason.
			console.error(`[${BRAND}] security scan failed: ${(err as Error).message}`);
			return "SECURITY scanner error — action blocked (fail-safe). Check the logs.";
		}
		const cmd = (input as Record<string, unknown> | undefined)?.command;
		const command = typeof cmd === "string" ? cmd : "";
		if (command !== "" && needsNetworkCheck(sr, command)) {
			// Both enrichments are internally total (never throw, failure = no
			// signal); the try/catch is defense-in-depth. sr is reassigned so
			// enrichment findings are visible in the confirm UI below.
			try {
				sr = await enrichInstall(command, sr);
				sr = await enrichUrlhaus(command, sr);
			} catch (err) {
				console.error(
					`[${BRAND}] network enrichment failed: ${(err as Error).message}`,
				);
			}
		}
		const level = sr.level;
		if (level === "none" || level === "low") return null;
		const ids = sr.findings.map((f) => f.id).join(", ");
		if (!ctx?.hasUI) {
			console.log(`[${BRAND}] blocked ${tool} action (${level}, no UI): ${ids}`);
			return `${level.toUpperCase()} risk ${tool} action blocked by security barrier — ${ids}`;
		}
		const details = fmtFindings(sr.findings);
		const ok = await ctx.ui.confirm(
			`${level} action: ${tool}`,
			level === "critical"
				? `Approve this dangerous action anyway? (one-time, never persisted)\n\n${details}`
				: details,
		);
		if (!ok) {
			log(BRAND, event, "security-block", `${level} ${tool}: ${ids}`);
			return `${level.toUpperCase()} risk ${tool} action declined (security barrier)`;
		}
		log(BRAND, event, "security-approve", `${level} ${tool}: ${ids}`);
		return null;
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) =>
		reload(ctx.cwd, ctx),
	);

	/** Enrich a Subject with session state pi provides on every event. */
	function baseSubject(ctx?: ExtensionContext): Partial<Subject> {
		return {
			model: ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			cwd: ctx?.cwd,
			sessionSize: ctx?.sessionManager?.getEntries().length,
			contextFill: (() => {
				const u = ctx?.getContextUsage?.();
				return u && typeof u.percent === "number" ? u.percent : undefined;
			})(),
		};
	}

	function notifyRule(ctx: ExtensionContext | undefined, r: Rule) {
		if (!ctx?.hasUI || !ctx.ui?.notify) return;
		ctx.ui.notify(
			r.action.message ?? `${r.name} applies`,
			r.action.level ?? "info",
		);
	}

	function notifyInject(ctx: ExtensionContext | undefined, r: Rule) {
		if (!ctx?.hasUI || !ctx.ui?.notify) return;
		ctx.ui.notify(`[${BRAND}] ${r.name}: context injected`, "info");
	}

	function notifyBlock(ctx: ExtensionContext | undefined, r: Rule) {
		if (!ctx?.hasUI || !ctx.ui?.notify) return;
		ctx.ui.notify(`[${BRAND}] ${r.name}: blocked`, "warning");
	}

	function applyTools(pi: ExtensionAPI, r: Rule) {
		const active = pi.getActiveTools();
		const disable = r.action.disable ?? [];
		const enable = r.action.enable ?? [];
		const next = active.filter((t) => !disable.includes(t));
		for (const t of enable) if (!next.includes(t)) next.push(t);
		pi.setActiveTools(next);
	}

	function toolSubject(
		event: { toolName: string; input?: unknown },
		ctx?: ExtensionContext,
	): Subject {
		const input = (event.input ?? {}) as Record<string, unknown>;
		return {
			...baseSubject(ctx),
			text: JSON.stringify(input),
			tool: event.toolName,
			command: typeof input.command === "string" ? input.command : "",
		};
	}

	// Conditional context injection at agent start (gated on the user prompt).
	pi.on("before_agent_start", async (event, ctx) => {
		const subject: Subject = { ...baseSubject(ctx), text: event.prompt ?? "" };
		const chunks = selectInject(rules, subject, injectedOnce);
		for (const r of chunks) {
			if (r.action.once) injectedOnce.add(r.name);
			notifyInject(ctx, r);
			log(r.name, "before_agent_start", "inject");
		}
		for (const r of selectForEvent(rules, subject, "before_agent_start")) {
			switch (r.action.type) {
				case "tools":
					applyTools(pi, r);
					log(r.name, "before_agent_start", "tools");
					break;
				case "notify":
					notifyRule(ctx, r);
					log(r.name, "before_agent_start", "notify");
					break;
				default:
					break; // inject handled above via selectInject
			}
		}
		if (chunks.length === 0) return;
		const injected = chunks
			.map(
				(r) =>
					`## ${r.name}\n\n<user-context source="${r.name}">\n${r.body}\n</user-context>`,
			)
			.join("\n\n");
		return { systemPrompt: `${event.systemPrompt}\n\n${injected}` };
	});

	// Intercept raw user input: transform, handled, tools, notify.
	pi.on("input", async (event, ctx) => {
		const subject: Subject = {
			...baseSubject(ctx),
			text: event.text,
			source: event.source,
		};
		let text = event.text;
		let handled = false;
		for (const r of selectForEvent(rules, subject, "input")) {
			switch (r.action.type) {
				case "transform": {
					if (typeof r.action.text === "string") {
						text = r.action.text;
						log(r.name, "input", "transform");
					}
					break;
				}
				case "handled":
					handled = true;
					log(r.name, "input", "handled");
					break;
				case "tools":
					applyTools(pi, r);
					log(r.name, "input", "tools");
					break;
				case "notify":
					notifyRule(ctx, r);
					log(r.name, "input", "notify");
					break;
				default:
					break;
			}
			if (handled) break;
		}
		if (handled) return { action: "handled" };
		if (text !== event.text) return { action: "transform", text };
		return;
	});

	// Tool guards: block, confirm, modify, deferred injection, tools, notify.
	// Security barrier B runs FIRST: its block short-circuits, its allow falls
	// through to the user-rule loop untouched.
	pi.on("tool_call", async (event, ctx) => {
		const blockReason = await securityBarrier(
			event.toolName,
			event.input,
			"tool_call",
			ctx,
		);
		if (blockReason !== null) {
			log(BRAND, "tool_call", "security-block", blockReason);
			return { block: true, reason: blockReason };
		}
		const subject = toolSubject(event, ctx);

		for (const r of selectToolRules(rules, subject)) {
			switch (r.action.type) {
				case "block": {
					notifyBlock(ctx, r);
					log(r.name, "tool_call", "block");
					return {
						block: true,
						reason: r.action.message ?? r.description ?? r.name,
					};
				}
				case "confirm": {
					const reason =
						r.action.message ?? `Authorize ${event.toolName}? (rule ${r.name})`;
					if (!ctx.hasUI) {
						notifyBlock(ctx, r);
						log(r.name, "tool_call", "confirm-blocked");
						return { block: true, reason }; // fail-safe without UI
					}
					const ok = await ctx.ui.confirm(r.name, reason);
					if (!ok) {
						notifyBlock(ctx, r);
						log(r.name, "tool_call", "confirm-blocked");
						return { block: true, reason: `Blocked by rule ${r.name}` };
					}
					log(r.name, "tool_call", "confirm-approved");
					break;
				}
				case "modify": {
					const c = r.action.command;
					const input = event.input as { command?: string } | undefined;
					if (c && input && typeof input.command === "string") {
						if (c.prepend) input.command = c.prepend + input.command;
						if (c.append) input.command = input.command + c.append;
						log(r.name, "tool_call", "modify");
					}
					break;
				}
				case "inject": {
					if (r.action.once && injectedOnce.has(r.name)) break;
					if (r.action.once) injectedOnce.add(r.name);
					pendingInject.push(
						`## ${r.name}\n\n<user-context source="${r.name}">\n${r.body}\n</user-context>`,
					);
					notifyInject(ctx, r);
					log(r.name, "tool_call", "inject");
					break;
				}
				case "tools":
					applyTools(pi, r);
					log(r.name, "tool_call", "tools");
					break;
				case "notify":
					notifyRule(ctx, r);
					log(r.name, "tool_call", "notify");
					break;
				default:
					break; // unknown action types are ignored (schema is extensible)
			}
		}
	});

	// React to tool output: annotate results or queue guidance.
	pi.on("tool_result", async (event, ctx) => {
		const outputText = (event.content ?? [])
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const input = (event.input ?? {}) as Record<string, unknown>;
		const subject: Subject = {
			...baseSubject(ctx),
			text: JSON.stringify(input),
			tool: event.toolName,
			command: typeof input.command === "string" ? input.command : "",
			result: outputText,
		};
		type ContentItem = (typeof event.content)[number];
		let patch: { content?: ContentItem[]; details?: unknown } | undefined;
		for (const r of selectForEvent(rules, subject, "tool_result")) {
			switch (r.action.type) {
				case "annotate": {
					patch ??= {};
					if (r.action.append) {
						const base = Array.isArray(patch.content) ? patch.content : event.content;
						patch.content = [...base, { type: "text", text: r.action.append }];
					}
					if (r.action.details !== undefined) {
						const d = r.action.details;
						if (d && typeof d === "object" && !Array.isArray(d)) {
							patch.details = {
								...(patch.details as Record<string, unknown> | undefined),
								...(d as Record<string, unknown>),
							};
						} else {
							patch.details = d;
						}
					}
					log(r.name, "tool_result", "annotate");
					break;
				}
				case "inject": {
					if (r.action.once && injectedOnce.has(r.name)) break;
					if (r.action.once) injectedOnce.add(r.name);
					pendingInject.push(
						`## ${r.name}\n\n<user-context source="${r.name}">\n${r.body}\n</user-context>`,
					);
					notifyInject(ctx, r);
					log(r.name, "tool_result", "inject");
					break;
				}
				case "notify":
					notifyRule(ctx, r);
					log(r.name, "tool_result", "notify");
					break;
				default:
					break;
			}
		}
		if (!patch) return;
		const result: { content?: ContentItem[]; details?: unknown } = {};
		if (patch.content) result.content = patch.content;
		if (patch.details !== undefined) result.details = patch.details;
		return result;
	});

	// Guard manual `!` / `!!` commands (same rules as tool_call guards).
	pi.on("user_bash", async (event, ctx) => {
		const blockReason = await securityBarrier(
			"bash",
			{ command: event.command },
			"user_bash",
			ctx,
		);
		if (blockReason !== null) {
			log(BRAND, "user_bash", "security-block", blockReason);
			return {
				result: {
					output: blockReason,
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}
		const subject: Subject = {
			...baseSubject(ctx),
			text: event.command,
			command: event.command,
		};
		let prepend = "";
		let append = "";
		for (const r of selectForEvent(rules, subject, "user_bash")) {
			switch (r.action.type) {
				case "block": {
					notifyBlock(ctx, r);
					log(r.name, "user_bash", "block");
					return {
						result: {
							output: r.action.message ?? `Blocked by rule ${r.name}`,
							exitCode: 1,
							cancelled: false,
							truncated: false,
						},
					};
				}
				case "confirm": {
					const reason =
						r.action.message ?? `Allow ${event.command}? (rule ${r.name})`;
					if (!ctx.hasUI) {
						notifyBlock(ctx, r);
						log(r.name, "user_bash", "confirm-blocked");
						return {
							result: {
								output: reason,
								exitCode: 1,
								cancelled: false,
								truncated: false,
							},
						};
					}
					const ok = await ctx.ui.confirm(r.name, reason);
					if (!ok) {
						notifyBlock(ctx, r);
						log(r.name, "user_bash", "confirm-blocked");
						return {
							result: {
								output: `Blocked by rule ${r.name}`,
								exitCode: 1,
								cancelled: false,
								truncated: false,
							},
						};
					}
					log(r.name, "user_bash", "confirm-approved");
					break;
				}
				case "modify": {
					const c = r.action.command;
					if (c) {
						if (c.prepend) prepend = c.prepend + prepend;
						if (c.append) append = append + c.append;
						log(r.name, "user_bash", "modify");
					}
					break;
				}
				case "notify":
					notifyRule(ctx, r);
					log(r.name, "user_bash", "notify");
					break;
				default:
					break;
			}
		}
		if (prepend || append) {
			const local = createLocalBashOperations();
			return {
				operations: {
					exec(command, cwd, options) {
						return local.exec(prepend + command + append, cwd, options);
					},
				},
			};
		}
		return;
	});

	// Guard session changes: block/confirm can cancel /new, /resume, /fork, /clone.
	async function sessionGuard(
		event: { reason?: string; position?: string },
		ev: "session_before_switch" | "session_before_fork",
		ctx: ExtensionContext,
	) {
		const subject: Subject = {
			...baseSubject(ctx),
			text:
				ev === "session_before_switch"
					? (event.reason ?? "")
					: (event.position ?? ""),
		};
		for (const r of selectForEvent(rules, subject, ev)) {
			switch (r.action.type) {
				case "block": {
					notifyBlock(ctx, r);
					log(r.name, ev, "block");
					return { cancel: true };
				}
				case "confirm": {
					const reason =
						r.action.message ??
						(ev === "session_before_switch"
							? `Switch session? (rule ${r.name})`
							: `Fork session? (rule ${r.name})`);
					if (!ctx.hasUI) {
						notifyBlock(ctx, r);
						log(r.name, ev, "confirm-blocked");
						return { cancel: true };
					}
					const ok = await ctx.ui.confirm(r.name, reason);
					if (!ok) {
						notifyBlock(ctx, r);
						log(r.name, ev, "confirm-blocked");
						return { cancel: true };
					}
					log(r.name, ev, "confirm-approved");
					break;
				}
				case "notify":
					notifyRule(ctx, r);
					log(r.name, ev, "notify");
					break;
				default:
					break;
			}
		}
		return;
	}

	pi.on("session_before_switch", async (event, ctx) =>
		sessionGuard(event, "session_before_switch", ctx),
	);
	pi.on("session_before_fork", async (event, ctx) =>
		sessionGuard(event, "session_before_fork", ctx),
	);

	// Deliver pending tool-context guidance before the next LLM call.
	// Injected as a user message: AgentMessage has no "system" role (the system
	// prompt lives separately) — this is pi's standard context-injection shape.
	pi.on("context", async (event) => {
		if (pendingInject.length === 0) return;
		const text = pendingInject.join("\n\n");
		pendingInject = [];
		return {
			messages: [
				...event.messages,
				{ role: "user" as const, content: text, timestamp: Date.now() },
			],
		};
	});

	// /nma — manage rules from inside pi: list, reload, status, share,
	// security, trust <file>, untrust <file>.
	// Output is shown in the transcript (pi.sendMessage), never in the input editor.
	pi.registerCommand("nma", {
		description:
			"No More Agents Dot MD: /nma (list), /nma reload, /nma status, /nma import <name|keywords> [--yes], /nma convert [file] [--yes], /nma share, /nma security, /nma trust <file> [--yes], /nma untrust <file>",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				"reload",
				"status",
				"import",
				"convert",
				"share",
				"security",
				"trust",
				"untrust",
			].flatMap((o) => (o.startsWith(prefix) ? [{ value: o, label: o }] : []));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const cmd = parts[0] ?? "";
			const notify = (
				msg: string,
				level: "info" | "warning" | "error" = "info",
			) => {
				if (ctx.hasUI) ctx.ui.notify(`[${BRAND}] ${msg}`, level);
				else console.log(`[${BRAND}] ${msg}`);
			};
			if (cmd === "reload") {
				try {
					await reload(ctx.cwd, ctx);
					notify(`${rules.length} rule(s) reloaded`);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					notify(`reload failed: ${msg}`, "error");
				}
				return;
			}
			if (cmd === "import") {
				const yesFlag = parts.includes("--yes");
				// --yes is stripped from the query so it never leaks into search.
				const query = parts
					.slice(1)
					.filter((p) => p !== "--yes")
					.join(" ");
				if (!query) {
					notify("usage: /nma import <name|keywords> [--yes]", "error");
					return;
				}
				if (!isNetworkEnabled()) {
					notify("network disabled (NMA_NETWORK=0)", "error");
					return;
				}
				let entries;
				try {
					entries = await fetchIndex();
				} catch (err) {
					notify(`registry fetch failed: ${(err as Error).message}`, "error");
					return;
				}
				// Exact name match imports directly; otherwise keyword search.
				let entry = entries.find((e) => e.name === query);
				if (!entry) {
					const matches = matchEntries(entries, query);
					if (matches.length === 0) {
						notify(
							`no registry match for "${query}" (${entries.length} entries)`,
							"warning",
						);
						return;
					}
					if (matches.length === 1) {
						entry = matches[0];
					} else if (ctx.hasUI) {
						const picked = await ctx.ui.select(
							`Import which context? (${matches.length} matches)`,
							matches.map((m) => `${m.name} — ${m.category} — ${m.tags.join(", ")}`),
						);
						if (!picked) return;
						entry = matches.find((m) => picked.startsWith(`${m.name} —`));
						if (!entry) return;
					} else {
						pi.sendMessage({
							customType: BRAND,
							content:
								`**${matches.length} registry matches for "${query}"**\n\n` +
								matches
									.map((m) => `- \`${m.name}\` — ${m.category} — ${m.tags.join(", ")}`)
									.join("\n") +
								`\n\nRun \`/nma import <name>\` to import one.`,
							display: true,
						});
						return;
					}
				}
				const name = entry.name; // from the registry index, never raw input
				let raw: string;
				try {
					raw = await fetchContext(name);
				} catch (err) {
					notify((err as Error).message, "error");
					return;
				}
				// Same fail-safe scan + trust flow as /nma trust.
				let scan: ScanResult = {
					level: "high", // fail-safe, reachable only via --yes
					findings: [
						mkFinding("scan-error", "command", "high", "high", "scan failed"),
					],
				};
				try {
					scan = mergeScans(
						scanContext(raw, `${name}.md`),
						scanFrontmatter(frontmatterMeta(raw, `${name}.md`)),
					);
				} catch (err) {
					console.error(`[${BRAND}] ${name}: scan error: ${(err as Error).message}`);
					if (!yesFlag) {
						notify(
							"scan failed — refusing to import (add --yes to override)",
							"error",
						);
						return;
					}
				}
				const { level, findings } = scan;
				// Same semantics as /nma trust: high/critical always confirms;
				// without a UI the only way through is an explicit --yes.
				if (level === "critical" || level === "high") {
					const details = fmtFindings(findings);
					if (ctx.hasUI) {
						const ok = await ctx.ui.confirm(
							`Import ${name}? scanned ${level.toUpperCase()}`,
							details,
						);
						if (!ok) {
							notify(`not imported: ${name}`, "warning");
							return;
						}
					} else if (!yesFlag) {
						notify(
							`refusing to import a ${level} file without UI — add --yes`,
							"error",
						);
						return;
					}
				}
				const file = path.resolve(path.join(ctx.cwd, CONTEXT_DIR), `${name}.md`);
				if (fs.existsSync(file)) {
					if (ctx.hasUI) {
						const ok = await ctx.ui.confirm(
							`Overwrite ${name}.md?`,
							"A local file with this name already exists in .pi/context/.",
						);
						if (!ok) {
							notify(`kept local ${name}.md`, "warning");
							return;
						}
					} else if (!yesFlag) {
						notify(`${name}.md already exists — add --yes to overwrite`, "error");
						return;
					}
				}
				try {
					fs.mkdirSync(path.dirname(file), { recursive: true });
					fs.writeFileSync(file, raw, { mode: 0o600 });
				} catch (err) {
					notify(`cannot write ${file}: ${(err as Error).message}`, "error");
					return;
				}
				try {
					approve(file, raw, level, `registry:${name}`);
				} catch (err) {
					notify(`trust failed: ${(err as Error).message}`, "error");
					return;
				}
				await reload(ctx.cwd, ctx);
				notify(`imported ${name} (${level})`);
				return;
			}
			if (cmd === "convert") {
				const yesFlag = parts.includes("--yes");
				// --yes is stripped so it never leaks into the source path.
				const rawPath = parts
					.slice(1)
					.filter((p) => p !== "--yes")
					.join(" ")
					.trim();
				const sourceRel = rawPath || "AGENTS.md";
				const sourceAbs = path.resolve(ctx.cwd, sourceRel);
				if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
					notify(
						`convert: source not found: ${sourceRel} (usage: /nma convert [file] [--yes])`,
						"error",
					);
					return;
				}
				const raw = fs.readFileSync(sourceAbs, "utf8");
				if (Buffer.byteLength(raw, "utf8") > 5_000_000) {
					notify(
						`convert: ${sourceRel} is too large to convert (5 MB cap)`,
						"error",
					);
					return;
				}
				const sections = parseSections(raw);
				if (sections.length === 0) {
					notify(`convert: no sections found in ${sourceRel}`, "error");
					return;
				}
				// Same flat-discovery rules as loadContextDir: top-level *.md,
				// README.md skipped — the agent output must not collide with them.
				const dir = path.join(ctx.cwd, CONTEXT_DIR);
				fs.mkdirSync(dir, { recursive: true });
				const existing = fs
					.readdirSync(dir)
					.filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
					.map((f) => f.replace(/\.md$/i, ""));
				const named = assignNames(sections, existing);
				pi.sendMessage({
					customType: BRAND,
					content: buildPlan({
						sourceRel,
						targetDir: CONTEXT_DIR,
						named,
						existing,
						yesFlag,
					}),
					display: true,
				});
				// The brief is a user message: pi always triggers a turn for it,
				// so the agent starts the conversion right away.
				pi.sendUserMessage(buildBrief({ sourceRel, named, existing, yesFlag }));
				notify(`convert: ${named.length} section(s) ready from ${sourceRel}`);
				return;
			}
			if (cmd === "security") {
				const lines = [
					`**Security scan — ${lastScan.size} file(s)**`,
					`**Command guard:** ${guardArmed.size > 0 ? "ON" : "OFF"}`,
				];
				for (const [f, s] of lastScan) {
					const state = s.loaded ? "loaded" : "BLOCKED";
					lines.push(
						`- ${f} → ${s.level} (${state})${s.trusted ? " [trusted]" : ""}`,
					);
					for (const x of s.findings) lines.push(`  - [${x.id}] ${x.evidence}`);
				}
				if (lastScan.size === 0) lines.push("_No rule files scanned yet._");
				pi.sendMessage({
					customType: BRAND,
					content: lines.join("\n"),
					display: true,
				});
				return;
			}
			if (cmd === "trust" || cmd === "untrust") {
				const yesFlag = parts.includes("--yes");
				// --yes is trust-only syntax; the untrust path stays untouched.
				const name = parts
					.slice(1)
					.filter((p) => (cmd === "trust" ? p !== "--yes" : true))
					.join(" ");
				if (!name) {
					notify(`usage: /nma ${cmd} <file>`, "error");
					return;
				}
				const file = name.includes("/")
					? path.resolve(name)
					: path.resolve(path.join(ctx.cwd, CONTEXT_DIR), name);
				if (cmd === "untrust") {
					try {
						revoke(file);
					} catch (err) {
						notify(`untrust failed: ${(err as Error).message}`, "error");
						return;
					}
					await reload(ctx.cwd, ctx);
					notify(`trust revoked for ${path.basename(file)}`);
					return;
				}
				let raw: string;
				try {
					raw = fs.readFileSync(file, "utf8");
				} catch (err) {
					notify(`cannot read ${file}: ${(err as Error).message}`, "error");
					return;
				}
				// F10: a scan failure is never a silent approve at a fabricated
				// level — refuse unless the user explicitly overrides with --yes.
				let scan: ScanResult = {
					level: "high", // fail-safe, reachable only via --yes
					findings: [
						mkFinding("scan-error", "command", "high", "high", "scan failed"),
					],
				};
				try {
					scan = mergeScans(
						scanContext(raw, path.basename(file)),
						scanFrontmatter(frontmatterMeta(raw, path.basename(file))),
					);
				} catch (err) {
					console.error(`[${BRAND}] ${file}: scan error: ${(err as Error).message}`);
					if (!yesFlag) {
						notify(
							"scan failed — refusing to trust (add --yes to override)",
							"error",
						);
						return;
					}
				}
				const { level, findings } = scan;
				// F10: trusting a high/critical file always confirms; without a
				// UI the only way through is an explicit --yes.
				if (level === "critical" || level === "high") {
					const details = fmtFindings(findings);
					if (ctx.hasUI) {
						const ok = await ctx.ui.confirm(
							`Trust ${path.basename(file)}? scanned ${level.toUpperCase()}`,
							details,
						);
						if (!ok) {
							notify(`not trusted: ${path.basename(file)}`, "warning");
							return;
						}
					} else if (!yesFlag) {
						notify(
							`refusing to trust a ${level} file without UI — add --yes`,
							"error",
						);
						return;
					}
				}
				try {
					approve(file, raw, level, "user");
				} catch (err) {
					notify(`trust failed: ${(err as Error).message}`, "error");
					return;
				}
				await reload(ctx.cwd, ctx);
				notify(`trusted ${path.basename(file)} (${level})`);
				return;
			}
			if (cmd === "share") {
				openBrowser(SHARE_URL);
				copyToClipboard(SHARE_URL);
				pi.sendMessage({
					customType: BRAND,
					content: `**Share a context file**\n\nYour browser should open the submission form. If not, open this URL — it is already copied to your clipboard:\n\n${SHARE_URL}`,
					display: true,
				});
				return;
			}
			if (cmd === "status") {
				const counts = new Map<string, number>();
				for (const a of activity)
					counts.set(a.action, (counts.get(a.action) ?? 0) + 1);
				const lines = [
					`**Active copy:** \`${SELF_PATH}\``,
					`**Rules loaded:** ${rules.length}`,
					`**Once injections:** ${injectedOnce.size}`,
					`**Pending context:** ${pendingInject.length}`,
					`**Actions (by type):** ${
						[...counts.entries()].map(([a, n]) => `${a} ${n}`).join(", ") || "none"
					}`,
					"",
					"**Last actions**",
					...activity
						.slice(-10)
						.map(
							(a) =>
								`- ${a.t} ${a.rule} ${a.event} ${a.action}${a.detail ? ` ${a.detail}` : ""}`,
						),
				];
				pi.sendMessage({
					customType: BRAND,
					content: lines.join("\n"),
					display: true,
				});
				return;
			}
			const lines = rules.map((r) => {
				const m = r.match ? JSON.stringify(r.match) : "always";
				return `- **${r.name}** [${r.events.join(",")}] ${r.action.type} p${r.priority} — ${r.file} (match: ${m})`;
			});
			pi.sendMessage({
				customType: BRAND,
				content:
					lines.length > 0
						? `**Loaded rules**\n\n${lines.join("\n")}`
						: "_No rules loaded yet. Ask the agent for your first rule — the skill creates `.pi/context/` for you._",
				display: true,
			});
		},
	});
}
