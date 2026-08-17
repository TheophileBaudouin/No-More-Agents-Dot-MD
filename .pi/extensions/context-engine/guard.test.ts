import { test } from "node:test";
import assert from "node:assert/strict";
import { tryAcquireSingleton, releaseSingleton } from "./guard.ts";

const KEY = Symbol.for("no-more-agents-dot-md:active-instance");
const g = globalThis as Record<symbol, unknown>;

test("first copy wins; foreign copy yields; same copy may re-activate", () => {
	delete g[KEY];
	const a = {}; // module-scope token of copy A (one install path)
	const b = {}; // module-scope token of copy B (other install path)
	assert.equal(tryAcquireSingleton(a), true);
	assert.equal(tryAcquireSingleton(b), false); // second copy must yield
	assert.equal(tryAcquireSingleton(a), true); // same-module reload is fine
	delete g[KEY];
});

test("only the holder releases; after release a new copy may activate", () => {
	delete g[KEY];
	const a = {};
	const b = {};
	tryAcquireSingleton(a);
	releaseSingleton(b); // not the holder: no-op
	assert.equal(tryAcquireSingleton(b), false);
	releaseSingleton(a); // holder releases (session_shutdown / reload)
	assert.equal(tryAcquireSingleton(b), true);
	delete g[KEY];
});
