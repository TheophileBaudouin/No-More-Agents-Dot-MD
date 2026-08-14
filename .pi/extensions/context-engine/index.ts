/**
 * No More Agents Dot MD — turns `.pi/context/*.md` files into Pi behaviors.
 * Frontmatter YAML = behavior (events/match/action); the Markdown body is the
 * context injected into the agent. The frontmatter is never injected.
 */
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
	copyToClipboard,
	createLocalBashOperations,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	loadContextDir,
	selectForEvent,
	selectInject,
	selectToolRules,
	type Rule,
} from "./engine.ts";
import type { Subject } from "./match.ts";

const CONTEXT_DIR = ".pi/context";

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

export default function (pi: ExtensionAPI) {
	let rules: Rule[] = [];
	let injectedOnce = new Set<string>();
	let pendingInject: string[] = [];
	const activity: ActivityEntry[] = [];

	function reload(cwd: string) {
		rules = loadContextDir(path.join(cwd, CONTEXT_DIR));
		injectedOnce = new Set<string>();
		pendingInject = [];
		if (rules.length > 0) {
			console.log(
				`[context-engine] ${rules.length} rule(s) loaded from .pi/context/`,
			);
		}
	}

	function log(rule: string, event: string, action: string, detail?: string) {
		activity.push({ t: new Date().toISOString(), rule, event, action, detail });
		if (activity.length > 100) activity.shift();
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) =>
		reload(ctx.cwd),
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
		ctx.ui.notify(`[nma] ${r.name}: context injected`, "info");
	}

	function notifyBlock(ctx: ExtensionContext | undefined, r: Rule) {
		if (!ctx?.hasUI || !ctx.ui?.notify) return;
		ctx.ui.notify(`[nma] ${r.name}: blocked`, "warning");
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
			.map((r) => `## ${r.name}\n\n${r.body}`)
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
	pi.on("tool_call", async (event, ctx) => {
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
					pendingInject.push(`## ${r.name}\n\n${r.body}`);
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
						const base = Array.isArray(patch.content)
							? patch.content
							: event.content;
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
					pendingInject.push(`## ${r.name}\n\n${r.body}`);
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

	// /nma — manage rules from inside pi: list, reload, status, share.
	// Output is shown in the transcript (pi.sendMessage), never in the input editor.
	pi.registerCommand("nma", {
		description:
			"No More Agents Dot MD: /nma (list), /nma reload, /nma status, /nma share",
		getArgumentCompletions: (prefix: string) => {
			const items = ["reload", "status", "share"].flatMap((o) =>
				o.startsWith(prefix) ? [{ value: o, label: o }] : [],
			);
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const cmd = args.trim().split(/\s+/)[0] ?? "";
			if (cmd === "reload") {
				try {
					reload(ctx.cwd);
					if (ctx.hasUI) {
						ctx.ui.notify(`[nma] ${rules.length} rule(s) reloaded`, "info");
					} else {
						console.log(`[nma] ${rules.length} rule(s) reloaded`);
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (ctx.hasUI) ctx.ui.notify(`[nma] reload failed: ${msg}`, "error");
					else console.error(`[nma] reload failed: ${msg}`);
				}
				return;
			}
			if (cmd === "share") {
				openBrowser(SHARE_URL);
				copyToClipboard(SHARE_URL);
				pi.sendMessage({
					customType: "nma",
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
					`**Rules loaded:** ${rules.length}`,
					`**Once injections:** ${injectedOnce.size}`,
					`**Pending context:** ${pendingInject.length}`,
					`**Actions (by type):** ${
						[...counts.entries()].map(([a, n]) => `${a} ${n}`).join(", ") ||
						"none"
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
					customType: "nma",
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
				customType: "nma",
				content:
					lines.length > 0
						? `**Loaded rules**\n\n${lines.join("\n")}`
						: "_No rules loaded yet. Ask the agent for your first rule — the skill creates `.pi/context/` for you._",
				display: true,
			});
		},
	});
}
