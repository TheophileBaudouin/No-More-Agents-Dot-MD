/**
 * Context Engine — turns `.pi/context/*.md` files into Pi behaviors.
 * Frontmatter YAML = behavior (events/match/action); the Markdown body is the
 * context injected into the agent. The frontmatter is never injected.
 */
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	loadContextDir,
	selectInject,
	selectToolRules,
	type Rule,
} from "./engine.ts";
import type { Subject } from "./match.ts";

const CONTEXT_DIR = ".pi/context";

export default function (pi: ExtensionAPI) {
	let rules: Rule[] = [];
	let injectedOnce = new Set<string>();
	let pendingInject: string[] = [];

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

	pi.on("session_start", async (_event, ctx: ExtensionContext) =>
		reload(ctx.cwd),
	);

	function toolSubject(event: { toolName: string; input?: unknown }): Subject {
		const input = (event.input ?? {}) as Record<string, unknown>;
		return {
			text: JSON.stringify(input),
			tool: event.toolName,
			command: typeof input.command === "string" ? input.command : "",
		};
	}

	// Conditional context injection at agent start (gated on the user prompt).
	pi.on("before_agent_start", async (event) => {
		const subject: Subject = { text: event.prompt ?? "" };
		const chunks = selectInject(rules, subject, injectedOnce);
		if (chunks.length === 0) return;
		for (const r of chunks) if (r.action.once) injectedOnce.add(r.name);
		const injected = chunks
			.map((r) => `## ${r.name}\n\n${r.body}`)
			.join("\n\n");
		return { systemPrompt: event.systemPrompt + "\n\n" + injected };
	});

	// Tool guards: block, confirm, modify, and deferred context injection.
	pi.on("tool_call", async (event, ctx) => {
		const subject = toolSubject(event);

		for (const r of selectToolRules(rules, subject)) {
			switch (r.action.type) {
				case "block":
					return {
						block: true,
						reason: r.action.message ?? r.description ?? r.name,
					};
				case "confirm": {
					const reason =
						r.action.message ?? `Authorize ${event.toolName}? (rule ${r.name})`;
					if (!ctx.hasUI) return { block: true, reason }; // fail-safe without UI
					const ok = await ctx.ui.confirm(r.name, reason);
					if (!ok) return { block: true, reason: `Blocked by rule ${r.name}` };
					break;
				}
				case "modify": {
					const c = r.action.command;
					const input = event.input as { command?: string } | undefined;
					if (c && input && typeof input.command === "string") {
						if (c.prepend) input.command = c.prepend + input.command;
						if (c.append) input.command = input.command + c.append;
					}
					break;
				}
				case "inject": {
					if (r.action.once && injectedOnce.has(r.name)) break;
					if (r.action.once) injectedOnce.add(r.name);
					pendingInject.push(`## ${r.name}\n\n${r.body}`);
					break;
				}
				default:
					break; // unknown action types are ignored (schema is extensible)
			}
		}
	});

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
}
