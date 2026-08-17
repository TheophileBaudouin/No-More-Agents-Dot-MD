/**
 * Process-wide singleton guard. The same extension can be loaded twice in one
 * pi process (a project-local copy in .pi/extensions/ AND the global npm
 * package). Both would register /nma and every event handler — pi renames the
 * commands to /nma:1, /nma:2 and handlers fire twice. First copy to activate
 * wins; later copies yield.
 *
 * Reload safety: pi emits session_shutdown (reason "reload") BEFORE
 * re-activating extensions, and index.ts releases the guard there, so
 * ctx.reload() re-acquires cleanly. Same-module re-activation (pi's jiti
 * module cache) is always allowed because the token identity matches.
 */
const KEY = Symbol.for("no-more-agents-dot-md:active-instance");

type GuardedGlobal = typeof globalThis & { [KEY]?: object };

/**
 * Try to become the active instance. `token` must be a module-scope object:
 * each install path is a distinct jiti module, so each copy's token differs.
 * Returns false when a DIFFERENT copy already holds the guard.
 */
export function tryAcquireSingleton(token: object): boolean {
	const g = globalThis as GuardedGlobal;
	if (g[KEY] !== undefined && g[KEY] !== token) return false;
	g[KEY] = token;
	return true;
}

/** Release the guard if (and only if) `token` is the current holder. */
export function releaseSingleton(token: object): void {
	const g = globalThis as GuardedGlobal;
	if (g[KEY] === token) g[KEY] = undefined;
}
